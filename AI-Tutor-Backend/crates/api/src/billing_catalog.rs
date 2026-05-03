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
        // 💎 FREE (₹0) 💎
        BillingProductDefinition {
            product_code: "free".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Free Tier".to_string(),
            description: "Essential AI learning tools for quick study sessions.".to_string(),
            credits: 20.0,
            currency: "INR".to_string(),
            amount_minor: 0,
            gst_amount_minor: 0,
            allowed_quality_modes: vec![QualityMode::Standard],
            allowed_learning_modes: vec![LearningMode::Revision],
            is_highlighted: false,
        },
        // 💎 STARTER (₹499) 💎
        BillingProductDefinition {
            product_code: "starter".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Starter".to_string(),
            description: "Perfect for regular students needing consistent AI help.".to_string(),
            credits: 180.0,
            currency: "INR".to_string(),
            amount_minor: 49900,
            gst_amount_minor: gst(49900),
            allowed_quality_modes: vec![QualityMode::Standard],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain],
            is_highlighted: false,
        },
        // 💎 PRO (₹999) 💎
        BillingProductDefinition {
            product_code: "pro".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Pro".to_string(),
            description: "Advanced features and priority support for dedicated learners.".to_string(),
            credits: 650.0,
            currency: "INR".to_string(),
            amount_minor: 99900,
            gst_amount_minor: gst(99900),
            allowed_quality_modes: vec![QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain, LearningMode::Exam],
            is_highlighted: true,
        },
        // 💎 POWER (₹2999) 💎
        BillingProductDefinition {
            product_code: "power".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Power".to_string(),
            description: "Unlimited potential with massive credits for ultimate performance.".to_string(),
            credits: 1800.0,
            currency: "INR".to_string(),
            amount_minor: 299900,
            gst_amount_minor: gst(299900),
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
            description: "Perfect for regular students needing consistent AI help.".to_string(),
            credits: 180.0,
            currency: "INR".to_string(),
            amount_minor: 479000, // 499 * 12 * 0.8 ≈ 4790
            gst_amount_minor: gst(479000),
            allowed_quality_modes: vec![QualityMode::Standard],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain],
            is_highlighted: false,
        },
        BillingProductDefinition {
            product_code: "pro_yearly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Pro (Yearly)".to_string(),
            description: "Advanced features and priority support for dedicated learners.".to_string(),
            credits: 650.0,
            currency: "INR".to_string(),
            amount_minor: 959000, // 999 * 12 * 0.8 ≈ 9590
            gst_amount_minor: gst(959000),
            allowed_quality_modes: vec![QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain, LearningMode::Exam],
            is_highlighted: true,
        },
        BillingProductDefinition {
            product_code: "power_yearly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Power (Yearly)".to_string(),
            description: "Unlimited potential with massive credits for ultimate performance.".to_string(),
            credits: 1800.0,
            currency: "INR".to_string(),
            amount_minor: 2879000, // 2999 * 12 * 0.8 ≈ 28790
            gst_amount_minor: gst(2879000),
            allowed_quality_modes: vec![QualityMode::Standard, QualityMode::Premium],
            allowed_learning_modes: vec![LearningMode::Revision, LearningMode::Explain, LearningMode::Exam, LearningMode::PlacementPrep],
            is_highlighted: false,
        },
        // ---------------------------------------------------------
        // CREDIT PACKS
        // ---------------------------------------------------------
        BillingProductDefinition {
            product_code: "pack_150".to_string(),
            kind: BillingProductKind::Bundle,
            title: "150 Credits".to_string(),
            description: "Quick top-up for your session.".to_string(),
            credits: 150.0,
            currency: "INR".to_string(),
            amount_minor: 19900,
            gst_amount_minor: gst(19900),
            allowed_quality_modes: vec![],
            allowed_learning_modes: vec![],
            is_highlighted: false,
        },
        BillingProductDefinition {
            product_code: "pack_500".to_string(),
            kind: BillingProductKind::Bundle,
            title: "500 Credits".to_string(),
            description: "Best value credit pack.".to_string(),
            credits: 500.0,
            currency: "INR".to_string(),
            amount_minor: 49900,
            gst_amount_minor: gst(49900),
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
