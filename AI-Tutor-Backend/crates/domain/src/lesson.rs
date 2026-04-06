use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::scene::{Scene, Stage};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lesson {
    pub id: String,
    pub title: String,
    pub language: String,
    pub description: Option<String>,
    pub stage: Option<Stage>,
    pub scenes: Vec<Scene>,
    pub style: Option<String>,
    pub agent_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
