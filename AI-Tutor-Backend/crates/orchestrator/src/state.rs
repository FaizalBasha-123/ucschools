use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use ai_tutor_domain::{
    generation::LessonGenerationRequest,
    job::LessonGenerationJob,
    lesson::Lesson,
    scene::{Scene, SceneOutline, Stage},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationState {
    pub request_id: String,
    pub lesson_id: String,
    pub request: LessonGenerationRequest,
    pub job: LessonGenerationJob,
    pub stage: Stage,
    pub outlines: Vec<SceneOutline>,
    pub scenes: Vec<Scene>,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationOutput {
    pub lesson: Lesson,
    pub job: LessonGenerationJob,
}
