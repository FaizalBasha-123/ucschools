use anyhow::Result;

use ai_tutor_domain::{
    generation::LessonGenerationRequest,
    scene::{
        QuizOption,
        QuizQuestion, QuizQuestionType, SceneContent, SceneOutline,
    },
};


use super::*;
use crate::generation::dtos::*;
use crate::generation::helpers::*;

impl LlmGenerationPipeline {
pub(crate)     async fn generate_quiz_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        pdf_context: Option<&str>,
    ) -> Result<SceneContent> {
        let pdf_info = pdf_context.map(|ctx| format!("Attached PDF Content Context:\n{}\n", ctx)).unwrap_or_default();
        let system = "You create quiz questions. Return strict JSON only.".to_string();
        let user = format!(
"Quiz: {title}
Requirement: {req}
{pdf}Key points: {points}

Return JSON: {{\"questions\":[{{\"question\":\"...\",\"options\":[\"...\"],\"answer\":[\"...\"]}}]}}
Rules:
- 2 questions max
- 4 options each. 1 correct answer.
- Concise. No paragraphs.
- Test understanding, not memorization.",
    title = outline.title,
    req = request.requirements.requirement,
    pdf = pdf_info,
    points = outline.key_points.join(" | "),
);

        let (response, _usage) = self.generate_json_with_search_tool(&system, &user).await?;
        let payload: QuizContentEnvelope = parse_json_with_repair(&response)
            .unwrap_or_else(|_| QuizContentEnvelope { questions: vec![] });
        let questions = if payload.questions.is_empty() {
            fallback_quiz_questions(outline)
        } else {
            payload.questions
        };

        Ok(SceneContent::Quiz {
            questions: questions
                .into_iter()
                .enumerate()
                .map(|(index, question)| QuizQuestion {
                    id: format!("question-{}-{}", outline.id, index + 1),
                    question_type: QuizQuestionType::Single,
                    question: question.question,
                    options: question.options.map(|options| {
                        options
                            .into_iter()
                            .enumerate()
                            .map(|(option_index, label)| QuizOption {
                                value: ((b'A' + option_index as u8) as char).to_string(),
                                label,
                            })
                            .collect()
                    }),
                    answer: question.answer,
                    analysis: None,
                    comment_prompt: None,
                    has_answer: Some(true),
                    points: Some(1),
                })
                .collect(),
        })
    }

}
