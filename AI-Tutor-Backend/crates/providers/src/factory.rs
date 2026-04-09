use anyhow::{anyhow, Result};
use async_trait::async_trait;
use tokio::time::{sleep, Duration};
use tracing::warn;

use ai_tutor_domain::provider::ModelConfig;

use crate::{
    anthropic::AnthropicProvider,
    config::{PricingOverrideConfig, ServerProviderConfig, TransportOverrideConfig},
    google::GoogleProvider,
    openai::{
        supports_openai_compatible, OpenAiCompatibleImageProvider, OpenAiCompatibleProvider,
        OpenAiCompatibleTtsProvider, OpenAiCompatibleVideoProvider,
    },
    resolve::resolve_model_chain,
    resilient::{is_non_retryable, ProviderPricing},
    traits::{
        ImageProvider, ImageProviderFactory, LlmProvider, LlmProviderFactory, ProviderCapabilities,
        ProviderRuntimeStatus, ProviderStreamEvent, StreamingPath, TtsProvider, TtsProviderFactory,
        VideoProvider, VideoProviderFactory,
    },
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default)]
pub struct DefaultLlmProviderFactory {
    server_config: ServerProviderConfig,
}

impl DefaultLlmProviderFactory {
    pub fn new(server_config: ServerProviderConfig) -> Self {
        Self { server_config }
    }
}

impl LlmProviderFactory for DefaultLlmProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn LlmProvider>> {
        let model_string = format!("{}:{}", model_config.provider_id, model_config.model_id);
        let chain = resolve_model_chain(
            &self.server_config,
            Some(&model_string),
            Some(&model_config.api_key),
            model_config.base_url.as_deref(),
            model_config.provider_type.clone(),
            model_config.requires_api_key,
        )?;

        let mut providers = Vec::new();
        for resolved in chain {
            let provider_type = resolved.model_config.provider_type.clone().ok_or_else(|| {
                anyhow!(
                    "provider type missing for {}",
                    resolved.model_config.provider_id
                )
            })?;
            let provider_id = resolved.model_config.provider_id.clone();
            let pricing = pricing_for_resolved(
                &self.server_config,
                &provider_id,
                resolved
                    .model_info
                    .as_ref()
                    .and_then(|info| info.pricing.clone()),
            );
            let label = format!(
                "{}:{}",
                resolved.model_config.provider_id, resolved.model_config.model_id
            );

            let provider: Box<dyn LlmProvider> = if supports_openai_compatible(&provider_type) {
                Box::new(OpenAiCompatibleProvider::new(resolved.model_config)?)
            } else {
                match provider_type {
                    ai_tutor_domain::provider::ProviderType::Anthropic => {
                        Box::new(AnthropicProvider::new(resolved.model_config)?)
                    }
                    ai_tutor_domain::provider::ProviderType::Google => {
                        Box::new(GoogleProvider::new(resolved.model_config)?)
                    }
                    ai_tutor_domain::provider::ProviderType::OpenAi => {
                        Box::new(OpenAiCompatibleProvider::new(resolved.model_config)?)
                    }
                }
            };
            let provider: Box<dyn LlmProvider> = if let Some(transport_override) = self
                .server_config
                .get(&provider_id)
                .and_then(|entry| entry.transport_override.clone())
            {
                Box::new(CapabilityOverrideLlmProvider::new(provider, transport_override))
            } else {
                provider
            };

            providers.push((label, provider, pricing));
        }

        let resilient = crate::resilient::ResilientLlmProvider::new(providers)
            .with_circuit_breaker(
                self.server_config.llm_circuit_breaker_threshold,
                self.server_config.llm_circuit_breaker_cooldown_ms,
            );
        Ok(Box::new(resilient))
    }
}

fn pricing_for_resolved(
    config: &ServerProviderConfig,
    provider_id: &str,
    model_pricing: Option<ai_tutor_domain::provider::ModelPricing>,
) -> Option<ProviderPricing> {
    model_pricing
        .map(|pricing| ProviderPricing {
            input_cost_per_1m_usd: pricing.input_cost_per_1m_usd,
            output_cost_per_1m_usd: pricing.output_cost_per_1m_usd,
        })
        .or_else(|| {
            config
                .get(provider_id)
                .and_then(|entry| entry.pricing_override.as_ref())
                .and_then(pricing_override_to_runtime)
        })
}

fn pricing_override_to_runtime(pricing: &PricingOverrideConfig) -> Option<ProviderPricing> {
    match (
        pricing.input_cost_per_1m_usd,
        pricing.output_cost_per_1m_usd,
    ) {
        (Some(input_cost_per_1m_usd), Some(output_cost_per_1m_usd)) => Some(ProviderPricing {
            input_cost_per_1m_usd,
            output_cost_per_1m_usd,
        }),
        _ => None,
    }
}

struct CapabilityOverrideLlmProvider {
    inner: Box<dyn LlmProvider>,
    transport_override: TransportOverrideConfig,
}

impl CapabilityOverrideLlmProvider {
    fn new(inner: Box<dyn LlmProvider>, transport_override: TransportOverrideConfig) -> Self {
        Self {
            inner,
            transport_override,
        }
    }

    fn overridden_capabilities(&self) -> ProviderCapabilities {
        let base = self.inner.capabilities();
        ProviderCapabilities {
            native_text_streaming: self
                .transport_override
                .native_text_streaming
                .unwrap_or(base.native_text_streaming),
            native_typed_streaming: self
                .transport_override
                .native_typed_streaming
                .unwrap_or(base.native_typed_streaming),
            compatibility_streaming: self
                .transport_override
                .compatibility_streaming
                .unwrap_or(base.compatibility_streaming),
            cooperative_cancellation: self
                .transport_override
                .cooperative_cancellation
                .unwrap_or(base.cooperative_cancellation),
        }
    }
}

#[async_trait]
impl LlmProvider for CapabilityOverrideLlmProvider {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.inner.generate_text(system_prompt, user_prompt).await
    }

    async fn generate_text_stream(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.inner
            .generate_text_stream(system_prompt, user_prompt, on_delta)
            .await
    }

    async fn generate_text_stream_with_history(
        &self,
        messages: &[(String, String)],
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.inner
            .generate_text_stream_with_history(messages, on_delta)
            .await
    }

    async fn generate_text_stream_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.inner
            .generate_text_stream_with_history_cancellable(messages, cancellation, on_delta)
            .await
    }

    async fn generate_stream_events_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<String> {
        self.inner
            .generate_stream_events_with_history_cancellable(messages, cancellation, on_event)
            .await
    }

    async fn generate_stream_events_with_history(
        &self,
        messages: &[(String, String)],
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<String> {
        self.inner
            .generate_stream_events_with_history(messages, on_event)
            .await
    }

    async fn generate_text_with_history(&self, messages: &[(String, String)]) -> Result<String> {
        self.inner.generate_text_with_history(messages).await
    }

    fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
        let capabilities = self.overridden_capabilities();
        let streaming_path = if capabilities.native_text_streaming {
            StreamingPath::Native
        } else {
            StreamingPath::Compatibility
        };
        self.inner
            .runtime_status()
            .into_iter()
            .map(|mut status| {
                status.capabilities = capabilities;
                status.streaming_path = streaming_path;
                status
            })
            .collect()
    }

    fn streaming_path(&self) -> StreamingPath {
        if self.overridden_capabilities().native_text_streaming {
            StreamingPath::Native
        } else {
            StreamingPath::Compatibility
        }
    }

    fn capabilities(&self) -> ProviderCapabilities {
        self.overridden_capabilities()
    }
}

#[derive(Clone, Default)]
pub struct DefaultTtsProviderFactory {
    server_config: ServerProviderConfig,
}

impl DefaultTtsProviderFactory {
    pub fn new(server_config: ServerProviderConfig) -> Self {
        Self { server_config }
    }
}

impl TtsProviderFactory for DefaultTtsProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn TtsProvider>> {
        let model_string = format!("{}:{}", model_config.provider_id, model_config.model_id);
        let chain = resolve_model_chain(
            &self.server_config,
            Some(&model_string),
            Some(&model_config.api_key),
            model_config.base_url.as_deref(),
            model_config.provider_type.clone(),
            model_config.requires_api_key,
        )?;

        let mut providers: Vec<(String, Box<dyn TtsProvider>)> = Vec::new();
        for resolved in chain {
            let provider_type = resolved.model_config.provider_type.clone().ok_or_else(|| {
                anyhow!(
                    "provider type missing for {}",
                    resolved.model_config.provider_id
                )
            })?;

            if !supports_openai_compatible(&provider_type) {
                continue;
            }

            let label = format!(
                "{}:{}",
                resolved.model_config.provider_id, resolved.model_config.model_id
            );
            match OpenAiCompatibleTtsProvider::new(resolved.model_config) {
                Ok(provider) => providers.push((label, Box::new(provider))),
                Err(err) => warn!("skipping tts provider candidate {}: {}", label, err),
            }
        }

        if providers.is_empty() {
            return Err(anyhow!("no supported tts provider candidates could be built"));
        }
        Ok(Box::new(ResilientTtsProvider::new(providers)))
    }
}

#[derive(Clone, Default)]
pub struct DefaultImageProviderFactory {
    server_config: ServerProviderConfig,
}

impl DefaultImageProviderFactory {
    pub fn new(server_config: ServerProviderConfig) -> Self {
        Self { server_config }
    }
}

impl ImageProviderFactory for DefaultImageProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn ImageProvider>> {
        let model_string = format!("{}:{}", model_config.provider_id, model_config.model_id);
        let chain = resolve_model_chain(
            &self.server_config,
            Some(&model_string),
            Some(&model_config.api_key),
            model_config.base_url.as_deref(),
            model_config.provider_type.clone(),
            model_config.requires_api_key,
        )?;

        let mut providers: Vec<(String, Box<dyn ImageProvider>)> = Vec::new();
        for resolved in chain {
            let provider_type = resolved.model_config.provider_type.clone().ok_or_else(|| {
                anyhow!(
                    "provider type missing for {}",
                    resolved.model_config.provider_id
                )
            })?;

            if !supports_openai_compatible(&provider_type) {
                continue;
            }

            let label = format!(
                "{}:{}",
                resolved.model_config.provider_id, resolved.model_config.model_id
            );
            match OpenAiCompatibleImageProvider::new(resolved.model_config) {
                Ok(provider) => providers.push((label, Box::new(provider))),
                Err(err) => warn!("skipping image provider candidate {}: {}", label, err),
            }
        }

        if providers.is_empty() {
            return Err(anyhow!("no supported image provider candidates could be built"));
        }
        Ok(Box::new(ResilientImageProvider::new(providers)))
    }
}

#[derive(Clone, Default)]
pub struct DefaultVideoProviderFactory {
    server_config: ServerProviderConfig,
}

impl DefaultVideoProviderFactory {
    pub fn new(server_config: ServerProviderConfig) -> Self {
        Self { server_config }
    }
}

impl VideoProviderFactory for DefaultVideoProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn VideoProvider>> {
        let model_string = format!("{}:{}", model_config.provider_id, model_config.model_id);
        let chain = resolve_model_chain(
            &self.server_config,
            Some(&model_string),
            Some(&model_config.api_key),
            model_config.base_url.as_deref(),
            model_config.provider_type.clone(),
            model_config.requires_api_key,
        )?;

        let mut providers: Vec<(String, Box<dyn VideoProvider>)> = Vec::new();
        for resolved in chain {
            let provider_type = resolved.model_config.provider_type.clone().ok_or_else(|| {
                anyhow!(
                    "provider type missing for {}",
                    resolved.model_config.provider_id
                )
            })?;

            if !supports_openai_compatible(&provider_type) {
                continue;
            }

            let label = format!(
                "{}:{}",
                resolved.model_config.provider_id, resolved.model_config.model_id
            );
            match OpenAiCompatibleVideoProvider::new(resolved.model_config) {
                Ok(provider) => providers.push((label, Box::new(provider))),
                Err(err) => warn!("skipping video provider candidate {}: {}", label, err),
            }
        }

        if providers.is_empty() {
            return Err(anyhow!("no supported video provider candidates could be built"));
        }
        Ok(Box::new(ResilientVideoProvider::new(providers)))
    }
}

const MEDIA_PROVIDER_MAX_ATTEMPTS: usize = 2;
const MEDIA_PROVIDER_BACKOFF_MS: u64 = 300;

// OpenMAIC reference:
// - `lib/server/classroom-media-generation.ts` runs media generation with a
//   provider-first orchestration flow.
// AI-Tutor parity upgrade:
// - keep provider-first ordering, but add retry+failover semantics to match
//   resilient behavior expectations from OpenMAIC's infra posture.
struct ResilientImageProvider {
    providers: Vec<(String, Box<dyn ImageProvider>)>,
}

impl ResilientImageProvider {
    fn new(providers: Vec<(String, Box<dyn ImageProvider>)>) -> Self {
        Self { providers }
    }
}

#[async_trait]
impl ImageProvider for ResilientImageProvider {
    async fn generate_image(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let mut last_error = None;
        for (label, provider) in &self.providers {
            for attempt in 0..MEDIA_PROVIDER_MAX_ATTEMPTS {
                match provider.generate_image(prompt, aspect_ratio).await {
                    Ok(url) => return Ok(url),
                    Err(err) => {
                        let non_retryable = is_non_retryable(&err);
                        warn!(
                            "image provider {} failed attempt {}/{} (non_retryable={}): {}",
                            label,
                            attempt + 1,
                            MEDIA_PROVIDER_MAX_ATTEMPTS,
                            non_retryable,
                            err
                        );
                        last_error = Some(anyhow!("{}: {}", label, err));
                        if non_retryable || attempt + 1 == MEDIA_PROVIDER_MAX_ATTEMPTS {
                            break;
                        }
                        sleep(Duration::from_millis(
                            MEDIA_PROVIDER_BACKOFF_MS * (attempt as u64 + 1),
                        ))
                        .await;
                    }
                }
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow!("all image providers failed")))
    }
}

struct ResilientVideoProvider {
    providers: Vec<(String, Box<dyn VideoProvider>)>,
}

impl ResilientVideoProvider {
    fn new(providers: Vec<(String, Box<dyn VideoProvider>)>) -> Self {
        Self { providers }
    }
}

#[async_trait]
impl VideoProvider for ResilientVideoProvider {
    async fn generate_video(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let mut last_error = None;
        for (label, provider) in &self.providers {
            for attempt in 0..MEDIA_PROVIDER_MAX_ATTEMPTS {
                match provider.generate_video(prompt, aspect_ratio).await {
                    Ok(url) => return Ok(url),
                    Err(err) => {
                        let non_retryable = is_non_retryable(&err);
                        warn!(
                            "video provider {} failed attempt {}/{} (non_retryable={}): {}",
                            label,
                            attempt + 1,
                            MEDIA_PROVIDER_MAX_ATTEMPTS,
                            non_retryable,
                            err
                        );
                        last_error = Some(anyhow!("{}: {}", label, err));
                        if non_retryable || attempt + 1 == MEDIA_PROVIDER_MAX_ATTEMPTS {
                            break;
                        }
                        sleep(Duration::from_millis(
                            MEDIA_PROVIDER_BACKOFF_MS * (attempt as u64 + 1),
                        ))
                        .await;
                    }
                }
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow!("all video providers failed")))
    }
}

struct ResilientTtsProvider {
    providers: Vec<(String, Box<dyn TtsProvider>)>,
}

impl ResilientTtsProvider {
    fn new(providers: Vec<(String, Box<dyn TtsProvider>)>) -> Self {
        Self { providers }
    }
}

#[async_trait]
impl TtsProvider for ResilientTtsProvider {
    async fn synthesize(
        &self,
        text: &str,
        voice: Option<&str>,
        speed: Option<f32>,
    ) -> Result<String> {
        let mut last_error = None;
        for (label, provider) in &self.providers {
            for attempt in 0..MEDIA_PROVIDER_MAX_ATTEMPTS {
                match provider.synthesize(text, voice, speed).await {
                    Ok(audio) => return Ok(audio),
                    Err(err) => {
                        let non_retryable = is_non_retryable(&err);
                        warn!(
                            "tts provider {} failed attempt {}/{} (non_retryable={}): {}",
                            label,
                            attempt + 1,
                            MEDIA_PROVIDER_MAX_ATTEMPTS,
                            non_retryable,
                            err
                        );
                        last_error = Some(anyhow!("{}: {}", label, err));
                        if non_retryable || attempt + 1 == MEDIA_PROVIDER_MAX_ATTEMPTS {
                            break;
                        }
                        sleep(Duration::from_millis(
                            MEDIA_PROVIDER_BACKOFF_MS * (attempt as u64 + 1),
                        ))
                        .await;
                    }
                }
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow!("all tts providers failed")))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use anyhow::{anyhow, Result};
    use ai_tutor_domain::provider::{ModelConfig, ProviderType};

    use super::*;

    struct AlwaysFailImageProvider {
        calls: Arc<AtomicUsize>,
        message: &'static str,
    }

    #[async_trait]
    impl ImageProvider for AlwaysFailImageProvider {
        async fn generate_image(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> Result<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Err(anyhow!(self.message))
        }
    }

    struct SucceedImageProvider;

    #[async_trait]
    impl ImageProvider for SucceedImageProvider {
        async fn generate_image(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> Result<String> {
            Ok("data:image/png;base64,ZmFrZQ==".to_string())
        }
    }

    struct FlakyVideoProvider {
        calls: Arc<AtomicUsize>,
        fail_count: Arc<AtomicUsize>,
    }

    struct AlwaysFailTtsProvider {
        calls: Arc<AtomicUsize>,
        message: &'static str,
    }

    #[async_trait]
    impl TtsProvider for AlwaysFailTtsProvider {
        async fn synthesize(
            &self,
            _text: &str,
            _voice: Option<&str>,
            _speed: Option<f32>,
        ) -> Result<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Err(anyhow!(self.message))
        }
    }

    struct SucceedTtsProvider;

    #[async_trait]
    impl TtsProvider for SucceedTtsProvider {
        async fn synthesize(
            &self,
            _text: &str,
            _voice: Option<&str>,
            _speed: Option<f32>,
        ) -> Result<String> {
            Ok("data:audio/mpeg;base64,ZmFrZQ==".to_string())
        }
    }

    #[async_trait]
    impl VideoProvider for FlakyVideoProvider {
        async fn generate_video(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> Result<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail_count.fetch_sub(1, Ordering::SeqCst) > 0 {
                return Err(anyhow!("temporary upstream timeout"));
            }
            Ok("data:video/mp4;base64,ZmFrZQ==".to_string())
        }
    }

    #[tokio::test]
    async fn resilient_image_provider_fails_over_to_next_candidate() {
        let first_calls = Arc::new(AtomicUsize::new(0));
        let provider = ResilientImageProvider::new(vec![
            (
                "first".to_string(),
                Box::new(AlwaysFailImageProvider {
                    calls: Arc::clone(&first_calls),
                    message: "401 Unauthorized",
                }),
            ),
            ("second".to_string(), Box::new(SucceedImageProvider)),
        ]);

        let result = provider
            .generate_image("A fraction wheel", Some("16:9"))
            .await
            .expect("second provider should succeed");

        assert!(result.starts_with("data:image/png;base64"));
        assert_eq!(first_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn resilient_video_provider_retries_transient_failure_before_success() {
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = ResilientVideoProvider::new(vec![(
            "video-primary".to_string(),
            Box::new(FlakyVideoProvider {
                calls: Arc::clone(&calls),
                fail_count: Arc::new(AtomicUsize::new(1)),
            }),
        )]);

        let result = provider
            .generate_video("Animated fractions", Some("16:9"))
            .await
            .expect("provider should recover after retry");

        assert!(result.starts_with("data:video/mp4;base64"));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn resilient_tts_provider_fails_over_to_next_candidate() {
        let first_calls = Arc::new(AtomicUsize::new(0));
        let provider = ResilientTtsProvider::new(vec![
            (
                "tts-first".to_string(),
                Box::new(AlwaysFailTtsProvider {
                    calls: Arc::clone(&first_calls),
                    message: "401 Unauthorized",
                }),
            ),
            ("tts-second".to_string(), Box::new(SucceedTtsProvider)),
        ]);

        let result = provider
            .synthesize("Explain fractions", None, None)
            .await
            .expect("fallback tts provider should succeed");

        assert!(result.starts_with("data:audio/mpeg;base64"));
        assert_eq!(first_calls.load(Ordering::SeqCst), 1);
    }

    struct CapabilityReportingProvider;

    #[async_trait]
    impl LlmProvider for CapabilityReportingProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok("ok".to_string())
        }

        fn streaming_path(&self) -> StreamingPath {
            StreamingPath::Native
        }

        fn capabilities(&self) -> ProviderCapabilities {
            ProviderCapabilities::native_text_and_typed()
        }

        fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
            vec![ProviderRuntimeStatus {
                label: "openrouter:test-model".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: 0,
                average_latency_ms: None,
                last_latency_ms: None,
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities: ProviderCapabilities::native_text_and_typed(),
            }]
        }
    }

    #[tokio::test]
    async fn capability_override_provider_adjusts_runtime_status() {
        let provider: Box<dyn LlmProvider> = Box::new(CapabilityOverrideLlmProvider::new(
            Box::new(CapabilityReportingProvider),
            TransportOverrideConfig {
                native_text_streaming: Some(true),
                native_typed_streaming: Some(false),
                compatibility_streaming: Some(true),
                cooperative_cancellation: Some(true),
            },
        ));

        let capabilities = provider.capabilities();
        assert!(capabilities.native_text_streaming);
        assert!(!capabilities.native_typed_streaming);
        assert!(capabilities.compatibility_streaming);

        let runtime = provider.runtime_status();
        assert_eq!(runtime[0].streaming_path, StreamingPath::Native);
        assert!(!runtime[0].capabilities.native_typed_streaming);
        assert!(runtime[0].capabilities.compatibility_streaming);
    }

    #[test]
    fn default_llm_provider_factory_wraps_transport_overrides() {
        let mut config = ServerProviderConfig::default();
        config.providers.insert(
            "openrouter".to_string(),
            crate::config::ServerProviderEntry {
                api_key: Some("key".to_string()),
                base_url: Some("https://example.test/v1".to_string()),
                proxy: None,
                models: vec!["anthropic/claude-3-sonnet".to_string()],
                transport_override: Some(TransportOverrideConfig {
                    native_text_streaming: Some(true),
                    native_typed_streaming: Some(false),
                    compatibility_streaming: Some(true),
                    cooperative_cancellation: Some(true),
                }),
                pricing_override: None,
            },
        );

        let factory = DefaultLlmProviderFactory::new(config);
        let provider = factory
            .build(ModelConfig {
                provider_id: "openrouter".to_string(),
                model_id: "anthropic/claude-3-sonnet".to_string(),
                api_key: "key".to_string(),
                base_url: Some("https://example.test/v1".to_string()),
                proxy: None,
                provider_type: Some(ProviderType::OpenAi),
                requires_api_key: Some(true),
            })
            .expect("factory should build provider");

        let runtime = provider.runtime_status();
        assert!(!runtime.is_empty());
        assert!(!runtime[0].capabilities.native_typed_streaming);
        assert!(runtime[0].capabilities.compatibility_streaming);
    }
}
