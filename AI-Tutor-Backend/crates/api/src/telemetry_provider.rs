use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tracing::warn;
use uuid::Uuid;

use ai_tutor_providers::traits::{
    ImageProvider, LlmProvider, ProviderUsage, TtsProvider, VideoProvider,
};

use crate::telemetry::{TelemetryService, UsageEvent};

fn estimate_tokens(text: &str) -> i64 {
    if text.is_empty() {
        return 0;
    }
    ((text.len() as f64) / 4.0).ceil() as i64
}

fn estimate_history_tokens(messages: &[(String, String)]) -> i64 {
    messages
        .iter()
        .map(|(role, content)| estimate_tokens(role) + estimate_tokens(content))
        .sum()
}

fn usage_from_provider(usage: Option<&ProviderUsage>, input_est: i64, output_est: i64) -> (i64, i64) {
    if let Some(usage) = usage {
        return (usage.input_tokens as i64, usage.output_tokens as i64);
    }
    (input_est, output_est)
}

pub fn account_id_from_scoped_session_id(session_id: &str) -> Option<String> {
    let stripped = session_id.strip_prefix("account:")?;
    stripped
        .split(":pbl-runtime:")
        .next()
        .map(|value| value.to_string())
}

pub struct TelemetryLlmProvider {
    inner: Box<dyn LlmProvider>,
    telemetry: Arc<TelemetryService>,
    account_id: Option<String>,
    component: String,
    provider_id: String,
    model_id: String,
}

impl TelemetryLlmProvider {
    pub fn new(
        inner: Box<dyn LlmProvider>,
        telemetry: Arc<TelemetryService>,
        account_id: Option<String>,
        component: impl Into<String>,
        provider_id: String,
        model_id: String,
    ) -> Self {
        Self {
            inner,
            telemetry,
            account_id,
            component: component.into(),
            provider_id,
            model_id,
        }
    }

    async fn record_usage(&self, input_tokens: i64, output_tokens: i64) {
        let account_id = self
            .account_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let Some(account_id) = account_id else {
            return;
        };

        let event = UsageEvent {
            account_id,
            request_id: Uuid::new_v4().to_string(),
            component: self.component.clone(),
            provider_id: self.provider_id.clone(),
            model_id: self.model_id.clone(),
            input_tokens: input_tokens.max(0),
            output_tokens: output_tokens.max(0),
        };

        if let Err(err) = self.telemetry.record_usage(event).await {
            warn!(
                error = ?err,
                component = %self.component,
                provider = %self.provider_id,
                model = %self.model_id,
                "failed to record llm usage"
            );
        }
    }
}

#[async_trait]
impl LlmProvider for TelemetryLlmProvider {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        let (generated, _usage) = self
            .generate_text_with_usage(system_prompt, user_prompt)
            .await?;
        Ok(generated)
    }

    async fn generate_text_with_usage(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        let (generated, usage) = self
            .inner
            .generate_text_with_usage(system_prompt, user_prompt)
            .await?;
        let input_est = estimate_tokens(system_prompt) + estimate_tokens(user_prompt);
        let output_est = estimate_tokens(&generated);
        let (input_tokens, output_tokens) = usage_from_provider(usage.as_ref(), input_est, output_est);
        self.record_usage(input_tokens, output_tokens).await;
        Ok((generated, usage))
    }

    async fn generate_text_with_history(
        &self,
        messages: &[(String, String)],
    ) -> Result<String> {
        let (generated, _usage) = self.generate_text_with_history_and_usage(messages).await?;
        Ok(generated)
    }

    async fn generate_text_with_history_and_usage(
        &self,
        messages: &[(String, String)],
    ) -> Result<(String, Option<ProviderUsage>)> {
        let (generated, usage) = self
            .inner
            .generate_text_with_history_and_usage(messages)
            .await?;
        let input_est = estimate_history_tokens(messages);
        let output_est = estimate_tokens(&generated);
        let (input_tokens, output_tokens) = usage_from_provider(usage.as_ref(), input_est, output_est);
        self.record_usage(input_tokens, output_tokens).await;
        Ok((generated, usage))
    }

    fn runtime_status(&self) -> Vec<ai_tutor_providers::traits::ProviderRuntimeStatus> {
        self.inner.runtime_status()
    }

    fn streaming_path(&self) -> ai_tutor_providers::traits::StreamingPath {
        self.inner.streaming_path()
    }

    fn capabilities(&self) -> ai_tutor_providers::traits::ProviderCapabilities {
        self.inner.capabilities()
    }
}

pub struct TelemetryImageProvider {
    inner: Box<dyn ImageProvider>,
    telemetry: Arc<TelemetryService>,
    account_id: Option<String>,
    component: String,
    provider_id: String,
    model_id: String,
}

impl TelemetryImageProvider {
    pub fn new(
        inner: Box<dyn ImageProvider>,
        telemetry: Arc<TelemetryService>,
        account_id: Option<String>,
        component: impl Into<String>,
        provider_id: String,
        model_id: String,
    ) -> Self {
        Self {
            inner,
            telemetry,
            account_id,
            component: component.into(),
            provider_id,
            model_id,
        }
    }

    async fn record_usage(&self, input_tokens: i64, output_tokens: i64) {
        let account_id = self
            .account_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let Some(account_id) = account_id else {
            return;
        };

        let event = UsageEvent {
            account_id,
            request_id: Uuid::new_v4().to_string(),
            component: self.component.clone(),
            provider_id: self.provider_id.clone(),
            model_id: self.model_id.clone(),
            input_tokens: input_tokens.max(0),
            output_tokens: output_tokens.max(0),
        };

        if let Err(err) = self.telemetry.record_usage(event).await {
            warn!(
                error = ?err,
                component = %self.component,
                provider = %self.provider_id,
                model = %self.model_id,
                "failed to record image usage"
            );
        }
    }
}

#[async_trait]
impl ImageProvider for TelemetryImageProvider {
    async fn generate_image(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let image = self.inner.generate_image(prompt, aspect_ratio).await?;
        let input_tokens = estimate_tokens(prompt);
        self.record_usage(input_tokens, 0).await;
        Ok(image)
    }
}

pub struct TelemetryTtsProvider {
    inner: Box<dyn TtsProvider>,
    telemetry: Arc<TelemetryService>,
    account_id: Option<String>,
    component: String,
    provider_id: String,
    model_id: String,
}

impl TelemetryTtsProvider {
    pub fn new(
        inner: Box<dyn TtsProvider>,
        telemetry: Arc<TelemetryService>,
        account_id: Option<String>,
        component: impl Into<String>,
        provider_id: String,
        model_id: String,
    ) -> Self {
        Self {
            inner,
            telemetry,
            account_id,
            component: component.into(),
            provider_id,
            model_id,
        }
    }

    async fn record_usage(&self, input_tokens: i64, output_tokens: i64) {
        let account_id = self
            .account_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let Some(account_id) = account_id else {
            return;
        };

        let event = UsageEvent {
            account_id,
            request_id: Uuid::new_v4().to_string(),
            component: self.component.clone(),
            provider_id: self.provider_id.clone(),
            model_id: self.model_id.clone(),
            input_tokens: input_tokens.max(0),
            output_tokens: output_tokens.max(0),
        };

        if let Err(err) = self.telemetry.record_usage(event).await {
            warn!(
                error = ?err,
                component = %self.component,
                provider = %self.provider_id,
                model = %self.model_id,
                "failed to record tts usage"
            );
        }
    }
}

#[async_trait]
impl TtsProvider for TelemetryTtsProvider {
    async fn synthesize(
        &self,
        text: &str,
        voice: Option<&str>,
        speed: Option<f32>,
    ) -> Result<String> {
        let audio = self.inner.synthesize(text, voice, speed).await?;
        let input_tokens = estimate_tokens(text);
        self.record_usage(input_tokens, 0).await;
        Ok(audio)
    }
}

pub struct TelemetryVideoProvider {
    inner: Box<dyn VideoProvider>,
    telemetry: Arc<TelemetryService>,
    account_id: Option<String>,
    component: String,
    provider_id: String,
    model_id: String,
}

impl TelemetryVideoProvider {
    pub fn new(
        inner: Box<dyn VideoProvider>,
        telemetry: Arc<TelemetryService>,
        account_id: Option<String>,
        component: impl Into<String>,
        provider_id: String,
        model_id: String,
    ) -> Self {
        Self {
            inner,
            telemetry,
            account_id,
            component: component.into(),
            provider_id,
            model_id,
        }
    }

    async fn record_usage(&self, input_tokens: i64, output_tokens: i64) {
        let account_id = self
            .account_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let Some(account_id) = account_id else {
            return;
        };

        let event = UsageEvent {
            account_id,
            request_id: Uuid::new_v4().to_string(),
            component: self.component.clone(),
            provider_id: self.provider_id.clone(),
            model_id: self.model_id.clone(),
            input_tokens: input_tokens.max(0),
            output_tokens: output_tokens.max(0),
        };

        if let Err(err) = self.telemetry.record_usage(event).await {
            warn!(
                error = ?err,
                component = %self.component,
                provider = %self.provider_id,
                model = %self.model_id,
                "failed to record video usage"
            );
        }
    }
}

#[async_trait]
impl VideoProvider for TelemetryVideoProvider {
    async fn generate_video(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let video = self.inner.generate_video(prompt, aspect_ratio).await?;
        let input_tokens = estimate_tokens(prompt);
        self.record_usage(input_tokens, 0).await;
        Ok(video)
    }
}
