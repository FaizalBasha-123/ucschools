use anyhow::{anyhow, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

use ai_tutor_domain::provider::ModelConfig;
use crate::traits::TtsProvider;

#[derive(Clone)]
pub struct ElevenLabsTtsProvider {
    model_config: ModelConfig,
    client: Client,
}

impl ElevenLabsTtsProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!("missing API key for ElevenLabs"));
        }

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()?;

        Ok(Self {
            model_config,
            client,
        })
    }

    fn endpoint(&self) -> String {
        let voice_id = &self.model_config.model_id;
        format!("https://api.elevenlabs.io/v1/text-to-speech/{}", voice_id)
    }
}

#[async_trait]
impl TtsProvider for ElevenLabsTtsProvider {
    async fn synthesize(
        &self,
        text: &str,
        _voice: Option<&str>,
        _speed: Option<f32>,
    ) -> Result<String> {
        let url = self.endpoint();
        
        let response = self.client.post(&url)
            .header("xi-api-key", &self.model_config.api_key)
            .json(&json!({
                "text": text,
                "model_id": "eleven_monolingual_v1",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75
                }
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("ElevenLabs TTS failed with status {}: {}", status, body));
        }

        let bytes = response.bytes().await?;
        
        // ElevenLabs returns raw audio bytes (usually MP3).
        // The synthesize trait expects a String return, which in this codebase usually means 
        // a data URL or a hosted URL. For parity with OpenAiCompatibleTtsProvider 
        // we'll return a data URL.
        
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        Ok(format!("data:audio/mpeg;base64,{}", b64))
    }
}
