use std::borrow::Cow;

use ai_tutor_domain::routing::{Capability, GenerationTask, LearningMode, QualityTier};

use crate::routing_rules;

/// Override-aware (Capability, QualityTier) → model string mapping.
///
/// Delegates to `routing_rules::resolve_model_by_capability` which is the
/// single source of truth for all model selections.
pub fn resolve_model(cap: Capability, tier: QualityTier) -> Cow<'static, str> {
    routing_rules::resolve_model_by_capability(cap, tier)
}

/// Escalate or demote a capability based on learning mode.
pub fn escalate_capability(base: Capability, learning_mode: LearningMode) -> Capability {
    match (base, learning_mode) {
        (Capability::FastCheap, LearningMode::Exam | LearningMode::Placement) => {
            Capability::StructuredGeneration
        }
        (Capability::StructuredGeneration, LearningMode::Exam | LearningMode::Placement) => {
            Capability::PremiumReasoning
        }
        (Capability::PremiumReasoning, LearningMode::Revision) => Capability::StructuredGeneration,
        (Capability::StructuredGeneration, LearningMode::Revision) => Capability::FastCheap,
        (cap, _) => cap,
    }
}

/// Resolve the effective capability for a generation task,
/// applying learning-mode-based escalation.
pub fn resolve_capability(task: GenerationTask, learning_mode: LearningMode) -> Capability {
    let base: Capability = task.into();
    escalate_capability(base, learning_mode)
}

/// Resolve a model string for a generation task, considering all context.
pub fn resolve_generation_model(
    task: GenerationTask,
    learning_mode: LearningMode,
    quality_mode: QualityTier,
) -> Cow<'static, str> {
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
