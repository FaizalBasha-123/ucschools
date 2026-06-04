/// Dual-bucket wallet system (Lago prepaid wallet equivalent).
///
/// Credits are stored in two separate buckets:
/// - `promo`  — free grants, promo code redemptions, signup credits
/// - `paid`   — payment purchases, subscription renewals
///
/// Deduction order (mirrors Lago): promo bucket is drained first.
/// This means paid credits are preserved as long as free credits exist.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::credits::round_credits;

/// Which wallet bucket a credit entry belongs to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CreditBucket {
    /// Free grants: promo codes, signup credits, operator manual grants.
    Promo,
    /// Paid credits: payment purchases and subscription cycle renewals.
    #[default]
    Paid,
}

impl CreditBucket {
    pub fn as_str(self) -> &'static str {
        match self {
            CreditBucket::Promo => "promo",
            CreditBucket::Paid  => "paid",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "promo" => Some(CreditBucket::Promo),
            "paid"  => Some(CreditBucket::Paid),
            _       => None,
        }
    }
}

impl std::fmt::Display for CreditBucket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// The dual-bucket wallet balance for an account.
/// Replaces the old single `credit_balances` as the primary balance store.
/// `credit_balances` is kept in sync for backward compatibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletBalance {
    pub account_id: String,
    /// Free / promotional credits. Drained first on any debit.
    pub promo_balance: f64,
    /// Paid credits from purchases and subscription renewals.
    pub paid_balance: f64,
    pub updated_at: DateTime<Utc>,
}

impl WalletBalance {
    /// Total available balance (promo + paid).
    pub fn total(&self) -> f64 {
        round_credits(self.promo_balance + self.paid_balance)
    }

    /// Whether the wallet has enough to cover the requested debit.
    pub fn can_afford(&self, amount: f64) -> bool {
        self.total() >= amount
    }

    /// Compute how a debit of `amount` is split between buckets.
    /// Promo credits are consumed first (Lago pattern).
    /// Returns `None` if the wallet cannot afford the debit.
    pub fn compute_debit_split(&self, amount: f64) -> Option<DebitSplit> {
        if !self.can_afford(amount) {
            return None;
        }
        let promo_debited = round_credits(amount.min(self.promo_balance));
        let paid_debited  = round_credits(amount - promo_debited);
        Some(DebitSplit { promo_debited, paid_debited })
    }
}

impl Default for WalletBalance {
    fn default() -> Self {
        Self {
            account_id: String::new(),
            promo_balance: 0.0,
            paid_balance: 0.0,
            updated_at: Utc::now(),
        }
    }
}

/// How a debit is split across promo and paid buckets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebitSplit {
    /// Amount taken from the promo bucket.
    pub promo_debited: f64,
    /// Amount taken from the paid bucket.
    pub paid_debited: f64,
}

impl DebitSplit {
    pub fn total(&self) -> f64 {
        round_credits(self.promo_debited + self.paid_debited)
    }
}

/// The result of applying a debit to the wallet (returned by the repository).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletDebitResult {
    pub account_id: String,
    pub promo_debited: f64,
    pub paid_debited: f64,
    pub total_debited: f64,
    /// Wallet state after the debit.
    pub new_promo_balance: f64,
    pub new_paid_balance: f64,
}

impl WalletDebitResult {
    pub fn new_total(&self) -> f64 {
        round_credits(self.new_promo_balance + self.new_paid_balance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debit_split_promo_first() {
        let wallet = WalletBalance {
            account_id: "acc1".into(),
            promo_balance: 3.0,
            paid_balance: 10.0,
            updated_at: Utc::now(),
        };
        let split = wallet.compute_debit_split(5.0).unwrap();
        assert_eq!(split.promo_debited, 3.0);
        assert_eq!(split.paid_debited, 2.0);
    }

    #[test]
    fn debit_split_only_promo_sufficient() {
        let wallet = WalletBalance {
            account_id: "acc1".into(),
            promo_balance: 10.0,
            paid_balance: 0.0,
            updated_at: Utc::now(),
        };
        let split = wallet.compute_debit_split(4.0).unwrap();
        assert_eq!(split.promo_debited, 4.0);
        assert_eq!(split.paid_debited, 0.0);
    }

    #[test]
    fn debit_split_insufficient() {
        let wallet = WalletBalance {
            account_id: "acc1".into(),
            promo_balance: 1.0,
            paid_balance: 1.0,
            updated_at: Utc::now(),
        };
        assert!(wallet.compute_debit_split(5.0).is_none());
    }

    #[test]
    fn total_balance() {
        let wallet = WalletBalance {
            account_id: "acc1".into(),
            promo_balance: 2.5,
            paid_balance: 7.5,
            updated_at: Utc::now(),
        };
        assert_eq!(wallet.total(), 10.0);
    }
}
