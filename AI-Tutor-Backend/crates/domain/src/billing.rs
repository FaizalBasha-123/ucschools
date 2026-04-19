use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BillingProductKind {
    Subscription,
    Bundle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BillingInterval {
    Monthly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    Active,
    PastDue,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PaymentOrderStatus {
    Pending,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PaymentIntentStatus {
    Pending,
    RequiresAction,
    Authorized,
    Captured,
    Failed,
    Abandoned,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DunningStatus {
    Active,
    Recovered,
    Exhausted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceType {
    SubscriptionRenewal,
    AddOnCreditPurchase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceStatus {
    Draft,
    Open,
    Finalized,
    Paid,
    PartiallyPaid,
    Overdue,
    Uncollectible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceLineType {
    SubscriptionBase,
    IncludedCredits,
    UsageOverage,
    AddOnCredits,
    AddOn,
    Adjustment,
    TaxAmount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: String,
    pub account_id: String,
    pub invoice_type: InvoiceType,
    pub billing_cycle_start: DateTime<Utc>,
    pub billing_cycle_end: DateTime<Utc>,
    pub status: InvoiceStatus,
    pub amount_cents: i64,
    pub amount_after_credits: i64,
    pub created_at: DateTime<Utc>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub paid_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceLine {
    pub id: String,
    pub invoice_id: String,
    pub line_type: InvoiceLineType,
    pub description: String,
    pub amount_cents: i64,
    pub quantity: u32,
    pub unit_price_cents: i64,
    pub is_prorated: bool,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentOrder {
    pub id: String,
    pub account_id: String,
    pub product_code: String,
    pub product_kind: BillingProductKind,
    pub gateway: String,
    pub gateway_txn_id: String,
    pub gateway_payment_id: Option<String>,
    pub amount_minor: i64,
    pub currency: String,
    pub credits_to_grant: f64,
    pub status: PaymentOrderStatus,
    pub checkout_url: Option<String>,
    pub udf1: Option<String>,
    pub udf2: Option<String>,
    pub udf3: Option<String>,
    pub udf4: Option<String>,
    pub udf5: Option<String>,
    pub raw_response: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentIntent {
    pub id: String,
    pub account_id: String,
    pub invoice_id: String,
    pub status: PaymentIntentStatus,
    pub amount_cents: i64,
    pub idempotency_key: String,
    pub payment_method_id: Option<String>,
    pub gateway_payment_intent_id: Option<String>,
    pub authorize_error: Option<String>,
    pub authorized_at: Option<DateTime<Utc>>,
    pub captured_at: Option<DateTime<Utc>>,
    pub canceled_at: Option<DateTime<Utc>>,
    pub attempt_count: u32,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryAttempt {
    pub attempt_number: u32,
    pub scheduled_at: DateTime<Utc>,
    pub executed_at: Option<DateTime<Utc>>,
    pub result: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DunningCase {
    pub id: String,
    pub account_id: String,
    pub invoice_id: String,
    pub payment_intent_id: String,
    pub status: DunningStatus,
    pub attempt_schedule: Vec<RetryAttempt>,
    pub grace_period_end: DateTime<Utc>,
    pub final_attempt_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvent {
    pub id: String,
    pub event_identifier: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub processed_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialAuditLog {
    pub id: String,
    pub account_id: String,
    pub event_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub actor: Option<String>,
    pub before_state: serde_json::Value,
    pub after_state: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub id: String,
    pub account_id: String,
    pub plan_code: String,
    pub gateway: String,
    pub gateway_subscription_id: Option<String>,
    pub status: SubscriptionStatus,
    pub billing_interval: BillingInterval,
    pub credits_per_cycle: f64,
    pub autopay_enabled: bool,
    pub current_period_start: DateTime<Utc>,
    pub current_period_end: DateTime<Utc>,
    pub next_renewal_at: Option<DateTime<Utc>>,
    pub grace_period_until: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub last_payment_order_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// BillingContext represents the enriched billing state for an authenticated user.
/// This is populated by the auth middleware and includes current credit balance
/// and subscription status for entitlement checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingContext {
    /// Current credit balance (may be negative if allowed by policy)
    pub credit_balance: f64,
    
    /// Active subscription, if any (status must be Active)
    pub active_subscription: Option<Subscription>,
    
    /// Whether the user can currently generate lessons (has credits AND subscription is active or no subscription required)
    pub can_generate: bool,
    
    /// Timestamp when context was loaded
    pub loaded_at: DateTime<Utc>,
}

impl BillingContext {
    /// Create a BillingContext with loaded billing info
    pub fn new(
        credit_balance: f64,
        active_subscription: Option<Subscription>,
    ) -> Self {
        // User can generate if they have credits OR have active subscription with autopay
        let can_generate = credit_balance > 0.0
            || active_subscription
                .as_ref()
                .is_some_and(|sub| sub.status == SubscriptionStatus::Active && sub.autopay_enabled);

        Self {
            credit_balance,
            active_subscription,
            can_generate,
            loaded_at: Utc::now(),
        }
    }

    /// Check if user can generate with minimum required credits
    pub fn can_generate_with_min_credits(&self, min_credits: f64) -> bool {
        self.credit_balance >= min_credits
    }
}
