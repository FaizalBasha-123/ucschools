use ai_tutor_domain::generation::LessonGenerationRequest;
use std::fmt;

pub struct LearningProfile {
    pub depth: String,
    pub target_level: String,
    pub pacing: String,
    pub interaction_frequency: String,
}

pub struct PersonaProfile {
    pub tone: String,
    pub verbosity: String,
    pub explanation_style: String,
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

pub fn compute_persona_profile(request: &LessonGenerationRequest) -> PersonaProfile {
    match request.learning_mode.as_deref() {
        Some("exam") => PersonaProfile {
            tone: "formal_precise".to_string(),
            verbosity: "concise".to_string(),
            explanation_style: "precise_definitions_common_mistakes".to_string(),
        },
        Some("revision") => PersonaProfile {
            tone: "supportive_summarizer".to_string(),
            verbosity: "minimal".to_string(),
            explanation_style: "compressed_key_points_connections".to_string(),
        },
        Some("placement_prep") => PersonaProfile {
            tone: "interviewer_coach".to_string(),
            verbosity: "concise".to_string(),
            explanation_style: "socratic_questioning_diagnostic".to_string(),
        },
        _ => PersonaProfile {
            tone: "friendly_stepwise".to_string(),
            verbosity: "detailed".to_string(),
            explanation_style: "step_by_step_real_world_examples".to_string(),
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

impl fmt::Display for LearningProfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Learning Profile:
- Depth: {}
- Target level: {}
- Pacing: {}
- Interaction frequency: {}",
            self.depth, self.target_level, self.pacing, self.interaction_frequency
        )
    }
}

impl fmt::Display for PersonaProfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Instructional Persona:
- Tone: {}
- Verbosity: {}
- Explanation style: {}",
            self.tone, self.verbosity, self.explanation_style
        )
    }
}

impl fmt::Display for LayoutConstraints {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Layout Constraints:
- Max {} bullets per slide
- Max {} characters per bullet
- Max {} explanation lines
- No paragraphs
- Concise educational wording",
            self.max_bullets, self.max_chars_per_bullet, self.max_lines
        )
    }
}

impl LearningProfile {
    pub fn to_prompt_block(&self) -> String {
        format!(
            "INSTRUCTIONAL CONFIGURATION:
- Mode: {mode}
- Depth: {depth}
- Target level: {target_level}
- Pacing: {pacing}
- Interaction frequency: {interaction_frequency}",
            mode = "learning", // placeholder
            depth = self.depth,
            target_level = self.target_level,
            pacing = self.pacing,
            interaction_frequency = self.interaction_frequency,
        )
    }
}

impl PersonaProfile {
    pub fn to_prompt_block(&self) -> String {
        format!(
            "INSTRUCTIONAL PERSONA:
- Tone: {tone}
- Verbosity: {verbosity}
- Explanation style: {explanation_style}",
            tone = self.tone,
            verbosity = self.verbosity,
            explanation_style = self.explanation_style,
        )
    }
}

impl LayoutConstraints {
    pub fn to_prompt_block(&self) -> String {
        format!(
            "DENSITY CONSTRAINTS:
- Max {max_bullets} bullets per slide
- Max {max_chars_per_bullet} characters per bullet
- Max {max_lines} explanation lines
- No paragraphs
- No fluff phrases
- Concise educational wording",
            max_bullets = self.max_bullets,
            max_chars_per_bullet = self.max_chars_per_bullet,
            max_lines = self.max_lines,
        )
    }

    pub fn to_scene_cap_prompt(&self, base_count: u8) -> String {
        let count = self.max_scenes.min(base_count);
        format!("Use up to {count} scenes with a logical flow. Include at least one quiz scene. Use interactive or pbl scenes only when the concept truly benefits from them.")
    }
}
