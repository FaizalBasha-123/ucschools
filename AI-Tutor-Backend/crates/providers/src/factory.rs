use anyhow::{anyhow, Result};

use ai_tutor_domain::provider::ModelConfig;

use crate::{
    openai::{
        supports_openai_compatible, OpenAiCompatibleImageProvider, OpenAiCompatibleProvider,
        OpenAiCompatibleTtsProvider, OpenAiCompatibleVideoProvider,
    },
    traits::{
        ImageProvider, ImageProviderFactory, LlmProvider, LlmProviderFactory, TtsProvider,
        TtsProviderFactory, VideoProvider, VideoProviderFactory,
    },
};

#[derive(Default)]
pub struct DefaultLlmProviderFactory;

impl LlmProviderFactory for DefaultLlmProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn LlmProvider>> {
        let provider_type = model_config
            .provider_type
            .clone()
            .ok_or_else(|| anyhow!("provider type missing for {}", model_config.provider_id))?;

        if supports_openai_compatible(&provider_type) {
            return Ok(Box::new(OpenAiCompatibleProvider::new(model_config)?));
        }

        Err(anyhow!(
            "provider type {:?} is not yet implemented",
            provider_type
        ))
    }
}

#[derive(Default)]
pub struct DefaultTtsProviderFactory;

impl TtsProviderFactory for DefaultTtsProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn TtsProvider>> {
        let provider_type = model_config
            .provider_type
            .clone()
            .ok_or_else(|| anyhow!("provider type missing for {}", model_config.provider_id))?;

        if supports_openai_compatible(&provider_type) {
            return Ok(Box::new(OpenAiCompatibleTtsProvider::new(model_config)?));
        }

        Err(anyhow!(
            "tts provider type {:?} is not yet implemented",
            provider_type
        ))
    }
}

#[derive(Default)]
pub struct DefaultImageProviderFactory;

impl ImageProviderFactory for DefaultImageProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn ImageProvider>> {
        let provider_type = model_config
            .provider_type
            .clone()
            .ok_or_else(|| anyhow!("provider type missing for {}", model_config.provider_id))?;

        if supports_openai_compatible(&provider_type) {
            return Ok(Box::new(OpenAiCompatibleImageProvider::new(model_config)?));
        }

        Err(anyhow!(
            "image provider type {:?} is not yet implemented",
            provider_type
        ))
    }
}

#[derive(Default)]
pub struct DefaultVideoProviderFactory;

impl VideoProviderFactory for DefaultVideoProviderFactory {
    fn build(&self, model_config: ModelConfig) -> Result<Box<dyn VideoProvider>> {
        let provider_type = model_config
            .provider_type
            .clone()
            .ok_or_else(|| anyhow!("provider type missing for {}", model_config.provider_id))?;

        if supports_openai_compatible(&provider_type) {
            return Ok(Box::new(OpenAiCompatibleVideoProvider::new(model_config)?));
        }

        Err(anyhow!(
            "video provider type {:?} is not yet implemented",
            provider_type
        ))
    }
}
