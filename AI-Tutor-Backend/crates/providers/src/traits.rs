use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use ai_tutor_domain::provider::ModelConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamingPath {
    Native,
    Compatibility,
}

impl StreamingPath {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Compatibility => "compatibility",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderUsageSource {
    ProviderReported,
    Estimated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: Option<u64>,
    pub source: ProviderUsageSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub native_text_streaming: bool,
    pub native_typed_streaming: bool,
    pub compatibility_streaming: bool,
    pub cooperative_cancellation: bool,
}

impl ProviderCapabilities {
    pub const fn compatibility_only() -> Self {
        Self {
            native_text_streaming: false,
            native_typed_streaming: false,
            compatibility_streaming: true,
            cooperative_cancellation: true,
        }
    }

    pub const fn native_text_and_typed() -> Self {
        Self {
            native_text_streaming: true,
            native_typed_streaming: true,
            compatibility_streaming: false,
            cooperative_cancellation: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProviderRuntimeStatus {
    pub label: String,
    pub available: bool,
    pub consecutive_failures: u32,
    /// Milliseconds remaining in circuit breaker cooldown (0 = not in cooldown)
    pub cooldown_remaining_ms: u64,
    /// Total LLM request attempts routed to this provider entry.
    pub total_requests: u64,
    /// Total successful LLM generations for this provider entry.
    pub total_successes: u64,
    /// Total failed LLM generations for this provider entry.
    pub total_failures: u64,
    /// Last observed provider error (trimmed), when available.
    pub last_error: Option<String>,
    /// Unix timestamp (ms) of the latest successful call.
    pub last_success_unix_ms: Option<u64>,
    /// Unix timestamp (ms) of the latest failed call.
    pub last_failure_unix_ms: Option<u64>,
    /// Total wall-clock latency across all attempts routed to this provider.
    pub total_latency_ms: u64,
    /// Arithmetic mean latency (ms) across all attempts, when available.
    pub average_latency_ms: Option<u64>,
    /// Latency (ms) of the latest attempt, when available.
    pub last_latency_ms: Option<u64>,
    /// Estimated input tokens routed to this provider label.
    pub estimated_input_tokens: u64,
    /// Estimated output tokens produced by this provider label.
    pub estimated_output_tokens: u64,
    /// Estimated total cost in micro-USD using configured pricing overrides when available.
    pub estimated_total_cost_microusd: u64,
    /// Provider-reported input tokens routed to this provider label.
    pub provider_reported_input_tokens: u64,
    /// Provider-reported output tokens produced by this provider label.
    pub provider_reported_output_tokens: u64,
    /// Provider-reported total tokens observed for this provider label.
    pub provider_reported_total_tokens: u64,
    /// Provider-reported total cost in micro-USD using configured pricing overrides.
    pub provider_reported_total_cost_microusd: u64,
    /// Whether this provider currently uses true native token/event streaming.
    pub streaming_path: StreamingPath,
    pub capabilities: ProviderCapabilities,
}

/// Provider-native stream item contract translated from OpenMAIC's
/// `StreamChunk` envelope in `ai-sdk-adapter.ts`.
///
/// Concrete providers may initially emit only `TextDelta` + `Done`.
/// `ToolCall` exists so GraphBit can consume typed action intent directly
/// once provider transports start exposing it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProviderStreamEvent {
    TextDelta(String),
    ToolCall(ProviderToolCall),
    Done {
        full_text: String,
        usage: Option<ProviderUsage>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderToolCall {
    pub id: Option<String>,
    pub name: String,
    pub arguments: Value,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String>;

    /// Structured generation result that can include provider-reported usage.
    ///
    /// Default behavior preserves backward compatibility and returns no usage.
    async fn generate_text_with_usage(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        let generated = self.generate_text(system_prompt, user_prompt).await?;
        Ok((generated, None))
    }

    /// Stream text deltas into the supplied callback.
    ///
    /// Default behavior is a compatibility seam, not provider-native streaming:
    /// generate the full text, then emit chunked deltas. Concrete providers can
    /// override this with true token/event streaming later.
    async fn generate_text_stream(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let generated = self.generate_text(system_prompt, user_prompt).await?;
        for chunk in chunk_text_for_stream(&generated, 140) {
            on_delta(chunk);
        }
        Ok(generated)
    }

    /// Stream text deltas from a full conversation history.
    ///
    /// Default behavior keeps backward compatibility by calling the history
    /// generation path and chunking the complete result. Concrete providers can
    /// override this to use provider-native streaming APIs with real history.
    async fn generate_text_stream_with_history(
        &self,
        messages: &[(String, String)],
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let generated = self.generate_text_with_history(messages).await?;
        for chunk in chunk_text_for_stream(&generated, 140) {
            on_delta(chunk);
        }
        Ok(generated)
    }

    /// Cancellation-aware streaming equivalent to OpenMAIC's abort-signal path.
    ///
    /// Default behavior preserves backward compatibility while allowing callers
    /// to cooperatively stop streaming work when the token is cancelled.
    async fn generate_text_stream_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let generated = tokio::select! {
            _ = cancellation.cancelled() => {
                return Err(anyhow::anyhow!("stream cancelled"));
            }
            generated = self.generate_text_with_history(messages) => generated?,
        };
        if cancellation.is_cancelled() {
            return Err(anyhow::anyhow!("stream cancelled"));
        }
        for chunk in chunk_text_for_stream(&generated, 140) {
            if cancellation.is_cancelled() {
                return Err(anyhow::anyhow!("stream cancelled"));
            }
            on_delta(chunk);
        }
        if cancellation.is_cancelled() {
            return Err(anyhow::anyhow!("stream cancelled"));
        }
        Ok(generated)
    }

    /// Typed streaming contract modeled after OpenMAIC's adapter stream chunks.
    ///
    /// Default behavior preserves compatibility by adapting the existing text
    /// streaming seam into typed `TextDelta` events followed by `Done`.
    async fn generate_stream_events_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<String> {
        let generated = self
            .generate_text_stream_with_history_cancellable(messages, cancellation, &mut |chunk| {
                on_event(ProviderStreamEvent::TextDelta(chunk))
            })
            .await?;
        if cancellation.is_cancelled() {
            return Err(anyhow::anyhow!("stream cancelled"));
        }
        on_event(ProviderStreamEvent::Done {
            full_text: generated.clone(),
            usage: None,
        });
        Ok(generated)
    }

    async fn generate_stream_events_with_history(
        &self,
        messages: &[(String, String)],
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<String> {
        let cancellation = CancellationToken::new();
        self.generate_stream_events_with_history_cancellable(messages, &cancellation, on_event)
            .await
    }

    /// Generate text from a conversation history (list of role/content pairs).
    /// Enables context truncation on overflow — the resilient provider can drop
    /// older messages and retry.
    ///
    /// Default implementation extracts system + last user message and delegates
    /// to `generate_text()` for backward compatibility with existing providers.
    async fn generate_text_with_history(&self, messages: &[(String, String)]) -> Result<String> {
        let system = messages
            .iter()
            .find(|(role, _)| role == "system")
            .map(|(_, content)| content.as_str())
            .unwrap_or("");
        let user = messages
            .iter()
            .rev()
            .find(|(role, _)| role == "user")
            .map(|(_, content)| content.as_str())
            .unwrap_or("");
        self.generate_text(system, user).await
    }

    /// History-aware generation result with optional provider usage.
    ///
    /// Default behavior preserves backward compatibility and returns no usage.
    async fn generate_text_with_history_and_usage(
        &self,
        messages: &[(String, String)],
    ) -> Result<(String, Option<ProviderUsage>)> {
        let generated = self.generate_text_with_history(messages).await?;
        Ok((generated, None))
    }

    fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
        Vec::new()
    }

    fn streaming_path(&self) -> StreamingPath {
        StreamingPath::Compatibility
    }

    fn capabilities(&self) -> ProviderCapabilities {
        match self.streaming_path() {
            StreamingPath::Native => ProviderCapabilities::native_text_and_typed(),
            StreamingPath::Compatibility => ProviderCapabilities::compatibility_only(),
        }
    }
}

fn chunk_text_for_stream(value: &str, max_chars: usize) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return vec!["I am ready to continue the lesson.".to_string()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for word in trimmed.split_whitespace() {
        let candidate_len = if current.is_empty() {
            word.len()
        } else {
            current.len() + 1 + word.len()
        };

        if candidate_len > max_chars && !current.is_empty() {
            chunks.push(current.clone());
            current.clear();
        }

        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
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

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;

    struct TextOnlyProvider;

    #[async_trait]
    impl LlmProvider for TextOnlyProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok("hello typed stream".to_string())
        }
    }

    #[tokio::test]
    async fn typed_stream_defaults_to_text_deltas_and_done() {
        let provider = TextOnlyProvider;
        let mut events = Vec::new();

        let result = provider
            .generate_stream_events_with_history(
                &[("user".to_string(), "hi".to_string())],
                &mut |event| events.push(event),
            )
            .await
            .expect("typed stream should adapt text stream");

        assert_eq!(result, "hello typed stream");
        assert!(events
            .iter()
            .any(|event| matches!(event, ProviderStreamEvent::TextDelta(_))));
        assert_eq!(
            events.last(),
            Some(&ProviderStreamEvent::Done {
                full_text: "hello typed stream".to_string(),
                usage: None,
            })
        );
    }

    struct SlowHistoryProvider;

    #[async_trait]
    impl LlmProvider for SlowHistoryProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok("unused".to_string())
        }

        async fn generate_text_with_history(&self, _messages: &[(String, String)]) -> Result<String> {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            Ok("slow result".to_string())
        }
    }

    #[tokio::test]
    async fn compatibility_streaming_respects_cancellation_before_full_generation_completes() {
        let provider = SlowHistoryProvider;
        let cancellation = CancellationToken::new();

        let task = tokio::spawn({
            let cancellation = cancellation.clone();
            async move {
                provider
                    .generate_text_stream_with_history_cancellable(
                        &[("user".to_string(), "hi".to_string())],
                        &cancellation,
                        &mut |_chunk| {},
                    )
                    .await
            }
        });

        cancellation.cancel();
        let result = tokio::time::timeout(std::time::Duration::from_millis(200), task)
            .await
            .expect("compatibility stream should stop quickly")
            .expect("task should join");

        assert!(result.is_err());
        assert!(result
            .err()
            .is_some_and(|error| error.to_string().contains("stream cancelled")));
    }
}
