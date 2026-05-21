use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub fn round_credits(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

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
    /// Max total redemptions across all accounts (None = unlimited).
    pub max_redemptions: Option<usize>,
    /// Max unique accounts that can redeem this code (None = unlimited).
    #[serde(default)]
    pub max_accounts: Option<usize>,
    /// Max times a single account can redeem this code (None = defaults to 1).
    #[serde(default)]
    pub max_uses_per_account: Option<usize>,
    /// Accounts that have redeemed this code (can contain duplicates if redeemed multiple times).
    pub redeemed_by_accounts: Vec<String>,
    /// When this promo code expires (None = no expiry).
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl PromoCode {
    /// Check if this promo code is still valid (not expired, not exhausted, not already used by account max times).
    pub fn is_valid_for_account(&self, account_id: &str) -> bool {
        // Check expiry
        if let Some(expiry) = self.expires_at {
            if Utc::now() > expiry {
                return false;
            }
        }

        // Check total redemptions
        if let Some(max) = self.max_redemptions {
            if self.redeemed_by_accounts.len() >= max {
                return false;
            }
        }

        // Check account uses
        let uses_by_account = self.redeemed_by_accounts.iter().filter(|&id| id == account_id).count();
        let max_uses = self.max_uses_per_account.unwrap_or(1);
        if uses_by_account >= max_uses {
            return false;
        }

        // Check max unique accounts ONLY if the account hasn't already started using it
        if uses_by_account == 0 {
            if let Some(max_acc) = self.max_accounts {
                let unique_accounts = self.redeemed_by_accounts.iter().collect::<std::collections::HashSet<_>>().len();
                if unique_accounts >= max_acc {
                    return false;
                }
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
