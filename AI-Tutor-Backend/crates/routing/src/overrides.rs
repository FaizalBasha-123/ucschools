use std::sync::OnceLock;

use serde::Deserialize;

/// Optional deploy-time model overrides from `model-overrides.json`.
///
/// Resolution order (highest to lowest):
///   1. Per-request explicit model (handled at the call site)
///   2. Deploy-time override from config file — only if set to a non-null value
///   3. Compile-time task-specific model from routing_rules
///   4. Capability-based fallback from routing_rules
///
/// All fields default to `None`. Set any field to a model string in the JSON
/// file to arm it as a safety net (triggered on 3rd retry attempt).

static OVERRIDES: OnceLock<ModelOverrides> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ModelOverrides {
    pub scene_content: Option<String>,
    pub outlines: Option<String>,
    pub quiz_grade: Option<String>,
    pub scene_actions: Option<String>,
    pub premium_refinement: Option<String>,
    pub vision_escalation: Option<String>,
}

impl Default for ModelOverrides {
    fn default() -> Self {
        Self {
            scene_content: None,
            outlines: None,
            quiz_grade: None,
            scene_actions: None,
            premium_refinement: None,
            vision_escalation: None,
        }
    }
}

/// Load overrides from a JSON config file.
/// Called once at startup. Missing or malformed file logs a warning but does
/// not crash — overrides remain inactive.
pub fn init_overrides(path: &str) {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => {
            tracing::warn!("[overrides] no config file at `{}` — overrides inactive", path);
            let _ = OVERRIDES.set(ModelOverrides::default());
            return;
        }
    };
    match serde_json::from_str::<ModelOverrides>(&content) {
        Ok(overrides) => {
            let active: Vec<&str> = [
                ("scene_content", overrides.scene_content.as_deref()),
                ("outlines", overrides.outlines.as_deref()),
                ("quiz_grade", overrides.quiz_grade.as_deref()),
                ("scene_actions", overrides.scene_actions.as_deref()),
                ("premium_refinement", overrides.premium_refinement.as_deref()),
                ("vision_escalation", overrides.vision_escalation.as_deref()),
            ]
            .into_iter()
            .filter_map(|(k, v)| v.map(|_| k))
            .collect();
            if !active.is_empty() {
                tracing::warn!("[overrides] ACTIVE overrides: {:?}", active);
            }
            let _ = OVERRIDES.set(overrides);
        }
        Err(e) => {
            tracing::error!("[overrides] malformed config file `{}`: {}", path, e);
            let _ = OVERRIDES.set(ModelOverrides::default());
        }
    }
}

/// Check if ANY override is active (useful for startup logging).
pub fn any_override_active() -> bool {
    OVERRIDES.get().is_some_and(|o| {
        o.scene_content.is_some()
            || o.outlines.is_some()
            || o.quiz_grade.is_some()
            || o.scene_actions.is_some()
            || o.premium_refinement.is_some()
            || o.vision_escalation.is_some()
    })
}

// ── Public override check functions ──────────────────────────────────────
// Each returns `Some(model_string)` if the override is set, `None` otherwise.

pub fn task_scene_content() -> Option<String> {
    OVERRIDES.get()?.scene_content.clone()
}
pub fn task_outlines() -> Option<String> {
    OVERRIDES.get()?.outlines.clone()
}
pub fn task_quiz_grade() -> Option<String> {
    OVERRIDES.get()?.quiz_grade.clone()
}
pub fn task_scene_actions() -> Option<String> {
    OVERRIDES.get()?.scene_actions.clone()
}
pub fn premium_refinement() -> Option<String> {
    OVERRIDES.get()?.premium_refinement.clone()
}
pub fn vision_escalation() -> Option<String> {
    OVERRIDES.get()?.vision_escalation.clone()
}

// ── Kept for backward compatibility with routing_rules wrappers ───────────
// These were previously separate env-var-based overrides. They now delegate
// to the appropriate task override or return None.

pub fn image() -> Option<String> { None }
pub fn video() -> Option<String> { None }
pub fn tts() -> Option<String> { None }
pub fn pbl_runtime() -> Option<String> { None }
pub fn asr() -> Option<String> { None }
pub fn pdf() -> Option<String> { None }
pub fn chat_scaffold() -> Option<String> { None }
pub fn chat_baseline() -> Option<String> { None }
pub fn chat_reasoning() -> Option<String> { None }
pub fn agent_profiles() -> Option<String> { None }
pub fn scene_actions_fallback() -> Option<String> { None }
pub fn refine() -> Option<String> { premium_refinement() }
pub fn light_task() -> Option<String> { None }
