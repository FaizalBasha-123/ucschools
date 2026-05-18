use ai_tutor_domain::routing::{Capability, GenerationTask, LearningMode, QualityTier};

/// Compile-time (Capability, QualityTier) → model string mapping.
///
/// This is the SINGLE source of truth for model selection.
/// All generation routes use this — no env var chaos, no duplicates.
pub fn resolve_model(cap: Capability, tier: QualityTier) -> &'static str {
    match (cap, tier) {
        // ── FastCheap ──
        (Capability::FastCheap, QualityTier::Basic) => "google/gemini-2.5-flash-lite",
        (Capability::FastCheap, QualityTier::Standard) => "google/gemini-2.5-flash",
        (Capability::FastCheap, QualityTier::Premium) => "google/gemini-2.5-flash",

        // ── StructuredGeneration ──
        (Capability::StructuredGeneration, QualityTier::Basic) => "deepseek/deepseek-chat-v3-0324",
        (Capability::StructuredGeneration, QualityTier::Standard) => "deepseek/deepseek-chat-v3-0324",
        (Capability::StructuredGeneration, QualityTier::Premium) => "deepseek/deepseek-chat-v3-0324",

        // ── LightweightEvaluation ──
        (Capability::LightweightEvaluation, QualityTier::Basic) => "groq/llama-3.1-8b-instant",
        (Capability::LightweightEvaluation, QualityTier::Standard) => "groq/llama-3.1-8b-instant",
        (Capability::LightweightEvaluation, QualityTier::Premium) => "groq/llama-3.1-8b-instant",

        // ── PremiumReasoning ──
        (Capability::PremiumReasoning, QualityTier::Basic) => "google/gemini-2.5-flash",
        (Capability::PremiumReasoning, QualityTier::Standard) => "google/gemini-2.5-flash",
        (Capability::PremiumReasoning, QualityTier::Premium) => "anthropic/claude-sonnet-4.6",

        // ── LongContext ──
        (Capability::LongContext, _) => "google/gemini-2.5-flash",

        // ── VisionAnalysis ──
        (Capability::VisionAnalysis, _) => "google/gemini-2.5-flash",
    }
}

/// Escalate or demote a capability based on learning mode.
///
/// Exam / placement_prep → bump capability up one tier.
/// Revision              → bump capability down one tier.
/// Explain               → unchanged.
pub fn escalate_capability(base: Capability, learning_mode: LearningMode) -> Capability {
    match (base, learning_mode) {
        // Bump up for exam / placement
        (Capability::FastCheap, LearningMode::Exam | LearningMode::Placement) => {
            Capability::StructuredGeneration
        }
        (Capability::StructuredGeneration, LearningMode::Exam | LearningMode::Placement) => {
            Capability::PremiumReasoning
        }
        // Bump down for revision
        (Capability::PremiumReasoning, LearningMode::Revision) => Capability::StructuredGeneration,
        (Capability::StructuredGeneration, LearningMode::Revision) => Capability::FastCheap,
        // Unchanged
        (cap, _) => cap,
    }
}

/// Resolve the effective capability for a generation task,
/// applying learning-mode-based escalation.
pub fn resolve_capability(
    task: GenerationTask,
    learning_mode: LearningMode,
) -> Capability {
    let base: Capability = task.into();
    escalate_capability(base, learning_mode)
}

/// Resolve a model string for a generation task, considering all context.
pub fn resolve_generation_model(
    task: GenerationTask,
    learning_mode: LearningMode,
    quality_mode: QualityTier,
) -> &'static str {
    let cap = resolve_capability(task, learning_mode);
    resolve_model(cap, quality_mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_outlines_uses_deepseek() {
        let model = resolve_generation_model(
            GenerationTask::Outlines,
            LearningMode::Explain,
            QualityTier::Basic,
        );
        assert!(model.contains("deepseek"));
    }

    #[test]
    fn standard_outlines_uses_deepseek() {
        let model = resolve_generation_model(
            GenerationTask::Outlines,
            LearningMode::Explain,
            QualityTier::Standard,
        );
        assert!(model.contains("deepseek"));
    }

    #[test]
    fn quiz_grade_uses_llama() {
        let model = resolve_generation_model(
            GenerationTask::QuizGrade,
            LearningMode::Explain,
            QualityTier::Basic,
        );
        assert!(model.contains("llama"));
    }

    #[test]
    fn exam_mode_escalates_fast_cheap() {
        let cap = resolve_capability(GenerationTask::SceneActions, LearningMode::Exam);
        assert_eq!(cap, Capability::StructuredGeneration);
    }

    #[test]
    fn revision_demotes_premium_reasoning() {
        let cap = escalate_capability(Capability::PremiumReasoning, LearningMode::Revision);
        assert_eq!(cap, Capability::StructuredGeneration);
    }

    #[test]
    fn premium_actions_uses_gemini() {
        let model = resolve_generation_model(
            GenerationTask::SceneActions,
            LearningMode::Explain,
            QualityTier::Premium,
        );
        assert!(model.contains("gemini"));
    }
}
