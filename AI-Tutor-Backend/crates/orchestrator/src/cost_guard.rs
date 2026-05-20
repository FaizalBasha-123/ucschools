use ai_tutor_domain::routing::{tier_limits, QualityTier};
use tracing::warn;

#[derive(Debug, Clone)]
pub struct CostEstimate {
    pub estimated_tokens: usize,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CostDecision {
    Allow,
    Compress,
    Warn,
    Deny,
}

/// Per-tier cost per token (blended input+output, USD).
/// Based on the primary content model for each tier:
/// - Basic: Gemini Flash ($0.15/$0.60 per 1M) → blended ~$0.0000004/token
/// - Standard: DeepSeek V3 ($0.27/$1.10 per 1M) → blended ~$0.0000007/token
/// - Premium: Claude Sonnet ($3.00/$15.00 per 1M) → blended ~$0.000009/token
const fn cost_per_token(tier: QualityTier) -> f64 {
    match tier {
        QualityTier::Basic => 0.000_000_4,
        QualityTier::Standard => 0.000_000_7,
        QualityTier::Premium => 0.000_009_0,
    }
}

/// Track cumulative generation cost across a multi-scene pipeline.
/// Used to ensure the total lesson does not exceed the tier's hard budget.
#[derive(Debug, Clone, Default)]
pub struct BudgetTracker {
    /// Running total estimated cost across all scenes.
    pub total_estimated_cost_usd: f64,
    /// Number of scenes processed so far.
    pub scenes_processed: usize,
    /// Whether the budget has been exceeded.
    pub exceeded: bool,
}

impl BudgetTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a cost estimate for a scene and check if budget is exceeded.
    /// Returns the cost decision for this individual scene.
    pub fn record_scene(&mut self, estimate: &CostEstimate, tier: QualityTier) -> CostDecision {
        self.scenes_processed += 1;
        self.total_estimated_cost_usd += estimate.estimated_cost_usd;

        let limits = tier_limits(tier);
        if self.total_estimated_cost_usd > limits.max_cost_usd_per_request {
            self.exceeded = true;
            warn!(
                "BudgetTracker: total ${:.6} exceeds limit ${:.6} (tier={:?}, scenes={})",
                self.total_estimated_cost_usd,
                limits.max_cost_usd_per_request,
                tier,
                self.scenes_processed
            );
            CostDecision::Deny
        } else {
            enforce_budget(&tier, estimate)
        }
    }

    /// Estimate total cost for all outlines before generation starts.
    /// Returns Deny if the total would exceed the tier budget.
    pub fn check_outlines(&self, outlines: &[&str], tier: QualityTier) -> CostDecision {
        let total_tokens: usize = outlines.iter().map(|o| estimate_tokens(o)).sum();
        let cost = total_tokens as f64 * cost_per_token(tier);
        let limits = tier_limits(tier);

        if cost > limits.max_cost_usd_per_request {
            warn!(
                "BudgetTracker OUTLINE DENY: est_cost=${:.6} > limit=${:.6} (tier={:?}, scenes={})",
                cost,
                limits.max_cost_usd_per_request,
                tier,
                outlines.len()
            );
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
    let cp_token = cost_per_token(*tier);
    CostEstimate {
        estimated_tokens,
        estimated_cost_usd: estimated_tokens as f64 * cp_token,
    }
}

/// Enforce generation budget before calling the LLM.
///
/// Returns a decision on how to proceed:
/// - `Allow`    — within budget, proceed normally.
/// - `Compress` — tokens above threshold; caller should strip extra context.
/// - `Warn`     — cost approaching limit; log and continue.
/// - `Deny`     — hard budget exceeded; skip this generation block.
pub fn enforce_budget(tier: &QualityTier, estimate: &CostEstimate) -> CostDecision {
    let limits = tier_limits(*tier);

    if estimate.estimated_cost_usd > limits.max_cost_usd_per_request {
        warn!(
            "CostGuard DENY: est_cost=${:.6} > limit=${:.6} (tier={:?})",
            estimate.estimated_cost_usd, limits.max_cost_usd_per_request, tier
        );
        return CostDecision::Deny;
    }

    match tier {
        QualityTier::Basic if estimate.estimated_tokens > 2000 => {
            warn!(
                "CostGuard COMPRESS: Basic tokens {} > 2000",
                estimate.estimated_tokens
            );
            CostDecision::Compress
        }
        QualityTier::Standard if estimate.estimated_tokens > 5000 => {
            warn!(
                "CostGuard WARN: Standard tokens {} > 5000",
                estimate.estimated_tokens
            );
            CostDecision::Warn
        }
        QualityTier::Premium if estimate.estimated_tokens > 10000 => {
            warn!(
                "CostGuard WARN: Premium tokens {} > 10000",
                estimate.estimated_tokens
            );
            CostDecision::Warn
        }
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
            estimated_cost_usd: 0.00005,
        };
        assert_eq!(
            enforce_budget(&QualityTier::Basic, &estimate),
            CostDecision::Allow
        );
    }

    #[test]
    fn cost_decision_compress_for_large_basic_input() {
        let estimate = CostEstimate {
            estimated_tokens: 3000,
            estimated_cost_usd: 0.001,
        };
        assert_eq!(
            enforce_budget(&QualityTier::Basic, &estimate),
            CostDecision::Compress
        );
    }

    #[test]
    fn cost_decision_deny_over_budget() {
        let estimate = CostEstimate {
            estimated_tokens: 100,
            estimated_cost_usd: 99.0,
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
            basic.estimated_cost_usd < premium.estimated_cost_usd,
            "Basic({}) should cost less than Premium({})",
            basic.estimated_cost_usd,
            premium.estimated_cost_usd
        );
    }

    #[test]
    fn budget_tracker_denies_after_exceeded() {
        let mut tracker = BudgetTracker::new();
        let cheap = CostEstimate {
            estimated_tokens: 100,
            estimated_cost_usd: 0.001,
        };
        assert_eq!(
            tracker.record_scene(&cheap, QualityTier::Basic),
            CostDecision::Allow
        );
        // Second scene pushes total over Basic's $0.01 limit
        let expensive = CostEstimate {
            estimated_tokens: 50000,
            estimated_cost_usd: 0.02,
        };
        assert_eq!(
            tracker.record_scene(&expensive, QualityTier::Basic),
            CostDecision::Deny
        );
        assert!(tracker.exceeded);
    }

    #[test]
    fn budget_tracker_outline_check_denies_large_lesson() {
        let tracker = BudgetTracker::new();
        // Single outline with 200K chars → ~50K tokens × $0.0000004 = $0.02 > $0.01 (Basic limit)
        let huge_text = "A very long text that would cost a lot to generate. ".repeat(3300);
        let lines_refs = vec![huge_text.as_str()];
        let decision = tracker.check_outlines(&lines_refs, QualityTier::Basic);
        assert_eq!(decision, CostDecision::Deny);
    }
}
