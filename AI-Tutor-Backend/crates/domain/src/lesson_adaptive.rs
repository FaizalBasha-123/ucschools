use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LessonAdaptiveStatus {
    Active,
    Reinforce,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonAdaptiveState {
    pub lesson_id: String,
    pub account_id: Option<String>,
    pub topic: Option<String>,
    pub diagnostic_count: i32,
    pub max_diagnostics: i32,
    pub current_strategy: String,
    pub misconception_id: Option<String>,
    pub confidence_score: f32,
    pub status: LessonAdaptiveStatus,
    pub updated_at: DateTime<Utc>,
}

impl LessonAdaptiveState {
    pub fn new(lesson_id: impl Into<String>, account_id: Option<String>, topic: Option<String>) -> Self {
        Self {
            lesson_id: lesson_id.into(),
            account_id,
            topic,
            diagnostic_count: 0,
            max_diagnostics: 2,
            current_strategy: "teach".to_string(),
            misconception_id: None,
            confidence_score: 0.0,
            status: LessonAdaptiveStatus::Active,
            updated_at: Utc::now(),
        }
    }
}
