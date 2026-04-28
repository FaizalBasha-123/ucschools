/// Background subscription renewal scheduler.
/// Processes monthly subscriptions, grants credits, and handles renewal logic.
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, error, info};
use uuid::Uuid;

use ai_tutor_domain::billing::{
    BillingProductKind, Invoice, InvoiceLine, InvoiceLineType, InvoiceStatus, InvoiceType,
    PaymentOrder, PaymentOrderStatus, Subscription, SubscriptionStatus,
};
use ai_tutor_domain::credits::{CreditEntryKind, CreditLedgerEntry};
use ai_tutor_storage::{
    filesystem::FileStorage,
    repositories::{
        CreditLedgerRepository, InvoiceLineRepository, InvoiceRepository, PaymentOrderRepository,
        SubscriptionRepository,
    },
};

use crate::billing_catalog::billing_catalog;

/// Configuration for subscription renewal scheduler
#[derive(Clone, Debug)]
pub struct SubscriptionSchedulerConfig {
    /// Interval between renewal cycles (default: 15 minutes)
    pub renewal_interval_secs: u64,
    /// Maximum subscriptions to process per cycle (to avoid overwhelming system)
    pub batch_size: usize,
}

impl Default for SubscriptionSchedulerConfig {
    fn default() -> Self {
        Self {
            renewal_interval_secs: 900, // 15 minutes
            batch_size: 50,
        }
    }
}

/// Manages subscription renewal cycles
pub struct SubscriptionScheduler {
    storage: Arc<FileStorage>,
    config: SubscriptionSchedulerConfig,
}

impl SubscriptionScheduler {
    pub fn new(storage: Arc<FileStorage>, config: SubscriptionSchedulerConfig) -> Self {
        Self { storage, config }
    }

    /// Start the scheduler as a background task
    pub fn start(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                if let Err(err) = self.process_renewals().await {
                    error!("Subscription renewal cycle failed: {}", err);
                }
                sleep(Duration::from_secs(self.config.renewal_interval_secs)).await;
            }
        })
    }

    /// Process subscriptions due for renewal
    pub async fn process_renewals(&self) -> Result<()> {
        let now = Utc::now();
        debug!("Starting subscription renewal cycle at {}", now);

        // Get all subscriptions
        let all_subscriptions = self
            .storage
            .list_all_subscriptions(self.config.batch_size)
            .await
            .map_err(|err| anyhow!("Failed to list subscriptions: {}", err))?;

        let mut renewed_count = 0;
        let mut failed_count = 0;

        for subscription in all_subscriptions {
            // Skip non-active subscriptions
            if subscription.status != SubscriptionStatus::Active {
                continue;
            }

            // Check if renewal is needed
            let next_renewal = match subscription.next_renewal_at {
                Some(dt) => dt,
                None => continue,
            };

            if next_renewal > now {
                // Not due for renewal yet
                continue;
            }

            // Process renewal
            match self.process_single_renewal(&subscription).await {
                Ok(_) => {
                    renewed_count += 1;
                    info!(
                        subscription_id = %subscription.id,
                        account_id = %subscription.account_id,
                        "Subscription renewed successfully"
                    );
                }
                Err(err) => {
                    failed_count += 1;
                    error!(
                        subscription_id = %subscription.id,
                        account_id = %subscription.account_id,
                        error = %err,
                        "Failed to renew subscription"
                    );
                    
                    // Mark as PastDue on payment failure
                    if let Err(e) = self.handle_renewal_failure(&subscription).await {
                        error!("Failed to mark subscription as past due: {}", e);
                    }
                }
            }
        }

        info!(
            renewed_count,
            failed_count,
            "Subscription renewal cycle completed"
        );

        Ok(())
    }

    /// Process a single subscription renewal
    async fn process_single_renewal(&self, subscription: &Subscription) -> Result<()> {
        let now = Utc::now();
        let billing_product = billing_catalog()
            .into_iter()
            .find(|product| {
                product.product_code == subscription.plan_code
                    && matches!(product.kind, BillingProductKind::Subscription)
            });
        let (amount_minor, currency) = billing_product
            .map(|product| (product.amount_minor, product.currency))
            .unwrap_or_else(|| (0, "USD".to_string()));

        // Create payment order record (simulated - in production, would call actual payment gateway)
        let payment_order = PaymentOrder {
            id: format!("renewal-{}-{}", subscription.id, Uuid::new_v4()),
            account_id: subscription.account_id.clone(),
            product_code: subscription.plan_code.clone(),
            product_kind: BillingProductKind::Subscription,
            gateway: subscription.gateway.clone(),
            gateway_txn_id: format!("renewal-txn-{}", Uuid::new_v4()),
            gateway_payment_id: None,
            amount_minor,
            currency,
            credits_to_grant: subscription.credits_per_cycle,
            status: PaymentOrderStatus::Succeeded,
            checkout_url: None,
            udf1: Some(subscription.id.clone()),
            udf2: Some("renewal".to_string()),
            udf3: None,
            udf4: None,
            udf5: None,
            raw_response: None,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
        };

        // Save payment order
        self.storage
            .save_payment_order(&payment_order)
            .await
            .map_err(|err| anyhow!("Failed to save payment order: {}", err))?;

        // Grant credits with a deterministic ID for idempotency.
        // If the scheduler crashes after granting but before updating
        // next_renewal_at, the retry will detect the duplicate entry.
        let renewal_marker = subscription.current_period_end.timestamp();
        let credit_entry = CreditLedgerEntry {
            id: format!("scheduler-renewal-{}-{}", subscription.id, renewal_marker),
            account_id: subscription.account_id.clone(),
            kind: CreditEntryKind::Grant,
            amount: subscription.credits_per_cycle,
            reason: format!("subscription_renewal:{}", subscription.id),
            created_at: now,
        };

        match self.storage.apply_credit_entry(&credit_entry).await {
            Ok(_) => {}
            Err(err) if err.contains("already exists") => {
                // Idempotency guard: renewal credits already granted for this period.
                tracing::warn!(
                    subscription_id = %subscription.id,
                    renewal_marker,
                    "Skipped duplicate scheduler renewal credit entry"
                );
            }
            Err(err) => return Err(anyhow!("Failed to apply credit entry: {}", err)),
        }

        let invoice_id = format!(
            "subscription-scheduler-invoice-{}-{}",
            subscription.id,
            now.timestamp()
        );
        let next_period_end = now + chrono::Duration::days(30);
        let invoice = Invoice {
            id: invoice_id.clone(),
            account_id: subscription.account_id.clone(),
            invoice_type: InvoiceType::SubscriptionRenewal,
            billing_cycle_start: now,
            billing_cycle_end: next_period_end,
            status: InvoiceStatus::Paid,
            amount_cents: amount_minor,
            amount_after_credits: amount_minor,
            created_at: now,
            finalized_at: Some(now),
            paid_at: Some(now),
            due_at: Some(now),
            updated_at: now,
        };

        self.storage
            .create_invoice(&invoice)
            .await
            .map_err(|err| anyhow!("Failed to create renewal invoice: {}", err))?;

        self.storage
            .add_line(&InvoiceLine {
                id: format!("{}-line-subscription", invoice_id),
                invoice_id,
                line_type: InvoiceLineType::SubscriptionBase,
                description: format!("{} monthly renewal", subscription.plan_code),
                amount_cents: amount_minor,
                quantity: 1,
                unit_price_cents: amount_minor,
                is_prorated: false,
                period_start: now,
                period_end: next_period_end,
                created_at: now,
                updated_at: now,
            })
            .await
            .map_err(|err| anyhow!("Failed to create renewal invoice line: {}", err))?;

        // Update subscription with new renewal date
        let mut updated_subscription = subscription.clone();
        updated_subscription.current_period_start = now;
        updated_subscription.current_period_end = next_period_end;
        updated_subscription.next_renewal_at = Some(next_period_end);
        updated_subscription.last_payment_order_id = Some(payment_order.id);
        updated_subscription.updated_at = now;

        self.storage
            .save_subscription(&updated_subscription)
            .await
            .map_err(|err| anyhow!("Failed to save subscription: {}", err))?;

        Ok(())
    }

    /// Handle renewal failure - mark subscription as PastDue with grace period
    async fn handle_renewal_failure(&self, subscription: &Subscription) -> Result<()> {
        let now = Utc::now();
        let grace_period_end = now + chrono::Duration::days(3); // 3-day grace period

        let mut updated = subscription.clone();
        updated.status = SubscriptionStatus::PastDue;
        updated.grace_period_until = Some(grace_period_end);
        updated.updated_at = now;

        self.storage
            .save_subscription(&updated)
            .await
            .map_err(|err| anyhow!("Failed to save subscription: {}", err))?;

        debug!(
            subscription_id = %subscription.id,
            grace_period_until = %grace_period_end,
            "Subscription marked as PastDue with grace period"
        );

        Ok(())
    }

    /// Check if any subscriptions have expired from grace period
    pub async fn expire_past_due_subscriptions(&self) -> Result<u32> {
        let now = Utc::now();
        let all_subscriptions = self
            .storage
            .list_all_subscriptions(1000)
            .await
            .map_err(|err| anyhow!("Failed to list subscriptions: {}", err))?;

        let mut expired_count = 0;

        for subscription in all_subscriptions {
            if subscription.status != SubscriptionStatus::PastDue {
                continue;
            }

            if let Some(grace_until) = subscription.grace_period_until {
                if grace_until <= now {
                    // Grace period expired, mark as Expired
                    let mut updated = subscription.clone();
                    updated.status = SubscriptionStatus::Expired;
                    updated.updated_at = now;

                    if let Err(e) = self
                        .storage
                        .save_subscription(&updated)
                        .await
                        .map_err(|err| anyhow!("Failed to save subscription: {}", err))
                    {
                        error!("Failed to expire subscription {}: {}", subscription.id, e);
                        continue;
                    }

                    expired_count += 1;
                    info!(
                        subscription_id = %subscription.id,
                        account_id = %subscription.account_id,
                        "Subscription expired after grace period"
                    );
                }
            }
        }

        Ok(expired_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_reasonable_intervals() {
        let config = SubscriptionSchedulerConfig::default();
        assert_eq!(config.renewal_interval_secs, 900); // 15 min
        assert!(config.batch_size > 0);
    }
}
