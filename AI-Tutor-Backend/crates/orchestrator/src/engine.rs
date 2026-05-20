use ai_tutor_domain::generation::LessonGenerationRequest;
use ai_tutor_domain::routing::{GenerationBudget, QualityTier};
use crate::context::detect_complexity;
use std::fmt;

pub struct LearningProfile {
    pub depth: String,
    pub target_level: String,
    pub pacing: String,
    pub interaction_frequency: String,
}

pub struct LayoutConstraints {
    pub max_bullets: u8,
    pub max_chars_per_bullet: u16,
    pub max_lines: u8,
    pub max_scenes: u8,
}

pub fn compute_learning_profile(request: &LessonGenerationRequest) -> LearningProfile {
    match request.learning_mode.as_deref() {
        Some("exam") => LearningProfile {
            depth: "targeted_assessment_prep".to_string(),
            target_level: "advanced".to_string(),
            pacing: "fast_focused".to_string(),
            interaction_frequency: "high_quiz_dense".to_string(),
        },
        Some("revision") => LearningProfile {
            depth: "summary_connections".to_string(),
            target_level: "intermediate".to_string(),
            pacing: "fast_compressed".to_string(),
            interaction_frequency: "high_recall_focused".to_string(),
        },
        Some("placement_prep") => LearningProfile {
            depth: "diagnostic_baseline".to_string(),
            target_level: "adaptive".to_string(),
            pacing: "adaptive".to_string(),
            interaction_frequency: "medium".to_string(),
        },
        _ => LearningProfile {
            depth: "comprehensive_foundational".to_string(),
            target_level: "beginner".to_string(),
            pacing: "moderate_stepped".to_string(),
            interaction_frequency: "medium_balanced".to_string(),
        },
    }
}

pub fn compute_layout_constraints(request: &LessonGenerationRequest) -> LayoutConstraints {
    match request.quality_mode.as_deref() {
        Some("basic") => LayoutConstraints {
            max_bullets: 3,
            max_chars_per_bullet: 60,
            max_lines: 2,
            max_scenes: 5,
        },
        Some("premium") => LayoutConstraints {
            max_bullets: 5,
            max_chars_per_bullet: 80,
            max_lines: 4,
            max_scenes: 15,
        },
        _ => LayoutConstraints {
            max_bullets: 4,
            max_chars_per_bullet: 70,
            max_lines: 3,
            max_scenes: 10,
        },
    }
}

pub fn compute_generation_budget(request: &LessonGenerationRequest) -> GenerationBudget {
    let tier = match request.quality_mode.as_deref() {
        Some("basic") => QualityTier::Basic,
        Some("premium") => QualityTier::Premium,
        _ => QualityTier::Standard,
    };
    let complexity = detect_complexity(&request.requirements.requirement);
    ai_tutor_domain::routing::compute_generation_budget(tier, complexity)
}

pub fn compute_scene_budget(request: &LessonGenerationRequest) -> crate::complexity::SceneBudget {
    let tier = match request.quality_mode.as_deref() {
        Some("basic") => QualityTier::Basic,
        Some("premium") => QualityTier::Premium,
        _ => QualityTier::Standard,
    };
    let complexity = detect_complexity(&request.requirements.requirement);
    crate::complexity::compute_scene_budget(tier, complexity)
}

impl fmt::Display for LearningProfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Depth: {}
Target: {}
Pacing: {}
Interaction: {}",
            self.depth, self.target_level, self.pacing, self.interaction_frequency
        )
    }
}

impl fmt::Display for LayoutConstraints {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Bullets: {} max ({} chars each)
Lines: {} max
No paragraphs. Concise only.",
            self.max_bullets, self.max_chars_per_bullet, self.max_lines
        )
    }
}

impl LearningProfile {
    pub fn to_prompt_block(&self) -> String {
        format!(
            "Depth: {depth}
Target: {target_level}
Pacing: {pacing}
Interaction: {interaction_frequency}",
            depth = self.depth,
            target_level = self.target_level,
            pacing = self.pacing,
            interaction_frequency = self.interaction_frequency,
        )
    }
}

impl LayoutConstraints {
    pub fn to_prompt_block(&self) -> String {
        format!(
            "Max {max_bullets} bullets/slide
Max {max_chars_per_bullet} chars/bullet
Max {max_lines} lines
No paragraphs. No fluff. Concise only.",
            max_bullets = self.max_bullets,
            max_chars_per_bullet = self.max_chars_per_bullet,
            max_lines = self.max_lines,
        )
    }

    pub fn to_scene_cap_prompt(&self) -> String {
        format!(
            "Include 1 quiz. No interactive/PBL unless concept requires."
        )
    }
}
