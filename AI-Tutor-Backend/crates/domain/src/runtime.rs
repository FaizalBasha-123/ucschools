use serde::{Deserialize, Serialize};

use crate::scene::{Scene, Stage};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionType {
    Qa,
    Discussion,
    Lecture,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Active,
    Interrupted,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeMode {
    Autonomous,
    Playback,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSession {
    pub id: String,
    pub session_type: SessionType,
    pub title: String,
    pub status: SessionStatus,
    pub config: SessionConfig,
    pub stage_state: ClientStageState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub agent_ids: Vec<String>,
    pub max_turns: i32,
    pub current_turn: i32,
    pub trigger_agent_id: Option<String>,
    pub default_agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientStageState {
    pub stage: Option<Stage>,
    pub scenes: Vec<Scene>,
    pub current_scene_id: Option<String>,
    pub mode: RuntimeMode,
    pub whiteboard_open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectorState {
    pub turn_count: i32,
    pub agent_responses: Vec<AgentTurnSummary>,
    pub whiteboard_ledger: Vec<WhiteboardActionRecord>,
    pub whiteboard_state: Option<PersistedWhiteboardState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTurnSummary {
    pub agent_id: String,
    pub agent_name: String,
    pub content_preview: String,
    pub action_count: i32,
    pub whiteboard_actions: Vec<WhiteboardActionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhiteboardActionRecord {
    pub action_name: String,
    pub agent_id: String,
    pub agent_name: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedWhiteboardState {
    pub id: String,
    pub is_open: bool,
    pub version: u64,
    pub objects: Vec<PersistedWhiteboardObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PersistedWhiteboardObject {
    Path {
        id: String,
        points: Vec<PersistedPoint2D>,
        color: String,
        stroke_width: f32,
    },
    Text {
        id: String,
        position: PersistedPoint2D,
        content: String,
        font_size: f32,
        color: String,
    },
    Rectangle {
        id: String,
        position: PersistedPoint2D,
        width: f32,
        height: f32,
        color: String,
        fill: Option<String>,
        stroke_width: f32,
    },
    Circle {
        id: String,
        center: PersistedPoint2D,
        radius: f32,
        color: String,
        fill: Option<String>,
        stroke_width: f32,
    },
    Highlight {
        id: String,
        position: PersistedPoint2D,
        width: f32,
        height: f32,
        color: String,
        opacity: f32,
    },
    Arrow {
        id: String,
        start: PersistedPoint2D,
        end: PersistedPoint2D,
        color: String,
        stroke_width: f32,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PersistedPoint2D {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSessionMode {
    StatelessClientState,
    ManagedRuntimeSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSessionSelector {
    pub mode: RuntimeSessionMode,
    pub session_id: Option<String>,
    pub create_if_missing: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatelessChatRequest {
    pub session_id: Option<String>,
    pub runtime_session: Option<RuntimeSessionSelector>,
    pub messages: Vec<ChatMessage>,
    pub store_state: ClientStageState,
    pub config: StatelessChatConfig,
    pub director_state: Option<DirectorState>,
    pub user_profile: Option<UserProfile>,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub provider_type: Option<String>,
    pub requires_api_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatelessChatConfig {
    pub agent_ids: Vec<String>,
    pub session_type: Option<String>,
    pub discussion_topic: Option<String>,
    pub discussion_prompt: Option<String>,
    pub trigger_agent_id: Option<String>,
    pub agent_configs: Vec<GeneratedChatAgentConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedChatAgentConfig {
    pub id: String,
    pub name: String,
    pub role: String,
    pub persona: String,
    pub avatar: String,
    pub color: String,
    pub allowed_actions: Vec<String>,
    pub priority: i32,
    pub is_generated: Option<bool>,
    pub bound_stage_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub nickname: Option<String>,
    pub bio: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeActionExecutionStatus {
    Pending,
    Accepted,
    Completed,
    Failed,
    TimedOut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeActionExecutionRecord {
    pub session_id: String,
    pub runtime_session_mode: String,
    pub execution_id: String,
    pub action_name: String,
    pub status: RuntimeActionExecutionStatus,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub timeout_at_unix_ms: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub metadata: Option<ChatMessageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageMetadata {
    pub sender_name: Option<String>,
    pub sender_avatar: Option<String>,
    pub original_role: Option<String>,
    pub agent_id: Option<String>,
    pub agent_color: Option<String>,
    pub created_at: Option<i64>,
    pub interrupted: Option<bool>,
}
