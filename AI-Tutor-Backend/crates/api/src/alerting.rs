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

pub fn run_alert_loop(storage: Arc<FileStorage>) {
    let notification_service = notification_service_from_env(
        std::env::var("AI_TUTOR_BASE_URL").unwrap_or_default(),
    );

    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(CHECK_INTERVAL_SECS.max(60)));
        let mut last_alert_at: Option<i64> = None;

        loop {
            ticker.tick().await;

            let now = Utc::now();

            let daily_since = now - chrono::Duration::hours(24);
            let daily_records = match storage.list_api_usage_records_since(daily_since).await {
                Ok(records) => records,
                Err(e) => {
                    error!(error = %e, "alert loop: failed to query daily usage");
                    continue;
                }
            };
            let daily_cost: i64 = daily_records.iter().map(|r| r.cost_usd_millicents).sum();

            let hourly_since = now - chrono::Duration::hours(1);
            let hourly_records = match storage.list_api_usage_records_since(hourly_since).await {
                Ok(records) => records,
                Err(e) => {
                    error!(error = %e, "alert loop: failed to query hourly usage");
                    continue;
                }
            };
            let hourly_cost: i64 = hourly_records.iter().map(|r| r.cost_usd_millicents).sum();

            let mut should_alert = false;
            let mut reasons = Vec::new();

            if daily_cost > DAILY_COST_THRESHOLD_MILLICENTS {
                reasons.push(format!(
                    "Daily cost ${:.2} exceeds threshold ${:.2}",
                    daily_cost as f64 / 100_000.0,
                    DAILY_COST_THRESHOLD_MILLICENTS as f64 / 100_000.0,
                ));
                should_alert = true;
            }

            if hourly_cost > HOURLY_BURN_THRESHOLD_MILLICENTS {
                reasons.push(format!(
                    "Hourly burn ${:.2} exceeds threshold ${:.2}",
                    hourly_cost as f64 / 100_000.0,
                    HOURLY_BURN_THRESHOLD_MILLICENTS as f64 / 100_000.0,
                ));
                should_alert = true;
            }

            if should_alert {
                let now_unix = now.timestamp();

                if let Some(last) = last_alert_at {
                    if now_unix - last < ALERT_COOLDOWN_SECS {
                        info!(
                            daily_cost = %format!("${:.2}", daily_cost as f64 / 100_000.0),
                            hourly_cost = %format!("${:.2}", hourly_cost as f64 / 100_000.0),
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
                        daily_cost_usd: daily_cost as f64 / 100_000.0,
                        hourly_cost_usd: hourly_cost as f64 / 100_000.0,
                        daily_threshold_usd: DAILY_COST_THRESHOLD_MILLICENTS as f64 / 100_000.0,
                        hourly_threshold_usd: HOURLY_BURN_THRESHOLD_MILLICENTS as f64 / 100_000.0,
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
