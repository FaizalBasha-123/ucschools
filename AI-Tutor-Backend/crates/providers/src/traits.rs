use async_trait::async_trait;
use anyhow::Result;

use ai_tutor_domain::provider::ModelConfig;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String>;
}

#[async_trait]
pub trait TtsProvider: Send + Sync {
    async fn synthesize(
        &self,
        text: &str,
        voice: Option<&str>,
        speed: Option<f32>,
    ) -> Result<String>;
}

#[async_trait]
pub trait AsrProvider: Send + Sync {
    async fn transcribe(&self, audio_url: &str) -> Result<String>;
}

#[async_trait]
pub trait ImageProvider: Send + Sync {
    async fn generate_image(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String>;
}

#[async_trait]
pub trait VideoProvider: Send + Sync {
    async fn generate_video(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String>;
}

pub trait LlmProviderFactory: Send + Sync {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn LlmProvider>>;
}

pub trait TtsProviderFactory: Send + Sync {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn TtsProvider>>;
}

pub trait ImageProviderFactory: Send + Sync {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn ImageProvider>>;
}

pub trait VideoProviderFactory: Send + Sync {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn VideoProvider>>;
}
