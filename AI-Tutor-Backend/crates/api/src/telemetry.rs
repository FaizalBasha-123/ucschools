use std::sync::Arc;
use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use ai_tutor_storage::repositories::ApiUsageRepository;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEvent {
    pub account_id: String,
    pub request_id: String,
    pub component: String,
    pub provider_id: String,
    pub model_id: String,
    pub lesson_id: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

pub struct TelemetryService {
    repository: Arc<dyn ApiUsageRepository>,
}

impl TelemetryService {
    pub fn new(repository: Arc<dyn ApiUsageRepository>) -> Self {
        Self { repository }
    }

    pub async fn record_usage(&self, event: UsageEvent) -> Result<()> {
        let cost = calculate_event_cost(&event);
        let record = ai_tutor_domain::billing::ApiUsageRecord {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: event.account_id,
            model_id: event.model_id,
            provider: event.provider_id,
            component: event.component,
            lesson_id: event.lesson_id,
            input_tokens: event.input_tokens,
            output_tokens: event.output_tokens,
            cost_usd_millicents: cost,
            created_at: Utc::now(),
        };

        if let Err(e) = self.repository.insert_api_usage_record(&record).await {
            warn!(error = %e, "failed to flush usage record");
        }
        Ok(())
    }
}

fn calculate_event_cost(event: &UsageEvent) -> i64 {
    // Tavily web search: flat $0.50/1000 queries = 500 millicents per query
    if event.provider_id == "tavily" {
        return 500;
    }
    let (input_rate, output_rate) = match (event.provider_id.as_str(), event.model_id.as_str()) {
        ("openrouter", "google/gemini-2.5-flash") => (0.15, 0.60),
        ("openrouter", "google/gemini-2.0-flash-001") => (0.10, 0.40),
        ("openrouter", "google/gemini-2.0-flash") => (0.10, 0.40),
        ("openrouter", "google/gemini-1.5-flash") => (0.075, 0.30),
        ("openrouter", "google/gemini-flash-lite") => (0.075, 0.30),
        ("openrouter", m) if m.starts_with("deepseek/deepseek-chat") => (0.27, 1.10),
        ("openrouter", m) if m.starts_with("anthropic/claude-sonnet-4") => (3.00, 15.00),
        ("openrouter", m) if m.starts_with("anthropic/claude-sonnet-3") => (3.00, 15.00),
        ("openrouter", "anthropic/claude-3-5-haiku") => (0.80, 4.00),
        ("openrouter", m) if m.starts_with("black-forest-labs/flux-1.1-pro") => (0.050, 0.050),
        ("openrouter", m) if m.starts_with("black-forest-labs/flux-dev")    => (0.025, 0.025),
        ("openrouter", m) if m.starts_with("black-forest-labs/flux-schnell") => (0.003, 0.003),
        ("openrouter", "hexgrad/kokoro-82m") => (0.01, 0.01),
        ("openrouter", "openai/gpt-4o-mini") => (0.15, 0.60),
        ("openrouter", "openai/gpt-4o") => (2.50, 10.00),
        ("groq", m) if m.starts_with("llama3") || m.starts_with("llama-3") => (0.05, 0.10),
        ("groq", "whisper-large-v3") => (0.0, 0.0),
        ("groq", "whisper-small") => (0.0, 0.0),
        ("elevenlabs", _) => (0.0, 0.30),
        _ => (10.0, 30.0),
    };
    ai_tutor_domain::billing::ApiUsageRecord::compute_cost_millicents(
        event.input_tokens,
        event.output_tokens,
        input_rate,
        output_rate,
    )
}

