use serde::{Deserialize, Serialize};

use crate::action::LessonAction;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: String,
    pub stage_id: String,
    pub title: String,
    pub order: i32,
    pub content: SceneContent,
    pub actions: Vec<LessonAction>,
    pub whiteboards: Vec<Whiteboard>,
    pub multi_agent: Option<MultiAgentConfig>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SceneContent {
    Slide { canvas: SlideCanvas },
    Quiz { questions: Vec<QuizQuestion> },
    Interactive {
        url: String,
        html: Option<String>,
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
    pub elements: Vec<SlideElement>,
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
    pub options: Option<Vec<QuizOption>>,
    pub answer: Option<Vec<String>>,
    pub analysis: Option<String>,
    pub comment_prompt: Option<String>,
    pub has_answer: Option<bool>,
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
    pub title: Option<String>,
    pub driving_question: Option<String>,
    pub final_deliverable: Option<String>,
    pub target_skills: Option<Vec<String>>,
    pub milestones: Option<Vec<String>>,
    pub team_roles: Option<Vec<String>>,
    pub assessment_focus: Option<Vec<String>>,
    pub starter_prompt: Option<String>,
    pub success_criteria: Option<Vec<String>>,
    pub facilitator_notes: Option<Vec<String>>,
    pub agent_roles: Option<Vec<ProjectAgentRole>>,
    pub issue_board: Option<Vec<ProjectIssue>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAgentRole {
    pub name: String,
    pub responsibility: String,
    pub deliverable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectIssue {
    pub title: String,
    pub description: String,
    pub owner_role: Option<String>,
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
    pub agent_ids: Vec<String>,
    pub director_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stage {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub language: Option<String>,
    pub style: Option<String>,
    pub whiteboard: Vec<Whiteboard>,
    pub agent_ids: Vec<String>,
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
    pub key_points: Vec<String>,
    pub teaching_objective: Option<String>,
    pub estimated_duration: Option<i32>,
    pub order: i32,
    pub language: Option<String>,
    pub suggested_image_ids: Vec<String>,
    pub media_generations: Vec<MediaGenerationRequest>,
    pub quiz_config: Option<QuizConfig>,
    pub interactive_config: Option<InteractiveConfig>,
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
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectOutlineConfig {
    pub project_topic: String,
    pub project_description: String,
    pub target_skills: Vec<String>,
    pub issue_count: Option<i32>,
    pub language: String,
}
