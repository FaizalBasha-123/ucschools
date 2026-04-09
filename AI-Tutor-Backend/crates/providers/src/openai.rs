use anyhow::{anyhow, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

use ai_tutor_domain::provider::{ModelConfig, ProviderType};

use crate::traits::{
    ImageProvider, LlmProvider, ProviderCapabilities, ProviderStreamEvent, ProviderToolCall,
    ProviderUsage, ProviderUsageSource, StreamingPath, TtsProvider, VideoProvider,
};

// ────────────────────────────────────────────────────────────
// Provider structs (unchanged)
// ────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    model_config: ModelConfig,
    client: reqwest::Client,
}

impl OpenAiCompatibleProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!(
                "missing API key for model {}",
                model_config.model_id
            ));
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
        format!("{}/chat/completions", base.trim_end_matches('/'))
    }

    fn build_messages_from_history<'a>(
        &'a self,
        messages: &'a [(String, String)],
    ) -> Vec<ChatMessage<'a>> {
        messages
            .iter()
            .filter_map(|(role, content)| match role.as_str() {
                "system" => Some(ChatMessage {
                    role: "system",
                    content: content.as_str(),
                }),
                "user" => Some(ChatMessage {
                    role: "user",
                    content: content.as_str(),
                }),
                "assistant" => Some(ChatMessage {
                    role: "assistant",
                    content: content.as_str(),
                }),
                _ => None,
            })
            .collect()
    }

    async fn stream_openai_chat_completions(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<(String, Option<ProviderUsage>)> {
        let provider_messages = self.build_messages_from_history(messages);
        if provider_messages.is_empty() {
            return Err(anyhow!(
                "openai-compatible streaming request requires at least one message"
            ));
        }

        let request = ChatCompletionRequest {
            model: &self.model_config.model_id,
            messages: provider_messages,
            temperature: 0.2,
            stream: Some(true),
            stream_options: Some(OpenAiStreamOptions {
                include_usage: true,
            }),
        };

        let response = self
            .client
            .post(self.endpoint())
            .header(
                "Authorization",
                format!("Bearer {}", self.model_config.api_key),
            )
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "streaming request failed with status {}: {}",
                status,
                body
            ));
        }

        let mut full_text = String::new();
        let mut byte_stream = response.bytes_stream();
        let mut line_buffer = String::new();
        let mut tool_assemblies: HashMap<usize, ToolCallAssembly> = HashMap::new();
        let mut responses_tool_assemblies: HashMap<String, ResponsesToolAssembly> = HashMap::new();
        let mut stream_state = OpenAiStreamAccumulator::default();
        let mut done_received = false;

        loop {
            if done_received {
                break;
            }
            let chunk_result = tokio::select! {
                _ = cancellation.cancelled() => {
                    return Err(anyhow!("stream cancelled"));
                }
                maybe_chunk = byte_stream.next() => maybe_chunk,
            };

            let Some(chunk_result) = chunk_result else {
                break;
            };
            let chunk = chunk_result?;
            let chunk_str = String::from_utf8_lossy(&chunk);
            line_buffer.push_str(&chunk_str);

            while let Some(newline_pos) = line_buffer.find('\n') {
                let line = line_buffer[..newline_pos].trim().to_string();
                line_buffer = line_buffer[newline_pos + 1..].to_string();
                if process_openai_sse_line(
                    &line,
                    &mut full_text,
                    &mut tool_assemblies,
                    &mut responses_tool_assemblies,
                    &mut stream_state,
                    on_event,
                ) {
                    done_received = true;
                    break;
                }
            }
        }

        if !done_received {
            for line in line_buffer.lines() {
                let line = line.trim();
                if process_openai_sse_line(
                    line,
                    &mut full_text,
                    &mut tool_assemblies,
                    &mut responses_tool_assemblies,
                    &mut stream_state,
                    on_event,
                ) {
                    break;
                }
            }
        }

        Ok((full_text, stream_state.usage))
    }
}

#[derive(Clone)]
pub struct OpenAiCompatibleTtsProvider {
    model_config: ModelConfig,
    client: reqwest::Client,
}

impl OpenAiCompatibleTtsProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!(
                "missing API key for model {}",
                model_config.model_id
            ));
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
        format!("{}/audio/speech", base.trim_end_matches('/'))
    }
}

#[derive(Clone)]
pub struct OpenAiCompatibleImageProvider {
    model_config: ModelConfig,
    client: reqwest::Client,
}

impl OpenAiCompatibleImageProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!(
                "missing API key for model {}",
                model_config.model_id
            ));
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
        format!("{}/images/generations", base.trim_end_matches('/'))
    }
}

#[derive(Clone)]
pub struct OpenAiCompatibleVideoProvider {
    model_config: ModelConfig,
    client: reqwest::Client,
}

impl OpenAiCompatibleVideoProvider {
    pub fn new(model_config: ModelConfig) -> Result<Self> {
        if model_config.api_key.is_empty() {
            return Err(anyhow!(
                "missing API key for model {}",
                model_config.model_id
            ));
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
        format!("{}/videos/generations", base.trim_end_matches('/'))
    }

    fn base_url(&self) -> String {
        self.model_config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string())
            .trim_end_matches('/')
            .to_string()
    }

    fn build_poll_urls(&self, task_id: &str) -> Vec<String> {
        let base = self.base_url();
        vec![
            format!("{}/videos/generations/{}", base, task_id),
            format!("{}/videos/{}", base, task_id),
            format!("{}/video_generations/{}", base, task_id),
            format!("{}/query/video_generation?task_id={}", base, task_id),
        ]
    }
}

// ────────────────────────────────────────────────────────────
// Request / Response types
// ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<OpenAiStreamOptions>,
}

#[derive(Serialize)]
struct OpenAiStreamOptions {
    include_usage: bool,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize, Debug)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize, Debug, Clone)]
struct OpenAiUsage {
    #[serde(default)]
    prompt_tokens: Option<u64>,
    #[serde(default)]
    completion_tokens: Option<u64>,
    #[serde(default)]
    total_tokens: Option<u64>,
}

#[derive(Deserialize, Debug)]
struct Choice {
    #[serde(default)]
    message: Option<AssistantMessage>,
    #[serde(default)]
    delta: Option<AssistantMessage>,
}

#[derive(Deserialize, Debug)]
struct AssistantMessage {
    #[serde(default)]
    content: Option<Value>,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAiToolCallDelta>>,
}

#[derive(Deserialize, Debug, Clone)]
struct OpenAiToolCallDelta {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    function: Option<OpenAiFunctionDelta>,
}

#[derive(Deserialize, Debug, Clone)]
struct OpenAiFunctionDelta {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<OpenAiToolArgumentsDelta>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(untagged)]
enum OpenAiToolArgumentsDelta {
    String(String),
    Json(Value),
}

#[derive(Debug, Clone, Default)]
struct ToolCallAssembly {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
    last_emitted_arguments: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ResponsesToolAssembly {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
    last_emitted_arguments: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct OpenAiStreamAccumulator {
    usage: Option<ProviderUsage>,
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

// ────────────────────────────────────────────────────────────
// LLM Provider — generate_text (non-streaming, async reqwest)
//                generate_text_stream (TRUE native SSE streaming)
// ────────────────────────────────────────────────────────────

#[async_trait]
impl LlmProvider for OpenAiCompatibleProvider {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.generate_text_with_history(&[
            ("system".to_string(), system_prompt.to_string()),
            ("user".to_string(), user_prompt.to_string()),
        ])
        .await
    }

    async fn generate_text_with_usage(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        self.generate_text_with_history_and_usage(&[
            ("system".to_string(), system_prompt.to_string()),
            ("user".to_string(), user_prompt.to_string()),
        ])
        .await
    }

    async fn generate_text_with_history(&self, messages: &[(String, String)]) -> Result<String> {
        let provider_messages = self.build_messages_from_history(messages);
        if provider_messages.is_empty() {
            return Err(anyhow!(
                "openai-compatible request requires at least one message"
            ));
        }

        let request = ChatCompletionRequest {
            model: &self.model_config.model_id,
            messages: provider_messages,
            temperature: 0.2,
            stream: None,
            stream_options: None,
        };

        let response = self
            .client
            .post(self.endpoint())
            .header(
                "Authorization",
                format!("Bearer {}", self.model_config.api_key),
            )
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "provider request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: ChatCompletionResponse = response.json().await?;
        let content = body
            .choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message)
            .and_then(|msg| msg.content)
            .map(extract_content)
            .ok_or_else(|| anyhow!("provider returned no choices"))?;

        Ok(content)
    }

    async fn generate_text_with_history_and_usage(
        &self,
        messages: &[(String, String)],
    ) -> Result<(String, Option<ProviderUsage>)> {
        let provider_messages = self.build_messages_from_history(messages);
        if provider_messages.is_empty() {
            return Err(anyhow!(
                "openai-compatible request requires at least one message"
            ));
        }

        let request = ChatCompletionRequest {
            model: &self.model_config.model_id,
            messages: provider_messages,
            temperature: 0.2,
            stream: None,
            stream_options: None,
        };

        let response = self
            .client
            .post(self.endpoint())
            .header(
                "Authorization",
                format!("Bearer {}", self.model_config.api_key),
            )
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "provider request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: ChatCompletionResponse = response.json().await?;
        let usage = body.usage.and_then(openai_usage_to_provider_usage);
        let content = body
            .choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message)
            .and_then(|msg| msg.content)
            .map(extract_content)
            .ok_or_else(|| anyhow!("provider returned no choices"))?;

        Ok((content, usage))
    }

    /// True native SSE streaming over TCP.
    ///
    /// Sends `stream: true` to the provider, then reads each SSE `data:` line
    /// as it arrives over the wire. Each delta token is immediately forwarded
    /// via `on_delta`, achieving near-zero Time-To-First-Byte.
    async fn generate_text_stream(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.generate_text_stream_with_history(
            &[
                ("system".to_string(), system_prompt.to_string()),
                ("user".to_string(), user_prompt.to_string()),
            ],
            on_delta,
        )
        .await
    }

    async fn generate_text_stream_with_history(
        &self,
        messages: &[(String, String)],
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let cancellation = CancellationToken::new();
        self.generate_text_stream_with_history_cancellable(messages, &cancellation, on_delta)
            .await
    }

    async fn generate_text_stream_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.stream_openai_chat_completions(messages, cancellation, &mut |event| {
            if let ProviderStreamEvent::TextDelta(text) = event {
                on_delta(text);
            }
        })
        .await
        .map(|(full_text, _usage)| full_text)
    }

    async fn generate_stream_events_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<String> {
        let (full_text, usage) = self
            .stream_openai_chat_completions(messages, cancellation, &mut |event| on_event(event))
            .await?;
        on_event(ProviderStreamEvent::Done {
            full_text: full_text.clone(),
            usage,
        });
        Ok(full_text)
    }

    fn streaming_path(&self) -> StreamingPath {
        StreamingPath::Native
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities::native_text_and_typed()
    }
}

pub fn supports_openai_compatible(provider_type: &ProviderType) -> bool {
    matches!(provider_type, ProviderType::OpenAi)
}

// ────────────────────────────────────────────────────────────
// TTS Provider (async reqwest)
// ────────────────────────────────────────────────────────────

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

        let response = self
            .client
            .post(self.endpoint())
            .header(
                "Authorization",
                format!("Bearer {}", self.model_config.api_key),
            )
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "tts request failed with status {}: {}",
                status,
                body
            ));
        }

        let audio = response.bytes().await?;
        let encoded = STANDARD.encode(&audio);
        Ok(format!("data:audio/mpeg;base64,{}", encoded))
    }
}

// ────────────────────────────────────────────────────────────
// Image Provider (async reqwest)
// ────────────────────────────────────────────────────────────

#[async_trait]
impl ImageProvider for OpenAiCompatibleImageProvider {
    async fn generate_image(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let size = image_size_for_aspect_ratio(aspect_ratio);
        let request = ImageGenerationRequest {
            model: &self.model_config.model_id,
            prompt,
            size,
        };

        let response = self
            .client
            .post(self.endpoint())
            .header(
                "Authorization",
                format!("Bearer {}", self.model_config.api_key),
            )
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "image generation request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: ImageGenerationResponse = response.json().await?;
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

// ────────────────────────────────────────────────────────────
// Video Provider (async reqwest)
// ────────────────────────────────────────────────────────────

#[async_trait]
impl VideoProvider for OpenAiCompatibleVideoProvider {
    async fn generate_video(&self, prompt: &str, aspect_ratio: Option<&str>) -> Result<String> {
        let size = image_size_for_aspect_ratio(aspect_ratio);
        let request = ImageGenerationRequest {
            model: &self.model_config.model_id,
            prompt,
            size,
        };

        let response = self
            .client
            .post(self.endpoint())
            .header(
                "Authorization",
                format!("Bearer {}", self.model_config.api_key),
            )
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "video generation request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: Value = response.json().await?;
        if let Some(url) = extract_video_url_from_value(&body) {
            return Ok(url);
        }
        if let Some(task_id) = extract_task_id_from_value(&body) {
            return poll_video_task_until_ready(self, &task_id).await;
        }

        Err(anyhow!(
            "video provider returned neither immediate media payload nor task id: {}",
            body
        ))
    }
}

const VIDEO_POLL_MAX_ATTEMPTS: usize = 60;
const VIDEO_POLL_INTERVAL_MS: u64 = 2_000;

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

fn extract_content(value: Value) -> String {
    match value {
        Value::String(text) => text,
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| {
                let object = item.as_object()?;
                let item_type = object.get("type").and_then(|value| value.as_str());
                match item_type {
                    Some("text") | Some("output_text") | Some("input_text") => object
                        .get("text")
                        .or_else(|| object.get("content"))
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                    _ => object
                        .get("content")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned),
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        other => other.to_string(),
    }
}

fn process_openai_sse_line(
    line: &str,
    full_text: &mut String,
    tool_assemblies: &mut HashMap<usize, ToolCallAssembly>,
    responses_tool_assemblies: &mut HashMap<String, ResponsesToolAssembly>,
    stream_state: &mut OpenAiStreamAccumulator,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) -> bool {
    if line.is_empty() {
        return false;
    }
    let Some(data) = line.strip_prefix("data: ") else {
        return false;
    };
    let data = data.trim();
    if data == "[DONE]" {
        return true;
    }

    let Ok(raw) = serde_json::from_str::<Value>(data) else {
        return false;
    };

    if process_openai_responses_event(
        &raw,
        full_text,
        responses_tool_assemblies,
        stream_state,
        on_event,
    ) {
        return true;
    }

    let Ok(chunk_response) = serde_json::from_value::<ChatCompletionResponse>(raw) else {
        return false;
    };
    if let Some(usage) = chunk_response.usage.and_then(openai_usage_to_provider_usage) {
        stream_state.usage = Some(usage);
    }

    for choice in chunk_response.choices {
        if let Some(delta) = choice.delta {
            if let Some(content_val) = delta.content {
                let token = extract_content(content_val);
                if !token.is_empty() {
                    full_text.push_str(&token);
                    on_event(ProviderStreamEvent::TextDelta(token));
                }
            }
            if let Some(tool_calls) = delta.tool_calls {
                for call in tool_calls {
                    ingest_tool_call_delta(call, tool_assemblies, on_event);
                }
            }
        }
        if let Some(message) = choice.message {
            if let Some(content_val) = message.content {
                let token = extract_content(content_val);
                if !token.is_empty() {
                    full_text.push_str(&token);
                    on_event(ProviderStreamEvent::TextDelta(token));
                }
            }
            if let Some(tool_calls) = message.tool_calls {
                for call in tool_calls {
                    ingest_tool_call_delta(call, tool_assemblies, on_event);
                }
            }
        }
    }
    false
}

fn process_openai_responses_event(
    raw: &Value,
    full_text: &mut String,
    tool_assemblies: &mut HashMap<String, ResponsesToolAssembly>,
    stream_state: &mut OpenAiStreamAccumulator,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) -> bool {
    let event_type = raw.get("type").and_then(Value::as_str).unwrap_or_default();
    if event_type.is_empty() {
        return false;
    }
    match event_type {
        "response.output_text.delta" => {
            if let Some(delta) = raw.get("delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    full_text.push_str(delta);
                    on_event(ProviderStreamEvent::TextDelta(delta.to_string()));
                }
            }
            false
        }
        "response.function_call_arguments.delta" => {
            ingest_responses_tool_call_delta(raw, tool_assemblies, on_event);
            false
        }
        "response.function_call_arguments.done" => {
            ingest_responses_tool_call_done(raw, tool_assemblies, on_event);
            false
        }
        "response.completed" => {
            if let Some(usage) = raw
                .get("response")
                .and_then(|response| response.get("usage"))
                .cloned()
                .and_then(openai_usage_value_to_provider_usage)
            {
                stream_state.usage = Some(usage);
            }
            true
        }
        _ => false,
    }
}

fn responses_tool_key(raw: &Value) -> String {
    raw.get("call_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            raw.get("item_id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            raw.get("output_index")
                .and_then(Value::as_u64)
                .map(|index| format!("output-{index}"))
        })
        .unwrap_or_else(|| "output-0".to_string())
}

fn ingest_responses_tool_call_delta(
    raw: &Value,
    tool_assemblies: &mut HashMap<String, ResponsesToolAssembly>,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) {
    let key = responses_tool_key(raw);
    let entry = tool_assemblies.entry(key).or_default();
    if entry.id.is_none() {
        entry.id = raw
            .get("call_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
    }
    if entry.name.is_none() {
        entry.name = raw
            .get("name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
    }
    if let Some(delta) = raw.get("delta").and_then(Value::as_str) {
        entry.arguments.push_str(delta);
    }
    maybe_emit_responses_tool_call(entry, on_event);
}

fn ingest_responses_tool_call_done(
    raw: &Value,
    tool_assemblies: &mut HashMap<String, ResponsesToolAssembly>,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) {
    let key = responses_tool_key(raw);
    let entry = tool_assemblies.entry(key).or_default();
    if entry.id.is_none() {
        entry.id = raw
            .get("call_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
    }
    if entry.name.is_none() {
        entry.name = raw
            .get("name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
    }
    if let Some(arguments) = raw.get("arguments") {
        match arguments {
            Value::String(text) => {
                if !text.is_empty() {
                    entry.arguments = text.clone();
                }
            }
            other => {
                entry.arguments = other.to_string();
            }
        }
    }
    maybe_emit_responses_tool_call(entry, on_event);
}

fn maybe_emit_responses_tool_call(
    entry: &mut ResponsesToolAssembly,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) {
    let Some(name) = entry.name.clone() else {
        return;
    };
    if entry.arguments.trim().is_empty() {
        return;
    }
    if entry
        .last_emitted_arguments
        .as_ref()
        .is_some_and(|last| last == &entry.arguments)
    {
        return;
    }
    if let Ok(arguments) = serde_json::from_str::<Value>(&entry.arguments) {
        entry.last_emitted_arguments = Some(entry.arguments.clone());
        on_event(ProviderStreamEvent::ToolCall(ProviderToolCall {
            id: entry.id.clone(),
            name,
            arguments,
        }));
    }
}

fn openai_usage_to_provider_usage(usage: OpenAiUsage) -> Option<ProviderUsage> {
    let input_tokens = usage.prompt_tokens.unwrap_or(0);
    let output_tokens = usage.completion_tokens.unwrap_or(0);
    let total_tokens = usage
        .total_tokens
        .or_else(|| Some(input_tokens.saturating_add(output_tokens)));
    if input_tokens == 0 && output_tokens == 0 && total_tokens.unwrap_or(0) == 0 {
        return None;
    }
    Some(ProviderUsage {
        input_tokens,
        output_tokens,
        total_tokens,
        source: ProviderUsageSource::ProviderReported,
    })
}

fn openai_usage_value_to_provider_usage(value: Value) -> Option<ProviderUsage> {
    let usage = serde_json::from_value::<OpenAiUsage>(value).ok()?;
    openai_usage_to_provider_usage(usage)
}

fn ingest_tool_call_delta(
    delta: OpenAiToolCallDelta,
    tool_assemblies: &mut HashMap<usize, ToolCallAssembly>,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) {
    let index = delta.index.unwrap_or(0);
    let entry = tool_assemblies.entry(index).or_default();
    if entry.id.is_none() {
        entry.id = delta.id.clone();
    }
    if let Some(function) = delta.function {
        if entry.name.is_none() {
            entry.name = function.name.clone();
        }
        if let Some(arguments_delta) = function.arguments {
            match arguments_delta {
                OpenAiToolArgumentsDelta::String(text) => entry.arguments.push_str(&text),
                OpenAiToolArgumentsDelta::Json(value) => {
                    entry.arguments.push_str(&value.to_string())
                }
            }
        }
    }

    maybe_emit_tool_call(entry, on_event);
}

fn maybe_emit_tool_call(
    entry: &mut ToolCallAssembly,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) {
    let Some(name) = entry.name.clone() else {
        return;
    };
    if entry.arguments.trim().is_empty() {
        return;
    }
    if entry
        .last_emitted_arguments
        .as_ref()
        .is_some_and(|last| last == &entry.arguments)
    {
        return;
    }

    if let Ok(arguments) = serde_json::from_str::<Value>(&entry.arguments) {
        entry.last_emitted_arguments = Some(entry.arguments.clone());
        on_event(ProviderStreamEvent::ToolCall(ProviderToolCall {
            id: entry.id.clone(),
            name,
            arguments,
        }));
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

async fn poll_video_task_until_ready(
    provider: &OpenAiCompatibleVideoProvider,
    task_id: &str,
) -> Result<String> {
    let poll_urls = provider.build_poll_urls(task_id);
    let auth_header = format!("Bearer {}", provider.model_config.api_key);
    let mut last_status = String::new();

    for _ in 0..VIDEO_POLL_MAX_ATTEMPTS {
        for url in &poll_urls {
            let response = provider
                .client
                .get(url)
                .header("Authorization", &auth_header)
                .send()
                .await;

            let Ok(response) = response else {
                continue;
            };
            if !response.status().is_success() {
                continue;
            }

            let body: Value = response.json().await?;
            if let Some(url) = extract_video_url_from_value(&body) {
                return Ok(url);
            }
            if let Some(status) = extract_task_status_from_value(&body) {
                let normalized = normalize_task_status(&status);
                last_status = normalized.clone();
                if is_success_status(&normalized) {
                    if let Some(file_id) = extract_file_id_from_value(&body) {
                        if let Ok(url) = retrieve_video_file_url(provider, &file_id).await {
                            return Ok(url);
                        }
                    }
                }
                if is_failure_status(&normalized) {
                    return Err(anyhow!(
                        "video generation task {} failed with status '{}': {}",
                        task_id,
                        normalized,
                        body
                    ));
                }
            }
        }
        sleep(Duration::from_millis(VIDEO_POLL_INTERVAL_MS)).await;
    }

    Err(anyhow!(
        "video generation task {} timed out after {}s (last_status={})",
        task_id,
        (VIDEO_POLL_MAX_ATTEMPTS as u64 * VIDEO_POLL_INTERVAL_MS) / 1000,
        if last_status.is_empty() {
            "unknown"
        } else {
            last_status.as_str()
        }
    ))
}

fn extract_video_url_from_value(value: &Value) -> Option<String> {
    if let Some(encoded) = find_string_by_key_recursive(value, "b64_json") {
        return Some(format!("data:video/mp4;base64,{}", encoded));
    }

    for key in ["url", "video_url", "download_url", "file_url", "uri"] {
        if let Some(url) = find_string_by_key_recursive(value, key).filter(|v| !v.is_empty()) {
            if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("data:")
            {
                return Some(url);
            }
        }
    }
    None
}

fn extract_task_id_from_value(value: &Value) -> Option<String> {
    for key in ["task_id", "request_id", "job_id", "id"] {
        if let Some(task_id) = find_string_by_key_recursive(value, key).filter(|v| !v.is_empty()) {
            return Some(task_id);
        }
    }
    None
}

fn extract_task_status_from_value(value: &Value) -> Option<String> {
    for key in ["status", "state", "task_status"] {
        if let Some(status) = find_string_by_key_recursive(value, key).filter(|v| !v.is_empty()) {
            return Some(status);
        }
    }
    None
}

fn extract_file_id_from_value(value: &Value) -> Option<String> {
    for key in ["file_id", "video_id", "asset_id", "id"] {
        if let Some(file_id) = find_string_by_key_recursive(value, key).filter(|v| !v.is_empty()) {
            return Some(file_id);
        }
    }
    None
}

fn find_string_by_key_recursive(value: &Value, key: &str) -> Option<String> {
    match value {
        Value::Object(map) => {
            if let Some(raw) = map.get(key) {
                if let Some(text) = raw.as_str() {
                    return Some(text.to_string());
                }
                if let Some(number) = raw.as_i64() {
                    return Some(number.to_string());
                }
                if let Some(number) = raw.as_u64() {
                    return Some(number.to_string());
                }
            }
            for nested in map.values() {
                if let Some(found) = find_string_by_key_recursive(nested, key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_string_by_key_recursive(item, key)),
        _ => None,
    }
}

fn normalize_task_status(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn is_failure_status(status: &str) -> bool {
    matches!(
        status,
        "failed" | "failure" | "error" | "cancelled" | "canceled" | "rejected" | "fail"
    )
}

fn is_success_status(status: &str) -> bool {
    matches!(status, "success" | "succeeded" | "completed" | "done")
}

async fn retrieve_video_file_url(
    provider: &OpenAiCompatibleVideoProvider,
    file_id: &str,
) -> Result<String> {
    let base = provider.base_url();
    let candidate_urls = vec![
        format!("{}/v1/files/retrieve?file_id={}", base, file_id),
        format!("{}/files/retrieve?file_id={}", base, file_id),
        format!("{}/files/{}", base, file_id),
    ];

    for url in candidate_urls {
        let response = provider
            .client
            .get(&url)
            .header(
                "Authorization",
                format!("Bearer {}", provider.model_config.api_key),
            )
            .send()
            .await;

        let Ok(response) = response else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let body: Value = response.json().await?;
        if let Some(download_url) = extract_video_url_from_value(&body) {
            return Ok(download_url);
        }
    }

    Err(anyhow!(
        "video file retrieval returned no downloadable url for file_id={}",
        file_id
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        extract_file_id_from_value, extract_task_id_from_value, extract_task_status_from_value,
        extract_video_url_from_value, ingest_tool_call_delta, is_failure_status,
        is_success_status, normalize_task_status, process_openai_sse_line,
        OpenAiFunctionDelta, OpenAiStreamAccumulator, OpenAiToolArgumentsDelta,
        OpenAiToolCallDelta, ResponsesToolAssembly, ToolCallAssembly,
    };
    use crate::traits::ProviderStreamEvent;
    use std::collections::HashMap;

    #[test]
    fn extracts_immediate_video_url_from_nested_payload() {
        let payload = json!({
            "data": {
                "result": {
                    "video_url": "https://cdn.example.test/video.mp4"
                }
            }
        });
        let extracted = extract_video_url_from_value(&payload);
        assert_eq!(
            extracted.as_deref(),
            Some("https://cdn.example.test/video.mp4")
        );
    }

    #[test]
    fn extracts_video_task_id_and_status_from_async_payload() {
        let payload = json!({
            "request_id": "req-123",
            "data": {
                "status": "Processing"
            }
        });
        assert_eq!(
            extract_task_id_from_value(&payload).as_deref(),
            Some("req-123")
        );
        assert_eq!(
            normalize_task_status(
                extract_task_status_from_value(&payload)
                    .as_deref()
                    .unwrap_or_default()
            ),
            "processing"
        );
    }

    #[test]
    fn failure_status_detection_covers_common_async_provider_states() {
        assert!(is_failure_status("failed"));
        assert!(is_failure_status("error"));
        assert!(is_failure_status("cancelled"));
        assert!(!is_failure_status("processing"));
        assert!(!is_failure_status("succeeded"));
    }

    #[test]
    fn extracts_file_id_from_nested_payload() {
        let payload = json!({
            "data": {
                "output": {
                    "file_id": "file-xyz"
                }
            }
        });
        assert_eq!(
            extract_file_id_from_value(&payload).as_deref(),
            Some("file-xyz")
        );
    }

    #[test]
    fn success_status_detection_covers_common_async_provider_states() {
        assert!(is_success_status("success"));
        assert!(is_success_status("completed"));
        assert!(is_success_status("done"));
        assert!(!is_success_status("processing"));
        assert!(!is_success_status("failed"));
    }

    #[test]
    fn assembles_streamed_tool_call_arguments_and_emits_once_per_state() {
        let mut assemblies: HashMap<usize, ToolCallAssembly> = HashMap::new();
        let mut emitted = Vec::new();

        ingest_tool_call_delta(
            OpenAiToolCallDelta {
                id: Some("call-1".to_string()),
                index: Some(0),
                function: Some(OpenAiFunctionDelta {
                    name: Some("wb_draw_text".to_string()),
                    arguments: Some(OpenAiToolArgumentsDelta::String(
                        "{\"content\":\"hel".to_string(),
                    )),
                }),
            },
            &mut assemblies,
            &mut |event| {
                if let ProviderStreamEvent::ToolCall(call) = event {
                    emitted.push(call);
                }
            },
        );
        assert!(emitted.is_empty());

        ingest_tool_call_delta(
            OpenAiToolCallDelta {
                id: Some("call-1".to_string()),
                index: Some(0),
                function: Some(OpenAiFunctionDelta {
                    name: None,
                    arguments: Some(OpenAiToolArgumentsDelta::String(
                        "lo\",\"x\":10,\"y\":20}".to_string(),
                    )),
                }),
            },
            &mut assemblies,
            &mut |event| {
                if let ProviderStreamEvent::ToolCall(call) = event {
                    emitted.push(call);
                }
            },
        );

        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].name, "wb_draw_text");
        assert_eq!(emitted[0].arguments["content"], "hello");
    }

    #[test]
    fn process_sse_line_emits_text_and_tool_calls() {
        let mut full_text = String::new();
        let mut assemblies: HashMap<usize, ToolCallAssembly> = HashMap::new();
        let mut responses_assemblies: HashMap<String, ResponsesToolAssembly> = HashMap::new();
        let mut stream_state = OpenAiStreamAccumulator::default();
        let mut emitted_text: Vec<String> = Vec::new();
        let mut emitted_tools = Vec::new();

        let line = r#"data: {"choices":[{"delta":{"content":"Hi ","tool_calls":[{"id":"call-2","index":0,"function":{"name":"wb_open","arguments":"{}"}}]}}]}"#;
        let done =
            process_openai_sse_line(
                line,
                &mut full_text,
                &mut assemblies,
                &mut responses_assemblies,
                &mut stream_state,
                &mut |event| match event {
                    ProviderStreamEvent::TextDelta(text) => emitted_text.push(text),
                    ProviderStreamEvent::ToolCall(tool) => emitted_tools.push(tool),
                    ProviderStreamEvent::Done { .. } => {}
                },
            );

        assert!(!done);
        assert_eq!(full_text, "Hi ");
        assert_eq!(emitted_text, vec!["Hi ".to_string()]);
        assert_eq!(emitted_tools.len(), 1);
        assert_eq!(emitted_tools[0].name, "wb_open");
    }

    #[test]
    fn process_sse_line_supports_message_level_tool_calls_and_output_text_arrays() {
        let mut full_text = String::new();
        let mut assemblies: HashMap<usize, ToolCallAssembly> = HashMap::new();
        let mut responses_assemblies: HashMap<String, ResponsesToolAssembly> = HashMap::new();
        let mut stream_state = OpenAiStreamAccumulator::default();
        let mut emitted_text: Vec<String> = Vec::new();
        let mut emitted_tools = Vec::new();

        let line = r#"data: {"choices":[{"message":{"content":[{"type":"output_text","text":"Observe the slider. "}],"tool_calls":[{"id":"call-9","index":0,"function":{"name":"wb_draw_text","arguments":{"content":"Ratio","x":10,"y":20}}}]}}]}"#;
        let done = process_openai_sse_line(
            line,
            &mut full_text,
            &mut assemblies,
            &mut responses_assemblies,
            &mut stream_state,
            &mut |event| match event {
                ProviderStreamEvent::TextDelta(text) => emitted_text.push(text),
                ProviderStreamEvent::ToolCall(tool) => emitted_tools.push(tool),
                ProviderStreamEvent::Done { .. } => {}
            },
        );

        assert!(!done);
        assert_eq!(full_text, "Observe the slider. ");
        assert_eq!(emitted_text, vec!["Observe the slider. ".to_string()]);
        assert_eq!(emitted_tools.len(), 1);
        assert_eq!(emitted_tools[0].name, "wb_draw_text");
        assert_eq!(emitted_tools[0].arguments["content"], "Ratio");
    }

    #[test]
    fn process_sse_line_supports_responses_api_events_and_usage() {
        let mut full_text = String::new();
        let mut assemblies: HashMap<usize, ToolCallAssembly> = HashMap::new();
        let mut responses_assemblies: HashMap<String, ResponsesToolAssembly> = HashMap::new();
        let mut stream_state = OpenAiStreamAccumulator::default();
        let mut emitted_text: Vec<String> = Vec::new();
        let mut emitted_tools = Vec::new();

        let text_delta = r#"data: {"type":"response.output_text.delta","delta":"Hello "}"#;
        let _ = process_openai_sse_line(
            text_delta,
            &mut full_text,
            &mut assemblies,
            &mut responses_assemblies,
            &mut stream_state,
            &mut |event| match event {
                ProviderStreamEvent::TextDelta(text) => emitted_text.push(text),
                ProviderStreamEvent::ToolCall(tool) => emitted_tools.push(tool),
                ProviderStreamEvent::Done { .. } => {}
            },
        );

        let tool_done = r#"data: {"type":"response.function_call_arguments.done","call_id":"call_123","name":"wb_open","arguments":"{}"}"#;
        let _ = process_openai_sse_line(
            tool_done,
            &mut full_text,
            &mut assemblies,
            &mut responses_assemblies,
            &mut stream_state,
            &mut |event| match event {
                ProviderStreamEvent::TextDelta(text) => emitted_text.push(text),
                ProviderStreamEvent::ToolCall(tool) => emitted_tools.push(tool),
                ProviderStreamEvent::Done { .. } => {}
            },
        );

        let completed = r#"data: {"type":"response.completed","response":{"usage":{"prompt_tokens":111,"completion_tokens":222,"total_tokens":333}}}"#;
        let done = process_openai_sse_line(
            completed,
            &mut full_text,
            &mut assemblies,
            &mut responses_assemblies,
            &mut stream_state,
            &mut |event| match event {
                ProviderStreamEvent::TextDelta(text) => emitted_text.push(text),
                ProviderStreamEvent::ToolCall(tool) => emitted_tools.push(tool),
                ProviderStreamEvent::Done { .. } => {}
            },
        );

        assert!(done);
        assert_eq!(full_text, "Hello ");
        assert_eq!(emitted_text, vec!["Hello ".to_string()]);
        assert_eq!(emitted_tools.len(), 1);
        assert_eq!(emitted_tools[0].name, "wb_open");
        assert_eq!(emitted_tools[0].arguments, json!({}));
        let usage = stream_state.usage.expect("usage should be captured");
        assert_eq!(usage.input_tokens, 111);
        assert_eq!(usage.output_tokens, 222);
        assert_eq!(usage.total_tokens, Some(333));
    }
}
