//! Request/response DTOs for the AI-Tutor API.
//!
//! Extracted from `app.rs` as part of the modularization (refactor Phase 1).
//! These are pure data types: structs and enums carrying serde derives only.
//! No handler logic, no trait impls, no middleware.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use ai_tutor_domain::{
    credits::CreditEntryKind,
    job::LessonGenerationJob,
    billing::FinancialAuditLog,
    credits::PromoCode,
    scene::ProjectConfig,
};

/// Default value for [`PblRuntimeChatMessage::kind`] used by serde when the
/// field is absent in the incoming payload.
fn default_pbl_chat_message_kind() -> String {
    "agent".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GenerateLessonPayload {
    pub requirement: String,
    pub language: Option<String>,
    pub model: Option<String>,
    pub pdf_text: Option<String>,
    pub pdf_images: Option<Vec<String>>,
    pub enable_web_search: Option<bool>,
    pub enable_image_generation: Option<bool>,
    pub enable_video_generation: Option<bool>,
    pub enable_tts: Option<bool>,
    pub agent_mode: Option<String>,
    pub user_nickname: Option<String>,
    pub user_bio: Option<String>,
    pub account_id: Option<String>,
    /// AI model tier: "basic" | "standard" | "premium"
    pub quality_mode: Option<String>,
    /// Pedagogy style: "explain" | "revision" | "exam" | "placement_prep"
    pub learning_mode: Option<String>,
    /// Whether the user has consented to extra scenes beyond the target count.
    /// Extra scenes are billed at reduced margin.
    #[serde(default)]
    pub extra_scenes_consented: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateLessonResponse {
    pub lesson_id: String,
    pub job_id: String,
    pub url: String,
    pub scenes_count: usize,
}

/// Response from the lesson preview endpoint (no LLM call).
/// Returns deterministic budget information so the frontend can show
/// extra scene costs before the user commits to generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonPreviewResponse {
    /// AI model tier resolved from the request.
    pub quality_mode: String,
    /// Pedagogy style resolved from the request.
    pub learning_mode: String,
    /// Topic complexity level detected from the requirement text.
    pub complexity_level: String,
    /// Ideal scene count the LLM should target.
    pub target_scenes: usize,
    /// Hard upper bound never exceeded.
    pub hard_max_scenes: usize,
    /// Extra scenes available at reduced margin (user consent required).
    pub extra_scenes_available: usize,
    /// Base context hold fee.
    pub base_credits: f64,
    /// Estimated additional credits burned.
    pub extra_credits: f64,
    /// Total credits estimated.
    pub total_credits_if_extra: f64,
    /// Whether user consent is required to proceed (always false in V2 telemetry).
    pub requires_consent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonShelfItemResponse {
    pub id: String,
    pub lesson_id: String,
    pub source_job_id: Option<String>,
    pub title: String,
    pub subject: Option<String>,
    pub language: Option<String>,
    pub status: String,
    pub progress_pct: i32,
    pub last_opened_at: Option<String>,
    pub archived_at: Option<String>,
    pub thumbnail_url: Option<String>,
    pub failure_reason: Option<String>,
    pub group_id: Option<String>,
    pub is_shared: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonShelfListResponse {
    pub items: Vec<LessonShelfItemResponse>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LessonShelfPatchRequest {
    pub title: Option<String>,
    pub progress_pct: Option<i32>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LessonShelfMarkOpenedRequest {
    pub lesson_id: String,
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GradeQuizRequest {
    pub lesson_id: String,
    pub scene_id: String,
    pub answers: Vec<GradeQuizAnswer>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GradeQuizAnswer {
    pub question_id: String,
    pub answer: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GradeQuizResponse {
    pub total_questions: usize,
    pub correct_count: usize,
    pub score_pct: f32,
    pub question_results: Vec<QuestionResult>,
    pub feedback: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuestionResult {
    pub question_id: String,
    pub is_correct: bool,
    pub correct_answer: Vec<String>,
    pub user_answer: Vec<String>,
    pub explanation: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GoogleAuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GoogleOneTapRequest {
    pub credential: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleAuthLoginResponse {
    pub authorization_url: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemConfig {
    pub lesson_backend: String,
    pub storage_backend: String,
    pub notifications_backend: String,
    pub storage_connection_url: String,
    pub cache_backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorUser {
    pub account_id: String,
    pub email: Option<String>,
    pub phone_number: Option<String>,
    pub created_at_unix: i64,
    pub plan: Option<String>,
    pub credits: f64,
    pub school_id: Option<String>,
    pub promo_codes_used: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorUsersListResponse {
    pub users: Vec<OperatorUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorSettingsResponse {
    pub operator_roles: String,
    pub api_base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorJobsListResponse {
    pub jobs: Vec<ai_tutor_domain::job::LessonGenerationJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorAuditLogsResponse {
    pub logs: Vec<ai_tutor_domain::billing::FinancialAuditLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorEmailListResponse {
    pub emails: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddOperatorEmailRequest {
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddOperatorEmailResponse {
    pub added: bool,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveOperatorEmailResponse {
    pub removed: bool,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToggleMaintenanceResponse {
    pub status: &'static str,
    pub is_maintenance_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustCreditsRequest {
    pub amount: f64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustCreditsResponse {
    pub account_id: String,
    pub new_balance: f64,
    pub amount: f64,
    pub kind: CreditEntryKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchoolResponse {
    pub id: String,
    pub name: String,
    pub operator_email: String,
    pub institution_type: String,
    pub description: Option<String>,
    pub plan: String,
    pub credit_pool: f64,
    pub member_count: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchoolsListResponse {
    pub schools: Vec<SchoolResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSchoolRequest {
    pub name: String,
    pub operator_email: String,
    pub institution_type: Option<String>,
    pub description: Option<String>,
    pub plan: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchoolMember {
    pub account_id: String,
    pub email: String,
    pub plan: Option<String>,
    pub credits: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchoolMembersResponse {
    pub school_id: String,
    pub school_name: String,
    pub members: Vec<SchoolMember>,
}

#[derive(Debug, Deserialize)]
pub struct AssignUserSchoolRequest {
    pub account_id: String,
    /// If Some, assigns user to the school. If None, removes the user from any school.
    pub school_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ContactEnterpriseRequest {
    pub school_name: String,
    pub contact_name: String,
    pub contact_email: String,
    pub contact_phone: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct BulkProvisionMembersRequest {
    pub school_id: String,
    pub emails: Vec<String>,
    pub plan_code: String,
}

#[derive(Debug, Serialize)]
pub struct BulkProvisionMembersResponse {
    pub added: usize,
    pub updated: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct GenerateSchoolInvoiceRequest {
    pub school_id: String,
    pub due_date: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct GenerateSchoolInvoiceResponse {
    pub invoice_id: String,
    pub amount_cents: i64,
    pub payment_link: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SchoolInvoiceResponse {
    pub id: String,
    pub amount_cents: i64,
    pub payment_link: Option<String>,
    pub status: String,
    pub due_at: String,
    pub created_at: String,
    pub paid_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ContactEnterpriseResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSessionResponse {
    pub account_id: String,
    pub status: String,
    pub email: String,
    pub phone_number: Option<String>,
    pub redirect_to: String,
    pub partial_auth_token: Option<String>,
    #[serde(default)]
    pub session_token: Option<String>,
    /// Opaque refresh token for silent session renewal.
    /// Clients should store this securely and use it to obtain a new
    /// access token when the current one expires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Seconds until the access (session) token expires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorOtpRequest {
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorOtpVerifyRequest {
    pub email: String,
    pub otp_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorOtpResponse {
    pub ok: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorOtpChallenge {
    pub otp_hash: String,
    pub expires_at_unix: i64,
    pub attempts_remaining: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorSessionState {
    pub operator_email: String,
    pub role: String,
    pub created_at_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BindPhoneRequest {
    pub firebase_id_token: String,
    pub partial_auth_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditBalanceResponse {
    pub account_id: String,
    pub balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLedgerEntryResponse {
    pub id: String,
    pub kind: String,
    pub amount: f64,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLedgerResponse {
    pub account_id: String,
    pub entries: Vec<CreditLedgerEntryResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingCatalogItemResponse {
    pub product_code: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub credits: f64,
    pub currency: String,
    pub amount_minor: i64,
    pub amount_minor_usd: i64,
    pub gst_amount_minor: i64,
    pub allowed_quality_modes: Vec<String>,
    pub allowed_learning_modes: Vec<String>,
    pub is_highlighted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingCatalogResponse {
    pub gateway: String,
    pub items: Vec<BillingCatalogItemResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckoutSessionResponse {
    pub order_id: String,
    pub account_id: String,
    pub gateway: String,
    pub gateway_txn_id: String,
    pub checkout_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentOrderResponse {
    pub id: String,
    pub account_id: String,
    pub product_code: String,
    pub kind: String,
    pub gateway: String,
    pub gateway_txn_id: String,
    pub gateway_payment_id: Option<String>,
    pub status: String,
    pub currency: String,
    pub amount_minor: i64,
    pub credits_to_grant: f64,
    pub checkout_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentOrderListResponse {
    pub orders: Vec<PaymentOrderResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EasebuzzCallbackResponse {
    pub order_id: String,
    pub status: String,
    pub credited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingReportResponse {
    pub gateway: String,
    pub gateway_currency: String,
    pub total_payment_orders: usize,
    pub successful_payment_orders: usize,
    pub failed_payment_orders: usize,
    pub pending_payment_orders: usize,
    pub paid_credits_granted: f64,
    pub lesson_credits_debited: f64,
    pub provider_estimated_total_cost_microusd: u64,
    pub provider_reported_total_cost_microusd: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingMaintenanceResponse {
    pub renewed_subscriptions: usize,
    pub revoked_subscriptions: usize,
    pub retried_payment_intents: usize,
    pub exhausted_dunning_cases: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingEntitlementResponse {
    pub account_id: String,
    pub credit_balance: f64,
    pub can_generate: bool,
    pub has_active_subscription: bool,
    pub active_subscription: Option<SubscriptionResponse>,
    pub blocking_unpaid_invoice_count: usize,
    pub active_dunning_case_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingInvoiceSummaryResponse {
    pub id: String,
    pub invoice_type: String,
    pub status: String,
    pub amount_cents: i64,
    pub amount_after_credits: i64,
    pub billing_cycle_start: String,
    pub billing_cycle_end: String,
    pub due_at: Option<String>,
    pub paid_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingDashboardResponse {
    pub entitlement: BillingEntitlementResponse,
    pub recent_orders: Vec<PaymentOrderResponse>,
    pub recent_ledger_entries: Vec<CreditLedgerEntryResponse>,
    pub recent_invoices: Vec<BillingInvoiceSummaryResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSubscriptionRequest {
    pub plan_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCheckoutRequest {
    pub product_code: String,
    pub gateway: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionResponse {
    pub id: String,
    pub account_id: String,
    pub plan_code: String,
    pub status: String,
    pub billing_interval: String,
    pub credits_per_cycle: f64,
    pub autopay_enabled: bool,
    pub current_period_start: String,
    pub current_period_end: String,
    pub next_renewal_at: Option<String>,
    pub grace_period_until: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionListResponse {
    pub subscription: Option<SubscriptionResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelSubscriptionRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelSubscriptionResponse {
    pub id: String,
    pub status: String,
    pub cancelled_at: String,
}

/// Operator console response types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorUserStatsResponse {
    pub total_users: usize,
    pub active_users_today: usize,
    pub active_users_week: usize,
    pub active_users_month: usize,
    pub new_users_today: usize,
    pub new_users_week: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorSubscriptionStatsResponse {
    pub total_subscriptions: usize,
    pub active_subscriptions: usize,
    pub cancelled_subscriptions: usize,
    pub churned_users_month: usize,
    pub revenue_monthly: f64,
    pub revenue_rolling_30d: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorPaymentStatsResponse {
    pub total_payments: usize,
    pub successful_payments: usize,
    pub failed_payments: usize,
    pub success_rate: f64,
    pub total_revenue: f64,
    pub average_transaction_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorPromoCodeStatsResponse {
    pub total_promo_codes: usize,
    pub active_promo_codes: usize,
    pub total_redemptions: usize,
    pub total_credits_granted: f64,
    pub average_redemption_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorOverviewResponse {
    pub users: OperatorUserStatsResponse,
    pub subscriptions: OperatorSubscriptionStatsResponse,
    pub payments: OperatorPaymentStatsResponse,
    pub promo_codes: OperatorPromoCodeStatsResponse,
}



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePromoCodeRequest {
    pub code: String,
    pub grant_credits: f64,
    pub max_redemptions: Option<usize>,
    pub max_accounts: Option<usize>,
    pub max_uses_per_account: Option<usize>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorPromoCodeListResponse {
    pub promo_codes: Vec<ai_tutor_domain::credits::PromoCode>,
}

/// API cost tracking response for the operator console.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiCostByComponent {
    pub component: String,
    pub provider: String,
    pub model_id: String,
    pub request_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiCostPerUser {
    pub account_id: String,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub revenue_inr: f64,
    pub api_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorApiCostsResponse {
    pub total_cost_usd_30d: f64,
    pub openrouter_cost_usd: f64,
    pub groq_cost_usd: f64,
    pub tts_cost_usd: f64,
    pub tavily_cost_usd: f64,
    /// Estimated gross margin: (revenue_inr/84 - api_cost_usd) / (revenue_inr/84)
    pub estimated_margin_30d: f64,
    pub by_component: Vec<ApiCostByComponent>,
    pub per_user: Vec<ApiCostPerUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonApiCostsResponse {
    pub lesson_id: String,
    pub records: Vec<OperatorUsageRecord>,
    pub total_cost_usd: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorUsageRecord {
    pub component: String,
    pub provider: String,
    pub model_id: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiCostQuery {
    pub days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderBurnRate {
    pub cost_usd: f64,
    pub pct: f64,
    pub queries: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HourlyBurn {
    pub hour: String,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelBurnRate {
    pub model: String,
    pub cost_usd: f64,
    pub queries: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BurnRateResponse {
    pub period_hours: i64,
    pub total_burn_usd: f64,
    pub by_provider: HashMap<String, ProviderBurnRate>,
    pub hourly_burn: Vec<HourlyBurn>,
    pub top_models: Vec<ModelBurnRate>,
}

#[derive(Debug, Deserialize)]
pub struct BurnRateQuery {
    pub hours: Option<i64>,
    pub per_user: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalUsageReportRequest {
    pub model: String,
    pub step: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub quality_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeActionAckRequest {
    pub session_id: String,
    pub runtime_session_id: Option<String>,
    pub runtime_session_mode: Option<String>,
    pub execution_id: String,
    pub action_name: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeActionAckResponse {
    pub accepted: bool,
    pub duplicate: bool,
    pub current_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PblRuntimeChatRequest {
    pub message: String,
    pub project_config: ProjectConfig,
    pub workspace: PblRuntimeWorkspaceState,
    pub recent_messages: Vec<PblRuntimeChatMessage>,
    pub user_role: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PblRuntimeWorkspaceState {
    #[serde(alias = "current_issue_id")]
    pub active_issue_id: Option<String>,
    pub issues: Vec<PblRuntimeIssueState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PblRuntimeIssueState {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(default, alias = "person_in_charge")]
    pub owner_role: Option<String>,
    #[serde(default)]
    pub checkpoints: Vec<String>,
    #[serde(default)]
    pub completed_checkpoint_ids: Vec<String>,
    #[serde(default, alias = "is_done")]
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PblRuntimeChatMessage {
    #[serde(default = "default_pbl_chat_message_kind")]
    pub kind: String,
    pub agent_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PblRuntimeChatResponse {
    pub messages: Vec<PblRuntimeChatMessage>,
    pub workspace: Option<PblRuntimeWorkspaceState>,
    pub resolved_agent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrRequest {
    pub audio_url: String,
    pub model_string: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrResponse {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum CancelLessonJobOutcome {
    Cancelled(LessonGenerationJob),
    AlreadyRunning,
    NotFound,
}

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum ResumeLessonJobOutcome {
    Resumed(LessonGenerationJob),
    AlreadyQueuedOrRunning,
    MissingSnapshot,
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRuntimeStatusResponse {
    pub label: String,
    pub available: bool,
    pub consecutive_failures: u32,
    pub cooldown_remaining_ms: u64,
    pub total_requests: u64,
    pub total_successes: u64,
    pub total_failures: u64,
    pub last_error: Option<String>,
    pub last_success_unix_ms: Option<u64>,
    pub last_failure_unix_ms: Option<u64>,
    pub total_latency_ms: u64,
    pub average_latency_ms: Option<u64>,
    pub last_latency_ms: Option<u64>,
    pub estimated_input_tokens: u64,
    pub estimated_output_tokens: u64,
    pub estimated_total_cost_microusd: u64,
    pub provider_reported_input_tokens: u64,
    pub provider_reported_output_tokens: u64,
    pub provider_reported_total_tokens: u64,
    pub provider_reported_total_cost_microusd: u64,
    pub streaming_path: String,
    pub native_streaming: bool,
    pub native_typed_streaming: bool,
    pub compatibility_streaming: bool,
    pub cooperative_cancellation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedModelProfileResponse {
    pub provider_id: String,
    pub provider_name: String,
    pub model_id: String,
    pub model_name: Option<String>,
    pub context_window: Option<i32>,
    pub output_window: Option<i32>,
    pub cost_tier: Option<String>,
    pub input_cost_per_1m_usd: Option<f64>,
    pub output_cost_per_1m_usd: Option<f64>,
    pub supports_tools: bool,
    pub supports_vision: bool,
    pub supports_thinking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationModelPolicyResponse {
    pub outlines_model: String,
    pub scene_content_model: String,
    pub scene_actions_model: String,
    pub scene_actions_fallback_model: Option<String>,
    pub agent_profiles_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthBlueprintStatusResponse {
    pub google_oauth_enabled: bool,
    pub google_client_id_configured: bool,
    pub google_client_secret_configured: bool,
    pub google_redirect_uri: Option<String>,
    pub firebase_phone_auth_enabled: bool,
    pub firebase_project_id: Option<String>,
    pub partial_auth_secret_configured: bool,
    pub verify_phone_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentBlueprintResponse {
    pub frontend_output_mode: String,
    pub frontend_deployment_mode: String,
    pub recommended_targets: Vec<String>,
    pub vercel_recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditPolicyResponse {
    pub base_workflow_slide_credits: f64,
    pub image_attachment_credits: f64,
    pub tts_per_slide_credits: f64,
    pub starter_grant_credits: f64,
    pub basic_monthly_price_usd: f64,
    pub basic_monthly_credits: f64,
    pub standard_monthly_price_usd: f64,
    pub standard_monthly_credits: f64,
    pub premium_monthly_price_usd: f64,
    pub premium_monthly_credits: f64,
    pub bundle_small_price_usd: f64,
    pub bundle_small_credits: f64,
    pub bundle_large_price_usd: f64,
    pub bundle_large_credits: f64,
    pub tts_margin_review_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatusResponse {
    pub status: &'static str,
    pub current_model: Option<String>,
    pub deployment_environment: String,
    pub deployment_revision: Option<String>,
    pub rollout_phase: String,
    pub generation_model_policy: GenerationModelPolicyResponse,
    pub selected_model_profile: Option<SelectedModelProfileResponse>,
    pub auth_blueprint: AuthBlueprintStatusResponse,
    pub deployment_blueprint: DeploymentBlueprintResponse,
    pub credit_policy: CreditPolicyResponse,
    pub configured_provider_priority: Vec<String>,
    pub runtime_session_modes: Vec<String>,
    pub runtime_native_streaming_required: bool,
    pub runtime_native_streaming_selectors: Vec<String>,
    pub runtime_native_typed_streaming_required: bool,
    pub runtime_degraded_single_turn_only: bool,
    pub runtime_alert_level: String,
    pub runtime_alerts: Vec<String>,
    pub asset_backend: String,
    pub queue_backend: String,
    pub lesson_backend: String,
    pub job_backend: String,
    pub runtime_session_backend: String,
    pub queue_pending_jobs: usize,
    pub queue_active_leases: usize,
    pub queue_stale_leases: usize,
    pub queue_status_error: Option<String>,
    pub queue_poll_ms: u64,
    pub queue_claim_heartbeat_interval_ms: u64,
    pub queue_stale_timeout_ms: u64,
    pub provider_total_requests: u64,
    pub provider_total_successes: u64,
    pub provider_total_failures: u64,
    pub provider_total_latency_ms: u64,
    pub provider_average_latency_ms: Option<u64>,
    pub provider_estimated_input_tokens: u64,
    pub provider_estimated_output_tokens: u64,
    pub provider_estimated_total_cost_microusd: u64,
    pub provider_reported_input_tokens: u64,
    pub provider_reported_output_tokens: u64,
    pub provider_reported_total_tokens: u64,
    pub provider_reported_total_cost_microusd: u64,
    pub provider_runtime: Vec<ProviderRuntimeStatusResponse>,
    pub provider_status_error: Option<String>,
    pub db_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsGateCheckResponse {
    pub id: String,
    pub required: bool,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsGateResponse {
    pub pass: bool,
    pub mode: String,
    pub checks: Vec<OpsGateCheckResponse>,
}

