use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    OpenRouter,
    Groq,
    ElevenLabs,
    OpenAI,
}

impl Provider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OpenRouter => "openrouter",
            Self::Groq => "groq",
            Self::ElevenLabs => "elevenlabs",
            Self::OpenAI => "openai",
        }
    }

    pub fn full_model_string(&self, model_id: &str) -> String {
        format!("{}:{}", self.as_str(), model_id)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ModelCost {
    pub input_per_million: f64,
    pub output_per_million: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct ModelDefinition {
    pub provider: Provider,
    pub model_id: &'static str,
    pub display_name: &'static str,
    pub context_window: usize,
    pub supports_json: bool,
    pub supports_vision: bool,
    pub cost: ModelCost,
}

impl ModelDefinition {
    pub const fn new(
        provider: Provider,
        model_id: &'static str,
        display_name: &'static str,
        context_window: usize,
        supports_json: bool,
        supports_vision: bool,
        input_cost: f64,
        output_cost: f64,
    ) -> Self {
        Self {
            provider,
            model_id,
            display_name,
            context_window,
            supports_json,
            supports_vision,
            cost: ModelCost {
                input_per_million: input_cost,
                output_per_million: output_cost,
            },
        }
    }

    pub fn full_model_string(&self) -> String {
        self.provider.full_model_string(self.model_id)
    }
}

pub const GEMINI_FLASH_LITE: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "google/gemini-2.5-flash-lite",
    "Gemini 2.5 Flash Lite",
    1_000_000,
    true,
    true,
    0.075,
    0.30,
);

pub const GEMINI_FLASH: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "google/gemini-2.5-flash",
    "Gemini 2.5 Flash",
    1_000_000,
    true,
    true,
    0.15,
    0.60,
);

pub const DEEPSEEK_V3: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "deepseek/deepseek-chat-v3-0324",
    "DeepSeek Chat V3",
    128_000,
    true,
    false,
    0.27,
    1.10,
);

pub const CLAUDE_SONNET_46: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "anthropic/claude-sonnet-4.6",
    "Claude Sonnet 4.6",
    200_000,
    true,
    true,
    3.00,
    15.00,
);

pub const CLAUDE_35_HAIKU: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "anthropic/claude-3-5-haiku",
    "Claude 3.5 Haiku",
    200_000,
    true,
    true,
    0.80,
    4.00,
);

pub const LLAMA_31_8B: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "meta-llama/llama-3.1-8b-instruct",
    "Llama 3.1 8B Instruct",
    128_000,
    true,
    false,
    0.10,
    0.40,
);

pub const LLAMA_3_8B_GROQ: ModelDefinition = ModelDefinition::new(
    Provider::Groq,
    "llama3-8b-8192",
    "Llama 3 8B (Groq)",
    8_192,
    true,
    false,
    0.05,
    0.10,
);

pub const FLUX_SCHNELL: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "black-forest-labs/flux-schnell",
    "FLUX Schnell",
    4_096,
    false,
    true,
    0.002,
    0.002,
);

pub const FLUX_DEV: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "black-forest-labs/flux-dev",
    "FLUX Dev",
    4_096,
    false,
    true,
    0.025,
    0.025,
);

pub const FLUX_11_PRO: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "black-forest-labs/flux-1.1-pro",
    "FLUX 1.1 Pro",
    4_096,
    false,
    true,
    0.05,
    0.05,
);

pub const KOKORO_82M: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "hexgrad/kokoro-82m",
    "Kokoro 82M",
    4_096,
    false,
    false,
    0.002,
    0.002,
);

pub const ELEVEN_MULTILINGUAL_V2: ModelDefinition = ModelDefinition::new(
    Provider::ElevenLabs,
    "eleven_multilingual_v2",
    "Eleven Multilingual V2",
    4_096,
    false,
    false,
    0.30,
    0.30,
);

pub const WHISPER_SMALL: ModelDefinition = ModelDefinition::new(
    Provider::Groq,
    "whisper-small",
    "Whisper Small",
    4_096,
    false,
    false,
    0.01,
    0.01,
);

pub const WHISPER_LARGE_V3: ModelDefinition = ModelDefinition::new(
    Provider::Groq,
    "whisper-large-v3",
    "Whisper Large V3",
    4_096,
    false,
    false,
    0.02,
    0.02,
);

pub const GEMINI_15_FLASH: ModelDefinition = ModelDefinition::new(
    Provider::OpenRouter,
    "google/gemini-1.5-flash",
    "Gemini 1.5 Flash",
    1_000_000,
    true,
    true,
    0.075,
    0.30,
);

pub const GPT_IMAGE_1: ModelDefinition = ModelDefinition::new(
    Provider::OpenAI,
    "gpt-image-1",
    "GPT Image 1",
    4_096,
    false,
    true,
    0.05,
    0.05,
);

pub const GPT_VIDEO_1: ModelDefinition = ModelDefinition::new(
    Provider::OpenAI,
    "gpt-video-1",
    "GPT Video 1",
    4_096,
    false,
    true,
    0.10,
    0.10,
);

pub const GPT_TTS_1: ModelDefinition = ModelDefinition::new(
    Provider::OpenAI,
    "tts-1",
    "OpenAI TTS 1",
    4_096,
    false,
    false,
    0.015,
    0.015,
);

pub fn get_model_definition(full_model_string: &str) -> Option<&'static ModelDefinition> {
    // Strip provider prefix if present (e.g. "openrouter:gemini..." -> "gemini...")
    let model_id = if let Some(idx) = full_model_string.find(':') {
        &full_model_string[idx + 1..]
    } else {
        full_model_string
    };

    ALL_MODELS.iter().find(|m| m.model_id == model_id).copied()
}

pub const ALL_MODELS: &[&ModelDefinition] = &[
    &GEMINI_FLASH_LITE,
    &GEMINI_FLASH,
    &DEEPSEEK_V3,
    &CLAUDE_SONNET_46,
    &CLAUDE_35_HAIKU,
    &LLAMA_31_8B,
    &LLAMA_3_8B_GROQ,
    &FLUX_SCHNELL,
    &FLUX_DEV,
    &FLUX_11_PRO,
    &KOKORO_82M,
    &ELEVEN_MULTILINGUAL_V2,
    &WHISPER_SMALL,
    &WHISPER_LARGE_V3,
    &GEMINI_15_FLASH,
];
