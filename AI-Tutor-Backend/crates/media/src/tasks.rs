use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use ai_tutor_domain::scene::{MediaGenerationRequest, MediaType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaTask {
    pub id: String,
    pub lesson_id: String,
    pub scene_outline_id: String,
    pub element_id: String,
    pub media_type: MediaType,
    pub prompt: String,
    pub aspect_ratio: Option<String>,
    pub status: MediaTaskStatus,
    pub output_url: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaTaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsTask {
    pub id: String,
    pub lesson_id: String,
    pub scene_id: String,
    pub action_id: String,
    pub text: String,
    pub voice: Option<String>,
    pub speed: Option<f32>,
    pub status: TtsTaskStatus,
    pub output_url: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TtsTaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

impl MediaTask {
    pub fn from_request(
        lesson_id: &str,
        scene_outline_id: &str,
        request: &MediaGenerationRequest,
        now: DateTime<Utc>,
    ) -> Self {
        Self {
            id: format!("media-task-{}-{}", scene_outline_id, request.element_id),
            lesson_id: lesson_id.to_string(),
            scene_outline_id: scene_outline_id.to_string(),
            element_id: request.element_id.clone(),
            media_type: request.media_type.clone(),
            prompt: request.prompt.clone(),
            aspect_ratio: request.aspect_ratio.clone(),
            status: MediaTaskStatus::Queued,
            output_url: None,
            error: None,
            created_at: now,
            updated_at: now,
        }
    }
}

impl TtsTask {
    pub fn new(
        lesson_id: &str,
        scene_id: &str,
        action_id: &str,
        text: &str,
        voice: Option<String>,
        speed: Option<f32>,
        now: DateTime<Utc>,
    ) -> Self {
        Self {
            id: format!("tts-task-{}-{}", scene_id, action_id),
            lesson_id: lesson_id.to_string(),
            scene_id: scene_id.to_string(),
            action_id: action_id.to_string(),
            text: text.to_string(),
            voice,
            speed,
            status: TtsTaskStatus::Queued,
            output_url: None,
            error: None,
            created_at: now,
            updated_at: now,
        }
    }
}
