use ai_tutor_domain::routing::{Capability, GenerationTask, GenerationBudget, LearningMode, QualityTier, TopicComplexity};

use crate::capabilities::{resolve_capability, resolve_model};

/// Complete routing result for a generation request.
pub struct GenerationRoute {
    pub model: &'static str,
    pub capability: Capability,
    pub budget: GenerationBudget,
}

/// Resolve the full generation route: model + capability + budget.
///
/// This is the SINGLE entry point for all LLM generation routing.
pub fn resolve_generation_route(
    task: GenerationTask,
    learning_mode: LearningMode,
    quality_mode: QualityTier,
    complexity: TopicComplexity,
) -> GenerationRoute {
    let cap = resolve_capability(task, learning_mode);
    let model = resolve_model(cap, quality_mode);
    let budget = compute_budget(quality_mode, complexity, task);
    GenerationRoute { model, capability: cap, budget }
}

/// Compute the generation budget for a task, adjusted by tier and complexity.
fn compute_budget(
    tier: QualityTier,
    complexity: TopicComplexity,
    _task: GenerationTask,
) -> GenerationBudget {
    let mut budget = ai_tutor_domain::routing::compute_generation_budget(tier, complexity);

    // High-complexity topics get +2 scenes
    if complexity == TopicComplexity::High {
        budget.max_scenes = budget.max_scenes.saturating_add(2);
    }

    budget
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_route_returns_basic_budget() {
        let route = resolve_generation_route(
            GenerationTask::Outlines,
            LearningMode::Explain,
            QualityTier::Basic,
            TopicComplexity::Normal,
        );
        assert_eq!(route.budget.max_scenes, 5);
        assert!(route.model.contains("deepseek"));
    }

    #[test]
    fn premium_route_returns_premium_budget() {
        let route = resolve_generation_route(
            GenerationTask::Outlines,
            LearningMode::Explain,
            QualityTier::Premium,
            TopicComplexity::Normal,
        );
        assert_eq!(route.budget.max_scenes, 15);
    }

    #[test]
    fn high_complexity_adds_extra_scenes() {
        let route = resolve_generation_route(
            GenerationTask::Outlines,
            LearningMode::Explain,
            QualityTier::Standard,
            TopicComplexity::High,
        );
        assert_eq!(route.budget.max_scenes, 12); // 10 + 2
    }

    #[test]
    fn exam_escalates_actions_route() {
        let route = resolve_generation_route(
            GenerationTask::SceneActions,
            LearningMode::Exam,
            QualityTier::Basic,
            TopicComplexity::Normal,
        );
        assert_eq!(route.capability, Capability::StructuredGeneration);
        assert!(route.model.contains("deepseek"));
    }
}
