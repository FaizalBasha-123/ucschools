#![allow(dead_code)]
#![allow(clippy::large_enum_variant)]
#![allow(clippy::match_like_matches_macro)]

use std::{collections::HashMap, path::PathBuf, sync::Arc};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use axum::{
    body::Body,
    extract::{Extension, Form, Path, Query, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::sse::{Event, KeepAlive, Sse},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use jsonwebtoken::{
    decode, decode_header, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use uuid::Uuid;
use rand::Rng;

use sha2::Digest;

use crate::queue::{
    claim_heartbeat_interval_ms, spawn_one_shot_queue_kick, stale_working_timeout_ms,
    FileBackedLessonQueue, QueueCancelResult, QueueLeaseCounts, QueuedLessonRequest,
};
use ai_tutor_domain::{
    auth::{TutorAccount, TutorAccountStatus},
    billing::{
        BillingContext, BillingInterval, BillingProductKind, Invoice, InvoiceLine,
        InvoiceLineType, InvoiceStatus, InvoiceType, PaymentIntent, PaymentIntentStatus,
        PaymentOrder, PaymentOrderStatus, RetryAttempt, Subscription, SubscriptionStatus,
        DunningCase, DunningStatus, FinancialAuditLog, WebhookEvent,
    },
    credits::{CreditEntryKind, CreditLedgerEntry, RedeemPromoCodeRequest, RedeemPromoCodeResponse},
    generation::{AgentMode, Language, LessonGenerationRequest, PdfContent, UserRequirements},
    job::{
        LessonGenerationJob, LessonGenerationJobStatus, LessonGenerationStep,
        QueuedLessonJobSnapshot,
    },
    lesson_adaptive::{LessonAdaptiveState, LessonAdaptiveStatus},
    lesson_shelf::{LessonShelfItem, LessonShelfStatus},
    lesson::Lesson,
    runtime::{
        DirectorState, RuntimeActionExecutionRecord, RuntimeActionExecutionStatus,
        RuntimeSessionMode, StatelessChatRequest,
    },
    scene::{ProjectAgentRole, ProjectConfig},
};
use ai_tutor_media::storage::{DynAssetStore, LocalFileAssetStore, R2AssetStore};
use ai_tutor_orchestrator::{
    chat_graph::{self, ChatGraphEventKind},
    generation::LlmGenerationPipeline,
    pedagogy_router::resolve_chat_pedagogy_route,
    pipeline::{build_queued_job, LessonGenerationOrchestrator},
};
use ai_tutor_providers::{
    config::ServerProviderConfig,
    registry::built_in_providers,
    resolve::resolve_model,
    traits::{
        ImageProviderFactory, LlmProviderFactory, ProviderRuntimeStatus, TtsProviderFactory,
        VideoProviderFactory,
    },
};
use ai_tutor_runtime::session::{
    action_execution_metadata_for_name, canonical_runtime_action_params, lesson_playback_events,
    ActionAckPolicy, PlaybackEvent, TutorEventKind, TutorStreamEvent, TutorTurnStatus,
};
use ai_tutor_storage::{
    filesystem::FileStorage,
    repositories::{
        CreditLedgerRepository, DunningCaseRepository, FinancialAuditRepository,
        InvoiceLineRepository, InvoiceRepository, LessonAdaptiveRepository,
        LessonJobRepository, LessonRepository, LessonShelfRepository,
        PaymentIntentRepository, PaymentOrderRepository, PromoCodeRepository,
        RuntimeActionExecutionRepository, RuntimeSessionRepository, SubscriptionRepository,
        TutorAccountRepository, WebhookEventRepository,
    },
};
use crate::notifications::{
    notification_service_from_env, GracePeriodWarningNotification, NotificationService,
    OperatorOtpNotification, PaymentFailedNotification, PaymentSuccessNotification,
    ServiceRestrictedNotification,
};

use chrono::{Datelike, LocalResult, TimeZone};
use chrono_tz::Tz;

#[derive(Clone)]
pub struct AppState {
    pub service: Arc<dyn LessonAppService>,
}

#[derive(Clone, Debug)]
struct AuthenticatedAccountContext {
    account_id: String,
    /// Enriched billing context (credit balance, subscription status)
    /// Loaded by middleware after account is authenticated
    billing_context: Option<BillingContext>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum ApiRole {
    Reader,
    Writer,
    Admin,
}

#[derive(Clone, Debug)]
struct ApiAuthConfig {
    enabled: bool,
    tokens: HashMap<String, ApiRole>,
    require_https: bool,
    operator_otp_enabled: bool,
    operator_session_cookie_name: String,
}

impl ApiAuthConfig {
    fn from_env() -> Self {
        let mut tokens = HashMap::new();
        if let Ok(secret) = std::env::var("AI_TUTOR_API_SECRET") {
            let trimmed = secret.trim();
            if !trimmed.is_empty() {
                tokens.insert(trimmed.to_string(), ApiRole::Admin);
            }
        }
        if let Ok(configured) = std::env::var("AI_TUTOR_API_TOKENS") {
            for entry in configured.split(',') {
                let item = entry.trim();
                if item.is_empty() {
                    continue;
                }
                let mut pair = item.splitn(2, '=');
                let token = pair.next().unwrap_or_default().trim();
                let role_raw = pair.next().unwrap_or("reader").trim();
                if token.is_empty() {
                    continue;
                }
                if let Some(role) = parse_api_role(role_raw) {
                    tokens.insert(token.to_string(), role);
                }
            }
        }

        let enabled = !tokens.is_empty()
            || matches!(
                std::env::var("AI_TUTOR_AUTH_REQUIRED")
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase()
                    .as_str(),
                "1" | "true" | "yes" | "on"
            );
        let require_https = matches!(
            std::env::var("AI_TUTOR_REQUIRE_HTTPS")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        );
        let operator_otp_enabled = matches!(
            std::env::var("AI_TUTOR_OPERATOR_OTP_ENABLED")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        );
        let operator_session_cookie_name = std::env::var("AI_TUTOR_OPERATOR_SESSION_COOKIE_NAME")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "ai_tutor_ops_session".to_string());
        Self {
            enabled,
            tokens,
            require_https,
            operator_otp_enabled,
            operator_session_cookie_name,
        }
    }
}

fn parse_api_role(value: &str) -> Option<ApiRole> {
    match value.trim().to_ascii_lowercase().as_str() {
        "reader" | "read" => Some(ApiRole::Reader),
        "writer" | "write" => Some(ApiRole::Writer),
        "admin" => Some(ApiRole::Admin),
        _ => None,
    }
}

fn build_cors_layer() -> CorsLayer {
    let allowed_origins = std::env::var("AI_TUTOR_CORS_ALLOW_ORIGINS")
        .ok()
        .map(|raw| {
            raw.split(',')
                .filter_map(|origin| HeaderValue::from_str(origin.trim()).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let layer = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::OPTIONS])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::HeaderName::from_static("x-account-id"),
        ]);

    if allowed_origins.is_empty() {
        layer.allow_origin(Any)
    } else {
        layer.allow_origin(allowed_origins)
    }
}

fn required_role_for_request(method: &axum::http::Method, path: &str) -> Option<ApiRole> {
    if *method == Method::OPTIONS {
        // CORS preflight must pass through unauthenticated so browsers can negotiate.
        return None;
    }
    if path == "/health" || path == "/api/health" {
        return None;
    }
    if path == "/api/auth/google/login"
        || path == "/api/auth/google/callback"
        || path == "/api/auth/bind-phone"
        || path == "/api/operator/auth/request-otp"
        || path == "/api/operator/auth/verify-otp"
        || path == "/api/operator/auth/logout"
    {
        return None;
    }
    if path == "/api/credits/me"
        || path == "/api/credits/ledger"
        || path == "/api/billing/catalog"
        || path == "/api/billing/checkout"
        || path == "/api/billing/orders"
        || path == "/api/billing/easebuzz/callback"
    {
        return None;
    }
    if path == "/api/system/status" {
        return Some(ApiRole::Admin);
    }
    if path == "/api/system/ops-gate" {
        return Some(ApiRole::Admin);
    }
    if path == "/api/admin/overview" {
        return Some(ApiRole::Admin);
    }
    if path == "/api/billing/report" {
        return Some(ApiRole::Admin);
    }
    if path == "/api/admin/stats/users"
        || path == "/api/admin/stats/subscriptions"
        || path == "/api/admin/stats/payments"
        || path == "/api/admin/stats/promo-codes"
        || path == "/api/admin/users"
        || path == "/api/admin/settings"
        || path == "/api/admin/jobs"
        || path == "/api/admin/audit-logs"
        || path == "/api/admin/system/toggle-maintenance"
    {
        return Some(ApiRole::Admin);
    }
    if method == &Method::POST {
        if path == "/api/lessons/generate"
            || path == "/api/lessons/generate-async"
            || path == "/api/lesson-shelf/mark-opened"
            || path == "/api/credits/redeem"
            || path == "/api/runtime/actions/ack"
            || path == "/api/runtime/pbl/chat"
            || path == "/api/runtime/chat/stream"
        {
            return Some(ApiRole::Writer);
        }
        if path.starts_with("/api/lesson-shelf/")
            && (path.ends_with("/archive")
                || path.ends_with("/reopen")
                || path.ends_with("/retry"))
        {
            return Some(ApiRole::Writer);
        }
        if path.starts_with("/api/lessons/jobs/") && path.ends_with("/cancel") {
            return Some(ApiRole::Admin);
        }
        if path.starts_with("/api/lessons/jobs/") && path.ends_with("/resume") {
            return Some(ApiRole::Admin);
        }
    }
    if method == &Method::GET
        && (path.starts_with("/api/lessons/")
            || path == "/api/lesson-shelf"
            || path.starts_with("/api/assets/media/")
            || path.starts_with("/api/assets/audio/"))
    {
        return Some(ApiRole::Reader);
    }
    if method == &Method::PATCH && path.starts_with("/api/lesson-shelf/") {
        return Some(ApiRole::Writer);
    }
    Some(ApiRole::Reader)
}

fn parse_bearer_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let mut parts = value.splitn(2, ' ');
    let scheme = parts.next()?.trim();
    let token = parts.next()?.trim();
    if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

fn request_is_https(req: &axum::extract::Request) -> bool {
    if let Some(value) = req
        .headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
    {
        if value
            .split(',')
            .next()
            .is_some_and(|proto| proto.trim().eq_ignore_ascii_case("https"))
        {
            return true;
        }
    }
    if let Some(value) = req.headers().get("forwarded").and_then(|v| v.to_str().ok()) {
        if value.to_ascii_lowercase().contains("proto=https") {
            return true;
        }
    }
    false
}

async fn auth_middleware(
    State(auth): State<ApiAuthConfig>,
    mut req: axum::extract::Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    if let Some(account_id) = extract_account_id(req.headers()) {
        // Insert basic context (billing will be enriched by handlers if needed)
        req.extensions_mut().insert(AuthenticatedAccountContext {
            account_id,
            billing_context: None,
        });
    }

    if auth.require_https
        && required_role_for_request(&method, &path).is_some()
        && !request_is_https(&req)
    {
        return ApiError {
            status: StatusCode::UPGRADE_REQUIRED,
            message: "https is required for this endpoint".to_string(),
        }
        .into_response();
    }

    let Some(required_role) = required_role_for_request(&method, &path) else {
        return next.run(req).await;
    };

    if !auth.enabled {
        return next.run(req).await;
    }

    let mut granted_role: Option<ApiRole> = parse_bearer_token(req.headers())
        .and_then(|token| auth.tokens.get(&token).cloned());

    if granted_role.is_none() && auth.operator_otp_enabled {
        if let Some(cookie_header) = req
            .headers()
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok())
        {
            if let Some(session_id) = parse_cookie(cookie_header, &auth.operator_session_cookie_name)
            {
                if let Ok(Some(session)) = load_operator_session(&session_id).await {
                    granted_role = parse_api_role(&session.role);
                    req.extensions_mut().insert(AuthenticatedAccountContext {
                        account_id: format!("operator:{}", session.operator_email),
                        billing_context: None,
                    });
                }
            }
        }
    }

    let Some(granted_role) = granted_role else {
        return ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "missing or invalid operator authentication".to_string(),
        }
        .into_response();
    };

    if granted_role < required_role {
        return ApiError {
            status: StatusCode::FORBIDDEN,
            message: "token role is not permitted for this endpoint".to_string(),
        }
        .into_response();
    }

    if req
        .extensions()
        .get::<AuthenticatedAccountContext>()
        .is_none()
    {
        let account_id = req
            .headers()
            .get("x-account-id")
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| "api-token:anonymous".to_string());

        req.extensions_mut().insert(AuthenticatedAccountContext {
            account_id,
            billing_context: None,
        });
    }

    if path.starts_with("/api/admin/")
        || path.starts_with("/api/system/")
        || path == "/api/billing/report"
    {
        if let Some(actor) = req
            .extensions()
            .get::<AuthenticatedAccountContext>()
            .map(|context| context.account_id.as_str())
        {
            info!(
                actor = actor,
                method = %method,
                path = %path,
                role = ?granted_role,
                "operator_audit_request"
            );
        }
    }

    next.run(req).await
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GenerateLessonPayload {
    pub requirement: String,
    pub language: Option<String>,
    pub model: Option<String>,
    pub pdf_text: Option<String>,
    pub enable_web_search: Option<bool>,
    pub enable_image_generation: Option<bool>,
    pub enable_video_generation: Option<bool>,
    pub enable_tts: Option<bool>,
    pub agent_mode: Option<String>,
    pub user_nickname: Option<String>,
    pub user_bio: Option<String>,
    pub account_id: Option<String>,
    pub generation_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateLessonResponse {
    pub lesson_id: String,
    pub job_id: String,
    pub url: String,
    pub scenes_count: usize,
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
pub struct GoogleAuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
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
pub struct AdminUser {
    pub account_id: String,
    pub email: Option<String>,
    pub created_at_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminUsersListResponse {
    pub users: Vec<AdminUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSettingsResponse {
    pub operator_roles: String,
    pub api_base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminJobsListResponse {
    pub jobs: Vec<ai_tutor_domain::job::LessonGenerationJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminAuditLogsResponse {
    pub logs: Vec<ai_tutor_domain::billing::FinancialAuditLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToggleMaintenanceResponse {
    pub status: &'static str,
    pub is_maintenance_mode: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OperatorOtpChallenge {
    otp_hash: String,
    expires_at_unix: i64,
    attempts_remaining: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OperatorSessionState {
    operator_email: String,
    role: String,
    created_at_unix: i64,
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
    pub credits: f64,
    pub currency: String,
    pub amount_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingCatalogResponse {
    pub gateway: String,
    pub items: Vec<BillingCatalogItemResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCheckoutRequest {
    pub product_code: String,
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

/// Admin console response types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminUserStatsResponse {
    pub total_users: usize,
    pub active_users_today: usize,
    pub active_users_week: usize,
    pub active_users_month: usize,
    pub new_users_today: usize,
    pub new_users_week: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSubscriptionStatsResponse {
    pub total_subscriptions: usize,
    pub active_subscriptions: usize,
    pub cancelled_subscriptions: usize,
    pub churned_users_month: usize,
    pub revenue_monthly: f64,
    pub revenue_rolling_30d: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminPaymentStatsResponse {
    pub total_payments: usize,
    pub successful_payments: usize,
    pub failed_payments: usize,
    pub success_rate: f64,
    pub total_revenue: f64,
    pub average_transaction_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminPromoCodeStatsResponse {
    pub total_promo_codes: usize,
    pub active_promo_codes: usize,
    pub total_redemptions: usize,
    pub total_credits_granted: f64,
    pub average_redemption_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminOverviewResponse {
    pub users: AdminUserStatsResponse,
    pub subscriptions: AdminSubscriptionStatsResponse,
    pub payments: AdminPaymentStatsResponse,
    pub promo_codes: AdminPromoCodeStatsResponse,
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
    pub plus_monthly_price_usd: f64,
    pub plus_monthly_credits: f64,
    pub pro_monthly_price_usd: f64,
    pub pro_monthly_credits: f64,
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

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartialAuthClaims {
    sub: String,
    email: String,
    google_id: String,
    exp: usize,
    iat: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionClaims {
    sub: String,
    email: String,
    status: String,
    exp: usize,
    iat: usize,
}

#[derive(Debug, Clone, Deserialize)]
struct GoogleTokenResponse {
    id_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct GoogleIdTokenClaims {
    sub: String,
    email: String,
    email_verified: bool,
    aud: String,
    iss: String,
    exp: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct FirebaseTokenClaims {
    sub: String,
    phone_number: Option<String>,
    aud: String,
    iss: String,
    exp: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthStateClaims {
    nonce: String,
    exp: usize,
    iat: usize,
}

#[derive(Debug, Clone, Deserialize)]
struct JwksResponse {
    keys: Vec<Jwk>,
}

#[derive(Debug, Clone, Deserialize)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
    #[allow(dead_code)]
    kty: Option<String>,
    #[allow(dead_code)]
    alg: Option<String>,
    #[serde(rename = "use")]
    #[allow(dead_code)]
    use_field: Option<String>,
}

#[derive(Debug, Clone)]
struct BillingProductDefinition {
    product_code: String,
    kind: BillingProductKind,
    title: String,
    credits: f64,
    currency: String,
    amount_minor: i64,
}

#[derive(Debug, Clone)]
struct EasebuzzConfig {
    key: String,
    salt: String,
    base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct EasebuzzInitiatePaymentResponse {
    status: i32,
    data: Option<String>,
}

#[derive(Debug, Clone)]
enum ResolvedRuntimeSessionMode {
    StatelessClientState,
    ManagedRuntimeSession {
        persistence_session_id: String,
        create_if_missing: bool,
    },
}

#[derive(Debug, Clone)]
struct GenerationModelPolicy {
    outlines_model: String,
    scene_content_model: String,
    scene_actions_model: String,
    scene_actions_fallback_model: Option<String>,
}

#[async_trait]
pub trait LessonAppService: Send + Sync {
    async fn google_login(&self) -> Result<GoogleAuthLoginResponse>;
    async fn google_callback(&self, query: GoogleAuthCallbackQuery) -> Result<AuthSessionResponse>;
    async fn bind_phone(&self, payload: BindPhoneRequest) -> Result<AuthSessionResponse>;
    async fn get_billing_catalog(&self) -> Result<BillingCatalogResponse>;
    async fn create_checkout(
        &self,
        account_id: &str,
        payload: CreateCheckoutRequest,
    ) -> Result<CheckoutSessionResponse>;
    async fn handle_easebuzz_callback(
        &self,
        form_fields: HashMap<String, String>,
    ) -> Result<EasebuzzCallbackResponse>;
    async fn list_payment_orders(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<PaymentOrderListResponse>;
    async fn get_billing_report(&self) -> Result<BillingReportResponse>;
    async fn get_billing_dashboard(&self, account_id: &str) -> Result<BillingDashboardResponse>;
    async fn get_credit_balance(&self, account_id: &str) -> Result<CreditBalanceResponse>;
    async fn get_credit_ledger(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<CreditLedgerResponse>;
    /// Redeem a promo code to grant credits
    async fn redeem_promo_code(
        &self,
        account_id: &str,
        code: &str,
    ) -> Result<RedeemPromoCodeResponse>;
    /// Load enriched billing context for auth middleware
    async fn load_billing_context(&self, account_id: &str) -> Result<BillingContext>;
    /// Create a new subscription for the account
    async fn create_subscription(
        &self,
        account_id: &str,
        payload: CreateSubscriptionRequest,
    ) -> Result<SubscriptionResponse>;
    /// Get the active subscription for the account (if any)
    async fn get_subscription(&self, account_id: &str) -> Result<SubscriptionListResponse>;
    /// Cancel an active subscription
    async fn cancel_subscription(
        &self,
        account_id: &str,
        subscription_id: &str,
        payload: CancelSubscriptionRequest,
    ) -> Result<CancelSubscriptionResponse>;
    async fn get_admin_user_stats(&self) -> Result<AdminUserStatsResponse>;
    async fn get_admin_subscription_stats(&self) -> Result<AdminSubscriptionStatsResponse>;
    async fn get_admin_payment_stats(&self) -> Result<AdminPaymentStatsResponse>;
    async fn get_admin_promo_code_stats(&self) -> Result<AdminPromoCodeStatsResponse>;
    async fn get_admin_users(&self) -> Result<AdminUsersListResponse>;
    async fn get_admin_settings(&self) -> Result<AdminSettingsResponse>;
    async fn get_admin_jobs(&self) -> Result<AdminJobsListResponse>;
    async fn get_admin_audit_logs(&self) -> Result<AdminAuditLogsResponse>;
    async fn toggle_maintenance(&self) -> Result<ToggleMaintenanceResponse>;
    async fn generate_lesson(
        &self,
        payload: GenerateLessonPayload,
    ) -> Result<GenerateLessonResponse>;
    async fn queue_lesson(&self, payload: GenerateLessonPayload) -> Result<GenerateLessonResponse>;
    async fn list_lesson_shelf(
        &self,
        account_id: &str,
        status: Option<String>,
        limit: usize,
    ) -> Result<LessonShelfListResponse>;
    async fn patch_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
        patch: LessonShelfPatchRequest,
    ) -> Result<LessonShelfItemResponse>;
    async fn archive_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
    ) -> Result<LessonShelfItemResponse>;
    async fn reopen_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
    ) -> Result<LessonShelfItemResponse>;
    async fn retry_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
    ) -> Result<LessonShelfItemResponse>;
    async fn mark_lesson_shelf_opened(
        &self,
        account_id: &str,
        lesson_id: &str,
        item_id: Option<&str>,
    ) -> Result<LessonShelfItemResponse>;
    async fn cancel_job(&self, id: &str) -> Result<CancelLessonJobOutcome>;
    async fn resume_job(&self, id: &str) -> Result<ResumeLessonJobOutcome>;
    async fn stateless_chat(&self, payload: StatelessChatRequest) -> Result<Vec<TutorStreamEvent>>;
    async fn stateless_chat_stream(
        &self,
        payload: StatelessChatRequest,
        sender: mpsc::Sender<TutorStreamEvent>,
    ) -> Result<()>;
    async fn get_job(&self, id: &str) -> Result<Option<LessonGenerationJob>>;
    async fn get_lesson(&self, id: &str) -> Result<Option<Lesson>>;
    async fn get_audio_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>>;
    async fn get_media_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>>;
    async fn acknowledge_runtime_action(
        &self,
        payload: RuntimeActionAckRequest,
    ) -> Result<RuntimeActionAckResponse>;
    async fn runtime_pbl_chat(
        &self,
        payload: PblRuntimeChatRequest,
    ) -> Result<PblRuntimeChatResponse>;
    async fn get_system_status(&self) -> Result<SystemStatusResponse>;
}

#[derive(Clone)]
pub struct LiveLessonAppService {
    storage: Arc<FileStorage>,
    provider_config: Arc<ServerProviderConfig>,
    provider_factory: Arc<dyn LlmProviderFactory>,
    image_provider_factory: Arc<dyn ImageProviderFactory>,
    video_provider_factory: Arc<dyn VideoProviderFactory>,
    tts_provider_factory: Arc<dyn TtsProviderFactory>,
    notification_service: Arc<dyn NotificationService>,
    base_url: String,
    queue_db_path: Option<String>,
}

impl LiveLessonAppService {
    pub fn new(
        storage: Arc<FileStorage>,
        provider_config: Arc<ServerProviderConfig>,
        provider_factory: Arc<dyn LlmProviderFactory>,
        image_provider_factory: Arc<dyn ImageProviderFactory>,
        video_provider_factory: Arc<dyn VideoProviderFactory>,
        tts_provider_factory: Arc<dyn TtsProviderFactory>,
        base_url: String,
    ) -> Self {
        Self {
            storage,
            provider_config,
            provider_factory,
            image_provider_factory,
            video_provider_factory,
            tts_provider_factory,
            notification_service: notification_service_from_env(base_url.clone()),
            base_url,
            queue_db_path: std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok(),
        }
    }

    pub fn with_queue_db_path(mut self, queue_db_path: Option<String>) -> Self {
        self.queue_db_path = queue_db_path;
        self
    }

    fn map_subscription_response(subscription: &Subscription) -> SubscriptionResponse {
        SubscriptionResponse {
            id: subscription.id.clone(),
            account_id: subscription.account_id.clone(),
            plan_code: subscription.plan_code.clone(),
            status: format!("{:?}", subscription.status).to_lowercase(),
            billing_interval: format!("{:?}", subscription.billing_interval).to_lowercase(),
            credits_per_cycle: subscription.credits_per_cycle,
            autopay_enabled: subscription.autopay_enabled,
            current_period_start: subscription.current_period_start.to_rfc3339(),
            current_period_end: subscription.current_period_end.to_rfc3339(),
            next_renewal_at: subscription.next_renewal_at.map(|dt| dt.to_rfc3339()),
            grace_period_until: subscription.grace_period_until.map(|dt| dt.to_rfc3339()),
            created_at: subscription.created_at.to_rfc3339(),
            updated_at: subscription.updated_at.to_rfc3339(),
        }
    }

    fn map_lesson_shelf_response(item: &LessonShelfItem) -> LessonShelfItemResponse {
        LessonShelfItemResponse {
            id: item.id.clone(),
            lesson_id: item.lesson_id.clone(),
            source_job_id: item.source_job_id.clone(),
            title: item.title.clone(),
            subject: item.subject.clone(),
            language: item.language.clone(),
            status: serde_json::to_string(&item.status)
                .unwrap_or_else(|_| "\"ready\"".to_string())
                .trim_matches('"')
                .to_string(),
            progress_pct: item.progress_pct,
            last_opened_at: item.last_opened_at.map(|value| value.to_rfc3339()),
            archived_at: item.archived_at.map(|value| value.to_rfc3339()),
            thumbnail_url: item.thumbnail_url.clone(),
            failure_reason: item.failure_reason.clone(),
            created_at: item.created_at.to_rfc3339(),
            updated_at: item.updated_at.to_rfc3339(),
        }
    }

    fn parse_lesson_shelf_status(value: &str) -> Result<LessonShelfStatus> {
        serde_json::from_str::<LessonShelfStatus>(&format!("\"{}\"", value.trim().to_ascii_lowercase()))
            .map_err(|_| anyhow!("invalid lesson shelf status"))
    }

    async fn ensure_lesson_adaptive_initialized(
        &self,
        lesson_id: &str,
        account_id: Option<String>,
        topic: Option<String>,
    ) -> Result<()> {
        self.storage
            .save_lesson_adaptive_state(&LessonAdaptiveState::new(
                lesson_id.to_string(),
                account_id,
                topic,
            ))
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn update_lesson_adaptive_progress(
        &self,
        lesson_id: &str,
        topic: Option<String>,
        should_record_diagnostic: bool,
    ) -> Result<()> {
        let mut state = self
            .storage
            .get_lesson_adaptive_state(lesson_id)
            .await
            .map_err(|err| anyhow!(err))?
            .unwrap_or_else(|| LessonAdaptiveState::new(lesson_id.to_string(), None, topic.clone()));

        if state.topic.is_none() {
            state.topic = topic;
        }

        if should_record_diagnostic && state.diagnostic_count < state.max_diagnostics {
            state.diagnostic_count += 1;
        }

        if state.diagnostic_count >= state.max_diagnostics {
            state.current_strategy = "reinforce".to_string();
            state.status = LessonAdaptiveStatus::Complete;
            state.confidence_score = 1.0;
        } else if state.diagnostic_count > 0 {
            state.current_strategy = "adapt".to_string();
            state.status = LessonAdaptiveStatus::Reinforce;
            state.confidence_score = (0.45 + (state.diagnostic_count as f32 * 0.2)).min(0.95);
        } else {
            state.current_strategy = "teach".to_string();
            state.status = LessonAdaptiveStatus::Active;
            state.confidence_score = 0.2;
        }

        state.updated_at = chrono::Utc::now();

        self.storage
            .save_lesson_adaptive_state(&state)
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn upsert_generation_shelf_item(
        &self,
        account_id: &str,
        lesson_id: &str,
        source_job_id: Option<&str>,
        title: &str,
        subject: Option<String>,
        language: Option<String>,
        status: LessonShelfStatus,
        failure_reason: Option<String>,
    ) -> Result<LessonShelfItem> {
        let existing = self
            .storage
            .list_lesson_shelf_items_for_account(account_id, None, 500)
            .await
            .map_err(|err| anyhow!(err))?
            .into_iter()
            .find(|item| item.lesson_id == lesson_id);

        let now = chrono::Utc::now();
        let item = if let Some(mut item) = existing {
            item.title = title.to_string();
            if source_job_id.is_some() || item.source_job_id.is_none() {
                item.source_job_id = source_job_id.map(ToString::to_string);
            }
            item.subject = subject;
            item.language = language;
            item.status = status;
            item.failure_reason = failure_reason;
            item.updated_at = now;
            item
        } else {
            LessonShelfItem {
                id: Uuid::new_v4().to_string(),
                account_id: account_id.to_string(),
                lesson_id: lesson_id.to_string(),
                source_job_id: source_job_id.map(ToString::to_string),
                title: title.to_string(),
                subject,
                language,
                status,
                progress_pct: 0,
                last_opened_at: None,
                archived_at: None,
                thumbnail_url: None,
                failure_reason,
                created_at: now,
                updated_at: now,
            }
        };
        self.storage
            .upsert_lesson_shelf_item(&item)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(item)
    }

    async fn account_email_context(&self, account_id: &str) -> Result<(String, String)> {
        let account = self
            .storage
            .get_tutor_account_by_id(account_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("tutor account not found: {}", account_id))?;
        Ok((account.email.clone(), first_name_from_email(&account.email)))
    }

    async fn notify_payment_success(&self, order: &PaymentOrder) {
        match self.account_email_context(&order.account_id).await {
            Ok((email, name)) => {
                if let Err(err) = self
                    .notification_service
                    .send_payment_success_notification(PaymentSuccessNotification {
                        account_email: email,
                        account_name: name,
                        order_id: order.id.clone(),
                        amount_minor: order.amount_minor,
                        currency: order.currency.clone(),
                    })
                    .await
                {
                    warn!(
                        order_id = %order.id,
                        account_id = %order.account_id,
                        error = %err,
                        "Failed to send payment success notification"
                    );
                }
            }
            Err(err) => {
                warn!(
                    order_id = %order.id,
                    account_id = %order.account_id,
                    error = %err,
                    "Skipping payment success notification due to missing account context"
                );
            }
        }
    }

    async fn notify_payment_failed(
        &self,
        order: &PaymentOrder,
        reason: &str,
        next_retry_at: Option<chrono::DateTime<chrono::Utc>>,
    ) {
        match self.account_email_context(&order.account_id).await {
            Ok((email, name)) => {
                if let Err(err) = self
                    .notification_service
                    .send_payment_failed_notification(PaymentFailedNotification {
                        account_email: email,
                        account_name: name,
                        order_id: order.id.clone(),
                        amount_minor: order.amount_minor,
                        currency: order.currency.clone(),
                        reason: reason.to_string(),
                        next_retry_at,
                    })
                    .await
                {
                    warn!(
                        order_id = %order.id,
                        account_id = %order.account_id,
                        error = %err,
                        "Failed to send payment failure notification"
                    );
                }
            }
            Err(err) => {
                warn!(
                    order_id = %order.id,
                    account_id = %order.account_id,
                    error = %err,
                    "Skipping payment failure notification due to missing account context"
                );
            }
        }
    }

    async fn notify_grace_period_warning(
        &self,
        account_id: &str,
        grace_end_at: chrono::DateTime<chrono::Utc>,
    ) {
        match self.account_email_context(account_id).await {
            Ok((email, name)) => {
                if let Err(err) = self
                    .notification_service
                    .send_grace_period_warning(GracePeriodWarningNotification {
                        account_email: email,
                        account_name: name,
                        grace_end_at,
                    })
                    .await
                {
                    warn!(
                        account_id = %account_id,
                        error = %err,
                        "Failed to send grace period warning notification"
                    );
                }
            }
            Err(err) => {
                warn!(
                    account_id = %account_id,
                    error = %err,
                    "Skipping grace period warning due to missing account context"
                );
            }
        }
    }

    async fn notify_service_restricted(&self, account_id: &str, reason: &str) {
        match self.account_email_context(account_id).await {
            Ok((email, name)) => {
                if let Err(err) = self
                    .notification_service
                    .send_service_restricted_alert(ServiceRestrictedNotification {
                        account_email: email,
                        account_name: name,
                        reason: reason.to_string(),
                    })
                    .await
                {
                    warn!(
                        account_id = %account_id,
                        error = %err,
                        "Failed to send service restricted notification"
                    );
                }
            }
            Err(err) => {
                warn!(
                    account_id = %account_id,
                    error = %err,
                    "Skipping service restricted notification due to missing account context"
                );
            }
        }
    }

    async fn exchange_google_code(&self, code: &str) -> Result<GoogleTokenResponse> {
        let client_id = required_env("AI_TUTOR_GOOGLE_OAUTH_CLIENT_ID")?;
        let client_secret = required_env("AI_TUTOR_GOOGLE_OAUTH_CLIENT_SECRET")?;
        let redirect_uri = required_env("AI_TUTOR_GOOGLE_OAUTH_REDIRECT_URI")?;

        let response = reqwest::Client::new()
            .post("https://oauth2.googleapis.com/token")

            .form(&[
                ("code", code),
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!(
                "google token exchange failed with status {}: {}",
                status,
                body
            ));
        }

        tracing::info!(status = %status, body = %body, "google token exchange raw response");
        serde_json::from_str::<GoogleTokenResponse>(&body)
            .map_err(|e| anyhow!("google token response parse error: {} — body was: {}", e, body))
    }

    async fn verify_google_id_token(&self, id_token: &str) -> Result<GoogleIdTokenClaims> {
        let client_id = required_env("AI_TUTOR_GOOGLE_OAUTH_CLIENT_ID")?;
        let claims = verify_jwt_with_jwks::<GoogleIdTokenClaims>(
            id_token,
            "https://www.googleapis.com/oauth2/v3/certs",
            &[client_id.as_str()],
            &["https://accounts.google.com", "accounts.google.com"],
        )
        .await?;

        if !claims.email_verified {

            return Err(anyhow!("google account email is not verified"));
        }

        Ok(claims)
    }

    async fn verify_firebase_id_token(&self, id_token: &str) -> Result<FirebaseTokenClaims> {
        let project_id = required_env("AI_TUTOR_FIREBASE_PROJECT_ID")?;
        let expected_issuer = format!("https://securetoken.google.com/{}", project_id);
        let claims = verify_jwt_with_jwks::<FirebaseTokenClaims>(
            id_token,
            "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
            &[project_id.as_str()],
            &[expected_issuer.as_str()],
        )
        .await?;

        if claims
            .phone_number
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            return Err(anyhow!(
                "firebase token did not include a verified phone number"
            ));
        }

        Ok(claims)
    }

    async fn upsert_google_account(&self, claims: &GoogleIdTokenClaims) -> Result<TutorAccount> {
        tracing::info!("upsert step 1: looking up account by google_id");
        let existing = self
            .storage
            .get_tutor_account_by_google_id(&claims.sub)
            .await
            .map_err(|err| {
                tracing::error!(error = %err, "upsert step 1 FAILED: get_tutor_account_by_google_id");
                anyhow!(err)
            })?;

        if let Some(mut existing) = existing {
            tracing::info!(account_id = %existing.id, "upsert step 2: updating existing account");
            existing.email = claims.email.clone();
            existing.updated_at = chrono::Utc::now();
            self.storage
                .save_tutor_account(&existing)
                .await
                .map_err(|err| {
                    tracing::error!(error = %err, "upsert step 2 FAILED: save_tutor_account (update)");
                    anyhow!(err)
                })?;
            return Ok(existing);
        }

        tracing::info!("upsert step 2: creating new account");
        let now = chrono::Utc::now();
        let account = TutorAccount {
            id: Uuid::new_v4().to_string(),
            email: claims.email.clone(),
            google_id: claims.sub.clone(),
            phone_number: None,
            phone_verified: false,
            status: TutorAccountStatus::PartialAuth,
            created_at: now,
            updated_at: now,
        };
        tracing::info!("upsert step 3: saving new account to storage");
        self.storage
            .save_tutor_account(&account)
            .await
            .map_err(|err| {
                tracing::error!(error = %err, "upsert step 3 FAILED: save_tutor_account (create)");
                anyhow!(err)
            })?;
        tracing::info!("upsert step 4: granting starter credits");
        self.grant_starter_credits(&account.id).await?;
        tracing::info!("upsert step 5: complete");
        Ok(account)
    }

    async fn activate_account_with_phone(
        &self,
        partial_claims: &PartialAuthClaims,
        phone_number: &str,
    ) -> Result<TutorAccount> {
        let Some(mut account) = self
            .storage
            .get_tutor_account_by_google_id(&partial_claims.google_id)
            .await
            .map_err(|err| anyhow!(err))?
        else {
            return Err(anyhow!("partial auth account no longer exists"));
        };

        if let Some(existing) = self
            .storage
            .get_tutor_account_by_phone(phone_number)
            .await
            .map_err(|err| anyhow!(err))?
        {
            if existing.id != account.id {
                return Err(anyhow!(
                    "phone number is already linked to another tutor account"
                ));
            }
        }

        account.phone_number = Some(phone_number.to_string());
        account.phone_verified = true;
        account.status = TutorAccountStatus::Active;
        account.updated_at = chrono::Utc::now();
        self.storage
            .save_tutor_account(&account)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(account)
    }

    async fn activate_account_without_phone(
        &self,
        account_id: &str,
    ) -> Result<TutorAccount> {
        let Some(mut account) = self
            .storage
            .get_tutor_account_by_id(account_id)
            .await
            .map_err(|err| anyhow!(err))?
        else {
            return Err(anyhow!("account not found for auto-activation: {}", account_id));
        };

        account.status = TutorAccountStatus::Active;
        account.updated_at = chrono::Utc::now();
        self.storage
            .save_tutor_account(&account)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(account)
    }

    async fn initiate_easebuzz_checkout(
        &self,
        account: &TutorAccount,
        product: &BillingProductDefinition,
    ) -> Result<CheckoutSessionResponse> {
        let config = easebuzz_config()?;
        let order_id = Uuid::new_v4().to_string();
        let gateway_txn_id = format!("aitutor-{}", Uuid::new_v4().simple());
        let success_url = format!("{}/api/billing/easebuzz/callback", self.base_url.trim_end_matches('/'));
        let failure_url = success_url.clone();
        let udf1 = Some(order_id.clone());
        let udf2 = Some(account.id.clone());
        let udf3 = Some(product.product_code.clone());

        let mut params = HashMap::new();
        params.insert("key".to_string(), config.key.clone());
        params.insert("txnid".to_string(), gateway_txn_id.clone());
        params.insert(
            "amount".to_string(),
            easebuzz_amount_string(product.amount_minor),
        );
        params.insert("firstname".to_string(), first_name_from_email(&account.email));
        params.insert("email".to_string(), account.email.clone());
        params.insert(
            "phone".to_string(),
            account
                .phone_number
                .clone()
                .unwrap_or_else(|| "9999999999".to_string()),
        );
        params.insert("productinfo".to_string(), product.title.clone());
        params.insert("surl".to_string(), success_url);
        params.insert("furl".to_string(), failure_url);
        if let Some(value) = udf1.clone() {
            params.insert("udf1".to_string(), value);
        }
        if let Some(value) = udf2.clone() {
            params.insert("udf2".to_string(), value);
        }
        if let Some(value) = udf3.clone() {
            params.insert("udf3".to_string(), value);
        }
        let hash = generate_easebuzz_request_hash(&params, &config.salt);
        params.insert("hash".to_string(), hash);

        let response = reqwest::Client::new()
            .post(format!("{}/payment/initiateLink", config.base_url.trim_end_matches('/')))
            .form(&params)
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(anyhow!(
                "easebuzz initiate link failed with status {}: {}",
                status,
                body
            ));
        }
        let parsed: EasebuzzInitiatePaymentResponse = serde_json::from_str(&body)?;
        if parsed.status != 1 {
            return Err(anyhow!(
                "easebuzz initiate link rejected request: {}",
                parsed
                    .data
                    .clone()
                    .unwrap_or_else(|| "unknown_error".to_string())
            ));
        }
        let access_key = parsed
            .data
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("easebuzz initiate link did not return an access key"))?;
        let checkout_url = format!("{}/pay/{}", config.base_url.trim_end_matches('/'), access_key);

        let now = chrono::Utc::now();
        let order = PaymentOrder {
            id: order_id.clone(),
            account_id: account.id.clone(),
            product_code: product.product_code.clone(),
            product_kind: product.kind.clone(),
            gateway: "easebuzz".to_string(),
            gateway_txn_id: gateway_txn_id.clone(),
            gateway_payment_id: None,
            amount_minor: product.amount_minor,
            currency: product.currency.clone(),
            credits_to_grant: product.credits,
            status: PaymentOrderStatus::Pending,
            checkout_url: Some(checkout_url.clone()),
            udf1,
            udf2,
            udf3,
            udf4: None,
            udf5: None,
            raw_response: Some(body),
            created_at: now,
            updated_at: now,
            completed_at: None,
        };
        self.storage
            .save_payment_order(&order)
            .await
            .map_err(|err| anyhow!(err))?;
        info!(
            order_id = %order.id,
            gateway_txn_id = %order.gateway_txn_id,
            account_id = %order.account_id,
            product_code = %order.product_code,
            payment_status = %payment_order_status_label(&order.status),
            "Persisted Easebuzz payment order"
        );

        Ok(CheckoutSessionResponse {
            order_id,
            account_id: account.id.clone(),
            gateway: "easebuzz".to_string(),
            gateway_txn_id,
            checkout_url,
        })
    }

    async fn finalize_easebuzz_payment(
        &self,
        fields: &HashMap<String, String>,
    ) -> Result<EasebuzzCallbackResponse> {
        let config = easebuzz_config()?;
        verify_easebuzz_response_hash(fields, &config.salt)?;
        let gateway_txn_id = required_field(fields, "txnid")?;
        let status = required_field(fields, "status")?;
        let event_identifier = easebuzz_event_identifier(fields, &gateway_txn_id, &status);
        if self
            .storage
            .get_webhook_event(&event_identifier)
            .await
            .map_err(|err| anyhow!(err))?
            .is_some()
        {
            let duplicate_order = self
                .storage
                .get_payment_order_by_gateway_txn_id(&gateway_txn_id)
                .await
                .map_err(|err| anyhow!(err))?;
            return Ok(EasebuzzCallbackResponse {
                order_id: duplicate_order
                    .map(|order| order.id)
                    .or_else(|| fields.get("udf1").cloned())
                    .unwrap_or_else(|| gateway_txn_id.clone()),
                status,
                credited: false,
            });
        }
        info!(
            gateway_txn_id = %gateway_txn_id,
            payment_status = %status,
            "Received Easebuzz callback"
        );
        let gateway_payment_id = fields
            .get("easepayid")
            .cloned()
            .or_else(|| fields.get("mihpayid").cloned());
        let mut order = if let Some(existing) = self
            .storage
            .get_payment_order_by_gateway_txn_id(&gateway_txn_id)
            .await
            .map_err(|err| anyhow!(err))?
        {
            existing
        } else {
            let account_id = fields
                .get("udf2")
                .cloned()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| anyhow!("unknown easebuzz transaction id {}; missing udf2 account id", gateway_txn_id))?;
            let product_code = fields
                .get("udf3")
                .cloned()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| anyhow!("unknown easebuzz transaction id {}; missing udf3 product code", gateway_txn_id))?;
            let product = billing_catalog()
                .into_iter()
                .find(|entry| entry.product_code == product_code)
                .ok_or_else(|| anyhow!("unknown billing product {} in easebuzz callback", product_code))?;
            warn!(
                gateway_txn_id = %gateway_txn_id,
                account_id = %account_id,
                product_code = %product_code,
                "Easebuzz callback had no existing payment order; creating callback-originated order"
            );
            let now = chrono::Utc::now();
            PaymentOrder {
                id: fields
                    .get("udf1")
                    .cloned()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
                account_id,
                product_code: product.product_code,
                product_kind: product.kind,
                gateway: "easebuzz".to_string(),
                gateway_txn_id: gateway_txn_id.clone(),
                gateway_payment_id: None,
                amount_minor: product.amount_minor,
                currency: product.currency,
                credits_to_grant: product.credits,
                status: PaymentOrderStatus::Pending,
                checkout_url: None,
                udf1: fields.get("udf1").cloned(),
                udf2: fields.get("udf2").cloned(),
                udf3: fields.get("udf3").cloned(),
                udf4: fields.get("udf4").cloned(),
                udf5: fields.get("udf5").cloned(),
                raw_response: Some(serde_json::to_string(fields)?),
                created_at: now,
                updated_at: now,
                completed_at: None,
            }
        };

        let previous_status = order.status.clone();
        let succeeded = status.eq_ignore_ascii_case("success");
        let callback_is_reversal = easebuzz_callback_indicates_reversal(fields, status.as_str());
        let previously_succeeded = matches!(order.status, PaymentOrderStatus::Succeeded);
        order.gateway_payment_id = gateway_payment_id;
        order.status = if succeeded {
            PaymentOrderStatus::Succeeded
        } else {
            PaymentOrderStatus::Failed
        };
        order.raw_response = Some(serde_json::to_string(fields)?);
        order.updated_at = chrono::Utc::now();
        order.completed_at = Some(order.updated_at);
        self.storage
            .save_payment_order(&order)
            .await
            .map_err(|err| anyhow!(err))?;

        if let Err(err) = self
            .storage
            .log_event(&FinancialAuditLog {
                id: Uuid::new_v4().to_string(),
                account_id: order.account_id.clone(),
                event_type: "payment_order_status_transition".to_string(),
                entity_type: "payment_order".to_string(),
                entity_id: order.id.clone(),
                actor: Some("system:easebuzz_callback".to_string()),
                before_state: serde_json::json!({
                    "status": previous_status,
                    "gateway_payment_id": order.gateway_payment_id,
                }),
                after_state: serde_json::json!({
                    "status": order.status,
                    "gateway_payment_id": order.gateway_payment_id,
                    "callback_reversal": callback_is_reversal,
                }),
                created_at: chrono::Utc::now(),
            })
            .await
        {
            warn!(
                order_id = %order.id,
                account_id = %order.account_id,
                error = %err,
                "Failed to write financial audit log for payment order transition"
            );
        }

        let mut credited = false;
        if succeeded && !previously_succeeded {
            let credit_entry = CreditLedgerEntry {
                id: format!("payment-order-{}", order.id),
                account_id: order.account_id.clone(),
                kind: CreditEntryKind::Grant,
                amount: order.credits_to_grant,
                reason: format!("payment_order:{}:{}", order.product_code, order.gateway_txn_id),
                created_at: chrono::Utc::now(),
            };
            self.storage
                .apply_credit_entry(&credit_entry)
                .await
                .map_err(|err| anyhow!(err))?;
            credited = true;

            if let Err(err) = self
                .create_payment_order_invoice(&order, chrono::Utc::now())
                .await
            {
                warn!(
                    order_id = %order.id,
                    account_id = %order.account_id,
                    error = %err,
                    "Failed to persist payment order invoice"
                );
            }
        }

        let mut reversed = false;
        if !succeeded && callback_is_reversal && previously_succeeded {
            reversed = self.reconcile_reversed_payment(&order).await?;
        }

        let gateway_subscription_id = fields
            .get("subscription_id")
            .cloned()
            .or_else(|| fields.get("sub_ref").cloned())
            .filter(|value| !value.trim().is_empty());
        if !succeeded && callback_is_reversal && previously_succeeded {
            self.cancel_subscription_from_reversal(&order, gateway_subscription_id)
                .await?;
        } else {
            self.upsert_subscription_from_payment(&order, gateway_subscription_id, succeeded)
                .await?;
        }

        if !succeeded && !callback_is_reversal {
            if let Err(err) = self
                .create_failed_payment_intent_and_dunning_case(&order, chrono::Utc::now())
                .await
            {
                warn!(
                    order_id = %order.id,
                    account_id = %order.account_id,
                    error = %err,
                    "Failed to persist payment intent and dunning state"
                );
            }
        }

        if let Err(err) = self
            .storage
            .create_webhook_event(&WebhookEvent {
                id: Uuid::new_v4().to_string(),
                event_identifier,
                event_type: "easebuzz.callback".to_string(),
                payload: serde_json::to_value(fields).unwrap_or_else(|_| serde_json::json!({})),
                processed_at: chrono::Utc::now(),
                created_at: chrono::Utc::now(),
            })
            .await
        {
            warn!(
                order_id = %order.id,
                account_id = %order.account_id,
                error = %err,
                "Failed to persist Easebuzz webhook event"
            );
        }

        if succeeded {
            self.notify_payment_success(&order).await;
        } else {
            self.notify_payment_failed(&order, status.as_str(), None)
                .await;
        }

        info!(
            order_id = %order.id,
            account_id = %order.account_id,
            product_code = %order.product_code,
            succeeded = succeeded,
            credited = credited,
            reversed = reversed,
            callback_is_reversal = callback_is_reversal,
            "Processed Easebuzz callback"
        );

        Ok(EasebuzzCallbackResponse {
            order_id: order.id,
            status,
            credited,
        })
    }

    async fn upsert_subscription_from_payment(
        &self,
        order: &PaymentOrder,
        gateway_subscription_id: Option<String>,
        succeeded: bool,
    ) -> Result<()> {
        if !matches!(order.product_kind, BillingProductKind::Subscription) {
            return Ok(());
        }

        let now = chrono::Utc::now();
        let grace_days = env_i64("AI_TUTOR_SUBSCRIPTION_GRACE_DAYS", 3).max(0);
        let cycle_days = env_i64("AI_TUTOR_SUBSCRIPTION_CYCLE_DAYS", 30).max(1);
        let grace_until = now + chrono::Duration::days(grace_days);

        let existing = self
            .storage
            .list_subscriptions_for_account(&order.account_id, 200)
            .await
            .map_err(|err| anyhow!(err))?
            .into_iter()
            .find(|subscription| subscription.plan_code == order.product_code);

        if succeeded {
            if existing
                .as_ref()
                .is_some_and(|subscription| {
                    subscription.last_payment_order_id.as_deref() == Some(order.id.as_str())
                })
            {
                return Ok(());
            }

            let period_start = existing
                .as_ref()
                .map(|subscription| {
                    if subscription.current_period_end > now {
                        subscription.current_period_end
                    } else {
                        now
                    }
                })
                .unwrap_or(now);
            let period_end = period_start + chrono::Duration::days(cycle_days);

            let subscription = Subscription {
                id: existing
                    .as_ref()
                    .map(|subscription| subscription.id.clone())
                    .unwrap_or_else(|| {
                        format!(
                            "sub-{}-{}",
                            order.account_id,
                            order.product_code.replace(':', "-")
                        )
                    }),
                account_id: order.account_id.clone(),
                plan_code: order.product_code.clone(),
                gateway: order.gateway.clone(),
                gateway_subscription_id: gateway_subscription_id
                    .or_else(|| existing.as_ref().and_then(|subscription| {
                        subscription.gateway_subscription_id.clone()
                    })),
                status: SubscriptionStatus::Active,
                billing_interval: BillingInterval::Monthly,
                credits_per_cycle: order.credits_to_grant,
                autopay_enabled: true,
                current_period_start: period_start,
                current_period_end: period_end,
                next_renewal_at: Some(period_end),
                grace_period_until: Some(period_end + chrono::Duration::days(grace_days)),
                cancelled_at: None,
                last_payment_order_id: Some(order.id.clone()),
                created_at: existing
                    .as_ref()
                    .map(|subscription| subscription.created_at)
                    .unwrap_or(now),
                updated_at: now,
            };

            self.storage
                .save_subscription(&subscription)
                .await
                .map_err(|err| anyhow!(err))?;
            info!(
                subscription_id = %subscription.id,
                account_id = %subscription.account_id,
                plan_code = %subscription.plan_code,
                gateway_subscription_id = subscription.gateway_subscription_id.as_deref().unwrap_or(""),
                "Activated subscription from successful payment"
            );
            return Ok(());
        }

        if let Some(mut subscription) = existing {
            if subscription.last_payment_order_id.as_deref() == Some(order.id.as_str()) {
                return Ok(());
            }

            subscription.status = SubscriptionStatus::PastDue;
            subscription.grace_period_until = Some(grace_until);
            subscription.last_payment_order_id = Some(order.id.clone());
            subscription.updated_at = now;
            self.storage
                .save_subscription(&subscription)
                .await
                .map_err(|err| anyhow!(err))?;
            info!(
                subscription_id = %subscription.id,
                account_id = %subscription.account_id,
                plan_code = %subscription.plan_code,
                last_payment_order_id = subscription.last_payment_order_id.as_deref().unwrap_or(""),
                "Marked subscription past due after payment failure"
            );
        }

        Ok(())
    }

    async fn reconcile_reversed_payment(&self, order: &PaymentOrder) -> Result<bool> {
        let debit_entry = CreditLedgerEntry {
            id: format!("payment-order-reversal-{}", order.id),
            account_id: order.account_id.clone(),
            kind: CreditEntryKind::Debit,
            amount: order.credits_to_grant,
            reason: format!(
                "payment_order_reversal:{}:{}",
                order.product_code, order.gateway_txn_id
            ),
            created_at: chrono::Utc::now(),
        };

        match self.storage.apply_credit_entry(&debit_entry).await {
            Ok(_) => Ok(true),
            Err(err) if err.contains("already exists") => Ok(false),
            Err(err) => Err(anyhow!(err)),
        }
    }

    async fn cancel_subscription_from_reversal(
        &self,
        order: &PaymentOrder,
        gateway_subscription_id: Option<String>,
    ) -> Result<()> {
        if !matches!(order.product_kind, BillingProductKind::Subscription) {
            return Ok(());
        }

        let now = chrono::Utc::now();
        let maybe_existing = self
            .storage
            .list_subscriptions_for_account(&order.account_id, 200)
            .await
            .map_err(|err| anyhow!(err))?
            .into_iter()
            .find(|subscription| subscription.plan_code == order.product_code);

        if let Some(mut subscription) = maybe_existing {
            if subscription.last_payment_order_id.as_deref() == Some(order.id.as_str())
                && matches!(subscription.status, SubscriptionStatus::Cancelled)
            {
                return Ok(());
            }

            subscription.gateway_subscription_id = gateway_subscription_id
                .or(subscription.gateway_subscription_id);
            subscription.status = SubscriptionStatus::Cancelled;
            subscription.autopay_enabled = false;
            subscription.cancelled_at = Some(now);
            subscription.next_renewal_at = None;
            subscription.grace_period_until = None;
            subscription.last_payment_order_id = Some(order.id.clone());
            subscription.updated_at = now;

            self.storage
                .save_subscription(&subscription)
                .await
                .map_err(|err| anyhow!(err))?;
            info!(
                subscription_id = %subscription.id,
                account_id = %subscription.account_id,
                plan_code = %subscription.plan_code,
                "Cancelled subscription due to reversed payment"
            );
        }

        Ok(())
    }

    async fn create_subscription_renewal_invoice(
        &self,
        subscription: &Subscription,
        cycle_start: chrono::DateTime<chrono::Utc>,
        cycle_end: chrono::DateTime<chrono::Utc>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let amount_cents = billing_catalog()
            .into_iter()
            .find(|product| {
                product.product_code == subscription.plan_code
                    && matches!(product.kind, BillingProductKind::Subscription)
            })
            .map(|product| product.amount_minor)
            .unwrap_or(0);

        let invoice_id = format!(
            "subscription-invoice-{}-{}",
            subscription.id,
            cycle_start.timestamp()
        );
        self.create_invoice_draft(
            &invoice_id,
            &subscription.account_id,
            InvoiceType::SubscriptionRenewal,
            cycle_start,
            cycle_end,
            now,
        )
        .await?;
        self.add_invoice_line(
            &invoice_id,
            InvoiceLineType::SubscriptionBase,
            format!("{} monthly renewal", subscription.plan_code),
            amount_cents,
            1,
            false,
            cycle_start,
            cycle_end,
            now,
        )
        .await?;
        self.finalize_invoice(&invoice_id, now, now).await?;
        self.mark_invoice_paid(&invoice_id, now).await?;

        Ok(())
    }

    async fn create_payment_order_invoice(
        &self,
        order: &PaymentOrder,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let (invoice_type, line_type, cycle_end, quantity, description) = match order.product_kind {
            BillingProductKind::Subscription => (
                InvoiceType::SubscriptionRenewal,
                InvoiceLineType::SubscriptionBase,
                now + chrono::Duration::days(env_i64("AI_TUTOR_SUBSCRIPTION_CYCLE_DAYS", 30).max(1)),
                1u32,
                format!("{} subscription payment", order.product_code),
            ),
            BillingProductKind::Bundle => (
                InvoiceType::AddOnCreditPurchase,
                InvoiceLineType::AddOnCredits,
                now,
                order.credits_to_grant.max(1.0).round() as u32,
                format!("{} credit top-up", order.product_code),
            ),
        };

        let invoice_id = format!("payment-invoice-{}", order.id);
        self.create_invoice_draft(
            &invoice_id,
            &order.account_id,
            invoice_type,
            now,
            cycle_end,
            now,
        )
        .await?;
        self.add_invoice_line(
            &invoice_id,
            line_type,
            description,
            order.amount_minor,
            quantity,
            false,
            now,
            cycle_end,
            now,
        )
        .await?;
        self.finalize_invoice(&invoice_id, now, now).await?;
        self.mark_invoice_paid(&invoice_id, now).await?;

        Ok(())
    }

    async fn create_failed_payment_intent_and_dunning_case(
        &self,
        order: &PaymentOrder,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let invoice_id = format!("payment-failed-invoice-{}", order.id);
        let existing_invoice = self
            .storage
            .get_invoice(&invoice_id)
            .await
            .map_err(|err| anyhow!(err))?;
        if existing_invoice.is_none() {
            let due_days = env_i64("AI_TUTOR_BILLING_DUE_DAYS", 7).max(1);
            let cycle_end = now + chrono::Duration::days(due_days);
            self.create_invoice_draft(
                &invoice_id,
                &order.account_id,
                if matches!(order.product_kind, BillingProductKind::Subscription) {
                    InvoiceType::SubscriptionRenewal
                } else {
                    InvoiceType::AddOnCreditPurchase
                },
                now,
                cycle_end,
                now,
            )
            .await?;
            self.add_invoice_line(
                &invoice_id,
                if matches!(order.product_kind, BillingProductKind::Subscription) {
                    InvoiceLineType::SubscriptionBase
                } else {
                    InvoiceLineType::AddOnCredits
                },
                format!("{} failed payment", order.product_code),
                order.amount_minor,
                1,
                false,
                now,
                cycle_end,
                now,
            )
            .await?;
            self.finalize_invoice(&invoice_id, now, now + chrono::Duration::days(due_days))
                .await?;
            self.storage
                .update_invoice_status(&invoice_id, InvoiceStatus::Open)
                .await
                .map_err(|err| anyhow!(err))?;
        }

        let payment_intent_id = format!("pi-{}", order.id);
        let attempt_count = self
            .storage
            .get_payment_intent(&payment_intent_id)
            .await
            .map_err(|err| anyhow!(err))?
            .map(|existing| existing.attempt_count + 1)
            .unwrap_or(1);
        let next_retry_at = now + chrono::Duration::days(1);

        self.storage
            .create_payment_intent(&PaymentIntent {
                id: payment_intent_id.clone(),
                account_id: order.account_id.clone(),
                invoice_id: invoice_id.clone(),
                status: PaymentIntentStatus::Failed,
                amount_cents: order.amount_minor,
                idempotency_key: format!("{}:{}", invoice_id, attempt_count),
                payment_method_id: None,
                gateway_payment_intent_id: order.gateway_payment_id.clone(),
                authorize_error: Some("gateway_payment_failed".to_string()),
                authorized_at: None,
                captured_at: None,
                canceled_at: None,
                attempt_count,
                next_retry_at: Some(next_retry_at),
                created_at: now,
                updated_at: now,
            })
            .await
            .map_err(|err| anyhow!(err))?;

        let dunning_id = format!("dc-{}", order.id);
        let dunning_exists = self
            .storage
            .get_dunning_case(&dunning_id)
            .await
            .map_err(|err| anyhow!(err))?
            .is_some();

        if dunning_exists {
            self.storage
                .append_retry_attempt(
                    &dunning_id,
                    RetryAttempt {
                        attempt_number: attempt_count,
                        scheduled_at: next_retry_at,
                        executed_at: None,
                        result: Some("scheduled".to_string()),
                        error_code: Some("payment_failed".to_string()),
                    },
                )
                .await
                .map_err(|err| anyhow!(err))?;
        } else {
            let grace_days = env_i64("AI_TUTOR_SUBSCRIPTION_GRACE_DAYS", 7).max(1);
            self.storage
                .create_dunning_case(&DunningCase {
                    id: dunning_id,
                    account_id: order.account_id.clone(),
                    invoice_id,
                    payment_intent_id,
                    status: DunningStatus::Active,
                    attempt_schedule: vec![RetryAttempt {
                        attempt_number: 1,
                        scheduled_at: next_retry_at,
                        executed_at: None,
                        result: Some("scheduled".to_string()),
                        error_code: Some("payment_failed".to_string()),
                    }],
                    grace_period_end: now + chrono::Duration::days(grace_days),
                    final_attempt_at: None,
                    created_at: now,
                    updated_at: now,
                })
                .await
                .map_err(|err| anyhow!(err))?;
        }

        Ok(())
    }

    async fn create_invoice_draft(
        &self,
        invoice_id: &str,
        account_id: &str,
        invoice_type: InvoiceType,
        cycle_start: chrono::DateTime<chrono::Utc>,
        cycle_end: chrono::DateTime<chrono::Utc>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        self.storage
            .create_invoice(&Invoice {
                id: invoice_id.to_string(),
                account_id: account_id.to_string(),
                invoice_type,
                billing_cycle_start: cycle_start,
                billing_cycle_end: cycle_end,
                status: InvoiceStatus::Draft,
                amount_cents: 0,
                amount_after_credits: 0,
                created_at: now,
                finalized_at: None,
                paid_at: None,
                due_at: None,
                updated_at: now,
            })
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn add_invoice_line(
        &self,
        invoice_id: &str,
        line_type: InvoiceLineType,
        description: String,
        amount_cents: i64,
        quantity: u32,
        is_prorated: bool,
        period_start: chrono::DateTime<chrono::Utc>,
        period_end: chrono::DateTime<chrono::Utc>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let invoice = self
            .storage
            .get_invoice(invoice_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("invoice {} not found", invoice_id))?;
        if invoice.finalized_at.is_some() {
            return Err(anyhow!("invoice {} is finalized", invoice_id));
        }

        let quantity = quantity.max(1);
        let unit_price_cents = (amount_cents / i64::from(quantity)).max(0);
        self.storage
            .add_line(&InvoiceLine {
                id: format!("{}-line-{}", invoice_id, Uuid::new_v4()),
                invoice_id: invoice_id.to_string(),
                line_type,
                description,
                amount_cents,
                quantity,
                unit_price_cents,
                is_prorated,
                period_start,
                period_end,
                created_at: now,
                updated_at: now,
            })
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn finalize_invoice(
        &self,
        invoice_id: &str,
        now: chrono::DateTime<chrono::Utc>,
        due_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let mut invoice = self
            .storage
            .get_invoice(invoice_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("invoice {} not found", invoice_id))?;
        if invoice.finalized_at.is_some() {
            return Err(anyhow!("invoice {} already finalized", invoice_id));
        }

        let amount_cents = self
            .storage
            .sum_invoice_lines(invoice_id)
            .await
            .map_err(|err| anyhow!(err))?;

        invoice.amount_cents = amount_cents;
        invoice.amount_after_credits = amount_cents;
        invoice.status = InvoiceStatus::Finalized;
        invoice.finalized_at = Some(now);
        invoice.due_at = Some(due_at);
        invoice.updated_at = now;

        self.storage
            .create_invoice(&invoice)
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn mark_invoice_paid(
        &self,
        invoice_id: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let mut invoice = self
            .storage
            .get_invoice(invoice_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("invoice {} not found", invoice_id))?;
        invoice.status = InvoiceStatus::Paid;
        invoice.paid_at = Some(now);
        invoice.updated_at = now;
        self.storage
            .create_invoice(&invoice)
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn renew_due_subscriptions(&self, now: chrono::DateTime<chrono::Utc>) -> Result<usize> {
        let cycle_days = env_i64("AI_TUTOR_SUBSCRIPTION_CYCLE_DAYS", 30).max(1);
        let grace_days = env_i64("AI_TUTOR_SUBSCRIPTION_GRACE_DAYS", 3).max(0);
        let due_subscriptions = self
            .storage
            .list_subscriptions_due_for_renewal(&now.to_rfc3339(), 500)
            .await
            .map_err(|err| anyhow!(err))?;

        let mut renewed_count = 0usize;
        for mut subscription in due_subscriptions {
            let renewal_marker = subscription.current_period_end.timestamp();
            let renewal_entry = CreditLedgerEntry {
                id: format!("subscription-renewal-{}-{}", subscription.id, renewal_marker),
                account_id: subscription.account_id.clone(),
                kind: CreditEntryKind::Grant,
                amount: subscription.credits_per_cycle,
                reason: format!("subscription_renewal:{}", subscription.plan_code),
                created_at: now,
            };

            match self.storage.apply_credit_entry(&renewal_entry).await {
                Ok(_) => {
                    let next_period_start = subscription.current_period_end;
                    let next_period_end = next_period_start + chrono::Duration::days(cycle_days);
                    subscription.status = SubscriptionStatus::Active;
                    subscription.current_period_start = next_period_start;
                    subscription.current_period_end = next_period_end;
                    subscription.next_renewal_at = Some(next_period_end);
                    subscription.grace_period_until = Some(next_period_end + chrono::Duration::days(grace_days));
                    subscription.updated_at = now;
                    self.storage
                        .save_subscription(&subscription)
                        .await
                        .map_err(|err| anyhow!(err))?;
                    if let Err(err) = self
                        .create_subscription_renewal_invoice(
                            &subscription,
                            next_period_start,
                            next_period_end,
                            now,
                        )
                        .await
                    {
                        warn!(
                            subscription_id = %subscription.id,
                            account_id = %subscription.account_id,
                            error = %err,
                            "Failed to persist subscription renewal invoice"
                        );
                    }
                    info!(
                        subscription_id = %subscription.id,
                        account_id = %subscription.account_id,
                        plan_code = %subscription.plan_code,
                        renewal_marker = %renewal_marker,
                        "Renewed subscription and granted cycle credits"
                    );
                    renewed_count += 1;
                }
                Err(err) if err.contains("already exists") => {
                    // Idempotency guard: renewal already applied for this period marker.
                    warn!(
                        subscription_id = %subscription.id,
                        account_id = %subscription.account_id,
                        renewal_marker = %renewal_marker,
                        "Skipped duplicate renewal credit entry"
                    );
                    continue;
                }
                Err(err) => return Err(anyhow!(err)),
            }
        }

        Ok(renewed_count)
    }

    async fn revoke_expired_subscriptions(
        &self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<usize> {
        let subscriptions = self
            .storage
            .list_all_subscriptions(1_000)
            .await
            .map_err(|err| anyhow!(err))?;

        let mut revoked_count = 0usize;
        for mut subscription in subscriptions {
            let grace_expired = matches!(subscription.status, SubscriptionStatus::PastDue)
                && subscription
                    .grace_period_until
                    .is_some_and(|grace| grace <= now);
            let cancellation_expired = matches!(subscription.status, SubscriptionStatus::Cancelled)
                && subscription.current_period_end <= now;

            if !grace_expired && !cancellation_expired {
                continue;
            }
            if matches!(subscription.status, SubscriptionStatus::Expired) {
                continue;
            }

            subscription.status = SubscriptionStatus::Expired;
            subscription.autopay_enabled = false;
            subscription.next_renewal_at = None;
            subscription.grace_period_until = None;
            if subscription.cancelled_at.is_none() {
                subscription.cancelled_at = Some(now);
            }
            subscription.updated_at = now;

            self.storage
                .save_subscription(&subscription)
                .await
                .map_err(|err| anyhow!(err))?;
            self
                .notify_service_restricted(
                    &subscription.account_id,
                    "Subscription expired after grace or cancellation period",
                )
                .await;
            info!(
                subscription_id = %subscription.id,
                account_id = %subscription.account_id,
                plan_code = %subscription.plan_code,
                "Revoked expired subscription entitlement"
            );
            revoked_count += 1;
        }

        Ok(revoked_count)
    }

    async fn attempt_capture_payment_intent(
        &self,
        intent: &PaymentIntent,
    ) -> Result<(bool, &'static str)> {
        let order_id = intent.id.strip_prefix("pi-").unwrap_or(intent.id.as_str());
        let order = self
            .storage
            .get_payment_order_by_id(order_id)
            .await
            .map_err(|err| anyhow!(err))?;

        let Some(order) = order else {
            return Ok((false, "payment_order_missing"));
        };

        if !order.gateway.eq_ignore_ascii_case("easebuzz") {
            return Ok((false, "unsupported_gateway"));
        }

        let outcome = match order.status {
            PaymentOrderStatus::Succeeded => (true, "captured"),
            PaymentOrderStatus::Pending => (false, "payment_pending"),
            PaymentOrderStatus::Failed => (false, "payment_failed"),
        };

        Ok(outcome)
    }

    async fn process_retryable_payment_intents(
        &self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<(usize, usize)> {
        let intents = self
            .storage
            .list_retryable_payment_intents(&now.to_rfc3339())
            .await
            .map_err(|err| anyhow!(err))?;

        let max_attempts = env_i64("AI_TUTOR_DUNNING_MAX_ATTEMPTS", 4).max(1) as u32;
        let mut retried_count = 0usize;
        let mut exhausted_count = 0usize;

        for mut intent in intents {
            let scheduled_at = intent.next_retry_at.unwrap_or(now);
            let next_attempt = intent.attempt_count.saturating_add(1);
            let (capture_succeeded, retry_error_code) =
                self.attempt_capture_payment_intent(&intent).await?;

            if capture_succeeded {
                intent.status = PaymentIntentStatus::Captured;
                intent.attempt_count = next_attempt;
                intent.idempotency_key = format!("{}:{}", intent.invoice_id, next_attempt);
                intent.authorize_error = None;
                intent.captured_at = Some(now);
                intent.next_retry_at = None;
                intent.updated_at = now;
                self.storage
                    .create_payment_intent(&intent)
                    .await
                    .map_err(|err| anyhow!(err))?;
                self.storage
                    .update_invoice_status(&intent.invoice_id, InvoiceStatus::Paid)
                    .await
                    .map_err(|err| anyhow!(err))?;
                if let Some(case_item) = self
                    .storage
                    .get_dunning_case_by_invoice_id(&intent.invoice_id)
                    .await
                    .map_err(|err| anyhow!(err))?
                {
                    self.storage
                        .append_retry_attempt(
                            &case_item.id,
                            RetryAttempt {
                                attempt_number: next_attempt,
                                scheduled_at,
                                executed_at: Some(now),
                                result: Some("captured".to_string()),
                                error_code: None,
                            },
                        )
                        .await
                        .map_err(|err| anyhow!(err))?;
                    self.storage
                        .update_dunning_case_status(&case_item.id, DunningStatus::Recovered)
                        .await
                        .map_err(|err| anyhow!(err))?;
                }
                retried_count += 1;
                continue;
            }

            let retry_error_code = if retry_error_code == "captured" {
                "retry_failed"
            } else {
                retry_error_code
            };

            if next_attempt >= max_attempts {
                intent.status = PaymentIntentStatus::Abandoned;
                intent.attempt_count = next_attempt;
                intent.idempotency_key = format!("{}:{}", intent.invoice_id, next_attempt);
                intent.authorize_error = Some(retry_error_code.to_string());
                intent.next_retry_at = None;
                intent.updated_at = now;
                self.storage
                    .create_payment_intent(&intent)
                    .await
                    .map_err(|err| anyhow!(err))?;
                self.storage
                    .update_invoice_status(&intent.invoice_id, InvoiceStatus::Uncollectible)
                    .await
                    .map_err(|err| anyhow!(err))?;
                if let Some(case_item) = self
                    .storage
                    .get_dunning_case_by_invoice_id(&intent.invoice_id)
                    .await
                    .map_err(|err| anyhow!(err))?
                {
                    self.storage
                        .append_retry_attempt(
                            &case_item.id,
                            RetryAttempt {
                                attempt_number: next_attempt,
                                scheduled_at,
                                executed_at: Some(now),
                                result: Some("exhausted".to_string()),
                                error_code: Some(retry_error_code.to_string()),
                            },
                        )
                        .await
                        .map_err(|err| anyhow!(err))?;
                    self.storage
                        .update_dunning_case_status(&case_item.id, DunningStatus::Exhausted)
                        .await
                        .map_err(|err| anyhow!(err))?;
                }
                self
                    .notify_service_restricted(
                        &intent.account_id,
                        "Payment retries exhausted and invoice marked uncollectible",
                    )
                    .await;
                exhausted_count += 1;
                continue;
            }

            let retry_days = i64::from(next_attempt.saturating_mul(2).saturating_sub(1));
            let next_retry_at = now + chrono::Duration::days(retry_days);
            intent.status = PaymentIntentStatus::Failed;
            intent.attempt_count = next_attempt;
            intent.idempotency_key = format!("{}:{}", intent.invoice_id, next_attempt);
            intent.authorize_error = Some(retry_error_code.to_string());
            intent.next_retry_at = Some(next_retry_at);
            intent.updated_at = now;
            self.storage
                .create_payment_intent(&intent)
                .await
                .map_err(|err| anyhow!(err))?;

            if let Some(case_item) = self
                .storage
                .get_dunning_case_by_invoice_id(&intent.invoice_id)
                .await
                .map_err(|err| anyhow!(err))?
            {
                self.storage
                    .append_retry_attempt(
                        &case_item.id,
                        RetryAttempt {
                            attempt_number: next_attempt,
                            scheduled_at,
                            executed_at: Some(now),
                            result: Some("failed".to_string()),
                            error_code: Some(retry_error_code.to_string()),
                        },
                    )
                    .await
                    .map_err(|err| anyhow!(err))?;

                self
                    .notify_grace_period_warning(&intent.account_id, case_item.grace_period_end)
                    .await;
            }

            let fallback_order = PaymentOrder {
                id: intent.id.clone(),
                account_id: intent.account_id.clone(),
                product_code: "subscription_retry".to_string(),
                product_kind: BillingProductKind::Subscription,
                gateway: "easebuzz".to_string(),
                gateway_txn_id: intent.invoice_id.clone(),
                gateway_payment_id: None,
                amount_minor: intent.amount_cents,
                currency: billing_currency(),
                credits_to_grant: 0.0,
                status: PaymentOrderStatus::Failed,
                checkout_url: None,
                udf1: None,
                udf2: None,
                udf3: None,
                udf4: None,
                udf5: None,
                raw_response: None,
                created_at: now,
                updated_at: now,
                completed_at: Some(now),
            };
            self
                .notify_payment_failed(&fallback_order, retry_error_code, Some(next_retry_at))
                .await;
            retried_count += 1;
        }

        Ok((retried_count, exhausted_count))
    }

    pub async fn run_billing_maintenance_cycle(&self) -> Result<BillingMaintenanceResponse> {
        let now = chrono::Utc::now();
        let revoked_subscriptions = self.revoke_expired_subscriptions(now).await?;
        let renewed_subscriptions = self.renew_due_subscriptions(now).await?;
        let (retried_payment_intents, exhausted_dunning_cases) =
            self.process_retryable_payment_intents(now).await?;

        if renewed_subscriptions > 0
            || revoked_subscriptions > 0
            || retried_payment_intents > 0
            || exhausted_dunning_cases > 0
        {
            info!(
                renewed_subscriptions,
                revoked_subscriptions,
                retried_payment_intents,
                exhausted_dunning_cases,
                "billing maintenance cycle finished"
            );
        }

        Ok(BillingMaintenanceResponse {
            renewed_subscriptions,
            revoked_subscriptions,
            retried_payment_intents,
            exhausted_dunning_cases,
        })
    }

    async fn grant_starter_credits(&self, account_id: &str) -> Result<()> {
        let policy = credit_policy();
        if policy.starter_grant_credits <= 0.0 {
            return Ok(());
        }
        let entry = CreditLedgerEntry {
            id: format!("grant-{}-{}", account_id, Uuid::new_v4()),
            account_id: account_id.to_string(),
            kind: CreditEntryKind::Grant,
            amount: policy.starter_grant_credits,
            reason: "starter_grant".to_string(),
            created_at: chrono::Utc::now(),
        };
        self.storage
            .apply_credit_entry(&entry)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(())
    }

    pub(crate) async fn apply_credit_debit_for_output(
        &self,
        request: &LessonGenerationRequest,
        lesson: &Lesson,
    ) -> Result<()> {
        let Some(account_id) = request.account_id.as_deref() else {
            if credits_required() {
                return Err(anyhow!("account_id is required for credit enforcement"));
            }
            return Ok(());
        };

        let policy = credit_policy();
        let usage = calculate_credit_usage(lesson, &policy);
        if usage.total <= 0.0 {
            return Ok(());
        }

        let balance = self
            .storage
            .get_credit_balance(account_id)
            .await
            .map_err(|err| anyhow!(err))?;
        if credits_required() && balance.balance < usage.total {
            return Err(anyhow!(
                "insufficient credits: required {:.2}, balance {:.2}",
                usage.total,
                balance.balance
            ));
        }

        let entry = CreditLedgerEntry {
            id: format!("debit-{}-{}", account_id, lesson.id),
            account_id: account_id.to_string(),
            kind: CreditEntryKind::Debit,
            amount: usage.total,
            reason: format!(
                "lesson:{} base={:.2} image={:.2} tts={:.2}",
                lesson.id, usage.base, usage.images, usage.tts
            ),
            created_at: chrono::Utc::now(),
        };
        self.storage
            .apply_credit_entry(&entry)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(())
    }

    pub(crate) async fn sync_generation_success_to_shelf(
        &self,
        request: &LessonGenerationRequest,
        lesson: &Lesson,
    ) -> Result<()> {
        if let Some(account_id) = request.account_id.as_deref() {
            self.ensure_lesson_adaptive_initialized(
                &lesson.id,
                Some(account_id.to_string()),
                lesson.description.clone(),
            )
            .await?;
            self.upsert_generation_shelf_item(
                account_id,
                &lesson.id,
                None,
                &lesson.title,
                lesson.description.clone(),
                Some(lesson.language.clone()),
                LessonShelfStatus::Ready,
                None,
            )
            .await?;
        }
        Ok(())
    }

    pub(crate) async fn sync_generation_failure_to_shelf(
        &self,
        request: &LessonGenerationRequest,
        lesson_id: &str,
        failure_reason: String,
    ) -> Result<()> {
        if let Some(account_id) = request.account_id.as_deref() {
            self.ensure_lesson_adaptive_initialized(
                lesson_id,
                Some(account_id.to_string()),
                Some(request.requirements.requirement.clone()),
            )
            .await?;
            self.upsert_generation_shelf_item(
                account_id,
                lesson_id,
                None,
                "Lesson generation failed",
                Some(request.requirements.requirement.clone()),
                Some(match request.requirements.language {
                    Language::EnUs => "en-US".to_string(),
                    Language::ZhCn => "zh-CN".to_string(),
                }),
                LessonShelfStatus::Failed,
                Some(failure_reason),
            )
            .await?;
        }
        Ok(())
    }

    pub(crate) async fn build_orchestrator(
        &self,
        request: &LessonGenerationRequest,
        model_string: Option<&str>,
    ) -> Result<LessonGenerationOrchestrator<LlmGenerationPipeline, FileStorage, FileStorage>> {
        let generation_policy = resolve_generation_model_policy(
            None,
            std::env::var("BALANCED_MODE_AI_TUTOR_GENERATION_OUTLINES_MODEL")
                .ok()
                .as_deref(),
            std::env::var("BALANCED_MODE_AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL")
                .ok()
                .as_deref(),
            std::env::var("BALANCED_MODE_AI_TUTOR_GENERATION_SCENE_ACTIONS_MODEL")
                .ok()
                .as_deref(),
            None,
        )?;

        let outlines_llm = self.provider_factory.build(
            resolve_model(
                &self.provider_config,
                Some(&generation_policy.outlines_model),
                None,
                None,
                None,
                None,
            )?
            .model_config,
        )?;
        let scene_content_llm = self.provider_factory.build(
            resolve_model(
                &self.provider_config,
                Some(&generation_policy.scene_content_model),
                None,
                None,
                None,
                None,
            )?
            .model_config,
        )?;
        let scene_actions_llm = self.provider_factory.build(
            resolve_model(
                &self.provider_config,
                Some(&generation_policy.scene_actions_model),
                None,
                None,
                None,
                None,
            )?
            .model_config,
        )?;

        let mut pipeline = LlmGenerationPipeline::new(
            self.provider_factory.build(
                resolve_model(
                    &self.provider_config,
                    Some(&generation_policy.scene_content_model),
                    None,
                    None,
                    None,
                    None,
                )?
                .model_config,
            )?,
        )
        .with_phase_llms(outlines_llm, scene_content_llm, scene_actions_llm);
        if request.enable_web_search {
            if let Ok(api_key) = std::env::var("AI_TUTOR_TAVILY_API_KEY") {
                let base_url = std::env::var("AI_TUTOR_TAVILY_BASE_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "https://api.tavily.com/search".to_string());
                let max_results = std::env::var("AI_TUTOR_WEB_SEARCH_MAX_RESULTS")
                    .ok()
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(5);
                pipeline = pipeline.with_tavily_web_search(api_key, base_url, max_results);
            }
        }
        let pipeline = Arc::new(pipeline);
        let mut orchestrator = LessonGenerationOrchestrator::new(
            pipeline,
            Arc::clone(&self.storage),
            Arc::clone(&self.storage),
        )
        .with_asset_store(self.build_asset_store().await?);

        if request.enable_image_generation {
            let image_model_string = std::env::var("BALANCED_MODE_AI_TUTOR_IMAGE_MODEL")
                .ok()
                .or_else(|| model_string.map(|_| "openai:gpt-image-1".to_string()))
                .unwrap_or_else(|| "openai:gpt-image-1".to_string());
            let resolved_image = resolve_model(
                &self.provider_config,
                Some(&image_model_string),
                None,
                None,
                None,
                None,
            )?;
            let image = self
                .image_provider_factory
                .build(resolved_image.model_config)?;
            orchestrator = orchestrator.with_image_provider(Arc::from(image));
        }

        if request.enable_video_generation {
            let video_model_string = std::env::var("BALANCED_MODE_AI_TUTOR_VIDEO_MODEL")
                .ok()
                .or_else(|| model_string.map(|_| "openai:gpt-video-1".to_string()))
                .unwrap_or_else(|| "openai:gpt-video-1".to_string());
            let resolved_video = resolve_model(
                &self.provider_config,
                Some(&video_model_string),
                None,
                None,
                None,
                None,
            )?;
            let video = self
                .video_provider_factory
                .build(resolved_video.model_config)?;
            orchestrator = orchestrator.with_video_provider(Arc::from(video));
        }

        if request.enable_tts {
            let tts_model_string = std::env::var("BALANCED_MODE_AI_TUTOR_TTS_MODEL")
                .ok()
                .or_else(|| model_string.map(|_| "openai:tts-1".to_string()))
                .unwrap_or_else(|| "openai:tts-1".to_string());
            let resolved_tts = resolve_model(
                &self.provider_config,
                Some(&tts_model_string),
                None,
                None,
                None,
                None,
            )?;
            let tts = self.tts_provider_factory.build(resolved_tts.model_config)?;
            orchestrator = orchestrator.with_tts(Arc::from(tts));
        }

        Ok(orchestrator)
    }

    async fn build_asset_store(&self) -> Result<DynAssetStore> {
        // OpenMAIC's live orchestration is not coupled to local-disk asset URLs.
        // This Rust translation keeps the same separation by choosing a storage
        // backend here: local files for dev compatibility, or R2 for production.
        match std::env::var("AI_TUTOR_ASSET_STORE")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "r2" => self.build_r2_asset_store().await,
            "local" | "" => {
                if self.r2_env_present() {
                    self.build_r2_asset_store().await
                } else {
                    Ok(Arc::new(LocalFileAssetStore::new(
                        self.storage.root_dir(),
                        &self.base_url,
                    )))
                }
            }
            other => Err(anyhow!("unsupported AI_TUTOR_ASSET_STORE value: {}", other)),
        }
    }

    fn r2_env_present(&self) -> bool {
        [
            "AI_TUTOR_R2_ENDPOINT",
            "AI_TUTOR_R2_BUCKET",
            "AI_TUTOR_R2_ACCESS_KEY_ID",
            "AI_TUTOR_R2_SECRET_ACCESS_KEY",
            "AI_TUTOR_R2_PUBLIC_BASE_URL",
        ]
        .iter()
        .any(|key| std::env::var(key).ok().is_some())
    }

    async fn build_r2_asset_store(&self) -> Result<DynAssetStore> {
        let endpoint = required_trimmed_env("AI_TUTOR_R2_ENDPOINT")?;
        let bucket = required_trimmed_env("AI_TUTOR_R2_BUCKET")?;
        let access_key_id = required_trimmed_env("AI_TUTOR_R2_ACCESS_KEY_ID")?;
        let secret_access_key = required_trimmed_env("AI_TUTOR_R2_SECRET_ACCESS_KEY")?;
        let public_base_url = required_trimmed_env("AI_TUTOR_R2_PUBLIC_BASE_URL")?;
        let key_prefix = std::env::var("AI_TUTOR_R2_KEY_PREFIX").unwrap_or_default();
        let allow_insecure = matches!(
            std::env::var("AI_TUTOR_ALLOW_INSECURE_R2")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        );
        if !allow_insecure {
            if !endpoint.trim().to_ascii_lowercase().starts_with("https://") {
                return Err(anyhow!(
                    "AI_TUTOR_R2_ENDPOINT must use https:// unless AI_TUTOR_ALLOW_INSECURE_R2=1"
                ));
            }
            if !public_base_url
                .trim()
                .to_ascii_lowercase()
                .starts_with("https://")
            {
                return Err(anyhow!(
                    "AI_TUTOR_R2_PUBLIC_BASE_URL must use https:// unless AI_TUTOR_ALLOW_INSECURE_R2=1"
                ));
            }
        }

        let endpoint_url = Url::parse(endpoint.as_str())
            .map_err(|err| anyhow!("invalid AI_TUTOR_R2_ENDPOINT URL: {}", err))?;
        if endpoint_url.scheme() != "http" && endpoint_url.scheme() != "https" {
            return Err(anyhow!(
                "AI_TUTOR_R2_ENDPOINT must use http or https scheme"
            ));
        }
        if endpoint_url.host_str().is_none() {
            return Err(anyhow!("AI_TUTOR_R2_ENDPOINT must include a host"));
        }
        if endpoint_url.query().is_some() || endpoint_url.fragment().is_some() {
            return Err(anyhow!(
                "AI_TUTOR_R2_ENDPOINT must not include query params or fragments"
            ));
        }

        let public_url = Url::parse(public_base_url.as_str())
            .map_err(|err| anyhow!("invalid AI_TUTOR_R2_PUBLIC_BASE_URL: {}", err))?;
        if public_url.scheme() != "http" && public_url.scheme() != "https" {
            return Err(anyhow!(
                "AI_TUTOR_R2_PUBLIC_BASE_URL must use http or https scheme"
            ));
        }
        if public_url.host_str().is_none() {
            return Err(anyhow!("AI_TUTOR_R2_PUBLIC_BASE_URL must include a host"));
        }
        if public_url.query().is_some() || public_url.fragment().is_some() {
            return Err(anyhow!(
                "AI_TUTOR_R2_PUBLIC_BASE_URL must not include query params or fragments"
            ));
        }
        if key_prefix.contains("..") {
            return Err(anyhow!(
                "AI_TUTOR_R2_KEY_PREFIX must not contain path traversal segments"
            ));
        }

        Ok(Arc::new(
            R2AssetStore::new(
                endpoint,
                bucket,
                access_key_id,
                secret_access_key,
                public_base_url,
                key_prefix,
            )
            .await?,
        ))
    }

    pub(crate) fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn system_status(&self) -> Result<SystemStatusResponse> {
        let current_model = std::env::var("BALANCED_MODE_AI_TUTOR_MODEL").ok();
        let generation_model_policy = resolve_generation_model_policy(
            current_model.as_deref(),
            std::env::var("BALANCED_MODE_AI_TUTOR_GENERATION_OUTLINES_MODEL")
                .ok()
                .as_deref(),
            std::env::var("BALANCED_MODE_AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL")
                .ok()
                .as_deref(),
            std::env::var("BALANCED_MODE_AI_TUTOR_GENERATION_SCENE_ACTIONS_MODEL")
                .ok()
                .as_deref(),
            None,
        )?;
        let selected_model_profile = current_model
            .as_deref()
            .and_then(|model| selected_model_profile(&self.provider_config, Some(model)).ok());
        let queue = match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        };
        let pending_result = queue.pending_count().await;
        let leases_result = queue.lease_counts().await;
        let (queue_pending_jobs, queue_active_leases, queue_stale_leases, queue_status_error) =
            match (&pending_result, &leases_result) {
                (Ok(pending), Ok(leases)) => (*pending, leases.active, leases.stale, None),
                _ => {
                    let pending = pending_result.as_ref().copied().unwrap_or(0);
                    let leases = leases_result.as_ref().copied().unwrap_or(QueueLeaseCounts {
                        active: 0,
                        stale: 0,
                    });
                    let mut errors = Vec::new();
                    if let Err(err) = &pending_result {
                        errors.push(format!("pending_count: {}", err));
                    }
                    if let Err(err) = &leases_result {
                        errors.push(format!("lease_counts: {}", err));
                    }
                    (
                        pending,
                        leases.active,
                        leases.stale,
                        Some(errors.join("; ")),
                    )
                }
            };

        let (provider_runtime, provider_status_error) =
            match self.current_provider_runtime_status(current_model.as_deref()) {
                Ok(statuses) => (statuses, None),
                Err(err) => (Vec::new(), Some(err.to_string())),
            };
        let provider_totals = aggregate_provider_runtime_status(&provider_runtime);
        let auth_blueprint = auth_blueprint_status();
        let deployment_blueprint = deployment_blueprint();
        let credit_policy = credit_policy();
        let mut runtime_alerts = derive_runtime_alerts(
            &provider_runtime,
            queue_status_error.as_deref(),
            provider_status_error.as_deref(),
            queue_stale_leases,
            selected_model_profile.as_ref(),
            &auth_blueprint,
            &credit_policy,
        );
        let flag_path = self.storage.root_dir().join(".maintenance");
        if flag_path.exists() {
            runtime_alerts.push("Maintenance mode is manually enabled. API may reject new generation requests.".to_string());
        }
        let runtime_alert_level = derive_runtime_alert_level(&runtime_alerts).to_string();

        Ok(SystemStatusResponse {
            status: if runtime_alert_level == "ok" {
                "ok"
            } else {
                "degraded"
            },
            current_model,
            deployment_environment: std::env::var("AI_TUTOR_DEPLOYMENT_ENV")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "unknown".to_string()),
            deployment_revision: std::env::var("AI_TUTOR_DEPLOYMENT_REVISION")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            rollout_phase: std::env::var("AI_TUTOR_ROLLOUT_PHASE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "stable".to_string()),
            generation_model_policy: GenerationModelPolicyResponse {
                outlines_model: generation_model_policy.outlines_model,
                scene_content_model: generation_model_policy.scene_content_model,
                scene_actions_model: generation_model_policy.scene_actions_model,
                scene_actions_fallback_model: generation_model_policy.scene_actions_fallback_model,
            },
            selected_model_profile,
            auth_blueprint,
            deployment_blueprint,
            credit_policy,
            configured_provider_priority: self.provider_config.llm_provider_priority.clone(),
            runtime_session_modes: vec![
                "stateless_client_state".to_string(),
                "managed_runtime_session".to_string(),
            ],
            runtime_native_streaming_required: runtime_native_streaming_required(),
            runtime_native_streaming_selectors: runtime_native_streaming_selectors(),
            runtime_native_typed_streaming_required: runtime_native_typed_streaming_required(),
            runtime_degraded_single_turn_only: runtime_degraded_single_turn_only(),
            runtime_alert_level,
            runtime_alerts,
            asset_backend: asset_backend_label(),
            queue_backend: queue.backend_label().to_string(),
            lesson_backend: self.storage.lesson_backend().to_string(),
            job_backend: self.storage.job_backend().to_string(),
            runtime_session_backend: self.storage.runtime_session_backend().to_string(),
            queue_pending_jobs,
            queue_active_leases,
            queue_stale_leases,
            queue_status_error,
            queue_poll_ms: queue_poll_ms(),
            queue_claim_heartbeat_interval_ms: claim_heartbeat_interval_ms(),
            queue_stale_timeout_ms: stale_working_timeout_ms(),
            provider_total_requests: provider_totals.total_requests,
            provider_total_successes: provider_totals.total_successes,
            provider_total_failures: provider_totals.total_failures,
            provider_total_latency_ms: provider_totals.total_latency_ms,
            provider_average_latency_ms: provider_totals.average_latency_ms,
            provider_estimated_input_tokens: provider_totals.estimated_input_tokens,
            provider_estimated_output_tokens: provider_totals.estimated_output_tokens,
            provider_estimated_total_cost_microusd: provider_totals.estimated_total_cost_microusd,
            provider_reported_input_tokens: provider_totals.provider_reported_input_tokens,
            provider_reported_output_tokens: provider_totals.provider_reported_output_tokens,
            provider_reported_total_tokens: provider_totals.provider_reported_total_tokens,
            provider_reported_total_cost_microusd: provider_totals
                .provider_reported_total_cost_microusd,
            provider_runtime,
            provider_status_error,
        })
    }

    fn current_provider_runtime_status(
        &self,
        model_string: Option<&str>,
    ) -> Result<Vec<ProviderRuntimeStatusResponse>> {
        let model_string = model_string
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                std::env::var("BALANCED_MODE_AI_TUTOR_MODEL")
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
            .ok_or_else(|| anyhow!("BALANCED_MODE_AI_TUTOR_MODEL is required"))?;

        let resolved = resolve_model(
            &self.provider_config,
            Some(&model_string),
            None,
            None,
            None,
            None,
        )?;

        let provider = self.provider_factory.build(resolved.model_config)?;
        Ok(map_provider_runtime_status(provider.runtime_status()))
    }
}

#[async_trait]
impl LessonAppService for LiveLessonAppService {
    async fn google_login(&self) -> Result<GoogleAuthLoginResponse> {
        ensure_auth_enabled("AI_TUTOR_GOOGLE_OAUTH_ENABLED")?;
        let state = issue_state_token()?;
        let url = build_google_oauth_url(&state)?;
        Ok(GoogleAuthLoginResponse {
            authorization_url: url,
            state,
        })
    }

    async fn google_callback(&self, query: GoogleAuthCallbackQuery) -> Result<AuthSessionResponse> {
        ensure_auth_enabled("AI_TUTOR_GOOGLE_OAUTH_ENABLED")?;
        if let Some(error) = query.error.filter(|value| !value.trim().is_empty()) {
            return Err(anyhow!("google oauth error: {}", error));
        }
        let code = query
            .code
            .clone()
            .ok_or_else(|| anyhow!("missing google oauth code"))?;
        let state = query
            .state
            .clone()
            .ok_or_else(|| anyhow!("missing google oauth state"))?;
        tracing::info!("Auth Callback: Validating state token");
        validate_state_token(&state)?;

        tracing::info!("Auth Callback: Exchanging code for tokens");
        let token_response = self.exchange_google_code(&code).await?;

        tracing::info!("Auth Callback: Verifying Google ID token");
        let claims = self
            .verify_google_id_token(&token_response.id_token)
            .await?;

        tracing::info!(email = %claims.email, sub = %claims.sub, "Auth Callback: Upserting Google account");
        let account = self.upsert_google_account(&claims).await?;

        tracing::info!(status = ?account.status, "Auth Callback: Account resolved, checking verification status");
        let phone_auth_required = env_flag("AI_TUTOR_FIREBASE_PHONE_AUTH_ENABLED");
        let phone_ok = !phone_auth_required || account.phone_verified;
        if matches!(account.status, TutorAccountStatus::Active) && phone_ok {
            let session_token = issue_session_token(&account)?;
            tracing::info!("Auth Callback: Login successful, issuing session");
            return Ok(AuthSessionResponse {
                account_id: account.id,
                status: "active".to_string(),
                email: account.email,
                phone_number: account.phone_number,
                redirect_to: auth_success_redirect(),
                partial_auth_token: None,
                session_token: Some(session_token),
            });
        }
        // Account status is PartialAuth or phone verification is required but missing
        if !matches!(account.status, TutorAccountStatus::Active) && !phone_auth_required {
            // Phone auth is disabled – auto-activate the account so Google-only login works
            tracing::info!("Auth Callback: Phone auth disabled, auto-activating account");
            let activated = self.activate_account_without_phone(&account.id).await?;
            let session_token = issue_session_token(&activated)?;
            return Ok(AuthSessionResponse {
                account_id: activated.id,
                status: "active".to_string(),
                email: activated.email,
                phone_number: activated.phone_number,
                redirect_to: auth_success_redirect(),
                partial_auth_token: None,
                session_token: Some(session_token),
            });
        }

        tracing::info!("Auth Callback: Partial auth required (phone verification)");
        let partial_auth_token = issue_partial_auth_token(&account)?;
        Ok(AuthSessionResponse {
            account_id: account.id,
            status: "partial_auth".to_string(),
            email: account.email,
            phone_number: account.phone_number,
            redirect_to: verify_phone_path(),
            partial_auth_token: Some(partial_auth_token),
            session_token: None,
        })
    }

    async fn bind_phone(&self, payload: BindPhoneRequest) -> Result<AuthSessionResponse> {
        ensure_auth_enabled("AI_TUTOR_FIREBASE_PHONE_AUTH_ENABLED")?;
        let partial_token = payload
            .partial_auth_token
            .clone()
            .ok_or_else(|| anyhow!("missing partial auth token"))?;
        let partial_claims = verify_partial_auth_token(&partial_token)?;
        let firebase_claims = self
            .verify_firebase_id_token(&payload.firebase_id_token)
            .await?;
        let phone_number = firebase_claims
            .phone_number
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();
        let account = self
            .activate_account_with_phone(&partial_claims, &phone_number)
            .await?;
        let session_token = issue_session_token(&account)?;
        Ok(AuthSessionResponse {
            account_id: account.id,
            status: "active".to_string(),
            email: account.email,
            phone_number: account.phone_number,
            redirect_to: auth_success_redirect(),
            partial_auth_token: None,
            session_token: Some(session_token),
        })
    }

    async fn get_billing_catalog(&self) -> Result<BillingCatalogResponse> {
        Ok(BillingCatalogResponse {
            gateway: "easebuzz".to_string(),
            items: billing_catalog()
                .into_iter()
                .map(|item| BillingCatalogItemResponse {
                    product_code: item.product_code,
                    kind: billing_product_kind_label(&item.kind).to_string(),
                    title: item.title,
                    credits: item.credits,
                    currency: item.currency,
                    amount_minor: item.amount_minor,
                })
                .collect(),
        })
    }

    async fn create_checkout(
        &self,
        account_id: &str,
        payload: CreateCheckoutRequest,
    ) -> Result<CheckoutSessionResponse> {
        let Some(account) = self
            .storage
            .get_tutor_account_by_id(account_id)
            .await
            .map_err(|err| anyhow!(err))?
        else {
            return Err(anyhow!("tutor account not found: {}", account_id));
        };
        let phone_auth_required = env_flag("AI_TUTOR_FIREBASE_PHONE_AUTH_ENABLED");
        if !matches!(account.status, TutorAccountStatus::Active)
            || (phone_auth_required && !account.phone_verified)
        {
            return Err(anyhow!(
                "account {} must be active{} before checkout",
                account_id,
                if phone_auth_required { " and phone verified" } else { "" }
            ));
        }
        let product = billing_catalog()
            .into_iter()
            .find(|item| item.product_code == payload.product_code)
            .ok_or_else(|| anyhow!("unknown billing product {}", payload.product_code))?;
        self.initiate_easebuzz_checkout(&account, &product).await
    }

    async fn handle_easebuzz_callback(
        &self,
        form_fields: HashMap<String, String>,
    ) -> Result<EasebuzzCallbackResponse> {
        self.finalize_easebuzz_payment(&form_fields).await
    }

    async fn list_payment_orders(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<PaymentOrderListResponse> {
        let orders = self
            .storage
            .list_payment_orders_for_account(account_id, limit)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(PaymentOrderListResponse {
            orders: orders
                .into_iter()
                .map(payment_order_to_response)
                .collect::<Vec<_>>(),
        })
    }

    async fn get_billing_report(&self) -> Result<BillingReportResponse> {
        let orders = self
            .storage
            .list_all_payment_orders(500)
            .await
            .map_err(|err| anyhow!(err))?;
        let credit_entries = self
            .storage
            .list_all_credit_entries(2_000)
            .await
            .map_err(|err| anyhow!(err))?;
        let status = self.get_system_status().await?;

        let successful_payment_orders = orders
            .iter()
            .filter(|order| matches!(order.status, PaymentOrderStatus::Succeeded))
            .count();
        let failed_payment_orders = orders
            .iter()
            .filter(|order| matches!(order.status, PaymentOrderStatus::Failed))
            .count();
        let pending_payment_orders = orders
            .iter()
            .filter(|order| matches!(order.status, PaymentOrderStatus::Pending))
            .count();
        let paid_credits_granted = credit_entries
            .iter()
            .filter(|entry| {
                matches!(entry.kind, CreditEntryKind::Grant)
                    && entry.reason.starts_with("payment_order:")
            })
            .map(|entry| entry.amount)
            .sum();
        let lesson_credits_debited = credit_entries
            .iter()
            .filter(|entry| {
                matches!(entry.kind, CreditEntryKind::Debit)
                    && entry.reason.starts_with("lesson:")
            })
            .map(|entry| entry.amount)
            .sum();

        Ok(BillingReportResponse {
            gateway: "easebuzz".to_string(),
            gateway_currency: billing_currency(),
            total_payment_orders: orders.len(),
            successful_payment_orders,
            failed_payment_orders,
            pending_payment_orders,
            paid_credits_granted,
            lesson_credits_debited,
            provider_estimated_total_cost_microusd: status.provider_estimated_total_cost_microusd,
            provider_reported_total_cost_microusd: status.provider_reported_total_cost_microusd,
        })
    }

    async fn get_billing_dashboard(&self, account_id: &str) -> Result<BillingDashboardResponse> {
        let billing_context = self.load_billing_context(account_id).await?;
        let unpaid_invoices = self
            .storage
            .get_unpaid_invoices_for_account(account_id)
            .await
            .map_err(|err| anyhow!(err))?;
        let blocking_unpaid_invoice_count = unpaid_invoices
            .iter()
            .filter(|invoice| {
                matches!(
                    invoice.status,
                    InvoiceStatus::Overdue | InvoiceStatus::Uncollectible
                )
            })
            .count();

        let active_dunning_case_count = self
            .storage
            .list_active_dunning_cases()
            .await
            .map_err(|err| anyhow!(err))?
            .into_iter()
            .filter(|case_item| case_item.account_id == account_id)
            .count();

        let recent_orders = self.list_payment_orders(account_id, 10).await?.orders;
        let recent_ledger_entries = self.get_credit_ledger(account_id, 10).await?.entries;
        let recent_invoices = self
            .storage
            .list_invoices_for_account(account_id, 10)
            .await
            .map_err(|err| anyhow!(err))?
            .into_iter()
            .map(|invoice| BillingInvoiceSummaryResponse {
                id: invoice.id,
                invoice_type: format!("{:?}", invoice.invoice_type).to_lowercase(),
                status: format!("{:?}", invoice.status).to_lowercase(),
                amount_cents: invoice.amount_cents,
                amount_after_credits: invoice.amount_after_credits,
                billing_cycle_start: invoice.billing_cycle_start.to_rfc3339(),
                billing_cycle_end: invoice.billing_cycle_end.to_rfc3339(),
                due_at: invoice.due_at.map(|dt| dt.to_rfc3339()),
                paid_at: invoice.paid_at.map(|dt| dt.to_rfc3339()),
                created_at: invoice.created_at.to_rfc3339(),
            })
            .collect::<Vec<_>>();

        let entitlement = BillingEntitlementResponse {
            account_id: account_id.to_string(),
            credit_balance: billing_context.credit_balance,
            can_generate: billing_context.can_generate,
            has_active_subscription: billing_context.active_subscription.is_some(),
            active_subscription: billing_context
                .active_subscription
                .as_ref()
                .map(Self::map_subscription_response),
            blocking_unpaid_invoice_count,
            active_dunning_case_count,
        };

        Ok(BillingDashboardResponse {
            entitlement,
            recent_orders,
            recent_ledger_entries,
            recent_invoices,
        })
    }

    async fn get_credit_balance(&self, account_id: &str) -> Result<CreditBalanceResponse> {
        let balance = self
            .storage
            .get_credit_balance(account_id)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(CreditBalanceResponse {
            account_id: balance.account_id,
            balance: balance.balance,
        })
    }

    async fn get_credit_ledger(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<CreditLedgerResponse> {
        let entries = self
            .storage
            .list_credit_entries(account_id, limit)
            .await
            .map_err(|err| anyhow!(err))?;
        let mapped = entries
            .into_iter()
            .map(|entry| CreditLedgerEntryResponse {
                id: entry.id,
                kind: match entry.kind {
                    CreditEntryKind::Grant => "grant".to_string(),
                    CreditEntryKind::Debit => "debit".to_string(),
                    CreditEntryKind::Refund => "refund".to_string(),
                },
                amount: entry.amount,
                reason: entry.reason,
                created_at: entry.created_at.to_rfc3339(),
            })
            .collect::<Vec<_>>();
        Ok(CreditLedgerResponse {
            account_id: account_id.to_string(),
            entries: mapped,
        })
    }

    async fn load_billing_context(&self, account_id: &str) -> Result<BillingContext> {
        // Load current credit balance
        let balance = self
            .storage
            .get_credit_balance(account_id)
            .await
            .map_err(|err| anyhow!("Failed to load credit balance: {}", err))?;

        // Load active subscription (get most recent one for this account)
        let subscriptions = self
            .storage
            .list_subscriptions_for_account(account_id, 1)
            .await
            .map_err(|err| anyhow!("Failed to load subscriptions: {}", err))?;

        let active_subscription = subscriptions.first().and_then(|sub| {
            // Only return if status is Active
            if sub.status == SubscriptionStatus::Active {
                Some(sub.clone())
            } else {
                None
            }
        });

        let mut context = BillingContext::new(balance.balance, active_subscription);

        let unpaid_invoices = self
            .storage
            .get_unpaid_invoices_for_account(account_id)
            .await
            .map_err(|err| anyhow!("Failed to load unpaid invoices: {}", err))?;
        let has_blocking_unpaid_invoice = unpaid_invoices.iter().any(|invoice| {
            matches!(
                invoice.status,
                InvoiceStatus::Overdue | InvoiceStatus::Uncollectible
            )
        });

        let active_dunning_cases = self
            .storage
            .list_active_dunning_cases()
            .await
            .map_err(|err| anyhow!("Failed to load active dunning cases: {}", err))?;
        let in_dunning_grace = active_dunning_cases.iter().any(|case_item| {
            case_item.account_id == account_id && case_item.grace_period_end > chrono::Utc::now()
        });

        if has_blocking_unpaid_invoice {
            context.can_generate = false;
            context.active_subscription = None;
        } else if in_dunning_grace {
            context.can_generate = true;
        }

        Ok(context)
        }

        async fn create_subscription(
            &self,
            account_id: &str,
            payload: CreateSubscriptionRequest,
        ) -> Result<SubscriptionResponse> {
            let billing_catalog = billing_catalog();
            let plan = billing_catalog
                .iter()
                .find(|item| item.product_code == payload.plan_code)
                .ok_or_else(|| anyhow!("Plan not found: {}", payload.plan_code))?;

            // Check if user already has active subscription
            let existing_subs = self
                .storage
                .list_subscriptions_for_account(account_id, 10)
                .await
                .map_err(|err| anyhow!(err))?;
        
            if existing_subs.iter().any(|sub| sub.status == SubscriptionStatus::Active) {
                return Err(anyhow!(
                    "User already has an active subscription. Cancel it first."
                ));
            }

            let now = chrono::Utc::now();
            let subscription = Subscription {
                id: Uuid::new_v4().to_string(),
                account_id: account_id.to_string(),
                plan_code: payload.plan_code.clone(),
                gateway: "easebuzz".to_string(),
                gateway_subscription_id: None,
                status: SubscriptionStatus::Active,
                billing_interval: BillingInterval::Monthly,
                credits_per_cycle: plan.credits,
                autopay_enabled: true,
                current_period_start: now,
                current_period_end: now + chrono::Duration::days(30),
                next_renewal_at: Some(now + chrono::Duration::days(30)),
                grace_period_until: None,
                cancelled_at: None,
                last_payment_order_id: None,
                created_at: now,
                updated_at: now,
            };

            self.storage
                .save_subscription(&subscription)
                .await
                .map_err(|err| anyhow!(err))?;

            Ok(SubscriptionResponse {
                id: subscription.id,
                account_id: subscription.account_id,
                plan_code: subscription.plan_code,
                status: "active".to_string(),
                billing_interval: "monthly".to_string(),
                credits_per_cycle: subscription.credits_per_cycle,
                autopay_enabled: subscription.autopay_enabled,
                current_period_start: subscription.current_period_start.to_rfc3339(),
                current_period_end: subscription.current_period_end.to_rfc3339(),
                next_renewal_at: subscription.next_renewal_at.map(|dt| dt.to_rfc3339()),
                grace_period_until: subscription.grace_period_until.map(|dt| dt.to_rfc3339()),
                created_at: subscription.created_at.to_rfc3339(),
                updated_at: subscription.updated_at.to_rfc3339(),
            })
        }

        async fn get_subscription(&self, account_id: &str) -> Result<SubscriptionListResponse> {
            let subscriptions = self
                .storage
                .list_subscriptions_for_account(account_id, 1)
                .await
                .map_err(|err| anyhow!(err))?;

            let subscription = subscriptions
                .first()
                .and_then(|sub| {
                    if sub.status == SubscriptionStatus::Active {
                        Some(Self::map_subscription_response(sub))
                    } else {
                        None
                    }
                });

            Ok(SubscriptionListResponse { subscription })
        }

        async fn cancel_subscription(
            &self,
            account_id: &str,
            subscription_id: &str,
            _payload: CancelSubscriptionRequest,
        ) -> Result<CancelSubscriptionResponse> {
            let subscription = self
                .storage
                .get_subscription_by_id(subscription_id)
                .await
                .map_err(|err| anyhow!(err))?
                .ok_or_else(|| anyhow!("Subscription not found: {}", subscription_id))?;

            // Verify ownership
            if subscription.account_id != account_id {
                return Err(anyhow!("Subscription does not belong to this account"));
            }

            // Update cancelled_at
            let mut updated = subscription.clone();
            updated.status = SubscriptionStatus::Cancelled;
            updated.cancelled_at = Some(chrono::Utc::now());
            updated.updated_at = chrono::Utc::now();

            self.storage
                .save_subscription(&updated)
                .await
                .map_err(|err| anyhow!(err))?;

            Ok(CancelSubscriptionResponse {
                id: updated.id,
                status: format!("{:?}", updated.status).to_lowercase(),
                cancelled_at: updated
                    .cancelled_at
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default(),
            })
    }

    async fn get_admin_user_stats(&self) -> Result<AdminUserStatsResponse> {
        let accounts = self
            .storage
            .list_all_tutor_accounts(100_000)
            .await
            .map_err(|err| anyhow!(err))?;
        let now = chrono::Utc::now();
        let today = now - chrono::Duration::days(1);
        let week = now - chrono::Duration::days(7);
        let month = now - chrono::Duration::days(30);

        Ok(AdminUserStatsResponse {
            total_users: accounts.len(),
            active_users_today: accounts.iter().filter(|a| a.updated_at >= today).count(),
            active_users_week: accounts.iter().filter(|a| a.updated_at >= week).count(),
            active_users_month: accounts.iter().filter(|a| a.updated_at >= month).count(),
            new_users_today: accounts.iter().filter(|a| a.created_at >= today).count(),
            new_users_week: accounts.iter().filter(|a| a.created_at >= week).count(),
        })
    }

    async fn get_admin_users(&self) -> Result<AdminUsersListResponse> {
        let accounts = self
            .storage
            .list_all_tutor_accounts(100_000)
            .await
            .map_err(|err| anyhow!(err))?;
        
        let users = accounts.into_iter().map(|a| AdminUser {
            account_id: a.id,
            email: Some(a.email),
            created_at_unix: a.created_at.timestamp(),
        }).collect();

        Ok(AdminUsersListResponse { users })
    }

    async fn get_admin_settings(&self) -> Result<AdminSettingsResponse> {
        let operator_roles = read_optional_env("AI_TUTOR_OPERATOR_EMAIL_ROLES")
            .unwrap_or_default();
        let api_base_url = read_optional_env("AI_TUTOR_API_BASE_URL")
            .unwrap_or_else(|| "http://localhost:8099".to_string());
        
        Ok(AdminSettingsResponse {
            operator_roles,
            api_base_url,
        })
    }

    async fn get_admin_jobs(&self) -> Result<AdminJobsListResponse> {
        let jobs = self.storage.list_all_jobs(500).await.map_err(|e| anyhow!(e))?;
        Ok(AdminJobsListResponse { jobs })
    }

    async fn get_admin_audit_logs(&self) -> Result<AdminAuditLogsResponse> {
        let logs = self.storage.list_all_audit_logs(500).await.map_err(|e| anyhow!(e))?;
        Ok(AdminAuditLogsResponse { logs })
    }

    async fn toggle_maintenance(&self) -> Result<ToggleMaintenanceResponse> {
        let flag_path = self.storage.root_dir().join(".maintenance");
        let is_maintenance_mode = if flag_path.exists() {
            let _ = std::fs::remove_file(&flag_path);
            false
        } else {
            let _ = std::fs::write(&flag_path, b"1");
            true
        };
        Ok(ToggleMaintenanceResponse {
            status: if is_maintenance_mode { "Maintenance mode enabled" } else { "Maintenance mode disabled" },
            is_maintenance_mode,
        })
    }

    async fn get_admin_subscription_stats(&self) -> Result<AdminSubscriptionStatsResponse> {
        let subscriptions = self
            .storage
            .list_all_subscriptions(100_000)
            .await
            .map_err(|err| anyhow!(err))?;
        let recent_payments = self
            .storage
            .list_all_payment_orders(100_000)
            .await
            .map_err(|err| anyhow!(err))?;
        let now = chrono::Utc::now();
        let (month_start, month_end) = billing_month_window(now);
        let (rolling_start, rolling_end) = rolling_30d_window(now);

        let revenue_monthly_minor: i64 = recent_payments
            .iter()
            .filter(|order| {
                matches!(order.status, PaymentOrderStatus::Succeeded)
                    && matches!(order.product_kind, BillingProductKind::Subscription)
                    && {
                        let effective_at = payment_effective_at(order);
                        effective_at >= month_start && effective_at < month_end
                    }
            })
            .map(|order| order.amount_minor)
            .sum();

        let revenue_rolling_30d_minor: i64 = recent_payments
            .iter()
            .filter(|order| {
                matches!(order.status, PaymentOrderStatus::Succeeded)
                    && matches!(order.product_kind, BillingProductKind::Subscription)
                    && {
                        let effective_at = payment_effective_at(order);
                        effective_at >= rolling_start && effective_at < rolling_end
                    }
            })
            .map(|order| order.amount_minor)
            .sum();

        Ok(AdminSubscriptionStatsResponse {
            total_subscriptions: subscriptions.len(),
            active_subscriptions: subscriptions
                .iter()
                .filter(|sub| matches!(sub.status, SubscriptionStatus::Active))
                .count(),
            cancelled_subscriptions: subscriptions
                .iter()
                .filter(|sub| matches!(sub.status, SubscriptionStatus::Cancelled))
                .count(),
            churned_users_month: subscriptions
                .iter()
                .filter(|sub| {
                    matches!(sub.status, SubscriptionStatus::Cancelled)
                        && sub
                            .cancelled_at
                            .is_some_and(|cancelled_at| cancelled_at >= month_start)
                })
                .count(),
            revenue_monthly: revenue_monthly_minor as f64 / 100.0,
            revenue_rolling_30d: revenue_rolling_30d_minor as f64 / 100.0,
        })
    }

    async fn get_admin_payment_stats(&self) -> Result<AdminPaymentStatsResponse> {
        let orders = self
            .storage
            .list_all_payment_orders(100_000)
            .await
            .map_err(|err| anyhow!(err))?;

        let successful_payments = orders
            .iter()
            .filter(|order| matches!(order.status, PaymentOrderStatus::Succeeded))
            .count();
        let failed_payments = orders
            .iter()
            .filter(|order| matches!(order.status, PaymentOrderStatus::Failed))
            .count();
        let total_revenue_minor: i64 = orders
            .iter()
            .filter(|order| matches!(order.status, PaymentOrderStatus::Succeeded))
            .map(|order| order.amount_minor)
            .sum();
        let success_rate = if orders.is_empty() {
            0.0
        } else {
            successful_payments as f64 / orders.len() as f64
        };
        let average_transaction_value = if successful_payments == 0 {
            0.0
        } else {
            (total_revenue_minor as f64 / 100.0) / successful_payments as f64
        };

        Ok(AdminPaymentStatsResponse {
            total_payments: orders.len(),
            successful_payments,
            failed_payments,
            success_rate,
            total_revenue: total_revenue_minor as f64 / 100.0,
            average_transaction_value,
        })
    }

    async fn get_admin_promo_code_stats(&self) -> Result<AdminPromoCodeStatsResponse> {
        let codes = self
            .storage
            .list_all_promo_codes(10_000)
            .await
            .map_err(|err| anyhow!(err))?;
        let now = chrono::Utc::now();

        let total_redemptions: usize = codes
            .iter()
            .map(|code| code.redeemed_by_accounts.len())
            .sum();
        let total_credits_granted: f64 = codes
            .iter()
            .map(|code| code.redeemed_by_accounts.len() as f64 * code.grant_credits)
            .sum();
        let average_redemption_rate = if codes.is_empty() {
            0.0
        } else {
            let utilization_sum: f64 = codes
                .iter()
                .map(|code| {
                    let redeemed = code.redeemed_by_accounts.len() as f64;
                    match code.max_redemptions {
                        Some(max) if max > 0 => (redeemed / max as f64).min(1.0),
                        _ => {
                            if redeemed > 0.0 {
                                1.0
                            } else {
                                0.0
                            }
                        }
                    }
                })
                .sum();
            utilization_sum / codes.len() as f64
        };

        Ok(AdminPromoCodeStatsResponse {
            total_promo_codes: codes.len(),
            active_promo_codes: codes
                .iter()
                .filter(|code| {
                    let not_expired = code.expires_at.is_none_or(|expires_at| expires_at > now);
                    let has_capacity = code
                        .max_redemptions
                        .is_none_or(|max| code.redeemed_by_accounts.len() < max);
                    not_expired && has_capacity
                })
                .count(),
            total_redemptions,
            total_credits_granted,
            average_redemption_rate,
        })
    }

    async fn generate_lesson(
        &self,
        payload: GenerateLessonPayload,
    ) -> Result<GenerateLessonResponse> {
        let model_string = payload.model.clone();
        let request = build_generation_request(payload)?;
        let request_for_generation = request.clone();
        let orchestrator = self
            .build_orchestrator(&request, model_string.as_deref())
            .await?;

        let output = orchestrator
            .generate_lesson(request_for_generation, &self.base_url)
            .await?;
        let result = output
            .job
            .result
            .clone()
            .ok_or_else(|| anyhow!("lesson generation completed without result"))?;

        self.apply_credit_debit_for_output(&request, &output.lesson)
            .await?;

        if let Some(account_id) = request.account_id.as_deref() {
            self.ensure_lesson_adaptive_initialized(
                &output.lesson.id,
                Some(account_id.to_string()),
                output.lesson.description.clone(),
            )
            .await?;
            self.upsert_generation_shelf_item(
                account_id,
                &output.lesson.id,
                Some(&output.job.id),
                &output.lesson.title,
                output.lesson.description.clone(),
                Some(output.lesson.language.clone()),
                LessonShelfStatus::Ready,
                None,
            )
            .await?;
        }

        Ok(GenerateLessonResponse {
            lesson_id: output.lesson.id,
            job_id: output.job.id,
            url: result.url,
            scenes_count: output.lesson.scenes.len(),
        })
    }

    async fn queue_lesson(&self, payload: GenerateLessonPayload) -> Result<GenerateLessonResponse> {
        let model_string = payload.model.clone();
        let request = build_generation_request(payload)?;
        let account_id = request.account_id.clone();
        let lesson_id = Uuid::new_v4().to_string();
        let max_attempts = 3;
        let job = build_queued_job(Uuid::new_v4().to_string(), &request, chrono::Utc::now());
        self.storage
            .create_job(&job)
            .await
            .map_err(|err| anyhow!(err))?;
        self.storage
            .save_queued_job_snapshot(
                &job.id,
                &QueuedLessonJobSnapshot {
                    lesson_id: lesson_id.clone(),
                    request: request.clone(),
                    model_string: model_string.clone(),
                    max_attempts,
                },
            )
            .await
            .map_err(|err| anyhow!(err))?;

        if let Some(account_id) = account_id.as_deref() {
            self.ensure_lesson_adaptive_initialized(
                &lesson_id,
                Some(account_id.to_string()),
                Some(request.requirements.requirement.clone()),
            )
            .await?;
            self.upsert_generation_shelf_item(
                account_id,
                &lesson_id,
                Some(&job.id),
                "Generating lesson",
                Some(request.requirements.requirement.clone()),
                Some(match request.requirements.language {
                    Language::EnUs => "en-US".to_string(),
                    Language::ZhCn => "zh-CN".to_string(),
                }),
                LessonShelfStatus::Generating,
                None,
            )
            .await?;
        }

        let queue = Arc::new(match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        });
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: lesson_id.clone(),
                job: job.clone(),
                request,
                model_string: model_string.clone(),
                attempt: 0,
                max_attempts,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await?;
        let mut service = LiveLessonAppService::new(
            Arc::clone(&self.storage),
            Arc::clone(&self.provider_config),
            Arc::clone(&self.provider_factory),
            Arc::clone(&self.image_provider_factory),
            Arc::clone(&self.video_provider_factory),
            Arc::clone(&self.tts_provider_factory),
            self.base_url.clone(),
        );
        service.queue_db_path = self.queue_db_path.clone();
        let service = Arc::new(service);
        spawn_one_shot_queue_kick(queue, service);

        Ok(GenerateLessonResponse {
            lesson_id: lesson_id.clone(),
            job_id: job.id,
            url: format!(
                "{}/lessons/{}",
                self.base_url.trim_end_matches('/'),
                lesson_id
            ),
            scenes_count: 0,
        })
    }

    async fn list_lesson_shelf(
        &self,
        account_id: &str,
        status: Option<String>,
        limit: usize,
    ) -> Result<LessonShelfListResponse> {
        let status_filter = status
            .as_deref()
            .map(Self::parse_lesson_shelf_status)
            .transpose()?;
        let items = self
            .storage
            .list_lesson_shelf_items_for_account(account_id, status_filter, limit)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(LessonShelfListResponse {
            items: items
                .iter()
                .map(Self::map_lesson_shelf_response)
                .collect::<Vec<_>>(),
        })
    }

    async fn patch_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
        patch: LessonShelfPatchRequest,
    ) -> Result<LessonShelfItemResponse> {
        let mut item = self
            .storage
            .get_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        if item.account_id != account_id {
            return Err(anyhow!("lesson shelf item does not belong to account"));
        }

        if let Some(title) = patch.title {
            item.title = title;
        }
        if let Some(progress_pct) = patch.progress_pct {
            item.progress_pct = progress_pct.clamp(0, 100);
        }
        if let Some(status) = patch.status {
            item.status = Self::parse_lesson_shelf_status(&status)?;
            if item.status == LessonShelfStatus::Archived {
                item.archived_at = Some(chrono::Utc::now());
            } else {
                item.archived_at = None;
            }
            if item.status != LessonShelfStatus::Failed {
                item.failure_reason = None;
            }
        }
        item.updated_at = chrono::Utc::now();
        self.storage
            .upsert_lesson_shelf_item(&item)
            .await
            .map_err(|err| anyhow!(err))?;
        Ok(Self::map_lesson_shelf_response(&item))
    }

    async fn archive_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
    ) -> Result<LessonShelfItemResponse> {
        let item = self
            .storage
            .get_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        if item.account_id != account_id {
            return Err(anyhow!("lesson shelf item does not belong to account"));
        }
        self.storage
            .archive_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?;
        let updated = self
            .storage
            .get_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        Ok(Self::map_lesson_shelf_response(&updated))
    }

    async fn reopen_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
    ) -> Result<LessonShelfItemResponse> {
        let item = self
            .storage
            .get_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        if item.account_id != account_id {
            return Err(anyhow!("lesson shelf item does not belong to account"));
        }
        self.storage
            .reopen_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?;
        let updated = self
            .storage
            .get_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        Ok(Self::map_lesson_shelf_response(&updated))
    }

    async fn retry_lesson_shelf_item(
        &self,
        account_id: &str,
        item_id: &str,
    ) -> Result<LessonShelfItemResponse> {
        let item = self
            .storage
            .get_lesson_shelf_item(item_id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        if item.account_id != account_id {
            return Err(anyhow!("lesson shelf item does not belong to account"));
        }

        let source_job_id = item
            .source_job_id
            .clone()
            .ok_or_else(|| anyhow!("lesson shelf item does not have retry provenance"))?;

        match self.resume_job(&source_job_id).await? {
            ResumeLessonJobOutcome::Resumed(_) | ResumeLessonJobOutcome::AlreadyQueuedOrRunning => {
                let mut updated = item;
                updated.status = LessonShelfStatus::Generating;
                updated.progress_pct = 0;
                updated.failure_reason = None;
                updated.updated_at = chrono::Utc::now();
                self.storage
                    .upsert_lesson_shelf_item(&updated)
                    .await
                    .map_err(|err| anyhow!(err))?;
                Ok(Self::map_lesson_shelf_response(&updated))
            }
            ResumeLessonJobOutcome::MissingSnapshot => Err(anyhow!(
                "queued job snapshot not found for retry: {}",
                source_job_id
            )),
            ResumeLessonJobOutcome::NotFound => {
                Err(anyhow!("queued job not found for retry: {}", source_job_id))
            }
        }
    }

    async fn mark_lesson_shelf_opened(
        &self,
        account_id: &str,
        lesson_id: &str,
        item_id: Option<&str>,
    ) -> Result<LessonShelfItemResponse> {
        let item = if let Some(item_id) = item_id {
            self.storage
                .get_lesson_shelf_item(item_id)
                .await
                .map_err(|err| anyhow!(err))?
        } else {
            self.storage
                .list_lesson_shelf_items_for_account(account_id, None, 500)
                .await
                .map_err(|err| anyhow!(err))?
                .into_iter()
                .find(|item| item.lesson_id == lesson_id)
        }
        .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        if item.account_id != account_id {
            return Err(anyhow!("lesson shelf item does not belong to account"));
        }
        self.storage
            .mark_lesson_shelf_opened(&item.id)
            .await
            .map_err(|err| anyhow!(err))?;
        let updated = self
            .storage
            .get_lesson_shelf_item(&item.id)
            .await
            .map_err(|err| anyhow!(err))?
            .ok_or_else(|| anyhow!("lesson shelf item not found"))?;
        Ok(Self::map_lesson_shelf_response(&updated))
    }

    async fn cancel_job(&self, id: &str) -> Result<CancelLessonJobOutcome> {
        let Some(mut job) = self.storage.get_job(id).await.map_err(|err| anyhow!(err))? else {
            return Ok(CancelLessonJobOutcome::NotFound);
        };

        let queue = match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        };

        match queue.cancel(id).await? {
            QueueCancelResult::Cancelled => {
                let now = chrono::Utc::now();
                job.status = ai_tutor_domain::job::LessonGenerationJobStatus::Cancelled;
                job.step = ai_tutor_domain::job::LessonGenerationStep::Cancelled;
                job.progress = 100;
                job.message = "Lesson generation cancelled".to_string();
                job.error = None;
                job.updated_at = now;
                job.completed_at = Some(now);
                self.storage
                    .update_job(&job)
                    .await
                    .map_err(|err| anyhow!(err))?;
                Ok(CancelLessonJobOutcome::Cancelled(job))
            }
            QueueCancelResult::AlreadyClaimed => Ok(CancelLessonJobOutcome::AlreadyRunning),
            QueueCancelResult::NotFound => Ok(CancelLessonJobOutcome::NotFound),
        }
    }

    async fn resume_job(&self, id: &str) -> Result<ResumeLessonJobOutcome> {
        let Some(mut job) = self.storage.get_job(id).await.map_err(|err| anyhow!(err))? else {
            return Ok(ResumeLessonJobOutcome::NotFound);
        };

        if matches!(
            job.status,
            LessonGenerationJobStatus::Queued | LessonGenerationJobStatus::Running
        ) {
            return Ok(ResumeLessonJobOutcome::AlreadyQueuedOrRunning);
        }

        let Some(snapshot) = self
            .storage
            .get_queued_job_snapshot(id)
            .await
            .map_err(|err| anyhow!(err))?
        else {
            return Ok(ResumeLessonJobOutcome::MissingSnapshot);
        };

        let now = chrono::Utc::now();
        job.status = LessonGenerationJobStatus::Queued;
        job.step = LessonGenerationStep::Queued;
        job.progress = 0;
        job.message = "Lesson generation re-queued".to_string();
        job.error = None;
        job.scenes_generated = 0;
        job.total_scenes = None;
        job.result = None;
        job.updated_at = now;
        job.started_at = None;
        job.completed_at = None;
        self.storage
            .update_job(&job)
            .await
            .map_err(|err| anyhow!(err))?;

        let queue = Arc::new(match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        });
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: snapshot.lesson_id,
                job: job.clone(),
                request: snapshot.request,
                model_string: snapshot.model_string,
                attempt: 0,
                max_attempts: snapshot.max_attempts,
                last_error: None,
                queued_at: now,
                available_at: now,
            })
            .await?;

        let mut service = LiveLessonAppService::new(
            Arc::clone(&self.storage),
            Arc::clone(&self.provider_config),
            Arc::clone(&self.provider_factory),
            Arc::clone(&self.image_provider_factory),
            Arc::clone(&self.video_provider_factory),
            Arc::clone(&self.tts_provider_factory),
            self.base_url.clone(),
        );
        service.queue_db_path = self.queue_db_path.clone();
        spawn_one_shot_queue_kick(queue, Arc::new(service));

        Ok(ResumeLessonJobOutcome::Resumed(job))
    }

    async fn stateless_chat(&self, payload: StatelessChatRequest) -> Result<Vec<TutorStreamEvent>> {
        let adaptive_signal = adaptive_signal_from_stateless_payload(&payload);
        let runtime_session_mode =
            validate_runtime_session_mode(&payload).map_err(|err| anyhow!(err))?;
        let runtime_session_mode_label = runtime_session_mode_label(&runtime_session_mode);
        let session_id = payload
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let runtime_session_id = coordination_session_id(&runtime_session_mode, &session_id);
        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            "Starting stateless tutor request"
        );
        self.expire_runtime_action_timeouts(&runtime_session_id)
            .await?;
        let graph_events = self
            .run_stateless_chat_graph(payload, &session_id, None, None)
            .await?;
        let mut events = vec![build_session_started_event(
            &session_id,
            &runtime_session_id,
            runtime_session_mode_label,
        )];
        for event in graph_events {
            let tutor_event = map_graph_event_to_tutor_event(
                event,
                &session_id,
                &runtime_session_id,
                runtime_session_mode_label,
            );
            self.record_runtime_action_expectation(&tutor_event).await?;
            events.push(tutor_event);
        }

        if let Some(adaptive_signal) = adaptive_signal {
            self.update_lesson_adaptive_progress(
                &adaptive_signal.lesson_id,
                adaptive_signal.topic,
                adaptive_signal.should_record_diagnostic,
            )
            .await?;
        }

        Ok(events)
    }

    async fn stateless_chat_stream(
        &self,
        payload: StatelessChatRequest,
        sender: mpsc::Sender<TutorStreamEvent>,
    ) -> Result<()> {
        let adaptive_signal = adaptive_signal_from_stateless_payload(&payload);
        let runtime_session_mode =
            validate_runtime_session_mode(&payload).map_err(|err| anyhow!(err))?;
        let runtime_session_mode_label = runtime_session_mode_label(&runtime_session_mode);
        let session_id = payload
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let runtime_session_id = coordination_session_id(&runtime_session_mode, &session_id);
        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            "Starting stateless tutor stream"
        );
        self.expire_runtime_action_timeouts(&runtime_session_id)
            .await?;
        sender
            .send(build_session_started_event(
                &session_id,
                &runtime_session_id,
                runtime_session_mode_label,
            ))
            .await
            .map_err(|_| anyhow!("failed to send session_started tutor event"))?;

        let (graph_sender, mut graph_receiver) = mpsc::unbounded_channel();
        let cancellation = CancellationToken::new();
        let graph_service = self.clone();
        let graph_session_id = session_id.clone();
        let graph_cancellation = cancellation.clone();
        let mut graph_handle = tokio::spawn(async move {
            graph_service
                .run_stateless_chat_graph(
                    payload,
                    &graph_session_id,
                    Some(graph_sender),
                    Some(graph_cancellation),
                )
                .await
        });

        // OpenMAIC equivalent:
        // - adapter.streamGenerate(...) receives an AbortSignal
        // - when stream consumer closes, upstream generation is aborted
        //
        // Rust equivalent here:
        // - SSE forward path watches downstream channel liveness
        // - on disconnect, abort the running graph task immediately
        let mut graph_result = None;
        loop {
            tokio::select! {
                _ = sender.closed() => {
                    warn!(
                        transport_session_id = %session_id,
                        runtime_session_mode = runtime_session_mode_label,
                        "Downstream tutor stream closed; propagating cancellation"
                    );
                    cancellation.cancel();
                    break;
                }
                maybe_event = graph_receiver.recv() => {
                    match maybe_event {
                        Some(graph_event) => {
                            let tutor_event = map_graph_event_to_tutor_event(
                                graph_event,
                                &session_id,
                                &runtime_session_id,
                                runtime_session_mode_label,
                            );
                            self.record_runtime_action_expectation(&tutor_event).await?;
                            if sender.send(tutor_event).await.is_err() {
                                warn!(
                                    transport_session_id = %session_id,
                                    runtime_session_mode = runtime_session_mode_label,
                                    "Downstream tutor stream disconnected; propagating cancellation"
                                );
                                cancellation.cancel();
                                break;
                            }
                        }
                        None => break,
                    }
                }
                result = &mut graph_handle => {
                    graph_result = Some(result);
                    break;
                }
            }
        }

        if graph_result.is_none() {
            match tokio::time::timeout(Duration::from_millis(250), &mut graph_handle).await {
                Ok(result) => graph_result = Some(result),
                Err(_) => {
                    warn!(
                        transport_session_id = %session_id,
                        runtime_session_mode = runtime_session_mode_label,
                        "Graph task did not stop promptly after cancellation; aborting task"
                    );
                    cancellation.cancel();
                    graph_handle.abort();
                    graph_result = Some(graph_handle.await);
                }
            }
        }

        match graph_result.expect("graph result should be captured") {
            Ok(result) => match result {
                Ok(_) => {
                    if let Some(adaptive_signal) = adaptive_signal {
                        self.update_lesson_adaptive_progress(
                            &adaptive_signal.lesson_id,
                            adaptive_signal.topic,
                            adaptive_signal.should_record_diagnostic,
                        )
                        .await?;
                    }
                    Ok(())
                }
                Err(err)
                    if cancellation.is_cancelled()
                        && err.to_string().contains("stream cancelled") =>
                {
                    Ok(())
                }
                Err(err) => Err(err),
            },
            Err(join_err) if join_err.is_cancelled() => Ok(()),
            Err(join_err) => Err(anyhow!("stateless chat graph task failed: {}", join_err)),
        }
    }

    async fn get_job(&self, id: &str) -> Result<Option<LessonGenerationJob>> {
        self.storage.get_job(id).await.map_err(|err| anyhow!(err))
    }

    async fn get_lesson(&self, id: &str) -> Result<Option<Lesson>> {
        self.storage
            .get_lesson(id)
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn get_audio_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>> {
        let lesson_id = sanitize_path_segment(lesson_id)
            .ok_or_else(|| anyhow!("invalid lesson id for audio asset"))?;
        let file_name = sanitize_path_segment(file_name)
            .ok_or_else(|| anyhow!("invalid file name for audio asset"))?;
        let path = self
            .storage
            .assets_dir()
            .join("audio")
            .join(lesson_id)
            .join(file_name);

        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    async fn get_media_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>> {
        let lesson_id = sanitize_path_segment(lesson_id)
            .ok_or_else(|| anyhow!("invalid lesson id for media asset"))?;
        let file_name = sanitize_path_segment(file_name)
            .ok_or_else(|| anyhow!("invalid file name for media asset"))?;
        let path = self
            .storage
            .assets_dir()
            .join("media")
            .join(lesson_id)
            .join(file_name);

        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    async fn acknowledge_runtime_action(
        &self,
        payload: RuntimeActionAckRequest,
    ) -> Result<RuntimeActionAckResponse> {
        let runtime_session_id = payload
            .runtime_session_id
            .clone()
            .unwrap_or_else(|| payload.session_id.clone());
        self.expire_runtime_action_timeouts(&runtime_session_id)
            .await?;
        let now = chrono::Utc::now().timestamp_millis();
        let ack_status = parse_runtime_action_execution_status(&payload.status)
            .ok_or_else(|| anyhow!("unsupported runtime action ack status: {}", payload.status))?;
        let Some(mut record) = self
            .storage
            .get_runtime_action_execution(&payload.execution_id)
            .await
            .map_err(|err| anyhow!(err))?
        else {
            anyhow::bail!(
                "runtime action execution not found for acknowledgement: {}",
                payload.execution_id
            );
        };
        if record.session_id != runtime_session_id {
            anyhow::bail!(
                "runtime action acknowledgement session mismatch for execution {}",
                payload.execution_id
            );
        }

        let duplicate = !can_transition_runtime_action_status(&record.status, &ack_status);
        if !duplicate {
            record.status = ack_status.clone();
            record.updated_at_unix_ms = now;
            record.last_error = payload.error.clone();
            self.storage
                .save_runtime_action_execution(&record)
                .await
                .map_err(|err| anyhow!(err))?;
        }

        info!(
            transport_session_id = %payload.session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = payload.runtime_session_mode.as_deref().unwrap_or("unknown"),
            execution_id = %payload.execution_id,
            action_name = payload.action_name.as_deref().unwrap_or("unknown"),
            ack_status = %payload.status,
            duplicate,
            ack_error = payload.error.as_deref().unwrap_or(""),
            "Received runtime action acknowledgement"
        );
        Ok(RuntimeActionAckResponse {
            accepted: !duplicate,
            duplicate,
            current_status: runtime_action_execution_status_label(if duplicate {
                &record.status
            } else {
                &ack_status
            })
            .to_string(),
        })
    }

    async fn runtime_pbl_chat(
        &self,
        payload: PblRuntimeChatRequest,
    ) -> Result<PblRuntimeChatResponse> {
        let session_id = payload
            .session_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let workspace = if let Some(session_id) = session_id.as_deref() {
            self.load_pbl_workspace_state(session_id)
                .await?
                .unwrap_or_else(|| payload.workspace.clone())
        } else {
            payload.workspace.clone()
        };

        let model_string = std::env::var("BALANCED_MODE_AI_TUTOR_PBL_RUNTIME_MODEL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("BALANCED_MODE_AI_TUTOR_PBL_RUNTIME_MODEL is required"))?;

        let resolved = resolve_model(
            &self.provider_config,
            Some(&model_string),
            None,
            None,
            None,
            Some(false),
        )?;
        let llm = self.provider_factory.build(resolved.model_config)?;

        let resolved_agent = resolve_pbl_runtime_agent(&payload.message, &payload.project_config, &workspace);
        let system_prompt = build_pbl_runtime_system_prompt(
            &payload.project_config,
            &workspace,
            &payload.recent_messages,
            &payload.user_role,
            &resolved_agent,
        );
        let clean_message = clean_pbl_runtime_message(&payload.message);
        let generated = llm.generate_text(&system_prompt, &clean_message).await?;

        let mut messages = vec![PblRuntimeChatMessage {
            kind: "agent".to_string(),
            agent_name: resolved_agent.name.clone(),
            message: generated.clone(),
        }];

        let mut final_workspace = workspace.clone();
        if resolved_agent.kind == PblRuntimeAgentKind::Judge
            && judge_marks_issue_complete(&generated)
        {
            if let Some(progressed) = progress_pbl_workspace(&workspace) {
                if let Some(completed_title) = workspace
                    .issues
                    .iter()
                    .find(|issue| Some(&issue.id) == workspace.active_issue_id.as_ref())
                    .map(|issue| issue.title.clone())
                {
                    if let Some(next_issue) = progressed
                        .issues
                        .iter()
                        .find(|issue| Some(&issue.id) == progressed.active_issue_id.as_ref())
                    {
                        messages.push(PblRuntimeChatMessage {
                            kind: "system".to_string(),
                            agent_name: "System".to_string(),
                            message: format!(
                                "Issue complete: {}. Next issue activated: {}.",
                                completed_title, next_issue.title
                            ),
                        });
                        messages.push(PblRuntimeChatMessage {
                            kind: "agent".to_string(),
                            agent_name: "Question Agent".to_string(),
                            message: build_next_issue_question_prompt(next_issue),
                        });
                    } else {
                        messages.push(PblRuntimeChatMessage {
                            kind: "system".to_string(),
                            agent_name: "System".to_string(),
                            message: format!(
                                "Issue complete: {}. All project issues are now complete.",
                                completed_title
                            ),
                        });
                    }
                }
                final_workspace = progressed;
            }
        }

        if let Some(session_id) = session_id.as_deref() {
            self.save_pbl_workspace_state(session_id, &final_workspace)
                .await?;
        }

        Ok(PblRuntimeChatResponse {
            messages,
            workspace: Some(final_workspace),
            resolved_agent: resolved_agent.name,
        })
    }

    async fn redeem_promo_code(
        &self,
        account_id: &str,
        code: &str,
    ) -> Result<RedeemPromoCodeResponse> {
        // Get the promo code
        let promo = self
            .storage
            .get_promo_code(code)
            .await
            .map_err(|err| anyhow!("Failed to load promo code: {}", err))?
            .ok_or_else(|| anyhow!("Promo code not found"))?;

        // Check if code is valid for this account (checks expiry, max redemptions, and one-per-account)
        if !promo.is_valid_for_account(account_id) {
            // Determine the failure reason
            let message = if let Some(expiry) = promo.expires_at {
                if chrono::Utc::now() > expiry {
                    "This promo code has expired.".to_string()
                } else if let Some(max) = promo.max_redemptions {
                    if promo.redeemed_by_accounts.len() >= max {
                        "This promo code is no longer available.".to_string()
                    } else if promo.redeemed_by_accounts.contains(&account_id.to_string()) {
                        "You have already redeemed this promo code.".to_string()
                    } else {
                        "Invalid promo code.".to_string()
                    }
                } else {
                    "Invalid promo code.".to_string()
                }
            } else if let Some(max) = promo.max_redemptions {
                if promo.redeemed_by_accounts.len() >= max {
                    "This promo code is no longer available.".to_string()
                } else if promo.redeemed_by_accounts.contains(&account_id.to_string()) {
                    "You have already redeemed this promo code.".to_string()
                } else {
                    "Invalid promo code.".to_string()
                }
            } else {
                "Invalid promo code.".to_string()
            };

            return Ok(RedeemPromoCodeResponse {
                success: false,
                message,
                credits_granted: 0.0,
            });
        }

        // Add credit entry to ledger
        let credit_entry = CreditLedgerEntry {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: account_id.to_string(),
            kind: CreditEntryKind::Grant,
            amount: promo.grant_credits,
            reason: format!("Promo code redeemed: {}", code),
            created_at: chrono::Utc::now(),
        };

        self
            .storage
            .apply_credit_entry(&credit_entry)
            .await
            .map_err(|err| anyhow!("Failed to apply credit entry: {}", err))?;

        // Update promo code redemption tracking
        self
            .storage
            .update_promo_code_redemption(code, account_id)
            .await
            .map_err(|err| anyhow!("Failed to update promo code: {}", err))?;

        Ok(RedeemPromoCodeResponse {
            success: true,
            message: format!("Successfully redeemed! You received {} credits.", promo.grant_credits),
            credits_granted: promo.grant_credits,
        })
    }

    async fn get_system_status(&self) -> Result<SystemStatusResponse> {
        self.system_status().await
    }
}

impl LiveLessonAppService {
    fn pbl_workspace_sessions_dir(&self) -> PathBuf {
        self.storage
            .root_dir()
            .join("runtime")
            .join("pbl-workspaces")
    }

    fn pbl_workspace_session_path(&self, session_id: &str) -> PathBuf {
        let stable_key = stable_path_key(session_id);
        self.pbl_workspace_sessions_dir()
            .join(format!("{stable_key}.json"))
    }

    async fn load_pbl_workspace_state(
        &self,
        session_id: &str,
    ) -> Result<Option<PblRuntimeWorkspaceState>> {
        let path = self.pbl_workspace_session_path(session_id);
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        let workspace = serde_json::from_slice::<PblRuntimeWorkspaceState>(&bytes)?;
        Ok(Some(workspace))
    }

    async fn save_pbl_workspace_state(
        &self,
        session_id: &str,
        workspace: &PblRuntimeWorkspaceState,
    ) -> Result<()> {
        let dir = self.pbl_workspace_sessions_dir();
        tokio::fs::create_dir_all(&dir).await?;

        let path = self.pbl_workspace_session_path(session_id);
        let temp_path = path.with_extension("json.tmp");
        let payload = serde_json::to_vec_pretty(workspace)?;

        tokio::fs::write(&temp_path, payload).await?;
        tokio::fs::rename(&temp_path, &path).await?;
        Ok(())
    }

    async fn record_runtime_action_expectation(&self, event: &TutorStreamEvent) -> Result<()> {
        let Some(ack_policy) = event.ack_policy.as_ref() else {
            return Ok(());
        };
        if !matches!(ack_policy, ActionAckPolicy::AckRequired) {
            return Ok(());
        }
        let Some(execution_id) = event.execution_id.as_ref() else {
            return Ok(());
        };
        let Some(action_name) = event.action_name.as_ref() else {
            return Ok(());
        };

        let now = chrono::Utc::now().timestamp_millis();
        let record = self
            .storage
            .get_runtime_action_execution(execution_id)
            .await
            .map_err(|err| anyhow!(err))?;
        if record.is_some() {
            return Ok(());
        }

        self.storage
            .save_runtime_action_execution(&RuntimeActionExecutionRecord {
                session_id: event
                    .runtime_session_id
                    .clone()
                    .unwrap_or_else(|| event.session_id.clone()),
                runtime_session_mode: event
                    .runtime_session_mode
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                execution_id: execution_id.clone(),
                action_name: action_name.clone(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: now,
                updated_at_unix_ms: now,
                timeout_at_unix_ms: now + runtime_action_ack_timeout_ms() as i64,
                last_error: None,
            })
            .await
            .map_err(|err| anyhow!(err))?;

        Ok(())
    }

    async fn ensure_runtime_action_resume_ready(&self, runtime_session_id: &str) -> Result<()> {
        let records = self
            .storage
            .list_runtime_action_executions_for_session(runtime_session_id)
            .await
            .map_err(|err| anyhow!(err))?;
        let unresolved = records
            .into_iter()
            .filter(|record| {
                matches!(
                    record.status,
                    RuntimeActionExecutionStatus::Pending | RuntimeActionExecutionStatus::Accepted
                )
            })
            .map(|record| format!("{} ({})", record.action_name, record.execution_id))
            .collect::<Vec<_>>();

        if unresolved.is_empty() {
            return Ok(());
        }

        anyhow::bail!(
            "managed runtime session has unresolved action executions and cannot resume yet: {}",
            unresolved.join(", ")
        )
    }

    async fn expire_runtime_action_timeouts(&self, session_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let records = self
            .storage
            .list_runtime_action_executions_for_session(session_id)
            .await
            .map_err(|err| anyhow!(err))?;

        for mut record in records {
            if matches!(
                record.status,
                RuntimeActionExecutionStatus::Pending | RuntimeActionExecutionStatus::Accepted
            ) && record.timeout_at_unix_ms <= now
            {
                record.status = RuntimeActionExecutionStatus::TimedOut;
                record.updated_at_unix_ms = now;
                if record.last_error.is_none() {
                    record.last_error =
                        Some("runtime action acknowledgement timed out".to_string());
                }
                self.storage
                    .save_runtime_action_execution(&record)
                    .await
                    .map_err(|err| anyhow!(err))?;
            }
        }

        Ok(())
    }

    async fn run_stateless_chat_graph(
        &self,
        mut payload: StatelessChatRequest,
        session_id: &str,
        event_sender: Option<tokio::sync::mpsc::UnboundedSender<chat_graph::ChatGraphEvent>>,
        cancellation_token: Option<CancellationToken>,
    ) -> Result<Vec<chat_graph::ChatGraphEvent>> {
        let runtime_session_mode =
            validate_runtime_session_mode(&payload).map_err(|err| anyhow!(err))?;
        let runtime_session_mode_label = runtime_session_mode_label(&runtime_session_mode);
        let runtime_session_id = coordination_session_id(&runtime_session_mode, session_id);

        match &runtime_session_mode {
            ResolvedRuntimeSessionMode::StatelessClientState => {
                if payload.director_state.is_none() {
                    payload.director_state = Some(empty_director_state());
                }
            }
            ResolvedRuntimeSessionMode::ManagedRuntimeSession {
                persistence_session_id,
                create_if_missing,
            } => {
                let loaded = self
                    .storage
                    .get_runtime_session(persistence_session_id)
                    .await
                    .map_err(|err| anyhow!(err))?;
                payload.director_state = Some(match loaded {
                    Some(state) => state,
                    None if *create_if_missing => empty_director_state(),
                    None => {
                        anyhow::bail!(
                            "managed runtime session not found: {}",
                            persistence_session_id
                        )
                    }
                });
                self.expire_runtime_action_timeouts(&runtime_session_id)
                    .await?;
                self.ensure_runtime_action_resume_ready(&runtime_session_id)
                    .await?;
            }
        }
        payload.session_id = Some(session_id.to_string());

        let chat_route = resolve_chat_pedagogy_route(&payload, None)?;
        let model_string = chat_route.model.clone();

        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            pedagogy_tier = chat_route.tier.as_str(),
            pedagogy_confidence = chat_route.confidence,
            pedagogy_reason = %chat_route.reason,
            "Starting stateless tutor graph"
        );

        let resolved = resolve_model(
            &self.provider_config,
            Some(&model_string),
            Some(payload.api_key.as_str()),
            payload.base_url.as_deref(),
            payload
                .provider_type
                .as_deref()
                .and_then(parse_provider_type),
            payload.requires_api_key,
        )?;
        let llm: Arc<dyn ai_tutor_providers::traits::LlmProvider> =
            Arc::from(self.provider_factory.build(resolved.model_config)?);

        let events = match event_sender {
            Some(sender) => {
                chat_graph::run_chat_graph_stream(
                    payload,
                    llm,
                    session_id.to_string(),
                    sender,
                    cancellation_token,
                )
                .await
            }
            None => chat_graph::run_chat_graph(payload, llm, session_id.to_string()).await,
        }?;

        if let ResolvedRuntimeSessionMode::ManagedRuntimeSession {
            persistence_session_id,
            ..
        } = &runtime_session_mode
        {
            if let Some(final_state) = events
                .iter()
                .rev()
                .find_map(|event| event.director_state.clone())
            {
                self.storage
                    .save_runtime_session(persistence_session_id, &final_state)
                    .await
                    .map_err(|err| anyhow!(err))?;
            }
        }

        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            event_count = events.len(),
            "Completed stateless tutor graph"
        );

        Ok(events)
    }
}

fn empty_director_state() -> DirectorState {
    DirectorState {
        turn_count: 0,
        agent_responses: vec![],
        whiteboard_ledger: vec![],
        whiteboard_state: None,
    }
}

fn coordination_session_id(
    mode: &ResolvedRuntimeSessionMode,
    transport_session_id: &str,
) -> String {
    match mode {
        ResolvedRuntimeSessionMode::StatelessClientState => transport_session_id.to_string(),
        ResolvedRuntimeSessionMode::ManagedRuntimeSession {
            persistence_session_id,
            ..
        } => persistence_session_id.clone(),
    }
}

fn runtime_session_mode_label(mode: &ResolvedRuntimeSessionMode) -> &'static str {
    match mode {
        ResolvedRuntimeSessionMode::StatelessClientState => "stateless_client_state",
        ResolvedRuntimeSessionMode::ManagedRuntimeSession { .. } => "managed_runtime_session",
    }
}

fn validate_runtime_session_mode(
    payload: &StatelessChatRequest,
) -> std::result::Result<ResolvedRuntimeSessionMode, String> {
    let selector = payload.runtime_session.as_ref().ok_or_else(|| {
        "missing required runtime_session contract; choose stateless_client_state or managed_runtime_session".to_string()
    })?;

    match selector.mode {
        RuntimeSessionMode::StatelessClientState => {
            if selector.session_id.is_some() || selector.create_if_missing.is_some() {
                return Err(
                    "stateless_client_state does not accept runtime_session.session_id or create_if_missing"
                        .to_string(),
                );
            }
            Ok(ResolvedRuntimeSessionMode::StatelessClientState)
        }
        RuntimeSessionMode::ManagedRuntimeSession => {
            if payload.director_state.is_some() {
                return Err(
                    "managed_runtime_session cannot be combined with client-supplied director_state"
                        .to_string(),
                );
            }
            let persistence_session_id = selector
                .session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    "managed_runtime_session requires runtime_session.session_id".to_string()
                })?
                .to_string();
            Ok(ResolvedRuntimeSessionMode::ManagedRuntimeSession {
                persistence_session_id,
                create_if_missing: selector.create_if_missing.unwrap_or(false),
            })
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PblRuntimeAgentKind {
    Role,
    Question,
    Judge,
}

#[derive(Debug, Clone)]
struct ResolvedPblRuntimeAgent {
    kind: PblRuntimeAgentKind,
    name: String,
    system_prompt: String,
}

fn resolve_pbl_runtime_agent(
    raw_message: &str,
    project_config: &ProjectConfig,
    workspace: &PblRuntimeWorkspaceState,
) -> ResolvedPblRuntimeAgent {
    let current_issue = workspace
        .active_issue_id
        .as_ref()
        .and_then(|active| workspace.issues.iter().find(|issue| &issue.id == active));
    let lowered_message = raw_message.trim().to_ascii_lowercase();

    if let Some(mention) = lowered_message.strip_prefix('@') {
        let mention = mention
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        if mention == "question" {
            return build_question_agent(project_config, current_issue);
        }
        if mention == "judge" {
            return build_judge_agent(project_config, current_issue);
        }

        if let Some(role) = project_config.agent_roles.as_ref().and_then(|roles| {
            roles.iter().find(|role| {
                role.name
                    .to_ascii_lowercase()
                    .replace(' ', "")
                    .contains(&mention)
            })
        }) {
            return build_role_agent(role);
        }
    }

    if current_issue.is_some() {
        build_question_agent(project_config, current_issue)
    } else if let Some(role) = project_config
        .agent_roles
        .as_ref()
        .and_then(|roles| roles.first())
    {
        build_role_agent(role)
    } else {
        ResolvedPblRuntimeAgent {
            kind: PblRuntimeAgentKind::Question,
            name: "Question Agent".to_string(),
            system_prompt: "You are a project question agent. Ask focused, actionable coaching questions that help the learner progress.".to_string(),
        }
    }
}

fn build_role_agent(role: &ProjectAgentRole) -> ResolvedPblRuntimeAgent {
    ResolvedPblRuntimeAgent {
        kind: PblRuntimeAgentKind::Role,
        name: role.name.clone(),
        system_prompt: format!(
            "You are the project role '{}'. Responsibility: {}. Deliverable: {}. Respond as a collaborative teammate helping the student move the project forward with concrete, grounded guidance.",
            role.name,
            role.responsibility,
            role.deliverable.as_deref().unwrap_or("Not specified")
        ),
    }
}

fn build_question_agent(
    project_config: &ProjectConfig,
    current_issue: Option<&PblRuntimeIssueState>,
) -> ResolvedPblRuntimeAgent {
    let project_title = project_config.title.as_deref().unwrap_or("the project");
    let issue = current_issue
        .map(|issue| format!("Current issue: {}. {}", issue.title, issue.description))
        .unwrap_or_else(|| "No active issue is currently selected.".to_string());
    ResolvedPblRuntimeAgent {
        kind: PblRuntimeAgentKind::Question,
        name: "Question Agent".to_string(),
        system_prompt: format!(
            "You are the project question agent for {}. {} Ask 1-3 sharp coaching questions or give a short actionable hint that helps the learner think through the next step. Be concise, supportive, and concrete.",
            project_title, issue
        ),
    }
}

fn build_judge_agent(
    project_config: &ProjectConfig,
    current_issue: Option<&PblRuntimeIssueState>,
) -> ResolvedPblRuntimeAgent {
    let issue = current_issue
        .map(|issue| format!("Current issue: {}. {}", issue.title, issue.description))
        .unwrap_or_else(|| "No active issue is currently selected.".to_string());
    let success = project_config
        .success_criteria
        .as_ref()
        .map(|criteria| criteria.join("; "))
        .filter(|joined| !joined.is_empty())
        .unwrap_or_else(|| {
            "Use the issue checkpoints and deliverable quality as the standard.".to_string()
        });
    ResolvedPblRuntimeAgent {
        kind: PblRuntimeAgentKind::Judge,
        name: "Judge Agent".to_string(),
        system_prompt: format!(
            "You are the project judge agent. {} Success criteria: {} Evaluate whether the learner's latest update is sufficient to mark the current issue complete. If it is sufficient, include the exact token COMPLETE in your response. If it is not sufficient, include the exact token NEEDS_REVISION and explain what is still missing.",
            issue, success
        ),
    }
}

fn build_pbl_runtime_system_prompt(
    project_config: &ProjectConfig,
    workspace: &PblRuntimeWorkspaceState,
    recent_messages: &[PblRuntimeChatMessage],
    user_role: &str,
    agent: &ResolvedPblRuntimeAgent,
) -> String {
    let project_title = project_config
        .title
        .as_deref()
        .unwrap_or("Untitled project");
    let project_summary = project_config.summary.as_str();
    let current_issue = workspace
        .active_issue_id
        .as_ref()
        .and_then(|active| workspace.issues.iter().find(|issue| &issue.id == active));
    let issue_context = current_issue
        .map(|issue| {
            format!(
                "Current issue:\n- Title: {}\n- Description: {}\n- Owner role: {}\n- Checkpoints: {}\n- Completed checkpoints: {}",
                issue.title,
                issue.description,
                issue.owner_role.as_deref().unwrap_or("Unassigned"),
                if issue.checkpoints.is_empty() {
                    "None".to_string()
                } else {
                    issue.checkpoints.join(" | ")
                },
                if issue.completed_checkpoint_ids.is_empty() {
                    "None".to_string()
                } else {
                    issue.completed_checkpoint_ids.join(" | ")
                }
            )
        })
        .unwrap_or_else(|| "No active issue.".to_string());
    let recent_context = if recent_messages.is_empty() {
        "No recent project chat.".to_string()
    } else {
        recent_messages
            .iter()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|message| {
                format!(
                    "{} [{}]: {}",
                    message.agent_name, message.kind, message.message
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "{}\n\nProject title: {}\nProject summary: {}\nLearner role: {}\n{}\n\nRecent conversation:\n{}\n\nStay grounded in the project structure and do not invent new project roles or issues unless the student explicitly asks for revision planning.",
        agent.system_prompt, project_title, project_summary, user_role, issue_context, recent_context
    )
}

fn default_pbl_chat_message_kind() -> String {
    "agent".to_string()
}

fn clean_pbl_runtime_message(raw_message: &str) -> String {
    if let Some(rest) = raw_message.trim().strip_prefix('@') {
        let without_mention = rest
            .split_once(char::is_whitespace)
            .map(|(_, right)| right)
            .unwrap_or("");
        let trimmed = without_mention.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    raw_message.trim().to_string()
}

fn judge_marks_issue_complete(response: &str) -> bool {
    let upper = response.to_ascii_uppercase();
    upper.contains("COMPLETE") && !upper.contains("NEEDS_REVISION")
}

fn progress_pbl_workspace(
    workspace: &PblRuntimeWorkspaceState,
) -> Option<PblRuntimeWorkspaceState> {
    let active_issue_id = workspace.active_issue_id.as_ref()?;
    let active_index = workspace
        .issues
        .iter()
        .position(|issue| &issue.id == active_issue_id)?;
    let mut issues = workspace.issues.clone();
    if let Some(active_issue) = issues.get_mut(active_index) {
        active_issue.done = true;
        active_issue.completed_checkpoint_ids = active_issue
            .checkpoints
            .iter()
            .enumerate()
            .map(|(index, _)| format!("{}-checkpoint-{}", active_issue.id, index))
            .collect();
    }
    let next_active_issue_id = issues
        .iter()
        .find(|issue| !issue.done)
        .map(|issue| issue.id.clone());
    Some(PblRuntimeWorkspaceState {
        active_issue_id: next_active_issue_id,
        issues,
    })
}

fn build_next_issue_question_prompt(issue: &PblRuntimeIssueState) -> String {
    if issue.checkpoints.is_empty() {
        return format!(
            "Let's move to '{}'. Start by identifying the first concrete action you should take and the evidence you need.",
            issue.title
        );
    }

    format!(
        "New active issue: {}. Focus on these checkpoints next: {}.",
        issue.title,
        issue.checkpoints.join(" | ")
    )
}

#[derive(Debug, Clone)]
struct AdaptiveLessonSignal {
    lesson_id: String,
    topic: Option<String>,
    should_record_diagnostic: bool,
}

fn adaptive_signal_from_stateless_payload(payload: &StatelessChatRequest) -> Option<AdaptiveLessonSignal> {
    let stage = payload.store_state.stage.as_ref()?;
    let lesson_id = stage.id.strip_prefix("stage-")?.trim();
    if lesson_id.is_empty() {
        return None;
    }

    let should_record_diagnostic = payload
        .config
        .session_type
        .as_deref()
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            value == "qa" || value == "discussion"
        })
        .unwrap_or(false);

    Some(AdaptiveLessonSignal {
        lesson_id: lesson_id.to_string(),
        topic: stage.description.clone(),
        should_record_diagnostic,
    })
}

pub fn build_router(service: Arc<dyn LessonAppService>) -> Router {
    build_router_with_auth(service, ApiAuthConfig::from_env())
}

fn build_router_with_auth(service: Arc<dyn LessonAppService>, auth: ApiAuthConfig) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/health", get(health))
        .route("/api/tools/web-search", post(crate::tools::web_search))
        .route("/api/tools/parse-pdf", post(crate::tools::parse_pdf))
        .route("/api/auth/google/login", get(google_login))
        .route("/api/auth/google/callback", get(google_callback))
        .route("/api/auth/bind-phone", post(bind_phone))
        .route("/api/operator/auth/request-otp", post(request_operator_otp))
        .route("/api/operator/auth/verify-otp", post(verify_operator_otp))
        .route("/api/operator/auth/logout", post(logout_operator_otp))
        .route("/api/billing/catalog", get(get_billing_catalog))
        .route("/api/billing/checkout", post(create_checkout))
        .route("/api/billing/orders", get(list_payment_orders))
        .route("/api/billing/dashboard", get(get_billing_dashboard))
        .route("/api/billing/report", get(get_billing_report))
        .route(
            "/api/billing/easebuzz/callback",
            post(easebuzz_callback).get(easebuzz_callback_get),
        )
        .route("/api/credits/me", get(get_credit_balance))
        .route("/api/credits/ledger", get(get_credit_ledger))
        .route("/api/credits/redeem", post(redeem_promo_code))
        .route("/api/admin/overview", get(get_admin_overview))
        .route("/api/admin/stats/users", get(get_admin_user_stats))
        .route("/api/admin/stats/subscriptions", get(get_admin_subscription_stats))
        .route("/api/admin/stats/payments", get(get_admin_payment_stats))
        .route("/api/admin/stats/promo-codes", get(get_admin_promo_code_stats))
        .route("/api/admin/users", get(get_admin_users))
        .route("/api/admin/settings", get(get_admin_settings))
        .route("/api/admin/jobs", get(get_admin_jobs))
        .route("/api/admin/audit-logs", get(get_admin_audit_logs))
        .route("/api/admin/system/toggle-maintenance", post(toggle_maintenance))
            .route("/api/subscriptions/create", post(create_subscription))
            .route("/api/subscriptions/me", get(get_subscription))
            .route("/api/subscriptions/{id}/cancel", post(cancel_subscription))
        .route("/api/system/status", get(get_system_status))
        .route("/api/system/ops-gate", get(get_ops_gate))
        .route("/api/lessons/generate", post(generate_lesson))
        .route("/api/lessons/generate-async", post(generate_lesson_async))
        .route("/api/lesson-shelf", get(list_lesson_shelf))
        .route("/api/lesson-shelf/{id}", patch(patch_lesson_shelf_item))
        .route("/api/lesson-shelf/{id}/archive", post(archive_lesson_shelf_item))
        .route("/api/lesson-shelf/{id}/reopen", post(reopen_lesson_shelf_item))
        .route("/api/lesson-shelf/{id}/retry", post(retry_lesson_shelf_item))
        .route("/api/lesson-shelf/mark-opened", post(mark_lesson_shelf_opened))
        .route("/api/lessons/jobs/{id}/cancel", post(cancel_job))
        .route("/api/lessons/jobs/{id}/resume", post(resume_job))
        .route("/api/runtime/actions/ack", post(acknowledge_runtime_action))
        .route("/api/runtime/pbl/chat", post(runtime_pbl_chat))
        .route("/api/runtime/chat/stream", post(stream_stateless_chat))
        .route("/api/lessons/jobs/{id}", get(get_job))
        .route("/api/lessons/{id}", get(get_lesson))
        .route("/api/lessons/{id}/export/html", get(export_lesson_html))
        .route("/api/lessons/{id}/export/video", get(export_lesson_video))
        .route("/api/lessons/{id}/events", get(stream_lesson_events))
        .route(
            "/api/assets/media/{lesson_id}/{file_name}",
            get(get_media_asset),
        )
        .route(
            "/api/assets/audio/{lesson_id}/{file_name}",
            get(get_audio_asset),
        )
        .layer(build_cors_layer())
        .layer(middleware::from_fn_with_state(auth, auth_middleware))
        .with_state(AppState { service })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn get_system_status(
    State(state): State<AppState>,
) -> Result<Json<SystemStatusResponse>, ApiError> {
    state
        .service
        .get_system_status()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_ops_gate(State(state): State<AppState>) -> Result<Json<OpsGateResponse>, ApiError> {
    let status = state
        .service
        .get_system_status()
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(derive_ops_gate(&status)))
}

async fn google_login(
    State(state): State<AppState>,
) -> Result<Json<GoogleAuthLoginResponse>, ApiError> {
    state
        .service
        .google_login()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn google_callback(
    State(state): State<AppState>,
    Query(query): Query<GoogleAuthCallbackQuery>,
) -> Result<Response, ApiError> {
    let response = state
        .service
        .google_callback(query)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "google oauth callback failed");
            ApiError::internal(e)
        })?;
    Ok(auth_response_to_http(response))
}

async fn bind_phone(
    State(state): State<AppState>,
    Json(payload): Json<BindPhoneRequest>,
) -> Result<Response, ApiError> {
    let response = state
        .service
        .bind_phone(payload)
        .await
        .map_err(ApiError::internal)?;
    Ok(auth_response_to_http(response))
}

async fn request_operator_otp(
    Json(payload): Json<OperatorOtpRequest>,
) -> Result<Json<OperatorOtpResponse>, ApiError> {
    ensure_operator_otp_enabled()?;
    let email = normalize_operator_email(&payload.email)?;
    if !operator_email_allowed(&email) {
        warn!(
            event = "operator_risk_signal",
            signal = "disallowed_operator_email",
            email = %email,
            "operator otp request rejected for disallowed email"
        );
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "email is not allowed for operator access".to_string(),
        });
    }
    enforce_otp_request_rate_limit(&email).await?;

    let otp_code = generate_numeric_otp(6);
    let challenge = OperatorOtpChallenge {
        otp_hash: hash_operator_otp(&email, &otp_code),
        expires_at_unix: chrono::Utc::now().timestamp() + operator_otp_ttl_seconds(),
        attempts_remaining: operator_otp_max_attempts(),
    };
    save_operator_otp_challenge(&email, &challenge).await?;

    let service = notification_service_from_env(
        read_optional_env("AI_TUTOR_BASE_URL").unwrap_or_else(|| "http://127.0.0.1:8099".to_string()),
    );
    let name = operator_name_from_email(&email);
    service
        .send_operator_otp(OperatorOtpNotification {
            operator_email: email.clone(),
            operator_name: name,
            otp_code,
            expires_in_minutes: (operator_otp_ttl_seconds() / 60).max(1),
        })
        .await
        .map_err(ApiError::internal)?;

    info!(
        event = "operator_audit_auth",
        action = "otp_requested",
        email = %email,
        "operator otp challenge issued"
    );

    Ok(Json(OperatorOtpResponse {
        ok: true,
        message: "OTP sent".to_string(),
    }))
}

async fn verify_operator_otp(
    Json(payload): Json<OperatorOtpVerifyRequest>,
) -> Result<Response, ApiError> {
    ensure_operator_otp_enabled()?;
    let email = normalize_operator_email(&payload.email)?;
    if !operator_email_allowed(&email) {
        warn!(
            event = "operator_risk_signal",
            signal = "disallowed_operator_email",
            email = %email,
            "operator otp verify rejected for disallowed email"
        );
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "email is not allowed for operator access".to_string(),
        });
    }
    let code = payload.otp_code.trim();
    if code.len() != 6 || !code.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(ApiError::bad_request(
            "otp code must be a 6-digit number".to_string(),
        ));
    }

    let mut challenge = load_operator_otp_challenge(&email)
        .await?
        .ok_or_else(|| ApiError::unauthorized("otp challenge expired or missing"))?;

    if chrono::Utc::now().timestamp() > challenge.expires_at_unix {
        delete_operator_otp_challenge(&email).await?;
        warn!(
            event = "operator_risk_signal",
            signal = "otp_challenge_expired",
            email = %email,
            "operator otp challenge expired before verification"
        );
        return Err(ApiError::unauthorized("otp challenge expired"));
    }

    let provided_hash = hash_operator_otp(&email, code);
    if provided_hash != challenge.otp_hash {
        challenge.attempts_remaining -= 1;
        let failure_count = record_operator_verify_failure(&email).await?;
        warn!(
            event = "operator_risk_signal",
            signal = "otp_verify_failed",
            email = %email,
            failure_count,
            attempts_remaining = challenge.attempts_remaining,
            "operator otp verification failed"
        );
        if challenge.attempts_remaining <= 0 {
            delete_operator_otp_challenge(&email).await?;
            let lockout_count = record_operator_lockout(&email).await?;
            warn!(
                event = "operator_risk_signal",
                signal = "otp_attempts_exhausted",
                email = %email,
                lockout_count,
                "operator otp attempts exhausted"
            );
            return Err(ApiError {
                status: StatusCode::FORBIDDEN,
                message: "otp attempts exhausted".to_string(),
            });
        }
        save_operator_otp_challenge(&email, &challenge).await?;
        return Err(ApiError::unauthorized("invalid otp code"));
    }

    delete_operator_otp_challenge(&email).await?;

    let role = resolve_operator_role_for_email(&email);
    if role != "admin" {
        warn!(
            event = "operator_risk_signal",
            signal = "operator_role_not_admin",
            email = %email,
            resolved_role = %role,
            "operator otp verification blocked because role is not admin"
        );
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "operator email is not mapped to an admin role".to_string(),
        });
    }

    let session_id = Uuid::new_v4().to_string();
    let session = OperatorSessionState {
        operator_email: email,
        role: role.to_string(),
        created_at_unix: chrono::Utc::now().timestamp(),
    };
    save_operator_session(&session_id, &session).await?;

    let body = serde_json::to_vec(&OperatorOtpResponse {
        ok: true,
        message: "operator session created".to_string(),
    })
    .unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.clone()))
        .unwrap_or_else(|_| Response::new(Body::from(body)));

    let cookie = build_cookie(
        operator_session_cookie_name(),
        &session_id,
        operator_session_ttl_seconds(),
    );
    response
        .headers_mut()
        .append(header::SET_COOKIE, cookie.parse().unwrap());

    info!(
        event = "operator_audit_auth",
        action = "session_created",
        email = %session.operator_email,
        role = %session.role,
        "operator session created after otp verification"
    );

    Ok(response)
}

async fn logout_operator_otp(headers: axum::http::HeaderMap) -> Result<Response, ApiError> {
    let mut session_was_present = false;
    if let Some(cookie) = headers.get(header::COOKIE).and_then(|value| value.to_str().ok()) {
        if let Some(session_id) = parse_cookie(cookie, &operator_session_cookie_name()) {
            session_was_present = true;
            let _ = delete_operator_session(&session_id).await;
        }
    }

    let body = serde_json::to_vec(&OperatorOtpResponse {
        ok: true,
        message: "logged out".to_string(),
    })
    .unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.clone()))
        .unwrap_or_else(|_| Response::new(Body::from(body)));

    let clear_cookie = build_cookie(operator_session_cookie_name(), "", 0);
    response
        .headers_mut()
        .append(header::SET_COOKIE, clear_cookie.parse().unwrap());

    info!(
        event = "operator_audit_auth",
        action = "session_logout",
        had_session = session_was_present,
        "operator session logout completed"
    );

    Ok(response)
}

async fn get_billing_catalog(
    State(state): State<AppState>,
) -> Result<Json<BillingCatalogResponse>, ApiError> {
    state
        .service
        .get_billing_catalog()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn create_checkout(
    State(state): State<AppState>,
    Extension(account): Extension<AuthenticatedAccountContext>,
    Json(payload): Json<CreateCheckoutRequest>,
) -> Result<Json<CheckoutSessionResponse>, ApiError> {
    state
        .service
        .create_checkout(&account.account_id, payload)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn list_payment_orders(
    State(state): State<AppState>,
    Extension(account): Extension<AuthenticatedAccountContext>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<PaymentOrderListResponse>, ApiError> {
    let limit = params
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(50);
    state
        .service
        .list_payment_orders(&account.account_id, limit)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_billing_report(
    State(state): State<AppState>,
) -> Result<Json<BillingReportResponse>, ApiError> {
    state
        .service
        .get_billing_report()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_billing_dashboard(
    State(state): State<AppState>,
    Extension(account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<BillingDashboardResponse>, ApiError> {
    state
        .service
        .get_billing_dashboard(&account.account_id)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn easebuzz_callback(
    State(state): State<AppState>,
    Form(form_fields): Form<HashMap<String, String>>,
) -> Result<Json<EasebuzzCallbackResponse>, ApiError> {
    state
        .service
        .handle_easebuzz_callback(form_fields)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn easebuzz_callback_get(
    State(state): State<AppState>,
    Query(form_fields): Query<HashMap<String, String>>,
) -> Result<Json<EasebuzzCallbackResponse>, ApiError> {
    state
        .service
        .handle_easebuzz_callback(form_fields)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_credit_balance(
    State(state): State<AppState>,
    Extension(account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<CreditBalanceResponse>, ApiError> {
    state
        .service
        .get_credit_balance(&account.account_id)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_credit_ledger(
    State(state): State<AppState>,
    Extension(account): Extension<AuthenticatedAccountContext>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<CreditLedgerResponse>, ApiError> {
    let limit = params
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(50);
    state
        .service
        .get_credit_ledger(&account.account_id, limit)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn redeem_promo_code(
    State(state): State<AppState>,
    Extension(account): Extension<AuthenticatedAccountContext>,
    Json(payload): Json<RedeemPromoCodeRequest>,
) -> Result<Json<RedeemPromoCodeResponse>, ApiError> {
    state
        .service
        .redeem_promo_code(&account.account_id, &payload.code)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_user_stats(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminUserStatsResponse>, ApiError> {
    state
        .service
        .get_admin_user_stats()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_overview(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminOverviewResponse>, ApiError> {
    let users = state
        .service
        .get_admin_user_stats()
        .await
        .map_err(ApiError::internal)?;
    let subscriptions = state
        .service
        .get_admin_subscription_stats()
        .await
        .map_err(ApiError::internal)?;
    let payments = state
        .service
        .get_admin_payment_stats()
        .await
        .map_err(ApiError::internal)?;
    let promo_codes = state
        .service
        .get_admin_promo_code_stats()
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(AdminOverviewResponse {
        users,
        subscriptions,
        payments,
        promo_codes,
    }))
}

async fn get_admin_subscription_stats(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminSubscriptionStatsResponse>, ApiError> {
    state
        .service
        .get_admin_subscription_stats()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_payment_stats(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminPaymentStatsResponse>, ApiError> {
    state
        .service
        .get_admin_payment_stats()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_promo_code_stats(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminPromoCodeStatsResponse>, ApiError> {
    state
        .service
        .get_admin_promo_code_stats()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_users(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminUsersListResponse>, ApiError> {
    state
        .service
        .get_admin_users()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_settings(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminSettingsResponse>, ApiError> {
    state
        .service
        .get_admin_settings()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_jobs(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminJobsListResponse>, ApiError> {
    state
        .service
        .get_admin_jobs()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_admin_audit_logs(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<AdminAuditLogsResponse>, ApiError> {
    state
        .service
        .get_admin_audit_logs()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn toggle_maintenance(
    State(state): State<AppState>,
    Extension(_account): Extension<AuthenticatedAccountContext>,
) -> Result<Json<ToggleMaintenanceResponse>, ApiError> {
    state
        .service
        .toggle_maintenance()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

    async fn create_subscription(
        State(state): State<AppState>,
        Extension(account): Extension<AuthenticatedAccountContext>,
        Json(payload): Json<CreateSubscriptionRequest>,
    ) -> Result<Json<SubscriptionResponse>, ApiError> {
        state
            .service
            .create_subscription(&account.account_id, payload)
            .await
            .map(Json)
            .map_err(ApiError::internal)
    }

    async fn get_subscription(
        State(state): State<AppState>,
        Extension(account): Extension<AuthenticatedAccountContext>,
    ) -> Result<Json<SubscriptionListResponse>, ApiError> {
        state
            .service
            .get_subscription(&account.account_id)
            .await
            .map(Json)
            .map_err(ApiError::internal)
    }

    async fn cancel_subscription(
        State(state): State<AppState>,
        Extension(account): Extension<AuthenticatedAccountContext>,
        Path(subscription_id): Path<String>,
        Json(payload): Json<CancelSubscriptionRequest>,
    ) -> Result<Json<CancelSubscriptionResponse>, ApiError> {
        state
            .service
            .cancel_subscription(&account.account_id, &subscription_id, payload)
            .await
            .map(Json)
            .map_err(ApiError::internal)
    }

async fn generate_lesson(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Json(payload): Json<GenerateLessonPayload>,
) -> Result<Json<GenerateLessonResponse>, ApiError> {
    // Check entitlements if account context is available
    if let Some(ctx) = &account {
        if let Err(err) = check_generation_entitlement(&state, &ctx.0).await {
            return Err(err);
        }
    }

    let payload = inject_account_id(payload, account.as_ref().map(|ctx| ctx.0.account_id.as_str()));
    state
        .service
        .generate_lesson(payload)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn generate_lesson_async(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Json(payload): Json<GenerateLessonPayload>,
) -> Result<(StatusCode, Json<GenerateLessonResponse>), ApiError> {
    // Check entitlements if account context is available
    if let Some(ctx) = &account {
        if let Err(err) = check_generation_entitlement(&state, &ctx.0).await {
            return Err(err);
        }
    }

    let payload = inject_account_id(payload, account.as_ref().map(|ctx| ctx.0.account_id.as_str()));
    state
        .service
        .queue_lesson(payload)
        .await
        .map(|response| (StatusCode::ACCEPTED, Json(response)))
        .map_err(ApiError::internal)
}

fn resolve_account_id_or_unauthorized(
    account: Option<Extension<AuthenticatedAccountContext>>,
) -> Result<String, ApiError> {
    account
        .map(|value| value.0.account_id)
        .ok_or_else(|| ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "missing authenticated account context".to_string(),
        })
}

async fn list_lesson_shelf(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<LessonShelfListResponse>, ApiError> {
    let account_id = resolve_account_id_or_unauthorized(account)?;
    let status = params.get("status").cloned();
    let limit = params
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(50);
    state
        .service
        .list_lesson_shelf(&account_id, status, limit)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn patch_lesson_shelf_item(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Path(id): Path<String>,
    Json(payload): Json<LessonShelfPatchRequest>,
) -> Result<Json<LessonShelfItemResponse>, ApiError> {
    let account_id = resolve_account_id_or_unauthorized(account)?;
    state
        .service
        .patch_lesson_shelf_item(&account_id, &id, payload)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn archive_lesson_shelf_item(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Path(id): Path<String>,
) -> Result<Json<LessonShelfItemResponse>, ApiError> {
    let account_id = resolve_account_id_or_unauthorized(account)?;
    state
        .service
        .archive_lesson_shelf_item(&account_id, &id)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn reopen_lesson_shelf_item(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Path(id): Path<String>,
) -> Result<Json<LessonShelfItemResponse>, ApiError> {
    let account_id = resolve_account_id_or_unauthorized(account)?;
    state
        .service
        .reopen_lesson_shelf_item(&account_id, &id)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn retry_lesson_shelf_item(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Path(id): Path<String>,
) -> Result<Json<LessonShelfItemResponse>, ApiError> {
    let account_id = resolve_account_id_or_unauthorized(account)?;
    state
        .service
        .retry_lesson_shelf_item(&account_id, &id)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn mark_lesson_shelf_opened(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Json(payload): Json<LessonShelfMarkOpenedRequest>,
) -> Result<Json<LessonShelfItemResponse>, ApiError> {
    let account_id = resolve_account_id_or_unauthorized(account)?;
    state
        .service
        .mark_lesson_shelf_opened(&account_id, &payload.lesson_id, payload.item_id.as_deref())
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn cancel_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LessonGenerationJob>, ApiError> {
    match state
        .service
        .cancel_job(&id)
        .await
        .map_err(ApiError::internal)?
    {
        CancelLessonJobOutcome::Cancelled(job) => Ok(Json(job)),
        CancelLessonJobOutcome::AlreadyRunning => Err(ApiError::conflict(format!(
            "job already running and cannot be cancelled safely: {}",
            id
        ))),
        CancelLessonJobOutcome::NotFound => {
            Err(ApiError::not_found(format!("queued job not found: {}", id)))
        }
    }
}

async fn resume_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<LessonGenerationJob>), ApiError> {
    match state
        .service
        .resume_job(&id)
        .await
        .map_err(ApiError::internal)?
    {
        ResumeLessonJobOutcome::Resumed(job) => Ok((StatusCode::ACCEPTED, Json(job))),
        ResumeLessonJobOutcome::AlreadyQueuedOrRunning => Err(ApiError::conflict(format!(
            "job is already queued or running and cannot be resumed: {}",
            id
        ))),
        ResumeLessonJobOutcome::MissingSnapshot => Err(ApiError::not_found(format!(
            "queued job snapshot not found for resume: {}",
            id
        ))),
        ResumeLessonJobOutcome::NotFound => Err(ApiError::not_found(format!(
            "job not found for resume: {}",
            id
        ))),
    }
}

async fn stream_stateless_chat(
    State(state): State<AppState>,
    Json(payload): Json<StatelessChatRequest>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    validate_runtime_session_mode(&payload).map_err(ApiError::bad_request)?;
    let (sender, receiver) = mpsc::channel::<TutorStreamEvent>(32);
    let service = Arc::clone(&state.service);
    let service_task = tokio::spawn(async move {
        if let Err(err) = service.stateless_chat_stream(payload, sender).await {
            error!("stateless tutor stream error: {}", err);
        }
    });

    let (event_sender, event_receiver) = mpsc::channel::<Result<Event, Infallible>>(32);
    tokio::spawn(async move {
        let mut receiver = receiver;
        let service_task = service_task;
        while let Some(tutor_event) = receiver.recv().await {
            if event_sender
                .send(Ok(build_tutor_sse_event(&tutor_event)))
                .await
                .is_err()
            {
                // Client stream is closed; abort backend generation immediately.
                // This mirrors OpenMAIC's abort-signal intention at the HTTP edge.
                service_task.abort();
                break;
            }
        }
    });

    Ok(Sse::new(ReceiverStream::new(event_receiver)).keep_alive(KeepAlive::default()))
}

async fn acknowledge_runtime_action(
    State(state): State<AppState>,
    Json(payload): Json<RuntimeActionAckRequest>,
) -> Result<Json<RuntimeActionAckResponse>, ApiError> {
    state
        .service
        .acknowledge_runtime_action(payload)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn runtime_pbl_chat(
    State(state): State<AppState>,
    account: Option<Extension<AuthenticatedAccountContext>>,
    Json(mut payload): Json<PblRuntimeChatRequest>,
) -> Result<Json<PblRuntimeChatResponse>, ApiError> {
    if payload.message.trim().is_empty() {
        return Err(ApiError::bad_request(
            "pbl runtime chat requires a non-empty message".to_string(),
        ));
    }
    if payload.user_role.trim().is_empty() {
        return Err(ApiError::bad_request(
            "pbl runtime chat requires user_role".to_string(),
        ));
    }

    if let Some(ctx) = account {
        // Backend is the source of truth for authenticated PBL runtime session scoping.
        // Fold any client-provided hint into an account-scoped stable key.
        let client_hint = payload
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("default");
        let scoped_hint = stable_path_key(client_hint);
        payload.session_id = Some(format!(
            "account:{}:pbl-runtime:{}",
            ctx.0.account_id, scoped_hint
        ));
    }

    state
        .service
        .runtime_pbl_chat(payload)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LessonGenerationJob>, ApiError> {
    state
        .service
        .get_job(&id)
        .await
        .map_err(ApiError::internal)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("job not found: {}", id)))
}

async fn get_lesson(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Lesson>, ApiError> {
    state
        .service
        .get_lesson(&id)
        .await
        .map_err(ApiError::internal)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("lesson not found: {}", id)))
}

async fn export_lesson_html(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let lesson = state
        .service
        .get_lesson(&id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found(format!("lesson not found: {}", id)))?;

    let html = render_lesson_export_html(&lesson);
    let safe_title = lesson
        .title
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let file_name = format!("lesson-{}-{}.html", lesson.id, safe_title);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", file_name),
        )
        .body(Body::from(html))
        .map_err(ApiError::internal)
}

async fn export_lesson_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let lesson = state
        .service
        .get_lesson(&id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found(format!("lesson not found: {}", id)))?;

    let Some(video_asset_ref) = first_exportable_video_asset_ref(&lesson) else {
        return Err(ApiError::bad_request(
            "lesson has no exportable video asset; generate with video enabled first".to_string(),
        ));
    };

    let bytes = state
        .service
        .get_media_asset(&video_asset_ref.lesson_id, &video_asset_ref.file_name)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "video asset not found for export: {}/{}",
                video_asset_ref.lesson_id, video_asset_ref.file_name
            ))
        })?;

    let safe_title = lesson
        .title
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let download_name = format!("lesson-{}-{}.mp4", lesson.id, safe_title);

    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            media_content_type_for_file(&video_asset_ref.file_name),
        )
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", download_name),
        )
        .body(Body::from(bytes))
        .map_err(ApiError::internal)
}

async fn stream_lesson_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let lesson = state
        .service
        .get_lesson(&id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found(format!("lesson not found: {}", id)))?;

    let playback_events = lesson_playback_events(&lesson);
    let (sender, receiver) = mpsc::channel::<Result<Event, Infallible>>(16);

    tokio::spawn(async move {
        for playback_event in playback_events {
            let event = build_sse_event(&playback_event);
            if sender.send(Ok(event)).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
    });

    Ok(Sse::new(ReceiverStream::new(receiver)).keep_alive(KeepAlive::default()))
}

async fn get_audio_asset(
    State(state): State<AppState>,
    Path((lesson_id, file_name)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .service
        .get_audio_asset(&lesson_id, &file_name)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "audio asset not found: {}/{}",
                lesson_id, file_name
            ))
        })?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type_for_file(&file_name))
        .body(Body::from(bytes))
        .map_err(ApiError::internal)
}

async fn get_media_asset(
    State(state): State<AppState>,
    Path((lesson_id, file_name)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .service
        .get_media_asset(&lesson_id, &file_name)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "media asset not found: {}/{}",
                lesson_id, file_name
            ))
        })?;

    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            media_content_type_for_file(&file_name),
        )
        .body(Body::from(bytes))
        .map_err(ApiError::internal)
}

fn build_generation_request(payload: GenerateLessonPayload) -> Result<LessonGenerationRequest> {
    if payload.requirement.trim().is_empty() {
        return Err(anyhow!("requirement cannot be empty"));
    }

    Ok(LessonGenerationRequest {
        requirements: UserRequirements {
            requirement: payload.requirement,
            language: match payload.language.as_deref() {
                Some("zh-CN") => Language::ZhCn,
                _ => Language::EnUs,
            },
            user_nickname: payload.user_nickname,
            user_bio: payload.user_bio,
            web_search: payload.enable_web_search,
        },
        pdf_content: payload.pdf_text.map(|text| PdfContent {
            text,
            images: vec![],
        }),
        enable_web_search: payload.enable_web_search.unwrap_or(false),
        enable_image_generation: payload.enable_image_generation.unwrap_or(false),
        enable_video_generation: payload.enable_video_generation.unwrap_or(false),
        enable_tts: payload.enable_tts.unwrap_or(false),
        agent_mode: match payload.agent_mode.as_deref() {
            Some("generate") => AgentMode::Generate,
            _ => AgentMode::Default,
        },
        account_id: payload.account_id,
        generation_mode: payload.generation_mode,
    })
}

fn sanitize_path_segment(segment: &str) -> Option<&str> {
    if segment.is_empty() || segment == "." || segment == ".." || segment.contains(['/', '\\']) {
        return None;
    }
    Some(segment)
}

fn content_type_for_file(file_name: &str) -> &'static str {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else {
        "audio/mpeg"
    }
}

fn media_content_type_for_file(file_name: &str) -> &'static str {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else {
        "image/png"
    }
}

#[derive(Debug, Clone)]
struct ExportableVideoAssetRef {
    lesson_id: String,
    file_name: String,
}

fn first_exportable_video_asset_ref(lesson: &Lesson) -> Option<ExportableVideoAssetRef> {
    for scene in &lesson.scenes {
        if let ai_tutor_domain::scene::SceneContent::Slide { canvas } = &scene.content {
            for element in &canvas.elements {
                if let ai_tutor_domain::scene::SlideElement::Video { src, .. } = element {
                    if let Some(asset_ref) = parse_exportable_video_asset_ref(src, &lesson.id) {
                        return Some(asset_ref);
                    }
                }
            }
        }
    }
    None
}

fn parse_exportable_video_asset_ref(src: &str, fallback_lesson_id: &str) -> Option<ExportableVideoAssetRef> {
    let path = src.split('?').next()?.trim();
    if path.is_empty() {
        return None;
    }

    let segments = path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    // Supports: /api/assets/media/{lesson_id}/{file_name}
    if segments.len() >= 5
        && segments[0] == "api"
        && segments[1] == "assets"
        && segments[2] == "media"
    {
        let lesson_id = segments[3].trim();
        let file_name = segments[4].trim();
        return build_video_asset_ref(lesson_id, file_name);
    }

    // Supports legacy replay path: /api/classroom-media/{lesson_id}/media/{file_name}
    if segments.len() >= 5
        && segments[0] == "api"
        && segments[1] == "classroom-media"
        && segments[3] == "media"
    {
        let lesson_id = segments[2].trim();
        let file_name = segments[4].trim();
        return build_video_asset_ref(lesson_id, file_name);
    }

    // Fallback for bare file names or other local paths that still embed the final media file.
    segments
        .last()
        .and_then(|file_name| build_video_asset_ref(fallback_lesson_id, file_name.trim()))
}

fn build_video_asset_ref(lesson_id: &str, file_name: &str) -> Option<ExportableVideoAssetRef> {
    if lesson_id.is_empty() || file_name.is_empty() {
        return None;
    }
    let lower = file_name.to_ascii_lowercase();
    if !(lower.ends_with(".mp4") || lower.ends_with(".webm")) {
        return None;
    }

    Some(ExportableVideoAssetRef {
        lesson_id: lesson_id.to_string(),
        file_name: file_name.to_string(),
    })
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn render_lesson_export_html(lesson: &Lesson) -> String {
    let mut body = String::new();
    body.push_str(&format!(
        "<h1>{}</h1><p><strong>Lesson ID:</strong> {}</p><p><strong>Language:</strong> {}</p>",
        html_escape(&lesson.title),
        html_escape(&lesson.id),
        html_escape(&lesson.language)
    ));

    if let Some(description) = &lesson.description {
        body.push_str(&format!("<p>{}</p>", html_escape(description)));
    }

    body.push_str("<h2>Scenes</h2><ol>");
    for scene in &lesson.scenes {
        let content_type = match &scene.content {
            ai_tutor_domain::scene::SceneContent::Slide { .. } => "slide",
            ai_tutor_domain::scene::SceneContent::Quiz { .. } => "quiz",
            ai_tutor_domain::scene::SceneContent::Interactive { .. } => "interactive",
            ai_tutor_domain::scene::SceneContent::Project { .. } => "project",
        };
        body.push_str(&format!(
            "<li><h3>{}</h3><p><strong>Order:</strong> {} | <strong>Type:</strong> {} | <strong>Actions:</strong> {}</p></li>",
            html_escape(&scene.title),
            scene.order,
            content_type,
            scene.actions.len()
        ));
    }
    body.push_str("</ol>");

    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><title>{}</title><style>body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;padding:24px;max-width:920px;margin:0 auto}}h1{{font-size:28px;margin-bottom:8px}}h2{{margin-top:28px}}ol{{padding-left:20px}}li{{margin-bottom:14px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px}}@media print{{body{{padding:0;max-width:none}}li{{break-inside:avoid}}}}</style></head><body>{}</body></html>",
        html_escape(&lesson.title),
        body
    )
}

fn build_sse_event(playback_event: &PlaybackEvent) -> Event {
    let event_name = match playback_event.kind {
        ai_tutor_runtime::session::PlaybackEventKind::SessionStarted => "session_started",
        ai_tutor_runtime::session::PlaybackEventKind::SceneStarted => "scene_started",
        ai_tutor_runtime::session::PlaybackEventKind::ActionStarted => "action_started",
        ai_tutor_runtime::session::PlaybackEventKind::SessionCompleted => "session_completed",
    };

    Event::default()
        .event(event_name)
        .json_data(playback_event)
        .unwrap_or_else(|_| {
            Event::default()
                .event("serialization_error")
                .data(playback_event.summary.clone())
        })
}

fn build_session_started_event(
    session_id: &str,
    runtime_session_id: &str,
    runtime_session_mode: &str,
) -> TutorStreamEvent {
    TutorStreamEvent {
        kind: TutorEventKind::SessionStarted,
        session_id: session_id.to_string(),
        runtime_session_id: Some(runtime_session_id.to_string()),
        runtime_session_mode: Some(runtime_session_mode.to_string()),
        turn_status: Some(TutorTurnStatus::Running),
        agent_id: None,
        agent_name: None,
        action_name: None,
        action_params: None,
        execution_id: None,
        ack_policy: None,
        execution: None,
        whiteboard_state: None,
        content: None,
        message: Some("Starting stateless tutor session".to_string()),
        interruption_reason: None,
        resume_allowed: None,
        director_state: None,
    }
}

fn map_graph_event_to_tutor_event(
    ge: chat_graph::ChatGraphEvent,
    session_id: &str,
    runtime_session_id: &str,
    runtime_session_mode: &str,
) -> TutorStreamEvent {
    let canonical_action_params = ge
        .action_name
        .as_deref()
        .zip(ge.action_params.as_ref())
        .map(|(action_name, params)| canonical_runtime_action_params(action_name, params));
    let resolved_action_params = canonical_action_params.or(ge.action_params.clone());
    let execution = ge
        .action_name
        .as_deref()
        .and_then(action_execution_metadata_for_name);
    let execution_id = ge
        .action_name
        .as_deref()
        .zip(resolved_action_params.as_ref())
        .map(|(action_name, params)| {
            build_runtime_action_execution_id(session_id, action_name, params)
        });
    let ack_policy = ge
        .action_name
        .as_deref()
        .and_then(action_ack_policy_for_name);
    let kind = match ge.kind {
        ChatGraphEventKind::Thinking => TutorEventKind::Thinking,
        ChatGraphEventKind::AgentSelected => TutorEventKind::AgentSelected,
        ChatGraphEventKind::TextDelta => TutorEventKind::TextDelta,
        ChatGraphEventKind::ActionStarted => TutorEventKind::ActionStarted,
        ChatGraphEventKind::ActionProgress => TutorEventKind::ActionProgress,
        ChatGraphEventKind::ActionCompleted => TutorEventKind::ActionCompleted,
        ChatGraphEventKind::Interrupted => TutorEventKind::Interrupted,
        ChatGraphEventKind::CueUser => TutorEventKind::CueUser,
        ChatGraphEventKind::Done => TutorEventKind::Done,
    };

    TutorStreamEvent {
        kind,
        session_id: session_id.to_string(),
        runtime_session_id: Some(runtime_session_id.to_string()),
        runtime_session_mode: Some(runtime_session_mode.to_string()),
        turn_status: Some(match ge.kind {
            ChatGraphEventKind::Interrupted => TutorTurnStatus::Interrupted,
            ChatGraphEventKind::Done => TutorTurnStatus::Completed,
            _ => TutorTurnStatus::Running,
        }),
        agent_id: ge.agent_id,
        agent_name: ge.agent_name,
        action_name: ge.action_name,
        action_params: resolved_action_params,
        execution_id,
        ack_policy,
        execution,
        whiteboard_state: ge.whiteboard_state,
        content: ge.content,
        message: ge.message,
        interruption_reason: ge.interruption_reason,
        resume_allowed: ge.resume_allowed,
        director_state: ge.director_state,
    }
}

fn build_tutor_sse_event(tutor_event: &TutorStreamEvent) -> Event {
    let event_name = match tutor_event.kind {
        TutorEventKind::SessionStarted => "session_started",
        TutorEventKind::Thinking => "thinking",
        TutorEventKind::AgentSelected => "agent_selected",
        TutorEventKind::TextDelta => "text_delta",
        TutorEventKind::ActionStarted => "action_started",
        TutorEventKind::ActionProgress => "action_progress",
        TutorEventKind::ActionCompleted => "action_completed",
        TutorEventKind::Interrupted => "interrupted",
        TutorEventKind::ResumeAvailable => "resume_available",
        TutorEventKind::ResumeRejected => "resume_rejected",
        TutorEventKind::CueUser => "cue_user",
        TutorEventKind::Done => "done",
        TutorEventKind::Error => "error",
    };

    Event::default()
        .event(event_name)
        .json_data(tutor_event)
        .unwrap_or_else(|_| {
            Event::default().event("serialization_error").data(
                tutor_event
                    .message
                    .clone()
                    .unwrap_or_else(|| "serialization error".to_string()),
            )
        })
}

fn action_ack_policy_for_name(action_name: &str) -> Option<ActionAckPolicy> {
    match action_name {
        "speech" | "discussion" => Some(ActionAckPolicy::AckOptional),
        "spotlight" | "laser" | "play_video" | "wb_open" | "wb_draw_text" | "wb_draw_shape"
        | "wb_draw_chart" | "wb_draw_latex" | "wb_draw_table" | "wb_draw_line" | "wb_clear"
        | "wb_delete" | "wb_close" => Some(ActionAckPolicy::AckRequired),
        _ => None,
    }
}

fn build_runtime_action_execution_id(
    session_id: &str,
    action_name: &str,
    params: &serde_json::Value,
) -> String {
    format!(
        "{}:{}:{}",
        session_id,
        action_name,
        stable_json_signature(params)
    )
}

fn stable_json_signature(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::String(value) => format!("{:?}", value),
        serde_json::Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(stable_json_signature)
                .collect::<Vec<_>>()
                .join(",")
        ),
        serde_json::Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!("{}:{}", key, stable_json_signature(value)))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn runtime_action_ack_timeout_ms() -> u64 {
    std::env::var("AI_TUTOR_RUNTIME_ACTION_ACK_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(15_000)
}

fn parse_runtime_action_execution_status(value: &str) -> Option<RuntimeActionExecutionStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "accepted" => Some(RuntimeActionExecutionStatus::Accepted),
        "completed" => Some(RuntimeActionExecutionStatus::Completed),
        "failed" => Some(RuntimeActionExecutionStatus::Failed),
        "timed_out" => Some(RuntimeActionExecutionStatus::TimedOut),
        _ => None,
    }
}

fn runtime_action_execution_status_label(status: &RuntimeActionExecutionStatus) -> &'static str {
    match status {
        RuntimeActionExecutionStatus::Pending => "pending",
        RuntimeActionExecutionStatus::Accepted => "accepted",
        RuntimeActionExecutionStatus::Completed => "completed",
        RuntimeActionExecutionStatus::Failed => "failed",
        RuntimeActionExecutionStatus::TimedOut => "timed_out",
    }
}

fn can_transition_runtime_action_status(
    current: &RuntimeActionExecutionStatus,
    next: &RuntimeActionExecutionStatus,
) -> bool {
    matches!(
        (current, next),
        (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::Accepted)
            | (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::Completed)
            | (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::Failed)
            | (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::TimedOut)
            | (RuntimeActionExecutionStatus::Accepted, RuntimeActionExecutionStatus::Completed)
            | (RuntimeActionExecutionStatus::Accepted, RuntimeActionExecutionStatus::Failed)
            | (RuntimeActionExecutionStatus::Accepted, RuntimeActionExecutionStatus::TimedOut)
    )
}

fn map_provider_runtime_status(
    statuses: Vec<ProviderRuntimeStatus>,
) -> Vec<ProviderRuntimeStatusResponse> {
    statuses
        .into_iter()
        .map(|status| ProviderRuntimeStatusResponse {
            label: status.label,
            available: status.available,
            consecutive_failures: status.consecutive_failures,
            cooldown_remaining_ms: status.cooldown_remaining_ms,
            total_requests: status.total_requests,
            total_successes: status.total_successes,
            total_failures: status.total_failures,
            last_error: status.last_error,
            last_success_unix_ms: status.last_success_unix_ms,
            last_failure_unix_ms: status.last_failure_unix_ms,
            total_latency_ms: status.total_latency_ms,
            average_latency_ms: status.average_latency_ms,
            last_latency_ms: status.last_latency_ms,
            estimated_input_tokens: status.estimated_input_tokens,
            estimated_output_tokens: status.estimated_output_tokens,
            estimated_total_cost_microusd: status.estimated_total_cost_microusd,
            provider_reported_input_tokens: status.provider_reported_input_tokens,
            provider_reported_output_tokens: status.provider_reported_output_tokens,
            provider_reported_total_tokens: status.provider_reported_total_tokens,
            provider_reported_total_cost_microusd: status.provider_reported_total_cost_microusd,
            streaming_path: status.streaming_path.as_str().to_string(),
            native_streaming: status.capabilities.native_text_streaming,
            native_typed_streaming: status.capabilities.native_typed_streaming,
            compatibility_streaming: status.capabilities.compatibility_streaming,
            cooperative_cancellation: status.capabilities.cooperative_cancellation,
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProviderRuntimeTotals {
    total_requests: u64,
    total_successes: u64,
    total_failures: u64,
    total_latency_ms: u64,
    average_latency_ms: Option<u64>,
    estimated_input_tokens: u64,
    estimated_output_tokens: u64,
    estimated_total_cost_microusd: u64,
    provider_reported_input_tokens: u64,
    provider_reported_output_tokens: u64,
    provider_reported_total_tokens: u64,
    provider_reported_total_cost_microusd: u64,
}

fn aggregate_provider_runtime_status(
    statuses: &[ProviderRuntimeStatusResponse],
) -> ProviderRuntimeTotals {
    let total_requests = statuses.iter().map(|status| status.total_requests).sum();
    let total_successes = statuses.iter().map(|status| status.total_successes).sum();
    let total_failures = statuses.iter().map(|status| status.total_failures).sum();
    let total_latency_ms = statuses.iter().map(|status| status.total_latency_ms).sum();
    let estimated_input_tokens = statuses
        .iter()
        .map(|status| status.estimated_input_tokens)
        .sum();
    let estimated_output_tokens = statuses
        .iter()
        .map(|status| status.estimated_output_tokens)
        .sum();
    let estimated_total_cost_microusd = statuses
        .iter()
        .map(|status| status.estimated_total_cost_microusd)
        .sum();
    let provider_reported_input_tokens = statuses
        .iter()
        .map(|status| status.provider_reported_input_tokens)
        .sum();
    let provider_reported_output_tokens = statuses
        .iter()
        .map(|status| status.provider_reported_output_tokens)
        .sum();
    let provider_reported_total_tokens = statuses
        .iter()
        .map(|status| status.provider_reported_total_tokens)
        .sum();
    let provider_reported_total_cost_microusd = statuses
        .iter()
        .map(|status| status.provider_reported_total_cost_microusd)
        .sum();
    let average_latency_ms = if total_requests == 0 {
        None
    } else {
        Some(total_latency_ms / total_requests)
    };
    ProviderRuntimeTotals {
        total_requests,
        total_successes,
        total_failures,
        total_latency_ms,
        average_latency_ms,
        estimated_input_tokens,
        estimated_output_tokens,
        estimated_total_cost_microusd,
        provider_reported_input_tokens,
        provider_reported_output_tokens,
        provider_reported_total_tokens,
        provider_reported_total_cost_microusd,
    }
}

fn resolve_generation_model_policy(
    request_model_override: Option<&str>,
    outlines_override: Option<&str>,
    scene_content_override: Option<&str>,
    scene_actions_override: Option<&str>,
    scene_actions_fallback_override: Option<&str>,
) -> Result<GenerationModelPolicy> {
    if let Some(request_model) = request_model_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(GenerationModelPolicy {
            outlines_model: request_model.to_string(),
            scene_content_model: request_model.to_string(),
            scene_actions_model: request_model.to_string(),
            scene_actions_fallback_model: None,
        });
    }

    let outlines_model = env_model_or_error(
        outlines_override,
        "BALANCED_MODE_AI_TUTOR_GENERATION_OUTLINES_MODEL",
    )?;
    let scene_content_model = env_model_or_error(
        scene_content_override,
        "BALANCED_MODE_AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL",
    )?;
    let scene_actions_model = env_model_or_error(
        scene_actions_override,
        "BALANCED_MODE_AI_TUTOR_GENERATION_SCENE_ACTIONS_MODEL",
    )?;

    let _ = scene_actions_fallback_override;

    Ok(GenerationModelPolicy {
        outlines_model,
        scene_content_model,
        scene_actions_model,
        scene_actions_fallback_model: None,
    })
}

fn env_model_or_error(override_model: Option<&str>, env_key: &str) -> Result<String> {
    let candidate = override_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            std::env::var(env_key)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        });

    candidate.ok_or_else(|| anyhow!("{env_key} is required"))
}

fn selected_model_profile(
    config: &ServerProviderConfig,
    model_string: Option<&str>,
) -> Result<SelectedModelProfileResponse> {
    let resolved = resolve_model(config, model_string, None, None, None, None)?;
    let provider_name = built_in_providers()
        .into_iter()
        .find(|provider| provider.id == resolved.provider.id)
        .map(|provider| provider.name)
        .unwrap_or_else(|| resolved.provider.id.clone());
    let model_name = resolved.model_info.as_ref().map(|info| info.name.clone());
    let context_window = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.context_window);
    let output_window = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.output_window);
    let cost_tier = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.cost_tier.clone());
    let input_cost_per_1m_usd = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.pricing.as_ref())
        .map(|pricing| pricing.input_cost_per_1m_usd)
        .or_else(|| {
            config
                .get(&resolved.provider.id)
                .and_then(|entry| entry.pricing_override.as_ref())
                .and_then(|pricing| pricing.input_cost_per_1m_usd)
        });
    let output_cost_per_1m_usd = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.pricing.as_ref())
        .map(|pricing| pricing.output_cost_per_1m_usd)
        .or_else(|| {
            config
                .get(&resolved.provider.id)
                .and_then(|entry| entry.pricing_override.as_ref())
                .and_then(|pricing| pricing.output_cost_per_1m_usd)
        });
    let supports_tools = resolved
        .model_info
        .as_ref()
        .map(|info| info.capabilities.tools)
        .unwrap_or(false);
    let supports_vision = resolved
        .model_info
        .as_ref()
        .map(|info| info.capabilities.vision)
        .unwrap_or(false);
    let supports_thinking = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.capabilities.thinking.as_ref())
        .is_some();

    Ok(SelectedModelProfileResponse {
        provider_id: resolved.provider.id,
        provider_name,
        model_id: resolved.model_config.model_id,
        model_name,
        context_window,
        output_window,
        cost_tier,
        input_cost_per_1m_usd,
        output_cost_per_1m_usd,
        supports_tools,
        supports_vision,
        supports_thinking,
    })
}

fn derive_runtime_alerts(
    provider_runtime: &[ProviderRuntimeStatusResponse],
    queue_status_error: Option<&str>,
    provider_status_error: Option<&str>,
    queue_stale_leases: usize,
    selected_model_profile: Option<&SelectedModelProfileResponse>,
    auth_blueprint: &AuthBlueprintStatusResponse,
    credit_policy: &CreditPolicyResponse,
) -> Vec<String> {
    let mut alerts = Vec::new();
    if let Some(error) = queue_status_error.filter(|value| !value.trim().is_empty()) {
        alerts.push(format!("queue_status_error: {}", error));
    }
    if let Some(error) = provider_status_error.filter(|value| !value.trim().is_empty()) {
        alerts.push(format!("provider_status_error: {}", error));
    }
    if queue_stale_leases > 0 {
        alerts.push(format!(
            "queue_stale_leases_detected: {} stale worker lease(s)",
            queue_stale_leases
        ));
    }
    if runtime_native_streaming_required()
        && provider_runtime
            .iter()
            .any(|status| !status.native_streaming && status.compatibility_streaming)
    {
        alerts
            .push("native_streaming_required_but_provider_reports_compatibility_path".to_string());
    }
    if runtime_native_typed_streaming_required()
        && provider_runtime
            .iter()
            .any(|status| status.native_streaming && !status.native_typed_streaming)
    {
        alerts.push("native_typed_streaming_required_but_provider_lacks_typed_events".to_string());
    }
    if let Some(selected_model_profile) = selected_model_profile {
        if matches!(selected_model_profile.cost_tier.as_deref(), Some("premium")) {
            alerts.push(format!(
                "selected_model_cost_tier_premium:{}:{}",
                selected_model_profile.provider_id, selected_model_profile.model_id
            ));
        }
    }
    if auth_blueprint.google_oauth_enabled
        && (!auth_blueprint.google_client_id_configured
            || !auth_blueprint.google_client_secret_configured
            || auth_blueprint.google_redirect_uri.is_none())
    {
        alerts.push("google_oauth_enabled_but_required_google_oauth_env_is_incomplete".to_string());
    }
    if auth_blueprint.firebase_phone_auth_enabled && auth_blueprint.firebase_project_id.is_none() {
        alerts.push("firebase_phone_auth_enabled_but_firebase_project_id_is_missing".to_string());
    }
    if auth_blueprint.google_oauth_enabled
        && auth_blueprint.firebase_phone_auth_enabled
        && !auth_blueprint.partial_auth_secret_configured
    {
        alerts.push(
            "partial_auth_secret_missing_for_google_to_phone_verification_handoff".to_string(),
        );
    }
    if credit_policy.tts_per_slide_credits <= 0.0 {
        alerts.push("tts_credit_burn_is_zero_or_negative".to_string());
    }
    if credit_policy.tts_margin_review_required {
        alerts.push("tts_margin_review_required".to_string());
    }
    for status in provider_runtime {
        if !status.available || status.cooldown_remaining_ms > 0 {
            alerts.push(format!(
                "provider_unavailable:{} cooldown_ms={}",
                status.label, status.cooldown_remaining_ms
            ));
        }
        if status.total_requests >= 5 && status.total_failures * 2 >= status.total_requests {
            alerts.push(format!(
                "provider_high_failure_rate:{} failures={}/{}",
                status.label, status.total_failures, status.total_requests
            ));
        }
        if status
            .average_latency_ms
            .is_some_and(|latency| latency >= 5_000)
        {
            alerts.push(format!(
                "provider_high_latency:{} avg_ms={}",
                status.label,
                status.average_latency_ms.unwrap_or_default()
            ));
        }
    }
    if production_hardening_alerts_enabled() {
        let auth_enabled = !std::env::var("AI_TUTOR_API_SECRET")
            .unwrap_or_default()
            .trim()
            .is_empty()
            || !std::env::var("AI_TUTOR_API_TOKENS")
                .unwrap_or_default()
                .trim()
                .is_empty();
        if !auth_enabled {
            alerts.push(
                "auth_disabled: configure AI_TUTOR_API_SECRET or AI_TUTOR_API_TOKENS for production"
                    .to_string(),
            );
        }
        if !matches!(
            std::env::var("AI_TUTOR_REQUIRE_HTTPS")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        ) {
            alerts.push(
                "https_not_required: set AI_TUTOR_REQUIRE_HTTPS=1 behind TLS termination for production"
                    .to_string(),
            );
        }
        if asset_backend_label() == "local" {
            alerts.push(
                "asset_backend_local: configure R2/object storage for production durability"
                    .to_string(),
            );
        }
        if std::env::var("AI_TUTOR_QUEUE_WORKER_ID")
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            alerts.push(
                "queue_worker_id_ephemeral: set AI_TUTOR_QUEUE_WORKER_ID for multi-instance ownership fencing".to_string(),
            );
        }
        if env_flag("AI_TUTOR_OPERATOR_OTP_ENABLED") {
            if read_optional_env("AI_TUTOR_REDIS_URL")
                .or_else(|| read_optional_env("REDIS_URL"))
                .is_none()
            {
                alerts.push(
                    "operator_otp_enabled_but_redis_missing: set AI_TUTOR_REDIS_URL or REDIS_URL"
                        .to_string(),
                );
            }
            if read_optional_env("AI_TUTOR_OPERATOR_ALLOWED_EMAILS").is_none() {
                alerts.push(
                    "operator_otp_enabled_but_allowed_emails_missing: set AI_TUTOR_OPERATOR_ALLOWED_EMAILS"
                        .to_string(),
                );
            }
            if !env_flag("AI_TUTOR_SMTP_ENABLED") {
                alerts.push(
                    "operator_otp_enabled_but_smtp_disabled: enable AI_TUTOR_SMTP_ENABLED for otp delivery"
                        .to_string(),
                );
            }
            if read_optional_env("AI_TUTOR_OPERATOR_OTP_SECRET")
                .or_else(|| read_optional_env("AI_TUTOR_API_SECRET"))
                .is_none()
            {
                alerts.push(
                    "operator_otp_secret_missing: set AI_TUTOR_OPERATOR_OTP_SECRET or AI_TUTOR_API_SECRET"
                        .to_string(),
                );
            }
        }
    }
    alerts
}

fn derive_runtime_alert_level(alerts: &[String]) -> &'static str {
    if alerts.is_empty() {
        "ok"
    } else if alerts.iter().any(|alert| {
        alert.contains("error")
            || alert.contains("unavailable")
            || alert.contains("required")
            || alert.contains("stale")
    }) {
        "degraded"
    } else {
        "warning"
    }
}

fn auth_blueprint_status() -> AuthBlueprintStatusResponse {
    let google_client_id = read_optional_env("AI_TUTOR_GOOGLE_OAUTH_CLIENT_ID");
    let google_client_secret = read_optional_env("AI_TUTOR_GOOGLE_OAUTH_CLIENT_SECRET");
    let google_redirect_uri = read_optional_env("AI_TUTOR_GOOGLE_OAUTH_REDIRECT_URI");
    let firebase_project_id = read_optional_env("AI_TUTOR_FIREBASE_PROJECT_ID");
    let verify_phone_path = read_optional_env("AI_TUTOR_VERIFY_PHONE_PATH")
        .unwrap_or_else(|| "/verify-phone".to_string());

    AuthBlueprintStatusResponse {
        google_oauth_enabled: env_flag("AI_TUTOR_GOOGLE_OAUTH_ENABLED"),
        google_client_id_configured: google_client_id.is_some(),
        google_client_secret_configured: google_client_secret.is_some(),
        google_redirect_uri,
        firebase_phone_auth_enabled: env_flag("AI_TUTOR_FIREBASE_PHONE_AUTH_ENABLED"),
        firebase_project_id,
        partial_auth_secret_configured: read_optional_env("AI_TUTOR_PARTIAL_AUTH_SECRET").is_some(),
        verify_phone_path,
    }
}

fn deployment_blueprint() -> DeploymentBlueprintResponse {
    DeploymentBlueprintResponse {
        frontend_output_mode: read_optional_env("AI_TUTOR_FRONTEND_OUTPUT_MODE")
            .unwrap_or_else(|| "standalone".to_string()),
        frontend_deployment_mode: read_optional_env("AI_TUTOR_FRONTEND_DEPLOYMENT_MODE")
            .unwrap_or_else(|| "containerized".to_string()),
        recommended_targets: read_csv_env(
            "AI_TUTOR_FRONTEND_DEPLOYMENT_TARGETS",
            &["cloud_run", "hetzner_coolify", "aws"],
        ),
        vercel_recommended: env_flag("AI_TUTOR_RECOMMEND_VERCEL"),
    }
}

fn credit_policy() -> CreditPolicyResponse {
    CreditPolicyResponse {
        base_workflow_slide_credits: env_f64("AI_TUTOR_BASE_WORKFLOW_SLIDE_CREDITS", 0.10),
        image_attachment_credits: env_f64("AI_TUTOR_IMAGE_ATTACHMENT_CREDITS", 0.05),
        tts_per_slide_credits: env_f64("AI_TUTOR_TTS_PER_SLIDE_CREDITS", 0.20),
        starter_grant_credits: env_f64("AI_TUTOR_STARTER_GRANT_CREDITS", 10.0),
        plus_monthly_price_usd: env_f64("AI_TUTOR_PLUS_MONTHLY_PRICE_USD", 5.0),
        plus_monthly_credits: env_f64("AI_TUTOR_PLUS_MONTHLY_CREDITS", 30.0),
        pro_monthly_price_usd: env_f64("AI_TUTOR_PRO_MONTHLY_PRICE_USD", 12.0),
        pro_monthly_credits: env_f64("AI_TUTOR_PRO_MONTHLY_CREDITS", 80.0),
        bundle_small_price_usd: env_f64("AI_TUTOR_BUNDLE_SMALL_PRICE_USD", 5.0),
        bundle_small_credits: env_f64("AI_TUTOR_BUNDLE_SMALL_CREDITS", 10.0),
        bundle_large_price_usd: env_f64("AI_TUTOR_BUNDLE_LARGE_PRICE_USD", 32.5),
        bundle_large_credits: env_f64("AI_TUTOR_BUNDLE_LARGE_CREDITS", 65.0),
        tts_margin_review_required: env_flag("AI_TUTOR_TTS_MARGIN_REVIEW_REQUIRED"),
    }
}

fn read_optional_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_flag(key: &str) -> bool {
    matches!(
        std::env::var(key)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn env_f64(key: &str, default: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .unwrap_or(default)
}

fn read_csv_env(key: &str, default: &[&str]) -> Vec<String> {
    if let Some(value) = read_optional_env(key) {
        let parsed = value
            .split(',')
            .map(|item| item.trim())
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect::<Vec<_>>();
        if !parsed.is_empty() {
            return parsed;
        }
    }

    default.iter().map(|item| (*item).to_string()).collect()
}

fn env_i64(key: &str, default: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default)
}

fn billing_currency() -> String {
    read_optional_env("AI_TUTOR_BILLING_CURRENCY").unwrap_or_else(|| "USD".to_string())
}

fn billing_timezone_name() -> String {
    read_optional_env("AI_TUTOR_BILLING_TIMEZONE").unwrap_or_else(|| "UTC".to_string())
}

fn billing_timezone() -> Tz {
    billing_timezone_name()
        .parse::<Tz>()
        .unwrap_or(chrono_tz::UTC)
}

fn resolve_local_datetime(timezone: Tz, year: i32, month: u32, day: u32, hour: u32) -> Option<chrono::DateTime<Tz>> {
    match timezone.with_ymd_and_hms(year, month, day, hour, 0, 0) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(earliest, _) => Some(earliest),
        LocalResult::None => None,
    }
}

fn billing_month_window(now_utc: chrono::DateTime<chrono::Utc>) -> (chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>) {
    let timezone = billing_timezone();
    let local_now = now_utc.with_timezone(&timezone);
    let mut month_start_utc = now_utc;

    for hour in 0..=6 {
        if let Some(local_start) = resolve_local_datetime(
            timezone,
            local_now.year(),
            local_now.month(),
            1,
            hour,
        ) {
            month_start_utc = local_start.with_timezone(&chrono::Utc);
            break;
        }
    }

    (month_start_utc, now_utc)
}

fn rolling_30d_window(now_utc: chrono::DateTime<chrono::Utc>) -> (chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>) {
    (now_utc - chrono::Duration::days(30), now_utc)
}

fn payment_effective_at(order: &PaymentOrder) -> chrono::DateTime<chrono::Utc> {
    order.completed_at.unwrap_or(order.updated_at)
}

fn billing_catalog() -> Vec<BillingProductDefinition> {
    let policy = credit_policy();
    let currency = billing_currency();
    vec![
        BillingProductDefinition {
            product_code: "plus_monthly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "AI Tutor Plus Monthly".to_string(),
            credits: policy.plus_monthly_credits,
            currency: currency.clone(),
            amount_minor: env_i64(
                "AI_TUTOR_PLUS_MONTHLY_PRICE_MINOR",
                (policy.plus_monthly_price_usd * 100.0).round() as i64,
            ),
        },
        BillingProductDefinition {
            product_code: "pro_monthly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "AI Tutor Pro Monthly".to_string(),
            credits: policy.pro_monthly_credits,
            currency: currency.clone(),
            amount_minor: env_i64(
                "AI_TUTOR_PRO_MONTHLY_PRICE_MINOR",
                (policy.pro_monthly_price_usd * 100.0).round() as i64,
            ),
        },
        BillingProductDefinition {
            product_code: "bundle_small".to_string(),
            kind: BillingProductKind::Bundle,
            title: "AI Tutor Credit Bundle Small".to_string(),
            credits: policy.bundle_small_credits,
            currency: currency.clone(),
            amount_minor: env_i64(
                "AI_TUTOR_BUNDLE_SMALL_PRICE_MINOR",
                (policy.bundle_small_price_usd * 100.0).round() as i64,
            ),
        },
        BillingProductDefinition {
            product_code: "bundle_large".to_string(),
            kind: BillingProductKind::Bundle,
            title: "AI Tutor Credit Bundle Large".to_string(),
            credits: policy.bundle_large_credits,
            currency,
            amount_minor: env_i64(
                "AI_TUTOR_BUNDLE_LARGE_PRICE_MINOR",
                (policy.bundle_large_price_usd * 100.0).round() as i64,
            ),
        },
    ]
}

fn easebuzz_config() -> Result<EasebuzzConfig> {
    let environment = read_optional_env("AI_TUTOR_EASEBUZZ_ENV")
        .unwrap_or_else(|| "test".to_string())
        .to_ascii_lowercase();
    let base_url = read_optional_env("AI_TUTOR_EASEBUZZ_BASE_URL").unwrap_or_else(|| {
        if environment == "prod" || environment == "production" {
            "https://pay.easebuzz.in".to_string()
        } else {
            "https://testpay.easebuzz.in".to_string()
        }
    });
    Ok(EasebuzzConfig {
        key: required_env("AI_TUTOR_EASEBUZZ_KEY")?,
        salt: required_env("AI_TUTOR_EASEBUZZ_SALT")?,
        base_url,
    })
}

fn easebuzz_amount_string(amount_minor: i64) -> String {
    format!("{:.2}", amount_minor as f64 / 100.0)
}

fn billing_product_kind_label(kind: &BillingProductKind) -> &'static str {
    match kind {
        BillingProductKind::Subscription => "subscription",
        BillingProductKind::Bundle => "bundle",
    }
}

fn payment_order_status_label(status: &PaymentOrderStatus) -> &'static str {
    match status {
        PaymentOrderStatus::Pending => "pending",
        PaymentOrderStatus::Succeeded => "succeeded",
        PaymentOrderStatus::Failed => "failed",
    }
}

fn easebuzz_callback_indicates_reversal(fields: &HashMap<String, String>, status: &str) -> bool {
    let has_keyword = |value: &str| {
        let lowered = value.to_ascii_lowercase();
        lowered.contains("refund")
            || lowered.contains("chargeback")
            || lowered.contains("reversal")
            || lowered.contains("reversed")
            || lowered.contains("revoked")
    };

    has_keyword(status)
        || fields.get("unmappedstatus").is_some_and(|value| has_keyword(value))
        || fields
            .get("transaction_status")
            .is_some_and(|value| has_keyword(value))
        || fields
            .get("payment_status")
            .is_some_and(|value| has_keyword(value))
}

fn easebuzz_event_identifier(
    fields: &HashMap<String, String>,
    gateway_txn_id: &str,
    status: &str,
) -> String {
    if let Some(explicit_event_id) = fields
        .get("event_id")
        .cloned()
        .or_else(|| fields.get("mihpayid").cloned())
        .or_else(|| fields.get("easepayid").cloned())
        .filter(|value| !value.trim().is_empty())
    {
        return format!("easebuzz:{}:{}", gateway_txn_id, explicit_event_id);
    }

    let payload_hash = sha512_hex(
        &serde_json::to_string(fields).unwrap_or_else(|_| "{}".to_string()),
    );
    format!("easebuzz:{}:{}:{}", gateway_txn_id, status.to_ascii_lowercase(), payload_hash)
}

fn payment_order_to_response(order: PaymentOrder) -> PaymentOrderResponse {
    PaymentOrderResponse {
        id: order.id,
        account_id: order.account_id,
        product_code: order.product_code,
        kind: billing_product_kind_label(&order.product_kind).to_string(),
        gateway: order.gateway,
        gateway_txn_id: order.gateway_txn_id,
        gateway_payment_id: order.gateway_payment_id,
        status: payment_order_status_label(&order.status).to_string(),
        currency: order.currency,
        amount_minor: order.amount_minor,
        credits_to_grant: order.credits_to_grant,
        checkout_url: order.checkout_url,
        created_at: order.created_at.to_rfc3339(),
        updated_at: order.updated_at.to_rfc3339(),
        completed_at: order.completed_at.map(|value| value.to_rfc3339()),
    }
}

fn first_name_from_email(email: &str) -> String {
    email
        .split('@')
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Tutor")
        .to_string()
}

fn required_field(fields: &HashMap<String, String>, key: &str) -> Result<String> {
    fields
        .get(key)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("missing required easebuzz field {}", key))
}

fn required_trimmed_env(key: &str) -> Result<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("{} is required", key))
}

fn generate_easebuzz_request_hash(fields: &HashMap<String, String>, salt: &str) -> String {
    let values = [
        fields.get("key").map(String::as_str).unwrap_or(""),
        fields.get("txnid").map(String::as_str).unwrap_or(""),
        fields.get("amount").map(String::as_str).unwrap_or(""),
        fields.get("productinfo").map(String::as_str).unwrap_or(""),
        fields.get("firstname").map(String::as_str).unwrap_or(""),
        fields.get("email").map(String::as_str).unwrap_or(""),
        fields.get("udf1").map(String::as_str).unwrap_or(""),
        fields.get("udf2").map(String::as_str).unwrap_or(""),
        fields.get("udf3").map(String::as_str).unwrap_or(""),
        fields.get("udf4").map(String::as_str).unwrap_or(""),
        fields.get("udf5").map(String::as_str).unwrap_or(""),
        fields.get("udf6").map(String::as_str).unwrap_or(""),
        fields.get("udf7").map(String::as_str).unwrap_or(""),
        fields.get("udf8").map(String::as_str).unwrap_or(""),
        fields.get("udf9").map(String::as_str).unwrap_or(""),
        fields.get("udf10").map(String::as_str).unwrap_or(""),
        salt,
    ];
    sha512_hex(&values.join("|"))
}

fn verify_easebuzz_response_hash(fields: &HashMap<String, String>, salt: &str) -> Result<()> {
    let actual = required_field(fields, "hash")?;
    let values = [
        salt,
        fields.get("status").map(String::as_str).unwrap_or(""),
        fields.get("udf10").map(String::as_str).unwrap_or(""),
        fields.get("udf9").map(String::as_str).unwrap_or(""),
        fields.get("udf8").map(String::as_str).unwrap_or(""),
        fields.get("udf7").map(String::as_str).unwrap_or(""),
        fields.get("udf6").map(String::as_str).unwrap_or(""),
        fields.get("udf5").map(String::as_str).unwrap_or(""),
        fields.get("udf4").map(String::as_str).unwrap_or(""),
        fields.get("udf3").map(String::as_str).unwrap_or(""),
        fields.get("udf2").map(String::as_str).unwrap_or(""),
        fields.get("udf1").map(String::as_str).unwrap_or(""),
        fields.get("email").map(String::as_str).unwrap_or(""),
        fields.get("firstname").map(String::as_str).unwrap_or(""),
        fields.get("productinfo").map(String::as_str).unwrap_or(""),
        fields.get("amount").map(String::as_str).unwrap_or(""),
        fields.get("txnid").map(String::as_str).unwrap_or(""),
        fields.get("key").map(String::as_str).unwrap_or(""),
    ];
    let expected = sha512_hex(&values.join("|"));
    if actual.eq_ignore_ascii_case(&expected) {
        Ok(())
    } else {
        Err(anyhow!("easebuzz callback hash verification failed"))
    }
}

fn sha512_hex(input: &str) -> String {
    use sha2::{Digest, Sha512};

    let mut hasher = Sha512::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    format!("{:x}", digest)
}

fn auth_response_to_http(payload: AuthSessionResponse) -> Response {
    let should_redirect = auth_redirect_enabled() && payload.partial_auth_token.is_none();
    let json_body = serde_json::to_vec(&payload).unwrap_or_else(|_| b"{}".to_vec());
    let json_body_fallback = json_body.clone();

    let mut response = if should_redirect {
        let location = payload.redirect_to.clone();
        Response::builder()
            .status(StatusCode::FOUND)
            .header(header::LOCATION, location)
            .body(Body::from(json_body))
            .unwrap_or_else(|_| Response::new(Body::from(json_body_fallback)))
    } else {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json_body))
            .unwrap_or_else(|_| Response::new(Body::from(json_body_fallback)))
    };

    if auth_cookie_enabled() {
        if let Some(token) = payload.session_token.as_ref() {
            let cookie = build_cookie(auth_session_cookie_name(), token, session_ttl_seconds());
            response
                .headers_mut()
                .append(header::SET_COOKIE, cookie.parse().unwrap());
        }
        if let Some(token) = payload.partial_auth_token.as_ref() {
            let cookie = build_cookie(
                auth_partial_cookie_name(),
                token,
                partial_auth_ttl_seconds(),
            );
            response
                .headers_mut()
                .append(header::SET_COOKIE, cookie.parse().unwrap());
        }
    }

    response
}

fn build_google_oauth_url(state: &str) -> Result<String> {
    let client_id = required_env("AI_TUTOR_GOOGLE_OAUTH_CLIENT_ID")?;
    let redirect_uri = required_env("AI_TUTOR_GOOGLE_OAUTH_REDIRECT_URI")?;
    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id.as_str())
        .append_pair("redirect_uri", redirect_uri.as_str())
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", state)
        .append_pair("access_type", "offline")
        .append_pair("include_granted_scopes", "true");
    Ok(url.to_string())
}

fn issue_state_token() -> Result<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = AuthStateClaims {
        nonce: Uuid::new_v4().to_string(),
        iat: now as usize,
        exp: (now + state_ttl_seconds()) as usize,
    };
    let secret = required_env("AI_TUTOR_GOOGLE_OAUTH_STATE_SECRET")?;
    Ok(encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

fn validate_state_token(token: &str) -> Result<AuthStateClaims> {
    let secret = required_env("AI_TUTOR_GOOGLE_OAUTH_STATE_SECRET")?;
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let data = decode::<AuthStateClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

fn issue_partial_auth_token(account: &TutorAccount) -> Result<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = PartialAuthClaims {
        sub: account.id.clone(),
        email: account.email.clone(),
        google_id: account.google_id.clone(),
        iat: now as usize,
        exp: (now + partial_auth_ttl_seconds()) as usize,
    };
    let secret = required_env("AI_TUTOR_PARTIAL_AUTH_SECRET")?;
    Ok(encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

fn verify_partial_auth_token(token: &str) -> Result<PartialAuthClaims> {
    let secret = required_env("AI_TUTOR_PARTIAL_AUTH_SECRET")?;
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let data = decode::<PartialAuthClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

fn issue_session_token(account: &TutorAccount) -> Result<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = SessionClaims {
        sub: account.id.clone(),
        email: account.email.clone(),
        status: "active".to_string(),
        iat: now as usize,
        exp: (now + session_ttl_seconds()) as usize,
    };
    let secret = required_env("AI_TUTOR_SESSION_JWT_SECRET")?;
    Ok(encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

async fn verify_jwt_with_jwks<T: serde::de::DeserializeOwned>(
    token: &str,
    jwks_url: &str,
    audiences: &[&str],
    issuers: &[&str],
) -> Result<T> {
    let header = decode_header(token)?;
    let kid = header
        .kid
        .ok_or_else(|| anyhow!("token header missing kid"))?;
    let jwks_body = reqwest::Client::new()
        .get(jwks_url)
        .send()
        .await?
        .text()
        .await
        .map_err(|e| anyhow!("failed to read jwks response body: {}", e))?;
    tracing::info!(jwks_url = %jwks_url, body_len = %jwks_body.len(), "jwks raw response");
    let jwks = serde_json::from_str::<JwksResponse>(&jwks_body)
        .map_err(|e| anyhow!("jwks parse error: {} — body was: {:.200}", e, jwks_body))?;
    let key = jwks
        .keys
        .into_iter()
        .find(|entry| entry.kid == kid)
        .ok_or_else(|| anyhow!("jwks did not include matching kid"))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(audiences);
    validation.set_issuer(issuers);
    let decoding_key = DecodingKey::from_rsa_components(&key.n, &key.e)?;
    let data = decode::<T>(token, &decoding_key, &validation)?;
    Ok(data.claims)
}

fn verify_phone_path() -> String {
    read_optional_env("AI_TUTOR_VERIFY_PHONE_PATH").unwrap_or_else(|| "/verify-phone".to_string())
}

fn auth_success_redirect() -> String {
    read_optional_env("AI_TUTOR_AUTH_SUCCESS_REDIRECT").unwrap_or_else(|| "/dash".to_string())
}

fn ensure_auth_enabled(flag: &str) -> Result<()> {
    if env_flag(flag) {
        Ok(())
    } else {
        Err(anyhow!("auth flag {} is not enabled", flag))
    }
}

fn required_env(key: &str) -> Result<String> {
    read_optional_env(key).ok_or_else(|| anyhow!("missing required env {}", key))
}

fn state_ttl_seconds() -> i64 {
    read_optional_env("AI_TUTOR_OAUTH_STATE_TTL_SECONDS")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(600)
}

fn partial_auth_ttl_seconds() -> i64 {
    read_optional_env("AI_TUTOR_PARTIAL_AUTH_TTL_MINUTES")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|minutes| minutes * 60)
        .unwrap_or(30 * 60)
}

fn session_ttl_seconds() -> i64 {
    read_optional_env("AI_TUTOR_SESSION_TTL_HOURS")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|hours| hours * 3600)
        .unwrap_or(7 * 24 * 3600)
}

fn auth_cookie_enabled() -> bool {
    read_optional_env("AI_TUTOR_SET_AUTH_COOKIES")
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(true)
}

fn auth_redirect_enabled() -> bool {
    read_optional_env("AI_TUTOR_AUTH_REDIRECT")
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn auth_session_cookie_name() -> String {
    read_optional_env("AI_TUTOR_SESSION_COOKIE_NAME")
        .unwrap_or_else(|| "ai_tutor_session".to_string())
}

fn auth_partial_cookie_name() -> String {
    read_optional_env("AI_TUTOR_PARTIAL_COOKIE_NAME")
        .unwrap_or_else(|| "ai_tutor_partial".to_string())
}

fn cookie_domain() -> Option<String> {
    read_optional_env("AI_TUTOR_COOKIE_DOMAIN")
}

fn cookie_same_site() -> String {
    read_optional_env("AI_TUTOR_COOKIE_SAMESITE").unwrap_or_else(|| "Lax".to_string())
}

fn cookie_secure() -> bool {
    read_optional_env("AI_TUTOR_COOKIE_SECURE")
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn build_cookie(name: String, value: &str, max_age_seconds: i64) -> String {
    let mut cookie = format!(
        "{}={}; Path=/; HttpOnly; Max-Age={}",
        name, value, max_age_seconds
    );
    if cookie_secure() {
        cookie.push_str("; Secure");
        cookie.push_str("; SameSite=None");
    } else {
        cookie.push_str(&format!("; SameSite={}", cookie_same_site()));
    }
    if let Some(domain) = cookie_domain() {
        cookie.push_str(&format!("; Domain={}", domain));
    }
    cookie
}

fn credits_required() -> bool {
    env_flag("AI_TUTOR_CREDITS_REQUIRED")
}

fn extract_account_id(headers: &axum::http::HeaderMap) -> Option<String> {
    let token = extract_session_token(headers)?;
    verify_session_token(&token).ok().map(|claims| claims.sub)
}

fn extract_session_token(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(token) = value.trim().strip_prefix("Bearer ") {
            if !token.trim().is_empty() {
                return Some(token.trim().to_string());
            }
        }
    }
    let cookie_name = auth_session_cookie_name();
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    parse_cookie(cookie_header, &cookie_name)
}

fn parse_cookie(header_value: &str, name: &str) -> Option<String> {
    for part in header_value.split(';') {
        let trimmed = part.trim();
        let mut pair = trimmed.splitn(2, '=');
        let key = pair.next()?.trim();
        let value = pair.next()?.trim();
        if key == name && !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn ensure_operator_otp_enabled() -> Result<(), ApiError> {
    if env_flag("AI_TUTOR_OPERATOR_OTP_ENABLED") {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "operator otp authentication is disabled".to_string(),
        ))
    }
}

fn operator_db_path() -> Result<String, ApiError> {
    let storage_root = read_optional_env("AI_TUTOR_STORAGE_ROOT")
        .unwrap_or_else(|| "/tmp/ai-tutor".to_string());
    Ok(format!("{}/runtime/operator-auth.db", storage_root))
}

pub fn init_operator_db() -> Result<(), ApiError> {
    let path = operator_db_path()?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ApiError::internal(format!("failed to create operator db dir: {}", e)))?;
    }
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| ApiError::internal(format!("failed to open operator db: {}", e)))?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS otp_challenges (
            email TEXT PRIMARY KEY,
            otp_hash TEXT NOT NULL,
            expires_at_unix INTEGER NOT NULL,
            attempts_remaining INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL,
            expires_at_unix INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS risk_counters (
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL,
            expires_at_unix INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS operator_sessions (
            session_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            expires_at_unix INTEGER NOT NULL
        );
        "
    ).map_err(|e| ApiError::internal(format!("failed to init operator db schema: {}", e)))?;
    Ok(())
}

fn operator_session_cookie_name() -> String {
    read_optional_env("AI_TUTOR_OPERATOR_SESSION_COOKIE_NAME")
        .unwrap_or_else(|| "ai_tutor_ops_session".to_string())
}

fn operator_otp_ttl_seconds() -> i64 {
    env_i64("AI_TUTOR_OPERATOR_OTP_TTL_SECONDS", 300).max(60)
}

fn operator_otp_request_rate_limit_per_minute() -> i32 {
    env_i64("AI_TUTOR_OPERATOR_OTP_REQUEST_RATE_LIMIT_PER_MINUTE", 5)
        .clamp(3, 20) as i32
}

fn operator_otp_verify_failure_window_seconds() -> i64 {
    env_i64("AI_TUTOR_OPERATOR_OTP_VERIFY_FAILURE_WINDOW_SECONDS", 900)
        .clamp(300, 86_400)
}

fn operator_otp_lockout_window_seconds() -> i64 {
    env_i64("AI_TUTOR_OPERATOR_OTP_LOCKOUT_WINDOW_SECONDS", 1_800)
        .clamp(300, 86_400)
}

fn operator_session_ttl_seconds() -> i64 {
    env_i64("AI_TUTOR_OPERATOR_SESSION_TTL_SECONDS", 1800).max(300)
}

fn operator_otp_max_attempts() -> i32 {
    env_i64("AI_TUTOR_OPERATOR_OTP_MAX_ATTEMPTS", 5)
        .clamp(3, 10) as i32
}

fn operator_otp_secret() -> String {
    read_optional_env("AI_TUTOR_OPERATOR_OTP_SECRET")
        .or_else(|| read_optional_env("AI_TUTOR_API_SECRET"))
        .unwrap_or_else(|| "ai_tutor_operator_otp_secret".to_string())
}

fn normalize_operator_email(value: &str) -> Result<String, ApiError> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() || !normalized.contains('@') || normalized.len() > 255 {
        return Err(ApiError::bad_request(
            "valid operator email is required".to_string(),
        ));
    }
    Ok(normalized)
}

fn operator_name_from_email(email: &str) -> String {
    email
        .split('@')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("operator")
        .to_string()
}

fn operator_email_allowed(email: &str) -> bool {
    let Some(raw) = read_optional_env("AI_TUTOR_OPERATOR_ALLOWED_EMAILS") else {
        return false;
    };
    raw.split(',')
        .map(|value| value.trim().to_ascii_lowercase())
        .any(|value| !value.is_empty() && value == email)
}

fn generate_numeric_otp(length: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| char::from(b'0' + rng.gen_range(0..=9) as u8))
        .collect()
}

fn hash_operator_otp(email: &str, code: &str) -> String {
    let mut hasher = sha2::Sha256::default();
    let payload = format!("{}:{}:{}", email, code, operator_otp_secret());
    sha2::Digest::update(&mut hasher, payload.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn operator_otp_challenge_key(email: &str) -> String {
    format!("ops:otp:challenge:{}", stable_path_key(email))
}

fn operator_otp_rate_limit_key(email: &str) -> String {
    format!("ops:otp:rate:{}", stable_path_key(email))
}

fn operator_otp_verify_failure_key(email: &str) -> String {
    format!("ops:otp:verify-fail:{}", stable_path_key(email))
}

fn operator_otp_lockout_key(email: &str) -> String {
    format!("ops:otp:lockout:{}", stable_path_key(email))
}

fn operator_session_key(session_id: &str) -> String {
    format!("ops:session:{}", session_id)
}

fn resolve_operator_role_for_email(email: &str) -> &'static str {
    if let Some(raw) = read_optional_env("AI_TUTOR_OPERATOR_EMAIL_ROLES") {
        for entry in raw.split(',') {
            let item = entry.trim();
            if item.is_empty() {
                continue;
            }
            let mut pair = item.splitn(2, '=');
            let entry_email = pair.next().unwrap_or_default().trim().to_ascii_lowercase();
            let role_raw = pair.next().unwrap_or("admin").trim();
            if entry_email == email {
                return match parse_api_role(role_raw).unwrap_or(ApiRole::Admin) {
                    ApiRole::Admin => "admin",
                    ApiRole::Writer => "writer",
                    ApiRole::Reader => "reader",
                };
            }
        }
    }
    "admin"
}

async fn enforce_otp_request_rate_limit(email: &str) -> Result<(), ApiError> {
    let db_path = operator_db_path()?;
    let key = operator_otp_rate_limit_key(email);
    let limit = operator_otp_request_rate_limit_per_minute();
    let email_log = email.to_string();

    let count: i64 = tokio::task::spawn_blocking(move || -> Result<i64, ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        let now = chrono::Utc::now().timestamp();
        
        conn.execute("DELETE FROM rate_limits WHERE expires_at_unix < ?", [now])
            .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
            
        let mut count: i64 = 0;
        let _ = conn.query_row("SELECT count FROM rate_limits WHERE key = ?", [&key], |row| {
            count = row.get(0)?;
            Ok(())
        });
        
        count += 1;
        
        if count == 1 {
            conn.execute(
                "INSERT OR REPLACE INTO rate_limits (key, count, expires_at_unix) VALUES (?, ?, ?)", 
                rusqlite::params![&key, count, now + 60]
            ).map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        } else {
            conn.execute(
                "UPDATE rate_limits SET count = ? WHERE key = ?", 
                rusqlite::params![count, &key]
            ).map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        }
        
        Ok(count)
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    if count > i64::from(limit) {
        warn!(
            event = "operator_risk_signal",
            signal = "otp_request_rate_limited",
            email = %email_log,
            request_count = count,
            limit,
            "operator otp request exceeded per-minute threshold"
        );
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "too many otp requests, retry in a minute".to_string(),
        });
    }
    Ok(())
}

async fn bump_operator_risk_counter(
    key: &str,
    ttl_seconds: i64,
) -> Result<i64, ApiError> {
    let db_path = operator_db_path()?;
    let key = key.to_string();

    let count: i64 = tokio::task::spawn_blocking(move || -> Result<i64, ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        let now = chrono::Utc::now().timestamp();
        
        conn.execute("DELETE FROM risk_counters WHERE expires_at_unix < ?", [now])
            .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
            
        let mut count: i64 = 0;
        let _ = conn.query_row("SELECT count FROM risk_counters WHERE key = ?", [&key], |row| {
            count = row.get(0)?;
            Ok(())
        });
        
        count += 1;
        
        if count == 1 {
            conn.execute(
                "INSERT OR REPLACE INTO risk_counters (key, count, expires_at_unix) VALUES (?, ?, ?)", 
                rusqlite::params![&key, count, now + ttl_seconds]
            ).map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        } else {
            conn.execute(
                "UPDATE risk_counters SET count = ? WHERE key = ?", 
                rusqlite::params![count, &key]
            ).map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        }
        
        Ok(count)
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    Ok(count)
}

async fn record_operator_verify_failure(email: &str) -> Result<i64, ApiError> {
    bump_operator_risk_counter(
        &operator_otp_verify_failure_key(email),
        operator_otp_verify_failure_window_seconds(),
    )
    .await
}

async fn record_operator_lockout(email: &str) -> Result<i64, ApiError> {
    bump_operator_risk_counter(
        &operator_otp_lockout_key(email),
        operator_otp_lockout_window_seconds(),
    )
    .await
}

async fn save_operator_otp_challenge(
    email: &str,
    challenge: &OperatorOtpChallenge,
) -> Result<(), ApiError> {
    let db_path = operator_db_path()?;
    let email = email.to_string();
    let otp_hash = challenge.otp_hash.clone();
    let expires_at_unix = challenge.expires_at_unix;
    let attempts_remaining = challenge.attempts_remaining;

    tokio::task::spawn_blocking(move || -> Result<(), ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        conn.execute(
            "INSERT OR REPLACE INTO otp_challenges (email, otp_hash, expires_at_unix, attempts_remaining) VALUES (?, ?, ?, ?)",
            rusqlite::params![&email, &otp_hash, expires_at_unix, attempts_remaining],
        )
        .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    Ok(())
}

async fn load_operator_otp_challenge(
    email: &str,
) -> Result<Option<OperatorOtpChallenge>, ApiError> {
    let db_path = operator_db_path()?;
    let email = email.to_string();

    let challenge = tokio::task::spawn_blocking(move || -> Result<Option<OperatorOtpChallenge>, ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        let now = chrono::Utc::now().timestamp();

        conn.execute("DELETE FROM otp_challenges WHERE expires_at_unix < ?", [now])
            .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;

        let mut hash = String::new();
        let mut expires: i64 = 0;
        let mut attempts: i64 = 0;
        let res = conn.query_row(
            "SELECT otp_hash, expires_at_unix, attempts_remaining FROM otp_challenges WHERE email = ?",
            [&email],
            |row| {
                hash = row.get(0)?;
                expires = row.get(1)?;
                attempts = row.get(2)?;
                Ok(())
            },
        );

        match res {
            Ok(_) => Ok(Some(OperatorOtpChallenge {
                otp_hash: hash,
                expires_at_unix: expires,
                attempts_remaining: attempts as i32,
            })),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(ApiError::internal(format!("db query error: {}", e))),
        }
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    Ok(challenge)
}

async fn delete_operator_otp_challenge(email: &str) -> Result<(), ApiError> {
    let db_path = operator_db_path()?;
    let email = email.to_string();

    tokio::task::spawn_blocking(move || -> Result<(), ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        conn.execute("DELETE FROM otp_challenges WHERE email = ?", [&email])
            .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    Ok(())
}

async fn save_operator_session(
    session_id: &str,
    session: &OperatorSessionState,
) -> Result<(), ApiError> {
    let db_path = operator_db_path()?;
    let session_id = session_id.to_string();
    let payload = serde_json::to_string(session)
        .map_err(|err| ApiError::internal(format!("serialize operator session failed: {err}")))?;
    let expires_at_unix = chrono::Utc::now().timestamp() + operator_session_ttl_seconds();

    tokio::task::spawn_blocking(move || -> Result<(), ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        conn.execute(
            "INSERT OR REPLACE INTO operator_sessions (session_id, payload, expires_at_unix) VALUES (?, ?, ?)",
            rusqlite::params![&session_id, &payload, expires_at_unix],
        )
        .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    Ok(())
}

async fn load_operator_session(
    session_id: &str,
) -> Result<Option<OperatorSessionState>, ApiError> {
    let db_path = operator_db_path()?;
    let session_id = session_id.to_string();
    let ttl_seconds = operator_session_ttl_seconds();

    let session = tokio::task::spawn_blocking(move || -> Result<Option<OperatorSessionState>, ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        let now = chrono::Utc::now().timestamp();

        conn.execute("DELETE FROM operator_sessions WHERE expires_at_unix < ?", [now])
            .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;

        let mut payload = String::new();
        let res = conn.query_row(
            "SELECT payload FROM operator_sessions WHERE session_id = ?",
            [&session_id],
            |row| {
                payload = row.get(0)?;
                Ok(())
            },
        );

        match res {
            Ok(_) => {
                let state = serde_json::from_str::<OperatorSessionState>(&payload)
                    .map_err(|e| ApiError::internal(format!("parse operator session failed: {}", e)))?;
                conn.execute(
                    "UPDATE operator_sessions SET expires_at_unix = ? WHERE session_id = ?",
                    rusqlite::params![now + ttl_seconds, &session_id],
                ).map_err(|e| ApiError::internal(format!("db update session expires error: {}", e)))?;
                Ok(Some(state))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(ApiError::internal(format!("db query error: {}", e))),
        }
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    Ok(session)
}

async fn delete_operator_session(session_id: &str) -> Result<(), ApiError> {
    let db_path = operator_db_path()?;
    let session_id = session_id.to_string();

    tokio::task::spawn_blocking(move || -> Result<(), ApiError> {
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| ApiError::internal(format!("db open error: {}", e)))?;
        conn.execute("DELETE FROM operator_sessions WHERE session_id = ?", [&session_id])
            .map_err(|e| ApiError::internal(format!("db execute error: {}", e)))?;
        Ok(())
    })
    .await
    .map_err(|e| ApiError::internal(format!("task failed: {}", e)))??;

    Ok(())
}

fn stable_path_key(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() * 2);
    for byte in value.as_bytes() {
        use std::fmt::Write as _;
        let _ = write!(&mut encoded, "{byte:02x}");
    }
    encoded
}

/// Check if user has entitlement to generate a lesson
/// Returns Err(ApiError) if user cannot generate (insufficient credits, no subscription, etc.)
async fn check_generation_entitlement(
    state: &AppState,
    auth_context: &AuthenticatedAccountContext,
) -> Result<(), ApiError> {
    let billing_ctx = state
        .service
        .load_billing_context(&auth_context.account_id)
        .await
        .map_err(|err| {
            ApiError::internal(anyhow!(
                "Failed to check generation entitlement: {}",
                err
            ))
        })?;

    // Check if user can generate
    if !billing_ctx.can_generate {
        return Err(ApiError::payment_required(format!(
            "Insufficient credits. Current balance: {}. Please purchase credits or activate a subscription.",
            billing_ctx.credit_balance
        )));
    }

    Ok(())
}

fn inject_account_id(
    mut payload: GenerateLessonPayload,
    account_id: Option<&str>,
) -> GenerateLessonPayload {
    if payload.account_id.is_none() {
        if let Some(account_id) = account_id {
            payload.account_id = Some(account_id.to_string());
        }
    }
    payload
}

fn verify_session_token(token: &str) -> Result<SessionClaims> {
    let secret = required_env("AI_TUTOR_SESSION_JWT_SECRET")?;
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let data = decode::<SessionClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

#[derive(Debug, Clone, Copy)]
struct CreditUsage {
    total: f64,
    base: f64,
    images: f64,
    tts: f64,
}

fn calculate_credit_usage(lesson: &Lesson, policy: &CreditPolicyResponse) -> CreditUsage {
    let scene_count = lesson.scenes.len() as f64;
    let base = scene_count * policy.base_workflow_slide_credits;
    let image_count = count_scene_images(lesson) as f64;
    let images = image_count * policy.image_attachment_credits;
    let tts = if has_tts_audio(lesson) {
        scene_count * policy.tts_per_slide_credits
    } else {
        0.0
    };
    CreditUsage {
        total: base + images + tts,
        base,
        images,
        tts,
    }
}

fn count_scene_images(lesson: &Lesson) -> usize {
    lesson
        .scenes
        .iter()
        .map(|scene| match &scene.content {
            ai_tutor_domain::scene::SceneContent::Slide { canvas } => {
                let element_images = canvas
                    .elements
                    .iter()
                    .filter(|element| {
                        matches!(element, ai_tutor_domain::scene::SlideElement::Image { .. })
                    })
                    .count();
                let background_images = match &canvas.background {
                    Some(ai_tutor_domain::scene::SlideBackground::Image { .. }) => 1,
                    _ => 0,
                };
                element_images + background_images
            }
            _ => 0,
        })
        .sum()
}

fn has_tts_audio(lesson: &Lesson) -> bool {
    lesson
        .scenes
        .iter()
        .flat_map(|scene| scene.actions.iter())
        .any(|action| {
            matches!(
                action,
                ai_tutor_domain::action::LessonAction::Speech {
                    audio_id: Some(_),
                    ..
                } | ai_tutor_domain::action::LessonAction::Speech {
                    audio_url: Some(_),
                    ..
                }
            )
        })
}

fn runtime_native_streaming_required() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn runtime_native_streaming_selectors() -> Vec<String> {
    std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(|segment| segment.trim().to_string())
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn runtime_native_typed_streaming_required() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_TYPED_STREAMING") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn runtime_degraded_single_turn_only() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_DEGRADED_SINGLE_TURN_ONLY") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => true,
    }
}

fn production_hardening_alerts_enabled() -> bool {
    match std::env::var("AI_TUTOR_PRODUCTION_HARDENING_ALERTS") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn ops_gate_strict_mode() -> bool {
    match std::env::var("AI_TUTOR_OPS_GATE_STRICT") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn derive_ops_gate(status: &SystemStatusResponse) -> OpsGateResponse {
    let strict = ops_gate_strict_mode();
    let mut checks = Vec::new();
    let mut add_check = |id: &str, required: bool, passed: bool, detail: String| {
        checks.push(OpsGateCheckResponse {
            id: id.to_string(),
            required,
            passed,
            detail,
        });
    };

    add_check(
        "runtime_alert_level_ok",
        true,
        status.runtime_alert_level == "ok",
        format!("runtime_alert_level={}", status.runtime_alert_level),
    );
    add_check(
        "queue_stale_leases_zero",
        true,
        status.queue_stale_leases == 0,
        format!("queue_stale_leases={}", status.queue_stale_leases),
    );
    add_check(
        "queue_status_error_absent",
        true,
        status
            .queue_status_error
            .as_deref()
            .is_none_or(|value| value.trim().is_empty()),
        format!(
            "queue_status_error={}",
            status
                .queue_status_error
                .as_deref()
                .unwrap_or("<none>")
                .replace('\n', " ")
        ),
    );
    add_check(
        "provider_status_error_absent",
        true,
        status
            .provider_status_error
            .as_deref()
            .is_none_or(|value| value.trim().is_empty()),
        format!(
            "provider_status_error={}",
            status
                .provider_status_error
                .as_deref()
                .unwrap_or("<none>")
                .replace('\n', " ")
        ),
    );

    let auth_enabled = !std::env::var("AI_TUTOR_API_SECRET")
        .unwrap_or_default()
        .trim()
        .is_empty()
        || !std::env::var("AI_TUTOR_API_TOKENS")
            .unwrap_or_default()
            .trim()
            .is_empty();
    add_check(
        "api_auth_configured",
        true,
        auth_enabled,
        if auth_enabled {
            "auth token(s) configured".to_string()
        } else {
            "missing AI_TUTOR_API_SECRET/AI_TUTOR_API_TOKENS".to_string()
        },
    );
    let https_required = matches!(
        std::env::var("AI_TUTOR_REQUIRE_HTTPS")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );
    add_check(
        "https_required",
        true,
        https_required,
        format!("AI_TUTOR_REQUIRE_HTTPS={}", https_required),
    );
    add_check(
        "asset_backend_non_local",
        strict,
        status.asset_backend != "local",
        format!("asset_backend={}", status.asset_backend),
    );
    add_check(
        "queue_backend_sqlite",
        strict,
        status.queue_backend == "sqlite",
        format!("queue_backend={}", status.queue_backend),
    );
    add_check(
        "runtime_backend_sqlite",
        strict,
        status.runtime_session_backend == "sqlite",
        format!("runtime_session_backend={}", status.runtime_session_backend),
    );
    let explicit_worker_id = std::env::var("AI_TUTOR_QUEUE_WORKER_ID")
        .ok()
        .is_some_and(|value| !value.trim().is_empty());
    add_check(
        "queue_worker_id_explicit",
        true,
        explicit_worker_id,
        if explicit_worker_id {
            "AI_TUTOR_QUEUE_WORKER_ID is set".to_string()
        } else {
            "AI_TUTOR_QUEUE_WORKER_ID is missing".to_string()
        },
    );

    let pass = checks.iter().all(|check| !check.required || check.passed);
    OpsGateResponse {
        pass,
        mode: if strict {
            "strict".to_string()
        } else {
            "standard".to_string()
        },
        checks,
    }
}

fn queue_poll_ms() -> u64 {
    std::env::var("AI_TUTOR_QUEUE_POLL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(500)
}

fn asset_backend_label() -> String {
    match std::env::var("AI_TUTOR_ASSET_STORE")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "r2" => "r2".to_string(),
        "local" => "local".to_string(),
        _ if [
            "AI_TUTOR_R2_ENDPOINT",
            "AI_TUTOR_R2_BUCKET",
            "AI_TUTOR_R2_ACCESS_KEY_ID",
            "AI_TUTOR_R2_SECRET_ACCESS_KEY",
            "AI_TUTOR_R2_PUBLIC_BASE_URL",
        ]
        .iter()
        .all(|key| std::env::var(key).ok().is_some()) =>
        {
            "r2".to_string()
        }
        _ => "local".to_string(),
    }
}

fn parse_provider_type(value: &str) -> Option<ai_tutor_domain::provider::ProviderType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "openai" => Some(ai_tutor_domain::provider::ProviderType::OpenAi),
        "anthropic" => Some(ai_tutor_domain::provider::ProviderType::Anthropic),
        "google" => Some(ai_tutor_domain::provider::ProviderType::Google),
        _ => None,
    }
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    fn bad_request(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        error!("AI Tutor API error: {}", error);
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }

    fn not_found(message: String) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
        }
    }

    fn conflict(message: String) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message,
        }
    }

    #[allow(dead_code)]
    fn unauthorized(message: &str) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.to_string(),
        }
    }

    fn payment_required(message: String) -> Self {
        Self {
            status: StatusCode::PAYMENT_REQUIRED,
            message,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(ErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, sync::Mutex};

    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use chrono::{Duration as ChronoDuration, Utc};
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;
    use tower::util::ServiceExt;

    use ai_tutor_domain::{
        generation::{AgentMode, Language, LessonGenerationRequest, UserRequirements},
        job::{
            LessonGenerationJob, LessonGenerationJobInputSummary, LessonGenerationJobResult,
            LessonGenerationJobStatus, LessonGenerationStep,
        },
        lesson::Lesson,
        runtime::{
            AgentTurnSummary, ChatMessage, ClientStageState, DirectorState,
            GeneratedChatAgentConfig, RuntimeMode, RuntimeSessionMode, RuntimeSessionSelector,
            StatelessChatConfig, StatelessChatRequest,
        },
        scene::{Scene, SceneContent, Stage},
    };
    use ai_tutor_providers::{
        factory::{
            DefaultImageProviderFactory, DefaultLlmProviderFactory, DefaultTtsProviderFactory,
            DefaultVideoProviderFactory,
        },
        traits::{
            ImageProvider, LlmProvider, ProviderRuntimeStatus, StreamingPath, TtsProvider,
            VideoProvider, VideoProviderFactory,
        },
    };
    use ai_tutor_storage::filesystem::FileStorage;
    use ai_tutor_storage::repositories::{
        CreditLedgerRepository, DunningCaseRepository, InvoiceLineRepository, InvoiceRepository,
        PaymentIntentRepository, PaymentOrderRepository, RuntimeSessionRepository,
        SubscriptionRepository,
    };

    use super::*;

    struct MockLessonAppService {
        google_login_response: Mutex<Option<GoogleAuthLoginResponse>>,
        auth_session_response: Mutex<Option<AuthSessionResponse>>,
        credit_balance: Mutex<Option<CreditBalanceResponse>>,
        credit_ledger: Mutex<Option<CreditLedgerResponse>>,
        generate_response: Mutex<Option<GenerateLessonResponse>>,
        queued_response: Mutex<Option<GenerateLessonResponse>>,
        cancel_outcome: Mutex<Option<CancelLessonJobOutcome>>,
        resume_outcome: Mutex<Option<ResumeLessonJobOutcome>>,
        chat_events: Mutex<Vec<TutorStreamEvent>>,
        action_acks: Mutex<Vec<RuntimeActionAckRequest>>,
        job: Option<LessonGenerationJob>,
        lesson: Option<Lesson>,
        audio_asset: Option<Vec<u8>>,
        media_asset: Option<Vec<u8>>,
    }

    struct FakeLlmProvider {
        responses: Mutex<Vec<String>>,
    }

    struct FakeLlmProviderFactory;
    struct FakeChatLlmProviderFactory {
        responses: Vec<String>,
    }
    struct DelayedFakeLlmProvider {
        responses: Mutex<Vec<String>>,
        delay_ms: u64,
    }
    struct DelayedFakeLlmProviderFactory {
        responses: Vec<String>,
        delay_ms: u64,
    }
    struct BlockingCancellableFakeLlmProvider {
        started: Arc<Notify>,
        cancelled: Arc<Notify>,
    }
    struct BlockingCancellableFakeLlmProviderFactory {
        started: Arc<Notify>,
        cancelled: Arc<Notify>,
    }

    struct FakeImageProvider;

    struct FakeImageProviderFactory;

    struct FakeVideoProvider;

    struct FakeVideoProviderFactory;

    struct FakeTtsProvider;

    struct FakeTtsProviderFactory;

    #[async_trait]
    impl LessonAppService for MockLessonAppService {
        async fn google_login(&self) -> Result<GoogleAuthLoginResponse> {
            self.google_login_response
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing google login response"))
        }

        async fn google_callback(
            &self,
            _query: GoogleAuthCallbackQuery,
        ) -> Result<AuthSessionResponse> {
            self.auth_session_response
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing auth session response"))
        }

        async fn bind_phone(&self, _payload: BindPhoneRequest) -> Result<AuthSessionResponse> {
            self.auth_session_response
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing auth session response"))
        }

        async fn get_billing_catalog(&self) -> Result<BillingCatalogResponse> {
            Ok(BillingCatalogResponse {
                gateway: "easebuzz".to_string(),
                items: billing_catalog()
                    .into_iter()
                    .map(|item| BillingCatalogItemResponse {
                        product_code: item.product_code,
                        kind: billing_product_kind_label(&item.kind).to_string(),
                        title: item.title,
                        credits: item.credits,
                        currency: item.currency,
                        amount_minor: item.amount_minor,
                    })
                    .collect(),
            })
        }

        async fn create_checkout(
            &self,
            account_id: &str,
            payload: CreateCheckoutRequest,
        ) -> Result<CheckoutSessionResponse> {
            Ok(CheckoutSessionResponse {
                order_id: format!("mock-order-{}", payload.product_code),
                account_id: account_id.to_string(),
                gateway: "easebuzz".to_string(),
                gateway_txn_id: format!("mock-txn-{}", payload.product_code),
                checkout_url: format!(
                    "https://testpay.easebuzz.in/pay/mock-{}",
                    payload.product_code
                ),
            })
        }

        async fn handle_easebuzz_callback(
            &self,
            form_fields: HashMap<String, String>,
        ) -> Result<EasebuzzCallbackResponse> {
            Ok(EasebuzzCallbackResponse {
                order_id: form_fields
                    .get("udf1")
                    .cloned()
                    .unwrap_or_else(|| "mock-order".to_string()),
                status: form_fields
                    .get("status")
                    .cloned()
                    .unwrap_or_else(|| "success".to_string()),
                credited: true,
            })
        }

        async fn list_payment_orders(
            &self,
            account_id: &str,
            _limit: usize,
        ) -> Result<PaymentOrderListResponse> {
            Ok(PaymentOrderListResponse {
                orders: vec![PaymentOrderResponse {
                    id: "mock-order".to_string(),
                    account_id: account_id.to_string(),
                    product_code: "bundle_small".to_string(),
                    kind: "bundle".to_string(),
                    gateway: "easebuzz".to_string(),
                    gateway_txn_id: "mock-txn".to_string(),
                    gateway_payment_id: Some("mock-payment".to_string()),
                    status: "succeeded".to_string(),
                    currency: billing_currency(),
                    amount_minor: 500,
                    credits_to_grant: credit_policy().bundle_small_credits,
                    checkout_url: Some("https://testpay.easebuzz.in/pay/mock".to_string()),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: Some(chrono::Utc::now().to_rfc3339()),
                }],
            })
        }

        async fn get_billing_report(&self) -> Result<BillingReportResponse> {
            Ok(BillingReportResponse {
                gateway: "easebuzz".to_string(),
                gateway_currency: billing_currency(),
                total_payment_orders: 1,
                successful_payment_orders: 1,
                failed_payment_orders: 0,
                pending_payment_orders: 0,
                paid_credits_granted: credit_policy().bundle_small_credits,
                lesson_credits_debited: 0.0,
                provider_estimated_total_cost_microusd: 0,
                provider_reported_total_cost_microusd: 0,
            })
        }

        async fn get_billing_dashboard(
            &self,
            account_id: &str,
        ) -> Result<BillingDashboardResponse> {
            Ok(BillingDashboardResponse {
                entitlement: BillingEntitlementResponse {
                    account_id: account_id.to_string(),
                    credit_balance: 100.0,
                    can_generate: true,
                    has_active_subscription: true,
                    active_subscription: self.get_subscription(account_id).await?.subscription,
                    blocking_unpaid_invoice_count: 0,
                    active_dunning_case_count: 0,
                },
                recent_orders: self.list_payment_orders(account_id, 10).await?.orders,
                recent_ledger_entries: self.get_credit_ledger(account_id, 10).await?.entries,
                recent_invoices: Vec::new(),
            })
        }

        async fn get_credit_balance(&self, _account_id: &str) -> Result<CreditBalanceResponse> {
            self.credit_balance
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing credit balance response"))
        }

        async fn get_credit_ledger(
            &self,
            _account_id: &str,
            _limit: usize,
        ) -> Result<CreditLedgerResponse> {
            self.credit_ledger
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing credit ledger response"))
        }

        async fn redeem_promo_code(
            &self,
            _account_id: &str,
            _code: &str,
        ) -> Result<RedeemPromoCodeResponse> {
            // Mock implementation
            Ok(RedeemPromoCodeResponse {
                success: true,
                message: "Promo code redeemed successfully".to_string(),
                credits_granted: 3.0,
            })
        }

        async fn load_billing_context(&self, _account_id: &str) -> Result<BillingContext> {
            // Mock implementation: return a default billing context with credits
            Ok(BillingContext::new(100.0, None))
        }

            async fn create_subscription(
                &self,
                account_id: &str,
                payload: CreateSubscriptionRequest,
            ) -> Result<SubscriptionResponse> {
                Ok(SubscriptionResponse {
                    id: format!("mock-sub-{}", payload.plan_code),
                    account_id: account_id.to_string(),
                    plan_code: payload.plan_code,
                    status: "active".to_string(),
                    billing_interval: "monthly".to_string(),
                    credits_per_cycle: 100.0,
                    autopay_enabled: true,
                    current_period_start: chrono::Utc::now().to_rfc3339(),
                    current_period_end: (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339(),
                    next_renewal_at: Some((chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339()),
                    grace_period_until: None,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                })
            }

            async fn get_subscription(&self, account_id: &str) -> Result<SubscriptionListResponse> {
                Ok(SubscriptionListResponse {
                    subscription: Some(SubscriptionResponse {
                        id: "mock-sub-premium".to_string(),
                        account_id: account_id.to_string(),
                        plan_code: "plan_premium".to_string(),
                        status: "active".to_string(),
                        billing_interval: "monthly".to_string(),
                        credits_per_cycle: 500.0,
                        autopay_enabled: true,
                        current_period_start: chrono::Utc::now().to_rfc3339(),
                        current_period_end: (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339(),
                        next_renewal_at: Some((chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339()),
                        grace_period_until: None,
                        created_at: chrono::Utc::now().to_rfc3339(),
                        updated_at: chrono::Utc::now().to_rfc3339(),
                    }),
                })
            }

            async fn cancel_subscription(
                &self,
                _account_id: &str,
                subscription_id: &str,
                _payload: CancelSubscriptionRequest,
            ) -> Result<CancelSubscriptionResponse> {
                Ok(CancelSubscriptionResponse {
                    id: subscription_id.to_string(),
                    status: "cancelled".to_string(),
                    cancelled_at: chrono::Utc::now().to_rfc3339(),
                })
            }

            async fn get_admin_user_stats(&self) -> Result<AdminUserStatsResponse> {
                Ok(AdminUserStatsResponse {
                    total_users: 1250,
                    active_users_today: 145,
                    active_users_week: 680,
                    active_users_month: 980,
                    new_users_today: 12,
                    new_users_week: 78,
                })
            }

            async fn get_admin_subscription_stats(&self) -> Result<AdminSubscriptionStatsResponse> {
                Ok(AdminSubscriptionStatsResponse {
                    total_subscriptions: 320,
                    active_subscriptions: 285,
                    cancelled_subscriptions: 35,
                    churned_users_month: 8,
                    revenue_monthly: 28500.0,
                    revenue_rolling_30d: 29250.0,
                })
            }

            async fn get_admin_payment_stats(&self) -> Result<AdminPaymentStatsResponse> {
                Ok(AdminPaymentStatsResponse {
                    total_payments: 450,
                    successful_payments: 425,
                    failed_payments: 25,
                    success_rate: 0.944,
                    total_revenue: 42750.0,
                    average_transaction_value: 95.0,
                })
            }

            async fn get_admin_promo_code_stats(&self) -> Result<AdminPromoCodeStatsResponse> {
                Ok(AdminPromoCodeStatsResponse {
                    total_promo_codes: 15,
                    active_promo_codes: 8,
                    total_redemptions: 342,
                    total_credits_granted: 1026.0,
                    average_redemption_rate: 0.76,
                })
            }

            async fn get_admin_users(&self) -> Result<AdminUsersListResponse> {
                Ok(AdminUsersListResponse { users: vec![] })
            }

            async fn get_admin_settings(&self) -> Result<AdminSettingsResponse> {
                Ok(AdminSettingsResponse {
                    operator_roles: "mock@ai-tutor.local=admin".to_string(),
                    api_base_url: "http://localhost:8099".to_string(),
                })
            }

        async fn generate_lesson(
            &self,
            _payload: GenerateLessonPayload,
        ) -> Result<GenerateLessonResponse> {
            self.generate_response
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing generate response"))
        }

        async fn get_job(&self, _id: &str) -> Result<Option<LessonGenerationJob>> {
            Ok(self.job.clone())
        }

        async fn queue_lesson(
            &self,
            _payload: GenerateLessonPayload,
        ) -> Result<GenerateLessonResponse> {
            self.queued_response
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing queued response"))
        }

        async fn list_lesson_shelf(
            &self,
            _account_id: &str,
            status: Option<String>,
            _limit: usize,
        ) -> Result<LessonShelfListResponse> {
            let status = status.unwrap_or_else(|| "ready".to_string());
            Ok(LessonShelfListResponse {
                items: vec![LessonShelfItemResponse {
                    id: "shelf-1".to_string(),
                    lesson_id: "lesson-1".to_string(),
                    source_job_id: Some("job-shelf-1".to_string()),
                    title: "Mock Shelf Lesson".to_string(),
                    subject: Some("math".to_string()),
                    language: Some("english".to_string()),
                    status,
                    progress_pct: 42,
                    last_opened_at: None,
                    archived_at: None,
                    thumbnail_url: None,
                    failure_reason: None,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                }],
            })
        }

        async fn patch_lesson_shelf_item(
            &self,
            _account_id: &str,
            item_id: &str,
            patch: LessonShelfPatchRequest,
        ) -> Result<LessonShelfItemResponse> {
            Ok(LessonShelfItemResponse {
                id: item_id.to_string(),
                lesson_id: "lesson-1".to_string(),
                source_job_id: Some("job-shelf-1".to_string()),
                title: patch
                    .title
                    .unwrap_or_else(|| "Mock Shelf Lesson".to_string()),
                subject: Some("math".to_string()),
                language: Some("english".to_string()),
                status: patch.status.unwrap_or_else(|| "ready".to_string()),
                progress_pct: patch.progress_pct.unwrap_or(42),
                last_opened_at: None,
                archived_at: None,
                thumbnail_url: None,
                failure_reason: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
            })
        }

        async fn archive_lesson_shelf_item(
            &self,
            _account_id: &str,
            item_id: &str,
        ) -> Result<LessonShelfItemResponse> {
            Ok(LessonShelfItemResponse {
                id: item_id.to_string(),
                lesson_id: "lesson-1".to_string(),
                source_job_id: Some("job-shelf-1".to_string()),
                title: "Mock Shelf Lesson".to_string(),
                subject: Some("math".to_string()),
                language: Some("english".to_string()),
                status: "archived".to_string(),
                progress_pct: 100,
                last_opened_at: None,
                archived_at: Some(chrono::Utc::now().to_rfc3339()),
                thumbnail_url: None,
                failure_reason: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
            })
        }

        async fn reopen_lesson_shelf_item(
            &self,
            _account_id: &str,
            item_id: &str,
        ) -> Result<LessonShelfItemResponse> {
            Ok(LessonShelfItemResponse {
                id: item_id.to_string(),
                lesson_id: "lesson-1".to_string(),
                source_job_id: Some("job-shelf-1".to_string()),
                title: "Mock Shelf Lesson".to_string(),
                subject: Some("math".to_string()),
                language: Some("english".to_string()),
                status: "ready".to_string(),
                progress_pct: 100,
                last_opened_at: None,
                archived_at: None,
                thumbnail_url: None,
                failure_reason: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
            })
        }

        async fn retry_lesson_shelf_item(
            &self,
            _account_id: &str,
            item_id: &str,
        ) -> Result<LessonShelfItemResponse> {
            Ok(LessonShelfItemResponse {
                id: item_id.to_string(),
                lesson_id: "lesson-1".to_string(),
                source_job_id: Some("job-shelf-1".to_string()),
                title: "Mock Shelf Lesson".to_string(),
                subject: Some("math".to_string()),
                language: Some("english".to_string()),
                status: "generating".to_string(),
                progress_pct: 0,
                last_opened_at: None,
                archived_at: None,
                thumbnail_url: None,
                failure_reason: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
            })
        }

        async fn mark_lesson_shelf_opened(
            &self,
            _account_id: &str,
            lesson_id: &str,
            item_id: Option<&str>,
        ) -> Result<LessonShelfItemResponse> {
            Ok(LessonShelfItemResponse {
                id: item_id.unwrap_or("shelf-1").to_string(),
                lesson_id: lesson_id.to_string(),
                source_job_id: Some("job-shelf-1".to_string()),
                title: "Mock Shelf Lesson".to_string(),
                subject: Some("math".to_string()),
                language: Some("english".to_string()),
                status: "ready".to_string(),
                progress_pct: 50,
                last_opened_at: Some(chrono::Utc::now().to_rfc3339()),
                archived_at: None,
                thumbnail_url: None,
                failure_reason: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                updated_at: chrono::Utc::now().to_rfc3339(),
            })
        }

        async fn cancel_job(&self, _id: &str) -> Result<CancelLessonJobOutcome> {
            self.cancel_outcome
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing cancel outcome"))
        }

        async fn resume_job(&self, _id: &str) -> Result<ResumeLessonJobOutcome> {
            self.resume_outcome
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing resume outcome"))
        }

        async fn stateless_chat(
            &self,
            _payload: StatelessChatRequest,
        ) -> Result<Vec<TutorStreamEvent>> {
            Ok(self.chat_events.lock().unwrap().clone())
        }

        async fn stateless_chat_stream(
            &self,
            _payload: StatelessChatRequest,
            sender: mpsc::Sender<TutorStreamEvent>,
        ) -> Result<()> {
            let events = self.chat_events.lock().unwrap().clone();
            for event in events {
                if sender.send(event).await.is_err() {
                    break;
                }
            }
            Ok(())
        }

        async fn get_lesson(&self, _id: &str) -> Result<Option<Lesson>> {
            Ok(self.lesson.clone())
        }

        async fn get_audio_asset(
            &self,
            _lesson_id: &str,
            _file_name: &str,
        ) -> Result<Option<Vec<u8>>> {
            Ok(self.audio_asset.clone())
        }

        async fn get_media_asset(
            &self,
            _lesson_id: &str,
            _file_name: &str,
        ) -> Result<Option<Vec<u8>>> {
            Ok(self.media_asset.clone())
        }

        async fn acknowledge_runtime_action(
            &self,
            payload: RuntimeActionAckRequest,
        ) -> Result<RuntimeActionAckResponse> {
            self.action_acks.lock().unwrap().push(payload);
            Ok(RuntimeActionAckResponse {
                accepted: true,
                duplicate: false,
                current_status: "completed".to_string(),
            })
        }

        async fn runtime_pbl_chat(
            &self,
            _payload: PblRuntimeChatRequest,
        ) -> Result<PblRuntimeChatResponse> {
            Ok(PblRuntimeChatResponse {
                messages: vec![PblRuntimeChatMessage {
                    kind: "agent".to_string(),
                    agent_name: "Question Agent".to_string(),
                    message: "Let's break the issue into the next concrete step.".to_string(),
                }],
                workspace: None,
                resolved_agent: "Question Agent".to_string(),
            })
        }

        async fn get_system_status(&self) -> Result<SystemStatusResponse> {
            Ok(SystemStatusResponse {
                status: "ok",
                current_model: Some("openai:gpt-4o-mini".to_string()),
                deployment_environment: "test".to_string(),
                deployment_revision: Some("rev-test".to_string()),
                rollout_phase: "stable".to_string(),
                generation_model_policy: GenerationModelPolicyResponse {
                    outlines_model: "openrouter:google/gemini-2.5-flash".to_string(),
                    scene_content_model: "openrouter:openai/gpt-4o-mini".to_string(),
                    scene_actions_model: "openrouter:openai/gpt-4o-mini".to_string(),
                    scene_actions_fallback_model: None,
                },
                selected_model_profile: Some(SelectedModelProfileResponse {
                    provider_id: "openai".to_string(),
                    provider_name: "OpenAI".to_string(),
                    model_id: "gpt-4o-mini".to_string(),
                    model_name: Some("GPT-4o Mini".to_string()),
                    context_window: Some(128_000),
                    output_window: Some(4_096),
                    cost_tier: Some("economy".to_string()),
                    input_cost_per_1m_usd: None,
                    output_cost_per_1m_usd: None,
                    supports_tools: true,
                    supports_vision: true,
                    supports_thinking: false,
                }),
                auth_blueprint: AuthBlueprintStatusResponse {
                    google_oauth_enabled: false,
                    google_client_id_configured: false,
                    google_client_secret_configured: false,
                    google_redirect_uri: None,
                    firebase_phone_auth_enabled: false,
                    firebase_project_id: None,
                    partial_auth_secret_configured: false,
                    verify_phone_path: "/verify-phone".to_string(),
                },
                deployment_blueprint: DeploymentBlueprintResponse {
                    frontend_output_mode: "standalone".to_string(),
                    frontend_deployment_mode: "containerized".to_string(),
                    recommended_targets: vec![
                        "cloud_run".to_string(),
                        "hetzner_coolify".to_string(),
                        "aws".to_string(),
                    ],
                    vercel_recommended: false,
                },
                credit_policy: CreditPolicyResponse {
                    base_workflow_slide_credits: 0.10,
                    image_attachment_credits: 0.05,
                    tts_per_slide_credits: 0.20,
                    starter_grant_credits: 10.0,
                    plus_monthly_price_usd: 5.0,
                    plus_monthly_credits: 30.0,
                    pro_monthly_price_usd: 12.0,
                    pro_monthly_credits: 80.0,
                    bundle_small_price_usd: 2.0,
                    bundle_small_credits: 10.0,
                    bundle_large_price_usd: 10.0,
                    bundle_large_credits: 65.0,
                    tts_margin_review_required: false,
                },
                configured_provider_priority: vec!["openai".to_string()],
                runtime_session_modes: vec![
                    "stateless_client_state".to_string(),
                    "managed_runtime_session".to_string(),
                ],
                runtime_native_streaming_required: false,
                runtime_native_streaming_selectors: vec![],
                runtime_native_typed_streaming_required: false,
                runtime_degraded_single_turn_only: true,
                runtime_alert_level: "ok".to_string(),
                runtime_alerts: vec![],
                asset_backend: "local".to_string(),
                queue_backend: "file".to_string(),
                lesson_backend: "file".to_string(),
                job_backend: "file".to_string(),
                runtime_session_backend: "file".to_string(),
                queue_pending_jobs: 0,
                queue_active_leases: 0,
                queue_stale_leases: 0,
                queue_status_error: None,
                queue_poll_ms: queue_poll_ms(),
                queue_claim_heartbeat_interval_ms: claim_heartbeat_interval_ms(),
                queue_stale_timeout_ms: stale_working_timeout_ms(),
                provider_total_requests: 0,
                provider_total_successes: 0,
                provider_total_failures: 0,
                provider_total_latency_ms: 0,
                provider_average_latency_ms: None,
                provider_estimated_input_tokens: 0,
                provider_estimated_output_tokens: 0,
                provider_estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                provider_runtime: vec![],
                provider_status_error: None,
            })
        }
    }

    #[async_trait]
    impl LlmProvider for FakeLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("missing fake llm response"));
            }
            Ok(responses.remove(0))
        }

        fn streaming_path(&self) -> StreamingPath {
            StreamingPath::Native
        }

        fn capabilities(&self) -> ai_tutor_providers::traits::ProviderCapabilities {
            ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed()
        }

        fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
            vec![ProviderRuntimeStatus {
                label: "fake:healthy".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: 0,
                average_latency_ms: Some(20),
                last_latency_ms: Some(20),
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities:
                    ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            }]
        }
    }

    impl LlmProviderFactory for FakeLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(FakeLlmProvider {
                responses: Mutex::new(vec![
                    r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is","Parts of a fraction"],"scene_type":"slide","media_generations":[{"element_id":"gen_img_1","media_type":"image","prompt":"A pizza cut into fractions","aspect_ratio":"16:9"}]},{"title":"Fraction Quiz","description":"Check learning","key_points":["Identify numerator"],"scene_type":"quiz"}]}"#.to_string(),
                    r#"{"elements":[{"kind":"text","content":"Fractions represent parts of a whole.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"A fraction shows part of a whole."}]}"#.to_string(),
                    r#"{"questions":[{"question":"What part names the top number in a fraction?","options":["Numerator","Denominator","Whole","Decimal"],"answer":["Numerator"]}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"Now let's check what you learned."}]}"#.to_string(),
                ]),
            }))
        }
    }

    impl LlmProviderFactory for FakeChatLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(FakeLlmProvider {
                responses: Mutex::new(self.responses.clone()),
            }))
        }
    }

    #[async_trait]
    impl LlmProvider for DelayedFakeLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            tokio::time::sleep(std::time::Duration::from_millis(self.delay_ms)).await;
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("missing delayed fake llm response"));
            }
            Ok(responses.remove(0))
        }

        fn streaming_path(&self) -> StreamingPath {
            StreamingPath::Native
        }

        fn capabilities(&self) -> ai_tutor_providers::traits::ProviderCapabilities {
            ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed()
        }

        fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
            vec![ProviderRuntimeStatus {
                label: "fake:delayed".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: self.delay_ms,
                average_latency_ms: Some(self.delay_ms),
                last_latency_ms: Some(self.delay_ms),
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities:
                    ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            }]
        }
    }

    impl LlmProviderFactory for DelayedFakeLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(DelayedFakeLlmProvider {
                responses: Mutex::new(self.responses.clone()),
                delay_ms: self.delay_ms,
            }))
        }
    }

    #[async_trait]
    impl LlmProvider for BlockingCancellableFakeLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok("unused".to_string())
        }

        async fn generate_stream_events_with_history_cancellable(
            &self,
            _messages: &[(String, String)],
            cancellation: &CancellationToken,
            _on_event: &mut (dyn FnMut(ai_tutor_providers::traits::ProviderStreamEvent) + Send),
        ) -> Result<String> {
            self.started.notify_waiters();
            cancellation.cancelled().await;
            self.cancelled.notify_waiters();
            Err(anyhow!("stream cancelled"))
        }

        fn streaming_path(&self) -> StreamingPath {
            StreamingPath::Native
        }

        fn capabilities(&self) -> ai_tutor_providers::traits::ProviderCapabilities {
            ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed()
        }

        fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
            vec![ProviderRuntimeStatus {
                label: "fake:blocking-cancellable".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: 0,
                average_latency_ms: Some(10),
                last_latency_ms: Some(10),
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities:
                    ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            }]
        }
    }

    impl LlmProviderFactory for BlockingCancellableFakeLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(BlockingCancellableFakeLlmProvider {
                started: Arc::clone(&self.started),
                cancelled: Arc::clone(&self.cancelled),
            }))
        }
    }

    #[async_trait]
    impl ImageProvider for FakeImageProvider {
        async fn generate_image(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            Ok("data:image/png;base64,ZmFrZQ==".to_string())
        }
    }

    impl ImageProviderFactory for FakeImageProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn ImageProvider>> {
            Ok(Box::new(FakeImageProvider))
        }
    }

    #[async_trait]
    impl VideoProvider for FakeVideoProvider {
        async fn generate_video(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            Ok("data:video/mp4;base64,ZmFrZQ==".to_string())
        }
    }

    impl VideoProviderFactory for FakeVideoProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn VideoProvider>> {
            Ok(Box::new(FakeVideoProvider))
        }
    }

    #[async_trait]
    impl TtsProvider for FakeTtsProvider {
        async fn synthesize(
            &self,
            _text: &str,
            _voice: Option<&str>,
            _speed: Option<f32>,
        ) -> Result<String> {
            Ok("data:audio/mpeg;base64,ZmFrZQ==".to_string())
        }
    }

    impl TtsProviderFactory for FakeTtsProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn TtsProvider>> {
            Ok(Box::new(FakeTtsProvider))
        }
    }

    fn sample_job() -> LessonGenerationJob {
        let request = LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
                web_search: Some(false),
            },
            pdf_content: None,
            enable_web_search: false,
            enable_image_generation: false,
            enable_video_generation: false,
            enable_tts: false,
            agent_mode: AgentMode::Default,
            account_id: None,
            generation_mode: None,
        };
        let now = Utc::now();
        LessonGenerationJob {
            id: "job-1".to_string(),
            status: LessonGenerationJobStatus::Succeeded,
            step: LessonGenerationStep::Completed,
            progress: 100,
            message: "done".to_string(),
            input_summary: LessonGenerationJobInputSummary::from(&request),
            scenes_generated: 2,
            total_scenes: Some(2),
            result: Some(LessonGenerationJobResult {
                lesson_id: "lesson-1".to_string(),
                url: "http://localhost:8099/lessons/lesson-1".to_string(),
                scenes_count: 2,
            }),
            error: None,
            created_at: now,
            updated_at: now,
            started_at: Some(now),
            completed_at: Some(now),
        }
    }

    fn sample_lesson() -> Lesson {
        let now = Utc::now();
        Lesson {
            id: "lesson-1".to_string(),
            title: "Fractions".to_string(),
            language: "en-US".to_string(),
            description: Some("Teach fractions".to_string()),
            stage: Some(Stage {
                id: "stage-1".to_string(),
                name: "Fractions".to_string(),
                description: Some("Stage".to_string()),
                created_at: now.timestamp_millis(),
                updated_at: now.timestamp_millis(),
                language: Some("en-US".to_string()),
                style: Some("interactive".to_string()),
                whiteboard: vec![],
                agent_ids: vec![],
                generated_agent_configs: vec![],
            }),
            scenes: vec![],
            style: Some("interactive".to_string()),
            agent_ids: vec![],
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_runtime_scene() -> Scene {
        Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Fractions discussion".to_string(),
            order: 1,
            content: SceneContent::Quiz { questions: vec![] },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn sample_project_config() -> ProjectConfig {
        ProjectConfig {
            summary: "Build a classroom recycling improvement plan".to_string(),
            title: Some("Recycling Project".to_string()),
            driving_question: Some("How can we reduce waste in our classroom?".to_string()),
            final_deliverable: Some("A proposal and implementation checklist".to_string()),
            target_skills: Some(vec!["research".to_string(), "planning".to_string()]),
            milestones: Some(vec!["audit".to_string(), "proposal".to_string()]),
            team_roles: Some(vec!["Research Lead".to_string(), "Presenter".to_string()]),
            assessment_focus: None,
            starter_prompt: Some("Start by inspecting the current recycling flow.".to_string()),
            success_criteria: Some(vec![
                "Evidence is cited".to_string(),
                "Proposal is feasible".to_string(),
            ]),
            facilitator_notes: Some(vec!["Push for measurable outcomes.".to_string()]),
            agent_roles: Some(vec![
                ProjectAgentRole {
                    name: "Research Lead".to_string(),
                    responsibility: "Gather evidence about current classroom waste.".to_string(),
                    deliverable: Some("Waste audit summary".to_string()),
                },
                ProjectAgentRole {
                    name: "Presenter".to_string(),
                    responsibility: "Turn findings into a persuasive proposal.".to_string(),
                    deliverable: Some("Presentation deck".to_string()),
                },
            ]),
            issue_board: Some(vec![
                ai_tutor_domain::scene::ProjectIssue {
                    title: "Audit current waste".to_string(),
                    description: "Identify what is being thrown away and why.".to_string(),
                    owner_role: Some("Research Lead".to_string()),
                    checkpoints: vec![
                        "Collect examples".to_string(),
                        "Summarize patterns".to_string(),
                    ],
                },
                ai_tutor_domain::scene::ProjectIssue {
                    title: "Prepare proposal".to_string(),
                    description: "Create the improvement proposal.".to_string(),
                    owner_role: Some("Presenter".to_string()),
                    checkpoints: vec!["Draft recommendations".to_string()],
                },
            ]),
        }
    }

    fn sample_pbl_runtime_chat_request() -> PblRuntimeChatRequest {
        PblRuntimeChatRequest {
            message: "@question What should I do first?".to_string(),
            project_config: sample_project_config(),
            workspace: PblRuntimeWorkspaceState {
                active_issue_id: Some("issue-1".to_string()),
                issues: vec![
                    PblRuntimeIssueState {
                        id: "issue-1".to_string(),
                        title: "Audit current waste".to_string(),
                        description: "Identify what is being thrown away and why.".to_string(),
                        owner_role: Some("Research Lead".to_string()),
                        checkpoints: vec![
                            "Collect examples".to_string(),
                            "Summarize patterns".to_string(),
                        ],
                        completed_checkpoint_ids: vec![],
                        done: false,
                    },
                    PblRuntimeIssueState {
                        id: "issue-2".to_string(),
                        title: "Prepare proposal".to_string(),
                        description: "Create the improvement proposal.".to_string(),
                        owner_role: Some("Presenter".to_string()),
                        checkpoints: vec!["Draft recommendations".to_string()],
                        completed_checkpoint_ids: vec![],
                        done: false,
                    },
                ],
            },
            recent_messages: vec![PblRuntimeChatMessage {
                kind: "user".to_string(),
                agent_name: "Research Lead".to_string(),
                message: "I inspected the bins yesterday.".to_string(),
            }],
            user_role: "Research Lead".to_string(),
            session_id: Some("project-scene-1".to_string()),
        }
    }

    fn sample_agent_config(
        id: &str,
        name: &str,
        role: &str,
        persona: &str,
        priority: i32,
        bound_stage_id: Option<&str>,
    ) -> GeneratedChatAgentConfig {
        GeneratedChatAgentConfig {
            id: id.to_string(),
            name: name.to_string(),
            role: role.to_string(),
            persona: persona.to_string(),
            avatar: "agent".to_string(),
            color: "#21614e".to_string(),
            allowed_actions: vec!["speech".to_string(), "discussion".to_string()],
            priority,
            is_generated: Some(true),
            bound_stage_id: bound_stage_id.map(|value| value.to_string()),
        }
    }

    fn sample_stateless_chat_request() -> StatelessChatRequest {
        StatelessChatRequest {
            session_id: None,
            runtime_session: Some(RuntimeSessionSelector {
                mode: RuntimeSessionMode::StatelessClientState,
                session_id: None,
                create_if_missing: None,
            }),
            messages: vec![ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: "Explain fractions with a simple example".to_string(),
                metadata: None,
            }],
            store_state: ClientStageState {
                stage: None,
                scenes: vec![sample_runtime_scene()],
                current_scene_id: Some("scene-1".to_string()),
                mode: RuntimeMode::Live,
                whiteboard_open: false,
            },
            config: StatelessChatConfig {
                agent_ids: vec![
                    "teacher-1".to_string(),
                    "student-1".to_string(),
                    "assistant-1".to_string(),
                ],
                session_type: Some("discussion".to_string()),
                discussion_topic: Some("fractions".to_string()),
                discussion_prompt: Some("Explain fractions with a pizza example".to_string()),
                trigger_agent_id: Some("teacher-1".to_string()),
                agent_configs: vec![
                    sample_agent_config(
                        "teacher-1",
                        "Ms. Rivera",
                        "teacher",
                        "Math teacher who uses clear examples",
                        1,
                        Some("stage-1"),
                    ),
                    sample_agent_config(
                        "student-1",
                        "Asha",
                        "student",
                        "Curious student who asks clarifying questions",
                        2,
                        Some("stage-1"),
                    ),
                    sample_agent_config(
                        "assistant-1",
                        "Board Helper",
                        "assistant",
                        "Assistant who summarizes and organizes concepts",
                        3,
                        None,
                    ),
                ],
            },
            director_state: None,
            user_profile: None,
            api_key: "test-key".to_string(),
            base_url: None,
            model: Some("openai:gpt-4o-mini".to_string()),
            provider_type: Some("openai".to_string()),
            requires_api_key: Some(true),
        }
    }

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-tutor-api-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn build_live_service(storage: Arc<FileStorage>) -> Arc<dyn LessonAppService> {
        let provider_config = Arc::new(ServerProviderConfig::default());
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::clone(&provider_config),
            Arc::new(DefaultLlmProviderFactory::new((*provider_config).clone())),
            Arc::new(DefaultImageProviderFactory::new((*provider_config).clone())),
            Arc::new(DefaultVideoProviderFactory::new((*provider_config).clone())),
            Arc::new(DefaultTtsProviderFactory::new((*provider_config).clone())),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_service_with_fakes(storage: Arc<FileStorage>) -> Arc<dyn LessonAppService> {
        build_live_service_with_fakes_and_queue(
            storage,
            std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok(),
        )
    }

    fn build_live_service_with_fakes_and_queue(
        storage: Arc<FileStorage>,
        queue_db_path: Option<String>,
    ) -> Arc<dyn LessonAppService> {
        Arc::new(
            LiveLessonAppService::new(
                storage,
                Arc::new(ServerProviderConfig {
                    providers: std::collections::HashMap::from([(
                        "openai".to_string(),
                        ai_tutor_providers::config::ServerProviderEntry {
                            api_key: Some("test-key".to_string()),
                            base_url: Some("https://example.test/v1".to_string()),
                            proxy: None,
                            models: vec![],
                            transport_override: None,
                            pricing_override: None,
                        },
                    )]),
                    ..Default::default()
                }),
                Arc::new(FakeLlmProviderFactory),
                Arc::new(FakeImageProviderFactory),
                Arc::new(FakeVideoProviderFactory),
                Arc::new(FakeTtsProviderFactory),
                "http://localhost:8099".to_string(),
            )
            .with_queue_db_path(queue_db_path),
        )
    }

    fn build_live_service_with_delayed_fakes(
        storage: Arc<FileStorage>,
        delay_ms: u64,
    ) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(DelayedFakeLlmProviderFactory {
                responses: vec![
                    r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
                    r#"{"elements":[{"kind":"text","content":"Fractions represent parts of a whole.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"A fraction shows part of a whole."}]}"#.to_string(),
                ],
                delay_ms,
            }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_chat_service_with_response(
        storage: Arc<FileStorage>,
        responses: Vec<String>,
    ) -> Arc<dyn LessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(FakeChatLlmProviderFactory { responses }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_chat_service_with_response_concrete(
        storage: Arc<FileStorage>,
        responses: Vec<String>,
    ) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(FakeChatLlmProviderFactory { responses }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_chat_service_with_blocking_cancellable_provider(
        storage: Arc<FileStorage>,
        started: Arc<Notify>,
        cancelled: Arc<Notify>,
    ) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(BlockingCancellableFakeLlmProviderFactory { started, cancelled }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    #[tokio::test]
    async fn live_service_stateless_chat_runs_multi_turn_discussion_loop() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let payload = sample_stateless_chat_request();

        let events = service.stateless_chat(payload).await.unwrap();
        let selected_count = events
            .iter()
            .filter(|event| matches!(event.kind, TutorEventKind::AgentSelected))
            .count();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("director state should be returned on done");

        assert!(selected_count >= 1);
        assert!(final_state.turn_count >= 1);
        assert_eq!(final_state.agent_responses.len(), final_state.turn_count as usize);
    }

    #[tokio::test]
    async fn live_service_stateless_chat_emits_cue_user_for_discussion_sessions() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let payload = sample_stateless_chat_request();

        let events = service.stateless_chat(payload).await.unwrap();
        let cue_user = events
            .iter()
            .find(|event| matches!(event.kind, TutorEventKind::CueUser));

        assert!(cue_user.is_some());
        assert!(cue_user
            .and_then(|event| event.message.as_ref())
            .is_some_and(|message| message.contains("Ask a follow-up")));
    }

    #[tokio::test]
    async fn live_service_stateless_chat_reuses_client_supplied_director_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![
                r#"[{"type":"text","content":"Using the client tutor runtime state."}]"#
                    .to_string(),
                r#"[{"type":"text","content":"Continuing from the passed discussion context."}]"#
                    .to_string(),
            ],
        );

        let mut payload = sample_stateless_chat_request();
        payload.session_id = Some("session-reuse".to_string());
        payload.director_state = Some(DirectorState {
            turn_count: 1,
            agent_responses: vec![AgentTurnSummary {
                agent_id: "teacher-1".to_string(),
                agent_name: "Ms. Rivera".to_string(),
                content_preview: "Previously client-carried discussion turn".to_string(),
                action_count: 0,
                whiteboard_actions: vec![],
            }],
            whiteboard_ledger: vec![],
            whiteboard_state: None,
        });

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");

        assert!(final_state.turn_count > 1);
        assert!(final_state.agent_responses.len() > 1);
        assert_eq!(
            final_state.agent_responses[0].content_preview,
            "Previously client-carried discussion turn"
        );
    }

    #[tokio::test]
    async fn live_service_stateless_chat_does_not_persist_runtime_session_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));

        let mut payload = sample_stateless_chat_request();
        payload.session_id = Some("session-no-persist".to_string());
        payload.director_state = None;

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");
        let saved_state = storage
            .get_runtime_session("session-no-persist")
            .await
            .unwrap();

        assert!(saved_state.is_none());
        assert!(final_state.turn_count >= 1);
    }

    #[tokio::test]
    async fn live_service_managed_runtime_session_loads_and_persists_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![
                r#"{"next_agent":"teacher-1"}"#.to_string(),
                r#"[{"type":"text","content":"Resuming with managed runtime memory."}]"#
                    .to_string(),
            ],
        );

        storage
            .save_runtime_session(
                "managed-session-1",
                &DirectorState {
                    turn_count: 1,
                    agent_responses: vec![AgentTurnSummary {
                        agent_id: "teacher-1".to_string(),
                        agent_name: "Ms. Rivera".to_string(),
                        content_preview: "Persisted turn".to_string(),
                        action_count: 0,
                        whiteboard_actions: vec![],
                    }],
                    whiteboard_ledger: vec![],
                    whiteboard_state: None,
                },
            )
            .await
            .unwrap();

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-session-1".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = None;

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");
        let persisted = storage
            .get_runtime_session("managed-session-1")
            .await
            .unwrap()
            .expect("managed session should be persisted");

        assert!(final_state.turn_count > 1);
        assert_eq!(persisted.turn_count, final_state.turn_count);
        assert_eq!(
            persisted.agent_responses[0].content_preview,
            "Persisted turn".to_string()
        );
    }

    #[tokio::test]
    async fn live_service_managed_runtime_session_can_create_empty_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"Fresh managed session."}]"#.to_string()],
        );

        let mut payload = sample_stateless_chat_request();
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        payload.config.agent_configs.truncate(1);
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-session-new".to_string()),
            create_if_missing: Some(true),
        });
        payload.director_state = None;

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");
        let persisted = storage
            .get_runtime_session("managed-session-new")
            .await
            .unwrap();

        assert!(final_state.turn_count >= 1);
        assert!(persisted.is_some());
    }

    #[tokio::test]
    async fn live_service_managed_runtime_session_resume_advances_from_checkpoint() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![
                r#"{"next_agent":"teacher-1"}"#.to_string(),
                r#"[{"type":"text","content":"Managed checkpoint turn."}]"#.to_string(),
                r#"{"next_agent":"teacher-1"}"#.to_string(),
                r#"[{"type":"text","content":"Managed checkpoint follow-up."}]"#.to_string(),
            ],
        );

        let mut first_payload = sample_stateless_chat_request();
        first_payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-checkpoint-resume".to_string()),
            create_if_missing: Some(true),
        });
        first_payload.director_state = None;

        let first_events = service.stateless_chat(first_payload).await.unwrap();
        let first_final_state = first_events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("first call should emit final director state");
        let first_persisted = storage
            .get_runtime_session("managed-checkpoint-resume")
            .await
            .unwrap()
            .expect("first managed call should persist state");
        assert_eq!(first_persisted.turn_count, first_final_state.turn_count);

        let mut second_payload = sample_stateless_chat_request();
        second_payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-checkpoint-resume".to_string()),
            create_if_missing: Some(false),
        });
        second_payload.director_state = None;

        let second_events = service.stateless_chat(second_payload).await.unwrap();
        let second_final_state = second_events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("second call should emit final director state");
        let second_persisted = storage
            .get_runtime_session("managed-checkpoint-resume")
            .await
            .unwrap()
            .expect("second managed call should persist state");

        assert!(
            second_final_state.turn_count > first_final_state.turn_count,
            "resume call should advance from persisted checkpoint"
        );
        assert_eq!(second_persisted.turn_count, second_final_state.turn_count);
        assert_eq!(
            second_persisted.agent_responses.first().map(|r| r.content_preview.clone()),
            first_persisted.agent_responses.first().map(|r| r.content_preview.clone())
        );
    }

    #[tokio::test]
    async fn live_service_managed_runtime_session_stream_disconnect_persists_resumable_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let started = Arc::new(Notify::new());
        let cancelled = Arc::new(Notify::new());
        let started_wait = started.notified();
        let cancelled_wait = cancelled.notified();

        let streaming_service = build_live_chat_service_with_blocking_cancellable_provider(
            Arc::clone(&storage),
            Arc::clone(&started),
            Arc::clone(&cancelled),
        );

        let (sender, mut receiver) = mpsc::channel::<TutorStreamEvent>(8);
        let mut stream_payload = sample_stateless_chat_request();
        stream_payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-disconnect-resume".to_string()),
            create_if_missing: Some(true),
        });
        stream_payload.director_state = None;

        let streaming_service_clone = Arc::clone(&streaming_service);
        let stream_task = tokio::spawn(async move {
            streaming_service_clone
                .stateless_chat_stream(stream_payload, sender)
                .await
        });

        let first_event = tokio::time::timeout(std::time::Duration::from_millis(150), receiver.recv())
            .await
            .expect("stream should send first event quickly")
            .expect("first event should exist");
        assert!(matches!(first_event.kind, TutorEventKind::SessionStarted));

        started_wait.await;
        drop(receiver);
        cancelled_wait.await;

        let stream_join = tokio::time::timeout(std::time::Duration::from_millis(300), stream_task)
            .await
            .expect("stream task should stop quickly after downstream disconnect")
            .expect("stream task should join cleanly");
        assert!(stream_join.is_ok());

        let persisted_after_disconnect = storage
            .get_runtime_session("managed-disconnect-resume")
            .await
            .unwrap()
            .expect("disconnect should still persist resumable checkpoint state");

        let resume_service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![
                r#"{"next_agent":"teacher-1"}"#.to_string(),
                r#"[{"type":"text","content":"Recovered after disconnect."}]"#.to_string(),
                r#"{"next_agent":"teacher-1"}"#.to_string(),
                r#"[{"type":"text","content":"Recovered follow-up after disconnect."}]"#.to_string(),
            ],
        );

        let mut resume_payload = sample_stateless_chat_request();
        resume_payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-disconnect-resume".to_string()),
            create_if_missing: Some(false),
        });
        resume_payload.director_state = None;

        let resume_events = resume_service.stateless_chat(resume_payload).await.unwrap();
        let resumed_final_state = resume_events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("resume should emit final director state");

        assert!(
            resumed_final_state.turn_count >= persisted_after_disconnect.turn_count,
            "resumed state should continue from persisted checkpoint without rewinding"
        );
    }

    #[tokio::test]
    async fn live_service_subscription_payment_upserts_active_subscription() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        let order = PaymentOrder {
            id: "order-sub-success-1".to_string(),
            account_id: "acct-sub-success-1".to_string(),
            product_code: "plus_monthly".to_string(),
            product_kind: BillingProductKind::Subscription,
            gateway: "easebuzz".to_string(),
            gateway_txn_id: "txn-sub-success-1".to_string(),
            gateway_payment_id: Some("pay-sub-success-1".to_string()),
            amount_minor: 500,
            currency: "USD".to_string(),
            credits_to_grant: 30.0,
            status: PaymentOrderStatus::Succeeded,
            checkout_url: None,
            udf1: None,
            udf2: None,
            udf3: None,
            udf4: None,
            udf5: None,
            raw_response: None,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
        };

        service
            .upsert_subscription_from_payment(&order, Some("sub-ref-1".to_string()), true)
            .await
            .unwrap();

        let subscriptions = storage
            .list_subscriptions_for_account("acct-sub-success-1", 10)
            .await
            .unwrap();
        assert_eq!(subscriptions.len(), 1);
        let subscription = &subscriptions[0];
        assert_eq!(subscription.plan_code, "plus_monthly");
        assert!(matches!(subscription.status, SubscriptionStatus::Active));
        assert_eq!(subscription.gateway_subscription_id.as_deref(), Some("sub-ref-1"));
        assert_eq!(
            subscription.last_payment_order_id.as_deref(),
            Some("order-sub-success-1")
        );
    }

    #[tokio::test]
    async fn live_service_subscription_failed_payment_sets_past_due() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        storage
            .save_subscription(&Subscription {
                id: "sub-existing-1".to_string(),
                account_id: "acct-sub-fail-1".to_string(),
                plan_code: "pro_monthly".to_string(),
                gateway: "easebuzz".to_string(),
                gateway_subscription_id: Some("sub-ref-fail".to_string()),
                status: SubscriptionStatus::Active,
                billing_interval: BillingInterval::Monthly,
                credits_per_cycle: 80.0,
                autopay_enabled: true,
                current_period_start: now,
                current_period_end: now + chrono::Duration::days(30),
                next_renewal_at: Some(now + chrono::Duration::days(30)),
                grace_period_until: None,
                cancelled_at: None,
                last_payment_order_id: Some("order-previous".to_string()),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        let failed_order = PaymentOrder {
            id: "order-sub-failed-1".to_string(),
            account_id: "acct-sub-fail-1".to_string(),
            product_code: "pro_monthly".to_string(),
            product_kind: BillingProductKind::Subscription,
            gateway: "easebuzz".to_string(),
            gateway_txn_id: "txn-sub-failed-1".to_string(),
            gateway_payment_id: Some("pay-sub-failed-1".to_string()),
            amount_minor: 1200,
            currency: "USD".to_string(),
            credits_to_grant: 80.0,
            status: PaymentOrderStatus::Failed,
            checkout_url: None,
            udf1: None,
            udf2: None,
            udf3: None,
            udf4: None,
            udf5: None,
            raw_response: None,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
        };

        service
            .upsert_subscription_from_payment(&failed_order, None, false)
            .await
            .unwrap();

        let subscriptions = storage
            .list_subscriptions_for_account("acct-sub-fail-1", 10)
            .await
            .unwrap();
        assert_eq!(subscriptions.len(), 1);
        assert!(matches!(
            subscriptions[0].status,
            SubscriptionStatus::PastDue
        ));
        assert_eq!(
            subscriptions[0].last_payment_order_id.as_deref(),
            Some("order-sub-failed-1")
        );
        assert!(subscriptions[0].grace_period_until.is_some());

        let succeeded_order = PaymentOrder {
            id: "order-sub-refund-embedded-1".to_string(),
            account_id: "acct-sub-fail-1".to_string(),
            product_code: "pro_monthly".to_string(),
            product_kind: BillingProductKind::Subscription,
            gateway: "easebuzz".to_string(),
            gateway_txn_id: "txn-sub-refund-embedded-1".to_string(),
            gateway_payment_id: Some("pay-sub-refund-embedded-1".to_string()),
            amount_minor: 1200,
            currency: "USD".to_string(),
            credits_to_grant: 80.0,
            status: PaymentOrderStatus::Succeeded,
            checkout_url: None,
            udf1: None,
            udf2: None,
            udf3: None,
            udf4: None,
            udf5: None,
            raw_response: None,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
        };

        storage.save_payment_order(&succeeded_order).await.unwrap();
        storage
            .apply_credit_entry(&CreditLedgerEntry {
                id: format!("payment-order-{}", succeeded_order.id),
                account_id: succeeded_order.account_id.clone(),
                kind: CreditEntryKind::Grant,
                amount: succeeded_order.credits_to_grant,
                reason: format!(
                    "payment_order:{}:{}",
                    succeeded_order.product_code, succeeded_order.gateway_txn_id
                ),
                created_at: now,
            })
            .await
            .unwrap();

        let reversed_first = service
            .reconcile_reversed_payment(&succeeded_order)
            .await
            .unwrap();
        let reversed_second = service
            .reconcile_reversed_payment(&succeeded_order)
            .await
            .unwrap();
        assert!(reversed_first);
        assert!(!reversed_second);

        service
            .cancel_subscription_from_reversal(&succeeded_order, Some("sub-ref-fail".to_string()))
            .await
            .unwrap();
        let subscriptions_after_reversal = storage
            .list_subscriptions_for_account("acct-sub-fail-1", 10)
            .await
            .unwrap();
        assert!(matches!(
            subscriptions_after_reversal[0].status,
            SubscriptionStatus::Cancelled
        ));
    }

    #[tokio::test]
    async fn live_service_reconcile_reversed_payment_debits_once_and_cancels_subscription() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        let succeeded_order = PaymentOrder {
            id: "order-sub-refund-1".to_string(),
            account_id: "acct-sub-refund-1".to_string(),
            product_code: "plus_monthly".to_string(),
            product_kind: BillingProductKind::Subscription,
            gateway: "easebuzz".to_string(),
            gateway_txn_id: "txn-sub-refund-1".to_string(),
            gateway_payment_id: Some("pay-sub-refund-1".to_string()),
            amount_minor: 500,
            currency: "USD".to_string(),
            credits_to_grant: 30.0,
            status: PaymentOrderStatus::Succeeded,
            checkout_url: None,
            udf1: None,
            udf2: None,
            udf3: None,
            udf4: None,
            udf5: None,
            raw_response: None,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
        };

        storage.save_payment_order(&succeeded_order).await.unwrap();
        storage
            .apply_credit_entry(&CreditLedgerEntry {
                id: format!("payment-order-{}", succeeded_order.id),
                account_id: succeeded_order.account_id.clone(),
                kind: CreditEntryKind::Grant,
                amount: succeeded_order.credits_to_grant,
                reason: format!(
                    "payment_order:{}:{}",
                    succeeded_order.product_code, succeeded_order.gateway_txn_id
                ),
                created_at: now,
            })
            .await
            .unwrap();
        service
            .upsert_subscription_from_payment(&succeeded_order, Some("sub-refund-1".to_string()), true)
            .await
            .unwrap();

        let reversed_first = service
            .reconcile_reversed_payment(&succeeded_order)
            .await
            .unwrap();
        assert!(reversed_first);

        service
            .cancel_subscription_from_reversal(&succeeded_order, Some("sub-refund-1".to_string()))
            .await
            .unwrap();

        let reversed_second = service
            .reconcile_reversed_payment(&succeeded_order)
            .await
            .unwrap();
        assert!(!reversed_second);

        let ledger = storage
            .list_credit_entries("acct-sub-refund-1", 10)
            .await
            .unwrap();
        assert_eq!(ledger.len(), 2);
        assert!(ledger.iter().any(|entry| {
            entry.id == "payment-order-reversal-order-sub-refund-1"
                && matches!(entry.kind, CreditEntryKind::Debit)
        }));

        let balance = storage
            .get_credit_balance("acct-sub-refund-1")
            .await
            .unwrap();
        assert_eq!(balance.balance, 0.0);

        let subscriptions = storage
            .list_subscriptions_for_account("acct-sub-refund-1", 10)
            .await
            .unwrap();
        assert_eq!(subscriptions.len(), 1);
        assert!(matches!(
            subscriptions[0].status,
            SubscriptionStatus::Cancelled
        ));
        assert!(!subscriptions[0].autopay_enabled);
        assert!(subscriptions[0].cancelled_at.is_some());
        assert!(subscriptions[0].next_renewal_at.is_none());
    }

    #[test]
    fn easebuzz_reversal_detection_matches_refund_and_chargeback_markers() {
        let mut refund_fields = HashMap::new();
        refund_fields.insert("unmappedstatus".to_string(), "REFUND Initiated".to_string());
        assert!(easebuzz_callback_indicates_reversal(&refund_fields, "failure"));

        let mut chargeback_fields = HashMap::new();
        chargeback_fields.insert(
            "transaction_status".to_string(),
            "chargeback_received".to_string(),
        );
        assert!(easebuzz_callback_indicates_reversal(
            &chargeback_fields,
            "dropped"
        ));

        let mut normal_failure_fields = HashMap::new();
        normal_failure_fields.insert("payment_status".to_string(), "bounced".to_string());
        assert!(!easebuzz_callback_indicates_reversal(
            &normal_failure_fields,
            "failure"
        ));
    }

    #[test]
    fn easebuzz_event_identifier_prefers_explicit_ids_and_is_deterministic() {
        let mut with_explicit = HashMap::new();
        with_explicit.insert("event_id".to_string(), "evt-123".to_string());
        let explicit = easebuzz_event_identifier(&with_explicit, "txn-1", "success");
        assert_eq!(explicit, "easebuzz:txn-1:evt-123");

        let mut without_explicit = HashMap::new();
        without_explicit.insert("txnid".to_string(), "txn-2".to_string());
        without_explicit.insert("status".to_string(), "success".to_string());
        without_explicit.insert("amount".to_string(), "12.99".to_string());

        let first = easebuzz_event_identifier(&without_explicit, "txn-2", "success");
        let second = easebuzz_event_identifier(&without_explicit, "txn-2", "success");
        assert_eq!(first, second);
        assert!(first.starts_with("easebuzz:txn-2:success:"));
    }

    #[test]
    fn verify_easebuzz_response_hash_accepts_valid_signature() {
        let salt = "test_salt";
        let mut fields = HashMap::new();
        fields.insert("status".to_string(), "success".to_string());
        fields.insert("udf10".to_string(), "".to_string());
        fields.insert("udf9".to_string(), "".to_string());
        fields.insert("udf8".to_string(), "".to_string());
        fields.insert("udf7".to_string(), "".to_string());
        fields.insert("udf6".to_string(), "".to_string());
        fields.insert("udf5".to_string(), "".to_string());
        fields.insert("udf4".to_string(), "".to_string());
        fields.insert("udf3".to_string(), "bundle_small".to_string());
        fields.insert("udf2".to_string(), "acct-1".to_string());
        fields.insert("udf1".to_string(), "order-1".to_string());
        fields.insert("email".to_string(), "billing@example.com".to_string());
        fields.insert("firstname".to_string(), "Tutor".to_string());
        fields.insert("productinfo".to_string(), "bundle_small".to_string());
        fields.insert("amount".to_string(), "9.99".to_string());
        fields.insert("txnid".to_string(), "txn-1".to_string());
        fields.insert("key".to_string(), "merchant-key".to_string());

        let hash = sha512_hex(
            &[salt, "success", "", "", "", "", "", "", "", "bundle_small", "acct-1", "order-1", "billing@example.com", "Tutor", "bundle_small", "9.99", "txn-1", "merchant-key"].join("|"),
        );
        fields.insert("hash".to_string(), hash);

        assert!(verify_easebuzz_response_hash(&fields, salt).is_ok());
    }

    #[test]
    fn verify_easebuzz_response_hash_rejects_invalid_signature() {
        let mut fields = HashMap::new();
        fields.insert("hash".to_string(), "invalid".to_string());
        fields.insert("status".to_string(), "success".to_string());

        let result = verify_easebuzz_response_hash(&fields, "test_salt");
        assert!(result.is_err());
    }

    #[test]
    fn verify_easebuzz_response_hash_requires_hash_field() {
        let mut fields = HashMap::new();
        fields.insert("status".to_string(), "success".to_string());

        let result = verify_easebuzz_response_hash(&fields, "test_salt");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("missing required easebuzz field hash"));
    }

    #[tokio::test]
    async fn live_service_renews_due_subscriptions_idempotently() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        storage
            .save_subscription(&Subscription {
                id: "sub-renew-1".to_string(),
                account_id: "acct-renew-1".to_string(),
                plan_code: "plus_monthly".to_string(),
                gateway: "easebuzz".to_string(),
                gateway_subscription_id: Some("sub-renew-ref-1".to_string()),
                status: SubscriptionStatus::Active,
                billing_interval: BillingInterval::Monthly,
                credits_per_cycle: 30.0,
                autopay_enabled: true,
                current_period_start: now - chrono::Duration::days(40),
                current_period_end: now - chrono::Duration::days(10),
                next_renewal_at: Some(now - chrono::Duration::days(10)),
                grace_period_until: Some(now - chrono::Duration::days(7)),
                cancelled_at: None,
                last_payment_order_id: Some("order-renew-previous".to_string()),
                created_at: now - chrono::Duration::days(90),
                updated_at: now - chrono::Duration::days(10),
            })
            .await
            .unwrap();

        let renewed = service.renew_due_subscriptions(now).await.unwrap();
        assert_eq!(renewed, 1);

        let after_first = storage
            .list_subscriptions_for_account("acct-renew-1", 10)
            .await
            .unwrap();
        assert_eq!(after_first.len(), 1);
        assert!(after_first[0].current_period_end > now);

        let entries_after_first = storage
            .list_credit_entries("acct-renew-1", 10)
            .await
            .unwrap();
        assert_eq!(entries_after_first.len(), 1);
        assert!(entries_after_first[0]
            .reason
            .starts_with("subscription_renewal:plus_monthly"));

        let invoices_after_first = storage
            .list_invoices_for_account("acct-renew-1", 10)
            .await
            .unwrap();
        assert_eq!(invoices_after_first.len(), 1);
        let expected_renewal_amount = billing_catalog()
            .into_iter()
            .find(|product| {
                product.product_code == "plus_monthly"
                    && matches!(product.kind, BillingProductKind::Subscription)
            })
            .map(|product| product.amount_minor)
            .unwrap_or(0);
        assert_eq!(invoices_after_first[0].amount_cents, expected_renewal_amount);

        let invoice_lines_after_first = storage
            .list_lines_for_invoice(&invoices_after_first[0].id)
            .await
            .unwrap();
        assert_eq!(invoice_lines_after_first.len(), 1);
        assert_eq!(invoice_lines_after_first[0].amount_cents, expected_renewal_amount);

        let renewed_again = service.renew_due_subscriptions(now).await.unwrap();
        assert_eq!(renewed_again, 0);

        let entries_after_second = storage
            .list_credit_entries("acct-renew-1", 10)
            .await
            .unwrap();
        assert_eq!(entries_after_second.len(), 1);

        let invoices_after_second = storage
            .list_invoices_for_account("acct-renew-1", 10)
            .await
            .unwrap();
        assert_eq!(invoices_after_second.len(), 1);
    }

    #[tokio::test]
    async fn live_service_payment_order_bundle_creates_paid_invoice() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        let order = PaymentOrder {
            id: "order-bundle-invoice-1".to_string(),
            account_id: "acct-bundle-invoice-1".to_string(),
            product_code: "bundle_small".to_string(),
            product_kind: BillingProductKind::Bundle,
            gateway: "easebuzz".to_string(),
            gateway_txn_id: "txn-bundle-invoice-1".to_string(),
            gateway_payment_id: Some("pay-bundle-invoice-1".to_string()),
            amount_minor: 995,
            currency: "USD".to_string(),
            credits_to_grant: 20.0,
            status: PaymentOrderStatus::Succeeded,
            checkout_url: None,
            udf1: None,
            udf2: None,
            udf3: None,
            udf4: None,
            udf5: None,
            raw_response: None,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
        };

        service.create_payment_order_invoice(&order, now).await.unwrap();

        let invoices = storage
            .list_invoices_for_account("acct-bundle-invoice-1", 10)
            .await
            .unwrap();
        assert_eq!(invoices.len(), 1);
        assert!(matches!(invoices[0].status, InvoiceStatus::Paid));
        assert!(matches!(
            invoices[0].invoice_type,
            InvoiceType::AddOnCreditPurchase
        ));
        assert_eq!(invoices[0].amount_cents, 995);

        let lines = storage
            .list_lines_for_invoice(&invoices[0].id)
            .await
            .unwrap();
        assert_eq!(lines.len(), 1);
        assert!(matches!(lines[0].line_type, InvoiceLineType::AddOnCredits));
        assert_eq!(lines[0].amount_cents, 995);
    }

    #[tokio::test]
    async fn live_service_billing_maintenance_revokes_expired_past_due_subscriptions() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        storage
            .save_subscription(&Subscription {
                id: "sub-revoke-1".to_string(),
                account_id: "acct-revoke-1".to_string(),
                plan_code: "pro_monthly".to_string(),
                gateway: "easebuzz".to_string(),
                gateway_subscription_id: Some("sub-revoke-ref-1".to_string()),
                status: SubscriptionStatus::PastDue,
                billing_interval: BillingInterval::Monthly,
                credits_per_cycle: 80.0,
                autopay_enabled: true,
                current_period_start: now - chrono::Duration::days(40),
                current_period_end: now - chrono::Duration::days(10),
                next_renewal_at: Some(now - chrono::Duration::days(10)),
                grace_period_until: Some(now - chrono::Duration::days(1)),
                cancelled_at: None,
                last_payment_order_id: Some("order-revoke-previous".to_string()),
                created_at: now - chrono::Duration::days(90),
                updated_at: now - chrono::Duration::days(10),
            })
            .await
            .unwrap();

        let report = service.run_billing_maintenance_cycle().await.unwrap();
        assert_eq!(report.revoked_subscriptions, 1);
        assert_eq!(report.renewed_subscriptions, 0);

        let subscriptions = storage
            .list_subscriptions_for_account("acct-revoke-1", 10)
            .await
            .unwrap();
        assert_eq!(subscriptions.len(), 1);
        assert!(matches!(subscriptions[0].status, SubscriptionStatus::Expired));
        assert!(!subscriptions[0].autopay_enabled);
        assert!(subscriptions[0].next_renewal_at.is_none());
    }

    async fn run_live_service_billing_maintenance_marks_recovered_intents_paid() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        storage
            .create_invoice(&Invoice {
                id: "inv-recovered-1".to_string(),
                account_id: "acct-recovered-1".to_string(),
                invoice_type: InvoiceType::SubscriptionRenewal,
                billing_cycle_start: now - chrono::Duration::days(30),
                billing_cycle_end: now,
                status: InvoiceStatus::Overdue,
                amount_cents: 1299,
                amount_after_credits: 1299,
                created_at: now - chrono::Duration::days(2),
                finalized_at: Some(now - chrono::Duration::days(2)),
                paid_at: None,
                due_at: Some(now - chrono::Duration::days(1)),
                updated_at: now - chrono::Duration::days(2),
            })
            .await
            .unwrap();

        storage
            .save_payment_order(&PaymentOrder {
                id: "order-recovered-1".to_string(),
                account_id: "acct-recovered-1".to_string(),
                product_code: "plus_monthly".to_string(),
                product_kind: BillingProductKind::Subscription,
                gateway: "easebuzz".to_string(),
                gateway_txn_id: "txn-recovered-1".to_string(),
                gateway_payment_id: Some("pay-recovered-1".to_string()),
                amount_minor: 1299,
                currency: "USD".to_string(),
                credits_to_grant: 100.0,
                status: PaymentOrderStatus::Succeeded,
                checkout_url: None,
                udf1: None,
                udf2: None,
                udf3: None,
                udf4: None,
                udf5: None,
                raw_response: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now,
                completed_at: Some(now),
            })
            .await
            .unwrap();

        storage
            .create_payment_intent(&PaymentIntent {
                id: "pi-order-recovered-1".to_string(),
                account_id: "acct-recovered-1".to_string(),
                invoice_id: "inv-recovered-1".to_string(),
                status: PaymentIntentStatus::Failed,
                amount_cents: 1299,
                idempotency_key: "inv-recovered-1:1".to_string(),
                payment_method_id: None,
                gateway_payment_intent_id: Some("pay-recovered-1".to_string()),
                authorize_error: Some("payment_failed".to_string()),
                authorized_at: None,
                captured_at: None,
                canceled_at: None,
                attempt_count: 1,
                next_retry_at: Some(now - chrono::Duration::minutes(10)),
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        storage
            .create_dunning_case(&DunningCase {
                id: "dc-recovered-1".to_string(),
                account_id: "acct-recovered-1".to_string(),
                invoice_id: "inv-recovered-1".to_string(),
                payment_intent_id: "pi-order-recovered-1".to_string(),
                status: DunningStatus::Active,
                attempt_schedule: vec![],
                grace_period_end: now + chrono::Duration::days(7),
                final_attempt_at: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        let report = service.run_billing_maintenance_cycle().await.unwrap();
        assert_eq!(report.retried_payment_intents, 1);
        assert_eq!(report.exhausted_dunning_cases, 0);

        let intent = storage
            .get_payment_intent("pi-order-recovered-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(intent.status, PaymentIntentStatus::Captured));
        assert_eq!(intent.attempt_count, 2);
        assert!(intent.captured_at.is_some());
        assert!(intent.next_retry_at.is_none());

        let invoice = storage
            .get_invoice("inv-recovered-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(invoice.status, InvoiceStatus::Paid));

        let dunning = storage
            .get_dunning_case_by_invoice_id("inv-recovered-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(dunning.status, DunningStatus::Recovered));
        assert!(dunning
            .attempt_schedule
            .iter()
            .any(|attempt| attempt.result.as_deref() == Some("captured")));
    }

    #[test]
    fn live_service_billing_maintenance_marks_recovered_intents_paid() {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        runtime.block_on(run_live_service_billing_maintenance_marks_recovered_intents_paid());
    }

    async fn run_live_service_billing_maintenance_marks_exhausted_intents_uncollectible() {
        let previous_max_attempts = std::env::var("AI_TUTOR_DUNNING_MAX_ATTEMPTS").ok();
        std::env::set_var("AI_TUTOR_DUNNING_MAX_ATTEMPTS", "2");

        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        storage
            .create_invoice(&Invoice {
                id: "inv-exhausted-1".to_string(),
                account_id: "acct-exhausted-1".to_string(),
                invoice_type: InvoiceType::SubscriptionRenewal,
                billing_cycle_start: now - chrono::Duration::days(30),
                billing_cycle_end: now,
                status: InvoiceStatus::Overdue,
                amount_cents: 1299,
                amount_after_credits: 1299,
                created_at: now - chrono::Duration::days(2),
                finalized_at: Some(now - chrono::Duration::days(2)),
                paid_at: None,
                due_at: Some(now - chrono::Duration::days(1)),
                updated_at: now - chrono::Duration::days(2),
            })
            .await
            .unwrap();

        storage
            .save_payment_order(&PaymentOrder {
                id: "order-exhausted-1".to_string(),
                account_id: "acct-exhausted-1".to_string(),
                product_code: "plus_monthly".to_string(),
                product_kind: BillingProductKind::Subscription,
                gateway: "easebuzz".to_string(),
                gateway_txn_id: "txn-exhausted-1".to_string(),
                gateway_payment_id: Some("pay-exhausted-1".to_string()),
                amount_minor: 1299,
                currency: "USD".to_string(),
                credits_to_grant: 100.0,
                status: PaymentOrderStatus::Failed,
                checkout_url: None,
                udf1: None,
                udf2: None,
                udf3: None,
                udf4: None,
                udf5: None,
                raw_response: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now,
                completed_at: Some(now),
            })
            .await
            .unwrap();

        storage
            .create_payment_intent(&PaymentIntent {
                id: "pi-order-exhausted-1".to_string(),
                account_id: "acct-exhausted-1".to_string(),
                invoice_id: "inv-exhausted-1".to_string(),
                status: PaymentIntentStatus::Failed,
                amount_cents: 1299,
                idempotency_key: "inv-exhausted-1:1".to_string(),
                payment_method_id: None,
                gateway_payment_intent_id: Some("pay-exhausted-1".to_string()),
                authorize_error: Some("payment_failed".to_string()),
                authorized_at: None,
                captured_at: None,
                canceled_at: None,
                attempt_count: 1,
                next_retry_at: Some(now - chrono::Duration::minutes(10)),
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        storage
            .create_dunning_case(&DunningCase {
                id: "dc-exhausted-1".to_string(),
                account_id: "acct-exhausted-1".to_string(),
                invoice_id: "inv-exhausted-1".to_string(),
                payment_intent_id: "pi-order-exhausted-1".to_string(),
                status: DunningStatus::Active,
                attempt_schedule: vec![],
                grace_period_end: now + chrono::Duration::days(7),
                final_attempt_at: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        let report = service.run_billing_maintenance_cycle().await.unwrap();

        if let Some(value) = previous_max_attempts {
            std::env::set_var("AI_TUTOR_DUNNING_MAX_ATTEMPTS", value);
        } else {
            std::env::remove_var("AI_TUTOR_DUNNING_MAX_ATTEMPTS");
        }

        assert_eq!(report.retried_payment_intents, 0);
        assert_eq!(report.exhausted_dunning_cases, 1);

        let intent = storage
            .get_payment_intent("pi-order-exhausted-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(intent.status, PaymentIntentStatus::Abandoned));
        assert_eq!(intent.attempt_count, 2);
        assert!(intent.next_retry_at.is_none());

        let invoice = storage
            .get_invoice("inv-exhausted-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(invoice.status, InvoiceStatus::Uncollectible));

        let dunning = storage
            .get_dunning_case_by_invoice_id("inv-exhausted-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(dunning.status, DunningStatus::Exhausted));
        assert!(dunning
            .attempt_schedule
            .iter()
            .any(|attempt| attempt.result.as_deref() == Some("exhausted")));
    }

    #[test]
    fn live_service_billing_maintenance_marks_exhausted_intents_uncollectible() {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        runtime.block_on(run_live_service_billing_maintenance_marks_exhausted_intents_uncollectible());
    }

    #[tokio::test]
    async fn live_service_rejects_missing_managed_runtime_session() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("missing-managed".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = None;

        let error = service.stateless_chat(payload).await.unwrap_err();
        assert!(error
            .to_string()
            .contains("managed runtime session not found"));
    }

    #[tokio::test]
    async fn live_service_system_status_reports_sqlite_backends_and_queue_depth() {
        let root = temp_root();
        let lesson_db_path = root.join("runtime").join("lessons.db");
        let runtime_db_path = root.join("runtime").join("runtime-sessions.db");
        let queue_db_path = root.join("runtime").join("lesson-queue.db");
        let job_db_path = root.join("runtime").join("lesson-jobs.db");
        let previous_lesson_db = std::env::var("AI_TUTOR_LESSON_DB_PATH").ok();
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        let previous_job_db = std::env::var("AI_TUTOR_JOB_DB_PATH").ok();
        std::env::set_var(
            "AI_TUTOR_LESSON_DB_PATH",
            lesson_db_path.to_string_lossy().to_string(),
        );
        std::env::set_var(
            "AI_TUTOR_QUEUE_DB_PATH",
            queue_db_path.to_string_lossy().to_string(),
        );
        std::env::set_var(
            "AI_TUTOR_JOB_DB_PATH",
            job_db_path.to_string_lossy().to_string(),
        );
        let storage = Arc::new(FileStorage::with_databases(
            &root,
            Some(lesson_db_path),
            Some(runtime_db_path.clone()),
            Some(job_db_path),
            None,
        ));
        let service = build_live_service_with_fakes(Arc::clone(&storage));

        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();
        let job = build_queued_job(
            "job-system-status".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&job).await.unwrap();
        FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path)
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-system-status".to_string(),
                job,
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();

        let status = service.get_system_status().await.unwrap();

        if let Some(value) = previous_lesson_db {
            std::env::set_var("AI_TUTOR_LESSON_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_LESSON_DB_PATH");
        }
        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }
        if let Some(value) = previous_job_db {
            std::env::set_var("AI_TUTOR_JOB_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_JOB_DB_PATH");
        }

        assert_eq!(status.queue_backend, "sqlite");
        assert_eq!(status.lesson_backend, "sqlite");
        assert_eq!(status.job_backend, "sqlite");
        assert_eq!(status.runtime_session_backend, "sqlite");
        assert_eq!(status.asset_backend, "local");
        assert_eq!(status.queue_pending_jobs, 1);
        assert_eq!(status.queue_active_leases, 0);
        assert_eq!(status.queue_stale_leases, 0);
        assert!(status.queue_status_error.is_none());
        assert_eq!(status.queue_poll_ms, 500);
        assert_eq!(status.queue_claim_heartbeat_interval_ms, 30_000);
        assert_eq!(status.queue_stale_timeout_ms, 300_000);
    }

    #[tokio::test]
    async fn live_service_system_status_reports_queue_active_and_stale_leases() {
        let root = temp_root();
        let queue_db_path = root.join("runtime").join("lesson-queue.db");
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        let previous_stale_timeout_ms = std::env::var("AI_TUTOR_QUEUE_STALE_TIMEOUT_MS").ok();
        std::env::set_var(
            "AI_TUTOR_QUEUE_DB_PATH",
            queue_db_path.to_string_lossy().to_string(),
        );
        std::env::set_var("AI_TUTOR_QUEUE_STALE_TIMEOUT_MS", "300000");
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();

        let active_job = build_queued_job(
            "job-system-status-active-lease".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&active_job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-system-status-active-lease".to_string(),
                job: active_job.clone(),
                request: request.clone(),
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        let _ = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "status-worker-active-lease".to_string(),
        )
        .await
        .unwrap()
        .expect("active lease should be claimed");

        let stale_job = build_queued_job(
            "job-system-status-stale-lease".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&stale_job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-system-status-stale-lease".to_string(),
                job: stale_job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        let _ = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "status-worker-stale-lease".to_string(),
        )
        .await
        .unwrap()
        .expect("stale lease should be claimed");

        tokio::task::spawn_blocking({
            let db_path = queue_db_path.clone();
            let stale_id = stale_job.id.clone();
            move || -> anyhow::Result<()> {
                let connection = rusqlite::Connection::open(db_path)?;
                connection.execute(
                    "UPDATE lesson_queue
                     SET lease_until = ?2
                     WHERE job_id = ?1",
                    rusqlite::params![
                        stale_id,
                        (chrono::Utc::now() - chrono::Duration::minutes(10)).to_rfc3339()
                    ],
                )?;
                Ok(())
            }
        })
        .await
        .unwrap()
        .unwrap();

        let status = service.get_system_status().await.unwrap();

        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }
        if let Some(value) = previous_stale_timeout_ms {
            std::env::set_var("AI_TUTOR_QUEUE_STALE_TIMEOUT_MS", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_STALE_TIMEOUT_MS");
        }

        assert_eq!(status.queue_active_leases, 1);
        assert_eq!(status.queue_stale_leases, 1);
        assert!(status.queue_status_error.is_none());
        assert_eq!(status.runtime_alert_level, "degraded");
        assert!(status
            .runtime_alerts
            .iter()
            .any(|alert| alert.contains("queue_stale_leases_detected")));
    }

    #[tokio::test]
    async fn health_route_returns_ok_json() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn auth_middleware_enforces_rbac_for_generate_route() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                google_login_response: Mutex::new(None),
                auth_session_response: Mutex::new(None),
                credit_balance: Mutex::new(None),
                credit_ledger: Mutex::new(None),
                generate_response: Mutex::new(Some(GenerateLessonResponse {
                    lesson_id: "lesson-auth".to_string(),
                    job_id: "job-auth".to_string(),
                    url: "http://localhost:8099/api/lessons/lesson-auth".to_string(),
                    scenes_count: 1,
                })),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([
                    ("reader-token".to_string(), ApiRole::Reader),
                    ("writer-token".to_string(), ApiRole::Writer),
                ]),
                require_https: false,
                operator_otp_enabled: false,
                operator_session_cookie_name: "ai_tutor_ops_session".to_string(),
                redis_url: None,
            },
        );

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "test auth".to_string(),
            language: Some("english".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("standard".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();

        let unauthorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let forbidden = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer reader-token")
                    .body(Body::from(payload.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let ok = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer writer-token")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn lesson_shelf_retry_requires_writer_role() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                google_login_response: Mutex::new(None),
                auth_session_response: Mutex::new(None),
                credit_balance: Mutex::new(None),
                credit_ledger: Mutex::new(None),
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([
                    ("reader-token".to_string(), ApiRole::Reader),
                    ("writer-token".to_string(), ApiRole::Writer),
                ]),
                require_https: false,
                operator_otp_enabled: false,
                operator_session_cookie_name: "ai_tutor_ops_session".to_string(),
                redis_url: None,
            },
        );

        let reader_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lesson-shelf/shelf-1/retry")
                    .header(header::AUTHORIZATION, "Bearer reader-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(reader_response.status(), StatusCode::FORBIDDEN);

        let writer_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lesson-shelf/shelf-1/retry")
                    .header(header::AUTHORIZATION, "Bearer writer-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(writer_response.status(), StatusCode::OK);
    }

    #[test]
    fn auth_middleware_enforces_rbac_for_lesson_shelf_routes() {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        runtime.block_on(async {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                google_login_response: Mutex::new(None),
                auth_session_response: Mutex::new(None),
                credit_balance: Mutex::new(None),
                credit_ledger: Mutex::new(None),
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([
                    ("reader-token".to_string(), ApiRole::Reader),
                    ("writer-token".to_string(), ApiRole::Writer),
                ]),
                require_https: false,
                operator_otp_enabled: false,
                operator_session_cookie_name: "ai_tutor_ops_session".to_string(),
                redis_url: None,
            },
        );

        let list_reader = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/lesson-shelf")
                    .header(header::AUTHORIZATION, "Bearer reader-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(list_reader.status(), StatusCode::OK);

        let patch_payload = serde_json::to_vec(&serde_json::json!({ "title": "Renamed" })).unwrap();
        let patch_reader = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/lesson-shelf/shelf-1")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer reader-token")
                    .body(Body::from(patch_payload.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(patch_reader.status(), StatusCode::FORBIDDEN);

        let patch_writer = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/lesson-shelf/shelf-1")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer writer-token")
                    .body(Body::from(patch_payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(patch_writer.status(), StatusCode::OK);

        let retry_reader = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lesson-shelf/shelf-1/retry")
                    .header(header::AUTHORIZATION, "Bearer reader-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(retry_reader.status(), StatusCode::FORBIDDEN);

        let retry_writer = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lesson-shelf/shelf-1/retry")
                    .header(header::AUTHORIZATION, "Bearer writer-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(retry_writer.status(), StatusCode::OK);

        let mark_opened_payload =
            serde_json::to_vec(&serde_json::json!({ "lesson_id": "lesson-1", "item_id": "shelf-1" }))
                .unwrap();
        let mark_opened_reader = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lesson-shelf/mark-opened")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer reader-token")
                    .body(Body::from(mark_opened_payload.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mark_opened_reader.status(), StatusCode::FORBIDDEN);

        let mark_opened_writer = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lesson-shelf/mark-opened")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer writer-token")
                    .body(Body::from(mark_opened_payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mark_opened_writer.status(), StatusCode::OK);
        });
    }

    #[tokio::test]
    async fn auth_middleware_allows_health_when_auth_enabled() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                google_login_response: Mutex::new(None),
                auth_session_response: Mutex::new(None),
                credit_balance: Mutex::new(None),
                credit_ledger: Mutex::new(None),
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([("ops-token".to_string(), ApiRole::Admin)]),
                require_https: false,
                operator_otp_enabled: false,
                operator_session_cookie_name: "ai_tutor_ops_session".to_string(),
                redis_url: None,
            },
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cors_preflight_passes_without_auth_for_runtime_stream() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                google_login_response: Mutex::new(None),
                auth_session_response: Mutex::new(None),
                credit_balance: Mutex::new(None),
                credit_ledger: Mutex::new(None),
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([("writer-token".to_string(), ApiRole::Writer)]),
                require_https: true,
                operator_otp_enabled: false,
                operator_session_cookie_name: "ai_tutor_ops_session".to_string(),
                redis_url: None,
            },
        );

        let response = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/runtime/chat/stream")
                    .header("origin", "https://client.example")
                    .header("access-control-request-method", "POST")
                    .header("access-control-request-headers", "authorization,content-type")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(response.status().is_success());
        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_some());
    }

    #[tokio::test]
    async fn https_requirement_blocks_non_tls_requests_for_protected_routes() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                google_login_response: Mutex::new(None),
                auth_session_response: Mutex::new(None),
                credit_balance: Mutex::new(None),
                credit_ledger: Mutex::new(None),
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: false,
                tokens: HashMap::new(),
                require_https: true,
                operator_otp_enabled: false,
                operator_session_cookie_name: "ai_tutor_ops_session".to_string(),
                redis_url: None,
            },
        );

        let blocked = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/system/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(blocked.status(), StatusCode::UPGRADE_REQUIRED);

        let allowed = app
            .oneshot(
                Request::builder()
                    .uri("/api/system/status")
                    .header("x-forwarded-proto", "https")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn system_status_route_returns_runtime_observability_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/system/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["status"], "ok");
        assert_eq!(parsed["deployment_environment"], "test");
        assert_eq!(parsed["rollout_phase"], "stable");
        assert_eq!(parsed["runtime_alert_level"], "ok");
        assert_eq!(parsed["runtime_alerts"], serde_json::json!([]));
        assert_eq!(parsed["auth_blueprint"]["google_oauth_enabled"], false);
        assert_eq!(
            parsed["deployment_blueprint"]["frontend_output_mode"],
            "standalone"
        );
        assert_eq!(
            parsed["credit_policy"]["tts_per_slide_credits"],
            serde_json::json!(0.2)
        );
        assert_eq!(
            parsed["configured_provider_priority"],
            serde_json::json!(["openai"])
        );
        assert_eq!(
            parsed["selected_model_profile"]["provider_id"],
            serde_json::json!("openai")
        );
        assert_eq!(
            parsed["selected_model_profile"]["model_id"],
            serde_json::json!("gpt-4o-mini")
        );
        assert_eq!(
            parsed["selected_model_profile"]["cost_tier"],
            serde_json::json!("economy")
        );
        assert_eq!(parsed["queue_backend"], "file");
        assert_eq!(parsed["job_backend"], "file");
        assert_eq!(parsed["runtime_session_backend"], "file");
        assert_eq!(parsed["asset_backend"], "local");
        assert_eq!(parsed["runtime_native_streaming_required"], false);
        assert_eq!(
            parsed["runtime_native_streaming_selectors"],
            serde_json::json!([])
        );
        assert_eq!(parsed["queue_active_leases"], 0);
        assert_eq!(parsed["queue_stale_leases"], 0);
        assert_eq!(parsed["queue_status_error"], serde_json::Value::Null);
        assert_eq!(parsed["queue_poll_ms"], 500);
        assert_eq!(parsed["queue_claim_heartbeat_interval_ms"], 30000);
        assert_eq!(parsed["queue_stale_timeout_ms"], 300000);
        assert_eq!(parsed["provider_total_requests"], 0);
        assert_eq!(parsed["provider_total_successes"], 0);
        assert_eq!(parsed["provider_total_failures"], 0);
        assert_eq!(parsed["provider_total_latency_ms"], 0);
        assert_eq!(parsed["provider_reported_input_tokens"], 0);
        assert_eq!(parsed["provider_reported_output_tokens"], 0);
        assert_eq!(parsed["provider_reported_total_tokens"], 0);
        assert_eq!(parsed["provider_reported_total_cost_microusd"], 0);
        assert_eq!(
            parsed["provider_average_latency_ms"],
            serde_json::Value::Null
        );
    }

    #[tokio::test]
    async fn ops_gate_route_returns_required_checks() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                google_login_response: Mutex::new(None),
                auth_session_response: Mutex::new(None),
                credit_balance: Mutex::new(None),
                credit_ledger: Mutex::new(None),
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([("ops-token".to_string(), ApiRole::Admin)]),
                require_https: false,
                operator_otp_enabled: false,
                operator_session_cookie_name: "ai_tutor_ops_session".to_string(),
                redis_url: None,
            },
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/system/ops-gate")
                    .header(header::AUTHORIZATION, "Bearer ops-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["mode"], "standard");
        assert!(parsed["checks"]
            .as_array()
            .is_some_and(|items| !items.is_empty()));
    }

    #[test]
    fn provider_runtime_status_mapping_exposes_streaming_path() {
        let mapped = map_provider_runtime_status(vec![
            ProviderRuntimeStatus {
                label: "openai:gpt-4o-mini".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 12,
                total_successes: 11,
                total_failures: 1,
                last_error: Some("429 Too Many Requests".to_string()),
                last_success_unix_ms: Some(1_700_000_001_000),
                last_failure_unix_ms: Some(1_700_000_000_000),
                total_latency_ms: 450,
                average_latency_ms: Some(37),
                last_latency_ms: Some(41),
                estimated_input_tokens: 4_000,
                estimated_output_tokens: 1_200,
                estimated_total_cost_microusd: 4_500,
                provider_reported_input_tokens: 3_900,
                provider_reported_output_tokens: 1_100,
                provider_reported_total_tokens: 5_000,
                provider_reported_total_cost_microusd: 4_200,
                streaming_path: StreamingPath::Native,
                capabilities:
                    ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            },
            ProviderRuntimeStatus {
                label: "legacy:mock".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 3,
                total_successes: 3,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: Some(1_700_000_002_000),
                last_failure_unix_ms: None,
                total_latency_ms: 120,
                average_latency_ms: Some(40),
                last_latency_ms: Some(39),
                estimated_input_tokens: 1_000,
                estimated_output_tokens: 900,
                estimated_total_cost_microusd: 1_300,
                provider_reported_input_tokens: 900,
                provider_reported_output_tokens: 800,
                provider_reported_total_tokens: 1_700,
                provider_reported_total_cost_microusd: 1_100,
                streaming_path: StreamingPath::Compatibility,
                capabilities: ai_tutor_providers::traits::ProviderCapabilities::compatibility_only(
                ),
            },
        ]);

        assert_eq!(mapped.len(), 2);
        assert_eq!(mapped[0].streaming_path, "native");
        assert!(mapped[0].native_streaming);
        assert_eq!(mapped[0].total_requests, 12);
        assert_eq!(mapped[0].total_failures, 1);
        assert_eq!(mapped[0].total_latency_ms, 450);
        assert_eq!(mapped[0].average_latency_ms, Some(37));
        assert_eq!(mapped[0].last_latency_ms, Some(41));
        assert_eq!(mapped[0].provider_reported_input_tokens, 3_900);
        assert_eq!(mapped[0].provider_reported_output_tokens, 1_100);
        assert_eq!(mapped[0].provider_reported_total_tokens, 5_000);
        assert_eq!(mapped[0].provider_reported_total_cost_microusd, 4_200);
        assert_eq!(
            mapped[0].last_error.as_deref(),
            Some("429 Too Many Requests")
        );
        assert_eq!(mapped[1].streaming_path, "compatibility");
        assert!(!mapped[1].native_streaming);
        assert_eq!(mapped[1].total_requests, 3);
        assert_eq!(mapped[1].total_failures, 0);
        assert_eq!(mapped[1].total_latency_ms, 120);
        assert_eq!(mapped[1].average_latency_ms, Some(40));
        assert_eq!(mapped[1].last_latency_ms, Some(39));

        let totals = aggregate_provider_runtime_status(&mapped);
        assert_eq!(totals.total_requests, 15);
        assert_eq!(totals.total_successes, 14);
        assert_eq!(totals.total_failures, 1);
        assert_eq!(totals.total_latency_ms, 570);
        assert_eq!(totals.average_latency_ms, Some(38));
        assert_eq!(totals.estimated_input_tokens, 5_000);
        assert_eq!(totals.estimated_output_tokens, 2_100);
        assert_eq!(totals.estimated_total_cost_microusd, 5_800);
        assert_eq!(totals.provider_reported_input_tokens, 4_800);
        assert_eq!(totals.provider_reported_output_tokens, 1_900);
        assert_eq!(totals.provider_reported_total_tokens, 6_700);
        assert_eq!(totals.provider_reported_total_cost_microusd, 5_300);
    }

    #[test]
    fn derive_runtime_alerts_flags_premium_selected_model() {
        let alerts = derive_runtime_alerts(
            &[],
            None,
            None,
            0,
            Some(&SelectedModelProfileResponse {
                provider_id: "openai".to_string(),
                provider_name: "OpenAI".to_string(),
                model_id: "gpt-5.2".to_string(),
                model_name: Some("GPT-5.2".to_string()),
                context_window: Some(400_000),
                output_window: Some(128_000),
                cost_tier: Some("premium".to_string()),
                input_cost_per_1m_usd: Some(2.0),
                output_cost_per_1m_usd: Some(8.0),
                supports_tools: true,
                supports_vision: true,
                supports_thinking: true,
            }),
            &AuthBlueprintStatusResponse {
                google_oauth_enabled: false,
                google_client_id_configured: false,
                google_client_secret_configured: false,
                google_redirect_uri: None,
                firebase_phone_auth_enabled: false,
                firebase_project_id: None,
                partial_auth_secret_configured: false,
                verify_phone_path: "/verify-phone".to_string(),
            },
            &CreditPolicyResponse {
                base_workflow_slide_credits: 0.1,
                image_attachment_credits: 0.05,
                tts_per_slide_credits: 0.2,
                starter_grant_credits: 10.0,
                plus_monthly_price_usd: 5.0,
                plus_monthly_credits: 30.0,
                pro_monthly_price_usd: 12.0,
                pro_monthly_credits: 80.0,
                bundle_small_price_usd: 2.0,
                bundle_small_credits: 10.0,
                bundle_large_price_usd: 10.0,
                bundle_large_credits: 65.0,
                tts_margin_review_required: false,
            },
        );

        assert!(alerts
            .iter()
            .any(|alert| alert == "selected_model_cost_tier_premium:openai:gpt-5.2"));
    }

    #[test]
    fn derive_runtime_alerts_flags_incomplete_auth_blueprint_and_tts_review() {
        let alerts = derive_runtime_alerts(
            &[],
            None,
            None,
            0,
            None,
            &AuthBlueprintStatusResponse {
                google_oauth_enabled: true,
                google_client_id_configured: true,
                google_client_secret_configured: false,
                google_redirect_uri: None,
                firebase_phone_auth_enabled: true,
                firebase_project_id: None,
                partial_auth_secret_configured: false,
                verify_phone_path: "/verify-phone".to_string(),
            },
            &CreditPolicyResponse {
                base_workflow_slide_credits: 0.1,
                image_attachment_credits: 0.05,
                tts_per_slide_credits: 0.2,
                starter_grant_credits: 10.0,
                plus_monthly_price_usd: 5.0,
                plus_monthly_credits: 30.0,
                pro_monthly_price_usd: 12.0,
                pro_monthly_credits: 80.0,
                bundle_small_price_usd: 2.0,
                bundle_small_credits: 10.0,
                bundle_large_price_usd: 10.0,
                bundle_large_credits: 65.0,
                tts_margin_review_required: true,
            },
        );

        assert!(alerts.iter().any(|alert| {
            alert == "google_oauth_enabled_but_required_google_oauth_env_is_incomplete"
        }));
        assert!(alerts.iter().any(|alert| {
            alert == "firebase_phone_auth_enabled_but_firebase_project_id_is_missing"
        }));
        assert!(alerts.iter().any(|alert| {
            alert == "partial_auth_secret_missing_for_google_to_phone_verification_handoff"
        }));
        assert!(alerts
            .iter()
            .any(|alert| alert == "tts_margin_review_required"));
    }

    #[test]
    fn graph_event_mapping_supports_action_progress() {
        let tutor_event = map_graph_event_to_tutor_event(
            ai_tutor_orchestrator::chat_graph::ChatGraphEvent {
                kind: ai_tutor_orchestrator::chat_graph::ChatGraphEventKind::ActionProgress,
                agent_id: Some("teacher-1".to_string()),
                agent_name: Some("Teacher".to_string()),
                action_name: Some("wb_draw_text".to_string()),
                action_params: Some(serde_json::json!({"content":"1/2"})),
                content: None,
                message: Some("in-flight".to_string()),
                director_state: None,
                whiteboard_state: None,
                interruption_reason: None,
                resume_allowed: None,
            },
            "session-test",
            "session-test",
            "stateless_client_state",
        );

        assert!(matches!(tutor_event.kind, TutorEventKind::ActionProgress));
        assert_eq!(tutor_event.action_name.as_deref(), Some("wb_draw_text"));
        assert_eq!(
            tutor_event
                .action_params
                .as_ref()
                .and_then(|params| params.get("schema_version"))
                .and_then(|value| value.as_str()),
            Some("runtime_action_v1")
        );
        assert_eq!(
            tutor_event
                .action_params
                .as_ref()
                .and_then(|params| params.get("action_name"))
                .and_then(|value| value.as_str()),
            Some("wb_draw_text")
        );
    }

    #[test]
    fn runtime_native_streaming_selector_parsing_is_trimmed() {
        let previous = std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS").ok();
        std::env::set_var(
            "AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS",
            " openai:gpt-4o-mini , anthropic ",
        );

        let selectors = runtime_native_streaming_selectors();
        assert_eq!(
            selectors,
            vec!["openai:gpt-4o-mini".to_string(), "anthropic".to_string()]
        );

        if let Some(value) = previous {
            std::env::set_var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS", value);
        } else {
            std::env::remove_var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS");
        }
    }

    #[test]
    fn queue_poll_ms_reads_env_override_with_default_fallback() {
        let previous = std::env::var("AI_TUTOR_QUEUE_POLL_MS").ok();
        std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", "1200");
        assert_eq!(queue_poll_ms(), 1200);
        std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", "0");
        assert_eq!(queue_poll_ms(), 500);
        std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", "invalid");
        assert_eq!(queue_poll_ms(), 500);
        if let Some(value) = previous {
            std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_POLL_MS");
        }
    }

    #[tokio::test]
    async fn generate_route_returns_json_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(Some(GenerateLessonResponse {
                lesson_id: "lesson-1".to_string(),
                job_id: "job-1".to_string(),
                url: "http://localhost:8099/lessons/lesson-1".to_string(),
                scenes_count: 2,
            })),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn generate_async_route_returns_accepted_json_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(Some(GenerateLessonResponse {
                lesson_id: "lesson-queued".to_string(),
                job_id: "job-queued".to_string(),
                url: "http://localhost:8099/lessons/lesson-queued".to_string(),
                scenes_count: 0,
            })),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate-async")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn cancel_job_route_returns_cancelled_job() {
        let cancelled_job = LessonGenerationJob {
            status: LessonGenerationJobStatus::Cancelled,
            step: LessonGenerationStep::Cancelled,
            progress: 100,
            message: "Lesson generation cancelled".to_string(),
            ..sample_job()
        };
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(Some(CancelLessonJobOutcome::Cancelled(cancelled_job))),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/cancel")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cancel_job_route_returns_conflict_for_running_job() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(Some(CancelLessonJobOutcome::AlreadyRunning)),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/cancel")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn resume_job_route_returns_accepted_job() {
        let resumed_job = LessonGenerationJob {
            status: LessonGenerationJobStatus::Queued,
            step: LessonGenerationStep::Queued,
            progress: 0,
            message: "Lesson generation re-queued".to_string(),
            ..sample_job()
        };
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(Some(ResumeLessonJobOutcome::Resumed(resumed_job))),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/resume")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn resume_job_route_returns_conflict_for_queued_job() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(Some(ResumeLessonJobOutcome::AlreadyQueuedOrRunning)),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/resume")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn job_and_lesson_routes_return_persisted_entities() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: Some(sample_job()),
            lesson: Some(sample_lesson()),
            audio_asset: None,
            media_asset: None,
        }));

        let job_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/jobs/job-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(job_response.status(), StatusCode::OK);

        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn lesson_events_route_streams_sse_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: Some(sample_lesson()),
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1/events")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/event-stream"
        );

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("session_started"));
        assert!(payload.contains("session_completed"));
    }

    #[tokio::test]
    async fn lesson_export_html_route_returns_downloadable_html() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: Some(sample_lesson()),
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1/export/html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default(),
            "text/html; charset=utf-8"
        );
        let content_disposition = response
            .headers()
            .get(header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert!(content_disposition.contains("attachment"));
        assert!(content_disposition.contains("lesson-lesson-1"));

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("<html>"));
        assert!(payload.contains("Teach fractions"));
    }

    #[tokio::test]
    async fn lesson_export_video_route_returns_downloadable_video_when_present() {
        let now = Utc::now().timestamp_millis();
        let mut lesson = sample_lesson();
        lesson.scenes = vec![Scene {
            id: "scene-video-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Video Scene".to_string(),
            order: 1,
            content: SceneContent::Slide {
                canvas: ai_tutor_domain::scene::SlideCanvas {
                    id: "canvas-1".to_string(),
                    viewport_width: 1280,
                    viewport_height: 720,
                    viewport_ratio: 16.0 / 9.0,
                    theme: ai_tutor_domain::scene::SlideTheme {
                        background_color: "#ffffff".to_string(),
                        theme_colors: vec!["#111111".to_string()],
                        font_color: "#111111".to_string(),
                        font_name: "Inter".to_string(),
                    },
                    elements: vec![ai_tutor_domain::scene::SlideElement::Video {
                        id: "video-1".to_string(),
                        left: 0.0,
                        top: 0.0,
                        width: 1280.0,
                        height: 720.0,
                        src: "/api/assets/media/lesson-1/scene-video.mp4".to_string(),
                    }],
                    background: None,
                },
            },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: Some(now),
            updated_at: Some(now),
        }];

        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: Some(lesson),
            audio_asset: None,
            media_asset: Some(vec![1_u8, 2, 3, 4]),
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1/export/video")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "video/mp4"
        );
        let content_disposition = response
            .headers()
            .get(header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert!(content_disposition.contains("attachment"));

        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(bytes.to_vec(), vec![1_u8, 2, 3, 4]);
    }

    #[tokio::test]
    async fn lesson_export_video_route_returns_bad_request_when_video_missing() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: Some(sample_lesson()),
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1/export/video")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn lesson_export_video_route_supports_legacy_classroom_media_src() {
        let now = Utc::now().timestamp_millis();
        let mut lesson = sample_lesson();
        lesson.scenes = vec![Scene {
            id: "scene-video-legacy".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Legacy Video Scene".to_string(),
            order: 1,
            content: SceneContent::Slide {
                canvas: ai_tutor_domain::scene::SlideCanvas {
                    id: "canvas-legacy".to_string(),
                    viewport_width: 1280,
                    viewport_height: 720,
                    viewport_ratio: 16.0 / 9.0,
                    theme: ai_tutor_domain::scene::SlideTheme {
                        background_color: "#ffffff".to_string(),
                        theme_colors: vec!["#111111".to_string()],
                        font_color: "#111111".to_string(),
                        font_name: "Inter".to_string(),
                    },
                    elements: vec![ai_tutor_domain::scene::SlideElement::Video {
                        id: "video-legacy".to_string(),
                        left: 0.0,
                        top: 0.0,
                        width: 1280.0,
                        height: 720.0,
                        src: "/api/classroom-media/lesson-1/media/legacy-scene-video.mp4".to_string(),
                    }],
                    background: None,
                },
            },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: Some(now),
            updated_at: Some(now),
        }];

        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: Some(lesson),
            audio_asset: None,
            media_asset: Some(vec![7_u8, 8, 9]),
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1/export/video")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "video/mp4"
        );
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(bytes.to_vec(), vec![7_u8, 8, 9]);
    }

    #[test]
    fn exportable_video_asset_ref_parses_local_file_name_fallback() {
        let parsed = parse_exportable_video_asset_ref("scene-video.webm", "lesson-fallback")
            .expect("expected fallback parse to succeed");
        assert_eq!(parsed.lesson_id, "lesson-fallback");
        assert_eq!(parsed.file_name, "scene-video.webm");
    }

    #[tokio::test]
    async fn runtime_chat_stream_route_returns_sse_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![
                TutorStreamEvent {
                    kind: TutorEventKind::SessionStarted,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: None,
                    agent_name: None,
                    action_name: None,
                    action_params: None,
                    execution_id: None,
                    ack_policy: None,
                    execution: None,
                    whiteboard_state: None,
                    content: None,
                    message: Some("Starting tutor turn".to_string()),
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::TextDelta,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: None,
                    action_params: None,
                    execution_id: None,
                    ack_policy: None,
                    execution: None,
                    whiteboard_state: None,
                    content: Some("Hello learner".to_string()),
                    message: None,
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::ActionStarted,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: Some("wb_open".to_string()),
                    action_params: Some(serde_json::json!({})),
                    execution_id: Some("session-1:wb_open:{}".to_string()),
                    ack_policy: Some(ActionAckPolicy::AckRequired),
                    execution: action_execution_metadata_for_name("wb_open"),
                    whiteboard_state: None,
                    content: None,
                    message: Some("Starting action wb_open".to_string()),
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::ActionCompleted,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: Some("wb_open".to_string()),
                    action_params: Some(serde_json::json!({})),
                    execution_id: Some("session-1:wb_open:{}".to_string()),
                    ack_policy: Some(ActionAckPolicy::AckRequired),
                    execution: action_execution_metadata_for_name("wb_open"),
                    whiteboard_state: Some(ai_tutor_runtime::whiteboard::WhiteboardState {
                        id: "session-1".to_string(),
                        is_open: true,
                        objects: vec![],
                        version: 1,
                    }),
                    content: None,
                    message: Some("Completed action wb_open".to_string()),
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::Done,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Completed),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: None,
                    action_params: None,
                    execution_id: None,
                    ack_policy: None,
                    execution: None,
                    whiteboard_state: None,
                    content: None,
                    message: Some("Tutor turn complete".to_string()),
                    interruption_reason: None,
                    resume_allowed: Some(false),
                    director_state: Some(DirectorState {
                        turn_count: 1,
                        agent_responses: vec![],
                        whiteboard_ledger: vec![],
                        whiteboard_state: None,
                    }),
                },
            ]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&StatelessChatRequest {
            session_id: None,
            runtime_session: Some(RuntimeSessionSelector {
                mode: RuntimeSessionMode::StatelessClientState,
                session_id: None,
                create_if_missing: None,
            }),
            messages: vec![ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: "Explain fractions".to_string(),
                metadata: None,
            }],
            store_state: ai_tutor_domain::runtime::ClientStageState {
                stage: None,
                scenes: vec![],
                current_scene_id: None,
                mode: ai_tutor_domain::runtime::RuntimeMode::Live,
                whiteboard_open: false,
            },
            config: ai_tutor_domain::runtime::StatelessChatConfig {
                agent_ids: vec!["assistant".to_string()],
                session_type: Some("discussion".to_string()),
                discussion_topic: Some("fractions".to_string()),
                discussion_prompt: None,
                trigger_agent_id: Some("assistant".to_string()),
                agent_configs: vec![],
            },
            director_state: None,
            user_profile: None,
            api_key: "test-key".to_string(),
            base_url: None,
            model: Some("openai:gpt-4o-mini".to_string()),
            provider_type: Some("openai".to_string()),
            requires_api_key: Some(true),
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/chat/stream")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/event-stream"
        );

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("text_delta"));
        assert!(payload.contains("action_started"));
        assert!(payload.contains("action_completed"));
        assert!(payload.contains("wb_open"));
        assert!(payload.contains("\"whiteboard_state\""));
        assert!(payload.contains("\"is_open\":true"));
        assert!(payload.contains("done"));
    }

    #[tokio::test]
    async fn runtime_action_ack_route_records_acknowledgements() {
        let service = Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        });
        let app = build_router(service.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/actions/ack")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "session_id": "session-ack",
                            "runtime_session_mode": "stateless_client_state",
                            "execution_id": "session-ack:wb_open:{}",
                            "action_name": "wb_open",
                            "status": "completed",
                            "error": null
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let recorded = service.action_acks.lock().unwrap().clone();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].execution_id, "session-ack:wb_open:{}");
        assert_eq!(recorded[0].status, "completed");
    }

    #[tokio::test]
    async fn live_service_runtime_action_acknowledgements_are_persisted_and_deduped() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );
        let event = TutorStreamEvent {
            kind: TutorEventKind::ActionStarted,
            session_id: "session-ack-persist".to_string(),
            runtime_session_id: Some("session-ack-persist".to_string()),
            runtime_session_mode: Some("stateless_client_state".to_string()),
            turn_status: Some(TutorTurnStatus::Running),
            agent_id: Some("teacher-1".to_string()),
            agent_name: Some("Ms. Rivera".to_string()),
            action_name: Some("wb_open".to_string()),
            action_params: Some(serde_json::json!({})),
            execution_id: Some("session-ack-persist:wb_open:{}".to_string()),
            ack_policy: Some(ActionAckPolicy::AckRequired),
            execution: action_execution_metadata_for_name("wb_open"),
            whiteboard_state: None,
            content: None,
            message: Some("Starting action wb_open".to_string()),
            interruption_reason: None,
            resume_allowed: None,
            director_state: None,
        };
        service
            .record_runtime_action_expectation(&event)
            .await
            .unwrap();
        let execution_id = event
            .execution_id
            .clone()
            .expect("action expectation should include execution id");

        let persisted = storage
            .get_runtime_action_execution(&execution_id)
            .await
            .unwrap()
            .expect("execution record should be persisted");
        assert_eq!(persisted.status, RuntimeActionExecutionStatus::Pending);

        let accepted = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: persisted.session_id.clone(),
                runtime_session_id: Some(persisted.session_id.clone()),
                runtime_session_mode: Some(persisted.runtime_session_mode.clone()),
                execution_id: execution_id.clone(),
                action_name: Some(persisted.action_name.clone()),
                status: "accepted".to_string(),
                error: None,
            })
            .await
            .unwrap();
        assert!(accepted.accepted);
        assert!(!accepted.duplicate);
        assert_eq!(accepted.current_status, "accepted");

        let completed = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: persisted.session_id.clone(),
                runtime_session_id: Some(persisted.session_id.clone()),
                runtime_session_mode: Some(persisted.runtime_session_mode.clone()),
                execution_id: execution_id.clone(),
                action_name: Some(persisted.action_name.clone()),
                status: "completed".to_string(),
                error: None,
            })
            .await
            .unwrap();
        assert!(completed.accepted);
        assert!(!completed.duplicate);
        assert_eq!(completed.current_status, "completed");

        let duplicate = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: persisted.session_id.clone(),
                runtime_session_id: Some(persisted.session_id.clone()),
                runtime_session_mode: Some(persisted.runtime_session_mode.clone()),
                execution_id: execution_id.clone(),
                action_name: Some(persisted.action_name.clone()),
                status: "completed".to_string(),
                error: None,
            })
            .await
            .unwrap();
        assert!(!duplicate.accepted);
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.current_status, "completed");

        let final_record = storage
            .get_runtime_action_execution(&execution_id)
            .await
            .unwrap()
            .expect("execution record should still exist");
        assert_eq!(final_record.status, RuntimeActionExecutionStatus::Completed);
    }

    #[tokio::test]
    async fn live_service_managed_runtime_action_expectations_use_runtime_session_id() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );
        let event = TutorStreamEvent {
            kind: TutorEventKind::ActionStarted,
            session_id: "transport-session".to_string(),
            runtime_session_id: Some("managed-runtime-session".to_string()),
            runtime_session_mode: Some("managed_runtime_session".to_string()),
            turn_status: Some(TutorTurnStatus::Running),
            agent_id: Some("teacher-1".to_string()),
            agent_name: Some("Ms. Rivera".to_string()),
            action_name: Some("wb_open".to_string()),
            action_params: Some(serde_json::json!({})),
            execution_id: Some("transport-session:wb_open:{}".to_string()),
            ack_policy: Some(ActionAckPolicy::AckRequired),
            execution: action_execution_metadata_for_name("wb_open"),
            whiteboard_state: None,
            content: None,
            message: Some("Starting action wb_open".to_string()),
            interruption_reason: None,
            resume_allowed: None,
            director_state: None,
        };

        service
            .record_runtime_action_expectation(&event)
            .await
            .unwrap();

        let persisted = storage
            .get_runtime_action_execution("transport-session:wb_open:{}")
            .await
            .unwrap()
            .expect("managed execution record should be persisted");
        assert_eq!(persisted.session_id, "managed-runtime-session");

        let managed_records = storage
            .list_runtime_action_executions_for_session("managed-runtime-session")
            .await
            .unwrap();
        assert_eq!(managed_records.len(), 1);

        let transport_records = storage
            .list_runtime_action_executions_for_session("transport-session")
            .await
            .unwrap();
        assert!(transport_records.is_empty());
    }

    #[tokio::test]
    async fn live_service_rejects_managed_runtime_resume_with_unresolved_action_execution() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );

        storage
            .save_runtime_session("managed-runtime-session", &empty_director_state())
            .await
            .unwrap();
        storage
            .save_runtime_action_execution(&RuntimeActionExecutionRecord {
                session_id: "managed-runtime-session".to_string(),
                runtime_session_mode: "managed_runtime_session".to_string(),
                execution_id: "managed-runtime-session:wb_open:{}".to_string(),
                action_name: "wb_open".to_string(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: 10,
                updated_at_unix_ms: 10,
                timeout_at_unix_ms: i64::MAX,
                last_error: None,
            })
            .await
            .unwrap();

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-runtime-session".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = None;

        let error = service
            .run_stateless_chat_graph(payload, "transport-session", None, None)
            .await
            .expect_err("resume should be blocked while unresolved actions remain");
        let message = format!("{error:#}");
        assert!(message.contains("unresolved action executions"));
        assert!(message.contains("wb_open"));
    }

    #[tokio::test]
    async fn live_service_runtime_action_ack_rejects_runtime_session_mismatch() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );

        storage
            .save_runtime_action_execution(&RuntimeActionExecutionRecord {
                session_id: "managed-runtime-session".to_string(),
                runtime_session_mode: "managed_runtime_session".to_string(),
                execution_id: "managed-runtime-session:wb_open:{}".to_string(),
                action_name: "wb_open".to_string(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: 10,
                updated_at_unix_ms: 10,
                timeout_at_unix_ms: i64::MAX,
                last_error: None,
            })
            .await
            .unwrap();

        let error = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: "transport-session".to_string(),
                runtime_session_id: Some("other-runtime-session".to_string()),
                runtime_session_mode: Some("managed_runtime_session".to_string()),
                execution_id: "managed-runtime-session:wb_open:{}".to_string(),
                action_name: Some("wb_open".to_string()),
                status: "accepted".to_string(),
                error: None,
            })
            .await
            .expect_err("mismatched runtime session should be rejected");
        assert!(format!("{error:#}").contains("session mismatch"));
    }

    #[tokio::test]
    async fn live_service_runtime_action_acknowledgements_time_out_before_replay() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );

        let record = RuntimeActionExecutionRecord {
            session_id: "session-timeout".to_string(),
            runtime_session_mode: "stateless_client_state".to_string(),
            execution_id: "session-timeout:wb_open:{}".to_string(),
            action_name: "wb_open".to_string(),
            status: RuntimeActionExecutionStatus::Pending,
            created_at_unix_ms: 10,
            updated_at_unix_ms: 10,
            timeout_at_unix_ms: 11,
            last_error: None,
        };
        storage
            .save_runtime_action_execution(&record)
            .await
            .unwrap();

        let response = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: record.session_id.clone(),
                runtime_session_id: Some(record.session_id.clone()),
                runtime_session_mode: Some(record.runtime_session_mode.clone()),
                execution_id: record.execution_id.clone(),
                action_name: Some(record.action_name.clone()),
                status: "completed".to_string(),
                error: None,
            })
            .await
            .unwrap();

        assert!(!response.accepted);
        assert!(response.duplicate);
        assert_eq!(response.current_status, "timed_out");

        let persisted = storage
            .get_runtime_action_execution(&record.execution_id)
            .await
            .unwrap()
            .expect("timed out record should still exist");
        assert_eq!(persisted.status, RuntimeActionExecutionStatus::TimedOut);
    }

    #[tokio::test]
    async fn live_service_runtime_pbl_chat_routes_question_mentions() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec!["Start with a quick waste audit of one day and compare categories.".to_string()],
        );

        let response = service
            .runtime_pbl_chat(sample_pbl_runtime_chat_request())
            .await
            .unwrap();

        assert_eq!(response.resolved_agent, "Question Agent");
        assert_eq!(response.messages.len(), 1);
        assert!(response.messages[0].message.contains("waste audit"));
        let workspace = response.workspace.expect("workspace should always be returned");
        assert_eq!(workspace.active_issue_id.as_deref(), Some("issue-1"));
    }

    #[tokio::test]
    async fn live_service_runtime_pbl_chat_advances_issue_on_judge_complete() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec!["COMPLETE. The evidence is strong enough to move forward.".to_string()],
        );

        let mut payload = sample_pbl_runtime_chat_request();
        payload.message = "@judge I finished the audit and summarized the evidence.".to_string();

        let response = service.runtime_pbl_chat(payload).await.unwrap();

        assert_eq!(response.resolved_agent, "Judge Agent");
        assert!(response
            .messages
            .iter()
            .any(|message| message.agent_name == "System"));
        let workspace = response.workspace.expect("workspace should advance");
        assert_eq!(workspace.active_issue_id.as_deref(), Some("issue-2"));
        assert!(workspace.issues[0].done);
        assert!(!workspace.issues[1].done);
    }

    #[tokio::test]
    async fn live_service_runtime_pbl_chat_persists_workspace_progression_by_session() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![
                "COMPLETE. The evidence is strong enough to move forward.".to_string(),
                "Let's keep improving the proposal details for the active issue.".to_string(),
            ],
        );

        let mut first = sample_pbl_runtime_chat_request();
        first.message = "@judge I finished the audit and summarized the evidence.".to_string();
        first.session_id = Some("scene-session-persist".to_string());

        let first_response = service.runtime_pbl_chat(first).await.unwrap();
        let first_workspace = first_response.workspace.expect("workspace should advance");
        assert_eq!(first_workspace.active_issue_id.as_deref(), Some("issue-2"));

        let mut second = sample_pbl_runtime_chat_request();
        second.message = "@question what is the next milestone now?".to_string();
        second.session_id = Some("scene-session-persist".to_string());

        let second_response = service.runtime_pbl_chat(second).await.unwrap();
        let second_workspace = second_response
            .workspace
            .expect("workspace should load from persisted session state");
        assert_eq!(second_workspace.active_issue_id.as_deref(), Some("issue-2"));
    }

    #[tokio::test]
    async fn runtime_chat_stream_route_rejects_missing_runtime_session_contract() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = None;

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/chat/stream")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("runtime_session"));
    }

    #[tokio::test]
    async fn runtime_chat_stream_route_rejects_ambiguous_managed_session_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-ambiguous".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = Some(empty_director_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/chat/stream")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("managed_runtime_session"));
        assert!(payload.contains("director_state"));
    }

    #[tokio::test]
    async fn live_service_stateless_chat_stream_aborts_on_downstream_disconnect() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let started = Arc::new(Notify::new());
        let cancelled = Arc::new(Notify::new());
        let started_wait = started.notified();
        let cancelled_wait = cancelled.notified();
        let service = build_live_chat_service_with_blocking_cancellable_provider(
            Arc::clone(&storage),
            Arc::clone(&started),
            Arc::clone(&cancelled),
        );

        let (sender, mut receiver) = mpsc::channel::<TutorStreamEvent>(8);
        let payload = sample_stateless_chat_request();
        let service_clone = Arc::clone(&service);
        let stream_task =
            tokio::spawn(async move { service_clone.stateless_chat_stream(payload, sender).await });

        let first_event =
            tokio::time::timeout(std::time::Duration::from_millis(150), receiver.recv())
                .await
                .expect("stream should send first event quickly")
                .expect("first event should exist");
        assert!(matches!(first_event.kind, TutorEventKind::SessionStarted));

        started_wait.await;
        drop(receiver);
        cancelled_wait.await;

        let completed = tokio::time::timeout(std::time::Duration::from_millis(250), stream_task)
            .await
            .expect("stream task should stop quickly after disconnect");
        let stream_result = completed.expect("stream task should join");
        assert!(
            stream_result.is_ok(),
            "stream should exit cleanly after disconnect"
        );
    }

    #[tokio::test]
    async fn audio_asset_route_returns_binary_audio() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: Some(vec![1, 2, 3, 4]),
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/audio/lesson-1/tts_action-1.mp3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "audio/mpeg"
        );
    }

    #[tokio::test]
    async fn media_asset_route_returns_binary_media() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: Some(vec![1, 2, 3, 4]),
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/media/lesson-1/image_image-1.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "image/png"
        );
    }

    #[tokio::test]
    async fn live_service_reads_persisted_lesson_and_job_from_file_storage() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let lesson = sample_lesson();
        let job = sample_job();

        storage.save_lesson(&lesson).await.unwrap();
        storage.create_job(&job).await.unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));

        let job_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/jobs/job-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(job_response.status(), StatusCode::OK);

        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn live_service_reads_persisted_lesson_from_sqlite_storage() {
        let root = temp_root();
        let lesson_db_path = root.join("runtime").join("lessons.db");
        let storage = Arc::new(FileStorage::with_lesson_db(&root, &lesson_db_path));
        let lesson = sample_lesson();

        storage.save_lesson(&lesson).await.unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));
        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
        assert!(lesson_db_path.exists());
    }

    #[tokio::test]
    async fn live_service_reads_persisted_audio_and_media_assets_from_file_storage() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let audio_dir = storage.assets_dir().join("audio").join("lesson-1");
        let media_dir = storage.assets_dir().join("media").join("lesson-1");
        std::fs::create_dir_all(&audio_dir).unwrap();
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(audio_dir.join("tts_action-1.mp3"), [1_u8, 2, 3, 4]).unwrap();
        std::fs::write(media_dir.join("image_image-1.png"), [5_u8, 6, 7, 8]).unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));

        let audio_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/assets/audio/lesson-1/tts_action-1.mp3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(audio_response.status(), StatusCode::OK);
        assert_eq!(
            audio_response.headers().get(header::CONTENT_TYPE).unwrap(),
            "audio/mpeg"
        );

        let media_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/media/lesson-1/image_image-1.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(media_response.status(), StatusCode::OK);
        assert_eq!(
            media_response.headers().get(header::CONTENT_TYPE).unwrap(),
            "image/png"
        );
    }

    #[tokio::test]
    async fn live_service_generates_and_persists_lesson_via_api_route() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let app = build_router(build_live_service_with_fakes(Arc::clone(&storage)));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(true),
            enable_video_generation: Some(false),
            enable_tts: Some(true),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();

        let generate_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(generate_response.status(), StatusCode::OK);

        let body = to_bytes(generate_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let generated: GenerateLessonResponse = serde_json::from_slice(&body).unwrap();
        assert!(generated.scenes_count >= 2);

        let lesson_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/lessons/{}", generated.lesson_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);

        let job_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/lessons/jobs/{}", generated.job_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(job_response.status(), StatusCode::OK);

        let lesson_bytes = to_bytes(lesson_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let lesson: Lesson = serde_json::from_slice(&lesson_bytes).unwrap();
        let speech_action = lesson
            .scenes
            .iter()
            .flat_map(|scene| scene.actions.iter())
            .find_map(|action| match action {
                ai_tutor_domain::action::LessonAction::Speech { audio_url, .. } => {
                    audio_url.clone()
                }
                _ => None,
            })
            .unwrap();
        assert!(speech_action.contains("/api/assets/audio/"));

        let image_src = lesson
            .scenes
            .iter()
            .find_map(|scene| match &scene.content {
                ai_tutor_domain::scene::SceneContent::Slide { canvas } => {
                    canvas.elements.iter().find_map(|element| match element {
                        ai_tutor_domain::scene::SlideElement::Image { src, .. } => {
                            Some(src.clone())
                        }
                        _ => None,
                    })
                }
                _ => None,
            })
            .unwrap();
        assert!(image_src.contains("/api/assets/media/"));
    }

    #[tokio::test]
    async fn live_service_generates_and_persists_lesson_via_async_api_route() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let app = build_router(build_live_service_with_fakes(Arc::clone(&storage)));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(true),
            enable_video_generation: Some(false),
            enable_tts: Some(true),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();

        let generate_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate-async")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(generate_response.status(), StatusCode::ACCEPTED);

        let body = to_bytes(generate_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let generated: GenerateLessonResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(generated.scenes_count, 0);

        let mut completed_job: Option<LessonGenerationJob> = None;
        for _ in 0..20 {
            let job_response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/api/lessons/jobs/{}", generated.job_id))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(job_response.status(), StatusCode::OK);
            let job_bytes = to_bytes(job_response.into_body(), usize::MAX)
                .await
                .unwrap();
            let job: LessonGenerationJob = serde_json::from_slice(&job_bytes).unwrap();
            if matches!(job.status, LessonGenerationJobStatus::Succeeded) {
                completed_job = Some(job);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        let completed_job = completed_job.expect("async job should complete");
        assert!(completed_job.result.is_some());

        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/lessons/{}", generated.lesson_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn generate_route_returns_internal_error_for_invalid_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "   ".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn missing_asset_routes_return_not_found() {
        let app = build_router(Arc::new(MockLessonAppService {
            google_login_response: Mutex::new(None),
            auth_session_response: Mutex::new(None),
            credit_balance: Mutex::new(None),
            credit_ledger: Mutex::new(None),
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let audio_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/assets/audio/lesson-1/missing.mp3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(audio_response.status(), StatusCode::NOT_FOUND);

        let media_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/media/lesson-1/missing.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(media_response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn live_service_marks_stale_job_failed_through_api_route() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let stale_time = Utc::now() - ChronoDuration::minutes(31);
        let request = LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
                web_search: Some(false),
            },
            pdf_content: None,
            enable_web_search: false,
            enable_image_generation: false,
            enable_video_generation: false,
            enable_tts: false,
            agent_mode: AgentMode::Default,
            account_id: None,
            generation_mode: None,
        };
        let job = LessonGenerationJob {
            id: "job-stale".to_string(),
            status: LessonGenerationJobStatus::Running,
            step: LessonGenerationStep::GeneratingScenes,
            progress: 60,
            message: "still running".to_string(),
            input_summary: LessonGenerationJobInputSummary::from(&request),
            scenes_generated: 1,
            total_scenes: Some(3),
            result: None,
            error: None,
            created_at: stale_time,
            updated_at: stale_time,
            started_at: Some(stale_time),
            completed_at: None,
        };
        storage.create_job(&job).await.unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/jobs/job-stale")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let persisted: LessonGenerationJob = serde_json::from_slice(&body).unwrap();
        assert!(matches!(
            persisted.status,
            LessonGenerationJobStatus::Failed
        ));
        assert!(matches!(persisted.step, LessonGenerationStep::Failed));
        assert!(persisted
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("Stale job"));
    }

    #[tokio::test]
    async fn live_service_cancels_queued_async_job_and_persists_cancelled_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();
        let job = build_queued_job("job-cancel-live".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        FileBackedLessonQueue::new(Arc::clone(&storage))
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-cancel-live".to_string(),
                job: job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();

        let outcome = service.cancel_job(&job.id).await.unwrap();
        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }
        let CancelLessonJobOutcome::Cancelled(cancelled_job) = outcome else {
            panic!("expected cancelled outcome");
        };
        assert!(matches!(
            cancelled_job.status,
            LessonGenerationJobStatus::Cancelled
        ));

        let persisted = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(
            persisted.status,
            LessonGenerationJobStatus::Cancelled
        ));
        assert!(matches!(persisted.step, LessonGenerationStep::Cancelled));
    }

    #[tokio::test]
    async fn live_service_resumes_cancelled_job_and_requeues_request_snapshot() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        let service = build_live_service_with_delayed_fakes(Arc::clone(&storage), 250);

        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
            account_id: None,
            generation_mode: None,
        })
        .unwrap();
        let now = chrono::Utc::now();
        let job = LessonGenerationJob {
            id: "job-resume-live".to_string(),
            status: LessonGenerationJobStatus::Cancelled,
            step: LessonGenerationStep::Cancelled,
            progress: 100,
            message: "Lesson generation cancelled".to_string(),
            input_summary: LessonGenerationJobInputSummary::from(&request),
            scenes_generated: 0,
            total_scenes: None,
            result: None,
            error: None,
            created_at: now,
            updated_at: now,
            started_at: None,
            completed_at: Some(now),
        };
        storage.create_job(&job).await.unwrap();
        storage
            .save_queued_job_snapshot(
                &job.id,
                &QueuedLessonJobSnapshot {
                    lesson_id: "lesson-resume-live".to_string(),
                    request,
                    model_string: Some("openai:gpt-4o-mini".to_string()),
                    max_attempts: 3,
                },
            )
            .await
            .unwrap();

        let outcome = service.resume_job(&job.id).await.unwrap();
        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }

        let ResumeLessonJobOutcome::Resumed(resumed_job) = outcome else {
            panic!("expected resumed outcome");
        };
        assert!(matches!(
            resumed_job.status,
            LessonGenerationJobStatus::Queued
        ));
        assert!(matches!(resumed_job.step, LessonGenerationStep::Queued));

        let queued_path = storage
            .root_dir()
            .join("lesson-queue")
            .join(format!("{}.json", job.id));
        let working_path = storage
            .root_dir()
            .join("lesson-queue")
            .join(format!("{}.json.working", job.id));
        assert!(queued_path.exists() || working_path.exists());
    }

    #[tokio::test]
    async fn live_service_billing_maintenance_recovered_intent_runtime_coverage() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        storage
            .create_invoice(&Invoice {
                id: "inv-recovered-rt-1".to_string(),
                account_id: "acct-recovered-rt-1".to_string(),
                invoice_type: InvoiceType::SubscriptionRenewal,
                billing_cycle_start: now - chrono::Duration::days(30),
                billing_cycle_end: now,
                status: InvoiceStatus::Overdue,
                amount_cents: 1299,
                amount_after_credits: 1299,
                created_at: now - chrono::Duration::days(2),
                finalized_at: Some(now - chrono::Duration::days(2)),
                paid_at: None,
                due_at: Some(now - chrono::Duration::days(1)),
                updated_at: now - chrono::Duration::days(2),
            })
            .await
            .unwrap();

        storage
            .save_payment_order(&PaymentOrder {
                id: "order-recovered-rt-1".to_string(),
                account_id: "acct-recovered-rt-1".to_string(),
                product_code: "plus_monthly".to_string(),
                product_kind: BillingProductKind::Subscription,
                gateway: "easebuzz".to_string(),
                gateway_txn_id: "txn-recovered-rt-1".to_string(),
                gateway_payment_id: Some("pay-recovered-rt-1".to_string()),
                amount_minor: 1299,
                currency: "USD".to_string(),
                credits_to_grant: 100.0,
                status: PaymentOrderStatus::Succeeded,
                checkout_url: None,
                udf1: None,
                udf2: None,
                udf3: None,
                udf4: None,
                udf5: None,
                raw_response: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now,
                completed_at: Some(now),
            })
            .await
            .unwrap();

        storage
            .create_payment_intent(&PaymentIntent {
                id: "pi-order-recovered-rt-1".to_string(),
                account_id: "acct-recovered-rt-1".to_string(),
                invoice_id: "inv-recovered-rt-1".to_string(),
                status: PaymentIntentStatus::Failed,
                amount_cents: 1299,
                idempotency_key: "inv-recovered-rt-1:1".to_string(),
                payment_method_id: None,
                gateway_payment_intent_id: Some("pay-recovered-rt-1".to_string()),
                authorize_error: Some("payment_failed".to_string()),
                authorized_at: None,
                captured_at: None,
                canceled_at: None,
                attempt_count: 1,
                next_retry_at: Some(now - chrono::Duration::minutes(10)),
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        storage
            .create_dunning_case(&DunningCase {
                id: "dc-recovered-rt-1".to_string(),
                account_id: "acct-recovered-rt-1".to_string(),
                invoice_id: "inv-recovered-rt-1".to_string(),
                payment_intent_id: "pi-order-recovered-rt-1".to_string(),
                status: DunningStatus::Active,
                attempt_schedule: vec![],
                grace_period_end: now + chrono::Duration::days(7),
                final_attempt_at: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        let report = service.run_billing_maintenance_cycle().await.unwrap();
        assert_eq!(report.retried_payment_intents, 1);
        assert_eq!(report.exhausted_dunning_cases, 0);

        let intent = storage
            .get_payment_intent("pi-order-recovered-rt-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(intent.status, PaymentIntentStatus::Captured));

        let invoice = storage
            .get_invoice("inv-recovered-rt-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(invoice.status, InvoiceStatus::Paid));

        let dunning = storage
            .get_dunning_case_by_invoice_id("inv-recovered-rt-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(dunning.status, DunningStatus::Recovered));
    }

    #[tokio::test]
    async fn live_service_billing_maintenance_exhausted_intent_runtime_coverage() {
        let previous_max_attempts = std::env::var("AI_TUTOR_DUNNING_MAX_ATTEMPTS").ok();
        std::env::set_var("AI_TUTOR_DUNNING_MAX_ATTEMPTS", "2");

        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(Arc::clone(&storage), vec![]);
        let now = chrono::Utc::now();

        storage
            .create_invoice(&Invoice {
                id: "inv-exhausted-rt-1".to_string(),
                account_id: "acct-exhausted-rt-1".to_string(),
                invoice_type: InvoiceType::SubscriptionRenewal,
                billing_cycle_start: now - chrono::Duration::days(30),
                billing_cycle_end: now,
                status: InvoiceStatus::Overdue,
                amount_cents: 1299,
                amount_after_credits: 1299,
                created_at: now - chrono::Duration::days(2),
                finalized_at: Some(now - chrono::Duration::days(2)),
                paid_at: None,
                due_at: Some(now - chrono::Duration::days(1)),
                updated_at: now - chrono::Duration::days(2),
            })
            .await
            .unwrap();

        storage
            .save_payment_order(&PaymentOrder {
                id: "order-exhausted-rt-1".to_string(),
                account_id: "acct-exhausted-rt-1".to_string(),
                product_code: "plus_monthly".to_string(),
                product_kind: BillingProductKind::Subscription,
                gateway: "easebuzz".to_string(),
                gateway_txn_id: "txn-exhausted-rt-1".to_string(),
                gateway_payment_id: Some("pay-exhausted-rt-1".to_string()),
                amount_minor: 1299,
                currency: "USD".to_string(),
                credits_to_grant: 100.0,
                status: PaymentOrderStatus::Failed,
                checkout_url: None,
                udf1: None,
                udf2: None,
                udf3: None,
                udf4: None,
                udf5: None,
                raw_response: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now,
                completed_at: Some(now),
            })
            .await
            .unwrap();

        storage
            .create_payment_intent(&PaymentIntent {
                id: "pi-order-exhausted-rt-1".to_string(),
                account_id: "acct-exhausted-rt-1".to_string(),
                invoice_id: "inv-exhausted-rt-1".to_string(),
                status: PaymentIntentStatus::Failed,
                amount_cents: 1299,
                idempotency_key: "inv-exhausted-rt-1:1".to_string(),
                payment_method_id: None,
                gateway_payment_intent_id: Some("pay-exhausted-rt-1".to_string()),
                authorize_error: Some("payment_failed".to_string()),
                authorized_at: None,
                captured_at: None,
                canceled_at: None,
                attempt_count: 1,
                next_retry_at: Some(now - chrono::Duration::minutes(10)),
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        storage
            .create_dunning_case(&DunningCase {
                id: "dc-exhausted-rt-1".to_string(),
                account_id: "acct-exhausted-rt-1".to_string(),
                invoice_id: "inv-exhausted-rt-1".to_string(),
                payment_intent_id: "pi-order-exhausted-rt-1".to_string(),
                status: DunningStatus::Active,
                attempt_schedule: vec![],
                grace_period_end: now + chrono::Duration::days(7),
                final_attempt_at: None,
                created_at: now - chrono::Duration::days(2),
                updated_at: now - chrono::Duration::hours(1),
            })
            .await
            .unwrap();

        let report = service.run_billing_maintenance_cycle().await.unwrap();

        if let Some(value) = previous_max_attempts {
            std::env::set_var("AI_TUTOR_DUNNING_MAX_ATTEMPTS", value);
        } else {
            std::env::remove_var("AI_TUTOR_DUNNING_MAX_ATTEMPTS");
        }

        assert_eq!(report.retried_payment_intents, 0);
        assert_eq!(report.exhausted_dunning_cases, 1);

        let intent = storage
            .get_payment_intent("pi-order-exhausted-rt-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(intent.status, PaymentIntentStatus::Abandoned));

        let invoice = storage
            .get_invoice("inv-exhausted-rt-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(invoice.status, InvoiceStatus::Uncollectible));

        let dunning = storage
            .get_dunning_case_by_invoice_id("inv-exhausted-rt-1")
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(dunning.status, DunningStatus::Exhausted));
    }
}
