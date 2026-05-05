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

/// Build a cost estimate from a prompt string.
///
/// Pricing reference (blended input+output average, USD per token):
/// - DeepSeek V3:    ~$0.00000028 (≈ $0.28/1M)
/// - Gemini 2.5 Flash: ~$0.00000025
/// - Claude Haiku:   ~$0.00000125
/// We use $0.0000005 as a conservative blended mid-point.
pub fn estimate_cost_from_text(prompt: &str, _tier: &QualityTier) -> CostEstimate {
    let estimated_tokens = estimate_tokens(prompt);
    let cost_per_token = 0.000_000_5_f64; // $0.50 per 1M tokens
    CostEstimate {
        estimated_tokens,
        estimated_cost_usd: estimated_tokens as f64 * cost_per_token,
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
            estimated_cost_usd: 99.0, // way over any limit
        };
        assert_eq!(
            enforce_budget(&QualityTier::Premium, &estimate),
            CostDecision::Deny
        );
    }
}
