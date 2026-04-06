use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    OpenAi,
    Anthropic,
    Google,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingCapability {
    pub toggleable: bool,
    pub budget_adjustable: bool,
    pub default_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingConfig {
    pub enabled: Option<bool>,
    pub budget_tokens: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_window: Option<i32>,
    pub output_window: Option<i32>,
    pub capabilities: ModelCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelCapabilities {
    pub streaming: bool,
    pub tools: bool,
    pub vision: bool,
    pub thinking: Option<ThinkingCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: ProviderType,
    pub default_base_url: Option<String>,
    pub requires_api_key: bool,
    pub icon: Option<String>,
    pub models: Vec<ModelInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider_id: String,
    pub model_id: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub proxy: Option<String>,
    pub provider_type: Option<ProviderType>,
    pub requires_api_key: Option<bool>,
}
