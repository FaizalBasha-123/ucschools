use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::generation::LessonGenerationRequest;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonGenerationJob {
    pub id: String,
    pub status: LessonGenerationJobStatus,
    pub step: LessonGenerationStep,
    pub progress: i32,
    pub message: String,
    pub input_summary: LessonGenerationJobInputSummary,
    pub scenes_generated: i32,
    pub total_scenes: Option<i32>,
    pub result: Option<LessonGenerationJobResult>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LessonGenerationJobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LessonGenerationStep {
    Queued,
    Initializing,
    Researching,
    GeneratingOutlines,
    GeneratingScenes,
    GeneratingMedia,
    GeneratingTts,
    Persisting,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonGenerationJobInputSummary {
    pub requirement_preview: String,
    pub language: String,
    pub has_pdf: bool,
    pub pdf_text_length: usize,
    pub pdf_image_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonGenerationJobResult {
    pub lesson_id: String,
    pub url: String,
    pub scenes_count: i32,
}

impl From<&LessonGenerationRequest> for LessonGenerationJobInputSummary {
    fn from(value: &LessonGenerationRequest) -> Self {
        let preview = if value.requirements.requirement.len() > 200 {
            format!("{}...", &value.requirements.requirement[..197])
        } else {
            value.requirements.requirement.clone()
        };

        Self {
            requirement_preview: preview,
            language: format!("{:?}", value.requirements.language),
            has_pdf: value.pdf_content.is_some(),
            pdf_text_length: value.pdf_content.as_ref().map(|p| p.text.len()).unwrap_or(0),
            pdf_image_count: value
                .pdf_content
                .as_ref()
                .map(|p| p.images.len())
                .unwrap_or(0),
        }
    }
}
