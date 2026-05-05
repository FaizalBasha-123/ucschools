use ai_tutor_domain::routing::{tier_limits, DifficultyLevel, LearningState, QualityTier};
use ai_tutor_domain::scene::SceneOutline;

use crate::context::CompressedContext;

// ════════════════════════════════════════════════════════════════════════════
// PLANNER PROMPTS — one per learning mode
// ════════════════════════════════════════════════════════════════════════════

/// Explain mode: full teaching pipeline.
pub fn planner_prompt_explain(ctx: &CompressedContext, tier: &QualityTier) -> (String, String) {
    let limits = tier_limits(*tier);
    let max = limits.max_slides;

    let system = "You are a friendly learning planner who designs clear, engaging lesson flows.\n\
                  Output ONLY valid JSON. No explanations. No extra text."
        .to_string();

    let pdf_section = pdf_prompt_section(&ctx.pdf_excerpt);

    let user = format!(
        "Design a lesson outline for: {topic}\n\
         {pdf}\n\
         Rules:\n\
         - {min} to {max} scenes maximum\n\
         - Each scene: title (max 6 words), description (1 line), 2-3 key points\n\
         - Mix: teaching slides, 1 quiz, optional interactive\n\
         - Flow: introduce → explain → practice → assess\n\
         - Language: simple, friendly, like explaining to a curious friend\n\
         {difficulty_rules}\n\
         {state_rules}\n\n\
         Return JSON: {{\"outlines\":[{{\"title\":\"...\",\"description\":\"...\",\"key_points\":[\"...\"],\"scene_type\":\"slide|quiz|interactive\"}}]}}",
        topic = ctx.topic_summary,
        pdf = pdf_section,
        min = (max / 2).max(3),
        max = max,
        difficulty_rules = difficulty_rules(&ctx.difficulty),
        state_rules = state_rules(&ctx.learning_state),
    );

    (system, user)
}

/// Revision mode: compressed re-learning pipeline.
pub fn planner_prompt_revision(ctx: &CompressedContext, _tier: &QualityTier) -> (String, String) {
    let system = "You create concise revision summaries. Output ONLY valid JSON.".to_string();

    let pdf_section = pdf_prompt_section(&ctx.pdf_excerpt);

    let user = format!(
        "Create a revision plan for: {topic}\n\
         {pdf}\n\
         Rules:\n\
         - Maximum 3 scenes: Summary → Key Points Refresh → Quick Quiz\n\
         - Summary: bullet-point recap of the most important concepts (max 5 bullets)\n\
         - Key Points: the 3 things the student MUST remember\n\
         - Quick Quiz: 2-3 rapid-fire questions to test retention\n\
         - Tone: direct, no fluff, no introductions\n\
         {difficulty_rules}\n\n\
         Return JSON: {{\"outlines\":[{{\"title\":\"...\",\"description\":\"...\",\"key_points\":[\"...\"],\"scene_type\":\"slide|quiz\"}}]}}",
        topic = ctx.topic_summary,
        pdf = pdf_section,
        difficulty_rules = difficulty_rules(&ctx.difficulty),
    );

    (system, user)
}

/// Exam mode: MCQ bank generation only.
pub fn planner_prompt_exam(ctx: &CompressedContext, _tier: &QualityTier) -> (String, String) {
    let system = "You generate exam question banks. Output ONLY valid JSON.".to_string();

    let pdf_section = pdf_prompt_section(&ctx.pdf_excerpt);

    let user = format!(
        "Generate an exam question bank for: {topic}\n\
         {pdf}\n\
         Rules:\n\
         - 2 scenes: MCQ Bank → Scoring Summary\n\
         - MCQ Bank: 5-10 questions, 4 options each, 1 correct answer\n\
         - Vary difficulty: 30%% easy, 50%% medium, 20%% hard\n\
         - Questions test understanding, NOT memorization\n\
         - No trick questions. All options must be plausible.\n\
         {difficulty_rules}\n\n\
         Return JSON: {{\"outlines\":[{{\"title\":\"...\",\"description\":\"...\",\"key_points\":[\"...\"],\"scene_type\":\"quiz\"}}]}}",
        topic = ctx.topic_summary,
        pdf = pdf_section,
        difficulty_rules = difficulty_rules(&ctx.difficulty),
    );

    (system, user)
}

/// Placement mode: diagnostic assessment.
pub fn planner_prompt_placement(ctx: &CompressedContext, _tier: &QualityTier) -> (String, String) {
    let system = "You design diagnostic placement assessments. Output ONLY valid JSON.".to_string();

    let pdf_section = pdf_prompt_section(&ctx.pdf_excerpt);

    let user = format!(
        "Design a placement diagnostic for: {topic}\n\
         {pdf}\n\
         Rules:\n\
         - 2 scenes: Diagnostic Questions → Proficiency Map\n\
         - Diagnostic: 5 questions spanning beginner to advanced\n\
         - Each question tests a different sub-skill\n\
         - Proficiency Map: maps answers to skill levels\n\
         - Questions must be carefully ordered: easy → medium → hard\n\n\
         Return JSON: {{\"outlines\":[{{\"title\":\"...\",\"description\":\"...\",\"key_points\":[\"...\"],\"scene_type\":\"quiz\"}}]}}",
        topic = ctx.topic_summary,
        pdf = pdf_section,
    );

    (system, user)
}

// ════════════════════════════════════════════════════════════════════════════
// CONTENT PROMPT — generates ONE teaching block at a time
// ════════════════════════════════════════════════════════════════════════════

pub fn content_prompt(
    ctx: &CompressedContext,
    outline: &SceneOutline,
    tier: &QualityTier,
) -> (String, String) {
    let limits = tier_limits(*tier);

    let system = "You are a warm, patient teacher creating visual learning slides.\n\
                  Output ONLY valid JSON. Be concise. Use real-world examples. No filler."
        .to_string();

    let pdf_section = pdf_prompt_section(&ctx.pdf_excerpt);

    let user = format!(
        "Generate teaching content for: {title}\n\
         {pdf}\n\
         Key points to cover: {points}\n\n\
         Format each slide element as:\n\
         [Title] (max 6 words)\n\
         [Explanation] (max 3 lines, use simple analogies)\n\
         [Example] ({max_ex} real-world example(s))\n\
         [Key Point] (1 memorable line)\n\n\
         Rules:\n\
         - No repetition of previous slides\n\
         - No long paragraphs — bullet points preferred\n\
         - No generic phrases like 'In this lesson...'\n\
         - Make it feel like a friendly conversation, not a textbook\n\
         {difficulty_rules}\n\
         {state_rules}\n\n\
         Return JSON with slide elements.",
        title = outline.title,
        pdf = pdf_section,
        points = outline.key_points.join(", "),
        max_ex = limits.max_examples_per_slide,
        difficulty_rules = difficulty_rules(&ctx.difficulty),
        state_rules = state_rules(&ctx.learning_state),
    );

    (system, user)
}

// ════════════════════════════════════════════════════════════════════════════
// INTERACTION / QUIZ PROMPT
// ════════════════════════════════════════════════════════════════════════════

pub fn interaction_prompt(ctx: &CompressedContext, outline: &SceneOutline) -> (String, String) {
    let system = "You create clear, fair quiz questions. Output ONLY valid JSON.".to_string();

    let user = format!(
        "Generate 1 multiple-choice question about: {title}\n\n\
         Rules:\n\
         - 4 options (A-D)\n\
         - 1 correct answer\n\
         - No explanation unless asked\n\
         - Question should test understanding, not memorization\n\
         - Options should be plausible (no obviously wrong answers)\n\
         {difficulty_rules}\n\n\
         Return JSON: {{\"question\":\"...\",\"options\":[\"A. ...\",\"B. ...\",\"C. ...\",\"D. ...\"],\"correct\":\"A\"}}",
        title = outline.title,
        difficulty_rules = difficulty_rules(&ctx.difficulty),
    );

    (system, user)
}

// ════════════════════════════════════════════════════════════════════════════
// ADAPTIVE / RE-EXPLAIN PROMPT
// ════════════════════════════════════════════════════════════════════════════

pub fn adaptive_prompt(topic: &str, confusion_signal: &str) -> (String, String) {
    let system = "You are a patient tutor. Re-explain simply. Max 3 lines.".to_string();

    let user = format!(
        "The student is confused about: {topic}\n\
         Their message: {signal}\n\n\
         Re-explain using:\n\
         - 1 simple analogy from everyday life\n\
         - Max 3 short lines\n\
         - No jargon, no formulas unless essential",
        topic = topic,
        signal = confusion_signal,
    );

    (system, user)
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

fn difficulty_rules(difficulty: &DifficultyLevel) -> String {
    match difficulty {
        DifficultyLevel::Beginner => "Difficulty: BEGINNER\n\
             - Avoid jargon completely\n\
             - Use everyday analogies (cooking, sports, daily life)\n\
             - Explain as if the student has zero background"
            .to_string(),
        DifficultyLevel::Intermediate => "Difficulty: INTERMEDIATE\n\
             - Introduce technical terms with brief definitions\n\
             - Use domain-relevant examples\n\
             - Assume basic familiarity with the subject"
            .to_string(),
        DifficultyLevel::Advanced => "Difficulty: ADVANCED\n\
             - Assume domain familiarity\n\
             - Focus on nuances, edge cases, and trade-offs\n\
             - Skip basic definitions, dive into depth"
            .to_string(),
    }
}

fn state_rules(state: &LearningState) -> String {
    match state {
        LearningState::Confused => "Student State: CONFUSED\n\
             - SIMPLIFY heavily. Break into smaller steps.\n\
             - Use more analogies. Repeat core ideas differently.\n\
             - Add a 'Check: do you understand?' prompt."
            .to_string(),
        LearningState::Understanding => "Student State: UNDERSTANDING\n\
             - Maintain current pacing.\n\
             - Progress naturally through the material."
            .to_string(),
        LearningState::Mastered => "Student State: MASTERED\n\
             - Skip basic definitions.\n\
             - Jump straight to complex applications and edge cases.\n\
             - Challenge the student with harder examples."
            .to_string(),
    }
}

fn pdf_prompt_section(pdf_excerpt: &Option<String>) -> String {
    match pdf_excerpt {
        Some(excerpt) if !excerpt.is_empty() => {
            format!("Reference material (from attached PDF):\n{}\n", excerpt)
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ctx() -> CompressedContext {
        CompressedContext {
            topic_summary: "Newton's Laws of Motion".to_string(),
            current_step: "Planning".to_string(),
            learning_state: LearningState::Understanding,
            difficulty: DifficultyLevel::Intermediate,
            key_constraints: vec![],
            pdf_excerpt: None,
        }
    }

    fn make_outline() -> SceneOutline {
        use ai_tutor_domain::scene::SceneType;
        SceneOutline {
            id: "outline-1".to_string(),
            scene_type: SceneType::Slide,
            title: "First Law: Inertia".to_string(),
            description: "Objects in motion stay in motion".to_string(),
            key_points: vec!["Inertia".to_string(), "Rest vs Motion".to_string()],
            teaching_objective: None,
            estimated_duration: None,
            order: 1,
            language: Some("en-US".to_string()),
            suggested_image_ids: vec![],
            media_generations: vec![],
            quiz_config: None,
            interactive_config: None,
            project_config: None,
        }
    }

    #[test]
    fn explain_prompt_includes_max_slides() {
        let ctx = make_ctx();
        let (_sys, user) = planner_prompt_explain(&ctx, &QualityTier::Basic);
        assert!(user.contains("5 scenes maximum"));
    }

    #[test]
    fn revision_prompt_limits_to_3_scenes() {
        let ctx = make_ctx();
        let (_sys, user) = planner_prompt_revision(&ctx, &QualityTier::Standard);
        assert!(user.contains("Maximum 3 scenes"));
    }

    #[test]
    fn content_prompt_includes_difficulty() {
        let mut ctx = make_ctx();
        ctx.difficulty = DifficultyLevel::Beginner;
        let (_sys, user) = content_prompt(&ctx, &make_outline(), &QualityTier::Standard);
        assert!(user.contains("BEGINNER"));
        assert!(user.contains("Avoid jargon"));
    }

    #[test]
    fn content_prompt_includes_learning_state() {
        let mut ctx = make_ctx();
        ctx.learning_state = LearningState::Confused;
        let (_sys, user) = content_prompt(&ctx, &make_outline(), &QualityTier::Standard);
        assert!(user.contains("CONFUSED"));
        assert!(user.contains("SIMPLIFY"));
    }

    #[test]
    fn pdf_excerpt_injected_when_present() {
        let mut ctx = make_ctx();
        ctx.pdf_excerpt = Some("Chapter 1: Forces and Motion.".to_string());
        let (_sys, user) = planner_prompt_explain(&ctx, &QualityTier::Standard);
        assert!(user.contains("Reference material"));
        assert!(user.contains("Forces and Motion"));
    }
}
