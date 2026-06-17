use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Deserialize)]
pub(crate) struct OutlineResponseEnvelope {
    #[serde(default, alias = "languageDirective")]
    pub(crate) language_directive: Option<String>,
    pub(crate) outlines: Vec<OutlineDto>,
}

#[derive(Deserialize)]
pub(crate) struct OutlineEnvelope {
    pub(crate) outlines: Vec<OutlineDto>,
}

#[derive(Deserialize)]
pub(crate) struct OutlineDto {
    pub(crate) title: String,
    pub(crate) description: String,
    #[serde(default, alias = "teachingObjective", alias = "teaching_objective")]
    pub(crate) teaching_objective: Option<String>,
    #[serde(default, alias = "estimatedDuration", alias = "estimated_duration")]
    pub(crate) estimated_duration: Option<i32>,
    #[serde(default, alias = "order")]
    pub(crate) order: Option<i32>,
    #[serde(default, alias = "suggestedImageIds", alias = "suggested_image_ids")]
    pub(crate) suggested_image_ids: Vec<String>,
    #[serde(default, alias = "keyPoints")]
    pub(crate) key_points: Vec<String>,
    #[serde(alias = "type", alias = "sceneType")]
    pub(crate) scene_type: String,
    /// Visual type chosen by the LLM: none|svg|chart|latex|html|image
    #[serde(default, alias = "visualType", alias = "visual_type")]
    pub(crate) visual_type: Option<String>,
    #[serde(default, alias = "mediaGenerations")]
    pub(crate) media_generations: Vec<MediaGenerationDto>,
    #[serde(default, alias = "quizConfig", alias = "quiz_config")]
    pub(crate) quiz_config: Option<QuizConfigDto>,
    #[serde(default, alias = "interactiveConfig", alias = "interactive_config")]
    pub(crate) interactive_config: Option<InteractiveConfigDto>,
    #[serde(
        default,
        alias = "pblConfig",
        alias = "projectConfig",
        alias = "project_config"
    )]
    pub(crate) project_config: Option<ProjectOutlineConfigDto>,
    #[serde(default, alias = "widgetType", alias = "widget_type")]
    pub(crate) widget_type: Option<String>,
    #[serde(default, alias = "widgetOutline", alias = "widget_outline")]
    pub(crate) widget_outline: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub(crate) struct MediaGenerationDto {
    pub(crate) element_id: String,
    pub(crate) media_type: String,
    pub(crate) prompt: String,
    pub(crate) aspect_ratio: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct SlideContentEnvelope {
    pub(crate) background: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) elements: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
pub(crate) struct SlideElementDto {
    #[serde(alias = "type")]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) id: Option<String>,
    pub(crate) content: Option<String>,
    pub(crate) src: Option<String>,
    #[serde(default)]
    pub(crate) latex: Option<String>,
    #[serde(default, alias = "shapeName", alias = "shape_name")]
    pub(crate) shape_name: Option<String>,
    #[serde(default, alias = "chartType", alias = "chart_type")]
    pub(crate) chart_type: Option<String>,
    #[serde(default)]
    pub(crate) fill: Option<String>,
    /// Raw SVG markup for kind=svg elements.
    /// Accessibility description for kind=svg elements.
    #[allow(dead_code)]
    #[serde(default)]
    pub(crate) alt: Option<String>,
    pub(crate) left: f32,
    pub(crate) top: f32,
    pub(crate) width: f32,
    pub(crate) height: f32,
    #[serde(default)]
    pub(crate) rotate: f32,
    #[serde(default)]
    pub(crate) path: Option<String>,
    #[serde(default, alias = "viewBox")]
    pub(crate) view_box: Option<Vec<f32>>,
    #[serde(default)]
    pub(crate) start: Option<Vec<f32>>,
    #[serde(default)]
    pub(crate) end: Option<Vec<f32>>,
    #[serde(default)]
    pub(crate) style: Option<String>,
    #[serde(default)]
    pub(crate) color: Option<String>,
    #[serde(default)]
    pub(crate) points: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) broken: Option<Vec<f32>>,
    #[serde(default)]
    pub(crate) broken2: Option<Vec<f32>>,
    #[serde(default)]
    pub(crate) curve: Option<Vec<f32>>,
    #[serde(default)]
    pub(crate) cubic: Option<Vec<Vec<f32>>>,
    #[serde(default)]
    pub(crate) data: Option<serde_json::Value>,
    #[serde(default, alias = "themeColors")]
    pub(crate) theme_colors: Option<Vec<String>>,
    #[serde(default, alias = "colWidths")]
    pub(crate) col_widths: Option<Vec<f32>>,
    #[serde(default)]
    pub(crate) outline: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) theme: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) align: Option<String>,
    #[serde(default)]
    pub(crate) shadow: Option<serde_json::Value>,
    #[serde(default, alias = "defaultFontName")]
    pub(crate) default_font_name: Option<String>,
    #[serde(default, alias = "defaultColor")]
    pub(crate) default_color: Option<String>,
    #[serde(default, alias = "lineHeight")]
    pub(crate) line_height: Option<f32>,
    #[serde(default)]
    pub(crate) opacity: Option<f32>,
    #[serde(default, alias = "wordSpace")]
    pub(crate) word_space: Option<f32>,
    #[serde(default, alias = "paragraphSpace")]
    pub(crate) paragraph_space: Option<f32>,
    #[serde(default)]
    pub(crate) vertical: Option<bool>,
    #[serde(default)]
    pub(crate) html: Option<String>,
    #[serde(default, alias = "strokeWidth")]
    pub(crate) stroke_width: Option<f32>,
    #[serde(default, alias = "fixedRatio")]
    pub(crate) fixed_ratio: Option<bool>,
}

#[derive(Deserialize)]
pub(crate) struct QuizContentEnvelope {
    pub(crate) questions: Vec<QuizQuestionDto>,
}

#[derive(Deserialize)]
pub(crate) struct InteractiveContentEnvelope {
    pub(crate) html: Option<String>,
    pub(crate) url: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct ProjectContentEnvelope {
    pub(crate) summary: String,
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default, alias = "drivingQuestion", alias = "driving_question")]
    pub(crate) driving_question: Option<String>,
    #[serde(default, alias = "finalDeliverable", alias = "final_deliverable")]
    pub(crate) final_deliverable: Option<String>,
    #[serde(default, alias = "targetSkills", alias = "target_skills")]
    pub(crate) target_skills: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) milestones: Option<Vec<String>>,
    #[serde(default, alias = "teamRoles", alias = "team_roles")]
    pub(crate) team_roles: Option<Vec<String>>,
    #[serde(default, alias = "assessmentFocus", alias = "assessment_focus")]
    pub(crate) assessment_focus: Option<Vec<String>>,
    #[serde(default, alias = "starterPrompt", alias = "starter_prompt")]
    pub(crate) starter_prompt: Option<String>,
    #[serde(default, alias = "successCriteria", alias = "success_criteria")]
    pub(crate) success_criteria: Option<Vec<String>>,
    #[serde(default, alias = "facilitatorNotes", alias = "facilitator_notes")]
    pub(crate) facilitator_notes: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub(crate) struct ProjectRolePlanEnvelope {
    #[serde(default, alias = "agentRoles", alias = "agent_roles")]
    pub(crate) agent_roles: Vec<ProjectAgentRoleEnvelope>,
    #[serde(default, alias = "successCriteria", alias = "success_criteria")]
    pub(crate) success_criteria: Vec<String>,
    #[serde(default, alias = "facilitatorNotes", alias = "facilitator_notes")]
    pub(crate) facilitator_notes: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct ProjectAgentRoleEnvelope {
    pub(crate) name: String,
    pub(crate) responsibility: String,
    #[serde(default)]
    pub(crate) deliverable: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ProjectIssueBoardEnvelope {
    #[serde(default, alias = "issueBoard", alias = "issue_board")]
    pub(crate) issue_board: Vec<ProjectIssueEnvelope>,
}

#[derive(Deserialize)]
pub(crate) struct ProjectIssueEnvelope {
    pub(crate) title: String,
    pub(crate) description: String,
    #[serde(default, alias = "ownerRole", alias = "owner_role")]
    pub(crate) owner_role: Option<String>,
    #[serde(default)]
    pub(crate) checkpoints: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct QuizQuestionDto {
    pub(crate) question: String,
    pub(crate) options: Option<Vec<String>>,
    pub(crate) answer: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub(crate) struct ActionsEnvelope {
    pub(crate) actions: Vec<ActionDto>,
}

#[derive(Deserialize)]
pub(crate) struct ActionDto {
    #[serde(alias = "type")]
    pub(crate) action_type: String,
    #[serde(alias = "content")]
    pub(crate) text: Option<String>,
    pub(crate) element_id: Option<String>,
    pub(crate) topic: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct QuizConfigDto {
    #[serde(default, alias = "questionCount", alias = "question_count")]
    pub(crate) question_count: Option<i32>,
    #[serde(default)]
    pub(crate) difficulty: Option<String>,
    #[serde(default, alias = "questionTypes", alias = "question_types")]
    pub(crate) question_types: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct InteractiveConfigDto {
    #[serde(default, alias = "conceptName", alias = "concept_name")]
    pub(crate) concept_name: Option<String>,
    #[serde(default, alias = "conceptOverview", alias = "concept_overview")]
    pub(crate) concept_overview: Option<String>,
    #[serde(default, alias = "designIdea", alias = "design_idea")]
    pub(crate) design_idea: Option<String>,
    #[serde(default)]
    pub(crate) subject: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ProjectOutlineConfigDto {
    #[serde(default, alias = "projectTopic", alias = "project_topic")]
    pub(crate) project_topic: Option<String>,
    #[serde(default, alias = "projectDescription", alias = "project_description")]
    pub(crate) project_description: Option<String>,
    #[serde(default, alias = "targetSkills", alias = "target_skills")]
    pub(crate) target_skills: Vec<String>,
    #[serde(default, alias = "issueCount", alias = "issue_count")]
    pub(crate) issue_count: Option<i32>,
    #[serde(default)]
    pub(crate) language: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum StructuredActionItemDto {
    Text {
    content: String,
    },
    Action {
        name: String,
        #[serde(default)]
    params: Option<Value>,
        #[serde(default, alias = "tool_name")]
    tool_name: Option<String>,
        #[serde(default, alias = "parameters")]
    parameters: Option<Value>,
    },
}

#[derive(Deserialize)]
pub(crate) struct ScientificModelEnvelope {
    #[serde(default)]
    pub(crate) core_formulas: Vec<String>,
    #[serde(default)]
    pub(crate) mechanism: Vec<String>,
    #[serde(default)]
    pub(crate) constraints: Vec<String>,
    #[serde(default, alias = "forbiddenErrors", alias = "forbidden_errors")]
    pub(crate) forbidden_errors: Vec<String>,
    #[serde(default)]
    pub(crate) variables: Vec<String>,
    #[serde(default, alias = "interactionGuidance", alias = "interaction_guidance")]
    pub(crate) interaction_guidance: Vec<String>,
    #[serde(default, alias = "experimentSteps", alias = "experiment_steps")]
    pub(crate) experiment_steps: Vec<String>,
    #[serde(default, alias = "observationPrompts", alias = "observation_prompts")]
    pub(crate) observation_prompts: Vec<String>,
}
