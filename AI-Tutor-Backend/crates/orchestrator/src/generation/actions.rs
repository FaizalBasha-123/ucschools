use anyhow::Result;

use ai_tutor_domain::{
    action::LessonAction,
    generation::LessonGenerationRequest,
    scene::{
        GeneratedAgentConfig, SceneContent, SceneOutline,
    },
};


use super::*;
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
        let has_pdf = pdf_context.map_or(false, |c| !c.trim().is_empty());
        let (system, user) =
            build_scene_action_prompt(request, outline, content, pdf_context, all_outlines, outline_index, agents)?;

        let (primary_response, _usage) = self
            .generate_json_with_search_tool_using(self.scene_actions_llm(), &system, &user, has_pdf)
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

        validate_actions(&mut actions, content, agents);
        enforce_discussion_last(&mut actions);
        Ok(actions)
    }
}
