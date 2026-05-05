use serde::{Deserialize, Serialize};

// ────────────────────────────────────────────────────────────────────────────
// Learning Mode — determines pipeline shape
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LearningMode {
    Explain,
    Revision,
    Exam,
    Placement,
}

impl LearningMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explain => "explain",
            Self::Revision => "revision",
            Self::Exam => "exam",
            Self::Placement => "placement",
        }
    }

    pub fn from_str_loose(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "revision" | "revise" | "review" => Self::Revision,
            "exam" | "test" | "assessment" => Self::Exam,
            "placement" | "placement_prep" | "diagnostic" => Self::Placement,
            _ => Self::Explain,
        }
    }
}

impl Default for LearningMode {
    fn default() -> Self {
        Self::Explain
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Quality Tier
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityTier {
    Basic,
    Standard,
    Premium,
}

impl QualityTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Basic => "BASIC",
            Self::Standard => "STANDARD",
            Self::Premium => "PREMIUM",
        }
    }

    pub fn from_str_loose(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "basic" => Self::Basic,
            "premium" => Self::Premium,
            _ => Self::Standard,
        }
    }
}

impl Default for QualityTier {
    fn default() -> Self {
        Self::Standard
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Difficulty & Learning State
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DifficultyLevel {
    Beginner,
    Intermediate,
    Advanced,
}

impl Default for DifficultyLevel {
    fn default() -> Self {
        Self::Intermediate
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LearningState {
    Confused,
    Understanding,
    Mastered,
}

impl Default for LearningState {
    fn default() -> Self {
        Self::Understanding
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Topic Complexity — drives dynamic slide count override
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopicComplexity {
    Normal,
    High,
}

// ────────────────────────────────────────────────────────────────────────────
// Tier Limits
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct TierLimits {
    pub max_slides: usize,
    pub max_examples_per_slide: usize,
    pub max_tokens_per_response: usize,
    pub enable_refinement: bool,
    pub max_pdf_context_chars: usize,
    pub max_cost_usd_per_request: f64,
}

pub fn tier_limits(tier: QualityTier) -> TierLimits {
    match tier {
        QualityTier::Basic => TierLimits {
            max_slides: env_usize("MAX_SLIDES_BASIC", 5),
            max_examples_per_slide: 1,
            max_tokens_per_response: 2048,
            enable_refinement: false,
            max_pdf_context_chars: 300,
            max_cost_usd_per_request: env_f64("MAX_COST_USD_BASIC", 0.01),
        },
        QualityTier::Standard => TierLimits {
            max_slides: env_usize("MAX_SLIDES_STANDARD", 8),
            max_examples_per_slide: 2,
            max_tokens_per_response: 4096,
            enable_refinement: false,
            max_pdf_context_chars: 600,
            max_cost_usd_per_request: env_f64("MAX_COST_USD_STANDARD", 0.05),
        },
        QualityTier::Premium => TierLimits {
            max_slides: env_usize("MAX_SLIDES_PREMIUM", 15),
            max_examples_per_slide: 3,
            max_tokens_per_response: 8192,
            enable_refinement: env_bool("ENABLE_REFINEMENT", true),
            max_pdf_context_chars: 1000,
            max_cost_usd_per_request: env_f64("MAX_COST_USD_PREMIUM", 0.15),
        },
    }
}

/// Effective slide limit applying a complexity bonus when the topic is High
/// complexity. The bonus is configurable via `TOPIC_COMPLEXITY_EXTRA_SLIDES`
/// (default: 2) and is capped so we never exceed `MAX_SLIDES_PREMIUM`.
pub fn effective_max_slides(tier: QualityTier, complexity: TopicComplexity) -> usize {
    let base = tier_limits(tier).max_slides;
    if complexity == TopicComplexity::High {
        let extra = env_usize("TOPIC_COMPLEXITY_EXTRA_SLIDES", 2);
        let premium_cap = env_usize("MAX_SLIDES_PREMIUM", 15);
        (base + extra).min(premium_cap)
    } else {
        base
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Retry Policy — timeout + max attempts; NO fallback model
// ────────────────────────────────────────────────────────────────────────────

/// Retry is triggered ONLY by technical failures (API error, timeout, unparseable
/// JSON). Quality issues route to the escalation model instead.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Maximum LLM call attempts before giving up.
    pub max_attempts: usize,
    /// Hard wall-clock timeout per LLM request in milliseconds.
    pub timeout_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 2,
            timeout_ms: env_u64("LLM_TIMEOUT_MS", 30_000),
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Failure Classification — distinguishes retry vs escalation triggers
// ────────────────────────────────────────────────────────────────────────────

/// What kind of failure occurred during LLM generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureReason {
    /// API returned an error status (5xx, rate limit, network reset).
    ApiError,
    /// Request exceeded `timeout_ms` before a response arrived.
    Timeout,
    /// Response arrived but JSON parsing failed — unusable output.
    UnparseableResponse,
    /// Response was structurally valid but semantically weak (quality issue).
    /// This triggers ESCALATION (refinement model), NOT retry.
    WeakQuality,
}

impl FailureReason {
    /// Returns `true` if the failure justifies a retry on the same model.
    pub fn should_retry(&self) -> bool {
        matches!(
            self,
            Self::ApiError | Self::Timeout | Self::UnparseableResponse
        )
    }

    /// Returns `true` if the failure should escalate to the refinement model
    /// (Premium tier only).
    pub fn should_escalate(&self) -> bool {
        *self == Self::WeakQuality
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline Model Config
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PipelineModelConfig {
    pub orchestrator: String,
    pub planner: String,
    pub content: String,
    pub refine: Option<String>,
    pub light_task: String,
    pub pdf: String,
    pub retry_policy: RetryPolicy,
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline Stages
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipelineStage {
    Outline,
    Content,
    Quiz,
    Interaction,
    Summary,
    KeyPointRefresh,
    QuickQuiz,
    McqBank,
    Scoring,
    Diagnostic,
    ProficiencyMap,
}

pub fn pipeline_stages(mode: LearningMode) -> Vec<PipelineStage> {
    match mode {
        LearningMode::Explain => vec![
            PipelineStage::Outline,
            PipelineStage::Content,
            PipelineStage::Quiz,
            PipelineStage::Interaction,
        ],
        LearningMode::Revision => vec![
            PipelineStage::Summary,
            PipelineStage::KeyPointRefresh,
            PipelineStage::QuickQuiz,
        ],
        LearningMode::Exam => vec![PipelineStage::McqBank, PipelineStage::Scoring],
        LearningMode::Placement => {
            vec![PipelineStage::Diagnostic, PipelineStage::ProficiencyMap]
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(default)
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

fn env_f64(key: &str, default: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(default)
}

fn env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_reason_retry_vs_escalate() {
        assert!(FailureReason::ApiError.should_retry());
        assert!(FailureReason::Timeout.should_retry());
        assert!(FailureReason::UnparseableResponse.should_retry());
        assert!(!FailureReason::WeakQuality.should_retry());
        assert!(FailureReason::WeakQuality.should_escalate());
        assert!(!FailureReason::ApiError.should_escalate());
    }

    #[test]
    fn effective_slides_adds_bonus_for_high_complexity() {
        // Basic without env override is 5 base.
        // High complexity adds 2 (default) → 7, but capped at premium (15).
        let normal = effective_max_slides(QualityTier::Basic, TopicComplexity::Normal);
        let high = effective_max_slides(QualityTier::Basic, TopicComplexity::High);
        assert_eq!(normal, 5);
        assert_eq!(high, 7);
    }

    #[test]
    fn retry_policy_default_timeout() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.max_attempts, 2);
        assert_eq!(policy.timeout_ms, 30_000); // default from env_u64
    }
}
