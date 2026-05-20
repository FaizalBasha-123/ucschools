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
// Topic Complexity — drives deterministic scene count and budget
// ────────────────────────────────────────────────────────────────────────────

/// 5-level complexity ladder mapped from keyword heuristics.
/// Each level determines base scene count, hard cap, and extra scene allowance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TopicComplexity {
    Low,
    Normal,
    High,
    VeryHigh,
    Extreme,
}

impl TopicComplexity {
    /// Order-preserving numeric index for budget calculations.
    pub fn level_index(self) -> usize {
        match self {
            TopicComplexity::Low => 0,
            TopicComplexity::Normal => 1,
            TopicComplexity::High => 2,
            TopicComplexity::VeryHigh => 3,
            TopicComplexity::Extreme => 4,
        }
    }

    /// Maximum allowed scenes for this complexity level at a given tier.
    pub fn hard_max_scenes(self, tier: QualityTier) -> usize {
        let base = tier_limits(tier).max_slides;
        match self {
            TopicComplexity::Low => base,
            TopicComplexity::Normal => base,
            TopicComplexity::High => (base as f64 * 1.4).ceil() as usize,
            TopicComplexity::VeryHigh => (base as f64 * 1.7).ceil() as usize,
            TopicComplexity::Extreme => (base as f64 * 2.0).ceil() as usize,
        }
    }

    /// Deterministic base scene count (no LLM input).
    pub fn base_scene_count(self, tier: QualityTier) -> usize {
        let base = tier_limits(tier).max_slides;
        match self {
            TopicComplexity::Low => base.saturating_sub(2).max(2),
            TopicComplexity::Normal => base,
            TopicComplexity::High => base + 1,
            TopicComplexity::VeryHigh => base + 2,
            TopicComplexity::Extreme => base + 3,
        }
    }

    /// Number of extra scenes available at reduced margin (optional).
    pub fn extra_scene_allowance(self) -> usize {
        match self {
            TopicComplexity::Low => 0,
            TopicComplexity::Normal => 0,
            TopicComplexity::High => 1,
            TopicComplexity::VeryHigh => 2,
            TopicComplexity::Extreme => 3,
        }
    }
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
            max_slides: 5,
            max_examples_per_slide: 1,
            max_tokens_per_response: 2048,
            enable_refinement: false,
            max_pdf_context_chars: 300,
            max_cost_usd_per_request: 0.01,
        },
        QualityTier::Standard => TierLimits {
            max_slides: 8,
            max_examples_per_slide: 2,
            max_tokens_per_response: 4096,
            enable_refinement: false,
            max_pdf_context_chars: 600,
            max_cost_usd_per_request: 0.05,
        },
        QualityTier::Premium => TierLimits {
            max_slides: 15,
            max_examples_per_slide: 3,
            max_tokens_per_response: 8192,
            enable_refinement: true,
            max_pdf_context_chars: 1000,
            max_cost_usd_per_request: 0.15,
        },
    }
}

/// Effective slide limit applying a deterministic complexity bonus.
/// Delegates to `TopicComplexity::base_scene_count` which uses the 5-level ladder.
pub fn effective_max_slides(tier: QualityTier, complexity: TopicComplexity) -> usize {
    complexity.base_scene_count(tier).min(complexity.hard_max_scenes(tier))
}

// ────────────────────────────────────────────────────────────────────────────
// Capability — determines model selection by task requirement
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    FastCheap,
    StructuredGeneration,
    LightweightEvaluation,
    PremiumReasoning,
    LongContext,
    VisionAnalysis,
}

// ────────────────────────────────────────────────────────────────────────────
// Generation Task — what step of the pipeline needs an LLM call
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerationTask {
    Outlines,
    SceneContent,
    SceneActions,
    QuizGrade,
}

impl GenerationTask {
    pub fn from_str_loose(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "outlines" | "outline" => Self::Outlines,
            "scene-content" | "scene_content" | "content" => Self::SceneContent,
            "scene-actions" | "scene_actions" | "actions" => Self::SceneActions,
            "quiz-grade" | "quiz_grade" | "grade" => Self::QuizGrade,
            _ => Self::SceneContent,
        }
    }
}

/// Map a GenerationTask to its base Capability (before escalation).
impl From<GenerationTask> for Capability {
    fn from(task: GenerationTask) -> Self {
        match task {
            GenerationTask::Outlines => Capability::StructuredGeneration,
            GenerationTask::SceneContent => Capability::StructuredGeneration,
            GenerationTask::SceneActions => Capability::FastCheap,
            GenerationTask::QuizGrade => Capability::LightweightEvaluation,
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Scene Priority — used for intelligent truncation
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScenePriority {
    Critical,
    Important,
    Optional,
}

// ────────────────────────────────────────────────────────────────────────────
// Generation Budget — token & scene control per quality tier
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct GenerationBudget {
    pub max_scenes: usize,
    pub max_interactions: usize,
    pub max_visuals: usize,
    pub max_tokens_per_scene: usize,
    pub max_bullets_per_scene: usize,
    pub max_chars_per_bullet: usize,
    pub require_quiz_scene: bool,
}

impl GenerationBudget {
    /// Returns a prompt-friendly constraint string.
    pub fn to_constraint_prompt(&self) -> String {
        format!(
            "Scene Limit Rules:\n\
             - Maximum scenes: {max_scenes}\n\
             - Maximum interactive elements: {max_interactions}\n\
             - Maximum visual elements: {max_visuals}\n\
             - Maximum tokens per scene: {max_tokens_per_scene}\n\
             - Maximum bullets per scene: {max_bullets_per_scene}\n\
             - Maximum characters per bullet: {max_chars_per_bullet}\n\
             {quiz_rule}\
             Never exceed these limits.",
            max_scenes = self.max_scenes,
            max_interactions = self.max_interactions,
            max_visuals = self.max_visuals,
            max_tokens_per_scene = self.max_tokens_per_scene,
            max_bullets_per_scene = self.max_bullets_per_scene,
            max_chars_per_bullet = self.max_chars_per_bullet,
            quiz_rule = if self.require_quiz_scene {
                "- Include at least one quiz scene.\n"
            } else {
                ""
            },
        )
    }

    pub fn to_budget_prompt_block(&self) -> String {
        format!(
            "GENERATION BUDGET:\n\
             - Max {max_scenes} scenes\n\
             - Max {max_interactions} interactive elements\n\
             - Max {max_visuals} visual elements\n\
             - Max {max_bullets} bullets per scene\n\
             - Max {max_chars_per_bullet} characters per bullet\n\
             - Max {max_tokens} tokens per scene\n\
             - No paragraphs — use concise bullet points\n\
             - No fluff, no introductions, no conclusions in individual scene content\n\
             {quiz_rule}\
             All limits are hard — do not exceed them.",
            max_scenes = self.max_scenes,
            max_interactions = self.max_interactions,
            max_visuals = self.max_visuals,
            max_bullets = self.max_bullets_per_scene,
            max_chars_per_bullet = self.max_chars_per_bullet,
            max_tokens = self.max_tokens_per_scene,
            quiz_rule = if self.require_quiz_scene {
                "- Must include at least 1 quiz scene\n"
            } else {
                ""
            },
        )
    }
}

pub fn compute_generation_budget(tier: QualityTier, complexity: TopicComplexity) -> GenerationBudget {
    let max_scenes = complexity.hard_max_scenes(tier);
    match tier {
        QualityTier::Basic => GenerationBudget {
            max_scenes,
            max_interactions: 2,
            max_visuals: 1,
            max_tokens_per_scene: 512,
            max_bullets_per_scene: 3,
            max_chars_per_bullet: 60,
            require_quiz_scene: false,
        },
        QualityTier::Standard => GenerationBudget {
            max_scenes,
            max_interactions: 5,
            max_visuals: 3,
            max_tokens_per_scene: 1024,
            max_bullets_per_scene: 4,
            max_chars_per_bullet: 80,
            require_quiz_scene: false,
        },
        QualityTier::Premium => GenerationBudget {
            max_scenes,
            max_interactions: 8,
            max_visuals: 5,
            max_tokens_per_scene: 2048,
            max_bullets_per_scene: 6,
            max_chars_per_bullet: 100,
            require_quiz_scene: true,
        },
    }
}

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
            timeout_ms: 30_000,
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
    fn effective_slides_scales_with_complexity() {
        // Basic: Normal → base_scene_count=5, High → min(6, 7) = 6
        let normal = effective_max_slides(QualityTier::Basic, TopicComplexity::Normal);
        let high = effective_max_slides(QualityTier::Basic, TopicComplexity::High);
        let low = effective_max_slides(QualityTier::Basic, TopicComplexity::Low);
        assert_eq!(low, 3);   // 5 - 2, clamped to min 2
        assert_eq!(normal, 5);
        assert_eq!(high, 6);  // min(5+1=6, ceil(5*1.4)=7) = 6
    }

    #[test]
    fn retry_policy_default_timeout() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.max_attempts, 2);
        assert_eq!(policy.timeout_ms, 30_000); // default from env_u64
    }
}
