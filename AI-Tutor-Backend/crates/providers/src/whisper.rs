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
}

impl OpenAiCompatibleAsrProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!("missing API key for ASR model {}", model_config.model_id));
        }

        Ok(Self { model_config })
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

        // Build multipart form body manually for minreq
        let boundary = format!("----FormBoundary{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let mut body = Vec::new();

        // Model field
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"model\"\r\n\r\n");
        body.extend_from_slice(self.model_config.model_id.as_bytes());
        body.extend_from_slice(b"\r\n");

        // File field
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
                filename
            )
            .as_bytes(),
        );
        body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());
        body.extend_from_slice(audio_bytes);
        body.extend_from_slice(b"\r\n");

        // Response format field
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"response_format\"\r\n\r\n");
        body.extend_from_slice(b"json");
        body.extend_from_slice(b"\r\n");

        // Closing boundary
        body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

        let response = minreq::post(self.endpoint())
            .with_header(
                "Authorization",
                &format!("Bearer {}", self.model_config.api_key),
            )
            .with_header(
                "Content-Type",
                &format!("multipart/form-data; boundary={}", boundary),
            )
            .with_body(body)
            .send()?;

        if response.status_code < 200 || response.status_code >= 300 {
            let status = response.status_code;
            let body = response.as_str().unwrap_or_default().to_string();
            return Err(anyhow!(
                "ASR transcription request failed with status {}: {}",
                status,
                body
            ));
        }

        let parsed: TranscriptionResponse = response.json()?;
        Ok(parsed.text)
    }
}
