use async_trait::async_trait;

use ai_tutor_domain::{
    auth::TutorAccount,
    billing::{
        DunningCase, DunningStatus, FinancialAuditLog, Invoice, InvoiceLine, InvoiceStatus,
        PaymentIntent, PaymentIntentStatus, PaymentOrder, RetryAttempt, Subscription,
        WebhookEvent,
    },
    credits::{CreditBalance, CreditLedgerEntry, PromoCode},
    job::LessonGenerationJob,
    lesson_adaptive::LessonAdaptiveState,
    lesson_shelf::{LessonShelfItem, LessonShelfStatus},
    lesson::Lesson,
    runtime::{DirectorState, RuntimeActionExecutionRecord},
};

#[async_trait]
pub trait LessonRepository: Send + Sync {
    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String>;
    async fn get_lesson(&self, lesson_id: &str) -> Result<Option<Lesson>, String>;
}

#[async_trait]
pub trait LessonAdaptiveRepository: Send + Sync {
    async fn save_lesson_adaptive_state(&self, state: &LessonAdaptiveState) -> Result<(), String>;
    async fn get_lesson_adaptive_state(
        &self,
        lesson_id: &str,
    ) -> Result<Option<LessonAdaptiveState>, String>;
}

#[async_trait]
pub trait LessonShelfRepository: Send + Sync {
    async fn upsert_lesson_shelf_item(&self, item: &LessonShelfItem) -> Result<(), String>;
    async fn get_lesson_shelf_item(&self, item_id: &str) -> Result<Option<LessonShelfItem>, String>;
    async fn list_lesson_shelf_items_for_account(
        &self,
        account_id: &str,
        status: Option<LessonShelfStatus>,
        limit: usize,
    ) -> Result<Vec<LessonShelfItem>, String>;
    async fn mark_lesson_shelf_opened(&self, item_id: &str) -> Result<(), String>;
    async fn rename_lesson_shelf_item(&self, item_id: &str, title: &str) -> Result<(), String>;
    async fn archive_lesson_shelf_item(&self, item_id: &str) -> Result<(), String>;
    async fn reopen_lesson_shelf_item(&self, item_id: &str) -> Result<(), String>;
}

#[async_trait]
pub trait LessonJobRepository: Send + Sync {
    async fn create_job(&self, job: &LessonGenerationJob) -> Result<(), String>;
    async fn update_job(&self, job: &LessonGenerationJob) -> Result<(), String>;
    async fn get_job(&self, job_id: &str) -> Result<Option<LessonGenerationJob>, String>;
    async fn list_all_jobs(&self, limit: usize) -> Result<Vec<LessonGenerationJob>, String>;
}

#[async_trait]
pub trait RuntimeSessionRepository: Send + Sync {
    async fn save_runtime_session(
        &self,
        session_id: &str,
        director_state: &DirectorState,
    ) -> Result<(), String>;
    async fn get_runtime_session(&self, session_id: &str) -> Result<Option<DirectorState>, String>;
}

#[async_trait]
pub trait RuntimeActionExecutionRepository: Send + Sync {
    async fn save_runtime_action_execution(
        &self,
        record: &RuntimeActionExecutionRecord,
    ) -> Result<(), String>;
    async fn get_runtime_action_execution(
        &self,
        execution_id: &str,
    ) -> Result<Option<RuntimeActionExecutionRecord>, String>;
    async fn list_runtime_action_executions_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<RuntimeActionExecutionRecord>, String>;
}

#[async_trait]
pub trait TutorAccountRepository: Send + Sync {
    async fn save_tutor_account(&self, account: &TutorAccount) -> Result<(), String>;
    async fn get_tutor_account_by_id(
        &self,
        account_id: &str,
    ) -> Result<Option<TutorAccount>, String>;
    async fn get_tutor_account_by_google_id(
        &self,
        google_id: &str,
    ) -> Result<Option<TutorAccount>, String>;
    async fn get_tutor_account_by_phone(
        &self,
        phone_number: &str,
    ) -> Result<Option<TutorAccount>, String>;
    async fn list_all_tutor_accounts(&self, limit: usize) -> Result<Vec<TutorAccount>, String>;
}

#[async_trait]
pub trait CreditLedgerRepository: Send + Sync {
    async fn apply_credit_entry(&self, entry: &CreditLedgerEntry) -> Result<CreditBalance, String>;
    async fn get_credit_balance(&self, account_id: &str) -> Result<CreditBalance, String>;
    async fn list_credit_entries(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<CreditLedgerEntry>, String>;
    async fn list_all_credit_entries(&self, limit: usize) -> Result<Vec<CreditLedgerEntry>, String>;
}

#[async_trait]
pub trait PromoCodeRepository: Send + Sync {
    async fn save_promo_code(&self, code: &PromoCode) -> Result<(), String>;
    async fn get_promo_code(&self, code: &str) -> Result<Option<PromoCode>, String>;
    async fn list_all_promo_codes(&self, limit: usize) -> Result<Vec<PromoCode>, String>;
    /// Update a promo code (used when adding an account to the redeemed_by_accounts list).
    async fn update_promo_code_redemption(
        &self,
        code: &str,
        account_id: &str,
    ) -> Result<(), String>;
}

#[async_trait]
pub trait PaymentOrderRepository: Send + Sync {
    async fn save_payment_order(&self, order: &PaymentOrder) -> Result<(), String>;
    async fn get_payment_order_by_id(&self, order_id: &str) -> Result<Option<PaymentOrder>, String>;
    async fn get_payment_order_by_gateway_txn_id(
        &self,
        gateway_txn_id: &str,
    ) -> Result<Option<PaymentOrder>, String>;
    async fn list_payment_orders_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<PaymentOrder>, String>;
    async fn list_all_payment_orders(&self, limit: usize) -> Result<Vec<PaymentOrder>, String>;
}

#[async_trait]
pub trait SubscriptionRepository: Send + Sync {
    async fn save_subscription(&self, subscription: &Subscription) -> Result<(), String>;
    async fn get_subscription_by_id(&self, subscription_id: &str)
        -> Result<Option<Subscription>, String>;
    async fn get_subscription_by_gateway_subscription_id(
        &self,
        gateway_subscription_id: &str,
    ) -> Result<Option<Subscription>, String>;
    async fn list_all_subscriptions(&self, limit: usize) -> Result<Vec<Subscription>, String>;
    async fn list_subscriptions_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<Subscription>, String>;
    async fn list_subscriptions_due_for_renewal(
        &self,
        renewal_cutoff_rfc3339: &str,
        limit: usize,
    ) -> Result<Vec<Subscription>, String>;
}

#[async_trait]
pub trait InvoiceRepository: Send + Sync {
    async fn create_invoice(&self, invoice: &Invoice) -> Result<(), String>;
    async fn get_invoice(&self, invoice_id: &str) -> Result<Option<Invoice>, String>;
    async fn get_invoice_for_update(&self, invoice_id: &str) -> Result<Option<Invoice>, String>;
    async fn list_invoices_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<Invoice>, String>;
    async fn get_unpaid_invoices_for_account(
        &self,
        account_id: &str,
    ) -> Result<Vec<Invoice>, String>;
    async fn update_invoice_status(
        &self,
        invoice_id: &str,
        status: InvoiceStatus,
    ) -> Result<(), String>;
    async fn finalize_invoice(&self, invoice_id: &str, due_at_rfc3339: &str)
        -> Result<(), String>;
}

#[async_trait]
pub trait InvoiceLineRepository: Send + Sync {
    async fn add_line(&self, line: &InvoiceLine) -> Result<(), String>;
    async fn list_lines_for_invoice(&self, invoice_id: &str) -> Result<Vec<InvoiceLine>, String>;
    async fn delete_line(&self, line_id: &str) -> Result<(), String>;
    async fn sum_invoice_lines(&self, invoice_id: &str) -> Result<i64, String>;
}

#[async_trait]
pub trait PaymentIntentRepository: Send + Sync {
    async fn create_payment_intent(&self, pi: &PaymentIntent) -> Result<(), String>;
    async fn get_payment_intent(&self, pi_id: &str) -> Result<Option<PaymentIntent>, String>;
    async fn get_payment_intent_by_invoice_id(
        &self,
        invoice_id: &str,
    ) -> Result<Option<PaymentIntent>, String>;
    async fn update_payment_intent_status(
        &self,
        pi_id: &str,
        status: PaymentIntentStatus,
    ) -> Result<(), String>;
    async fn list_retryable_payment_intents(&self, now_rfc3339: &str)
        -> Result<Vec<PaymentIntent>, String>;
}

#[async_trait]
pub trait DunningCaseRepository: Send + Sync {
    async fn create_dunning_case(&self, dc: &DunningCase) -> Result<(), String>;
    async fn get_dunning_case(&self, dc_id: &str) -> Result<Option<DunningCase>, String>;
    async fn get_dunning_case_by_invoice_id(
        &self,
        invoice_id: &str,
    ) -> Result<Option<DunningCase>, String>;
    async fn list_active_dunning_cases(&self) -> Result<Vec<DunningCase>, String>;
    async fn update_dunning_case_status(
        &self,
        dc_id: &str,
        status: DunningStatus,
    ) -> Result<(), String>;
    async fn append_retry_attempt(&self, dc_id: &str, attempt: RetryAttempt)
        -> Result<(), String>;
}

#[async_trait]
pub trait WebhookEventRepository: Send + Sync {
    async fn create_webhook_event(&self, event: &WebhookEvent) -> Result<(), String>;
    async fn get_webhook_event(
        &self,
        event_identifier: &str,
    ) -> Result<Option<WebhookEvent>, String>;
}

#[async_trait]
pub trait FinancialAuditRepository: Send + Sync {
    async fn log_event(&self, audit: &FinancialAuditLog) -> Result<(), String>;
    async fn list_logs_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<FinancialAuditLog>, String>;
    async fn list_all_audit_logs(&self, limit: usize) -> Result<Vec<FinancialAuditLog>, String>;
}
