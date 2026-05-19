use anyhow::Result;
use async_trait::async_trait;

use ai_tutor_domain::provider::ProviderStrategy;

use crate::request_params::GenerationParams;
use crate::traits::{LlmProvider, ProviderUsage};

const OPENROUTER_REFERER: &str = "https://ai-tutor.app";
const OPENROUTER_TITLE: &str = "AI Tutor";

pub fn wrap_with_strategy(
    provider: Box<dyn LlmProvider>,
    strategy: &ProviderStrategy,
) -> Box<dyn LlmProvider> {
    match strategy {
        ProviderStrategy::OpenRouter => Box::new(OpenRouterLlmProvider::new(provider)),
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

pub struct OpenRouterLlmProvider {
    inner: Box<dyn LlmProvider>,
}

impl OpenRouterLlmProvider {
    pub fn new(inner: Box<dyn LlmProvider>) -> Self {
        Self { inner }
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
        let (system, user) = self.augment_prompts(system_prompt, user_prompt);
        self.inner.generate_text_with_usage(&system, &user).await
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
        let (system, user) = self.augment_prompts(system_prompt, user_prompt);
        self.inner.generate_text_with_params(&system, &user, params).await
    }
}

impl OpenRouterLlmProvider {
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
}
