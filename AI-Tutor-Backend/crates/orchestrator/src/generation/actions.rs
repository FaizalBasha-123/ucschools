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
pub(crate)     async fn do_generate_scene_actions(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        content: &SceneContent,
        pdf_context: Option<&str>,
        all_outlines: &[SceneOutline],
        outline_index: usize,
        agents: &[GeneratedAgentConfig],
    ) -> Result<Vec<LessonAction>> {
        let (system, user) =
            build_scene_action_prompt(request, outline, content, pdf_context, all_outlines, outline_index, agents)?;

        let (primary_response, _usage) = self
            .generate_json_with_search_tool_using(self.scene_actions_llm(), &system, &user)
            .await?;
        let mut actions =
            parse_actions_from_generation_response(&primary_response, outline, content);

        let needs_escalation = actions.is_empty();
        if needs_escalation {
            if let Some(fallback_llm) = self.scene_actions_fallback_llm.as_deref() {
                let (fallback_response, _usage) = self
                    .generate_json_with_retry_using(fallback_llm, &system, &user)
                    .await?;
                let fallback_actions =
                    parse_actions_from_generation_response(&fallback_response, outline, content);
                if !fallback_actions.is_empty() {
                    actions = fallback_actions;
                }
            }
        }

        if actions.is_empty() {
            actions.push(LessonAction::Speech {
                id: "action-fallback-speech".to_string(),
                title: Some(outline.title.clone()),
                description: Some("Fallback narration".to_string()),
                text: outline.description.clone(),
                audio_id: None,
                audio_url: None,
                voice: None,
                speed: None,
            });
        }

        enforce_discussion_last(&mut actions);
        Ok(actions)
    }
}
