use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::Deserialize;

use ai_tutor_domain::provider::ModelConfig;

use crate::traits::AsrProvider;

/// OpenAI Whisper-compatible ASR (Automatic Speech Recognition) provider.
///
/// Sends audio data to the `/audio/transcriptions` endpoint and returns
/// the transcribed text.
#[derive(Clone)]
pub struct OpenAiCompatibleAsrProvider {
    model_config: ModelConfig,
    client: reqwest::Client,
}

impl OpenAiCompatibleAsrProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!("missing API key for ASR model {}", model_config.model_id));
        }

        Ok(Self {
            model_config,
            client: reqwest::Client::new(),
        })
    }

    fn endpoint(&self) -> String {
        let base = self
            .model_config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        format!("{}/audio/transcriptions", base.trim_end_matches('/'))
    }
}

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

#[async_trait]
impl AsrProvider for OpenAiCompatibleAsrProvider {
    async fn transcribe(&self, audio_bytes: &[u8], content_type: &str) -> Result<String> {
        let extension = match content_type {
            "audio/webm" => "webm",
            "audio/ogg" => "ogg",
            "audio/mp4" => "mp4",
            "audio/mpeg" | "audio/mp3" => "mp3",
            "audio/wav" | "audio/wave" => "wav",
            "audio/flac" => "flac",
            _ => "webm",
        };
        let filename = format!("audio.{}", extension);

        // Use reqwest multipart form for clean, async file upload
        let file_part = reqwest::multipart::Part::bytes(audio_bytes.to_vec())
            .file_name(filename)
            .mime_str(content_type)?;

        let form = reqwest::multipart::Form::new()
            .text("model", self.model_config.model_id.clone())
            .text("response_format", "json")
            .part("file", file_part);

        let response = self
            .client
            .post(self.endpoint())
            .header(
                "Authorization",
                format!("Bearer {}", self.model_config.api_key),
            )
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "ASR transcription request failed with status {}: {}",
                status,
                body
            ));
        }

        let parsed: TranscriptionResponse = response.json().await?;
        Ok(parsed.text)
    }
}
