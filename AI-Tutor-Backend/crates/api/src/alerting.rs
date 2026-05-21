use std::sync::Arc;
use chrono::Utc;
use tokio::time::{interval, Duration};
use tracing::{error, info};

use ai_tutor_storage::filesystem::FileStorage;
use ai_tutor_storage::repositories::ApiUsageRepository;
use crate::notifications::{notification_service_from_env, CostAlertNotification};

const CHECK_INTERVAL_SECS: u64 = 3600;
const DAILY_COST_THRESHOLD_MILLICENTS: i64 = 5_000_000;
const HOURLY_BURN_THRESHOLD_MILLICENTS: i64 = 1_000_000;
const ALERT_COOLDOWN_SECS: i64 = 21_600;
const MILLICENTS_PER_DOLLAR: f64 = 100_000.0;

fn millicents_to_usd(mc: i64) -> f64 {
    mc as f64 / MILLICENTS_PER_DOLLAR
}

async fn query_cost_sum(storage: &FileStorage, hours: i64, label: &str) -> Option<i64> {
    let since = Utc::now() - chrono::Duration::hours(hours);
    match storage.list_api_usage_records_since(since).await {
        Ok(records) => Some(records.iter().map(|r| r.cost_usd_millicents).sum()),
        Err(e) => {
            error!(error = %e, "alert loop: failed to query {label}");
            None
        }
    }
}

pub fn run_alert_loop(storage: Arc<FileStorage>) {
    let notification_service = notification_service_from_env(
        std::env::var("AI_TUTOR_BASE_URL").unwrap_or_default(),
    );

    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(CHECK_INTERVAL_SECS.max(60)));
        let mut last_alert_at: Option<i64> = None;

        loop {
            ticker.tick().await;

            let daily_cost = match query_cost_sum(&storage, 24, "daily usage").await {
                Some(c) => c,
                None => continue,
            };

            let hourly_cost = match query_cost_sum(&storage, 1, "hourly burn").await {
                Some(c) => c,
                None => continue,
            };

            let mut should_alert = false;
            let mut reasons = Vec::new();

            if daily_cost > DAILY_COST_THRESHOLD_MILLICENTS {
                reasons.push(format!(
                    "Daily cost ${:.2} exceeds threshold ${:.2}",
                    millicents_to_usd(daily_cost),
                    millicents_to_usd(DAILY_COST_THRESHOLD_MILLICENTS),
                ));
                should_alert = true;
            }

            if hourly_cost > HOURLY_BURN_THRESHOLD_MILLICENTS {
                reasons.push(format!(
                    "Hourly burn ${:.2} exceeds threshold ${:.2}",
                    millicents_to_usd(hourly_cost),
                    millicents_to_usd(HOURLY_BURN_THRESHOLD_MILLICENTS),
                ));
                should_alert = true;
            }

            if should_alert {
                let now_unix = Utc::now().timestamp();

                if let Some(last) = last_alert_at {
                    if now_unix - last < ALERT_COOLDOWN_SECS {
                        info!(
                            daily_cost = %format!("${:.2}", millicents_to_usd(daily_cost)),
                            hourly_cost = %format!("${:.2}", millicents_to_usd(hourly_cost)),
                            "alert suppressed by cooldown"
                        );
                        continue;
                    }
                }

                let operator_emails = storage.list_operator_emails().await.unwrap_or_default();
                if operator_emails.is_empty() {
                    info!("no operator emails configured, skipping alert");
                    continue;
                }

                for email in &operator_emails {
                    let payload = CostAlertNotification {
                        daily_cost_usd: millicents_to_usd(daily_cost),
                        hourly_cost_usd: millicents_to_usd(hourly_cost),
                        daily_threshold_usd: millicents_to_usd(DAILY_COST_THRESHOLD_MILLICENTS),
                        hourly_threshold_usd: millicents_to_usd(HOURLY_BURN_THRESHOLD_MILLICENTS),
                        reasons: reasons.clone(),
                        to_email: email.clone(),
                    };

                    if let Err(e) = notification_service.send_cost_alert(payload).await {
                        error!(error = %e, recipient = %email, "alert loop: failed to send cost alert");
                    } else {
                        info!(recipient = %email, "cost alert sent");
                    }
                }

                last_alert_at = Some(now_unix);
            }
        }
    });
}
