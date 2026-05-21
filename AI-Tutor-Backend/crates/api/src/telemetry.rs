use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
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
    tx: mpsc::UnboundedSender<UsageEvent>,
}

const BATCH_SIZE: usize = 50;
const FLUSH_INTERVAL_SECS: u64 = 1;

impl TelemetryService {
    pub fn new(repository: Arc<dyn ApiUsageRepository>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<UsageEvent>();

        tokio::spawn(async move {
            let mut buffer: Vec<UsageEvent> = Vec::with_capacity(BATCH_SIZE);
            let mut flush_timer = tokio::time::interval(Duration::from_secs(FLUSH_INTERVAL_SECS));
            flush_timer.tick().await;

            loop {
                tokio::select! {
                    Some(event) = rx.recv() => {
                        buffer.push(event);
                        if buffer.len() >= BATCH_SIZE {
                            let batch = std::mem::take(&mut buffer);
                            flush_batch(&repository, batch).await;
                        }
                    }
                    _ = flush_timer.tick() => {
                        if !buffer.is_empty() {
                            let batch = std::mem::take(&mut buffer);
                            flush_batch(&repository, batch).await;
                        }
                    }
                }
            }
        });

        Self { tx }
    }

    pub async fn record_usage(&self, event: UsageEvent) -> Result<()> {
        if let Err(e) = self.tx.send(event) {
            warn!("failed to enqueue usage event: {}", e);
        }
        Ok(())
    }
}

async fn flush_batch(repo: &Arc<dyn ApiUsageRepository>, events: Vec<UsageEvent>) {
    let batch_size = events.len();
    let records: Vec<ai_tutor_domain::billing::ApiUsageRecord> = events
        .into_iter()
        .map(|event| {
            let cost = calculate_event_cost(&event);
            ai_tutor_domain::billing::ApiUsageRecord {
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
            }
        })
        .collect();

    if let Err(e) = repo.insert_api_usage_records_batch(&records).await {
        warn!(
            batch_size,
            error = %e,
            "failed to flush usage records batch"
        );
    } else {
        info!(
            batch_size,
            "flushed usage records batch"
        );
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
