/// Billing product catalog — single source of truth for all plans and bundles.
///
/// Plans are in INR (paise). International users pay USD via Stripe at checkout
/// time (conversion handled by the checkout endpoint, not here).
///
/// Credit consumption formula:
///   session_credits = (seconds / 60) × quality_rate × pedagogy_multiplier
///   pdf_credits     = 1.0 + (pages × 0.20)
use serde::{Deserialize, Serialize};
use ai_tutor_domain::billing::{BillingProductKind, LearningMode, QualityMode};

// ─────────────────────────────────────────────────────────────────────────────
// Plan definitions
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingProductDefinition {
    pub product_code: String,
    pub kind: BillingProductKind,
    pub title: String,
    /// Credits granted when this product is purchased.
    pub credits: f64,
    /// ISO-4217 currency code for the primary price. "INR" for India, "USD" for international.
    pub currency: String,
    /// Amount in smallest currency unit (paise for INR, cents for USD).
    pub amount_minor: i64,
    /// 18% GST added at checkout for Indian customers (in paise, pre-computed).
    pub gst_amount_minor: i64,
    /// Which quality modes this plan unlocks (cumulative — premium includes standard).
    pub allowed_quality_modes: Vec<QualityMode>,
    /// Which learning modes this plan unlocks.
    pub allowed_learning_modes: Vec<LearningMode>,
    /// Human-readable description shown on the pricing page.
    pub description: String,
    /// Whether this plan is highlighted as the recommended option.
    pub is_highlighted: bool,
}

impl BillingProductDefinition {
    /// Whether this plan allows a specific quality mode.
    pub fn allows_quality_mode(&self, mode: QualityMode) -> bool {
        self.allowed_quality_modes.contains(&mode)
    }

    /// Whether this plan allows a specific learning mode.
    pub fn allows_learning_mode(&self, mode: LearningMode) -> bool {
        self.allowed_learning_modes.contains(&mode)
    }

    /// Total INR amount including GST (in paise).
    pub fn total_with_gst_minor(&self) -> i64 {
        self.amount_minor + self.gst_amount_minor
    }
}

/// Compute 18% GST for an amount in paise (rounds to nearest paisa).
fn gst(amount_minor: i64) -> i64 {
    (amount_minor as f64 * 0.18).round() as i64
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan entitlement helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Check if a plan_code allows a given quality+learning mode combination.
/// Called by the generate handler before deducting credits.
pub fn plan_allows_modes(plan_code: &str, quality: QualityMode, learning: LearningMode) -> bool {
    let catalog = billing_catalog();
    let Some(plan) = catalog.iter().find(|p| p.product_code == plan_code) else {
        return false;
    };
    plan.allows_quality_mode(quality) && plan.allows_learning_mode(learning)
}

/// Compute the credit cost for a lesson session.
///   duration_seconds: actual or estimated session length
///   quality:  which model stack was used
///   learning: which pedagogy mode was used
pub fn compute_session_credits(duration_seconds: u64, quality: QualityMode, learning: LearningMode) -> f64 {
    let minutes = duration_seconds as f64 / 60.0;
    minutes * quality.credits_per_minute() * learning.credit_multiplier()
}

/// Compute the credit cost for processing a PDF.
///   pages: number of pages in the PDF
pub fn compute_pdf_credits(pages: u32) -> f64 {
    1.0 + (pages as f64 * 0.20)
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the complete product catalog. Prices are driven by env-vars with
/// hard-coded INR defaults matching the final pricing spec.
pub fn billing_catalog() -> Vec<BillingProductDefinition> {
    vec![
        // ── BASIC (₹799) ──────────────────────────────────────────────────
        BillingProductDefinition {
            product_code: "basic_monthly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Basic".to_string(),
            description: "20 credits/month. Basic features and access. Great for quick explanations.".to_string(),
            credits: env_f64("AI_TUTOR_BASIC_CREDITS", 20.0),
            currency: "INR".to_string(),
            amount_minor: env_i64("AI_TUTOR_BASIC_PRICE_MINOR", 79900), // ₹799
            gst_amount_minor: gst(env_i64("AI_TUTOR_BASIC_PRICE_MINOR", 79900)),
            allowed_quality_modes: vec![QualityMode::Basic],
            allowed_learning_modes: vec![
                LearningMode::Explain,
                LearningMode::Revision,
            ],
            is_highlighted: false,
        },

        // ── STANDARD (₹1299) ─────────────────────────────────────────────────────
        BillingProductDefinition {
            product_code: "standard_monthly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Standard".to_string(),
            description: "50 credits/month. Standard AI capabilities with limited exam preparation.".to_string(),
            credits: env_f64("AI_TUTOR_STANDARD_CREDITS", 50.0),
            currency: "INR".to_string(),
            amount_minor: env_i64("AI_TUTOR_STANDARD_PRICE_MINOR", 129900), // ₹1299
            gst_amount_minor: gst(env_i64("AI_TUTOR_STANDARD_PRICE_MINOR", 129900)),
            allowed_quality_modes: vec![QualityMode::Basic, QualityMode::Standard],
            allowed_learning_modes: vec![
                LearningMode::Explain,
                LearningMode::Revision,
                LearningMode::Exam,
                LearningMode::PlacementPrep, // limited
            ],
            is_highlighted: true,
        },

        // ── PREMIUM (₹1999) ────────────────────────────────────────────────────
        BillingProductDefinition {
            product_code: "premium_monthly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Premium".to_string(),
            description: "100 credits/month. Full premium AI capabilities and limitless learning.".to_string(),
            credits: env_f64("AI_TUTOR_PREMIUM_CREDITS", 100.0),
            currency: "INR".to_string(),
            amount_minor: env_i64("AI_TUTOR_PREMIUM_PRICE_MINOR", 199900), // ₹1999
            gst_amount_minor: gst(env_i64("AI_TUTOR_PREMIUM_PRICE_MINOR", 199900)),
            allowed_quality_modes: vec![QualityMode::Basic, QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![
                LearningMode::Explain,
                LearningMode::Revision,
                LearningMode::Exam,
                LearningMode::PlacementPrep,
            ],
            is_highlighted: false,
        },

        // ── BUNDLE SMALL — ₹159 → 300 credits ─────────────────────────────────
        BillingProductDefinition {
            product_code: "bundle_small".to_string(),
            kind: BillingProductKind::Bundle,
            title: "Credit Pack — 300".to_string(),
            description: "Top up 300 credits instantly. No subscription required.".to_string(),
            credits: env_f64("AI_TUTOR_BUNDLE_SMALL_CREDITS", 300.0),
            currency: "INR".to_string(),
            amount_minor: env_i64("AI_TUTOR_BUNDLE_SMALL_PRICE_MINOR", 15900), // ₹159
            gst_amount_minor: gst(env_i64("AI_TUTOR_BUNDLE_SMALL_PRICE_MINOR", 15900)),
            allowed_quality_modes: vec![],
            allowed_learning_modes: vec![],
            is_highlighted: false,
        },

        // ── BUNDLE LARGE — ₹399 → 1000 credits ────────────────────────────────
        BillingProductDefinition {
            product_code: "bundle_large".to_string(),
            kind: BillingProductKind::Bundle,
            title: "Credit Pack — 1000".to_string(),
            description: "Top up 1000 credits instantly. Best value add-on.".to_string(),
            credits: env_f64("AI_TUTOR_BUNDLE_LARGE_CREDITS", 1000.0),
            currency: "INR".to_string(),
            amount_minor: env_i64("AI_TUTOR_BUNDLE_LARGE_PRICE_MINOR", 39900), // ₹399
            gst_amount_minor: gst(env_i64("AI_TUTOR_BUNDLE_LARGE_PRICE_MINOR", 39900)),
            allowed_quality_modes: vec![],
            allowed_learning_modes: vec![],
            is_highlighted: true,
        },
    ]
}

/// Returns only subscription-type plans (not bundles/packs).
pub fn subscription_plans() -> Vec<BillingProductDefinition> {
    billing_catalog()
        .into_iter()
        .filter(|p| p.kind == BillingProductKind::Subscription)
        .collect()
}

/// Returns only credit bundle/pack products.
pub fn credit_bundles() -> Vec<BillingProductDefinition> {
    billing_catalog()
        .into_iter()
        .filter(|p| p.kind == BillingProductKind::Bundle)
        .collect()
}

/// Look up a product by its code.
pub fn find_product(product_code: &str) -> Option<BillingProductDefinition> {
    billing_catalog()
        .into_iter()
        .find(|p| p.product_code == product_code)
}

/// The billing currency for the primary market. Used by the subscription scheduler.
pub fn billing_currency() -> String {
    std::env::var("AI_TUTOR_BILLING_CURRENCY")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "INR".to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Env-var helpers
// ─────────────────────────────────────────────────────────────────────────────

fn env_f64(key: &str, default: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(default)
}

fn env_i64(key: &str, default: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(default)
}
