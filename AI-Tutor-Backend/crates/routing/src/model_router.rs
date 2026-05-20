use std::borrow::Cow;

use ai_tutor_domain::routing::{Capability, GenerationBudget, GenerationTask, LearningMode, QualityTier, TopicComplexity};

use crate::capabilities::{resolve_capability, resolve_model};
use crate::routing_rules;

/// Complete routing result for a generation request.
pub struct GenerationRoute {
    pub model: Cow<'static, str>,
    pub capability: Capability,
    pub budget: GenerationBudget,
}

/// Resolve the full generation route: model + capability + budget.
pub fn resolve_generation_route(
    task: GenerationTask,
    learning_mode: LearningMode,
    quality_mode: QualityTier,
    complexity: TopicComplexity,
) -> GenerationRoute {
    let cap = resolve_capability(task, learning_mode);
    let model = resolve_model(cap, quality_mode);
    let budget = routing_rules::compute_generation_budget(quality_mode, complexity);
    GenerationRoute { model, capability: cap, budget }
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
    fn high_complexity_scales_scenes() {
        let route = resolve_generation_route(
            GenerationTask::Outlines,
            LearningMode::Explain,
            QualityTier::Standard,
            TopicComplexity::High,
        );
        // hard_max_scenes(Standard, High) = ceil(8 * 1.4) = 12
        assert_eq!(route.budget.max_scenes, 12);
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
