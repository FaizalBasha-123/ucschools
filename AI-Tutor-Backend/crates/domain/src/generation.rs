use serde::{Deserialize, Serialize};

use crate::scene::{SceneOutline, Stage};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRequirements {
    pub requirement: String,
    pub language: Language,
    pub user_nickname: Option<String>,
    pub user_bio: Option<String>,
    pub web_search: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    ZhCn,
    EnUs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfImage {
    pub id: String,
    pub src: String,
    pub page_number: i32,
    pub description: Option<String>,
    pub storage_id: Option<String>,
    pub width: Option<f32>,
    pub height: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfContent {
    pub text: String,
    pub images: Vec<PdfImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonGenerationRequest {
    pub requirements: UserRequirements,
    pub pdf_content: Option<PdfContent>,
    pub enable_web_search: bool,
    pub enable_image_generation: bool,
    pub enable_video_generation: bool,
    pub enable_tts: bool,
    pub agent_mode: AgentMode,
    pub account_id: Option<String>,
    pub generation_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    Default,
    Generate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationSession {
    pub id: String,
    pub requirements: UserRequirements,
    pub scene_outlines: Vec<SceneOutline>,
    pub progress: GenerationProgress,
    pub generated_stage: Option<Stage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationProgress {
    pub current_stage: i32,
    pub overall_progress: i32,
    pub stage_progress: i32,
    pub status_message: String,
    pub scenes_generated: i32,
    pub total_scenes: i32,
    pub errors: Vec<String>,
}
