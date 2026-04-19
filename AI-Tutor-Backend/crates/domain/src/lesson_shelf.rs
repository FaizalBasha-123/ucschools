use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LessonShelfStatus {
    Generating,
    Ready,
    Failed,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonShelfItem {
    pub id: String,
    pub account_id: String,
    pub lesson_id: String,
    pub source_job_id: Option<String>,
    pub title: String,
    pub subject: Option<String>,
    pub language: Option<String>,
    pub status: LessonShelfStatus,
    pub progress_pct: i32,
    pub last_opened_at: Option<DateTime<Utc>>,
    pub archived_at: Option<DateTime<Utc>>,
    pub thumbnail_url: Option<String>,
    pub failure_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
