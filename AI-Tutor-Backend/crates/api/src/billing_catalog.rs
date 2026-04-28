/// Billing product definitions and catalog.
///
/// This module delegates to the env-var-driven billing catalog in `app.rs`
/// to ensure a single source of truth for product codes, prices, and credits.
/// The subscription scheduler and other internal consumers import from here.
use serde::{Deserialize, Serialize};
use ai_tutor_domain::billing::BillingProductKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingProductDefinition {
    pub product_code: String,
    pub kind: BillingProductKind,
    pub title: String,
    pub credits: f64,
    pub currency: String,
    pub amount_minor: i64,
}

/// Returns the billing catalog.
///
/// Products are driven by environment variables with sensible defaults.
/// This is the single source of truth — the API layer and the subscription
/// scheduler both use this function.
pub fn billing_catalog() -> Vec<BillingProductDefinition> {
    let currency = billing_currency();
    vec![
        BillingProductDefinition {
            product_code: "plus_monthly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "AI Tutor Plus Monthly".to_string(),
            credits: env_f64("AI_TUTOR_PLUS_MONTHLY_CREDITS", 30.0),
            currency: currency.clone(),
            amount_minor: env_i64(
                "AI_TUTOR_PLUS_MONTHLY_PRICE_MINOR",
                (env_f64("AI_TUTOR_PLUS_MONTHLY_PRICE_USD", 5.0) * 100.0).round() as i64,
            ),
        },
        BillingProductDefinition {
            product_code: "pro_monthly".to_string(),
            kind: BillingProductKind::Subscription,
            title: "AI Tutor Pro Monthly".to_string(),
            credits: env_f64("AI_TUTOR_PRO_MONTHLY_CREDITS", 80.0),
            currency: currency.clone(),
            amount_minor: env_i64(
                "AI_TUTOR_PRO_MONTHLY_PRICE_MINOR",
                (env_f64("AI_TUTOR_PRO_MONTHLY_PRICE_USD", 12.0) * 100.0).round() as i64,
            ),
        },
        BillingProductDefinition {
            product_code: "bundle_small".to_string(),
            kind: BillingProductKind::Bundle,
            title: "AI Tutor Credit Bundle Small".to_string(),
            credits: env_f64("AI_TUTOR_BUNDLE_SMALL_CREDITS", 10.0),
            currency: currency.clone(),
            amount_minor: env_i64(
                "AI_TUTOR_BUNDLE_SMALL_PRICE_MINOR",
                (env_f64("AI_TUTOR_BUNDLE_SMALL_PRICE_USD", 5.0) * 100.0).round() as i64,
            ),
        },
        BillingProductDefinition {
            product_code: "bundle_large".to_string(),
            kind: BillingProductKind::Bundle,
            title: "AI Tutor Credit Bundle Large".to_string(),
            credits: env_f64("AI_TUTOR_BUNDLE_LARGE_CREDITS", 65.0),
            currency,
            amount_minor: env_i64(
                "AI_TUTOR_BUNDLE_LARGE_PRICE_MINOR",
                (env_f64("AI_TUTOR_BUNDLE_LARGE_PRICE_USD", 32.5) * 100.0).round() as i64,
            ),
        },
    ]
}

pub fn billing_currency() -> String {
    std::env::var("AI_TUTOR_BILLING_CURRENCY")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "USD".to_string())
}

pub fn billing_product_kind_label(kind: &BillingProductKind) -> &'static str {
    match kind {
        BillingProductKind::Subscription => "subscription",
        BillingProductKind::Bundle => "bundle",
    }
}

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
