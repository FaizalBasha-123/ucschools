use anyhow::{anyhow, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use ai_tutor_domain::{
    provider::{ModelConfig, ProviderType},
};

use crate::traits::{ImageProvider, LlmProvider, TtsProvider, VideoProvider};

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    model_config: ModelConfig,
}

impl OpenAiCompatibleProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!("missing API key for model {}", model_config.model_id));
        }

        Ok(Self {
            model_config,
        })
    }

    fn endpoint(&self) -> String {
        let base = self
            .model_config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        format!("{}/chat/completions", base.trim_end_matches('/'))
    }
}

#[derive(Clone)]
pub struct OpenAiCompatibleTtsProvider {
    model_config: ModelConfig,
}

impl OpenAiCompatibleTtsProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!("missing API key for model {}", model_config.model_id));
        }

        Ok(Self { model_config })
    }

    fn endpoint(&self) -> String {
        let base = self
            .model_config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        format!("{}/audio/speech", base.trim_end_matches('/'))
    }
}

#[derive(Clone)]
pub struct OpenAiCompatibleImageProvider {
    model_config: ModelConfig,
}

impl OpenAiCompatibleImageProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!("missing API key for model {}", model_config.model_id));
        }

        Ok(Self { model_config })
    }

    fn endpoint(&self) -> String {
        let base = self
            .model_config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        format!("{}/images/generations", base.trim_end_matches('/'))
    }
}

#[derive(Clone)]
pub struct OpenAiCompatibleVideoProvider {
    model_config: ModelConfig,
}

impl OpenAiCompatibleVideoProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!("missing API key for model {}", model_config.model_id));
        }

        Ok(Self { model_config })
    }

    fn endpoint(&self) -> String {
        let base = self
            .model_config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        format!("{}/videos/generations", base.trim_end_matches('/'))
    }
}

#[derive(Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
    response_format: ResponseFormat<'a>,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ResponseFormat<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: AssistantMessage,
}

#[derive(Deserialize)]
struct AssistantMessage {
    content: Value,
}

#[derive(Serialize)]
struct ImageGenerationRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    size: &'a str,
}

#[derive(Deserialize)]
struct ImageGenerationResponse {
    data: Vec<ImageGenerationData>,
}

#[derive(Deserialize)]
struct ImageGenerationData {
    #[serde(default)]
    b64_json: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[async_trait]
impl LlmProvider for OpenAiCompatibleProvider {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        let request = ChatCompletionRequest {
            model: &self.model_config.model_id,
            messages: vec![
                ChatMessage {
                    role: "system",
                    content: system_prompt,
                },
                ChatMessage {
                    role: "user",
                    content: user_prompt,
                },
            ],
            temperature: 0.2,
            response_format: ResponseFormat { kind: "json_object" },
        };

        let response = minreq::post(self.endpoint())
            .with_header("Authorization", &format!("Bearer {}", self.model_config.api_key))
            .with_header("Content-Type", "application/json")
            .with_json(&request)?
            .send()?;

        if response.status_code < 200 || response.status_code >= 300 {
            let status = response.status_code;
            let body = response.as_str().unwrap_or_default().to_string();
            return Err(anyhow!(
                "provider request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: ChatCompletionResponse = response.json()?;
        let content = body
            .choices
            .into_iter()
            .next()
            .map(|choice| extract_content(choice.message.content))
            .ok_or_else(|| anyhow!("provider returned no choices"))?;

        Ok(content)
    }
}

pub fn supports_openai_compatible(provider_type: &ProviderType) -> bool {
    matches!(provider_type, ProviderType::OpenAi)
}

#[derive(Serialize)]
struct TtsRequest<'a> {
    model: &'a str,
    input: &'a str,
    voice: &'a str,
    response_format: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<f32>,
}

#[async_trait]
impl TtsProvider for OpenAiCompatibleTtsProvider {
    async fn synthesize(
        &self,
        text: &str,
        voice: Option<&str>,
        speed: Option<f32>,
    ) -> Result<String> {
        let request = TtsRequest {
            model: &self.model_config.model_id,
            input: text,
            voice: voice.unwrap_or("alloy"),
            response_format: "mp3",
            speed,
        };

        let response = minreq::post(self.endpoint())
            .with_header("Authorization", &format!("Bearer {}", self.model_config.api_key))
            .with_header("Content-Type", "application/json")
            .with_json(&request)?
            .send()?;

        if response.status_code < 200 || response.status_code >= 300 {
            let status = response.status_code;
            let body = response.as_str().unwrap_or_default().to_string();
            return Err(anyhow!(
                "tts request failed with status {}: {}",
                status,
                body
            ));
        }

        let audio = response.as_bytes();
        let encoded = STANDARD.encode(audio);
        Ok(format!("data:audio/mpeg;base64,{}", encoded))
    }
}

#[async_trait]
impl ImageProvider for OpenAiCompatibleImageProvider {
    async fn generate_image(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let size = image_size_for_aspect_ratio(aspect_ratio);
        let request = ImageGenerationRequest {
            model: &self.model_config.model_id,
            prompt,
            size,
        };

        let response = minreq::post(self.endpoint())
            .with_header("Authorization", &format!("Bearer {}", self.model_config.api_key))
            .with_header("Content-Type", "application/json")
            .with_json(&request)?
            .send()?;

        if response.status_code < 200 || response.status_code >= 300 {
            let status = response.status_code;
            let body = response.as_str().unwrap_or_default().to_string();
            return Err(anyhow!(
                "image generation request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: ImageGenerationResponse = response.json()?;
        let asset = body
            .data
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("image provider returned no assets"))?;

        if let Some(encoded) = asset.b64_json {
            return Ok(format!("data:image/png;base64,{}", encoded));
        }

        asset
            .url
            .ok_or_else(|| anyhow!("image provider returned no image payload"))
    }
}

#[async_trait]
impl VideoProvider for OpenAiCompatibleVideoProvider {
    async fn generate_video(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let size = image_size_for_aspect_ratio(aspect_ratio);
        let request = ImageGenerationRequest {
            model: &self.model_config.model_id,
            prompt,
            size,
        };

        let response = minreq::post(self.endpoint())
            .with_header("Authorization", &format!("Bearer {}", self.model_config.api_key))
            .with_header("Content-Type", "application/json")
            .with_json(&request)?
            .send()?;

        if response.status_code < 200 || response.status_code >= 300 {
            let status = response.status_code;
            let body = response.as_str().unwrap_or_default().to_string();
            return Err(anyhow!(
                "video generation request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: ImageGenerationResponse = response.json()?;
        let asset = body
            .data
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("video provider returned no assets"))?;

        if let Some(encoded) = asset.b64_json {
            return Ok(format!("data:video/mp4;base64,{}", encoded));
        }

        asset
            .url
            .ok_or_else(|| anyhow!("video provider returned no video payload"))
    }
}

fn extract_content(value: Value) -> String {
    match value {
        Value::String(text) => text,
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| {
                let object = item.as_object()?;
                if object.get("type")?.as_str()? == "text" {
                    object.get("text")?.as_str().map(ToOwned::to_owned)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        other => other.to_string(),
    }
}

fn image_size_for_aspect_ratio(aspect_ratio: Option<&str>) -> &'static str {
    match aspect_ratio.unwrap_or("1:1").trim() {
        "16:9" => "1536x1024",
        "9:16" => "1024x1536",
        "4:3" => "1536x1024",
        "3:4" => "1024x1536",
        _ => "1024x1024",
    }
}
