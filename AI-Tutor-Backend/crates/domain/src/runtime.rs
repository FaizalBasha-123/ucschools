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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatelessChatRequest {
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
