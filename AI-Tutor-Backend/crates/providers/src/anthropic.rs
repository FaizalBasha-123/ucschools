use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;

use ai_tutor_domain::provider::ModelConfig;

use crate::traits::{
    LlmProvider, ProviderCapabilities, ProviderStreamEvent, ProviderToolCall, ProviderUsage,
    ProviderUsageSource, StreamingPath,
};

#[derive(Clone)]
pub struct AnthropicProvider {
    model_config: ModelConfig,
    client: reqwest::Client,
}

impl AnthropicProvider {
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
            .unwrap_or_else(|| "https://api.anthropic.com/v1".to_string());
        format!("{}/messages", base.trim_end_matches('/'))
    }
}

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    messages: Vec<AnthropicMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize, Clone, Debug)]
struct AnthropicUsage {
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

/// Anthropic SSE event types for streaming
#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    content_block: Option<AnthropicStreamContentBlock>,
    #[serde(default)]
    delta: Option<AnthropicStreamDelta>,
    #[serde(default)]
    message: Option<AnthropicStreamMessage>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicStreamMessage {
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicStreamDelta {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    partial_json: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicStreamContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<Value>,
}

#[derive(Default, Debug, Clone)]
struct AnthropicToolAssembly {
    id: Option<String>,
    name: Option<String>,
    input_buffer: String,
    last_emitted_input: Option<Value>,
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
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
        let system_prompt = messages
            .iter()
            .find(|(role, _)| role == "system")
            .map(|(_, content)| content.as_str());

        let anthropic_messages = messages
            .iter()
            .filter_map(|(role, content)| match role.as_str() {
                "user" => Some(AnthropicMessage {
                    role: "user",
                    content: content.as_str(),
                }),
                "assistant" => Some(AnthropicMessage {
                    role: "assistant",
                    content: content.as_str(),
                }),
                _ => None,
            })
            .collect::<Vec<_>>();

        if anthropic_messages.is_empty() {
            return Err(anyhow!(
                "anthropic request requires at least one user message"
            ));
        }

        let request = AnthropicRequest {
            model: &self.model_config.model_id,
            max_tokens: 4096,
            temperature: 0.2,
            system: system_prompt,
            messages: anthropic_messages,
            stream: None,
        };

        let response = self
            .client
            .post(self.endpoint())
            .header("x-api-key", &self.model_config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "anthropic request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: AnthropicResponse = response.json().await?;
        let text = body
            .content
            .into_iter()
            .filter(|block| block.kind == "text")
            .filter_map(|block| block.text)
            .collect::<Vec<_>>()
            .join("");

        if text.is_empty() {
            return Err(anyhow!("anthropic provider returned no text content"));
        }

        Ok(text)
    }

    async fn generate_text_with_history_and_usage(
        &self,
        messages: &[(String, String)],
    ) -> Result<(String, Option<ProviderUsage>)> {
        let system_prompt = messages
            .iter()
            .find(|(role, _)| role == "system")
            .map(|(_, content)| content.as_str());

        let anthropic_messages = messages
            .iter()
            .filter_map(|(role, content)| match role.as_str() {
                "user" => Some(AnthropicMessage {
                    role: "user",
                    content: content.as_str(),
                }),
                "assistant" => Some(AnthropicMessage {
                    role: "assistant",
                    content: content.as_str(),
                }),
                _ => None,
            })
            .collect::<Vec<_>>();

        if anthropic_messages.is_empty() {
            return Err(anyhow!(
                "anthropic request requires at least one user message"
            ));
        }

        let request = AnthropicRequest {
            model: &self.model_config.model_id,
            max_tokens: 4096,
            temperature: 0.2,
            system: system_prompt,
            messages: anthropic_messages,
            stream: None,
        };

        let response = self
            .client
            .post(self.endpoint())
            .header("x-api-key", &self.model_config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "anthropic request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: AnthropicResponse = response.json().await?;
        let usage = body.usage.and_then(anthropic_usage_to_provider_usage);
        let text = body
            .content
            .into_iter()
            .filter(|block| block.kind == "text")
            .filter_map(|block| block.text)
            .collect::<Vec<_>>()
            .join("");

        if text.is_empty() {
            return Err(anyhow!("anthropic provider returned no text content"));
        }

        Ok((text, usage))
    }

    /// True native SSE streaming for Anthropic Claude.
    ///
    /// Uses `stream: true` which returns SSE events. We listen for
    /// `content_block_delta` events that carry text deltas.
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
        self.stream_anthropic_messages(messages, cancellation, &mut |event| {
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
            .stream_anthropic_messages(messages, cancellation, &mut |event| on_event(event))
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

impl AnthropicProvider {
    async fn stream_anthropic_messages(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<(String, Option<ProviderUsage>)> {
        let system_prompt = messages
            .iter()
            .find(|(role, _)| role == "system")
            .map(|(_, content)| content.as_str());

        let anthropic_messages = messages
            .iter()
            .filter_map(|(role, content)| match role.as_str() {
                "user" => Some(AnthropicMessage {
                    role: "user",
                    content: content.as_str(),
                }),
                "assistant" => Some(AnthropicMessage {
                    role: "assistant",
                    content: content.as_str(),
                }),
                _ => None,
            })
            .collect::<Vec<_>>();

        if anthropic_messages.is_empty() {
            return Err(anyhow!(
                "anthropic streaming request requires at least one user message"
            ));
        }

        let request = AnthropicRequest {
            model: &self.model_config.model_id,
            max_tokens: 4096,
            temperature: 0.2,
            system: system_prompt,
            messages: anthropic_messages,
            stream: Some(true),
        };

        let response = self
            .client
            .post(self.endpoint())
            .header("x-api-key", &self.model_config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "anthropic streaming request failed with status {}: {}",
                status,
                body
            ));
        }

        let mut full_text = String::new();
        let mut byte_stream = response.bytes_stream();
        let mut line_buffer = String::new();
        let mut tool_assemblies: HashMap<usize, AnthropicToolAssembly> = HashMap::new();
        let mut usage: Option<ProviderUsage> = None;

        loop {
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

                if line.is_empty() {
                    continue;
                }

                // Anthropic SSE: "event: <type>\n" then "data: {json}\n"
                // We only care about the data lines
                if let Some(data) = line.strip_prefix("data: ") {
                    let data = data.trim();
                    if let Ok(event) = serde_json::from_str::<AnthropicStreamEvent>(data) {
                        process_anthropic_stream_event(
                            event,
                            &mut full_text,
                            &mut tool_assemblies,
                            &mut usage,
                            on_event,
                        );
                    }
                }
            }
        }

        // Process remaining buffer
        for line in line_buffer.lines() {
            let line = line.trim();
            if let Some(data) = line.strip_prefix("data: ") {
                let data = data.trim();
                if let Ok(event) = serde_json::from_str::<AnthropicStreamEvent>(data) {
                    process_anthropic_stream_event(
                        event,
                        &mut full_text,
                        &mut tool_assemblies,
                        &mut usage,
                        on_event,
                    );
                }
            }
        }

        Ok((full_text, usage))
    }
}

fn process_anthropic_stream_event(
    event: AnthropicStreamEvent,
    full_text: &mut String,
    tool_assemblies: &mut HashMap<usize, AnthropicToolAssembly>,
    usage: &mut Option<ProviderUsage>,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) {
    if usage.is_none() {
        if let Some(stream_usage) = event
            .message
            .as_ref()
            .and_then(|message| message.usage.clone())
            .and_then(anthropic_usage_to_provider_usage)
        {
            *usage = Some(stream_usage);
        } else if let Some(root_usage) = event.usage.and_then(anthropic_usage_to_provider_usage) {
            *usage = Some(root_usage);
        }
    }
    match event.event_type.as_str() {
        "content_block_start" => {
            if let (Some(index), Some(content_block)) = (event.index, event.content_block) {
                if content_block.kind == "tool_use" {
                    let entry = tool_assemblies.entry(index).or_default();
                    if entry.id.is_none() {
                        entry.id = content_block.id;
                    }
                    if entry.name.is_none() {
                        entry.name = content_block.name;
                    }
                    if let Some(input) = content_block.input {
                        entry.last_emitted_input = Some(input.clone());
                        if let Some(name) = entry.name.clone() {
                            on_event(ProviderStreamEvent::ToolCall(ProviderToolCall {
                                id: entry.id.clone(),
                                name,
                                arguments: input,
                            }));
                        }
                    }
                }
            }
        }
        "content_block_delta" => {
            if let Some(delta) = event.delta {
                if let Some(text) = delta.text {
                    if !text.is_empty() {
                        full_text.push_str(&text);
                        on_event(ProviderStreamEvent::TextDelta(text));
                    }
                }
                if delta.kind.as_deref() == Some("input_json_delta") {
                    if let (Some(index), Some(partial_json)) = (event.index, delta.partial_json) {
                        let entry = tool_assemblies.entry(index).or_default();
                        entry.input_buffer.push_str(&partial_json);
                        if let Some(name) = entry.name.clone() {
                            if let Ok(parsed) = serde_json::from_str::<Value>(&entry.input_buffer) {
                                if entry.last_emitted_input.as_ref() != Some(&parsed) {
                                    entry.last_emitted_input = Some(parsed.clone());
                                    on_event(ProviderStreamEvent::ToolCall(ProviderToolCall {
                                        id: entry.id.clone(),
                                        name,
                                        arguments: parsed,
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn anthropic_usage_to_provider_usage(usage: AnthropicUsage) -> Option<ProviderUsage> {
    let input_tokens = usage.input_tokens.unwrap_or(0);
    let output_tokens = usage.output_tokens.unwrap_or(0);
    let total_tokens = Some(input_tokens.saturating_add(output_tokens));
    if total_tokens == Some(0) {
        return None;
    }
    Some(ProviderUsage {
        input_tokens,
        output_tokens,
        total_tokens,
        source: ProviderUsageSource::ProviderReported,
    })
}

#[cfg(test)]
mod tests {
    use super::{process_anthropic_stream_event, AnthropicStreamEvent, AnthropicToolAssembly};
    use crate::traits::ProviderStreamEvent;
    use std::collections::HashMap;

    #[test]
    fn anthropic_tool_use_delta_emits_typed_tool_call() {
        let mut full_text = String::new();
        let mut assemblies: HashMap<usize, AnthropicToolAssembly> = HashMap::new();
        let mut usage = None;
        let mut events = Vec::new();

        let start_json = r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"wb_open","input":{}}}"#;
        let start: AnthropicStreamEvent =
            serde_json::from_str(start_json).expect("valid anthropic start event");
        process_anthropic_stream_event(
            start,
            &mut full_text,
            &mut assemblies,
            &mut usage,
            &mut |event| events.push(event),
        );

        assert!(events.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::ToolCall(call) if call.name == "wb_open"
        )));
    }

    #[test]
    fn anthropic_text_delta_emits_text_event() {
        let mut full_text = String::new();
        let mut assemblies: HashMap<usize, AnthropicToolAssembly> = HashMap::new();
        let mut usage = None;
        let mut events = Vec::new();

        let delta_json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}"#;
        let delta: AnthropicStreamEvent =
            serde_json::from_str(delta_json).expect("valid anthropic delta event");
        process_anthropic_stream_event(
            delta,
            &mut full_text,
            &mut assemblies,
            &mut usage,
            &mut |event| events.push(event),
        );

        assert_eq!(full_text, "hello");
        assert!(events.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::TextDelta(text) if text == "hello"
        )));
    }

    #[test]
    fn anthropic_message_start_usage_is_captured() {
        let mut full_text = String::new();
        let mut assemblies: HashMap<usize, AnthropicToolAssembly> = HashMap::new();
        let mut usage = None;

        let start_json =
            r#"{"type":"message_start","message":{"usage":{"input_tokens":77,"output_tokens":0}}}"#;
        let start: AnthropicStreamEvent =
            serde_json::from_str(start_json).expect("valid anthropic message_start event");
        process_anthropic_stream_event(
            start,
            &mut full_text,
            &mut assemblies,
            &mut usage,
            &mut |_event| {},
        );

        let usage = usage.expect("usage should be captured");
        assert_eq!(usage.input_tokens, 77);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(usage.total_tokens, Some(77));
    }
}
