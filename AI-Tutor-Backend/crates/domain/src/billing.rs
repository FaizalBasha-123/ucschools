use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Quality Mode (AI model tier) ──────────────────────────────────────────────
/// Which AI model stack to use. Controls cost, quality, and model selection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum QualityMode {
    /// Cheapest stack — Gemini Flash / DeepSeek V3 / Llama 8B / Kokoro TTS
    Basic,
    /// Balanced stack — DeepSeek V3 full / Flux Dev / mid-tier TTS
    #[default]
    Standard,
    /// Premium stack — Claude Haiku orchestrator / DeepSeek+Claude refine / ElevenLabs TTS
    Premium,
}

impl QualityMode {
    /// Voice credits consumed per minute at this quality tier.
    pub fn credits_per_minute(self) -> f64 {
        match self {
            QualityMode::Basic    => 0.4,
            QualityMode::Standard => 0.8,
            QualityMode::Premium  => 1.5,
        }
    }

    /// Env-var prefix used to resolve model IDs for this mode.
    pub fn env_prefix(self) -> &'static str {
        match self {
            QualityMode::Basic    => "BASIC_MODE_",
            QualityMode::Standard => "STANDARD_MODE_",
            QualityMode::Premium  => "PREMIUM_MODE_",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            QualityMode::Basic    => "basic",
            QualityMode::Standard => "standard",
            QualityMode::Premium  => "premium",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "basic"    => Some(QualityMode::Basic),
            "standard" => Some(QualityMode::Standard),
            "premium"  => Some(QualityMode::Premium),
            // legacy aliases from old UI
            "balanced" => Some(QualityMode::Standard),
            "best"     => Some(QualityMode::Premium),
            _          => None,
        }
    }
}

// ── Learning Mode (Pedagogy) ──────────────────────────────────────────────────
/// The pedagogical style of the generated lesson.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum LearningMode {
    /// Deep, structured teaching with detailed explanations.
    #[default]
    Explain,
    /// Quick revision summary, bullet-points, memory triggers.
    Revision,
    /// MCQ/short-answer questions with a timer-friendly format.
    Exam,
    /// Interview / aptitude / placement preparation format.
    PlacementPrep,
}

impl LearningMode {
    /// Credit multiplier applied on top of the quality-mode base rate.
    pub fn credit_multiplier(self) -> f64 {
        match self {
            LearningMode::Explain      => 1.6,
            LearningMode::Revision     => 0.6,
            LearningMode::Exam         => 1.3,
            LearningMode::PlacementPrep => 2.0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            LearningMode::Explain       => "explain",
            LearningMode::Revision      => "revision",
            LearningMode::Exam          => "exam",
            LearningMode::PlacementPrep => "placement_prep",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "explain"        => Some(LearningMode::Explain),
            "revision"       => Some(LearningMode::Revision),
            "exam"           => Some(LearningMode::Exam),
            "placement_prep" | "placement" => Some(LearningMode::PlacementPrep),
            _                => None,
        }
    }
}

// ── Billing Product ───────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BillingProductKind {
    /// Monthly subscription granting a credit pool each cycle.
    Subscription,
    /// One-time credit purchase bundle.
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
    /// Quality mode allowed by this plan (basic/standard/premium).
    pub quality_mode: QualityMode,
    /// Learning modes unlocked by this plan.
    pub allowed_learning_modes: Vec<LearningMode>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── API Usage Record ──────────────────────────────────────────────────────────
/// Tracks per-request AI provider usage for operator cost monitoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiUsageRecord {
    pub id: String,
    pub account_id: String,
    /// Model identifier as used in OpenRouter/Groq (e.g. "deepseek/deepseek-chat-v3-0324")
    pub model_id: String,
    /// Provider: "openrouter" | "groq" | "elevenlabs"
    pub provider: String,
    /// Functional component: "orchestrator" | "content" | "scene_actions" | "image" | "tts" | "pdf"
    pub component: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// Cost in USD millicents (1/1000 of a cent) to avoid floats in storage.
    pub cost_usd_millicents: i64,
    pub created_at: DateTime<Utc>,
}

impl ApiUsageRecord {
    /// Compute cost using OpenRouter's published per-million-token rates.
    pub fn compute_cost_millicents(
        input_tokens: i64,
        output_tokens: i64,
        input_cost_per_1m_usd: f64,
        output_cost_per_1m_usd: f64,
    ) -> i64 {
        let input_cost  = (input_tokens  as f64 / 1_000_000.0) * input_cost_per_1m_usd  * 100_000.0;
        let output_cost = (output_tokens as f64 / 1_000_000.0) * output_cost_per_1m_usd * 100_000.0;
        (input_cost + output_cost).round() as i64
    }

    pub fn cost_usd(&self) -> f64 {
        self.cost_usd_millicents as f64 / 100_000.0
    }
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

// ── Credit Calculators ────────────────────────────────────────────────────────

/// Calculate credits for a lesson generation (duration-based, kept for reference).
/// Formula: (duration_secs / 60) * quality_rate * learning_multiplier
pub fn lesson_credits(quality: QualityMode, learning: LearningMode, duration_secs: f64) -> f64 {
    let base = (duration_secs / 60.0) * quality.credits_per_minute();
    base * learning.credit_multiplier()
}

/// Fixed lesson credit matrix. Cost is deterministic per (quality, learning) pair.
/// This is the primary pricing surface — NOT duration-based.
pub fn lesson_credits_fixed(quality: QualityMode, learning: LearningMode) -> f64 {
    match (quality, learning) {
        (QualityMode::Basic,    LearningMode::Revision)      => 1.2,
        (QualityMode::Basic,    LearningMode::Explain)       => 2.0,
        (QualityMode::Basic,    LearningMode::Exam)          => 3.0,
        (QualityMode::Basic,    LearningMode::PlacementPrep) => 4.0,
        (QualityMode::Standard, LearningMode::Revision)      => 2.0,
        (QualityMode::Standard, LearningMode::Explain)       => 4.0,
        (QualityMode::Standard, LearningMode::Exam)          => 5.0,
        (QualityMode::Standard, LearningMode::PlacementPrep) => 6.0,
        (QualityMode::Premium,  LearningMode::Revision)      => 3.5,
        (QualityMode::Premium,  LearningMode::Explain)       => 6.0,
        (QualityMode::Premium,  LearningMode::Exam)          => 7.0,
        (QualityMode::Premium,  LearningMode::PlacementPrep) => 9.0,
    }
}

/// Calculate credits for extra scenes beyond the target scene count.
///
/// Extra scenes are priced at reduced margin (~55% vs 65% base) to provide
/// generous overage without surprise costs. The per-scene cost is ~78% of
/// the base per-scene rate (ratio of 0.35/0.45 margin conversion).
///
/// Formula: (base_credits / target_scenes) * extra_count * 0.78
/// Minimum: extra_count * 0.1 credits (floor to avoid zero-cost extras).
pub fn extra_scene_credits(
    quality: QualityMode,
    learning: LearningMode,
    target_scenes: usize,
    extra_count: usize,
) -> f64 {
    if extra_count == 0 || target_scenes == 0 {
        return 0.0;
    }
    let base = lesson_credits_fixed(quality, learning);
    let per_scene = base / target_scenes as f64;
    let raw = per_scene * extra_count as f64 * 0.78;
    // Floor: minimum 0.1 credits per extra scene
    let min_floor = extra_count as f64 * 0.1;
    raw.max(min_floor)
}

/// Calculate credits for PDF analysis.
/// Formula: page_count * 0.05 — no minimum floor.
pub fn pdf_credits(page_count: u32) -> f64 {
    page_count as f64 * 0.1
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImageAnalysisAction {
    View,
    BasicCaption,
    DeepExplanation,
}

/// Image analysis credit costs.
pub fn image_credits(action: ImageAnalysisAction) -> f64 {
    match action {
        ImageAnalysisAction::View => 0.0,
        ImageAnalysisAction::BasicCaption => 0.5,
        ImageAnalysisAction::DeepExplanation => 3.0,
    }
}
