use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TutorAccountStatus {
    PreRegistered,
    PartialAuth,
    Active,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TutorAccount {
    pub id: String,
    pub email: String,
    pub google_id: String,
    pub phone_number: Option<String>,
    pub phone_verified: bool,
    pub status: TutorAccountStatus,
    #[serde(default)]
    pub school_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
