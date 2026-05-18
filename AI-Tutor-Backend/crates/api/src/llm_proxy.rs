use std::sync::Arc;
use std::convert::Infallible;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, warn};

use ai_tutor_domain::routing::{GenerationTask, LearningMode, QualityTier};
use ai_tutor_providers::{
    config::ServerProviderConfig,
    resolve::{resolve_model, ResolvedModel},
    traits::{LlmProviderFactory, ProviderUsage},
};
use ai_tutor_routing::capabilities::resolve_generation_model;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct LlmProxyState {
    pub provider_factory: Arc<dyn LlmProviderFactory>,
    pub provider_config: Arc<ServerProviderConfig>,
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LlmProxyRequest {
    /// Explicit model override (optional — if absent, resolved via capability router)
    pub model: Option<String>,
    /// Generation task for capability-based resolution
    pub task: Option<String>,
    pub quality_mode: Option<String>,
    pub learning_mode: Option<String>,
    pub system_prompt: String,
    pub user_prompt: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    /// Provider type hint (openai, anthropic, google)
    pub provider_type: Option<String>,
    pub requires_api_key: Option<bool>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct LlmProxyResponse {
    pub text: String,
    pub model: String,
    pub usage: Option<ProviderUsage>,
}

#[derive(Debug, Serialize)]
pub struct LlmProxyError {
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum LlmProxyStreamEvent {
    #[serde(rename = "delta")]
    Delta { text: String },
    #[serde(rename = "done")]
    Done { full_text: String },
    #[serde(rename = "error")]
    Error { error: String },
}

#[derive(Debug, Deserialize)]
pub struct ProfilesQuery {
    pub quality_mode: Option<String>,
    pub learning_mode: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProfilesResponse {
    pub learning_profile: String,
    pub persona_profile: String,
    pub layout_profile: String,
    pub pacing_profile: String,
    pub generation_budget: String,
}

// ---------------------------------------------------------------------------
// Helper: resolve model config from request
// ---------------------------------------------------------------------------

/// Resolve the effective model string from the request.
///
/// Priority:
///   1. Explicit `model` field in the request (frontend override)
///   2. Capability-based resolution from `task` + `quality_mode` + `learning_mode`
fn resolve_model_string(req: &LlmProxyRequest) -> Result<String, LlmProxyError> {
    if let Some(ref explicit_model) = req.model {
        return Ok(explicit_model.clone());
    }

    let task_str = req.task.as_deref().ok_or_else(|| LlmProxyError {
        error: "Either 'model' or 'task' must be provided in the request".into(),
    })?;
    let quality_str = req.quality_mode.as_deref().unwrap_or("standard");
    let learning_str = req.learning_mode.as_deref().unwrap_or("explain");

    let task = GenerationTask::from_str_loose(task_str);
    let quality = QualityTier::from_str_loose(quality_str);
    let learning = LearningMode::from_str_loose(learning_str);

    let model = resolve_generation_model(task, learning, quality);
    info!(
        "LLM proxy: resolved model via capability router [task={}, quality={}, learning={} → model={}]",
        task_str, quality_str, learning_str, model
    );

    Ok(model.to_string())
}

fn resolve_from_request(
    config: &ServerProviderConfig,
    req: &LlmProxyRequest,
) -> Result<ResolvedModel, LlmProxyError> {
    let model_string = resolve_model_string(req)?;

    let provider_type = req
        .provider_type
        .as_deref()
        .and_then(|t| match t {
            "openai" => Some(ai_tutor_domain::provider::ProviderType::OpenAi),
            "anthropic" => Some(ai_tutor_domain::provider::ProviderType::Anthropic),
            "google" => Some(ai_tutor_domain::provider::ProviderType::Google),
            _ => {
                warn!("LLM proxy: unknown provider_type '{}', falling back to auto-detect", t);
                None
            },
        });

    resolve_model(
        config,
        Some(&model_string),
        req.api_key.as_deref(),
        req.base_url.as_deref(),
        provider_type,
        req.requires_api_key,
    )
    .map_err(|e| LlmProxyError {
        error: format!("model resolution failed: {}", e),
    })
}

// ---------------------------------------------------------------------------
// Non-streaming handler
// ---------------------------------------------------------------------------

async fn generate_llm(
    State(state): State<LlmProxyState>,
    Json(req): Json<LlmProxyRequest>,
) -> Result<Json<LlmProxyResponse>, (StatusCode, Json<LlmProxyError>)> {
    let resolved = resolve_from_request(&state.provider_config, &req).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(LlmProxyError {
                error: e.error.clone(),
            }),
        )
    })?;

    let provider = state.provider_factory.build(resolved.model_config).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(LlmProxyError {
                error: format!("failed to build provider: {}", e),
            }),
        )
    })?;

    info!(
        "LLM proxy: generating text [model={}]",
        resolved.model_string
    );

    let (text, usage) = provider
        .generate_text_with_usage(&req.system_prompt, &req.user_prompt)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(LlmProxyError {
                    error: format!("LLM generation failed: {}", e),
                }),
            )
        })?;

    Ok(Json(LlmProxyResponse {
        text,
        model: resolved.model_string,
        usage,
    }))
}

// ---------------------------------------------------------------------------
// Streaming handler (SSE)
// ---------------------------------------------------------------------------

async fn generate_llm_stream(
    State(state): State<LlmProxyState>,
    Json(req): Json<LlmProxyRequest>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<LlmProxyError>)>
{
    let resolved = resolve_from_request(&state.provider_config, &req).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(LlmProxyError {
                error: e.error.clone(),
            }),
        )
    })?;

    let provider = state.provider_factory.build(resolved.model_config).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(LlmProxyError {
                error: format!("failed to build provider: {}", e),
            }),
        )
    })?;

    let (sender, receiver) = mpsc::channel::<Result<Event, Infallible>>(1024);
    let system = req.system_prompt.clone();
    let user = req.user_prompt.clone();

    tokio::spawn(async move {
        let mut full_text = String::new();
        let on_delta = &mut |delta: String| {
            full_text.push_str(&delta);
            let data = match serde_json::to_string(&LlmProxyStreamEvent::Delta { text: delta }) {
                Ok(json) => json,
                Err(e) => {
                    error!("LLM proxy: failed to serialize delta event: {}", e);
                    return;
                }
            };
            let event = Event::default()
                .event("delta")
                .data(data);
            if let Err(e) = sender.try_send(Ok(event)) {
                error!("LLM proxy: SSE channel full, dropping delta event: {}", e);
            }
        };

        match provider.generate_text_stream(&system, &user, on_delta).await {
            Ok(_) => {
                let data = match serde_json::to_string(&LlmProxyStreamEvent::Done { full_text }) {
                    Ok(json) => json,
                    Err(e) => {
                        error!("LLM proxy: failed to serialize done event: {}", e);
                        return;
                    }
                };
                let done = Event::default()
                    .event("done")
                    .data(data);
                let _ = sender.try_send(Ok(done));
            }
            Err(e) => {
                error!("LLM proxy stream error: {}", e);
                let data = match serde_json::to_string(&LlmProxyStreamEvent::Error {
                    error: format!("LLM generation failed: {}", e),
                }) {
                    Ok(json) => json,
                    Err(e) => {
                        error!("LLM proxy: failed to serialize error event: {}", e);
                        return;
                    }
                };
                let err = Event::default()
                    .event("error")
                    .data(data);
                let _ = sender.try_send(Ok(err));
            }
        }
    });

    Ok(Sse::new(ReceiverStream::new(receiver)).keep_alive(KeepAlive::default()))
}

// ---------------------------------------------------------------------------
// Profiles handler (deterministic — no LLM)
// ---------------------------------------------------------------------------

async fn get_profiles(
    Query(query): Query<ProfilesQuery>,
) -> Json<ProfilesResponse> {
    let quality_mode = query.quality_mode.as_deref().unwrap_or("standard");
    let learning_mode = query.learning_mode.as_deref().unwrap_or("explain");

    let profiles = build_profiles(quality_mode, learning_mode);
    Json(profiles)
}

fn build_profiles(quality_mode: &str, learning_mode: &str) -> ProfilesResponse {
    use ai_tutor_domain::routing::{QualityTier, TopicComplexity};

    let tier = QualityTier::from_str_loose(quality_mode);
    let budget = ai_tutor_domain::routing::compute_generation_budget(tier, TopicComplexity::Normal);

    ProfilesResponse {
        learning_profile: build_learning_profile(learning_mode),
        persona_profile: build_persona_profile(quality_mode),
        layout_profile: build_layout_profile(),
        pacing_profile: build_pacing_profile(learning_mode),
        generation_budget: budget.to_budget_prompt_block(),
    }
}

fn build_learning_profile(learning_mode: &str) -> String {
    match learning_mode {
        "exam" =>
            "Assessment-focused preparation mode. Content should be precise, \
            definition-driven, and highlight common mistakes. Include practice \
            questions and exam-style scenarios. Scaffolding: minimal — assume \
            learner needs targeted review rather than step-by-step instruction.".into(),
        "placement_prep" =>
            "Diagnostic preparation mode. Content should follow a socratic \
            questioning approach that probes understanding. Cover breadth across \
            key topics. Include self-assessment checkpoints. \
            Scaffolding: adaptive — start broad, narrow based on implicit difficulty.".into(),
        "revision" =>
            "Quick revision mode. Content should be compressed key points with \
            explicit connections between related concepts. Prioritize summaries, \
            comparison tables, and visual overviews. \
            Scaffolding: high — assume learner has seen the material before.".into(),
        _ =>
            "Step-by-step explanatory mode. Content should build from foundational \
            to advanced concepts with real-world examples at each stage. \
            Include analogies and concrete illustrations. \
            Scaffolding: full — assume no prior knowledge of the topic.".into(),
    }
}

fn build_persona_profile(quality_mode: &str) -> String {
    match quality_mode {
        "premium" =>
            "Tone: authoritative and thorough. Verbosity: detailed but structured. \
            Style: comprehensive coverage with deep dives into nuance. \
            Use precise terminology and cite specific examples. \
            No teacher name or identity on slides — titles and keyPoints must be neutral.".into(),
        "basic" =>
            "Tone: approachable and encouraging. Verbosity: concise. \
            Style: focus on core concepts with intuitive explanations. \
            Use simple language and relatable examples. \
            No teacher name or identity on slides — titles and keyPoints must be neutral.".into(),
        _ =>
            "Tone: friendly and professional. Verbosity: balanced. \
            Style: step-by-step with real-world examples. \
            Mix accessible language with appropriate technical terms. \
            No teacher name or identity on slides — titles and keyPoints must be neutral.".into(),
    }
}

fn build_layout_profile() -> String {
    "Layout: clean and readable. Each slide should have a clear title, \
    supporting visual elements (diagrams, tables, or images where relevant), \
    and concise bullet points. Avoid clutter — limit to 4-6 key items per slide. \
    Use consistent visual hierarchy: title > subtitle > body > caption.".into()
}

fn build_pacing_profile(learning_mode: &str) -> String {
    match learning_mode {
        "exam" =>
            "Pacing: brisk and focused. Every scene should deliver high-density \
            information. Include a checkpoint (mini-quiz or review prompt) \
            every 3-4 slides. Total scene count: 8-15.".into(),
        "placement_prep" =>
            "Pacing: moderate with diagnostic pauses. Include self-assessment \
            questions after each major section. Total scene count: 6-12.".into(),
        "revision" =>
            "Pacing: fast. Prioritize coverage over depth. Use overview tables \
            and comparison matrices. Total scene count: 5-10.".into(),
        _ =>
            "Pacing: steady and thorough. Each concept gets its own scene \
            with clear progression. Include summary slides at section boundaries. \
            Total scene count: 8-12.".into(),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn llm_proxy_router(state: LlmProxyState) -> Router {
    Router::new()
        .route("/api/generate/llm", post(generate_llm))
        .route("/api/generate/llm/stream", post(generate_llm_stream))
        .route("/api/generate/profiles", get(get_profiles))
        .with_state(state)
}
