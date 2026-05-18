use std::borrow::Cow;

use ai_tutor_domain::routing::{
    Capability, GenerationBudget, GenerationTask, QualityTier, RetryPolicy,
    TierLimits, TopicComplexity,
};

use crate::overrides;

// ── Override-aware helpers ───────────────────────────────────────────────

/// Return the override value if set, otherwise use the compile-time default.
fn with_override<'a>(default: &'static str, override_val: Option<String>) -> Cow<'a, str> {
    match override_val {
        Some(val) => Cow::Owned(val),
        None => Cow::Borrowed(default),
    }
}

// ── Model String Constants ───────────────────────────────────────────────
// Single source of truth for all model-to-string mappings.
// These replace every `{MODE}_AI_TUTOR_*_MODEL` env var.

const GEMINI_FLASH_LITE: &str = "openrouter:google/gemini-2.5-flash-lite";
const GEMINI_FLASH: &str = "openrouter:google/gemini-2.5-flash";
const DEEPSEEK_V3: &str = "openrouter:deepseek/deepseek-chat-v3-0324";
const CLAUDE_SONNET_46: &str = "openrouter:anthropic/claude-sonnet-4.6";
const CLAUDE_35_HAIKU: &str = "openrouter:anthropic/claude-3-5-haiku";
const LLAMA_31_8B: &str = "openrouter:meta-llama/llama-3.1-8b-instruct";
const LLAMA_3_8B_GROQ: &str = "groq:llama3-8b-8192";
const FLUX_SCHNELL: &str = "openrouter:black-forest-labs/flux-schnell";
const FLUX_DEV: &str = "openrouter:black-forest-labs/flux-dev";
const FLUX_11_PRO: &str = "openrouter:black-forest-labs/flux-1.1-pro";
const KOKORO_82M: &str = "openrouter:hexgrad/kokoro-82m";
const ELEVEN_MULTILINGUAL_V2: &str = "elevenlabs:eleven_multilingual_v2";
const WHISPER_SMALL: &str = "groq:whisper-small";
const WHISPER_LARGE_V3: &str = "groq:whisper-large-v3";
const GEMINI_15_FLASH: &str = "openrouter:google/gemini-1.5-flash";
const GPT_VIDEO_1: &str = "openai:gpt-video-1";

// ── Quality Tier Resolution ──────────────────────────────────────────────

/// Map learning mode + quality mode to an effective quality tier.
///
///   exam/placement_prep → bump up one tier
///   revision            → bump down one tier
///   explain             → use quality as-is
pub fn effective_quality_tier(learning_mode: &str, quality_mode: &str) -> QualityTier {
    match learning_mode {
        "exam" | "placement_prep" => match quality_mode {
            "basic" => QualityTier::Standard,
            _ => QualityTier::Premium,
        },
        "revision" => match quality_mode {
            "premium" => QualityTier::Standard,
            _ => QualityTier::Basic,
        },
        _ => match quality_mode {
            "premium" => QualityTier::Premium,
            "basic" => QualityTier::Basic,
            _ => QualityTier::Standard,
        },
    }
}

// ── Generation Task Resolution ──────────────────────────────────────────

/// Resolve a generation task to a model string based on quality tier.
/// Replaces `{QUALITY}MODE_AI_TUTOR_GENERATION_{TASK}_MODEL` env vars.
pub fn resolve_task_model(task: GenerationTask, tier: QualityTier) -> &'static str {
    match task {
        GenerationTask::Outlines => resolve_outlines_model(tier),
        GenerationTask::SceneContent => resolve_scene_content_model(tier),
        GenerationTask::SceneActions => resolve_scene_actions_model(tier),
        GenerationTask::QuizGrade => resolve_quiz_grade_model(tier),
    }
}

fn resolve_outlines_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => GEMINI_FLASH_LITE,
        QualityTier::Standard => GEMINI_FLASH,
        QualityTier::Premium => CLAUDE_SONNET_46,
    }
}

fn resolve_scene_content_model(tier: QualityTier) -> &'static str {
    let _ = tier;
    DEEPSEEK_V3
}

fn resolve_scene_actions_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => LLAMA_31_8B,
        QualityTier::Standard | QualityTier::Premium => DEEPSEEK_V3,
    }
}

fn resolve_quiz_grade_model(_tier: QualityTier) -> &'static str {
    LLAMA_31_8B
}

/// Scene actions fallback when primary model fails.
pub fn resolve_scene_actions_fallback(_tier: QualityTier) -> &'static str {
    GEMINI_FLASH
}

/// Agent profiles generation model.
pub fn resolve_agent_profiles_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => GEMINI_FLASH_LITE,
        QualityTier::Standard => GEMINI_FLASH,
        QualityTier::Premium => CLAUDE_SONNET_46,
    }
}

/// Outline Structured Content refinement model (Premium).
pub fn resolve_refine_model() -> &'static str {
    CLAUDE_SONNET_46
}

/// Lightweight evaluation model for fast tasks.
pub fn resolve_light_task_model() -> &'static str {
    LLAMA_3_8B_GROQ
}

// ── Chat Model Resolution ────────────────────────────────────────────────

/// Chat scaffold model (used for conversation scaffolding).
pub fn resolve_chat_scaffold_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => GEMINI_FLASH_LITE,
        QualityTier::Standard => GEMINI_FLASH,
        QualityTier::Premium => CLAUDE_SONNET_46,
    }
}

/// Chat baseline model (for regular chat turns).
pub fn resolve_chat_baseline_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => GEMINI_FLASH_LITE,
        QualityTier::Standard => GEMINI_FLASH,
        QualityTier::Premium => CLAUDE_35_HAIKU,
    }
}

/// Chat reasoning model (for deep reasoning).
pub fn resolve_chat_reasoning_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic | QualityTier::Standard => GEMINI_FLASH,
        QualityTier::Premium => CLAUDE_SONNET_46,
    }
}

// ── Media Model Resolution ───────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub enum MediaTask {
    Image,
    Video,
    Tts,
}

/// Resolve a media model based on quality tier.
/// Replaces `{QUALITY}MODE_AI_TUTOR_IMAGE_MODEL`, `_VIDEO_MODEL`, `_TTS_MODEL`.
pub fn resolve_media_model(task: MediaTask, tier: QualityTier) -> &'static str {
    match task {
        MediaTask::Image => resolve_image_model(tier),
        MediaTask::Video => resolve_video_model(tier),
        MediaTask::Tts => resolve_tts_model(tier),
    }
}

fn resolve_image_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => FLUX_SCHNELL,
        QualityTier::Standard => FLUX_DEV,
        QualityTier::Premium => FLUX_11_PRO,
    }
}

fn resolve_video_model(_tier: QualityTier) -> &'static str {
    GPT_VIDEO_1
}

fn resolve_tts_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic | QualityTier::Standard => KOKORO_82M,
        QualityTier::Premium => ELEVEN_MULTILINGUAL_V2,
    }
}

// ── Specialized Task Resolution ──────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub enum SpecializedTask {
    PblRuntime,
    PdfParsing,
    Asr,
}

/// Resolve a specialized (non-generation) model based on quality tier.
/// Replaces `{QUALITY}MODE_AI_TUTOR_PBL_RUNTIME_MODEL`,
/// `BALANCED_MODE_AI_TUTOR_PDF_MODEL`, `AI_TUTOR_DEFAULT_ASR_MODEL`.
pub fn resolve_specialized_model(task: SpecializedTask, tier: QualityTier) -> &'static str {
    match task {
        SpecializedTask::PblRuntime => resolve_pbl_model(tier),
        SpecializedTask::PdfParsing => resolve_pdf_model(tier),
        SpecializedTask::Asr => resolve_asr_model(tier),
    }
}

fn resolve_pbl_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => GEMINI_15_FLASH,
        QualityTier::Standard => GEMINI_FLASH,
        QualityTier::Premium => CLAUDE_35_HAIKU,
    }
}

fn resolve_pdf_model(_tier: QualityTier) -> &'static str {
    GEMINI_FLASH
}

fn resolve_asr_model(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => WHISPER_SMALL,
        QualityTier::Standard | QualityTier::Premium => WHISPER_LARGE_V3,
    }
}

// ── Capability-based Resolution ──────────────────────────────────────────

/// Resolve a model by capability and quality tier (override-aware).
/// Powers the compile-time routing used by `capabilities::resolve_model`.
pub fn resolve_model_by_capability(cap: Capability, tier: QualityTier) -> Cow<'static, str> {
    match (cap, tier) {
        (Capability::FastCheap, QualityTier::Basic) => Cow::Borrowed(GEMINI_FLASH_LITE),
        (Capability::FastCheap, QualityTier::Standard) => Cow::Borrowed(GEMINI_FLASH),
        (Capability::FastCheap, QualityTier::Premium) => Cow::Borrowed(GEMINI_FLASH),
        (Capability::StructuredGeneration, _) => Cow::Borrowed(DEEPSEEK_V3),
        (Capability::LightweightEvaluation, _) => Cow::Borrowed(LLAMA_31_8B),
        (Capability::PremiumReasoning, QualityTier::Basic) => Cow::Borrowed(GEMINI_FLASH),
        (Capability::PremiumReasoning, QualityTier::Standard) => Cow::Borrowed(GEMINI_FLASH),
        (Capability::PremiumReasoning, QualityTier::Premium) => Cow::Borrowed(CLAUDE_SONNET_46),
        (Capability::LongContext, _) => Cow::Borrowed(GEMINI_FLASH),
        (Capability::VisionAnalysis, _) => overrides::vision_escalation()
            .map(Cow::Owned)
            .unwrap_or(Cow::Borrowed(GEMINI_FLASH)),
    }
}

// ── Tier Limits (hardcoded — no env dependency) ──────────────────────────

pub fn tier_limits(tier: QualityTier) -> TierLimits {
    match tier {
        QualityTier::Basic => TierLimits {
            max_slides: 5,
            max_examples_per_slide: 1,
            max_tokens_per_response: 2048,
            enable_refinement: false,
            max_pdf_context_chars: 300,
            max_cost_usd_per_request: 0.01,
        },
        QualityTier::Standard => TierLimits {
            max_slides: 8,
            max_examples_per_slide: 2,
            max_tokens_per_response: 4096,
            enable_refinement: false,
            max_pdf_context_chars: 600,
            max_cost_usd_per_request: 0.05,
        },
        QualityTier::Premium => TierLimits {
            max_slides: 15,
            max_examples_per_slide: 3,
            max_tokens_per_response: 8192,
            enable_refinement: true,
            max_pdf_context_chars: 1000,
            max_cost_usd_per_request: 0.15,
        },
    }
}

/// Effective slide count with topic complexity bonus (2 extra slides for high complexity).
pub fn effective_max_slides(tier: QualityTier, complexity: TopicComplexity) -> usize {
    let base = tier_limits(tier).max_slides;
    if complexity == TopicComplexity::High {
        (base + 2).min(tier_limits(QualityTier::Premium).max_slides)
    } else {
        base
    }
}

/// Retry policy with fixed defaults (no env dependency).
pub fn default_retry_policy() -> RetryPolicy {
    RetryPolicy {
        max_attempts: 2,
        timeout_ms: 30_000,
    }
}

/// Generation budget per quality tier.
pub fn compute_generation_budget(tier: QualityTier, _complexity: TopicComplexity) -> GenerationBudget {
    match tier {
        QualityTier::Basic => GenerationBudget {
            max_scenes: 5,
            max_interactions: 2,
            max_visuals: 1,
            max_tokens_per_scene: 512,
            max_bullets_per_scene: 3,
            max_chars_per_bullet: 60,
            require_quiz_scene: false,
        },
        QualityTier::Standard => GenerationBudget {
            max_scenes: 10,
            max_interactions: 5,
            max_visuals: 3,
            max_tokens_per_scene: 1024,
            max_bullets_per_scene: 4,
            max_chars_per_bullet: 80,
            require_quiz_scene: false,
        },
        QualityTier::Premium => GenerationBudget {
            max_scenes: 15,
            max_interactions: 8,
            max_visuals: 5,
            max_tokens_per_scene: 2048,
            max_bullets_per_scene: 6,
            max_chars_per_bullet: 100,
            require_quiz_scene: true,
        },
    }
}

/// Estimated generation duration in seconds (fixed default).
pub fn estimated_generation_duration_secs() -> f64 {
    1200.0
}

// ── Override-aware resolution wrappers ───────────────────────────────────
// These are the RECOMMENDED entry points for production code.
// Resolution order: override → compile-time task model → capability fallback.
// Override env vars are checked LIVE (not cached), so changing them requires
// a process restart to take effect.

/// Resolve a generation task model with override support.
pub fn resolve_task_model_with_override(task: GenerationTask, tier: QualityTier) -> Cow<'static, str> {
    let default = resolve_task_model(task, tier);
    let override_val = match task {
        GenerationTask::Outlines => overrides::task_outlines(),
        GenerationTask::SceneContent => overrides::task_scene_content(),
        GenerationTask::SceneActions => overrides::task_scene_actions(),
        GenerationTask::QuizGrade => overrides::task_quiz_grade(),
    };
    with_override(default, override_val)
}

/// Resolve a media model with override support.
pub fn resolve_media_model_with_override(task: MediaTask, tier: QualityTier) -> Cow<'static, str> {
    let default = resolve_media_model(task, tier);
    let override_val = match task {
        MediaTask::Image => overrides::image(),
        MediaTask::Video => overrides::video(),
        MediaTask::Tts => overrides::tts(),
    };
    with_override(default, override_val)
}

/// Resolve a specialized model with override support.
pub fn resolve_specialized_model_with_override(task: SpecializedTask, tier: QualityTier) -> Cow<'static, str> {
    let default = resolve_specialized_model(task, tier);
    let override_val = match task {
        SpecializedTask::PblRuntime => overrides::pbl_runtime(),
        SpecializedTask::PdfParsing => overrides::pdf(),
        SpecializedTask::Asr => overrides::asr(),
    };
    with_override(default, override_val)
}

/// Resolve chat scaffold model with override support.
pub fn resolve_chat_scaffold_model_with_override(tier: QualityTier) -> Cow<'static, str> {
    with_override(resolve_chat_scaffold_model(tier), overrides::chat_scaffold())
}

/// Resolve chat baseline model with override support.
pub fn resolve_chat_baseline_model_with_override(tier: QualityTier) -> Cow<'static, str> {
    with_override(resolve_chat_baseline_model(tier), overrides::chat_baseline())
}

/// Resolve chat reasoning model with override support.
pub fn resolve_chat_reasoning_model_with_override(tier: QualityTier) -> Cow<'static, str> {
    with_override(resolve_chat_reasoning_model(tier), overrides::chat_reasoning())
}

/// Resolve agent profiles model with override support.
pub fn resolve_agent_profiles_model_with_override(tier: QualityTier) -> Cow<'static, str> {
    with_override(resolve_agent_profiles_model(tier), overrides::agent_profiles())
}

/// Resolve scene actions fallback model with override support.
pub fn resolve_scene_actions_fallback_with_override(tier: QualityTier) -> Cow<'static, str> {
    with_override(resolve_scene_actions_fallback(tier), overrides::scene_actions_fallback())
}

/// Resolve refine model with override support.
pub fn resolve_refine_model_with_override() -> Cow<'static, str> {
    with_override(resolve_refine_model(), overrides::refine())
}

/// Resolve light task model with override support.
pub fn resolve_light_task_model_with_override() -> Cow<'static, str> {
    with_override(resolve_light_task_model(), overrides::light_task())
}
