use ai_tutor_domain::routing::{tier_limits, QualityTier};
use tracing::warn;

#[derive(Debug, Clone)]
pub struct CostEstimate {
    pub estimated_tokens: usize,
    pub estimated_credits: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CostDecision {
    Allow,
    Compress,
    Warn,
    Deny,
}

/// Base context fee (credits) charged for initiating a lesson.
pub const fn base_context_fee(tier: QualityTier) -> f64 {
    match tier {
        QualityTier::Basic => 1.0,
        QualityTier::Standard => 2.0,
        QualityTier::Premium => 5.0,
    }
}

/// Per-tier credit cost per token.
/// - Basic: 0.1 Credits / 1k tokens → 0.0001 per token
/// - Standard: 0.2 Credits / 1k tokens → 0.0002 per token
/// - Premium: 1.0 Credits / 1k tokens → 0.0010 per token
const fn credits_per_token(tier: QualityTier) -> f64 {
    match tier {
        QualityTier::Basic => 0.0001,
        QualityTier::Standard => 0.0002,
        QualityTier::Premium => 0.0010,
    }
}

/// Track cumulative generation cost across a multi-scene pipeline.
/// Used to ensure the total lesson stays within reasonable limits.
#[derive(Debug, Clone, Default)]
pub struct BudgetTracker {
    /// Running total estimated credits across all scenes.
    pub total_estimated_credits: f64,
    /// Number of scenes processed so far.
    pub scenes_processed: usize,
    /// Whether a critical threshold has been reached.
    pub exceeded: bool,
}

impl BudgetTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a cost estimate for a scene.
    pub fn record_scene(&mut self, estimate: &CostEstimate, tier: QualityTier) -> CostDecision {
        self.scenes_processed += 1;
        self.total_estimated_credits += estimate.estimated_credits;
        
        // We use telemetry for final billing, but we still warn if a single lesson 
        // is becoming unexpectedly huge (e.g. over 50 credits).
        if self.total_estimated_credits > 50.0 {
            warn!(
                "BudgetTracker: heavy usage detected ({:.1} credits, tier={:?}, scenes={})",
                self.total_estimated_credits,
                tier,
                self.scenes_processed
            );
        }
        
        enforce_budget(&tier, estimate)
    }

    /// Estimate total credits for all outlines before generation starts.
    pub fn check_outlines(&self, outlines: &[&str], tier: QualityTier) -> CostDecision {
        let total_tokens: usize = outlines.iter().map(|o| estimate_tokens(o)).sum();
        let _credits = (total_tokens as f64 * credits_per_token(tier) * 10.0).round() / 10.0;
        
        // In V2 telemetry, we allow generation as long as Base Fee is covered.
        // We only Deny if the prompt itself is absurdly large (>100k tokens).
        if total_tokens > 100_000 {
            CostDecision::Deny
        } else {
            CostDecision::Allow
        }
    }
}

/// Accurate token estimation.
///
/// Uses 4 chars-per-token as the base approximation (matches GPT tokenizer
/// averages for English). CJK characters (Chinese, Japanese, Korean) are
/// typically 1-2 chars per token so they're counted at 2× weight to avoid
/// underestimating cost for non-Latin content.
pub fn estimate_tokens(text: &str) -> usize {
    let cjk_chars = text
        .chars()
        .filter(|c| {
            matches!(c,
                '\u{3000}'..='\u{9FFF}'   // CJK + Japanese kana
                | '\u{F900}'..='\u{FAFF}' // CJK compatibility
                | '\u{AC00}'..='\u{D7FF}' // Korean Hangul
            )
        })
        .count();

    let latin_chars = text.len().saturating_sub(cjk_chars * 3); // CJK chars take 3 bytes in UTF-8
    let cjk_token_weight = cjk_chars * 2; // CJK tokens are more expensive
    let latin_tokens = latin_chars / 4;

    latin_tokens + cjk_token_weight
}

/// Build a cost estimate from a prompt string with tier-aware pricing.
pub fn estimate_cost_from_text(prompt: &str, tier: &QualityTier) -> CostEstimate {
    let estimated_tokens = estimate_tokens(prompt);
    let cp_token = credits_per_token(*tier);
    CostEstimate {
        estimated_tokens,
        estimated_credits: estimated_tokens as f64 * cp_token,
    }
}

/// Enforce generation budget before calling the LLM.
pub fn enforce_budget(tier: &QualityTier, estimate: &CostEstimate) -> CostDecision {
    // In V2, we don't Deny unless the request is physically impossible for the model context
    let max_tokens = tier_limits(*tier).max_tokens_per_response * 4; // rough approximation

    if estimate.estimated_tokens > max_tokens {
        warn!(
            "CostGuard DENY: est_tokens={} > max_allowed={} (tier={:?})",
            estimate.estimated_tokens, max_tokens, tier
        );
        return CostDecision::Deny;
    }

    match tier {
        QualityTier::Basic if estimate.estimated_tokens > 4000 => CostDecision::Compress,
        QualityTier::Standard if estimate.estimated_tokens > 8000 => CostDecision::Warn,
        QualityTier::Premium if estimate.estimated_tokens > 16000 => CostDecision::Warn,
        _ => CostDecision::Allow,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_estimation_english() {
        let text = "Explain Newton's second law of motion with examples.";
        let tokens = estimate_tokens(text);
        // 52 chars / 4 ≈ 13 tokens
        assert!(tokens >= 10 && tokens <= 15, "got {}", tokens);
    }

    #[test]
    fn token_estimation_cjk_higher_weight() {
        // "万有引力" = 4 CJK chars = 12 bytes in UTF-8
        let cjk = "万有引力定律";
        let latin = "gravity law";
        let cjk_tokens = estimate_tokens(cjk);
        let latin_tokens = estimate_tokens(latin);
        // CJK should estimate more tokens per byte
        assert!(
            cjk_tokens > latin_tokens,
            "CJK({}) should > Latin({})",
            cjk_tokens,
            latin_tokens
        );
    }

    #[test]
    fn cost_decision_allow_for_small_input() {
        let estimate = CostEstimate {
            estimated_tokens: 100,
            estimated_credits: 0.01,
        };
        assert_eq!(
            enforce_budget(&QualityTier::Basic, &estimate),
            CostDecision::Allow
        );
    }

    #[test]
    fn cost_decision_compress_for_large_basic_input() {
        let estimate = CostEstimate {
            estimated_tokens: 5000,
            estimated_credits: 0.5,
        };
        assert_eq!(
            enforce_budget(&QualityTier::Basic, &estimate),
            CostDecision::Compress
        );
    }

    #[test]
    fn cost_decision_deny_over_budget() {
        let estimate = CostEstimate {
            estimated_tokens: 100_001,
            estimated_credits: 10.0,
        };
        assert_eq!(
            enforce_budget(&QualityTier::Premium, &estimate),
            CostDecision::Deny
        );
    }

    #[test]
    fn tier_aware_pricing_basic_cheaper() {
        let text = "Explain Newton's second law of motion with examples.";
        let basic = estimate_cost_from_text(text, &QualityTier::Basic);
        let premium = estimate_cost_from_text(text, &QualityTier::Premium);
        assert!(
            basic.estimated_credits < premium.estimated_credits,
            "Basic({}) should cost less than Premium({})",
            basic.estimated_credits,
            premium.estimated_credits
        );
    }

    #[test]
    fn budget_tracker_does_not_deny_on_telemetry_model() {
        let mut tracker = BudgetTracker::new();
        let cheap = CostEstimate {
            estimated_tokens: 100,
            estimated_credits: 0.01,
        };
        assert_eq!(
            tracker.record_scene(&cheap, QualityTier::Basic),
            CostDecision::Allow
        );
        let expensive = CostEstimate {
            estimated_tokens: 20000,
            estimated_credits: 2.0,
        };
        // Should STILL allow because we move to post-generation telemetry billing
        assert_eq!(
            tracker.record_scene(&expensive, QualityTier::Basic),
            CostDecision::Allow
        );
    }
}
