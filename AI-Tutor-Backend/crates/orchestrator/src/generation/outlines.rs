use std::collections::HashMap;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Duration};
use tracing::warn;

use ai_tutor_domain::{
    action::LessonAction,
    generation::{Language, LessonGenerationRequest},
    scene::{
        GeneratedAgentConfig, InteractiveConfig, MediaGenerationRequest, MediaType,
        ProjectAgentRole, ProjectConfig, ProjectIssue, ProjectOutlineConfig, QuizConfig, QuizOption,
        QuizQuestion, QuizQuestionType, SceneContent, SceneOutline, SceneType, ScientificModel,
        SlideCanvas, SlideElement, SlideTheme, VisualType,
    },
};
use ai_tutor_providers::request_params::GenerationParams;
use ai_tutor_providers::traits::{LlmProvider, ProviderUsage};

use crate::pipeline::LessonGenerationPipeline;

use super::*;
use crate::generation::dtos::*;
use crate::generation::helpers::*;

impl LlmGenerationPipeline {
pub(crate)     async fn do_generate_outlines(
        &self,
        request: &LessonGenerationRequest,
        pdf_context: Option<&str>,
    ) -> Result<Vec<SceneOutline>> {
        let language = language_code(&request.requirements.language);

        // Build available images description for the template
        let has_source_images = !request.pdf_images.is_empty();
        let available_images = if has_source_images {
            format!("Available PDF images: {} image(s) available from the uploaded document. Use their IDs when referencing them in slide scenes.", request.pdf_images.len())
        } else {
            "No images available".to_string()
        };

        // Build user profile for the template
        let user_profile = match (&request.requirements.user_nickname, &request.requirements.user_bio) {
            (Some(nickname), Some(bio)) => format!("## Student Profile\n\nStudent: {} — {}\n\nConsider this student's background when designing the course. Adapt difficulty, examples, and teaching approach accordingly.\n\n---", nickname, bio),
            (Some(nickname), None) => format!("## Student Profile\n\nStudent: {}\n\nConsider this student's background when designing the course.\n\n---", nickname),
            _ => String::new(),
        };

        let image_enabled = request.enable_image_generation;
        let video_enabled = request.enable_video_generation;
        let media_enabled = image_enabled || video_enabled;

        let mut research_context = "None".to_string();
        if request.enable_web_search {
            if let Some(context) = self.execute_tavily_search(&request.requirements.requirement).await {
                research_context = context;
            }
        }

        let mut vars = std::collections::HashMap::new();
        vars.insert("requirement", request.requirements.requirement.clone());
        vars.insert("pdfContent", pdf_context.unwrap_or("None").to_string());
        vars.insert("availableImages", available_images);
        vars.insert("userProfile", user_profile);
        vars.insert("hasSourceImages", if has_source_images { "true".to_string() } else { "false".to_string() });
        vars.insert("imageEnabled", if image_enabled { "true".to_string() } else { "false".to_string() });
        vars.insert("videoEnabled", if video_enabled { "true".to_string() } else { "false".to_string() });
        vars.insert("mediaEnabled", if media_enabled { "true".to_string() } else { "false".to_string() });
        vars.insert("researchContext", research_context);
        vars.insert("teacherContext", String::new());

        let (system, user) = crate::prompt_builder::build_prompt("requirements-to-outlines", &vars).unwrap_or_else(|| {
            (
                "You are an instructional planner. Return strict JSON only.".to_string(),
                format!("Lesson outline for: {}", request.requirements.requirement)
            )
        });

        let (final_response, _usage) = self
            .generate_json_with_search_tool_using(self.outlines_llm(), &system, &user)
            .await?;

        // Parse response — try full envelope with languageDirective first,
        // fall back to bare outlines array for backwards compatibility
        let (language_directive, outline_dtos) = match parse_json_with_repair::<OutlineResponseEnvelope>(&final_response) {
            Ok(envelope) => (envelope.language_directive, envelope.outlines),
            Err(_) => {
                // Fallback: try the old envelope format (without languageDirective)
                match parse_json_with_repair::<OutlineEnvelope>(&final_response) {
                    Ok(envelope) => (None, envelope.outlines),
                    Err(_) => (None, vec![]),
                }
            }
        };

        let language_directive = language_directive.unwrap_or_else(|| {
            format!("Teach in {}. All content, explanations, and examples must be in this language. Use terminology appropriate for the subject matter.", language)
        });

        let outlines = outline_dtos
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let scene_type = map_scene_type(&item.scene_type);
                let title = item.title;
                let description = item.description;
                let key_points = item.key_points;
                let visual_type = map_visual_type(item.visual_type.as_deref());

                let media_generations = if matches!(visual_type, Some(VisualType::Image))
                    && request.enable_image_generation
                    && matches!(scene_type, SceneType::Slide)
                {
                    vec![MediaGenerationRequest {
                        element_id: format!("gen_img_{}", index + 1),
                        media_type: MediaType::Image,
                        prompt: build_smart_image_prompt(&title, &description, &key_points),
                        aspect_ratio: Some("16:9".to_string()),
                    }]
                } else {
                    vec![]
                };

                let quiz_config = normalize_quiz_config(item.quiz_config, &scene_type);
                let interactive_config = normalize_interactive_config(
                    item.interactive_config,
                    &scene_type,
                    &title,
                    &description,
                );
                let project_config = normalize_project_outline_config(
                    item.project_config,
                    &scene_type,
                    &title,
                    &description,
                    &key_points,
                    &language_directive,
                );

                SceneOutline {
                    id: format!("outline-{}", index + 1),
                    scene_type,
                    title,
                    description,
                    key_points,
                    teaching_objective: item.teaching_objective,
                    estimated_duration: item.estimated_duration,
                    order: item.order.unwrap_or((index + 1) as i32),
                    language: Some(language_directive.clone()),
                    suggested_image_ids: item.suggested_image_ids,
                    visual_type,
                    media_generations,
                    quiz_config,
                    interactive_config,
                    project_config,
                    widget_outline: None,
                    widget_type: None,
                }
            })
            .collect::<Vec<_>>();

        if outlines.is_empty() {
            return Ok(fallback_outlines(request));
        }

        Ok(outlines)
    }

}
impl LlmGenerationPipeline {
pub(crate)     async fn do_generate_lesson_title(
        &self,
        requirement: &str,
        outlines: &[SceneOutline],
        language: &str,
    ) -> Result<String> {
        // Use the outlines LLM (lighter/faster model) to avoid extra cost.
        let scene_titles: Vec<&str> = outlines.iter().map(|o| o.title.as_str()).take(5).collect();
        let scene_list = scene_titles.join(", ");

        let system = "You are a lesson naming assistant. Respond with ONLY the lesson title — no quotes, \
            no punctuation at the end, no extra text.";
        let user = format!(
            "Create a concise, engaging lesson title in {language} (4-6 words maximum).\n\
            Topic: {requirement}\n\
            Scene titles: {scene_list}\n\
            The title should capture the essence of the topic in student-friendly language.\n\
            Reply with ONLY the title text.",
            language = language,
            requirement = requirement,
            scene_list = scene_list,
        );

        let (raw, _usage) = self
            .generate_with_retry_using(self.outlines_llm(), &system, &user)
            .await?;

        // Clean up: remove surrounding quotes, extra newlines, and any markdown.
        let cleaned = raw
            .trim()
            .trim_matches(|c: char| c == '"' || c == '\'' || c == '`')
            .trim()
            .to_string();

        Ok(cleaned)
    }
}
