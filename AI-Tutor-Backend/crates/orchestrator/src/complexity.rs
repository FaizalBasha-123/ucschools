use ai_tutor_domain::routing::{QualityTier, TopicComplexity};

/// Complete scene budget for a generation request.
///
/// Deterministic — computed from tier + topic complexity, no LLM input.
#[derive(Debug, Clone)]
pub struct SceneBudget {
    /// Ideal scene count the LLM should aim for.
    pub target_scenes: usize,
    /// Hard upper bound — never exceeded even if LLM produces more.
    pub hard_max_scenes: usize,
    /// Maximum interactive elements across all scenes.
    pub max_interactions: usize,
    /// Maximum visual elements across all scenes.
    pub max_visuals: usize,
    /// Extra scenes available at reduced margin (user consent required).
    pub extra_scene_allowance: usize,
    /// Interaction pacing configuration.
    pub pacing: InteractionPacing,
}

/// Interaction pacing — controls where interactive elements appear.
#[derive(Debug, Clone)]
pub struct InteractionPacing {
    /// Minimum scenes between interactive elements (spread out).
    pub min_gap: usize,
    /// Whether to place an interaction in the first scene.
    pub prefer_first_scene: bool,
    /// Whether to place an interaction in the last scene (recap quiz).
    pub require_final_quiz: bool,
}

impl InteractionPacing {
    /// Default pacing for a given tier.
    pub fn for_tier(tier: QualityTier) -> Self {
        match tier {
            QualityTier::Basic => InteractionPacing {
                min_gap: 2,
                prefer_first_scene: false,
                require_final_quiz: false,
            },
            QualityTier::Standard => InteractionPacing {
                min_gap: 2,
                prefer_first_scene: true,
                require_final_quiz: false,
            },
            QualityTier::Premium => InteractionPacing {
                min_gap: 1,
                prefer_first_scene: true,
                require_final_quiz: true,
            },
        }
    }
}

/// Compute the deterministic scene budget for a request.
pub fn compute_scene_budget(tier: QualityTier, complexity: TopicComplexity) -> SceneBudget {
    let target_scenes = complexity.base_scene_count(tier);
    let hard_max_scenes = complexity.hard_max_scenes(tier);
    let extra_scene_allowance = complexity.extra_scene_allowance();

    let (max_interactions, max_visuals) = match tier {
        QualityTier::Basic => (2, 1),
        QualityTier::Standard => (5, 3),
        QualityTier::Premium => (8, 5),
    };

    SceneBudget {
        target_scenes,
        hard_max_scenes,
        max_interactions,
        max_visuals,
        extra_scene_allowance,
        pacing: InteractionPacing::for_tier(tier),
    }
}

/// Determine the number of interactive elements this scene budget can support,
/// considering pacing constraints.
pub fn effective_interaction_count(budget: &SceneBudget) -> usize {
    if budget.max_interactions == 0 {
        return 0;
    }
    // Pacing constraint: with min_gap between interactions, the max is
    // floor((target_scenes - 1) / (min_gap + 1)) + require_final_quiz as usize
    let paced_max = if budget.pacing.min_gap > 0 {
        (budget.target_scenes.saturating_sub(1)) / (budget.pacing.min_gap + 1)
            + if budget.pacing.require_final_quiz { 1 } else { 0 }
    } else {
        budget.target_scenes
    };
    // Also bound by the tier's max_interactions
    budget.max_interactions.min(paced_max.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_normal_scene_budget() {
        let budget = compute_scene_budget(QualityTier::Basic, TopicComplexity::Normal);
        // domain tier_limits(Basic).max_slides = 7
        // base_scene_count(Normal, Basic) = 7 (Normal → base)
        // hard_max_scenes(Normal, Basic) = 7 (Normal → base)
        assert_eq!(budget.target_scenes, 7);
        assert_eq!(budget.hard_max_scenes, 7);
        assert_eq!(budget.extra_scene_allowance, 0);
        assert_eq!(budget.max_interactions, 2);
    }

    #[test]
    fn premium_extreme_scene_budget() {
        let budget = compute_scene_budget(QualityTier::Premium, TopicComplexity::Extreme);
        // domain tier_limits(Premium).max_slides = 14
        // base_scene_count(Premium, Extreme) = 14 + 3 = 17
        assert_eq!(budget.target_scenes, 17);
        // hard_max_scenes(Premium, Extreme) = ceil(14 * 2.0) = 28
        assert_eq!(budget.hard_max_scenes, 28);
        assert_eq!(budget.extra_scene_allowance, 3);
    }

    #[test]
    fn low_complexity_reduces_scenes() {
        let budget = compute_scene_budget(QualityTier::Standard, TopicComplexity::Low);
        // domain tier_limits(Standard).max_slides = 10
        // base_scene_count(Standard, Low) = 10 - 2 = 8
        assert_eq!(budget.target_scenes, 8);
        // hard_max_scenes(Standard, Low) = 10 (Low → base)
        assert_eq!(budget.hard_max_scenes, 10);
    }

    #[test]
    fn very_high_has_extra_scene_allowance() {
        let budget = compute_scene_budget(QualityTier::Standard, TopicComplexity::VeryHigh);
        assert_eq!(budget.extra_scene_allowance, 2);
    }

    #[test]
    fn interaction_effective_count_basic() {
        let budget = compute_scene_budget(QualityTier::Basic, TopicComplexity::Normal);
        // target=7 (domain Basic Normal), min_gap=2, no final quiz
        // paced_max = (7-1) / (2+1) = 6/3 = 2
        let count = effective_interaction_count(&budget);
        assert_eq!(count, 2);
    }

    #[test]
    fn interaction_effective_count_premium() {
        let budget = compute_scene_budget(QualityTier::Premium, TopicComplexity::Normal);
        // target=14 (domain Premium Normal), min_gap=1, require_final_quiz=true
        // paced_max = (14-1) / (1+1) + 1 = 13/2 + 1 = 6 + 1 = 7
        let count = effective_interaction_count(&budget);
        assert_eq!(count, 7);
    }
}
