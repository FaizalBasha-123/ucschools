use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

use ai_tutor_domain::provider::ModelConfig;

use crate::traits::{
    LlmProvider, ProviderCapabilities, ProviderStreamEvent, ProviderToolCall, ProviderUsage,
    ProviderUsageSource, StreamingPath,
};

#[derive(Clone)]
pub struct GoogleProvider {
    model_config: ModelConfig,
    client: reqwest::Client,
}

impl GoogleProvider {
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
            .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta".to_string());
        format!(
            "{}/models/{}:generateContent?key={}",
            base.trim_end_matches('/'),
            self.model_config.model_id,
            self.model_config.api_key
        )
    }

    fn stream_endpoint(&self) -> String {
        let base = self
            .model_config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta".to_string());
        format!(
            "{}/models/{}:streamGenerateContent?alt=sse&key={}",
            base.trim_end_matches('/'),
            self.model_config.model_id,
            self.model_config.api_key
        )
    }

    fn build_request_body<'a>(
        &'a self,
        system_prompt: Option<&'a str>,
        contents: Vec<GoogleContent<'a>>,
    ) -> GoogleRequest<'a> {
        GoogleRequest {
            system_instruction: system_prompt.map(|content| GoogleInstruction {
                parts: vec![GooglePart { text: content }],
            }),
            contents,
            generation_config: GoogleGenerationConfig {
                temperature: 0.2,
                response_mime_type: "text/plain",
            },
        }
    }
}

#[derive(Serialize)]
struct GoogleRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none", rename = "systemInstruction")]
    system_instruction: Option<GoogleInstruction<'a>>,
    contents: Vec<GoogleContent<'a>>,
    #[serde(rename = "generationConfig")]
    generation_config: GoogleGenerationConfig<'a>,
}

#[derive(Serialize)]
struct GoogleInstruction<'a> {
    parts: Vec<GooglePart<'a>>,
}

#[derive(Serialize)]
struct GoogleContent<'a> {
    role: &'a str,
    parts: Vec<GooglePart<'a>>,
}

#[derive(Serialize)]
struct GooglePart<'a> {
    text: &'a str,
}

#[derive(Serialize)]
struct GoogleGenerationConfig<'a> {
    temperature: f32,
    #[serde(rename = "responseMimeType")]
    response_mime_type: &'a str,
}

#[derive(Deserialize)]
struct GoogleResponse {
    #[serde(default)]
    candidates: Vec<GoogleCandidate>,
    #[serde(default, rename = "usageMetadata")]
    usage_metadata: Option<GoogleUsageMetadata>,
}

#[derive(Deserialize, Clone, Debug)]
struct GoogleUsageMetadata {
    #[serde(default, rename = "promptTokenCount")]
    prompt_token_count: Option<u64>,
    #[serde(default, rename = "candidatesTokenCount")]
    candidates_token_count: Option<u64>,
    #[serde(default, rename = "totalTokenCount")]
    total_token_count: Option<u64>,
}

#[derive(Deserialize)]
struct GoogleCandidate {
    content: Option<GoogleCandidateContent>,
}

#[derive(Deserialize)]
struct GoogleCandidateContent {
    #[serde(default)]
    parts: Vec<GoogleCandidatePart>,
}

#[derive(Deserialize)]
struct GoogleCandidatePart {
    #[serde(default)]
    text: Option<String>,
    #[serde(default, rename = "functionCall")]
    function_call: Option<GoogleFunctionCall>,
}

#[derive(Deserialize)]
struct GoogleFunctionCall {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    args: Option<Value>,
}

#[async_trait]
impl LlmProvider for GoogleProvider {
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

        let contents = messages
            .iter()
            .filter_map(|(role, content)| match role.as_str() {
                "user" => Some(GoogleContent {
                    role: "user",
                    parts: vec![GooglePart {
                        text: content.as_str(),
                    }],
                }),
                "assistant" => Some(GoogleContent {
                    role: "model",
                    parts: vec![GooglePart {
                        text: content.as_str(),
                    }],
                }),
                _ => None,
            })
            .collect::<Vec<_>>();

        if contents.is_empty() {
            return Err(anyhow!("google request requires at least one user message"));
        }

        let request = self.build_request_body(system_prompt, contents);

        let response = self
            .client
            .post(self.endpoint())
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "google request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: GoogleResponse = response.json().await?;
        let text = body
            .candidates
            .into_iter()
            .flat_map(|candidate| candidate.content.into_iter())
            .flat_map(|content| content.parts.into_iter())
            .filter_map(|part| part.text)
            .collect::<Vec<_>>()
            .join("");

        if text.is_empty() {
            return Err(anyhow!("google provider returned no text content"));
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

        let contents = messages
            .iter()
            .filter_map(|(role, content)| match role.as_str() {
                "user" => Some(GoogleContent {
                    role: "user",
                    parts: vec![GooglePart {
                        text: content.as_str(),
                    }],
                }),
                "assistant" => Some(GoogleContent {
                    role: "model",
                    parts: vec![GooglePart {
                        text: content.as_str(),
                    }],
                }),
                _ => None,
            })
            .collect::<Vec<_>>();

        if contents.is_empty() {
            return Err(anyhow!("google request requires at least one user message"));
        }

        let request = self.build_request_body(system_prompt, contents);

        let response = self
            .client
            .post(self.endpoint())
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "google request failed with status {}: {}",
                status,
                body
            ));
        }

        let body: GoogleResponse = response.json().await?;
        let usage = body
            .usage_metadata
            .clone()
            .and_then(google_usage_to_provider_usage);
        let text = body
            .candidates
            .into_iter()
            .flat_map(|candidate| candidate.content.into_iter())
            .flat_map(|content| content.parts.into_iter())
            .filter_map(|part| part.text)
            .collect::<Vec<_>>()
            .join("");

        if text.is_empty() {
            return Err(anyhow!("google provider returned no text content"));
        }

        Ok((text, usage))
    }

    /// True native streaming for Google Gemini.
    ///
    /// Uses the `streamGenerateContent?alt=sse` endpoint which returns
    /// SSE events with partial candidate content.
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
        self.stream_google_messages(messages, cancellation, &mut |event| {
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
            .stream_google_messages(messages, cancellation, &mut |event| on_event(event))
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

impl GoogleProvider {
    async fn stream_google_messages(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<(String, Option<ProviderUsage>)> {
        let system_prompt = messages
            .iter()
            .find(|(role, _)| role == "system")
            .map(|(_, content)| content.as_str());

        let contents = messages
            .iter()
            .filter_map(|(role, content)| match role.as_str() {
                "user" => Some(GoogleContent {
                    role: "user",
                    parts: vec![GooglePart {
                        text: content.as_str(),
                    }],
                }),
                "assistant" => Some(GoogleContent {
                    role: "model",
                    parts: vec![GooglePart {
                        text: content.as_str(),
                    }],
                }),
                _ => None,
            })
            .collect::<Vec<_>>();

        if contents.is_empty() {
            return Err(anyhow!(
                "google streaming request requires at least one user message"
            ));
        }

        let request = self.build_request_body(system_prompt, contents);

        let response = self
            .client
            .post(self.stream_endpoint())
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "google streaming request failed with status {}: {}",
                status,
                body
            ));
        }

        let mut full_text = String::new();
        let mut byte_stream = response.bytes_stream();
        let mut line_buffer = String::new();
        let mut emitted_tool_signatures = HashSet::new();
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

            // Process complete SSE events
            while let Some(newline_pos) = line_buffer.find('\n') {
                let line = line_buffer[..newline_pos].trim().to_string();
                line_buffer = line_buffer[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    let data = data.trim();
                    if let Ok(chunk_response) = serde_json::from_str::<GoogleResponse>(data) {
                        process_google_stream_chunk(
                            chunk_response,
                            &mut full_text,
                            &mut emitted_tool_signatures,
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
                if let Ok(chunk_response) = serde_json::from_str::<GoogleResponse>(data) {
                    process_google_stream_chunk(
                        chunk_response,
                        &mut full_text,
                        &mut emitted_tool_signatures,
                        &mut usage,
                        on_event,
                    );
                }
            }
        }

        Ok((full_text, usage))
    }
}

fn process_google_stream_chunk(
    chunk_response: GoogleResponse,
    full_text: &mut String,
    emitted_tool_signatures: &mut HashSet<String>,
    usage: &mut Option<ProviderUsage>,
    on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
) {
    if let Some(chunk_usage) = chunk_response
        .usage_metadata
        .clone()
        .and_then(google_usage_to_provider_usage)
    {
        *usage = Some(chunk_usage);
    }
    for candidate in chunk_response.candidates {
        if let Some(content) = candidate.content {
            for part in content.parts {
                if let Some(text) = part.text {
                    if !text.is_empty() {
                        full_text.push_str(&text);
                        on_event(ProviderStreamEvent::TextDelta(text));
                    }
                }
                if let Some(function_call) = part.function_call {
                    if let Some(name) = function_call.name {
                        let args = function_call
                            .args
                            .unwrap_or_else(|| Value::Object(Default::default()));
                        let signature = format!("{}::{}", name, args);
                        if emitted_tool_signatures.insert(signature) {
                            on_event(ProviderStreamEvent::ToolCall(ProviderToolCall {
                                id: None,
                                name,
                                arguments: args,
                            }));
                        }
                    }
                }
            }
        }
    }
}

fn google_usage_to_provider_usage(usage: GoogleUsageMetadata) -> Option<ProviderUsage> {
    let input_tokens = usage.prompt_token_count.unwrap_or(0);
    let output_tokens = usage.candidates_token_count.unwrap_or(0);
    let total_tokens = usage
        .total_token_count
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

#[cfg(test)]
mod tests {
    use super::{process_google_stream_chunk, GoogleResponse};
    use crate::traits::ProviderStreamEvent;
    use std::collections::HashSet;

    #[test]
    fn google_stream_chunk_emits_text_and_function_call_events() {
        let chunk_json = r#"{
            "candidates":[
                {"content":{"parts":[
                    {"text":"Hello "},
                    {"functionCall":{"name":"wb_draw_text","args":{"content":"1/2","x":10,"y":12}}}
                ]}}
            ]
        }"#;
        let chunk: GoogleResponse =
            serde_json::from_str(chunk_json).expect("valid google stream chunk");
        let mut full_text = String::new();
        let mut seen = HashSet::new();
        let mut usage = None;
        let mut events = Vec::new();

        process_google_stream_chunk(
            chunk,
            &mut full_text,
            &mut seen,
            &mut usage,
            &mut |event| events.push(event),
        );

        assert_eq!(full_text, "Hello ");
        assert!(events.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::TextDelta(text) if text == "Hello "
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::ToolCall(call) if call.name == "wb_draw_text"
        )));
    }

    #[test]
    fn google_stream_chunk_captures_usage_metadata() {
        let chunk_json = r#"{
            "usageMetadata": {
                "promptTokenCount": 120,
                "candidatesTokenCount": 40,
                "totalTokenCount": 160
            },
            "candidates":[
                {"content":{"parts":[{"text":"ok"}]}}
            ]
        }"#;
        let chunk: GoogleResponse =
            serde_json::from_str(chunk_json).expect("valid google stream chunk");
        let mut full_text = String::new();
        let mut seen = HashSet::new();
        let mut usage = None;

        process_google_stream_chunk(
            chunk,
            &mut full_text,
            &mut seen,
            &mut usage,
            &mut |_event| {},
        );

        let usage = usage.expect("usage should be captured");
        assert_eq!(usage.input_tokens, 120);
        assert_eq!(usage.output_tokens, 40);
        assert_eq!(usage.total_tokens, Some(160));
    }
}
