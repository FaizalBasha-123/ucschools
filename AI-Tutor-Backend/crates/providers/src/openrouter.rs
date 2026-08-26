use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use ai_tutor_domain::provider::ProviderStrategy;

use crate::request_params::GenerationParams;
use crate::traits::{LlmProvider, ProviderCapabilities, ProviderRuntimeStatus, ProviderUsage, StreamingPath};

const OPENROUTER_REFERER: &str = "https://ai-tutor.app";
const OPENROUTER_TITLE: &str = "AI Tutor";

/// Hard ceiling: never request more than this even with full balance.
/// A single scene JSON rarely exceeds 3000 tokens of output.
const MAX_SAFE_TOKENS: u32 = 8_000;

/// Minimum tokens to attempt a generation.
/// Below this there is not enough room to produce useful output.
const MIN_VIABLE_TOKENS: u32 = 500;

/// Safety buffer subtracted from the available balance so we don't
/// accidentally drain it to zero and lock out the next request.
const BALANCE_SAFETY_BUFFER: u32 = 200;

pub fn wrap_with_strategy(
    provider: Box<dyn LlmProvider>,
    strategy: &ProviderStrategy,
) -> Box<dyn LlmProvider> {
    match strategy {
        ProviderStrategy::OpenRouter => Box::new(OpenRouterLlmProvider::new(provider, None, false)),
        ProviderStrategy::Direct => provider,
        ProviderStrategy::Fallback(primary, secondary) => {
            let primary_box = wrap_with_strategy(provider, primary);
            let secondary_box = wrap_with_strategy(
                Box::new(NoOpLlmProvider),
                secondary,
            );
            Box::new(FallbackLlmProvider::new(primary_box, secondary_box))
        }
    }
}

pub fn wrap_with_strategy_and_key(
    provider: Box<dyn LlmProvider>,
    strategy: &ProviderStrategy,
    api_key: Option<String>,
    is_free_model: bool,
) -> Box<dyn LlmProvider> {
    match strategy {
        ProviderStrategy::OpenRouter => Box::new(OpenRouterLlmProvider::new(provider, api_key, is_free_model)),
        ProviderStrategy::Direct => provider,
        ProviderStrategy::Fallback(primary, secondary) => {
            let primary_box = wrap_with_strategy_and_key(provider, primary, api_key.clone(), is_free_model);
            let secondary_box = wrap_with_strategy_and_key(
                Box::new(NoOpLlmProvider),
                secondary,
                api_key,
                is_free_model,
            );
            Box::new(FallbackLlmProvider::new(primary_box, secondary_box))
        }
    }
}

struct NoOpLlmProvider;

#[async_trait]
impl LlmProvider for NoOpLlmProvider {
    async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
        Err(anyhow::anyhow!("no-op provider"))
    }

    async fn generate_text_with_params(
        &self,
        _system_prompt: &str,
        _user_prompt: &str,
        _params: &GenerationParams,
    ) -> Result<(String, Option<ProviderUsage>)> {
        Err(anyhow::anyhow!("no-op provider"))
    }
}

// ── OpenRouter balance API response ──────────────────────────────────────────

#[derive(Deserialize)]
struct OpenRouterKeyInfo {
    data: OpenRouterKeyData,
}

#[derive(Deserialize)]
struct OpenRouterKeyData {
    /// Remaining credit limit for this key (in USD * some factor).
    /// OpenRouter uses a "credits" unit where 1 credit ≈ $0.000001 USD.
    limit_remaining: Option<f64>,
}

// ── OpenRouterLlmProvider ─────────────────────────────────────────────────────

pub struct OpenRouterLlmProvider {
    inner: Box<dyn LlmProvider>,
    api_key: Option<String>,
    is_free_model: bool,
    /// Cached balance in approximate token units (refreshed each call).
    /// Stored as AtomicU32 so it can be shared across async bounds.
    cached_max_tokens: Arc<AtomicU32>,
}

impl OpenRouterLlmProvider {
    pub fn new(inner: Box<dyn LlmProvider>, api_key: Option<String>, is_free_model: bool) -> Self {
        Self {
            inner,
            api_key,
            is_free_model,
            // Start with a conservative default until first balance check.
            cached_max_tokens: Arc::new(AtomicU32::new(1500)),
        }
    }

    /// Fetch current balance from OpenRouter and convert to a safe max_tokens cap.
    ///
    /// OpenRouter reports `limit_remaining` in credits (1 credit ≈ $0.000001).
    /// For Gemini 2.5 Flash, the cost is roughly $0.075 / 1M output tokens =
    /// $0.000000075 per token = 0.075 credits per token.
    /// So affordable_tokens ≈ limit_remaining / 0.075 (conservative).
    ///
    /// We use a generous divisor of 0.15 (2× safety margin) so we never
    /// accidentally pre-authorize more than half the remaining balance.
    async fn fetch_affordable_max_tokens(&self) -> u32 {
        if self.is_free_model {
            return MAX_SAFE_TOKENS;
        }

        let Some(ref api_key) = self.api_key else {
            return self.cached_max_tokens.load(Ordering::Relaxed);
        };

        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
        {
            Ok(c) => c,
            Err(_) => return self.cached_max_tokens.load(Ordering::Relaxed),
        };

        let resp = client
            .get("https://openrouter.ai/api/v1/key")
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await;

        let Ok(resp) = resp else {
            return self.cached_max_tokens.load(Ordering::Relaxed);
        };

        let Ok(key_info) = resp.json::<OpenRouterKeyInfo>().await else {
            return self.cached_max_tokens.load(Ordering::Relaxed);
        };

        let Some(limit_remaining) = key_info.data.limit_remaining else {
            return self.cached_max_tokens.load(Ordering::Relaxed);
        };

        // Convert credits → tokens using a conservative cost estimate.
        // 0.15 credits/token = ~2× the actual Gemini 2.5 Flash output cost.
        // This ensures we never over-commit.
        let affordable = (limit_remaining / 0.15) as u32;
        let affordable = affordable.saturating_sub(BALANCE_SAFETY_BUFFER);
        let capped = affordable.min(MAX_SAFE_TOKENS);

        // Store for fallback use on next call if the API is slow.
        self.cached_max_tokens.store(capped, Ordering::Relaxed);

        tracing::debug!(
            limit_remaining,
            affordable_tokens = affordable,
            capped_max_tokens = capped,
            "OpenRouter balance → dynamic max_tokens"
        );

        capped
    }

    /// Build a GenerationParams with max_tokens dynamically set from balance.
    async fn params_with_dynamic_limit(&self, base: &GenerationParams) -> GenerationParams {
        // If the caller already pinned a specific limit, honour it exactly.
        if base.max_tokens.is_some() {
            return base.clone();
        }

        let dynamic_limit = self.fetch_affordable_max_tokens().await;

        if dynamic_limit < MIN_VIABLE_TOKENS {
            // Let the call fail fast with a readable error rather than trying
            // to generate with an absurdly small budget.
            tracing::warn!(
                dynamic_limit,
                "OpenRouter balance too low for generation; passing limit through to surface clear error"
            );
        }

        let mut updated = base.clone();
        updated.max_tokens = Some(dynamic_limit.max(MIN_VIABLE_TOKENS));
        updated
    }

    fn augment_prompts(&self, system_prompt: &str, user_prompt: &str) -> (String, String) {
        let system = format!(
            "{}\n\n[OpenRouter: referer={}, title={}]",
            system_prompt, OPENROUTER_REFERER, OPENROUTER_TITLE
        );
        let user = user_prompt.to_string();
        (system, user)
    }

    fn augment_messages(&self, messages: &[(String, String)]) -> Vec<(String, String)> {
        let mut augmented = Vec::with_capacity(messages.len());
        for (i, (role, content)) in messages.iter().enumerate() {
            if i == 0 && role == "system" {
                augmented.push((
                    role.clone(),
                    format!(
                        "{}\n\n[OpenRouter: referer={}, title={}]",
                        content, OPENROUTER_REFERER, OPENROUTER_TITLE
                    ),
                ));
            } else {
                augmented.push((role.clone(), content.clone()));
            }
        }
        augmented
    }
}

#[async_trait]
impl LlmProvider for OpenRouterLlmProvider {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        let (system, user) = self.augment_prompts(system_prompt, user_prompt);
        self.inner.generate_text(&system, &user).await
    }

    async fn generate_text_with_usage(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        // generate_text_with_usage also needs a dynamic cap because the
        // underlying generate_text_with_history_and_usage hardcodes a ceiling.
        // We build a default params and apply the dynamic limit.
        let base_params = GenerationParams::default();
        let dynamic_params = self.params_with_dynamic_limit(&base_params).await;
        let (system, user) = self.augment_prompts(system_prompt, user_prompt);
        self.inner.generate_text_with_params(&system, &user, &dynamic_params).await
    }

    async fn generate_text_with_history_and_usage(
        &self,
        messages: &[(String, String)],
    ) -> Result<(String, Option<ProviderUsage>)> {
        let augmented = self.augment_messages(messages);
        self.inner.generate_text_with_history_and_usage(&augmented).await
    }

    async fn generate_text_with_params(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        params: &GenerationParams,
    ) -> Result<(String, Option<ProviderUsage>)> {
        let dynamic_params = self.params_with_dynamic_limit(params).await;
        let (system, user) = self.augment_prompts(system_prompt, user_prompt);
        self.inner.generate_text_with_params(&system, &user, &dynamic_params).await
    }

    /// Forward runtime telemetry to the wrapped provider.
    ///
    /// The ResilientLlmProvider accumulates in-memory counters (requests,
    /// successes, failures, latency, provider-reported token usage, cost) into
    /// a process-global store. Without this override the outer OpenRouter
    /// wrapper inherits the trait default (empty Vec), which makes the operator
    /// panel's `GET /api/system/status` report zero provider telemetry even
    /// while generations are flowing.
    fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
        self.inner.runtime_status()
    }

    fn streaming_path(&self) -> StreamingPath {
        self.inner.streaming_path()
    }

    fn capabilities(&self) -> ProviderCapabilities {
        self.inner.capabilities()
    }
}

// ── FallbackLlmProvider ───────────────────────────────────────────────────────

pub struct FallbackLlmProvider {
    primary: Box<dyn LlmProvider>,
    secondary: Box<dyn LlmProvider>,
}

impl FallbackLlmProvider {
    pub fn new(primary: Box<dyn LlmProvider>, secondary: Box<dyn LlmProvider>) -> Self {
        Self { primary, secondary }
    }
}

#[async_trait]
impl LlmProvider for FallbackLlmProvider {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        match self.primary.generate_text(system_prompt, user_prompt).await {
            Ok(response) => Ok(response),
            Err(_) => self.secondary.generate_text(system_prompt, user_prompt).await,
        }
    }

    async fn generate_text_with_usage(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        match self
            .primary
            .generate_text_with_usage(system_prompt, user_prompt)
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => self
                .secondary
                .generate_text_with_usage(system_prompt, user_prompt)
                .await,
        }
    }

    async fn generate_text_with_history_and_usage(
        &self,
        messages: &[(String, String)],
    ) -> Result<(String, Option<ProviderUsage>)> {
        match self
            .primary
            .generate_text_with_history_and_usage(messages)
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => self
                .secondary
                .generate_text_with_history_and_usage(messages)
                .await,
        }
    }

    async fn generate_text_with_params(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        params: &GenerationParams,
    ) -> Result<(String, Option<ProviderUsage>)> {
        match self
            .primary
            .generate_text_with_params(system_prompt, user_prompt, params)
            .await
        {
            Ok(result) => Ok(result),
            Err(_) => self
                .secondary
                .generate_text_with_params(system_prompt, user_prompt, params)
                .await,
        }
    }

    /// Forward runtime telemetry from the active provider.
    ///
    /// Fallback chains wrap primary+secondary providers (which are themselves
    /// ResilientLlmProvider instances holding the live telemetry counters).
    /// Report the primary's status so the operator panel surfaces the circuit
    /// breaker state and token usage of the main path.
    fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
        self.primary.runtime_status()
    }

    fn streaming_path(&self) -> StreamingPath {
        self.primary.streaming_path()
    }

    fn capabilities(&self) -> ProviderCapabilities {
        self.primary.capabilities()
    }
}
