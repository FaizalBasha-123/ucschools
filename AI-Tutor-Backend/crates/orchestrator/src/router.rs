use ai_tutor_domain::routing::{LearningMode, PipelineModelConfig, QualityTier, RetryPolicy};

/// Core routing function — the single source of truth for model selection.
/// No fallback models: retry handles technical failures by re-trying the
/// same primary model; escalation (refinement) handles quality issues.
pub fn select_models(_mode: LearningMode, tier: QualityTier) -> PipelineModelConfig {
    PipelineModelConfig {
        orchestrator: env_model(
            &format!("MODEL_ORCHESTRATOR_{}", tier.as_str()),
            &format!("{}_MODE_AI_TUTOR_MODEL", tier.as_str()),
        ),
        planner: env_model(
            &format!("MODEL_PLANNER_{}", tier.as_str()),
            &format!("{}_MODE_AI_TUTOR_GENERATION_OUTLINES_MODEL", tier.as_str()),
        ),
        content: env_model(
            &format!("MODEL_CONTENT_{}", tier.as_str()),
            &format!(
                "{}_MODE_AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL",
                tier.as_str()
            ),
        ),
        refine: env_model_opt("MODEL_REFINE_PREMIUM").or_else(|| {
            env_model_opt("PREMIUM_MODE_AI_TUTOR_GENERATION_SCENE_CONTENT_REFINE_MODEL")
        }),
        light_task: env_model("MODEL_LIGHT_TASK", "GROQ_LLAMA_MODEL"),
        pdf: env_model(
            &format!("MODEL_PDF_{}", tier.as_str()),
            &format!("{}_MODE_AI_TUTOR_PDF_MODEL", tier.as_str()),
        ),
        retry_policy: RetryPolicy::default(),
    }
}

/// Quality Escalation Strategy.
/// Escalate to the refinement model ONLY when:
/// - We are on Premium tier, AND
/// - The validation score is below 0.85.
/// This is NOT a fallback — it's a quality upgrade path.
pub fn should_escalate(validation_score: f32, tier: &QualityTier) -> bool {
    *tier == QualityTier::Premium && validation_score < 0.85
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/// Resolves a model string by trying `primary_key` first, then `legacy_key`.
/// Panics at startup if neither is set — fail fast, not silently.
fn env_model(primary_key: &str, legacy_key: &str) -> String {
    env_model_opt(primary_key)
        .or_else(|| env_model_opt(legacy_key))
        .unwrap_or_else(|| {
            panic!(
                "Missing required model env var: '{}' (or legacy '{}')",
                primary_key, legacy_key
            )
        })
}

fn env_model_opt(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
