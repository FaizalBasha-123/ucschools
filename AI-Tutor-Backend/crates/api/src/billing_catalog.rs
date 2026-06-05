/// Billing product catalog - single source of truth for all plans and bundles.
///
/// Plans are in INR (paise). International users pay USD via Stripe at checkout
/// time (conversion handled by the checkout endpoint, not here).
///
/// Credit consumption formula:
///   session_credits = (seconds / 60) * quality_rate * pedagogy_multiplier
///   pdf_credits     = 1.0 + (pages * 0.20)
use serde::{Deserialize, Serialize};
use ai_tutor_domain::billing::{BillingProductKind, LearningMode, QualityMode};

// -----------------------------------------------------------------------------
// Plan definitions
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingProductDefinition {
    pub product_code: String,
    pub kind: BillingProductKind,
    pub title: String,
    pub description: String,
    /// Credits granted when this product is purchased.
    pub credits: f64,
    /// ISO-4217 currency code for the primary price. "INR" for India, "USD" for international.
    pub currency: String,
    /// Amount in smallest currency unit (paise for INR, cents for USD).
    pub amount_minor: i64,
    /// 18% GST added at checkout for Indian customers (in paise, pre-computed).
    pub gst_amount_minor: i64,
    /// Which quality modes this plan unlocks (cumulative - premium includes standard).
    pub allowed_quality_modes: Vec<QualityMode>,
    /// Which learning modes this plan unlocks.
    pub allowed_learning_modes: Vec<LearningMode>,
    /// UI hint: whether to highlight this plan on the pricing page.
    pub is_highlighted: bool,
}

fn gst(base_amount_minor: i64) -> i64 {
    (base_amount_minor as f64 * 0.18).round() as i64
}

// Impls for credits_per_minute and credit_multiplier are already defined in ai_tutor_domain::billing

/// Called by the generate handler before deducting credits.
pub fn compute_session_credits(duration_seconds: u64, quality: QualityMode, learning: LearningMode) -> f64 {
    let minutes = duration_seconds as f64 / 60.0;
    minutes * quality.credits_per_minute() * learning.credit_multiplier()
}

/// Called by the PDF parser when ingesting context documents.
pub fn compute_pdf_credits(pages: u32) -> f64 {
    1.0 + (pages as f64 * 0.20)
}

/// Returns the billing catalog.
/// This is the single source of truth — the API layer and the subscription
/// scheduler both use this function.
pub fn billing_catalog() -> Vec<BillingProductDefinition> {
    vec![
        // 💎 FREE PILOT ($0) 💎
        BillingProductDefinition {
            product_code: "free".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Free Pilot".to_string(),
            description: "Discover what the AI Tutor can do for you.".to_string(),
            credits: 20.0,
            currency: "INR".to_string(),
            amount_minor: 0,
            gst_amount_minor: 0,
            allowed_quality_modes: vec![QualityMode::Standard],
            allowed_learning_modes: vec![LearningMode::Revision],
            is_highlighted: false,
        },
        // 💎 STARTER ($10) 💎
        BillingProductDefinition {
            product_code: "starter".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Starter".to_string(),
            description: "Essential tools for indie learners and students.".to_string(),
            credits: 40.0,
            currency: "INR".to_string(),
            amount_minor: 84900,
            gst_amount_minor: gst(84900),
            allowed_quality_modes: vec![QualityMode::Standard],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain],
            is_highlighted: false,
        },
        // 💎 PRO - EDUCATOR ($25) 💎
        BillingProductDefinition {
            product_code: "pro".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Pro (Educator)".to_string(),
            description: "Fast-moving educators building curriculums.".to_string(),
            credits: 100.0,
            currency: "INR".to_string(),
            amount_minor: 210000,
            gst_amount_minor: gst(210000),
            allowed_quality_modes: vec![QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain, LearningMode::Exam],
            is_highlighted: true,
        },
        // 💎 BUSINESS - ACADEMY ($50) 💎
        BillingProductDefinition {
            product_code: "power".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Business (Academy)".to_string(),
            description: "Advanced features for growing departments and academies.".to_string(),
            credits: 200.0,
            currency: "INR".to_string(),
            amount_minor: 420000,
            gst_amount_minor: gst(420000),
            allowed_quality_modes: vec![QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain, LearningMode::Exam, LearningMode::PlacementPrep],
            is_highlighted: false,
        },
        // ---------------------------------------------------------
        // YEARLY VARIANTS (20% OFF)
        // ---------------------------------------------------------
        BillingProductDefinition {
            product_code: "starter_yearly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Starter (Yearly)".to_string(),
            description: "Essential tools for indie learners and students.".to_string(),
            credits: 40.0,
            currency: "INR".to_string(),
            amount_minor: 815000, 
            gst_amount_minor: gst(815000),
            allowed_quality_modes: vec![QualityMode::Standard],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain],
            is_highlighted: false,
        },
        BillingProductDefinition {
            product_code: "pro_yearly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Pro (Yearly)".to_string(),
            description: "Fast-moving educators building curriculums.".to_string(),
            credits: 100.0,
            currency: "INR".to_string(),
            amount_minor: 2016000, 
            gst_amount_minor: gst(2016000),
            allowed_quality_modes: vec![QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain, LearningMode::Exam],
            is_highlighted: true,
        },
        BillingProductDefinition {
            product_code: "power_yearly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Business (Yearly)".to_string(),
            description: "Advanced features for growing departments and academies.".to_string(),
            credits: 200.0,
            currency: "INR".to_string(),
            amount_minor: 4032000, 
            gst_amount_minor: gst(4032000),
            allowed_quality_modes: vec![QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain, LearningMode::Exam, LearningMode::PlacementPrep],
            is_highlighted: false,
        },
        // ---------------------------------------------------------
        // TOP-UP PACKS (1 Credit = $0.25)
        // ---------------------------------------------------------
        BillingProductDefinition {
            product_code: "pack_20".to_string(),
            kind: BillingProductKind::Bundle,
            title: "20 Credits".to_string(),
            description: "Quick top-up for your sessions ($5.00 value).".to_string(),
            credits: 20.0,
            currency: "INR".to_string(),
            amount_minor: 42000,
            gst_amount_minor: gst(42000),
            allowed_quality_modes: vec![],
            allowed_learning_modes: vec![],
            is_highlighted: false,
        },
        BillingProductDefinition {
            product_code: "pack_100".to_string(),
            kind: BillingProductKind::Bundle,
            title: "100 Credits".to_string(),
            description: "Best value top-up pack ($25.00 value).".to_string(),
            credits: 100.0,
            currency: "INR".to_string(),
            amount_minor: 210000,
            gst_amount_minor: gst(210000),
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
