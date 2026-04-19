// Generated from BILLING_ARCHITECTURE.md
// Concrete Rust entities for AI-Tutor Billing System
// 
// Place this in: crates/domain/src/billing.rs
// Or import into existing billing module

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::collections::HashMap;

// ============================================================================
// INVOICE ENTITIES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: String,
    pub account_id: String,
    pub billing_cycle_start: DateTime<Utc>,
    pub billing_cycle_end: DateTime<Utc>,
    pub status: InvoiceStatus,
    pub amount_cents: i64,         // Total in INR paise (₹1 = 100 paise)
    pub amount_after_credits: i64, // Amount due after credit application
    pub created_at: DateTime<Utc>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub paid_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InvoiceStatus {
    #[serde(rename = "draft")]
    Draft,
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "finalized")]
    Finalized,
    #[serde(rename = "paid")]
    Paid,
    #[serde(rename = "partially_paid")]
    PartiallyPaid,
    #[serde(rename = "overdue")]
    Overdue,
    #[serde(rename = "uncollectible")]
    Uncollectible,
}

impl InvoiceStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            InvoiceStatus::Paid | InvoiceStatus::Uncollectible
        )
    }

    pub fn can_transition_to(&self, next: InvoiceStatus) -> bool {
        use InvoiceStatus::*;
        match (self, next) {
            (Draft, Finalized | Open) => true,
            (Finalized, Open) => true,
            (Open | Finalized, Paid) => true,
            (Open | Finalized, PartiallyPaid) => true,
            (PartiallyPaid, Paid) => true,
            (Open | PartiallyPaid, Overdue) => true,
            (Overdue, Paid | Uncollectible) => true,
            (_, Uncollectible) => true, // Hard stop from any state
            _ => false,
        }
    }
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InvoiceLineType {
    #[serde(rename = "subscription_base")]
    SubscriptionBase,
    #[serde(rename = "usage_overage")]
    UsageOverage,
    #[serde(rename = "add_on")]
    AddOn,
    #[serde(rename = "adjustment")]
    Adjustment,
    #[serde(rename = "tax")]
    TaxAmount,
}

// ============================================================================
// PAYMENT INTENT ENTITIES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentIntent {
    pub id: String,
    pub account_id: String,
    pub invoice_id: String,
    pub status: PaymentIntentStatus,
    pub amount_cents: i64,
    pub idempotency_key: String,
    pub payment_method_id: String,
    pub stripe_payment_intent_id: Option<String>,
    pub authorize_error: Option<String>,
    pub authorized_at: Option<DateTime<Utc>>,
    pub captured_at: Option<DateTime<Utc>>,
    pub canceled_at: Option<DateTime<Utc>>,
    pub attempt_count: u32,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaymentIntentStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "requires_action")]
    RequiresAction,
    #[serde(rename = "authorized")]
    Authorized,
    #[serde(rename = "captured")]
    Captured,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "abandoned")]
    Abandoned,
    #[serde(rename = "canceled")]
    Canceled,
}

impl PaymentIntentStatus {
    pub fn can_retry(&self) -> bool {
        matches!(self, PaymentIntentStatus::Failed | PaymentIntentStatus::Pending)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            PaymentIntentStatus::Captured
                | PaymentIntentStatus::Abandoned
                | PaymentIntentStatus::Canceled
        )
    }
}

// ============================================================================
// CREDIT TRANSACTION ENTITIES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditTransaction {
    pub id: String,
    pub account_id: String,
    pub kind: CreditTransactionKind,
    pub amount: f64, // Decimal; can be negative (usage)
    pub balance_after: f64,
    pub reason: String,
    pub related_invoice_id: Option<String>,
    pub related_payment_intent_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreditTransactionKind {
    #[serde(rename = "grant")]
    Grant,
    #[serde(rename = "consume")]
    Consume,
    #[serde(rename = "proration")]
    Proration,
    #[serde(rename = "manual")]
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditBalance {
    pub account_id: String,
    pub balance: f64,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// DUNNING ENTITIES
// ============================================================================

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DunningStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "recovered")]
    Recovered,
    #[serde(rename = "exhausted")]
    Exhausted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryAttempt {
    pub attempt_number: u32,
    pub scheduled_at: DateTime<Utc>,
    pub executed_at: Option<DateTime<Utc>>,
    pub result: Option<String>,
    pub error_code: Option<String>,
}

// ============================================================================
// ENTITLEMENT & ACCESS CONTROL
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectiveSubscriptionStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "active_with_grace")]
    ActiveWithGrace,
    #[serde(rename = "degraded")]
    Degraded,
    #[serde(rename = "pending_downgrade")]
    PendingDowngrade,
    #[serde(rename = "suspended")]
    Suspended,
}

impl EffectiveSubscriptionStatus {
    pub fn allows_lesson_generation(&self) -> bool {
        matches!(
            self,
            EffectiveSubscriptionStatus::Active | EffectiveSubscriptionStatus::ActiveWithGrace
        )
    }

    pub fn allows_read_operations(&self) -> bool {
        !matches!(self, EffectiveSubscriptionStatus::Suspended)
    }
}

// ============================================================================
// WEBHOOK & AUDIT ENTITIES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvent {
    pub id: String,
    pub event_identifier: String, // Stripe event ID or unique provider token
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
    pub entity_type: String, // "invoice", "payment_intent", "dunning_case"
    pub entity_id: String,
    pub actor: Option<String>, // user_id or "system:scheduler"
    pub before_state: serde_json::Value,
    pub after_state: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// REQUEST/RESPONSE DTOS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInvoiceDraftRequest {
    pub account_id: String,
    pub billing_cycle_start: DateTime<Utc>,
    pub billing_cycle_end: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInvoiceLineRequest {
    pub invoice_id: String,
    pub line_type: InvoiceLineType,
    pub description: String,
    pub amount_cents: i64,
    pub quantity: u32,
    pub unit_price_cents: i64,
    pub is_prorated: bool,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalizeInvoiceRequest {
    pub invoice_id: String,
    pub due_date_days: u32, // e.g., 7 for net-7 terms
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePaymentIntentRequest {
    pub account_id: String,
    pub invoice_id: String,
    pub payment_method_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttemptCaptureRequest {
    pub payment_intent_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDunningCaseRequest {
    pub account_id: String,
    pub invoice_id: String,
    pub payment_intent_id: String,
    pub grace_period_days: u32,
    pub retry_schedule: Vec<u32>, // [1, 3, 5, 7] = days after first attempt
}

// ============================================================================
// TRAIT DEFINITIONS (Repository Pattern)
// ============================================================================

use async_trait::async_trait;

#[async_trait]
pub trait InvoiceRepository: Send + Sync {
    async fn create_invoice(&self, invoice: &Invoice) -> Result<(), String>;
    async fn get_invoice(&self, invoice_id: &str) -> Result<Option<Invoice>, String>;
    async fn list_invoices_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<Invoice>, String>;
    async fn update_invoice_status(
        &self,
        invoice_id: &str,
        status: InvoiceStatus,
    ) -> Result<(), String>;
    async fn finalize_invoice(
        &self,
        invoice_id: &str,
        due_at: DateTime<Utc>,
    ) -> Result<(), String>;
}

#[async_trait]
pub trait InvoiceLineRepository: Send + Sync {
    async fn add_line(&self, line: &InvoiceLine) -> Result<(), String>;
    async fn list_lines_for_invoice(
        &self,
        invoice_id: &str,
    ) -> Result<Vec<InvoiceLine>, String>;
    async fn delete_line(&self, line_id: &str) -> Result<(), String>;
}

#[async_trait]
pub trait PaymentIntentRepository: Send + Sync {
    async fn create_payment_intent(&self, pi: &PaymentIntent) -> Result<(), String>;
    async fn get_payment_intent(&self, pi_id: &str) -> Result<Option<PaymentIntent>, String>;
    async fn get_payment_intent_for_invoice(
        &self,
        invoice_id: &str,
    ) -> Result<Option<PaymentIntent>, String>;
    async fn update_payment_intent_status(
        &self,
        pi_id: &str,
        status: PaymentIntentStatus,
    ) -> Result<(), String>;
    async fn increment_attempt_count(&self, pi_id: &str) -> Result<(), String>;
    async fn set_next_retry_at(
        &self,
        pi_id: &str,
        next_retry_at: DateTime<Utc>,
    ) -> Result<(), String>;
}

#[async_trait]
pub trait DunningCaseRepository: Send + Sync {
    async fn create_dunning_case(&self, dc: &DunningCase) -> Result<(), String>;
    async fn get_dunning_case(&self, dc_id: &str) -> Result<Option<DunningCase>, String>;
    async fn get_dunning_case_for_invoice(
        &self,
        invoice_id: &str,
    ) -> Result<Option<DunningCase>, String>;
    async fn list_active_dunning_cases(&self) -> Result<Vec<DunningCase>, String>;
    async fn update_dunning_status(
        &self,
        dc_id: &str,
        status: DunningStatus,
    ) -> Result<(), String>;
    async fn record_retry_attempt(
        &self,
        dc_id: &str,
        attempt: RetryAttempt,
    ) -> Result<(), String>;
}

#[async_trait]
pub trait WebhookEventRepository: Send + Sync {
    async fn create_webhook_event(&self, event: &WebhookEvent) -> Result<(), String>;
    async fn get_webhook_event(
        &self,
        event_identifier: &str,
    ) -> Result<Option<WebhookEvent>, String>;
    async fn webhook_already_processed(&self, event_identifier: &str) -> Result<bool, String> {
        self.get_webhook_event(event_identifier)
            .await
            .map(|opt| opt.is_some())
    }
}

#[async_trait]
pub trait FinancialAuditRepository: Send + Sync {
    async fn log_event(&self, audit: &FinancialAuditLog) -> Result<(), String>;
    async fn list_logs_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<FinancialAuditLog>, String>;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

pub fn compute_effective_subscription_status(
    subscription_status: &crate::billing::SubscriptionStatus,
    dunning_case: Option<(&DunningCase, DateTime<Utc>)>,
    invoice_status: Option<InvoiceStatus>,
) -> EffectiveSubscriptionStatus {
    use crate::billing::SubscriptionStatus;

    match (subscription_status, dunning_case, invoice_status) {
        // Happy path: subscription active, no dunning, invoice paid
        (SubscriptionStatus::Active, None, Some(InvoiceStatus::Paid)) => {
            EffectiveSubscriptionStatus::Active
        }
        // Grace period: dunning active but within grace window
        (SubscriptionStatus::Active, Some((dc, now)), _)
            if dc.status == DunningStatus::Active && now < dc.grace_period_end =>
        {
            EffectiveSubscriptionStatus::ActiveWithGrace
        }
        // Hard stop: dunning exhausted or invoice uncollectible
        (_, Some((dc, _)), _) if dc.status == DunningStatus::Exhausted => {
            EffectiveSubscriptionStatus::Suspended
        }
        (_, _, Some(InvoiceStatus::Uncollectible)) => EffectiveSubscriptionStatus::Suspended,
        // Downgrade pending
        (SubscriptionStatus::Downgrading, _, _) => EffectiveSubscriptionStatus::PendingDowngrade,
        // Default: degraded
        _ => EffectiveSubscriptionStatus::Degraded,
    }
}

pub fn generate_idempotency_key(invoice_id: &str, attempt_count: u32) -> String {
    format!("{}:{}", invoice_id, attempt_count)
}

pub fn format_currency(amount_paise: i64) -> String {
    let rupees = amount_paise / 100;
    let paise = amount_paise % 100;
    if paise == 0 {
        format!("₹{}", rupees)
    } else {
        format!("₹{}.{:02}", rupees, paise)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invoice_status_transitions() {
        let draft = InvoiceStatus::Draft;
        assert!(draft.can_transition_to(InvoiceStatus::Finalized));
        assert!(draft.can_transition_to(InvoiceStatus::Open));
        assert!(!draft.can_transition_to(InvoiceStatus::Paid));

        let open = InvoiceStatus::Open;
        assert!(open.can_transition_to(InvoiceStatus::Paid));
        assert!(open.can_transition_to(InvoiceStatus::Overdue));
        assert!(!open.can_transition_to(InvoiceStatus::Draft));
    }

    #[test]
    fn test_payment_intent_status_can_retry() {
        assert!(PaymentIntentStatus::Failed.can_retry());
        assert!(PaymentIntentStatus::Pending.can_retry());
        assert!(!PaymentIntentStatus::Captured.can_retry());
    }

    #[test]
    fn test_idempotency_key_format() {
        let key = generate_idempotency_key("inv_123", 1);
        assert_eq!(key, "inv_123:1");

        let key2 = generate_idempotency_key("inv_123", 2);
        assert_eq!(key2, "inv_123:2");
        assert_ne!(key, key2);
    }

    #[test]
    fn test_currency_formatting() {
        assert_eq!(format_currency(10000), "₹100");
        assert_eq!(format_currency(10050), "₹100.50");
        assert_eq!(format_currency(99), "₹0.99");
    }
}
