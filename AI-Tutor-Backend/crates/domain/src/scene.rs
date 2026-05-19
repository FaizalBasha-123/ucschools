use serde::{Deserialize, Serialize};

use crate::action::LessonAction;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: String,
    pub stage_id: String,
    pub title: String,
    pub order: i32,
    pub content: SceneContent,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<LessonAction>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub whiteboards: Vec<Whiteboard>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multi_agent: Option<MultiAgentConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SceneContent {
    Slide { canvas: SlideCanvas },
    Quiz { questions: Vec<QuizQuestion> },
    Interactive {
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        html: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scientific_model: Option<ScientificModel>,
    },
    Project { project_config: ProjectConfig },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideCanvas {
    pub id: String,
    pub viewport_width: i32,
    pub viewport_height: i32,
    pub viewport_ratio: f32,
    pub theme: SlideTheme,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elements: Vec<SlideElement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<SlideBackground>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideTheme {
    pub background_color: String,
    pub theme_colors: Vec<String>,
    pub font_color: String,
    pub font_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SlideElement {
    Text {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        content: String,
    },
    Image {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        src: String,
    },
    Shape {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shape_name: Option<String>,
    },
    Line {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
    },
    Chart {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        chart_type: Option<String>,
    },
    Latex {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        latex: String,
    },
    Table {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
    },
    Video {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        src: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SlideBackground {
    Solid { color: String },
    Gradient { from: String, to: String },
    Image { src: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizQuestion {
    pub id: String,
    pub question_type: QuizQuestionType,
    pub question: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<QuizOption>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_answer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuizQuestionType {
    Single,
    Multiple,
    ShortAnswer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub driving_question: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_deliverable: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_skills: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub milestones: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_roles: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assessment_focus: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starter_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success_criteria: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facilitator_notes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_roles: Option<Vec<ProjectAgentRole>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_board: Option<Vec<ProjectIssue>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAgentRole {
    pub name: String,
    pub responsibility: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deliverable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectIssue {
    pub title: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_role: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checkpoints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScientificModel {
    pub core_formulas: Vec<String>,
    pub mechanism: Vec<String>,
    pub constraints: Vec<String>,
    pub forbidden_errors: Vec<String>,
    pub variables: Vec<String>,
    pub interaction_guidance: Vec<String>,
    pub experiment_steps: Vec<String>,
    pub observation_prompts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Whiteboard {
    pub id: String,
    pub elements: Vec<WhiteboardElement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WhiteboardElement {
    Text { id: String },
    Shape { id: String },
    Chart { id: String },
    Latex { id: String },
    Table { id: String },
    Line { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiAgentConfig {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub director_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stage {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub whiteboard: Vec<Whiteboard>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generated_agent_configs: Vec<GeneratedAgentConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedAgentConfig {
    pub id: String,
    pub name: String,
    pub role: String,
    pub persona: String,
    pub avatar: String,
    pub color: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneOutline {
    pub id: String,
    pub scene_type: SceneType,
    pub title: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub key_points: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub teaching_objective: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_duration: Option<i32>,
    pub order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggested_image_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_generations: Vec<MediaGenerationRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quiz_config: Option<QuizConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interactive_config: Option<InteractiveConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_config: Option<ProjectOutlineConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SceneType {
    Slide,
    Quiz,
    Interactive,
    Pbl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaGenerationRequest {
    pub element_id: String,
    pub media_type: MediaType,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Image,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizConfig {
    pub question_count: i32,
    pub difficulty: String,
    pub question_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveConfig {
    pub concept_name: String,
    pub concept_overview: String,
    pub design_idea: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectOutlineConfig {
    pub project_topic: String,
    pub project_description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_count: Option<i32>,
    pub language: String,
}
