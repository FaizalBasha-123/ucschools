use std::sync::Arc;
use anyhow::{anyhow, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::info;

use ai_tutor_storage::repositories::ApiUsageRepository;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEvent {
    pub account_id: String,
    pub request_id: String,
    pub component: String,
    pub provider_id: String,
    pub model_id: String,
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
        let cost_usd_millicents = self.calculate_cost_millicents(&event.provider_id, &event.model_id, event.input_tokens, event.output_tokens);
        
        let record = ai_tutor_domain::billing::ApiUsageRecord {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: event.account_id,
            model_id: event.model_id,
            provider: event.provider_id,
            component: event.component,
            input_tokens: event.input_tokens,
            output_tokens: event.output_tokens,
            cost_usd_millicents,
            created_at: Utc::now(),
        };

        self.repository.insert_api_usage_record(&record).await.map_err(|e| anyhow!(e))?;
        
        info!(
            event = "api_usage",
            provider = %record.provider,
            model = %record.model_id,
            tokens = record.input_tokens + record.output_tokens,
            cost = %format!("{:.6}", record.cost_usd()),
            "recorded api usage"
        );

        Ok(())
    }

    fn calculate_cost_millicents(&self, provider: &str, model: &str, input: i64, output: i64) -> i64 {
        // Real-world enterprise cost mapping (OpenRouter/OpenAI/ElevenLabs approximations)
        let (input_rate, output_rate) = match (provider, model) {
            ("openai", "gpt-4o") => (5.0, 15.0),
            ("openai", "gpt-4o-mini") => (0.15, 0.60),
            ("anthropic", "claude-3-5-sonnet") => (3.0, 15.0),
            ("google", "gemini-1.5-flash") => (0.075, 0.30),
            ("elevenlabs", _) => (0.0, 0.0), 
            _ => (10.0, 30.0), 
        };

        ai_tutor_domain::billing::ApiUsageRecord::compute_cost_millicents(
            input,
            output,
            input_rate,
            output_rate
        )
    }
}
