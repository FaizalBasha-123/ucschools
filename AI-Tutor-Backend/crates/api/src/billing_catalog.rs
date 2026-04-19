/// Billing product definitions and catalog
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

pub fn billing_catalog() -> Vec<BillingProductDefinition> {
    vec![
        BillingProductDefinition {
            product_code: "bundle_small".to_string(),
            kind: BillingProductKind::Bundle,
            title: "Small Bundle".to_string(),
            credits: 500.0,
            currency: billing_currency(),
            amount_minor: 19_900, // ₹199
        },
        BillingProductDefinition {
            product_code: "bundle_large".to_string(),
            kind: BillingProductKind::Bundle,
            title: "Large Bundle".to_string(),
            credits: 2000.0,
            currency: billing_currency(),
            amount_minor: 49_900, // ₹499
        },
        BillingProductDefinition {
            product_code: "subscription_pro".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Pro Subscription".to_string(),
            credits: 1000.0, // per month
            currency: billing_currency(),
            amount_minor: 29_900, // ₹299/month
        },
        BillingProductDefinition {
            product_code: "subscription_team".to_string(),
            kind: BillingProductKind::Subscription,
            title: "Team Subscription".to_string(),
            credits: 5000.0, // per month
            currency: billing_currency(),
            amount_minor: 99_900, // ₹999/month
        },
    ]
}

pub fn billing_currency() -> String {
    "INR".to_string()
}

pub fn billing_product_kind_label(kind: &BillingProductKind) -> &'static str {
    match kind {
        BillingProductKind::Subscription => "subscription",
        BillingProductKind::Bundle => "bundle",
    }
}
