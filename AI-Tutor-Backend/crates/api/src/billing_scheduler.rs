/// Subscription renewal scheduler — the AI-Tutor equivalent of Lago's clock.rb + Sidekiq workers.
///
/// ## Architecture (mirrors Lago's design exactly)
///
/// ### Lago's design:
///   - clock.rb: wakes hourly, enqueues a "check renewals for this hour" job to Sidekiq (Redis)
///   - SubscriptionsBillerWorker: reads the job, finds due subscriptions, fans them out
///   - BillSubscriptionWorker: per-subscription — charges card, grants credits, generates invoice
///
/// ### Our design:
///   - AlarmClock task:         wakes at :10 past every hour, XADDs to billing:jobs:renewal
///   - RenewalBatchWorker task: reads renewal ticks, SELECTs due subscriptions, fans out to billing:jobs:renewal:tasks
///   - RenewalTaskWorker pool:  N parallel workers each processing one subscription at a time
///
/// ## Why :10 past the hour?
/// Buffer time for any subscription whose `next_renewal_at` is exactly on the hour boundary.
/// Lago uses the same pattern (clock runs 10 minutes after the hour boundary).
///
/// ## Failure guarantee
/// If a RenewalTaskWorker crashes mid-renewal:
///   - The message is NOT ACKed (XACK never called)
///   - After STALE_MESSAGE_MS (5 min), XAUTOCLAIM reassigns it to another worker
///   - The credit grant has a deterministic idempotency key → DB ignores duplicates
///   - The student is never double-charged
use anyhow::Result;
use chrono::{DateTime, Duration as ChronoDuration, Timelike, Utc};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{error, info, warn};

use ai_tutor_domain::{
    billing::{Invoice, InvoiceLine, InvoiceLineType, InvoiceStatus, InvoiceType, Subscription},
    credits::{CreditEntryKind, CreditLedgerEntry},
    wallet::CreditBucket,
};
use ai_tutor_storage::{
    filesystem::FileStorage,
    repositories::{
        CreditLedgerRepository, InvoiceLineRepository, InvoiceRepository,
        SubscriptionRepository, TutorAccountRepository, WalletRepository,
        RevenueSnapshotRepository,
    },
};

use crate::billing_catalog::billing_catalog;
use crate::billing_event_queue::{BillingEventQueue, RenewalTask, RenewalTick};
use crate::invoice_renderer::InvoiceRenderer;

/// Number of parallel RenewalTaskWorker Tokio tasks.
const RENEWAL_WORKER_COUNT: usize = 8;

/// Grace period after a failed renewal before marking subscription PastDue.
const GRACE_PERIOD_DAYS: i64 = 3;

// ── AlarmClock ────────────────────────────────────────────────────────────────

/// The AlarmClock task.
///
/// Wakes exactly at :10 past every hour. Does NOT touch the database.
/// Simply enqueues a renewal tick to billing:jobs:renewal and goes back to sleep.
///
/// Lago parallel: clock.rb scheduled via whenever gem (hourly cron)
pub struct AlarmClock {
    queue: Arc<BillingEventQueue>,
}

impl AlarmClock {
    pub fn new(queue: Arc<BillingEventQueue>) -> Self {
        Self { queue }
    }

    pub fn start(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            info!("AlarmClock started — will fire at :10 past every hour");
            loop {
                let now = Utc::now();
                let next_tick = Self::next_tick_time(now);
                let sleep_duration = (next_tick - now).to_std().unwrap_or(Duration::from_secs(60));

                info!(
                    next_tick = %next_tick.format("%Y-%m-%d %H:%M:%S UTC"),
                    sleep_secs = sleep_duration.as_secs(),
                    "AlarmClock sleeping until next tick"
                );

                // Sleep until :10 past the next hour.
                sleep(sleep_duration).await;

                // Now it's :10 past the hour. Compute which hour just completed.
                let fired_at = Utc::now();
                let hour_start = fired_at
                    .with_minute(0).unwrap()
                    .with_second(0).unwrap()
                    .with_nanosecond(0).unwrap()
                    - ChronoDuration::hours(1); // the hour that just ended
                let hour_end = hour_start + ChronoDuration::hours(1);

                let tick = RenewalTick {
                    hour_start:   hour_start.to_rfc3339(),
                    hour_end:     hour_end.to_rfc3339(),
                    triggered_at: fired_at.to_rfc3339(),
                };

                match self.queue.enqueue_renewal_tick(&tick).await {
                    Ok(id) => info!(
                        hour_start = %hour_start,
                        stream_id = %id,
                        "AlarmClock: renewal tick enqueued — DB never touched"
                    ),
                    Err(e) => error!(
                        error = %e,
                        "AlarmClock: failed to enqueue renewal tick"
                    ),
                }
            }
        })
    }

    /// Compute the next :10 past the hour from `now`.
    fn next_tick_time(now: DateTime<Utc>) -> DateTime<Utc> {
        let current_hour = now
            .with_minute(0).unwrap()
            .with_second(0).unwrap()
            .with_nanosecond(0).unwrap();

        let candidate = current_hour + ChronoDuration::minutes(10);
        if candidate > now {
            candidate
        } else {
            // Already past :10 of this hour — target next hour's :10.
            current_hour + ChronoDuration::hours(1) + ChronoDuration::minutes(10)
        }
    }
}

// ── RenewalBatchWorker ────────────────────────────────────────────────────────

/// The RenewalBatchWorker task.
///
/// Reads renewal tick messages from billing:jobs:renewal.
/// For each tick: queries DB for subscriptions due in that hour window.
/// Fans each subscription out as a separate task to billing:jobs:renewal:tasks.
///
/// Lago parallel: SubscriptionsBillerWorker (Sidekiq worker that creates per-sub jobs)
pub struct RenewalBatchWorker {
    queue: Arc<BillingEventQueue>,
    storage: Arc<FileStorage>,
}

impl RenewalBatchWorker {
    pub fn new(queue: Arc<BillingEventQueue>, storage: Arc<FileStorage>) -> Self {
        Self { queue, storage }
    }

    pub fn start(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            info!("RenewalBatchWorker started");
            loop {
                let ticks = match self
                    .queue
                    .consume_renewal_ticks("renewal-batch-worker-1")
                    .await
                {
                    Ok(t) => t,
                    Err(e) => {
                        let err_msg = e.to_string();
                        if self.queue.recover_from_nogroup(&err_msg).await {
                            continue;
                        }
                        warn!(error = %err_msg, "consume ticks failed, sleeping 5s");
                        sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                };

                for tick_msg in ticks {
                    let tick = &tick_msg.payload;
                    info!(
                        hour_start = %tick.hour_start,
                        "RenewalBatchWorker: processing renewal tick"
                    );

                    match self.fan_out_renewals(tick).await {
                        Ok(count) => {
                            info!(
                                count,
                                hour_start = %tick.hour_start,
                                "RenewalBatchWorker: fanned out renewal tasks"
                            );
                            if let Err(e) = self.queue.ack_renewal_tick(&tick_msg.entry_id).await {
                                warn!(error = %e, "failed to ACK renewal tick");
                            }
                        }
                        Err(e) => {
                            error!(
                                error = %e,
                                hour_start = %tick.hour_start,
                                "RenewalBatchWorker: fan-out failed, tick will be retried"
                            );
                            // Don't ACK — message stays for retry.
                        }
                    }
                }
            }
        })
    }

    async fn fan_out_renewals(&self, tick: &RenewalTick) -> Result<usize> {
        // Single DB query: fetch all subscriptions due in this hour window.
        let due_subs = self
            .storage
            .list_subscriptions_due_for_renewal(&tick.hour_end, 10_000)
            .await
            .map_err(|e| anyhow::anyhow!("list_subscriptions_due_for_renewal: {}", e))?;

        let count = due_subs.len();

        for sub in due_subs {
            let task = RenewalTask {
                subscription_id: sub.id.clone(),
                account_id:      sub.account_id.clone(),
                plan_code:       sub.plan_code.clone(),
                period_end_ts:   sub.current_period_end.timestamp(),
            };
            if let Err(e) = self.queue.enqueue_renewal_task(&task).await {
                warn!(
                    subscription_id = %sub.id,
                    error = %e,
                    "failed to enqueue renewal task (will miss this cycle)"
                );
            }
        }

        Ok(count)
    }
}

// ── RenewalTaskWorker ─────────────────────────────────────────────────────────

/// A single RenewalTaskWorker (N of these run in parallel).
///
/// Processes one subscription renewal at a time:
///   1. Load subscription + account from DB (2 indexed SELECTs)
///   2. Grant credits (idempotent — deterministic key → no double-charge on retry)
///   3. Create invoice record
///   4. Generate PDF via Typst (in spawn_blocking — CPU bound)
///   5. Upload PDF to R2/filesystem
///   6. Update subscription period dates
///   7. Send renewal email with PDF link
///   8. XACK the task
///
/// Lago parallel: BillSubscriptionWorker
pub struct RenewalTaskWorker {
    worker_id: usize,
    queue: Arc<BillingEventQueue>,
    storage: Arc<FileStorage>,
    invoice_renderer: Arc<InvoiceRenderer>,
    /// Internal secret for calling the nodemailer email route.
    internal_secret: String,
    /// Base URL of the Next.js frontend (for email routes).
    frontend_base_url: String,
}

impl RenewalTaskWorker {
    pub fn new(
        worker_id: usize,
        queue: Arc<BillingEventQueue>,
        storage: Arc<FileStorage>,
        invoice_renderer: Arc<InvoiceRenderer>,
        internal_secret: String,
        frontend_base_url: String,
    ) -> Self {
        Self {
            worker_id,
            queue,
            storage,
            invoice_renderer,
            internal_secret,
            frontend_base_url,
        }
    }

    pub fn start(self) -> tokio::task::JoinHandle<()> {
        let worker_id = self.worker_id;
        tokio::spawn(async move {
            let consumer_name = format!("renewal-task-worker-{}", worker_id);
            info!(worker_id, "RenewalTaskWorker started");
            loop {
                // Reclaim any stale tasks first.
                match self.queue.reclaim_stale_renewal_tasks(&consumer_name, 3).await {
                    Ok(stale) if !stale.is_empty() => {
                        for msg in stale {
                            self.process_renewal_task_msg(msg, &consumer_name).await;
                        }
                    }
                    _ => {}
                }

                // Read one task (BLOCK 15s).
                let tasks = match self.queue.consume_renewal_task(&consumer_name).await {
                    Ok(t) => t,
                    Err(e) => {
                        let err_msg = e.to_string();
                        if self.queue.recover_from_nogroup(&err_msg).await {
                            continue;
                        }
                        warn!(worker_id, error = %err_msg, "consume renewal task failed, sleeping 5s");
                        sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                };

                for msg in tasks {
                    self.process_renewal_task_msg(msg, &consumer_name).await;
                }
            }
        })
    }

    async fn process_renewal_task_msg(
        &self,
        msg: crate::billing_event_queue::StreamMessage<RenewalTask>,
        consumer_name: &str,
    ) {
        let task = &msg.payload;
        info!(
            worker_id = self.worker_id,
            subscription_id = %task.subscription_id,
            account_id = %task.account_id,
            "processing renewal task"
        );

        match self.process_single_renewal(task).await {
            Ok(_) => {
                if let Err(e) = self.queue.ack_renewal_task(&msg.entry_id).await {
                    warn!(
                        subscription_id = %task.subscription_id,
                        error = %e,
                        "failed to ACK renewal task (will retry)"
                    );
                }
                info!(
                    subscription_id = %task.subscription_id,
                    "renewal task completed successfully"
                );
            }
            Err(e) => {
                error!(
                    subscription_id = %task.subscription_id,
                    error = %e,
                    "renewal task failed — NOT ACKing, will be retried by XAUTOCLAIM"
                );
                // DO NOT ACK — the message stays in the PEL (Pending Entries List).
                // XAUTOCLAIM will reassign it after STALE_MESSAGE_MS.
            }
        }
    }

    async fn process_single_renewal(&self, task: &RenewalTask) -> Result<()> {
        let now = Utc::now();

        // ── Step 1: Load subscription and account ─────────────────────────────
        let subscription = self
            .storage
            .get_subscription_by_id(&task.subscription_id)
            .await
            .map_err(|e| anyhow::anyhow!("get subscription: {}", e))?
            .ok_or_else(|| anyhow::anyhow!("subscription {} not found", task.subscription_id))?;

        let account = self
            .storage
            .get_tutor_account_by_id(&task.account_id)
            .await
            .map_err(|e| anyhow::anyhow!("get account: {}", e))?
            .ok_or_else(|| anyhow::anyhow!("account {} not found", task.account_id))?;

        // ── Step 2: Grant credits (idempotent) ───────────────────────────────
        // Key: "renewal-{sub_id}-{period_end_unix}" — same key on retry → ON CONFLICT DO NOTHING.
        let credit_entry_id = format!(
            "scheduler-renewal-{}-{}",
            task.subscription_id, task.period_end_ts
        );

        let credit_entry = CreditLedgerEntry {
            id: credit_entry_id.clone(),
            account_id: task.account_id.clone(),
            kind: CreditEntryKind::Grant,
            amount: subscription.credits_per_cycle,
            reason: format!("subscription_renewal:{}", task.subscription_id),
            bucket: CreditBucket::Paid, // subscription grants always go to the paid bucket
            created_at: now,
        };

        match self.storage.apply_credit_entry(&credit_entry).await {
            Ok(_) => {}
            Err(e) if e.contains("already exists") || e.contains("ON CONFLICT") => {
                warn!(
                    subscription_id = %task.subscription_id,
                    "credit grant already applied (idempotency key hit) — continuing"
                );
            }
            Err(e) => return Err(anyhow::anyhow!("credit grant failed: {}", e)),
        }

        // ── Step 3: Create invoice record ─────────────────────────────────────
        let product = billing_catalog()
            .into_iter()
            .find(|p| p.product_code == subscription.plan_code);

        let amount_minor = product.as_ref().map(|p| p.amount_minor).unwrap_or(0);
        let currency = product.as_ref().map(|p| p.currency.clone()).unwrap_or_else(|| "INR".to_string());

        let next_period_end = advance_period(&subscription);
        let invoice_id = format!(
            "renewal-inv-{}-{}",
            task.subscription_id, task.period_end_ts
        );

        let invoice = Invoice {
            id: invoice_id.clone(),
            account_id: task.account_id.clone(),
            invoice_type: InvoiceType::SubscriptionRenewal,
            billing_cycle_start: subscription.current_period_end,
            billing_cycle_end: next_period_end,
            status: InvoiceStatus::Paid,
            amount_cents: amount_minor,
            amount_after_credits: amount_minor,
            created_at: now,
            finalized_at: Some(now),
            paid_at: Some(now),
            due_at: Some(now),
            updated_at: now,
            pdf_url: None, // set after PDF generation
        };

        self.storage
            .create_invoice(&invoice)
            .await
            .map_err(|e| anyhow::anyhow!("create invoice: {}", e))?;

        let invoice_line_id = format!("{}-base", invoice_id);
        let invoice_line = InvoiceLine {
            id: invoice_line_id,
            invoice_id: invoice_id.clone(),
            line_type: InvoiceLineType::SubscriptionBase,
            description: format!(
                "{} — monthly renewal ({:.0} credits)",
                subscription.plan_code, subscription.credits_per_cycle
            ),
            amount_cents: amount_minor,
            quantity: 1,
            unit_price_cents: amount_minor,
            is_prorated: false,
            period_start: subscription.current_period_end,
            period_end: next_period_end,
            created_at: now,
            updated_at: now,
        };

        self.storage
            .add_line(&invoice_line)
            .await
            .map_err(|e| anyhow::anyhow!("add invoice line: {}", e))?;

        // ── Step 4: Generate PDF (CPU-bound — in spawn_blocking) ──────────────
        let renderer = self.invoice_renderer.clone();
        let invoice_clone = invoice.clone();
        let lines_clone = vec![invoice_line.clone()];
        let account_clone = account.clone();
        let product_clone = product.clone();
        let sub_clone = subscription.clone();

        let pdf_bytes: Vec<u8> = tokio::task::spawn_blocking(move || {
            renderer.render_invoice(&invoice_clone, &lines_clone, &account_clone, Some(&sub_clone), product_clone.as_ref())
        })
        .await
        .map_err(|e| anyhow::anyhow!("spawn_blocking PDF: {}", e))?
        .map_err(|e| anyhow::anyhow!("PDF render: {}", e))?;

        // ── Step 5: Upload PDF ────────────────────────────────────────────────
        let pdf_url = crate::invoice_renderer::upload_invoice_pdf_to_storage(
            &self.storage,
            &invoice_id,
            &task.account_id,
            pdf_bytes,
        )
        .await
        .map_err(|e| anyhow::anyhow!("upload PDF: {}", e))?;

        // ── Step 6: Update invoice with PDF URL ───────────────────────────────
        self.storage
            .set_invoice_pdf_url(&invoice_id, &pdf_url)
            .await
            .map_err(|e| anyhow::anyhow!("set pdf_url: {}", e))?;

        // ── Step 7: Advance subscription period ───────────────────────────────
        let payment_order_id = format!("renewal-ord-{}-{}", task.subscription_id, task.period_end_ts);
        self.storage
            .advance_subscription_period(&task.subscription_id, &payment_order_id)
            .await
            .map_err(|e| anyhow::anyhow!("advance subscription period: {}", e))?;

        // ── Step 8: Send renewal email (best-effort — failure doesn't abort) ──
        let email_result = self
            .send_renewal_email(&account.email, &invoice, &pdf_url, &subscription, amount_minor, &currency)
            .await;

        if let Err(e) = email_result {
            warn!(
                account_id = %task.account_id,
                invoice_id = %invoice_id,
                error = %e,
                "renewal email failed (non-fatal)"
            );
        }

        Ok(())
    }

    async fn send_renewal_email(
        &self,
        email: &str,
        invoice: &Invoice,
        pdf_url: &str,
        subscription: &Subscription,
        amount_minor: i64,
        currency: &str,
    ) -> Result<()> {
        let amount_display = if currency == "INR" {
            format!("₹{:.2}", amount_minor as f64 / 100.0)
        } else {
            format!("${:.2}", amount_minor as f64 / 100.0)
        };

        let html = format!(
            r#"
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #1a1a1a;">Subscription Renewed ✓</h2>
              <p>Hi,</p>
              <p>Your <strong>{plan}</strong> subscription has been renewed successfully.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">Invoice</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">#{invoice_id}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Credits Granted</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">{credits:.0} credits</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Amount</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">{amount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Next Renewal</td>
                  <td style="padding: 8px 0; text-align: right;">{next_renewal}</td>
                </tr>
              </table>
              <p>
                <a href="{pdf_url}" style="background: #000; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">
                  Download Invoice PDF
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">Thanks for being an AI-Tutor subscriber.</p>
            </div>
            "#,
            plan = subscription.plan_code,
            invoice_id = &invoice.id[..12.min(invoice.id.len())],
            credits = subscription.credits_per_cycle,
            amount = amount_display,
            next_renewal = invoice.billing_cycle_end.format("%d %b %Y"),
            pdf_url = pdf_url,
        );

        // Call the Next.js nodemailer route (existing internal email endpoint).
        let client = reqwest::Client::new();
        let payload = serde_json::json!({
            "to_email": email,
            "subject": format!("Your AI-Tutor {} plan has been renewed", subscription.plan_code),
            "html": html,
        });

        let url = format!("{}/api/internal/send-email", self.frontend_base_url);
        client
            .post(&url)
            .header("x-internal-secret", &self.internal_secret)
            .json(&payload)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("email HTTP: {}", e))?;

        Ok(())
    }
}

// ── Start all scheduler tasks ─────────────────────────────────────────────────

pub struct BillingScheduler {
    queue: Arc<BillingEventQueue>,
    storage: Arc<FileStorage>,
    internal_secret: String,
    frontend_base_url: String,
}

impl BillingScheduler {
    pub fn new(
        queue: Arc<BillingEventQueue>,
        storage: Arc<FileStorage>,
        internal_secret: String,
        frontend_base_url: String,
    ) -> Self {
        Self {
            queue,
            storage,
            internal_secret,
            frontend_base_url,
        }
    }

    /// Start all scheduler components:
    /// - 1 AlarmClock
    /// - 1 RenewalBatchWorker
    /// - RENEWAL_WORKER_COUNT RenewalTaskWorkers
    pub fn start(self) -> Vec<tokio::task::JoinHandle<()>> {
        let mut handles = Vec::new();
        let invoice_renderer = Arc::new(InvoiceRenderer::new());

        // AlarmClock
        let clock = AlarmClock::new(self.queue.clone());
        handles.push(clock.start());

        // RenewalBatchWorker
        let batch_worker = RenewalBatchWorker::new(self.queue.clone(), self.storage.clone());
        handles.push(batch_worker.start());

        // N RenewalTaskWorkers (parallel Lago Mail Carriers)
        for i in 0..RENEWAL_WORKER_COUNT {
            let task_worker = RenewalTaskWorker::new(
                i,
                self.queue.clone(),
                self.storage.clone(),
                invoice_renderer.clone(),
                self.internal_secret.clone(),
                self.frontend_base_url.clone(),
            );
            handles.push(task_worker.start());
        }

        info!(
            workers = RENEWAL_WORKER_COUNT + 2,
            "BillingScheduler started (AlarmClock + RenewalBatchWorker + {} task workers)",
            RENEWAL_WORKER_COUNT
        );

        handles
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Compute the next period end date based on the subscription's billing interval.
fn advance_period(subscription: &Subscription) -> DateTime<Utc> {
    use ai_tutor_domain::billing::BillingInterval;
    match subscription.billing_interval {
        BillingInterval::Monthly => {
            subscription.current_period_end + ChronoDuration::days(30)
        }
    }
}
