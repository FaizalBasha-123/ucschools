use anyhow::Result;

use ai_tutor_domain::{
    generation::LessonGenerationRequest,
    scene::{
        ProjectConfig, SceneContent, SceneOutline,
    },
};


use super::*;
use crate::generation::helpers::fallback_project_summary;
use crate::generation::dtos::*;
use crate::generation::helpers::*;

impl LlmGenerationPipeline {
pub(crate)     async fn generate_project_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        pdf_context: Option<&str>,
    ) -> Result<SceneContent> {
        let pdf_info = pdf_context.map(|ctx| format!("Attached PDF Content Context:\n{}\n", ctx)).unwrap_or_default();
        let mut vars = std::collections::HashMap::new();
        vars.insert("title", outline.title.clone());
        vars.insert("description", outline.description.clone());
        vars.insert("keyPoints", outline.key_points.join("\n"));
        vars.insert("languageDirective", outline.language.as_deref().unwrap_or("Teach in English.").to_string());
        
        let pbl_config = outline.project_config.clone().unwrap_or_default();
        vars.insert("projectTopic", pbl_config.project_topic);
        vars.insert("projectDescription", pbl_config.project_description);
        vars.insert("targetSkills", pbl_config.target_skills.join(", "));

        let (system, mut user) = crate::prompt_builder::build_prompt("pbl-content", &vars).unwrap_or_else(|| {
            (
                "You design project-based learning plans. Return strict JSON only.".to_string(),
                format!("PBL: {}\nRequirement: {}", outline.title, request.requirements.requirement)
            )
        });

        if !pdf_info.is_empty() {
            user.push_str(&format!("\n\n{}", pdf_info));
        }

        let (response, _usage) = self.generate_json_with_search_tool(&system, &user).await?;
        let mut payload: ProjectContentEnvelope =
            parse_json_with_repair(&response).unwrap_or(ProjectContentEnvelope {
                summary: fallback_project_summary(outline),
                title: None,
                driving_question: None,
                final_deliverable: None,
                target_skills: None,
                milestones: None,
                team_roles: None,
                assessment_focus: None,
                starter_prompt: None,
                success_criteria: None,
                facilitator_notes: None,
            });
        if let Some(revision_notes) = project_content_revision_notes(&payload) {
            if let Ok(revised) = self
                .revise_project_content(request, outline, &payload, &revision_notes)
                .await
            {
                payload = merge_project_content(payload, revised);
            }
        }
        let project_title = payload
            .title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(outline.title.as_str())
            .to_string();
        let project_summary = if payload.summary.trim().is_empty() {
            fallback_project_summary(outline)
        } else {
            payload.summary.clone()
        };

        let role_plan = self
            .generate_project_role_plan(
                request,
                outline,
                &project_title,
                &project_summary,
                &payload,
            )
            .await
            .ok();
        let issue_board = self
            .generate_project_issue_board(
                request,
                outline,
                &project_title,
                &project_summary,
                role_plan.as_ref(),
            )
            .await
            .ok();

        Ok(SceneContent::Project {
            project_config: ProjectConfig {
                summary: project_summary,
                title: Some(project_title),
                driving_question: payload
                    .driving_question
                    .filter(|value| !value.trim().is_empty()),
                final_deliverable: payload
                    .final_deliverable
                    .filter(|value| !value.trim().is_empty()),
                target_skills: payload.target_skills.filter(|value| !value.is_empty()),
                milestones: payload.milestones.filter(|value| !value.is_empty()),
                team_roles: payload.team_roles.filter(|value| !value.is_empty()),
                assessment_focus: payload.assessment_focus.filter(|value| !value.is_empty()),
                starter_prompt: payload
                    .starter_prompt
                    .filter(|value| !value.trim().is_empty()),
                success_criteria: role_plan
                    .as_ref()
                    .and_then(|plan| {
                        (!plan.success_criteria.is_empty()).then(|| plan.success_criteria.clone())
                    })
                    .or_else(|| payload.success_criteria.filter(|value| !value.is_empty())),
                facilitator_notes: role_plan
                    .as_ref()
                    .and_then(|plan| {
                        (!plan.facilitator_notes.is_empty()).then(|| plan.facilitator_notes.clone())
                    })
                    .or_else(|| payload.facilitator_notes.filter(|value| !value.is_empty())),
                agent_roles: role_plan.and_then(|plan| map_project_agent_roles(plan.agent_roles)),
                issue_board: issue_board.and_then(|plan| map_project_issue_board(plan.issue_board)),
            },
        })
    }

}
impl LlmGenerationPipeline {
pub(crate)     async fn generate_project_role_plan(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        project_title: &str,
        project_summary: &str,
        payload: &ProjectContentEnvelope,
    ) -> Result<ProjectRolePlanEnvelope> {
        let system = "You are a PBL facilitation designer. Return strict JSON only.";
        let user = format!(
            "Create the collaboration plan for this classroom PBL project.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Project title: {}\n\
             Project summary: {}\n\
             Driving question: {}\n\
             Deliverable: {}\n\
             Milestones: {}\n\
             Return JSON object with shape {{\"agent_roles\":[{{\"name\":\"...\",\"responsibility\":\"...\",\"deliverable\":\"optional\"}}],\"success_criteria\":[\"...\"],\"facilitator_notes\":[\"...\"]}}.\n\
             Create 2-4 agent roles, 3-5 success criteria, and 2-4 concise facilitator notes. Keep it concrete and classroom-manageable.",
            request.requirements.requirement,
            outline.title,
            project_title,
            project_summary,
            payload.driving_question.as_deref().unwrap_or("Not specified"),
            payload.final_deliverable.as_deref().unwrap_or("Not specified"),
            payload
                .milestones
                .as_ref()
                .map(|items| items.join(" | "))
                .unwrap_or_else(|| "Not specified".to_string()),
        );
        let (response, _usage) = self.generate_json_with_search_tool(&system, &user).await?;
        parse_json_with_repair(&response)
    }

}
impl LlmGenerationPipeline {
pub(crate)     async fn revise_project_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        payload: &ProjectContentEnvelope,
        revision_notes: &str,
    ) -> Result<ProjectContentEnvelope> {
        let system = "You revise classroom PBL plans. Return strict JSON only.";
        let user = format!(
            "Revise this classroom PBL plan so it is complete and facilitation-ready.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             Current plan JSON: {}\n\
             Revision requirements:\n{}\n\
             Return JSON object with shape {{\"summary\":\"...\",\"title\":\"...\",\"driving_question\":\"...\",\"final_deliverable\":\"...\",\"target_skills\":[\"...\"],\"milestones\":[\"...\"],\"team_roles\":[\"...\"],\"assessment_focus\":[\"...\"],\"starter_prompt\":\"...\",\"success_criteria\":[\"...\"],\"facilitator_notes\":[\"...\"]}}.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            serde_json::to_string(payload).unwrap_or_default(),
            revision_notes,
        );
        let (response, _usage) = self.generate_json_with_retry(system, &user).await?;
        parse_json_with_repair(&response)
    }

}
impl LlmGenerationPipeline {
pub(crate)     async fn generate_project_issue_board(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        project_title: &str,
        project_summary: &str,
        role_plan: Option<&ProjectRolePlanEnvelope>,
    ) -> Result<ProjectIssueBoardEnvelope> {
        let roles_summary = role_plan
            .map(|plan| {
                plan.agent_roles
                    .iter()
                    .map(|role| format!("{} => {}", role.name, role.responsibility))
                    .collect::<Vec<_>>()
                    .join(" | ")
            })
            .unwrap_or_else(|| "No roles available".to_string());
        let issue_count = outline
            .project_config
            .as_ref()
            .and_then(|config| config.issue_count)
            .unwrap_or(3)
            .clamp(2, 5);
        let system =
            "You are a project issue-board planner for classroom PBL. Return strict JSON only.";
        let user = format!(
            "Create a small issue board for this classroom project.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Project title: {}\n\
             Project summary: {}\n\
             Key points: {}\n\
             Available roles: {}\n\
             Return JSON object with shape {{\"issue_board\":[{{\"title\":\"...\",\"description\":\"...\",\"owner_role\":\"optional\",\"checkpoints\":[\"...\"]}}]}}.\n\
             Create exactly {} issues representing the major work packages students must complete. Each issue should include 2-4 checkpoints.",
            request.requirements.requirement,
            outline.title,
            project_title,
            project_summary,
            outline.key_points.join(" | "),
            roles_summary,
            issue_count,
        );
        let (response, _usage) = self.generate_json_with_search_tool(&system, &user).await?;
        parse_json_with_repair(&response)
    }
}
