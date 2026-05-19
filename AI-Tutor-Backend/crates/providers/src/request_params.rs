use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Response format configuration for LLM provider requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseFormat {
    Text,
    JsonObject,
    JsonSchema { schema: Value },
}

/// A tool definition that can be passed to an LLM provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: ToolFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Value>,
}

/// How the model should pick which tool to call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolChoice {
    None,
    Auto,
    Required,
    Specific { name: String },
}

/// Generation parameters that can be passed to any LLM provider.
///
/// All fields are optional — providers ignore fields they don't support
/// or that are set to `None`.
#[derive(Debug, Clone, Default)]
pub struct GenerationParams {
    pub response_format: Option<ResponseFormat>,
    pub tools: Option<Vec<ToolDefinition>>,
    pub tool_choice: Option<ToolChoice>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

impl GenerationParams {
    /// Params with `response_format` set to `JsonObject`.
    pub fn json_object() -> Self {
        Self {
            response_format: Some(ResponseFormat::JsonObject),
            ..Default::default()
        }
    }

    /// Params with a specific temperature override.
    pub fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = Some(temperature);
        self
    }
}
