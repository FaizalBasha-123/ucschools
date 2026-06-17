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
pub(crate)     async fn generate_slide_content(
        &self,
        _request: &LessonGenerationRequest,
        outline: &SceneOutline,
        _pdf_context: Option<&str>,
        agents: &[GeneratedAgentConfig],
    ) -> Result<SceneContent> {
        let mut vars = std::collections::HashMap::new();
        vars.insert("title", outline.title.clone());
        vars.insert("description", outline.description.clone());
        let key_points = outline.key_points.iter().enumerate().map(|(i, p)| format!("{}. {}", i + 1, p)).collect::<Vec<_>>().join("\n");
        vars.insert("keyPoints", key_points);
        vars.insert("elements", "（根据要点自动生成）".to_string());
        
        let mut assigned_images_text = "无可用图片，禁止插入任何 image 元素".to_string();
        let media = &outline.media_generations;
        if !media.is_empty() {
            let gen_img_descs = media.iter().filter(|m| matches!(m.media_type, ai_tutor_domain::scene::MediaType::Image))
                .map(|mg| format!("- {}: \"{}\" (aspect ratio: 16:9)", mg.element_id, mg.prompt))
                .collect::<Vec<_>>().join("\n");
            let gen_vid_descs = media.iter().filter(|m| matches!(m.media_type, ai_tutor_domain::scene::MediaType::Video))
                .map(|mg| format!("- {}: \"{}\" (aspect ratio: 16:9)", mg.element_id, mg.prompt))
                .collect::<Vec<_>>().join("\n");
            
            let mut media_parts = Vec::new();
            if !gen_img_descs.is_empty() {
                media_parts.push(format!("AI-Generated Images (use these IDs as image element src):\n{}", gen_img_descs));
            }
            if !gen_vid_descs.is_empty() {
                media_parts.push(format!("AI-Generated Videos (use these IDs as video element mediaRef):\n{}", gen_vid_descs));
            }
            if !media_parts.is_empty() {
                assigned_images_text = media_parts.join("\n\n");
            }
        }
        vars.insert("assignedImages", assigned_images_text);
        vars.insert("canvas_width", "1000".to_string());
        vars.insert("canvas_height", "562.5".to_string());
        // Inject teacher persona — this is the key quality driver (same as OpenMAIC's formatTeacherPersonaForPrompt)
        let teacher_context = agents.iter().find(|a| a.role == "teacher").map(|t| {
            format!("Teacher Persona:\nName: {}\n{}\n\nAdapt the content style and tone to match this teacher's personality. IMPORTANT: The teacher's name and identity must NOT appear on the slides — no \"Teacher {}'s tips\", no \"Teacher's message\", etc. Slides should read as neutral, professional visual aids.",
                t.name, t.persona, t.name)
        }).unwrap_or_default();
        vars.insert("teacherContext", teacher_context);
        vars.insert("languageDirective", outline.language.as_deref().unwrap_or("Teach in English.").to_string());
        
        let has_image = outline.media_generations.iter().any(|x| matches!(x.media_type, ai_tutor_domain::scene::MediaType::Image));
        let has_vid = outline.media_generations.iter().any(|x| matches!(x.media_type, ai_tutor_domain::scene::MediaType::Video));
        
        vars.insert("imageElementEnabled", if has_image { "true".to_string() } else { "false".to_string() });
        vars.insert("generatedImageEnabled", if has_image { "true".to_string() } else { "false".to_string() });
        vars.insert("generatedVideoEnabled", if has_vid { "true".to_string() } else { "false".to_string() });
        vars.insert("mediaElementEnabled", if has_image || has_vid { "true".to_string() } else { "false".to_string() });

        let (system, user) = crate::prompt_builder::build_prompt("slide-content", &vars).unwrap_or_else(|| {
            (
                "You are an educational content designer. Generate visually rich, well-structured slide components. Return strict JSON only.".to_string(),
                "Error loading prompt.".to_string()
            )
        });

        let (response, _usage) = self.generate_json_with_search_tool(&system, &user).await?;
        let payload: SlideContentEnvelope = parse_json_with_repair(&response)
            .unwrap_or_else(|_| SlideContentEnvelope { background: None, elements: vec![] });

        let elements = payload
            .elements
            .into_iter()
            .enumerate()
            .map(|(index, element)| map_slide_element(element, index))
            .collect::<Vec<_>>();
        let elements = if elements.is_empty() {
            fallback_slide_elements(outline)
        } else {
            let elements = repair_media_elements(elements, outline);
            let elements = attach_media_placeholders(elements, outline);
            validate_slide_elements(elements, outline)
        };

        Ok(SceneContent::Slide {
            canvas: SlideCanvas {
                id: format!("canvas-{}", outline.id),
                viewport_width: 1000,
                viewport_height: 563,
                viewport_ratio: 0.5625,
                theme: SlideTheme {
                    background_color: "#ffffff".to_string(),
                    theme_colors: vec![
                        "#1f2937".to_string(),
                        "#0f766e".to_string(),
                        "#2563eb".to_string(),
                    ],
                    font_color: "#111827".to_string(),
                    font_name: "Geist".to_string(),
                },
                elements,
                background: payload.background,
            },
        })
    }

}
