use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CreditEntryKind {
    Grant,
    Debit,
    Refund,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLedgerEntry {
    pub id: String,
    pub account_id: String,
    pub kind: CreditEntryKind,
    pub amount: f64,
    pub reason: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditBalance {
    pub account_id: String,
    pub balance: f64,
    pub updated_at: DateTime<Utc>,
}

/// Promo code for granting credits (anti-abuse hardened).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromoCode {
    pub code: String,
    /// Amount of credits granted per redemption.
    pub grant_credits: f64,
    /// Max number of accounts that can redeem this code (None = unlimited).
    pub max_redemptions: Option<usize>,
    /// Accounts that have already redeemed this code (enforces one-per-account).
    pub redeemed_by_accounts: Vec<String>,
    /// When this promo code expires (None = no expiry).
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl PromoCode {
    /// Check if this promo code is still valid (not expired, not exhausted, not already used by account).
    pub fn is_valid_for_account(&self, account_id: &str) -> bool {
        // Check expiry
        if let Some(expiry) = self.expires_at {
            if Utc::now() > expiry {
                return false;
            }
        }

        // Check if account already redeemed
        if self.redeemed_by_accounts.contains(&account_id.to_string()) {
            return false;
        }

        // Check max redemptions
        if let Some(max) = self.max_redemptions {
            if self.redeemed_by_accounts.len() >= max {
                return false;
            }
        }

        true
    }
}

/// Request to redeem a promo code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedeemPromoCodeRequest {
    pub code: String,
}

/// Response from redeeming a promo code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedeemPromoCodeResponse {
    pub success: bool,
    pub message: String,
    pub credits_granted: f64,
}
