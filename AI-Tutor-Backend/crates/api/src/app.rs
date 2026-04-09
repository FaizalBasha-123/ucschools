use std::{collections::HashMap, sync::Arc};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    http::StatusCode,
    middleware::{self, Next},
    response::sse::{Event, KeepAlive, Sse},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::queue::{
    claim_heartbeat_interval_ms, spawn_one_shot_queue_kick, stale_working_timeout_ms,
    FileBackedLessonQueue, QueueCancelResult, QueueLeaseCounts, QueuedLessonRequest,
};
use ai_tutor_domain::{
    generation::{AgentMode, Language, LessonGenerationRequest, PdfContent, UserRequirements},
    job::{
        LessonGenerationJob, LessonGenerationJobStatus, LessonGenerationStep,
        QueuedLessonJobSnapshot,
    },
    lesson::Lesson,
    runtime::{
        DirectorState, RuntimeActionExecutionRecord, RuntimeActionExecutionStatus,
        RuntimeSessionMode, StatelessChatRequest,
    },
};
use ai_tutor_media::storage::{DynAssetStore, LocalFileAssetStore, R2AssetStore};
use ai_tutor_orchestrator::{
    chat_graph::{self, ChatGraphEventKind},
    generation::LlmGenerationPipeline,
    pipeline::{build_queued_job, LessonGenerationOrchestrator},
};
use ai_tutor_providers::{
    config::ServerProviderConfig,
    registry::built_in_providers,
    resolve::resolve_model,
    traits::{
        ImageProviderFactory, LlmProviderFactory, ProviderRuntimeStatus, TtsProviderFactory,
        VideoProviderFactory,
    },
};
use ai_tutor_runtime::session::{
    action_execution_metadata_for_name, canonical_runtime_action_params, lesson_playback_events,
    ActionAckPolicy, PlaybackEvent, TutorEventKind, TutorStreamEvent, TutorTurnStatus,
};
use ai_tutor_storage::{
    filesystem::FileStorage,
    repositories::{
        LessonJobRepository, LessonRepository, RuntimeActionExecutionRepository,
        RuntimeSessionRepository,
    },
};

#[derive(Clone)]
pub struct AppState {
    pub service: Arc<dyn LessonAppService>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum ApiRole {
    Reader,
    Writer,
    Admin,
}

#[derive(Clone, Debug)]
struct ApiAuthConfig {
    enabled: bool,
    tokens: HashMap<String, ApiRole>,
    require_https: bool,
}

impl ApiAuthConfig {
    fn from_env() -> Self {
        let mut tokens = HashMap::new();
        if let Ok(secret) = std::env::var("AI_TUTOR_API_SECRET") {
            let trimmed = secret.trim();
            if !trimmed.is_empty() {
                tokens.insert(trimmed.to_string(), ApiRole::Admin);
            }
        }
        if let Ok(configured) = std::env::var("AI_TUTOR_API_TOKENS") {
            for entry in configured.split(',') {
                let item = entry.trim();
                if item.is_empty() {
                    continue;
                }
                let mut pair = item.splitn(2, '=');
                let token = pair.next().unwrap_or_default().trim();
                let role_raw = pair.next().unwrap_or("reader").trim();
                if token.is_empty() {
                    continue;
                }
                if let Some(role) = parse_api_role(role_raw) {
                    tokens.insert(token.to_string(), role);
                }
            }
        }

        let enabled = !tokens.is_empty()
            || matches!(
                std::env::var("AI_TUTOR_AUTH_REQUIRED")
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase()
                    .as_str(),
                "1" | "true" | "yes" | "on"
            );
        let require_https = matches!(
            std::env::var("AI_TUTOR_REQUIRE_HTTPS")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        );

        Self {
            enabled,
            tokens,
            require_https,
        }
    }
}

fn parse_api_role(value: &str) -> Option<ApiRole> {
    match value.trim().to_ascii_lowercase().as_str() {
        "reader" | "read" => Some(ApiRole::Reader),
        "writer" | "write" => Some(ApiRole::Writer),
        "admin" => Some(ApiRole::Admin),
        _ => None,
    }
}

fn required_role_for_request(method: &axum::http::Method, path: &str) -> Option<ApiRole> {
    if path == "/health" || path == "/api/health" {
        return None;
    }
    if path == "/api/system/status" {
        return Some(ApiRole::Admin);
    }
    if path == "/api/system/ops-gate" {
        return Some(ApiRole::Admin);
    }
    if method == axum::http::Method::POST {
        if path == "/api/lessons/generate"
            || path == "/api/lessons/generate-async"
            || path == "/api/runtime/actions/ack"
            || path == "/api/runtime/chat/stream"
        {
            return Some(ApiRole::Writer);
        }
        if path.starts_with("/api/lessons/jobs/") && path.ends_with("/cancel") {
            return Some(ApiRole::Admin);
        }
        if path.starts_with("/api/lessons/jobs/") && path.ends_with("/resume") {
            return Some(ApiRole::Admin);
        }
    }
    if method == axum::http::Method::GET
        && (path.starts_with("/api/lessons/")
            || path.starts_with("/api/assets/media/")
            || path.starts_with("/api/assets/audio/"))
    {
        return Some(ApiRole::Reader);
    }
    Some(ApiRole::Reader)
}

fn parse_bearer_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let mut parts = value.splitn(2, ' ');
    let scheme = parts.next()?.trim();
    let token = parts.next()?.trim();
    if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

fn request_is_https(req: &axum::extract::Request) -> bool {
    if let Some(value) = req.headers().get("x-forwarded-proto").and_then(|v| v.to_str().ok()) {
        if value
            .split(',')
            .next()
            .is_some_and(|proto| proto.trim().eq_ignore_ascii_case("https"))
        {
            return true;
        }
    }
    if let Some(value) = req.headers().get("forwarded").and_then(|v| v.to_str().ok()) {
        if value.to_ascii_lowercase().contains("proto=https") {
            return true;
        }
    }
    false
}

async fn auth_middleware(
    State(auth): State<ApiAuthConfig>,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    if auth.require_https && required_role_for_request(&method, &path).is_some() && !request_is_https(&req)
    {
        return ApiError {
            status: StatusCode::UPGRADE_REQUIRED,
            message: "https is required for this endpoint".to_string(),
        }
        .into_response();
    }

    let Some(required_role) = required_role_for_request(&method, &path) else {
        return next.run(req).await;
    };

    if !auth.enabled {
        return next.run(req).await;
    }

    let token = match parse_bearer_token(req.headers()) {
        Some(token) => token,
        None => {
            return ApiError {
                status: StatusCode::UNAUTHORIZED,
                message: "missing or invalid bearer token".to_string(),
            }
            .into_response();
        }
    };

    let Some(granted_role) = auth.tokens.get(&token) else {
        return ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "invalid bearer token".to_string(),
        }
        .into_response();
    };

    if granted_role < &required_role {
        return ApiError {
            status: StatusCode::FORBIDDEN,
            message: "token role is not permitted for this endpoint".to_string(),
        }
        .into_response();
    }

    next.run(req).await
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GenerateLessonPayload {
    pub requirement: String,
    pub language: Option<String>,
    pub model: Option<String>,
    pub pdf_text: Option<String>,
    pub enable_web_search: Option<bool>,
    pub enable_image_generation: Option<bool>,
    pub enable_video_generation: Option<bool>,
    pub enable_tts: Option<bool>,
    pub agent_mode: Option<String>,
    pub user_nickname: Option<String>,
    pub user_bio: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateLessonResponse {
    pub lesson_id: String,
    pub job_id: String,
    pub url: String,
    pub scenes_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeActionAckRequest {
    pub session_id: String,
    pub runtime_session_id: Option<String>,
    pub runtime_session_mode: Option<String>,
    pub execution_id: String,
    pub action_name: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeActionAckResponse {
    pub accepted: bool,
    pub duplicate: bool,
    pub current_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Clone)]
pub enum CancelLessonJobOutcome {
    Cancelled(LessonGenerationJob),
    AlreadyRunning,
    NotFound,
}

#[derive(Debug, Clone)]
pub enum ResumeLessonJobOutcome {
    Resumed(LessonGenerationJob),
    AlreadyQueuedOrRunning,
    MissingSnapshot,
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRuntimeStatusResponse {
    pub label: String,
    pub available: bool,
    pub consecutive_failures: u32,
    pub cooldown_remaining_ms: u64,
    pub total_requests: u64,
    pub total_successes: u64,
    pub total_failures: u64,
    pub last_error: Option<String>,
    pub last_success_unix_ms: Option<u64>,
    pub last_failure_unix_ms: Option<u64>,
    pub total_latency_ms: u64,
    pub average_latency_ms: Option<u64>,
    pub last_latency_ms: Option<u64>,
    pub estimated_input_tokens: u64,
    pub estimated_output_tokens: u64,
    pub estimated_total_cost_microusd: u64,
    pub provider_reported_input_tokens: u64,
    pub provider_reported_output_tokens: u64,
    pub provider_reported_total_tokens: u64,
    pub provider_reported_total_cost_microusd: u64,
    pub streaming_path: String,
    pub native_streaming: bool,
    pub native_typed_streaming: bool,
    pub compatibility_streaming: bool,
    pub cooperative_cancellation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedModelProfileResponse {
    pub provider_id: String,
    pub provider_name: String,
    pub model_id: String,
    pub model_name: Option<String>,
    pub context_window: Option<i32>,
    pub output_window: Option<i32>,
    pub cost_tier: Option<String>,
    pub input_cost_per_1m_usd: Option<f64>,
    pub output_cost_per_1m_usd: Option<f64>,
    pub supports_tools: bool,
    pub supports_vision: bool,
    pub supports_thinking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationModelPolicyResponse {
    pub outlines_model: String,
    pub scene_content_model: String,
    pub scene_actions_model: String,
    pub scene_actions_fallback_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatusResponse {
    pub status: &'static str,
    pub current_model: Option<String>,
    pub deployment_environment: String,
    pub deployment_revision: Option<String>,
    pub rollout_phase: String,
    pub generation_model_policy: GenerationModelPolicyResponse,
    pub selected_model_profile: Option<SelectedModelProfileResponse>,
    pub configured_provider_priority: Vec<String>,
    pub runtime_session_modes: Vec<String>,
    pub runtime_native_streaming_required: bool,
    pub runtime_native_streaming_selectors: Vec<String>,
    pub runtime_native_typed_streaming_required: bool,
    pub runtime_degraded_single_turn_only: bool,
    pub runtime_alert_level: String,
    pub runtime_alerts: Vec<String>,
    pub asset_backend: String,
    pub queue_backend: String,
    pub lesson_backend: String,
    pub job_backend: String,
    pub runtime_session_backend: String,
    pub queue_pending_jobs: usize,
    pub queue_active_leases: usize,
    pub queue_stale_leases: usize,
    pub queue_status_error: Option<String>,
    pub queue_poll_ms: u64,
    pub queue_claim_heartbeat_interval_ms: u64,
    pub queue_stale_timeout_ms: u64,
    pub provider_total_requests: u64,
    pub provider_total_successes: u64,
    pub provider_total_failures: u64,
    pub provider_total_latency_ms: u64,
    pub provider_average_latency_ms: Option<u64>,
    pub provider_estimated_input_tokens: u64,
    pub provider_estimated_output_tokens: u64,
    pub provider_estimated_total_cost_microusd: u64,
    pub provider_reported_input_tokens: u64,
    pub provider_reported_output_tokens: u64,
    pub provider_reported_total_tokens: u64,
    pub provider_reported_total_cost_microusd: u64,
    pub provider_runtime: Vec<ProviderRuntimeStatusResponse>,
    pub provider_status_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsGateCheckResponse {
    pub id: String,
    pub required: bool,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsGateResponse {
    pub pass: bool,
    pub mode: String,
    pub checks: Vec<OpsGateCheckResponse>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Debug, Clone)]
enum ResolvedRuntimeSessionMode {
    StatelessClientState,
    ManagedRuntimeSession {
        persistence_session_id: String,
        create_if_missing: bool,
    },
}

#[derive(Debug, Clone)]
struct GenerationModelPolicy {
    outlines_model: String,
    scene_content_model: String,
    scene_actions_model: String,
    scene_actions_fallback_model: Option<String>,
}

#[async_trait]
pub trait LessonAppService: Send + Sync {
    async fn generate_lesson(
        &self,
        payload: GenerateLessonPayload,
    ) -> Result<GenerateLessonResponse>;
    async fn queue_lesson(&self, payload: GenerateLessonPayload) -> Result<GenerateLessonResponse>;
    async fn cancel_job(&self, id: &str) -> Result<CancelLessonJobOutcome>;
    async fn resume_job(&self, id: &str) -> Result<ResumeLessonJobOutcome>;
    async fn stateless_chat(&self, payload: StatelessChatRequest) -> Result<Vec<TutorStreamEvent>>;
    async fn stateless_chat_stream(
        &self,
        payload: StatelessChatRequest,
        sender: mpsc::Sender<TutorStreamEvent>,
    ) -> Result<()>;
    async fn get_job(&self, id: &str) -> Result<Option<LessonGenerationJob>>;
    async fn get_lesson(&self, id: &str) -> Result<Option<Lesson>>;
    async fn get_audio_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>>;
    async fn get_media_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>>;
    async fn acknowledge_runtime_action(
        &self,
        payload: RuntimeActionAckRequest,
    ) -> Result<RuntimeActionAckResponse>;
    async fn get_system_status(&self) -> Result<SystemStatusResponse>;
}

#[derive(Clone)]
pub struct LiveLessonAppService {
    storage: Arc<FileStorage>,
    provider_config: Arc<ServerProviderConfig>,
    provider_factory: Arc<dyn LlmProviderFactory>,
    image_provider_factory: Arc<dyn ImageProviderFactory>,
    video_provider_factory: Arc<dyn VideoProviderFactory>,
    tts_provider_factory: Arc<dyn TtsProviderFactory>,
    base_url: String,
    queue_db_path: Option<String>,
}

impl LiveLessonAppService {
    pub fn new(
        storage: Arc<FileStorage>,
        provider_config: Arc<ServerProviderConfig>,
        provider_factory: Arc<dyn LlmProviderFactory>,
        image_provider_factory: Arc<dyn ImageProviderFactory>,
        video_provider_factory: Arc<dyn VideoProviderFactory>,
        tts_provider_factory: Arc<dyn TtsProviderFactory>,
        base_url: String,
    ) -> Self {
        Self {
            storage,
            provider_config,
            provider_factory,
            image_provider_factory,
            video_provider_factory,
            tts_provider_factory,
            base_url,
            queue_db_path: std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok(),
        }
    }

    pub fn with_queue_db_path(mut self, queue_db_path: Option<String>) -> Self {
        self.queue_db_path = queue_db_path;
        self
    }

    pub(crate) async fn build_orchestrator(
        &self,
        request: &LessonGenerationRequest,
        model_string: Option<&str>,
    ) -> Result<LessonGenerationOrchestrator<LlmGenerationPipeline, FileStorage, FileStorage>> {
        let generation_policy = resolve_generation_model_policy(
            model_string,
            std::env::var("AI_TUTOR_GENERATION_OUTLINES_MODEL").ok().as_deref(),
            std::env::var("AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL")
                .ok()
                .as_deref(),
            std::env::var("AI_TUTOR_GENERATION_SCENE_ACTIONS_MODEL")
                .ok()
                .as_deref(),
            std::env::var("AI_TUTOR_GENERATION_SCENE_ACTIONS_FALLBACK_MODEL")
                .ok()
                .as_deref(),
        );

        let outlines_llm = self.provider_factory.build(
            resolve_model(
                &self.provider_config,
                Some(&generation_policy.outlines_model),
                None,
                None,
                None,
                None,
            )?
            .model_config,
        )?;
        let scene_content_llm = self.provider_factory.build(
            resolve_model(
                &self.provider_config,
                Some(&generation_policy.scene_content_model),
                None,
                None,
                None,
                None,
            )?
            .model_config,
        )?;
        let scene_actions_llm = self.provider_factory.build(
            resolve_model(
                &self.provider_config,
                Some(&generation_policy.scene_actions_model),
                None,
                None,
                None,
                None,
            )?
            .model_config,
        )?;

        let mut pipeline = LlmGenerationPipeline::new(self.provider_factory.build(
            resolve_model(
                &self.provider_config,
                Some(&generation_policy.scene_content_model),
                None,
                None,
                None,
                None,
            )?
            .model_config,
        )?)
        .with_phase_llms(outlines_llm, scene_content_llm, scene_actions_llm);
        if let Some(fallback_model) = generation_policy.scene_actions_fallback_model.as_deref() {
            let fallback_llm = self.provider_factory.build(
                resolve_model(
                    &self.provider_config,
                    Some(fallback_model),
                    None,
                    None,
                    None,
                    None,
                )?
                .model_config,
            )?;
            pipeline = pipeline.with_scene_actions_fallback_llm(fallback_llm);
        }
        if request.enable_web_search {
            if let Ok(api_key) = std::env::var("AI_TUTOR_TAVILY_API_KEY") {
                let max_results = std::env::var("AI_TUTOR_WEB_SEARCH_MAX_RESULTS")
                    .ok()
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(5);
                pipeline = pipeline.with_tavily_web_search(api_key, max_results);
            }
        }
        let pipeline = Arc::new(pipeline);
        let mut orchestrator = LessonGenerationOrchestrator::new(
            pipeline,
            Arc::clone(&self.storage),
            Arc::clone(&self.storage),
        )
        .with_asset_store(self.build_asset_store().await?);

        if request.enable_image_generation {
            let image_model_string = std::env::var("AI_TUTOR_IMAGE_MODEL")
                .ok()
                .or_else(|| model_string.map(|_| "openai:gpt-image-1".to_string()))
                .unwrap_or_else(|| "openai:gpt-image-1".to_string());
            let resolved_image = resolve_model(
                &self.provider_config,
                Some(&image_model_string),
                None,
                None,
                None,
                None,
            )?;
            let image = self
                .image_provider_factory
                .build(resolved_image.model_config)?;
            orchestrator = orchestrator.with_image_provider(Arc::from(image));
        }

        if request.enable_video_generation {
            let video_model_string = std::env::var("AI_TUTOR_VIDEO_MODEL")
                .ok()
                .or_else(|| model_string.map(|_| "openai:gpt-video-1".to_string()))
                .unwrap_or_else(|| "openai:gpt-video-1".to_string());
            let resolved_video = resolve_model(
                &self.provider_config,
                Some(&video_model_string),
                None,
                None,
                None,
                None,
            )?;
            let video = self
                .video_provider_factory
                .build(resolved_video.model_config)?;
            orchestrator = orchestrator.with_video_provider(Arc::from(video));
        }

        if request.enable_tts {
            let tts_model_string = std::env::var("AI_TUTOR_TTS_MODEL")
                .ok()
                .or_else(|| model_string.map(|_| "openai:tts-1".to_string()))
                .unwrap_or_else(|| "openai:tts-1".to_string());
            let resolved_tts = resolve_model(
                &self.provider_config,
                Some(&tts_model_string),
                None,
                None,
                None,
                None,
            )?;
            let tts = self.tts_provider_factory.build(resolved_tts.model_config)?;
            orchestrator = orchestrator.with_tts(Arc::from(tts));
        }

        Ok(orchestrator)
    }

    async fn build_asset_store(&self) -> Result<DynAssetStore> {
        // OpenMAIC's live orchestration is not coupled to local-disk asset URLs.
        // This Rust translation keeps the same separation by choosing a storage
        // backend here: local files for dev compatibility, or R2 for production.
        match std::env::var("AI_TUTOR_ASSET_STORE")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "r2" => self.build_r2_asset_store().await,
            "local" | "" => {
                if self.r2_env_present() {
                    self.build_r2_asset_store().await
                } else {
                    Ok(Arc::new(LocalFileAssetStore::new(
                        self.storage.root_dir(),
                        &self.base_url,
                    )))
                }
            }
            other => Err(anyhow!("unsupported AI_TUTOR_ASSET_STORE value: {}", other)),
        }
    }

    fn r2_env_present(&self) -> bool {
        [
            "AI_TUTOR_R2_ENDPOINT",
            "AI_TUTOR_R2_BUCKET",
            "AI_TUTOR_R2_ACCESS_KEY_ID",
            "AI_TUTOR_R2_SECRET_ACCESS_KEY",
            "AI_TUTOR_R2_PUBLIC_BASE_URL",
        ]
        .iter()
        .any(|key| std::env::var(key).ok().is_some())
    }

    async fn build_r2_asset_store(&self) -> Result<DynAssetStore> {
        let endpoint = std::env::var("AI_TUTOR_R2_ENDPOINT")
            .map_err(|_| anyhow!("AI_TUTOR_R2_ENDPOINT is required for R2 asset storage"))?;
        let bucket = std::env::var("AI_TUTOR_R2_BUCKET")
            .map_err(|_| anyhow!("AI_TUTOR_R2_BUCKET is required for R2 asset storage"))?;
        let access_key_id = std::env::var("AI_TUTOR_R2_ACCESS_KEY_ID")
            .map_err(|_| anyhow!("AI_TUTOR_R2_ACCESS_KEY_ID is required for R2 asset storage"))?;
        let secret_access_key = std::env::var("AI_TUTOR_R2_SECRET_ACCESS_KEY").map_err(|_| {
            anyhow!("AI_TUTOR_R2_SECRET_ACCESS_KEY is required for R2 asset storage")
        })?;
        let public_base_url = std::env::var("AI_TUTOR_R2_PUBLIC_BASE_URL")
            .map_err(|_| anyhow!("AI_TUTOR_R2_PUBLIC_BASE_URL is required for R2 asset storage"))?;
        let key_prefix = std::env::var("AI_TUTOR_R2_KEY_PREFIX").unwrap_or_default();
        let allow_insecure = matches!(
            std::env::var("AI_TUTOR_ALLOW_INSECURE_R2")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        );
        if !allow_insecure {
            if !endpoint.trim().to_ascii_lowercase().starts_with("https://") {
                return Err(anyhow!(
                    "AI_TUTOR_R2_ENDPOINT must use https:// unless AI_TUTOR_ALLOW_INSECURE_R2=1"
                ));
            }
            if !public_base_url
                .trim()
                .to_ascii_lowercase()
                .starts_with("https://")
            {
                return Err(anyhow!(
                    "AI_TUTOR_R2_PUBLIC_BASE_URL must use https:// unless AI_TUTOR_ALLOW_INSECURE_R2=1"
                ));
            }
        }

        Ok(Arc::new(
            R2AssetStore::new(
                endpoint,
                bucket,
                access_key_id,
                secret_access_key,
                public_base_url,
                key_prefix,
            )
            .await?,
        ))
    }

    pub(crate) fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn system_status(&self) -> Result<SystemStatusResponse> {
        let current_model = std::env::var("AI_TUTOR_MODEL").ok();
        let generation_model_policy = resolve_generation_model_policy(
            current_model.as_deref(),
            std::env::var("AI_TUTOR_GENERATION_OUTLINES_MODEL").ok().as_deref(),
            std::env::var("AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL")
                .ok()
                .as_deref(),
            std::env::var("AI_TUTOR_GENERATION_SCENE_ACTIONS_MODEL")
                .ok()
                .as_deref(),
            std::env::var("AI_TUTOR_GENERATION_SCENE_ACTIONS_FALLBACK_MODEL")
                .ok()
                .as_deref(),
        );
        let selected_model_profile = current_model
            .as_deref()
            .and_then(|model| selected_model_profile(&self.provider_config, Some(model)).ok());
        let queue = match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        };
        let pending_result = queue.pending_count().await;
        let leases_result = queue.lease_counts().await;
        let (queue_pending_jobs, queue_active_leases, queue_stale_leases, queue_status_error) =
            match (&pending_result, &leases_result) {
                (Ok(pending), Ok(leases)) => (*pending, leases.active, leases.stale, None),
                _ => {
                    let pending = pending_result.as_ref().copied().unwrap_or(0);
                    let leases = leases_result
                        .as_ref()
                        .copied()
                        .unwrap_or(QueueLeaseCounts { active: 0, stale: 0 });
                    let mut errors = Vec::new();
                    if let Err(err) = &pending_result {
                        errors.push(format!("pending_count: {}", err));
                    }
                    if let Err(err) = &leases_result {
                        errors.push(format!("lease_counts: {}", err));
                    }
                    (
                        pending,
                        leases.active,
                        leases.stale,
                        Some(errors.join("; ")),
                    )
                }
            };

        let (provider_runtime, provider_status_error) =
            match self.current_provider_runtime_status(current_model.as_deref()) {
                Ok(statuses) => (statuses, None),
                Err(err) => (Vec::new(), Some(err.to_string())),
            };
        let provider_totals = aggregate_provider_runtime_status(&provider_runtime);
        let runtime_alerts = derive_runtime_alerts(
            &provider_runtime,
            queue_status_error.as_deref(),
            provider_status_error.as_deref(),
            queue_stale_leases,
            selected_model_profile.as_ref(),
        );
        let runtime_alert_level = derive_runtime_alert_level(&runtime_alerts).to_string();

        Ok(SystemStatusResponse {
            status: if runtime_alert_level == "ok" {
                "ok"
            } else {
                "degraded"
            },
            current_model,
            deployment_environment: std::env::var("AI_TUTOR_DEPLOYMENT_ENV")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "unknown".to_string()),
            deployment_revision: std::env::var("AI_TUTOR_DEPLOYMENT_REVISION")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            rollout_phase: std::env::var("AI_TUTOR_ROLLOUT_PHASE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "stable".to_string()),
            generation_model_policy: GenerationModelPolicyResponse {
                outlines_model: generation_model_policy.outlines_model,
                scene_content_model: generation_model_policy.scene_content_model,
                scene_actions_model: generation_model_policy.scene_actions_model,
                scene_actions_fallback_model: generation_model_policy.scene_actions_fallback_model,
            },
            selected_model_profile,
            configured_provider_priority: self.provider_config.llm_provider_priority.clone(),
            runtime_session_modes: vec![
                "stateless_client_state".to_string(),
                "managed_runtime_session".to_string(),
            ],
            runtime_native_streaming_required: runtime_native_streaming_required(),
            runtime_native_streaming_selectors: runtime_native_streaming_selectors(),
            runtime_native_typed_streaming_required: runtime_native_typed_streaming_required(),
            runtime_degraded_single_turn_only: runtime_degraded_single_turn_only(),
            runtime_alert_level,
            runtime_alerts,
            asset_backend: asset_backend_label(),
            queue_backend: queue.backend_label().to_string(),
            lesson_backend: self.storage.lesson_backend().to_string(),
            job_backend: self.storage.job_backend().to_string(),
            runtime_session_backend: self.storage.runtime_session_backend().to_string(),
            queue_pending_jobs,
            queue_active_leases,
            queue_stale_leases,
            queue_status_error,
            queue_poll_ms: queue_poll_ms(),
            queue_claim_heartbeat_interval_ms: claim_heartbeat_interval_ms(),
            queue_stale_timeout_ms: stale_working_timeout_ms(),
            provider_total_requests: provider_totals.total_requests,
            provider_total_successes: provider_totals.total_successes,
            provider_total_failures: provider_totals.total_failures,
            provider_total_latency_ms: provider_totals.total_latency_ms,
            provider_average_latency_ms: provider_totals.average_latency_ms,
            provider_estimated_input_tokens: provider_totals.estimated_input_tokens,
            provider_estimated_output_tokens: provider_totals.estimated_output_tokens,
            provider_estimated_total_cost_microusd: provider_totals.estimated_total_cost_microusd,
            provider_reported_input_tokens: provider_totals.provider_reported_input_tokens,
            provider_reported_output_tokens: provider_totals.provider_reported_output_tokens,
            provider_reported_total_tokens: provider_totals.provider_reported_total_tokens,
            provider_reported_total_cost_microusd: provider_totals
                .provider_reported_total_cost_microusd,
            provider_runtime,
            provider_status_error,
        })
    }

    fn current_provider_runtime_status(
        &self,
        model_string: Option<&str>,
    ) -> Result<Vec<ProviderRuntimeStatusResponse>> {
        let model_string = model_string
            .map(|value| value.to_string())
            .or_else(|| std::env::var("AI_TUTOR_MODEL").ok())
            .unwrap_or_else(|| "openai:gpt-4o-mini".to_string());

        let resolved = resolve_model(
            &self.provider_config,
            Some(&model_string),
            None,
            None,
            None,
            None,
        )?;

        let provider = self.provider_factory.build(resolved.model_config)?;
        Ok(map_provider_runtime_status(provider.runtime_status()))
    }
}

#[async_trait]
impl LessonAppService for LiveLessonAppService {
    async fn generate_lesson(
        &self,
        payload: GenerateLessonPayload,
    ) -> Result<GenerateLessonResponse> {
        let model_string = payload
            .model
            .clone()
            .or_else(|| std::env::var("AI_TUTOR_MODEL").ok());
        let request = build_generation_request(payload)?;
        let orchestrator = self
            .build_orchestrator(&request, model_string.as_deref())
            .await?;

        let output = orchestrator
            .generate_lesson(request, &self.base_url)
            .await?;
        let result = output
            .job
            .result
            .clone()
            .ok_or_else(|| anyhow!("lesson generation completed without result"))?;

        Ok(GenerateLessonResponse {
            lesson_id: output.lesson.id,
            job_id: output.job.id,
            url: result.url,
            scenes_count: output.lesson.scenes.len(),
        })
    }

    async fn queue_lesson(&self, payload: GenerateLessonPayload) -> Result<GenerateLessonResponse> {
        let model_string = payload
            .model
            .clone()
            .or_else(|| std::env::var("AI_TUTOR_MODEL").ok());
        let request = build_generation_request(payload)?;
        let lesson_id = Uuid::new_v4().to_string();
        let max_attempts = 3;
        let job = build_queued_job(Uuid::new_v4().to_string(), &request, chrono::Utc::now());
        self.storage
            .create_job(&job)
            .await
            .map_err(|err| anyhow!(err))?;
        self.storage
            .save_queued_job_snapshot(
                &job.id,
                &QueuedLessonJobSnapshot {
                    lesson_id: lesson_id.clone(),
                    request: request.clone(),
                    model_string: model_string.clone(),
                    max_attempts,
                },
            )
            .await
            .map_err(|err| anyhow!(err))?;
        let queue = Arc::new(match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        });
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: lesson_id.clone(),
                job: job.clone(),
                request,
                model_string: model_string.clone(),
                attempt: 0,
                max_attempts,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await?;
        let mut service = LiveLessonAppService::new(
            Arc::clone(&self.storage),
            Arc::clone(&self.provider_config),
            Arc::clone(&self.provider_factory),
            Arc::clone(&self.image_provider_factory),
            Arc::clone(&self.video_provider_factory),
            Arc::clone(&self.tts_provider_factory),
            self.base_url.clone(),
        );
        service.queue_db_path = self.queue_db_path.clone();
        let service = Arc::new(service);
        spawn_one_shot_queue_kick(queue, service);

        Ok(GenerateLessonResponse {
            lesson_id: lesson_id.clone(),
            job_id: job.id,
            url: format!(
                "{}/lessons/{}",
                self.base_url.trim_end_matches('/'),
                lesson_id
            ),
            scenes_count: 0,
        })
    }

    async fn cancel_job(&self, id: &str) -> Result<CancelLessonJobOutcome> {
        let Some(mut job) = self.storage.get_job(id).await.map_err(|err| anyhow!(err))? else {
            return Ok(CancelLessonJobOutcome::NotFound);
        };

        let queue = match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        };

        match queue.cancel(id).await? {
            QueueCancelResult::Cancelled => {
                let now = chrono::Utc::now();
                job.status = ai_tutor_domain::job::LessonGenerationJobStatus::Cancelled;
                job.step = ai_tutor_domain::job::LessonGenerationStep::Cancelled;
                job.progress = 100;
                job.message = "Lesson generation cancelled".to_string();
                job.error = None;
                job.updated_at = now;
                job.completed_at = Some(now);
                self.storage
                    .update_job(&job)
                    .await
                    .map_err(|err| anyhow!(err))?;
                Ok(CancelLessonJobOutcome::Cancelled(job))
            }
            QueueCancelResult::AlreadyClaimed => Ok(CancelLessonJobOutcome::AlreadyRunning),
            QueueCancelResult::NotFound => Ok(CancelLessonJobOutcome::NotFound),
        }
    }

    async fn resume_job(&self, id: &str) -> Result<ResumeLessonJobOutcome> {
        let Some(mut job) = self.storage.get_job(id).await.map_err(|err| anyhow!(err))? else {
            return Ok(ResumeLessonJobOutcome::NotFound);
        };

        if matches!(
            job.status,
            LessonGenerationJobStatus::Queued | LessonGenerationJobStatus::Running
        ) {
            return Ok(ResumeLessonJobOutcome::AlreadyQueuedOrRunning);
        }

        let Some(snapshot) = self
            .storage
            .get_queued_job_snapshot(id)
            .await
            .map_err(|err| anyhow!(err))?
        else {
            return Ok(ResumeLessonJobOutcome::MissingSnapshot);
        };

        let now = chrono::Utc::now();
        job.status = LessonGenerationJobStatus::Queued;
        job.step = LessonGenerationStep::Queued;
        job.progress = 0;
        job.message = "Lesson generation re-queued".to_string();
        job.error = None;
        job.scenes_generated = 0;
        job.total_scenes = None;
        job.result = None;
        job.updated_at = now;
        job.started_at = None;
        job.completed_at = None;
        self.storage
            .update_job(&job)
            .await
            .map_err(|err| anyhow!(err))?;

        let queue = Arc::new(match self.queue_db_path.clone() {
            Some(db_path) => {
                FileBackedLessonQueue::with_queue_db(Arc::clone(&self.storage), db_path)
            }
            None => FileBackedLessonQueue::new(Arc::clone(&self.storage)),
        });
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: snapshot.lesson_id,
                job: job.clone(),
                request: snapshot.request,
                model_string: snapshot.model_string,
                attempt: 0,
                max_attempts: snapshot.max_attempts,
                last_error: None,
                queued_at: now,
                available_at: now,
            })
            .await?;

        let mut service = LiveLessonAppService::new(
            Arc::clone(&self.storage),
            Arc::clone(&self.provider_config),
            Arc::clone(&self.provider_factory),
            Arc::clone(&self.image_provider_factory),
            Arc::clone(&self.video_provider_factory),
            Arc::clone(&self.tts_provider_factory),
            self.base_url.clone(),
        );
        service.queue_db_path = self.queue_db_path.clone();
        spawn_one_shot_queue_kick(queue, Arc::new(service));

        Ok(ResumeLessonJobOutcome::Resumed(job))
    }

    async fn stateless_chat(&self, payload: StatelessChatRequest) -> Result<Vec<TutorStreamEvent>> {
        let runtime_session_mode =
            validate_runtime_session_mode(&payload).map_err(|err| anyhow!(err))?;
        let runtime_session_mode_label = runtime_session_mode_label(&runtime_session_mode);
        let session_id = payload
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let runtime_session_id = coordination_session_id(&runtime_session_mode, &session_id);
        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            "Starting stateless tutor request"
        );
        self.expire_runtime_action_timeouts(&runtime_session_id).await?;
        let graph_events = self
            .run_stateless_chat_graph(payload, &session_id, None, None)
            .await?;
        let mut events = vec![build_session_started_event(
            &session_id,
            &runtime_session_id,
            runtime_session_mode_label,
        )];
        for event in graph_events {
            let tutor_event = map_graph_event_to_tutor_event(
                event,
                &session_id,
                &runtime_session_id,
                runtime_session_mode_label,
            );
            self.record_runtime_action_expectation(&tutor_event).await?;
            events.push(tutor_event);
        }
        Ok(events)
    }

    async fn stateless_chat_stream(
        &self,
        payload: StatelessChatRequest,
        sender: mpsc::Sender<TutorStreamEvent>,
    ) -> Result<()> {
        let runtime_session_mode =
            validate_runtime_session_mode(&payload).map_err(|err| anyhow!(err))?;
        let runtime_session_mode_label = runtime_session_mode_label(&runtime_session_mode);
        let session_id = payload
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let runtime_session_id = coordination_session_id(&runtime_session_mode, &session_id);
        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            "Starting stateless tutor stream"
        );
        self.expire_runtime_action_timeouts(&runtime_session_id).await?;
        sender
            .send(build_session_started_event(
                &session_id,
                &runtime_session_id,
                runtime_session_mode_label,
            ))
            .await
            .map_err(|_| anyhow!("failed to send session_started tutor event"))?;

        let (graph_sender, mut graph_receiver) = mpsc::unbounded_channel();
        let cancellation = CancellationToken::new();
        let graph_service = self.clone();
        let graph_session_id = session_id.clone();
        let graph_cancellation = cancellation.clone();
        let mut graph_handle = tokio::spawn(async move {
            graph_service
                .run_stateless_chat_graph(
                    payload,
                    &graph_session_id,
                    Some(graph_sender),
                    Some(graph_cancellation),
                )
                .await
        });

        // OpenMAIC equivalent:
        // - adapter.streamGenerate(...) receives an AbortSignal
        // - when stream consumer closes, upstream generation is aborted
        //
        // Rust equivalent here:
        // - SSE forward path watches downstream channel liveness
        // - on disconnect, abort the running graph task immediately
        let mut graph_result = None;
        loop {
            tokio::select! {
                _ = sender.closed() => {
                    warn!(
                        transport_session_id = %session_id,
                        runtime_session_mode = runtime_session_mode_label,
                        "Downstream tutor stream closed; propagating cancellation"
                    );
                    cancellation.cancel();
                    break;
                }
                maybe_event = graph_receiver.recv() => {
                    match maybe_event {
                        Some(graph_event) => {
                            let tutor_event = map_graph_event_to_tutor_event(
                                graph_event,
                                &session_id,
                                &runtime_session_id,
                                runtime_session_mode_label,
                            );
                            self.record_runtime_action_expectation(&tutor_event).await?;
                            if sender.send(tutor_event).await.is_err() {
                                warn!(
                                    transport_session_id = %session_id,
                                    runtime_session_mode = runtime_session_mode_label,
                                    "Downstream tutor stream disconnected; propagating cancellation"
                                );
                                cancellation.cancel();
                                break;
                            }
                        }
                        None => break,
                    }
                }
                result = &mut graph_handle => {
                    graph_result = Some(result);
                    break;
                }
            }
        }

        if graph_result.is_none() {
            match tokio::time::timeout(Duration::from_millis(250), &mut graph_handle).await {
                Ok(result) => graph_result = Some(result),
                Err(_) => {
                    warn!(
                        transport_session_id = %session_id,
                        runtime_session_mode = runtime_session_mode_label,
                        "Graph task did not stop promptly after cancellation; aborting task"
                    );
                    cancellation.cancel();
                    graph_handle.abort();
                    graph_result = Some(graph_handle.await);
                }
            }
        }

        match graph_result.expect("graph result should be captured") {
            Ok(result) => match result {
                Ok(_) => Ok(()),
                Err(err)
                    if cancellation.is_cancelled()
                        && err.to_string().contains("stream cancelled") =>
                {
                    Ok(())
                }
                Err(err) => Err(err),
            },
            Err(join_err) if join_err.is_cancelled() => Ok(()),
            Err(join_err) => Err(anyhow!("stateless chat graph task failed: {}", join_err)),
        }
    }

    async fn get_job(&self, id: &str) -> Result<Option<LessonGenerationJob>> {
        self.storage.get_job(id).await.map_err(|err| anyhow!(err))
    }

    async fn get_lesson(&self, id: &str) -> Result<Option<Lesson>> {
        self.storage
            .get_lesson(id)
            .await
            .map_err(|err| anyhow!(err))
    }

    async fn get_audio_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>> {
        let lesson_id = sanitize_path_segment(lesson_id)
            .ok_or_else(|| anyhow!("invalid lesson id for audio asset"))?;
        let file_name = sanitize_path_segment(file_name)
            .ok_or_else(|| anyhow!("invalid file name for audio asset"))?;
        let path = self
            .storage
            .assets_dir()
            .join("audio")
            .join(lesson_id)
            .join(file_name);

        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    async fn get_media_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>> {
        let lesson_id = sanitize_path_segment(lesson_id)
            .ok_or_else(|| anyhow!("invalid lesson id for media asset"))?;
        let file_name = sanitize_path_segment(file_name)
            .ok_or_else(|| anyhow!("invalid file name for media asset"))?;
        let path = self
            .storage
            .assets_dir()
            .join("media")
            .join(lesson_id)
            .join(file_name);

        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    async fn acknowledge_runtime_action(
        &self,
        payload: RuntimeActionAckRequest,
    ) -> Result<RuntimeActionAckResponse> {
        let runtime_session_id = payload
            .runtime_session_id
            .clone()
            .unwrap_or_else(|| payload.session_id.clone());
        self.expire_runtime_action_timeouts(&runtime_session_id)
            .await?;
        let now = chrono::Utc::now().timestamp_millis();
        let ack_status = parse_runtime_action_execution_status(&payload.status)
            .ok_or_else(|| anyhow!("unsupported runtime action ack status: {}", payload.status))?;
        let Some(mut record) = self
            .storage
            .get_runtime_action_execution(&payload.execution_id)
            .await
            .map_err(|err| anyhow!(err))?
        else {
            anyhow::bail!(
                "runtime action execution not found for acknowledgement: {}",
                payload.execution_id
            );
        };
        if record.session_id != runtime_session_id {
            anyhow::bail!(
                "runtime action acknowledgement session mismatch for execution {}",
                payload.execution_id
            );
        }

        let duplicate = !can_transition_runtime_action_status(&record.status, &ack_status);
        if !duplicate {
            record.status = ack_status.clone();
            record.updated_at_unix_ms = now;
            record.last_error = payload.error.clone();
            self.storage
                .save_runtime_action_execution(&record)
                .await
                .map_err(|err| anyhow!(err))?;
        }

        info!(
            transport_session_id = %payload.session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = payload.runtime_session_mode.as_deref().unwrap_or("unknown"),
            execution_id = %payload.execution_id,
            action_name = payload.action_name.as_deref().unwrap_or("unknown"),
            ack_status = %payload.status,
            duplicate,
            ack_error = payload.error.as_deref().unwrap_or(""),
            "Received runtime action acknowledgement"
        );
        Ok(RuntimeActionAckResponse {
            accepted: !duplicate,
            duplicate,
            current_status: runtime_action_execution_status_label(if duplicate {
                &record.status
            } else {
                &ack_status
            })
            .to_string(),
        })
    }

    async fn get_system_status(&self) -> Result<SystemStatusResponse> {
        self.system_status().await
    }
}

impl LiveLessonAppService {
    async fn record_runtime_action_expectation(&self, event: &TutorStreamEvent) -> Result<()> {
        let Some(ack_policy) = event.ack_policy.as_ref() else {
            return Ok(());
        };
        if !matches!(ack_policy, ActionAckPolicy::AckRequired) {
            return Ok(());
        }
        let Some(execution_id) = event.execution_id.as_ref() else {
            return Ok(());
        };
        let Some(action_name) = event.action_name.as_ref() else {
            return Ok(());
        };

        let now = chrono::Utc::now().timestamp_millis();
        let record = self
            .storage
            .get_runtime_action_execution(execution_id)
            .await
            .map_err(|err| anyhow!(err))?;
        if record.is_some() {
            return Ok(());
        }

        self.storage
            .save_runtime_action_execution(&RuntimeActionExecutionRecord {
                session_id: event
                    .runtime_session_id
                    .clone()
                    .unwrap_or_else(|| event.session_id.clone()),
                runtime_session_mode: event
                    .runtime_session_mode
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                execution_id: execution_id.clone(),
                action_name: action_name.clone(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: now,
                updated_at_unix_ms: now,
                timeout_at_unix_ms: now + runtime_action_ack_timeout_ms() as i64,
                last_error: None,
            })
            .await
            .map_err(|err| anyhow!(err))?;

        Ok(())
    }

    async fn ensure_runtime_action_resume_ready(
        &self,
        runtime_session_id: &str,
    ) -> Result<()> {
        let records = self
            .storage
            .list_runtime_action_executions_for_session(runtime_session_id)
            .await
            .map_err(|err| anyhow!(err))?;
        let unresolved = records
            .into_iter()
            .filter(|record| {
                matches!(
                    record.status,
                    RuntimeActionExecutionStatus::Pending | RuntimeActionExecutionStatus::Accepted
                )
            })
            .map(|record| format!("{} ({})", record.action_name, record.execution_id))
            .collect::<Vec<_>>();

        if unresolved.is_empty() {
            return Ok(());
        }

        anyhow::bail!(
            "managed runtime session has unresolved action executions and cannot resume yet: {}",
            unresolved.join(", ")
        )
    }

    async fn expire_runtime_action_timeouts(&self, session_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let records = self
            .storage
            .list_runtime_action_executions_for_session(session_id)
            .await
            .map_err(|err| anyhow!(err))?;

        for mut record in records {
            if matches!(
                record.status,
                RuntimeActionExecutionStatus::Pending | RuntimeActionExecutionStatus::Accepted
            ) && record.timeout_at_unix_ms <= now
            {
                record.status = RuntimeActionExecutionStatus::TimedOut;
                record.updated_at_unix_ms = now;
                if record.last_error.is_none() {
                    record.last_error = Some("runtime action acknowledgement timed out".to_string());
                }
                self.storage
                    .save_runtime_action_execution(&record)
                    .await
                    .map_err(|err| anyhow!(err))?;
            }
        }

        Ok(())
    }

    async fn run_stateless_chat_graph(
        &self,
        mut payload: StatelessChatRequest,
        session_id: &str,
        event_sender: Option<tokio::sync::mpsc::UnboundedSender<chat_graph::ChatGraphEvent>>,
        cancellation_token: Option<CancellationToken>,
    ) -> Result<Vec<chat_graph::ChatGraphEvent>> {
        let runtime_session_mode =
            validate_runtime_session_mode(&payload).map_err(|err| anyhow!(err))?;
        let runtime_session_mode_label = runtime_session_mode_label(&runtime_session_mode);
        let runtime_session_id = coordination_session_id(&runtime_session_mode, session_id);

        match &runtime_session_mode {
            ResolvedRuntimeSessionMode::StatelessClientState => {
                if payload.director_state.is_none() {
                    payload.director_state = Some(empty_director_state());
                }
            }
            ResolvedRuntimeSessionMode::ManagedRuntimeSession {
                persistence_session_id,
                create_if_missing,
            } => {
                let loaded = self
                    .storage
                    .get_runtime_session(persistence_session_id)
                    .await
                    .map_err(|err| anyhow!(err))?;
                payload.director_state = Some(match loaded {
                    Some(state) => state,
                    None if *create_if_missing => empty_director_state(),
                    None => {
                        anyhow::bail!(
                            "managed runtime session not found: {}",
                            persistence_session_id
                        )
                    }
                });
                self.expire_runtime_action_timeouts(&runtime_session_id).await?;
                self.ensure_runtime_action_resume_ready(&runtime_session_id)
                    .await?;
            }
        }
        payload.session_id = Some(session_id.to_string());

        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            "Starting stateless tutor graph"
        );

        let model_string = payload
            .model
            .clone()
            .or_else(|| std::env::var("AI_TUTOR_MODEL").ok())
            .unwrap_or_else(|| "openai:gpt-4o-mini".to_string());

        let resolved = resolve_model(
            &self.provider_config,
            Some(&model_string),
            Some(payload.api_key.as_str()),
            payload.base_url.as_deref(),
            payload
                .provider_type
                .as_deref()
                .and_then(parse_provider_type),
            payload.requires_api_key,
        )?;
        let llm: Arc<dyn ai_tutor_providers::traits::LlmProvider> =
            Arc::from(self.provider_factory.build(resolved.model_config)?);

        let events = match event_sender {
            Some(sender) => {
                chat_graph::run_chat_graph_stream(
                    payload,
                    llm,
                    session_id.to_string(),
                    sender,
                    cancellation_token,
                )
                .await
            }
            None => chat_graph::run_chat_graph(payload, llm, session_id.to_string()).await,
        }?;

        if let ResolvedRuntimeSessionMode::ManagedRuntimeSession {
            persistence_session_id,
            ..
        } = &runtime_session_mode
        {
            if let Some(final_state) = events.iter().rev().find_map(|event| event.director_state.clone()) {
                self.storage
                    .save_runtime_session(persistence_session_id, &final_state)
                    .await
                    .map_err(|err| anyhow!(err))?;
            }
        }

        info!(
            transport_session_id = %session_id,
            runtime_session_id = %runtime_session_id,
            runtime_session_mode = runtime_session_mode_label,
            event_count = events.len(),
            "Completed stateless tutor graph"
        );

        Ok(events)
    }
}

fn empty_director_state() -> DirectorState {
    DirectorState {
        turn_count: 0,
        agent_responses: vec![],
        whiteboard_ledger: vec![],
        whiteboard_state: None,
    }
}

fn coordination_session_id(
    mode: &ResolvedRuntimeSessionMode,
    transport_session_id: &str,
) -> String {
    match mode {
        ResolvedRuntimeSessionMode::StatelessClientState => transport_session_id.to_string(),
        ResolvedRuntimeSessionMode::ManagedRuntimeSession {
            persistence_session_id,
            ..
        } => persistence_session_id.clone(),
    }
}

fn runtime_session_mode_label(mode: &ResolvedRuntimeSessionMode) -> &'static str {
    match mode {
        ResolvedRuntimeSessionMode::StatelessClientState => "stateless_client_state",
        ResolvedRuntimeSessionMode::ManagedRuntimeSession { .. } => "managed_runtime_session",
    }
}

fn validate_runtime_session_mode(
    payload: &StatelessChatRequest,
) -> std::result::Result<ResolvedRuntimeSessionMode, String> {
    let selector = payload.runtime_session.as_ref().ok_or_else(|| {
        "missing required runtime_session contract; choose stateless_client_state or managed_runtime_session".to_string()
    })?;

    match selector.mode {
        RuntimeSessionMode::StatelessClientState => {
            if selector.session_id.is_some() || selector.create_if_missing.is_some() {
                return Err(
                    "stateless_client_state does not accept runtime_session.session_id or create_if_missing"
                        .to_string(),
                );
            }
            Ok(ResolvedRuntimeSessionMode::StatelessClientState)
        }
        RuntimeSessionMode::ManagedRuntimeSession => {
            if payload.director_state.is_some() {
                return Err(
                    "managed_runtime_session cannot be combined with client-supplied director_state"
                        .to_string(),
                );
            }
            let persistence_session_id = selector
                .session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    "managed_runtime_session requires runtime_session.session_id".to_string()
                })?
                .to_string();
            Ok(ResolvedRuntimeSessionMode::ManagedRuntimeSession {
                persistence_session_id,
                create_if_missing: selector.create_if_missing.unwrap_or(false),
            })
        }
    }
}

pub fn build_router(service: Arc<dyn LessonAppService>) -> Router {
    build_router_with_auth(service, ApiAuthConfig::from_env())
}

fn build_router_with_auth(service: Arc<dyn LessonAppService>, auth: ApiAuthConfig) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/health", get(health))
        .route("/api/system/status", get(get_system_status))
        .route("/api/system/ops-gate", get(get_ops_gate))
        .route("/api/lessons/generate", post(generate_lesson))
        .route("/api/lessons/generate-async", post(generate_lesson_async))
        .route("/api/lessons/jobs/{id}/cancel", post(cancel_job))
        .route("/api/lessons/jobs/{id}/resume", post(resume_job))
        .route("/api/runtime/actions/ack", post(acknowledge_runtime_action))
        .route("/api/runtime/chat/stream", post(stream_stateless_chat))
        .route("/api/lessons/jobs/{id}", get(get_job))
        .route("/api/lessons/{id}", get(get_lesson))
        .route("/api/lessons/{id}/events", get(stream_lesson_events))
        .route(
            "/api/assets/media/{lesson_id}/{file_name}",
            get(get_media_asset),
        )
        .route(
            "/api/assets/audio/{lesson_id}/{file_name}",
            get(get_audio_asset),
        )
        .layer(middleware::from_fn_with_state(auth, auth_middleware))
        .with_state(AppState { service })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn get_system_status(
    State(state): State<AppState>,
) -> Result<Json<SystemStatusResponse>, ApiError> {
    state
        .service
        .get_system_status()
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_ops_gate(State(state): State<AppState>) -> Result<Json<OpsGateResponse>, ApiError> {
    let status = state
        .service
        .get_system_status()
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(derive_ops_gate(&status)))
}

async fn generate_lesson(
    State(state): State<AppState>,
    Json(payload): Json<GenerateLessonPayload>,
) -> Result<Json<GenerateLessonResponse>, ApiError> {
    state
        .service
        .generate_lesson(payload)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn generate_lesson_async(
    State(state): State<AppState>,
    Json(payload): Json<GenerateLessonPayload>,
) -> Result<(StatusCode, Json<GenerateLessonResponse>), ApiError> {
    state
        .service
        .queue_lesson(payload)
        .await
        .map(|response| (StatusCode::ACCEPTED, Json(response)))
        .map_err(ApiError::internal)
}

async fn cancel_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LessonGenerationJob>, ApiError> {
    match state
        .service
        .cancel_job(&id)
        .await
        .map_err(ApiError::internal)?
    {
        CancelLessonJobOutcome::Cancelled(job) => Ok(Json(job)),
        CancelLessonJobOutcome::AlreadyRunning => Err(ApiError::conflict(format!(
            "job already running and cannot be cancelled safely: {}",
            id
        ))),
        CancelLessonJobOutcome::NotFound => {
            Err(ApiError::not_found(format!("queued job not found: {}", id)))
        }
    }
}

async fn resume_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<LessonGenerationJob>), ApiError> {
    match state
        .service
        .resume_job(&id)
        .await
        .map_err(ApiError::internal)?
    {
        ResumeLessonJobOutcome::Resumed(job) => Ok((StatusCode::ACCEPTED, Json(job))),
        ResumeLessonJobOutcome::AlreadyQueuedOrRunning => Err(ApiError::conflict(format!(
            "job is already queued or running and cannot be resumed: {}",
            id
        ))),
        ResumeLessonJobOutcome::MissingSnapshot => Err(ApiError::not_found(format!(
            "queued job snapshot not found for resume: {}",
            id
        ))),
        ResumeLessonJobOutcome::NotFound => Err(ApiError::not_found(format!(
            "job not found for resume: {}",
            id
        ))),
    }
}

async fn stream_stateless_chat(
    State(state): State<AppState>,
    Json(payload): Json<StatelessChatRequest>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    validate_runtime_session_mode(&payload).map_err(ApiError::bad_request)?;
    let (sender, receiver) = mpsc::channel::<TutorStreamEvent>(32);
    let service = Arc::clone(&state.service);
    let service_task = tokio::spawn(async move {
        if let Err(err) = service.stateless_chat_stream(payload, sender).await {
            error!("stateless tutor stream error: {}", err);
        }
    });

    let (event_sender, event_receiver) = mpsc::channel::<Result<Event, Infallible>>(32);
    tokio::spawn(async move {
        let mut receiver = receiver;
        let service_task = service_task;
        while let Some(tutor_event) = receiver.recv().await {
            if event_sender
                .send(Ok(build_tutor_sse_event(&tutor_event)))
                .await
                .is_err()
            {
                // Client stream is closed; abort backend generation immediately.
                // This mirrors OpenMAIC's abort-signal intention at the HTTP edge.
                service_task.abort();
                break;
            }
        }
    });

    Ok(Sse::new(ReceiverStream::new(event_receiver)).keep_alive(KeepAlive::default()))
}

async fn acknowledge_runtime_action(
    State(state): State<AppState>,
    Json(payload): Json<RuntimeActionAckRequest>,
) -> Result<Json<RuntimeActionAckResponse>, ApiError> {
    state
        .service
        .acknowledge_runtime_action(payload)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<LessonGenerationJob>, ApiError> {
    state
        .service
        .get_job(&id)
        .await
        .map_err(ApiError::internal)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("job not found: {}", id)))
}

async fn get_lesson(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Lesson>, ApiError> {
    state
        .service
        .get_lesson(&id)
        .await
        .map_err(ApiError::internal)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("lesson not found: {}", id)))
}

async fn stream_lesson_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let lesson = state
        .service
        .get_lesson(&id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found(format!("lesson not found: {}", id)))?;

    let playback_events = lesson_playback_events(&lesson);
    let (sender, receiver) = mpsc::channel::<Result<Event, Infallible>>(16);

    tokio::spawn(async move {
        for playback_event in playback_events {
            let event = build_sse_event(&playback_event);
            if sender.send(Ok(event)).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
    });

    Ok(Sse::new(ReceiverStream::new(receiver)).keep_alive(KeepAlive::default()))
}

async fn get_audio_asset(
    State(state): State<AppState>,
    Path((lesson_id, file_name)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .service
        .get_audio_asset(&lesson_id, &file_name)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "audio asset not found: {}/{}",
                lesson_id, file_name
            ))
        })?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type_for_file(&file_name))
        .body(Body::from(bytes))
        .map_err(ApiError::internal)
}

async fn get_media_asset(
    State(state): State<AppState>,
    Path((lesson_id, file_name)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let bytes = state
        .service
        .get_media_asset(&lesson_id, &file_name)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "media asset not found: {}/{}",
                lesson_id, file_name
            ))
        })?;

    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            media_content_type_for_file(&file_name),
        )
        .body(Body::from(bytes))
        .map_err(ApiError::internal)
}

fn build_generation_request(payload: GenerateLessonPayload) -> Result<LessonGenerationRequest> {
    if payload.requirement.trim().is_empty() {
        return Err(anyhow!("requirement cannot be empty"));
    }

    Ok(LessonGenerationRequest {
        requirements: UserRequirements {
            requirement: payload.requirement,
            language: match payload.language.as_deref() {
                Some("zh-CN") => Language::ZhCn,
                _ => Language::EnUs,
            },
            user_nickname: payload.user_nickname,
            user_bio: payload.user_bio,
            web_search: payload.enable_web_search,
        },
        pdf_content: payload.pdf_text.map(|text| PdfContent {
            text,
            images: vec![],
        }),
        enable_web_search: payload.enable_web_search.unwrap_or(false),
        enable_image_generation: payload.enable_image_generation.unwrap_or(false),
        enable_video_generation: payload.enable_video_generation.unwrap_or(false),
        enable_tts: payload.enable_tts.unwrap_or(false),
        agent_mode: match payload.agent_mode.as_deref() {
            Some("generate") => AgentMode::Generate,
            _ => AgentMode::Default,
        },
    })
}

fn sanitize_path_segment(segment: &str) -> Option<&str> {
    if segment.is_empty() || segment == "." || segment == ".." || segment.contains(['/', '\\']) {
        return None;
    }
    Some(segment)
}

fn content_type_for_file(file_name: &str) -> &'static str {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else {
        "audio/mpeg"
    }
}

fn media_content_type_for_file(file_name: &str) -> &'static str {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else {
        "image/png"
    }
}

fn build_sse_event(playback_event: &PlaybackEvent) -> Event {
    let event_name = match playback_event.kind {
        ai_tutor_runtime::session::PlaybackEventKind::SessionStarted => "session_started",
        ai_tutor_runtime::session::PlaybackEventKind::SceneStarted => "scene_started",
        ai_tutor_runtime::session::PlaybackEventKind::ActionStarted => "action_started",
        ai_tutor_runtime::session::PlaybackEventKind::SessionCompleted => "session_completed",
    };

    Event::default()
        .event(event_name)
        .json_data(playback_event)
        .unwrap_or_else(|_| {
            Event::default()
                .event("serialization_error")
                .data(playback_event.summary.clone())
        })
}

fn build_session_started_event(
    session_id: &str,
    runtime_session_id: &str,
    runtime_session_mode: &str,
) -> TutorStreamEvent {
    TutorStreamEvent {
        kind: TutorEventKind::SessionStarted,
        session_id: session_id.to_string(),
        runtime_session_id: Some(runtime_session_id.to_string()),
        runtime_session_mode: Some(runtime_session_mode.to_string()),
        turn_status: Some(TutorTurnStatus::Running),
        agent_id: None,
        agent_name: None,
        action_name: None,
        action_params: None,
        execution_id: None,
        ack_policy: None,
        execution: None,
        whiteboard_state: None,
        content: None,
        message: Some("Starting stateless tutor session".to_string()),
        interruption_reason: None,
        resume_allowed: None,
        director_state: None,
    }
}

fn map_graph_event_to_tutor_event(
    ge: chat_graph::ChatGraphEvent,
    session_id: &str,
    runtime_session_id: &str,
    runtime_session_mode: &str,
) -> TutorStreamEvent {
    let canonical_action_params = ge
        .action_name
        .as_deref()
        .zip(ge.action_params.as_ref())
        .map(|(action_name, params)| canonical_runtime_action_params(action_name, params));
    let resolved_action_params = canonical_action_params.or(ge.action_params.clone());
    let execution = ge
        .action_name
        .as_deref()
        .and_then(action_execution_metadata_for_name);
    let execution_id = ge
        .action_name
        .as_deref()
        .zip(resolved_action_params.as_ref())
        .map(|(action_name, params)| build_runtime_action_execution_id(session_id, action_name, params));
    let ack_policy = ge
        .action_name
        .as_deref()
        .and_then(action_ack_policy_for_name);
    let kind = match ge.kind {
        ChatGraphEventKind::AgentSelected => TutorEventKind::AgentSelected,
        ChatGraphEventKind::TextDelta => TutorEventKind::TextDelta,
        ChatGraphEventKind::ActionStarted => TutorEventKind::ActionStarted,
        ChatGraphEventKind::ActionProgress => TutorEventKind::ActionProgress,
        ChatGraphEventKind::ActionCompleted => TutorEventKind::ActionCompleted,
        ChatGraphEventKind::Interrupted => TutorEventKind::Interrupted,
        ChatGraphEventKind::CueUser => TutorEventKind::CueUser,
        ChatGraphEventKind::Done => TutorEventKind::Done,
    };

    TutorStreamEvent {
        kind,
        session_id: session_id.to_string(),
        runtime_session_id: Some(runtime_session_id.to_string()),
        runtime_session_mode: Some(runtime_session_mode.to_string()),
        turn_status: Some(match ge.kind {
            ChatGraphEventKind::Interrupted => TutorTurnStatus::Interrupted,
            ChatGraphEventKind::Done => TutorTurnStatus::Completed,
            _ => TutorTurnStatus::Running,
        }),
        agent_id: ge.agent_id,
        agent_name: ge.agent_name,
        action_name: ge.action_name,
        action_params: resolved_action_params,
        execution_id,
        ack_policy,
        execution,
        whiteboard_state: ge.whiteboard_state,
        content: ge.content,
        message: ge.message,
        interruption_reason: ge.interruption_reason,
        resume_allowed: ge.resume_allowed,
        director_state: ge.director_state,
    }
}

fn build_tutor_sse_event(tutor_event: &TutorStreamEvent) -> Event {
    let event_name = match tutor_event.kind {
        TutorEventKind::SessionStarted => "session_started",
        TutorEventKind::AgentSelected => "agent_selected",
        TutorEventKind::TextDelta => "text_delta",
        TutorEventKind::ActionStarted => "action_started",
        TutorEventKind::ActionProgress => "action_progress",
        TutorEventKind::ActionCompleted => "action_completed",
        TutorEventKind::Interrupted => "interrupted",
        TutorEventKind::ResumeAvailable => "resume_available",
        TutorEventKind::ResumeRejected => "resume_rejected",
        TutorEventKind::CueUser => "cue_user",
        TutorEventKind::Done => "done",
        TutorEventKind::Error => "error",
    };

    Event::default()
        .event(event_name)
        .json_data(tutor_event)
        .unwrap_or_else(|_| {
            Event::default().event("serialization_error").data(
                tutor_event
                    .message
                    .clone()
                    .unwrap_or_else(|| "serialization error".to_string()),
            )
        })
}

fn action_ack_policy_for_name(action_name: &str) -> Option<ActionAckPolicy> {
    match action_name {
        "speech" | "discussion" => Some(ActionAckPolicy::AckOptional),
        "spotlight" | "laser" | "play_video" | "wb_open" | "wb_draw_text" | "wb_draw_shape"
        | "wb_draw_chart" | "wb_draw_latex" | "wb_draw_table" | "wb_draw_line"
        | "wb_clear" | "wb_delete" | "wb_close" => Some(ActionAckPolicy::AckRequired),
        _ => None,
    }
}

fn build_runtime_action_execution_id(
    session_id: &str,
    action_name: &str,
    params: &serde_json::Value,
) -> String {
    format!(
        "{}:{}:{}",
        session_id,
        action_name,
        stable_json_signature(params)
    )
}

fn stable_json_signature(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::String(value) => format!("{:?}", value),
        serde_json::Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(stable_json_signature)
                .collect::<Vec<_>>()
                .join(",")
        ),
        serde_json::Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!("{}:{}", key, stable_json_signature(value)))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn runtime_action_ack_timeout_ms() -> u64 {
    std::env::var("AI_TUTOR_RUNTIME_ACTION_ACK_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(15_000)
}

fn parse_runtime_action_execution_status(
    value: &str,
) -> Option<RuntimeActionExecutionStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "accepted" => Some(RuntimeActionExecutionStatus::Accepted),
        "completed" => Some(RuntimeActionExecutionStatus::Completed),
        "failed" => Some(RuntimeActionExecutionStatus::Failed),
        "timed_out" => Some(RuntimeActionExecutionStatus::TimedOut),
        _ => None,
    }
}

fn runtime_action_execution_status_label(
    status: &RuntimeActionExecutionStatus,
) -> &'static str {
    match status {
        RuntimeActionExecutionStatus::Pending => "pending",
        RuntimeActionExecutionStatus::Accepted => "accepted",
        RuntimeActionExecutionStatus::Completed => "completed",
        RuntimeActionExecutionStatus::Failed => "failed",
        RuntimeActionExecutionStatus::TimedOut => "timed_out",
    }
}

fn can_transition_runtime_action_status(
    current: &RuntimeActionExecutionStatus,
    next: &RuntimeActionExecutionStatus,
) -> bool {
    match (current, next) {
        (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::Accepted)
        | (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::Completed)
        | (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::Failed)
        | (RuntimeActionExecutionStatus::Pending, RuntimeActionExecutionStatus::TimedOut)
        | (RuntimeActionExecutionStatus::Accepted, RuntimeActionExecutionStatus::Completed)
        | (RuntimeActionExecutionStatus::Accepted, RuntimeActionExecutionStatus::Failed)
        | (RuntimeActionExecutionStatus::Accepted, RuntimeActionExecutionStatus::TimedOut) => true,
        _ => false,
    }
}

fn map_provider_runtime_status(
    statuses: Vec<ProviderRuntimeStatus>,
) -> Vec<ProviderRuntimeStatusResponse> {
    statuses
        .into_iter()
        .map(|status| ProviderRuntimeStatusResponse {
            label: status.label,
            available: status.available,
            consecutive_failures: status.consecutive_failures,
            cooldown_remaining_ms: status.cooldown_remaining_ms,
            total_requests: status.total_requests,
            total_successes: status.total_successes,
            total_failures: status.total_failures,
            last_error: status.last_error,
            last_success_unix_ms: status.last_success_unix_ms,
            last_failure_unix_ms: status.last_failure_unix_ms,
            total_latency_ms: status.total_latency_ms,
            average_latency_ms: status.average_latency_ms,
            last_latency_ms: status.last_latency_ms,
            estimated_input_tokens: status.estimated_input_tokens,
            estimated_output_tokens: status.estimated_output_tokens,
            estimated_total_cost_microusd: status.estimated_total_cost_microusd,
            provider_reported_input_tokens: status.provider_reported_input_tokens,
            provider_reported_output_tokens: status.provider_reported_output_tokens,
            provider_reported_total_tokens: status.provider_reported_total_tokens,
            provider_reported_total_cost_microusd: status.provider_reported_total_cost_microusd,
            streaming_path: status.streaming_path.as_str().to_string(),
            native_streaming: status.capabilities.native_text_streaming,
            native_typed_streaming: status.capabilities.native_typed_streaming,
            compatibility_streaming: status.capabilities.compatibility_streaming,
            cooperative_cancellation: status.capabilities.cooperative_cancellation,
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProviderRuntimeTotals {
    total_requests: u64,
    total_successes: u64,
    total_failures: u64,
    total_latency_ms: u64,
    average_latency_ms: Option<u64>,
    estimated_input_tokens: u64,
    estimated_output_tokens: u64,
    estimated_total_cost_microusd: u64,
    provider_reported_input_tokens: u64,
    provider_reported_output_tokens: u64,
    provider_reported_total_tokens: u64,
    provider_reported_total_cost_microusd: u64,
}

fn aggregate_provider_runtime_status(
    statuses: &[ProviderRuntimeStatusResponse],
) -> ProviderRuntimeTotals {
    let total_requests = statuses.iter().map(|status| status.total_requests).sum();
    let total_successes = statuses.iter().map(|status| status.total_successes).sum();
    let total_failures = statuses.iter().map(|status| status.total_failures).sum();
    let total_latency_ms = statuses.iter().map(|status| status.total_latency_ms).sum();
    let estimated_input_tokens = statuses
        .iter()
        .map(|status| status.estimated_input_tokens)
        .sum();
    let estimated_output_tokens = statuses
        .iter()
        .map(|status| status.estimated_output_tokens)
        .sum();
    let estimated_total_cost_microusd = statuses
        .iter()
        .map(|status| status.estimated_total_cost_microusd)
        .sum();
    let provider_reported_input_tokens = statuses
        .iter()
        .map(|status| status.provider_reported_input_tokens)
        .sum();
    let provider_reported_output_tokens = statuses
        .iter()
        .map(|status| status.provider_reported_output_tokens)
        .sum();
    let provider_reported_total_tokens = statuses
        .iter()
        .map(|status| status.provider_reported_total_tokens)
        .sum();
    let provider_reported_total_cost_microusd = statuses
        .iter()
        .map(|status| status.provider_reported_total_cost_microusd)
        .sum();
    let average_latency_ms = if total_requests == 0 {
        None
    } else {
        Some(total_latency_ms / total_requests)
    };
    ProviderRuntimeTotals {
        total_requests,
        total_successes,
        total_failures,
        total_latency_ms,
        average_latency_ms,
        estimated_input_tokens,
        estimated_output_tokens,
        estimated_total_cost_microusd,
        provider_reported_input_tokens,
        provider_reported_output_tokens,
        provider_reported_total_tokens,
        provider_reported_total_cost_microusd,
    }
}

const DEFAULT_OUTLINES_MODEL: &str = "openrouter:google/gemini-2.5-flash";
const DEFAULT_SCENE_CONTENT_MODEL: &str = "openrouter:openai/gpt-4o-mini";
const DEFAULT_SCENE_ACTIONS_MODEL: &str = "openrouter:openai/gpt-4o-mini";
const DEFAULT_SCENE_ACTIONS_FALLBACK_MODEL: &str = "openrouter:anthropic/claude-sonnet-4-6";

fn resolve_generation_model_policy(
    request_model_override: Option<&str>,
    outlines_override: Option<&str>,
    scene_content_override: Option<&str>,
    scene_actions_override: Option<&str>,
    scene_actions_fallback_override: Option<&str>,
) -> GenerationModelPolicy {
    if let Some(request_model) = request_model_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return GenerationModelPolicy {
            outlines_model: request_model.to_string(),
            scene_content_model: request_model.to_string(),
            scene_actions_model: request_model.to_string(),
            scene_actions_fallback_model: None,
        };
    }

    let outlines_model = outlines_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_OUTLINES_MODEL)
        .to_string();
    let scene_content_model = scene_content_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCENE_CONTENT_MODEL)
        .to_string();
    let scene_actions_model = scene_actions_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCENE_ACTIONS_MODEL)
        .to_string();
    let scene_actions_fallback_model = scene_actions_fallback_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| Some(DEFAULT_SCENE_ACTIONS_FALLBACK_MODEL.to_string()))
        .filter(|value| value != &scene_actions_model);

    GenerationModelPolicy {
        outlines_model,
        scene_content_model,
        scene_actions_model,
        scene_actions_fallback_model,
    }
}

fn selected_model_profile(
    config: &ServerProviderConfig,
    model_string: Option<&str>,
) -> Result<SelectedModelProfileResponse> {
    let resolved = resolve_model(config, model_string, None, None, None, None)?;
    let provider_name = built_in_providers()
        .into_iter()
        .find(|provider| provider.id == resolved.provider.id)
        .map(|provider| provider.name)
        .unwrap_or_else(|| resolved.provider.id.clone());
    let model_name = resolved.model_info.as_ref().map(|info| info.name.clone());
    let context_window = resolved.model_info.as_ref().and_then(|info| info.context_window);
    let output_window = resolved.model_info.as_ref().and_then(|info| info.output_window);
    let cost_tier = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.cost_tier.clone());
    let input_cost_per_1m_usd = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.pricing.as_ref())
        .map(|pricing| pricing.input_cost_per_1m_usd)
        .or_else(|| {
            config
                .get(&resolved.provider.id)
                .and_then(|entry| entry.pricing_override.as_ref())
                .and_then(|pricing| pricing.input_cost_per_1m_usd)
        });
    let output_cost_per_1m_usd = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.pricing.as_ref())
        .map(|pricing| pricing.output_cost_per_1m_usd)
        .or_else(|| {
            config
                .get(&resolved.provider.id)
                .and_then(|entry| entry.pricing_override.as_ref())
                .and_then(|pricing| pricing.output_cost_per_1m_usd)
        });
    let supports_tools = resolved
        .model_info
        .as_ref()
        .map(|info| info.capabilities.tools)
        .unwrap_or(false);
    let supports_vision = resolved
        .model_info
        .as_ref()
        .map(|info| info.capabilities.vision)
        .unwrap_or(false);
    let supports_thinking = resolved
        .model_info
        .as_ref()
        .and_then(|info| info.capabilities.thinking.as_ref())
        .is_some();

    Ok(SelectedModelProfileResponse {
        provider_id: resolved.provider.id,
        provider_name,
        model_id: resolved.model_config.model_id,
        model_name,
        context_window,
        output_window,
        cost_tier,
        input_cost_per_1m_usd,
        output_cost_per_1m_usd,
        supports_tools,
        supports_vision,
        supports_thinking,
    })
}

fn derive_runtime_alerts(
    provider_runtime: &[ProviderRuntimeStatusResponse],
    queue_status_error: Option<&str>,
    provider_status_error: Option<&str>,
    queue_stale_leases: usize,
    selected_model_profile: Option<&SelectedModelProfileResponse>,
) -> Vec<String> {
    let mut alerts = Vec::new();
    if let Some(error) = queue_status_error.filter(|value| !value.trim().is_empty()) {
        alerts.push(format!("queue_status_error: {}", error));
    }
    if let Some(error) = provider_status_error.filter(|value| !value.trim().is_empty()) {
        alerts.push(format!("provider_status_error: {}", error));
    }
    if queue_stale_leases > 0 {
        alerts.push(format!(
            "queue_stale_leases_detected: {} stale worker lease(s)",
            queue_stale_leases
        ));
    }
    if runtime_native_streaming_required()
        && provider_runtime
            .iter()
            .any(|status| !status.native_streaming && status.compatibility_streaming)
    {
        alerts.push(
            "native_streaming_required_but_provider_reports_compatibility_path".to_string(),
        );
    }
    if runtime_native_typed_streaming_required()
        && provider_runtime
            .iter()
            .any(|status| status.native_streaming && !status.native_typed_streaming)
    {
        alerts.push(
            "native_typed_streaming_required_but_provider_lacks_typed_events".to_string(),
        );
    }
    if let Some(selected_model_profile) = selected_model_profile {
        if matches!(
            selected_model_profile.cost_tier.as_deref(),
            Some("premium")
        ) {
            alerts.push(format!(
                "selected_model_cost_tier_premium:{}:{}",
                selected_model_profile.provider_id, selected_model_profile.model_id
            ));
        }
    }
    for status in provider_runtime {
        if !status.available || status.cooldown_remaining_ms > 0 {
            alerts.push(format!(
                "provider_unavailable:{} cooldown_ms={}",
                status.label, status.cooldown_remaining_ms
            ));
        }
        if status.total_requests >= 5 && status.total_failures * 2 >= status.total_requests {
            alerts.push(format!(
                "provider_high_failure_rate:{} failures={}/{}",
                status.label, status.total_failures, status.total_requests
            ));
        }
        if status.average_latency_ms.is_some_and(|latency| latency >= 5_000) {
            alerts.push(format!(
                "provider_high_latency:{} avg_ms={}",
                status.label,
                status.average_latency_ms.unwrap_or_default()
            ));
        }
    }
    if production_hardening_alerts_enabled() {
        let auth_enabled = !std::env::var("AI_TUTOR_API_SECRET")
            .unwrap_or_default()
            .trim()
            .is_empty()
            || !std::env::var("AI_TUTOR_API_TOKENS")
                .unwrap_or_default()
                .trim()
                .is_empty();
        if !auth_enabled {
            alerts.push(
                "auth_disabled: configure AI_TUTOR_API_SECRET or AI_TUTOR_API_TOKENS for production"
                    .to_string(),
            );
        }
        if !matches!(
            std::env::var("AI_TUTOR_REQUIRE_HTTPS")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        ) {
            alerts.push(
                "https_not_required: set AI_TUTOR_REQUIRE_HTTPS=1 behind TLS termination for production"
                    .to_string(),
            );
        }
        if asset_backend_label() == "local" {
            alerts.push(
                "asset_backend_local: configure R2/object storage for production durability"
                    .to_string(),
            );
        }
        if std::env::var("AI_TUTOR_QUEUE_WORKER_ID")
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            alerts.push(
                "queue_worker_id_ephemeral: set AI_TUTOR_QUEUE_WORKER_ID for multi-instance ownership fencing".to_string(),
            );
        }
    }
    alerts
}

fn derive_runtime_alert_level(alerts: &[String]) -> &'static str {
    if alerts.is_empty() {
        "ok"
    } else if alerts.iter().any(|alert| {
        alert.contains("error")
            || alert.contains("unavailable")
            || alert.contains("required")
            || alert.contains("stale")
    }) {
        "degraded"
    } else {
        "warning"
    }
}

fn runtime_native_streaming_required() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn runtime_native_streaming_selectors() -> Vec<String> {
    std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(|segment| segment.trim().to_string())
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn runtime_native_typed_streaming_required() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_TYPED_STREAMING") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn runtime_degraded_single_turn_only() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_DEGRADED_SINGLE_TURN_ONLY") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => true,
    }
}

fn production_hardening_alerts_enabled() -> bool {
    match std::env::var("AI_TUTOR_PRODUCTION_HARDENING_ALERTS") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn ops_gate_strict_mode() -> bool {
    match std::env::var("AI_TUTOR_OPS_GATE_STRICT") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn derive_ops_gate(status: &SystemStatusResponse) -> OpsGateResponse {
    let strict = ops_gate_strict_mode();
    let mut checks = Vec::new();
    let mut add_check = |id: &str, required: bool, passed: bool, detail: String| {
        checks.push(OpsGateCheckResponse {
            id: id.to_string(),
            required,
            passed,
            detail,
        });
    };

    add_check(
        "runtime_alert_level_ok",
        true,
        status.runtime_alert_level == "ok",
        format!("runtime_alert_level={}", status.runtime_alert_level),
    );
    add_check(
        "queue_stale_leases_zero",
        true,
        status.queue_stale_leases == 0,
        format!("queue_stale_leases={}", status.queue_stale_leases),
    );
    add_check(
        "queue_status_error_absent",
        true,
        status
            .queue_status_error
            .as_deref()
            .is_none_or(|value| value.trim().is_empty()),
        format!(
            "queue_status_error={}",
            status
                .queue_status_error
                .as_deref()
                .unwrap_or("<none>")
                .replace('\n', " ")
        ),
    );
    add_check(
        "provider_status_error_absent",
        true,
        status
            .provider_status_error
            .as_deref()
            .is_none_or(|value| value.trim().is_empty()),
        format!(
            "provider_status_error={}",
            status
                .provider_status_error
                .as_deref()
                .unwrap_or("<none>")
                .replace('\n', " ")
        ),
    );

    let auth_enabled = !std::env::var("AI_TUTOR_API_SECRET")
        .unwrap_or_default()
        .trim()
        .is_empty()
        || !std::env::var("AI_TUTOR_API_TOKENS")
            .unwrap_or_default()
            .trim()
            .is_empty();
    add_check(
        "api_auth_configured",
        true,
        auth_enabled,
        if auth_enabled {
            "auth token(s) configured".to_string()
        } else {
            "missing AI_TUTOR_API_SECRET/AI_TUTOR_API_TOKENS".to_string()
        },
    );
    let https_required = matches!(
        std::env::var("AI_TUTOR_REQUIRE_HTTPS")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );
    add_check(
        "https_required",
        true,
        https_required,
        format!("AI_TUTOR_REQUIRE_HTTPS={}", https_required),
    );
    add_check(
        "asset_backend_non_local",
        strict,
        status.asset_backend != "local",
        format!("asset_backend={}", status.asset_backend),
    );
    add_check(
        "queue_backend_sqlite",
        strict,
        status.queue_backend == "sqlite",
        format!("queue_backend={}", status.queue_backend),
    );
    add_check(
        "runtime_backend_sqlite",
        strict,
        status.runtime_session_backend == "sqlite",
        format!("runtime_session_backend={}", status.runtime_session_backend),
    );
    let explicit_worker_id = std::env::var("AI_TUTOR_QUEUE_WORKER_ID")
        .ok()
        .is_some_and(|value| !value.trim().is_empty());
    add_check(
        "queue_worker_id_explicit",
        true,
        explicit_worker_id,
        if explicit_worker_id {
            "AI_TUTOR_QUEUE_WORKER_ID is set".to_string()
        } else {
            "AI_TUTOR_QUEUE_WORKER_ID is missing".to_string()
        },
    );

    let pass = checks.iter().all(|check| !check.required || check.passed);
    OpsGateResponse {
        pass,
        mode: if strict {
            "strict".to_string()
        } else {
            "standard".to_string()
        },
        checks,
    }
}

fn queue_poll_ms() -> u64 {
    std::env::var("AI_TUTOR_QUEUE_POLL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(500)
}

fn asset_backend_label() -> String {
    match std::env::var("AI_TUTOR_ASSET_STORE")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "r2" => "r2".to_string(),
        "local" => "local".to_string(),
        _ if [
            "AI_TUTOR_R2_ENDPOINT",
            "AI_TUTOR_R2_BUCKET",
            "AI_TUTOR_R2_ACCESS_KEY_ID",
            "AI_TUTOR_R2_SECRET_ACCESS_KEY",
            "AI_TUTOR_R2_PUBLIC_BASE_URL",
        ]
        .iter()
        .all(|key| std::env::var(key).ok().is_some()) =>
        {
            "r2".to_string()
        }
        _ => "local".to_string(),
    }
}

fn parse_provider_type(value: &str) -> Option<ai_tutor_domain::provider::ProviderType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "openai" => Some(ai_tutor_domain::provider::ProviderType::OpenAi),
        "anthropic" => Some(ai_tutor_domain::provider::ProviderType::Anthropic),
        "google" => Some(ai_tutor_domain::provider::ProviderType::Google),
        _ => None,
    }
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        error!("AI Tutor API error: {}", error);
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }

    fn not_found(message: String) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
        }
    }

    fn conflict(message: String) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(ErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, sync::Mutex};

    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use chrono::{Duration as ChronoDuration, Utc};
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;
    use tower::util::ServiceExt;

    use ai_tutor_domain::{
        generation::{AgentMode, Language, LessonGenerationRequest, UserRequirements},
        job::{
            LessonGenerationJob, LessonGenerationJobInputSummary, LessonGenerationJobResult,
            LessonGenerationJobStatus, LessonGenerationStep,
        },
        lesson::Lesson,
        runtime::{
            AgentTurnSummary, ChatMessage, ClientStageState, DirectorState,
            GeneratedChatAgentConfig, RuntimeMode, RuntimeSessionMode, RuntimeSessionSelector,
            StatelessChatConfig, StatelessChatRequest,
        },
        scene::{Scene, SceneContent, Stage},
    };
    use ai_tutor_providers::{
        factory::{
            DefaultImageProviderFactory, DefaultLlmProviderFactory, DefaultTtsProviderFactory,
            DefaultVideoProviderFactory,
        },
        traits::{
            ImageProvider, LlmProvider, ProviderRuntimeStatus, StreamingPath, TtsProvider,
            VideoProvider, VideoProviderFactory,
        },
    };
    use ai_tutor_storage::filesystem::FileStorage;
    use ai_tutor_storage::repositories::RuntimeSessionRepository;

    use super::*;

    struct MockLessonAppService {
        generate_response: Mutex<Option<GenerateLessonResponse>>,
        queued_response: Mutex<Option<GenerateLessonResponse>>,
        cancel_outcome: Mutex<Option<CancelLessonJobOutcome>>,
        resume_outcome: Mutex<Option<ResumeLessonJobOutcome>>,
        chat_events: Mutex<Vec<TutorStreamEvent>>,
        action_acks: Mutex<Vec<RuntimeActionAckRequest>>,
        job: Option<LessonGenerationJob>,
        lesson: Option<Lesson>,
        audio_asset: Option<Vec<u8>>,
        media_asset: Option<Vec<u8>>,
    }

    struct FakeLlmProvider {
        responses: Mutex<Vec<String>>,
    }

    struct FakeLlmProviderFactory;
    struct FakeChatLlmProviderFactory {
        responses: Vec<String>,
    }
    struct DelayedFakeLlmProvider {
        responses: Mutex<Vec<String>>,
        delay_ms: u64,
    }
    struct DelayedFakeLlmProviderFactory {
        responses: Vec<String>,
        delay_ms: u64,
    }
    struct BlockingCancellableFakeLlmProvider {
        started: Arc<Notify>,
        cancelled: Arc<Notify>,
    }
    struct BlockingCancellableFakeLlmProviderFactory {
        started: Arc<Notify>,
        cancelled: Arc<Notify>,
    }

    struct FakeImageProvider;

    struct FakeImageProviderFactory;

    struct FakeVideoProvider;

    struct FakeVideoProviderFactory;

    struct FakeTtsProvider;

    struct FakeTtsProviderFactory;

    #[async_trait]
    impl LessonAppService for MockLessonAppService {
        async fn generate_lesson(
            &self,
            _payload: GenerateLessonPayload,
        ) -> Result<GenerateLessonResponse> {
            self.generate_response
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing generate response"))
        }

        async fn get_job(&self, _id: &str) -> Result<Option<LessonGenerationJob>> {
            Ok(self.job.clone())
        }

        async fn queue_lesson(
            &self,
            _payload: GenerateLessonPayload,
        ) -> Result<GenerateLessonResponse> {
            self.queued_response
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing queued response"))
        }

        async fn cancel_job(&self, _id: &str) -> Result<CancelLessonJobOutcome> {
            self.cancel_outcome
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing cancel outcome"))
        }

        async fn resume_job(&self, _id: &str) -> Result<ResumeLessonJobOutcome> {
            self.resume_outcome
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| anyhow!("missing resume outcome"))
        }

        async fn stateless_chat(
            &self,
            _payload: StatelessChatRequest,
        ) -> Result<Vec<TutorStreamEvent>> {
            Ok(self.chat_events.lock().unwrap().clone())
        }

        async fn stateless_chat_stream(
            &self,
            _payload: StatelessChatRequest,
            sender: mpsc::Sender<TutorStreamEvent>,
        ) -> Result<()> {
            let events = self.chat_events.lock().unwrap().clone();
            for event in events {
                if sender.send(event).await.is_err() {
                    break;
                }
            }
            Ok(())
        }

        async fn get_lesson(&self, _id: &str) -> Result<Option<Lesson>> {
            Ok(self.lesson.clone())
        }

        async fn get_audio_asset(
            &self,
            _lesson_id: &str,
            _file_name: &str,
        ) -> Result<Option<Vec<u8>>> {
            Ok(self.audio_asset.clone())
        }

        async fn get_media_asset(
            &self,
            _lesson_id: &str,
            _file_name: &str,
        ) -> Result<Option<Vec<u8>>> {
            Ok(self.media_asset.clone())
        }

        async fn acknowledge_runtime_action(
            &self,
            payload: RuntimeActionAckRequest,
        ) -> Result<RuntimeActionAckResponse> {
            self.action_acks.lock().unwrap().push(payload);
            Ok(RuntimeActionAckResponse {
                accepted: true,
                duplicate: false,
                current_status: "completed".to_string(),
            })
        }

        async fn get_system_status(&self) -> Result<SystemStatusResponse> {
            Ok(SystemStatusResponse {
                status: "ok",
                current_model: Some("openai:gpt-4o-mini".to_string()),
                deployment_environment: "test".to_string(),
                deployment_revision: Some("rev-test".to_string()),
                rollout_phase: "stable".to_string(),
                generation_model_policy: GenerationModelPolicyResponse {
                    outlines_model: "openrouter:google/gemini-2.5-flash".to_string(),
                    scene_content_model: "openrouter:openai/gpt-4o-mini".to_string(),
                    scene_actions_model: "openrouter:openai/gpt-4o-mini".to_string(),
                    scene_actions_fallback_model: Some(
                        "openrouter:anthropic/claude-sonnet-4-6".to_string(),
                    ),
                },
                selected_model_profile: Some(SelectedModelProfileResponse {
                    provider_id: "openai".to_string(),
                    provider_name: "OpenAI".to_string(),
                    model_id: "gpt-4o-mini".to_string(),
                    model_name: Some("GPT-4o Mini".to_string()),
                    context_window: Some(128_000),
                    output_window: Some(4_096),
                    cost_tier: Some("economy".to_string()),
                    input_cost_per_1m_usd: None,
                    output_cost_per_1m_usd: None,
                    supports_tools: true,
                    supports_vision: true,
                    supports_thinking: false,
                }),
                configured_provider_priority: vec!["openai".to_string()],
                runtime_session_modes: vec![
                    "stateless_client_state".to_string(),
                    "managed_runtime_session".to_string(),
                ],
                runtime_native_streaming_required: false,
                runtime_native_streaming_selectors: vec![],
                runtime_native_typed_streaming_required: false,
                runtime_degraded_single_turn_only: true,
                runtime_alert_level: "ok".to_string(),
                runtime_alerts: vec![],
                asset_backend: "local".to_string(),
                queue_backend: "file".to_string(),
                lesson_backend: "file".to_string(),
                job_backend: "file".to_string(),
                runtime_session_backend: "file".to_string(),
                queue_pending_jobs: 0,
                queue_active_leases: 0,
                queue_stale_leases: 0,
                queue_status_error: None,
                queue_poll_ms: queue_poll_ms(),
                queue_claim_heartbeat_interval_ms: claim_heartbeat_interval_ms(),
                queue_stale_timeout_ms: stale_working_timeout_ms(),
                provider_total_requests: 0,
                provider_total_successes: 0,
                provider_total_failures: 0,
                provider_total_latency_ms: 0,
                provider_average_latency_ms: None,
                provider_estimated_input_tokens: 0,
                provider_estimated_output_tokens: 0,
                provider_estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                provider_runtime: vec![],
                provider_status_error: None,
            })
        }
    }

    #[async_trait]
    impl LlmProvider for FakeLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("missing fake llm response"));
            }
            Ok(responses.remove(0))
        }

        fn streaming_path(&self) -> StreamingPath {
            StreamingPath::Native
        }

        fn capabilities(&self) -> ai_tutor_providers::traits::ProviderCapabilities {
            ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed()
        }

        fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
            vec![ProviderRuntimeStatus {
                label: "fake:healthy".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: 0,
                average_latency_ms: Some(20),
                last_latency_ms: Some(20),
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities: ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            }]
        }
    }

    impl LlmProviderFactory for FakeLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(FakeLlmProvider {
                responses: Mutex::new(vec![
                    r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is","Parts of a fraction"],"scene_type":"slide","media_generations":[{"element_id":"gen_img_1","media_type":"image","prompt":"A pizza cut into fractions","aspect_ratio":"16:9"}]},{"title":"Fraction Quiz","description":"Check learning","key_points":["Identify numerator"],"scene_type":"quiz"}]}"#.to_string(),
                    r#"{"elements":[{"kind":"text","content":"Fractions represent parts of a whole.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"A fraction shows part of a whole."}]}"#.to_string(),
                    r#"{"questions":[{"question":"What part names the top number in a fraction?","options":["Numerator","Denominator","Whole","Decimal"],"answer":["Numerator"]}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"Now let's check what you learned."}]}"#.to_string(),
                ]),
            }))
        }
    }

    impl LlmProviderFactory for FakeChatLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(FakeLlmProvider {
                responses: Mutex::new(self.responses.clone()),
            }))
        }
    }

    #[async_trait]
    impl LlmProvider for DelayedFakeLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            tokio::time::sleep(std::time::Duration::from_millis(self.delay_ms)).await;
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("missing delayed fake llm response"));
            }
            Ok(responses.remove(0))
        }

        fn streaming_path(&self) -> StreamingPath {
            StreamingPath::Native
        }

        fn capabilities(&self) -> ai_tutor_providers::traits::ProviderCapabilities {
            ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed()
        }

        fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
            vec![ProviderRuntimeStatus {
                label: "fake:delayed".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: self.delay_ms,
                average_latency_ms: Some(self.delay_ms),
                last_latency_ms: Some(self.delay_ms),
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities: ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            }]
        }
    }

    impl LlmProviderFactory for DelayedFakeLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(DelayedFakeLlmProvider {
                responses: Mutex::new(self.responses.clone()),
                delay_ms: self.delay_ms,
            }))
        }
    }

    #[async_trait]
    impl LlmProvider for BlockingCancellableFakeLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok("unused".to_string())
        }

        async fn generate_stream_events_with_history_cancellable(
            &self,
            _messages: &[(String, String)],
            cancellation: &CancellationToken,
            _on_event: &mut (dyn FnMut(ai_tutor_providers::traits::ProviderStreamEvent) + Send),
        ) -> Result<String> {
            self.started.notify_waiters();
            cancellation.cancelled().await;
            self.cancelled.notify_waiters();
            Err(anyhow!("stream cancelled"))
        }

        fn streaming_path(&self) -> StreamingPath {
            StreamingPath::Native
        }

        fn capabilities(&self) -> ai_tutor_providers::traits::ProviderCapabilities {
            ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed()
        }

        fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
            vec![ProviderRuntimeStatus {
                label: "fake:blocking-cancellable".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: 0,
                average_latency_ms: Some(10),
                last_latency_ms: Some(10),
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities: ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            }]
        }
    }

    impl LlmProviderFactory for BlockingCancellableFakeLlmProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn LlmProvider>> {
            Ok(Box::new(BlockingCancellableFakeLlmProvider {
                started: Arc::clone(&self.started),
                cancelled: Arc::clone(&self.cancelled),
            }))
        }
    }

    #[async_trait]
    impl ImageProvider for FakeImageProvider {
        async fn generate_image(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            Ok("data:image/png;base64,ZmFrZQ==".to_string())
        }
    }

    impl ImageProviderFactory for FakeImageProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn ImageProvider>> {
            Ok(Box::new(FakeImageProvider))
        }
    }

    #[async_trait]
    impl VideoProvider for FakeVideoProvider {
        async fn generate_video(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            Ok("data:video/mp4;base64,ZmFrZQ==".to_string())
        }
    }

    impl VideoProviderFactory for FakeVideoProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn VideoProvider>> {
            Ok(Box::new(FakeVideoProvider))
        }
    }

    #[async_trait]
    impl TtsProvider for FakeTtsProvider {
        async fn synthesize(
            &self,
            _text: &str,
            _voice: Option<&str>,
            _speed: Option<f32>,
        ) -> Result<String> {
            Ok("data:audio/mpeg;base64,ZmFrZQ==".to_string())
        }
    }

    impl TtsProviderFactory for FakeTtsProviderFactory {
        fn build(
            &self,
            _model_config: ai_tutor_domain::provider::ModelConfig,
        ) -> Result<Box<dyn TtsProvider>> {
            Ok(Box::new(FakeTtsProvider))
        }
    }

    fn sample_job() -> LessonGenerationJob {
        let request = LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
                web_search: Some(false),
            },
            pdf_content: None,
            enable_web_search: false,
            enable_image_generation: false,
            enable_video_generation: false,
            enable_tts: false,
            agent_mode: AgentMode::Default,
        };
        let now = Utc::now();
        LessonGenerationJob {
            id: "job-1".to_string(),
            status: LessonGenerationJobStatus::Succeeded,
            step: LessonGenerationStep::Completed,
            progress: 100,
            message: "done".to_string(),
            input_summary: LessonGenerationJobInputSummary::from(&request),
            scenes_generated: 2,
            total_scenes: Some(2),
            result: Some(LessonGenerationJobResult {
                lesson_id: "lesson-1".to_string(),
                url: "http://localhost:8099/lessons/lesson-1".to_string(),
                scenes_count: 2,
            }),
            error: None,
            created_at: now,
            updated_at: now,
            started_at: Some(now),
            completed_at: Some(now),
        }
    }

    fn sample_lesson() -> Lesson {
        let now = Utc::now();
        Lesson {
            id: "lesson-1".to_string(),
            title: "Fractions".to_string(),
            language: "en-US".to_string(),
            description: Some("Teach fractions".to_string()),
            stage: Some(Stage {
                id: "stage-1".to_string(),
                name: "Fractions".to_string(),
                description: Some("Stage".to_string()),
                created_at: now.timestamp_millis(),
                updated_at: now.timestamp_millis(),
                language: Some("en-US".to_string()),
                style: Some("interactive".to_string()),
                whiteboard: vec![],
                agent_ids: vec![],
                generated_agent_configs: vec![],
            }),
            scenes: vec![],
            style: Some("interactive".to_string()),
            agent_ids: vec![],
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_runtime_scene() -> Scene {
        Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Fractions discussion".to_string(),
            order: 1,
            content: SceneContent::Quiz { questions: vec![] },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn sample_agent_config(
        id: &str,
        name: &str,
        role: &str,
        persona: &str,
        priority: i32,
        bound_stage_id: Option<&str>,
    ) -> GeneratedChatAgentConfig {
        GeneratedChatAgentConfig {
            id: id.to_string(),
            name: name.to_string(),
            role: role.to_string(),
            persona: persona.to_string(),
            avatar: "agent".to_string(),
            color: "#21614e".to_string(),
            allowed_actions: vec!["speech".to_string(), "discussion".to_string()],
            priority,
            is_generated: Some(true),
            bound_stage_id: bound_stage_id.map(|value| value.to_string()),
        }
    }

    fn sample_stateless_chat_request() -> StatelessChatRequest {
        StatelessChatRequest {
            session_id: None,
            runtime_session: Some(RuntimeSessionSelector {
                mode: RuntimeSessionMode::StatelessClientState,
                session_id: None,
                create_if_missing: None,
            }),
            messages: vec![ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: "Explain fractions with a simple example".to_string(),
                metadata: None,
            }],
            store_state: ClientStageState {
                stage: None,
                scenes: vec![sample_runtime_scene()],
                current_scene_id: Some("scene-1".to_string()),
                mode: RuntimeMode::Live,
                whiteboard_open: false,
            },
            config: StatelessChatConfig {
                agent_ids: vec![
                    "teacher-1".to_string(),
                    "student-1".to_string(),
                    "assistant-1".to_string(),
                ],
                session_type: Some("discussion".to_string()),
                discussion_topic: Some("fractions".to_string()),
                discussion_prompt: Some("Explain fractions with a pizza example".to_string()),
                trigger_agent_id: Some("teacher-1".to_string()),
                agent_configs: vec![
                    sample_agent_config(
                        "teacher-1",
                        "Ms. Rivera",
                        "teacher",
                        "Math teacher who uses clear examples",
                        1,
                        Some("stage-1"),
                    ),
                    sample_agent_config(
                        "student-1",
                        "Asha",
                        "student",
                        "Curious student who asks clarifying questions",
                        2,
                        Some("stage-1"),
                    ),
                    sample_agent_config(
                        "assistant-1",
                        "Board Helper",
                        "assistant",
                        "Assistant who summarizes and organizes concepts",
                        3,
                        None,
                    ),
                ],
            },
            director_state: None,
            user_profile: None,
            api_key: "test-key".to_string(),
            base_url: None,
            model: Some("openai:gpt-4o-mini".to_string()),
            provider_type: Some("openai".to_string()),
            requires_api_key: Some(true),
        }
    }

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-tutor-api-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn build_live_service(storage: Arc<FileStorage>) -> Arc<dyn LessonAppService> {
        let provider_config = Arc::new(ServerProviderConfig::default());
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::clone(&provider_config),
            Arc::new(DefaultLlmProviderFactory::new((*provider_config).clone())),
            Arc::new(DefaultImageProviderFactory::new((*provider_config).clone())),
            Arc::new(DefaultVideoProviderFactory::new((*provider_config).clone())),
            Arc::new(DefaultTtsProviderFactory::new((*provider_config).clone())),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_service_with_fakes(storage: Arc<FileStorage>) -> Arc<dyn LessonAppService> {
        build_live_service_with_fakes_and_queue(storage, std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok())
    }

    fn build_live_service_with_fakes_and_queue(
        storage: Arc<FileStorage>,
        queue_db_path: Option<String>,
    ) -> Arc<dyn LessonAppService> {
        Arc::new(
            LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(FakeLlmProviderFactory),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        )
        .with_queue_db_path(queue_db_path),
        )
    }

    fn build_live_service_with_delayed_fakes(
        storage: Arc<FileStorage>,
        delay_ms: u64,
    ) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(DelayedFakeLlmProviderFactory {
                responses: vec![
                    r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
                    r#"{"elements":[{"kind":"text","content":"Fractions represent parts of a whole.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"A fraction shows part of a whole."}]}"#.to_string(),
                ],
                delay_ms,
            }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_chat_service_with_response(
        storage: Arc<FileStorage>,
        responses: Vec<String>,
    ) -> Arc<dyn LessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(FakeChatLlmProviderFactory { responses }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_chat_service_with_response_concrete(
        storage: Arc<FileStorage>,
        responses: Vec<String>,
    ) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(FakeChatLlmProviderFactory { responses }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_chat_service_with_blocking_cancellable_provider(
        storage: Arc<FileStorage>,
        started: Arc<Notify>,
        cancelled: Arc<Notify>,
    ) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ai_tutor_providers::config::ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
            }),
            Arc::new(BlockingCancellableFakeLlmProviderFactory { started, cancelled }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    #[tokio::test]
    async fn live_service_stateless_chat_runs_multi_turn_discussion_loop() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let payload = sample_stateless_chat_request();

        let events = service.stateless_chat(payload).await.unwrap();
        let selected_count = events
            .iter()
            .filter(|event| matches!(event.kind, TutorEventKind::AgentSelected))
            .count();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("director state should be returned on done");

        assert_eq!(selected_count, 2);
        assert_eq!(final_state.turn_count, 2);
        assert_eq!(final_state.agent_responses.len(), 2);
    }

    #[tokio::test]
    async fn live_service_stateless_chat_emits_cue_user_for_discussion_sessions() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let payload = sample_stateless_chat_request();

        let events = service.stateless_chat(payload).await.unwrap();
        let cue_user = events
            .iter()
            .find(|event| matches!(event.kind, TutorEventKind::CueUser));

        assert!(cue_user.is_some());
        assert!(cue_user
            .and_then(|event| event.message.as_ref())
            .is_some_and(|message| message.contains("Ask a follow-up")));
    }

    #[tokio::test]
    async fn live_service_stateless_chat_reuses_client_supplied_director_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![
                r#"[{"type":"text","content":"Using the client tutor runtime state."}]"#.to_string(),
                r#"[{"type":"text","content":"Continuing from the passed discussion context."}]"#
                    .to_string(),
            ],
        );

        let mut payload = sample_stateless_chat_request();
        payload.session_id = Some("session-reuse".to_string());
        payload.director_state = Some(DirectorState {
            turn_count: 1,
            agent_responses: vec![AgentTurnSummary {
                agent_id: "teacher-1".to_string(),
                agent_name: "Ms. Rivera".to_string(),
                content_preview: "Previously client-carried discussion turn".to_string(),
                action_count: 0,
                whiteboard_actions: vec![],
            }],
            whiteboard_ledger: vec![],
            whiteboard_state: None,
        });

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");

        assert!(final_state.turn_count > 1);
        assert!(final_state.agent_responses.len() > 1);
        assert_eq!(
            final_state.agent_responses[0].content_preview,
            "Previously client-carried discussion turn"
        );
    }

    #[tokio::test]
    async fn live_service_stateless_chat_does_not_persist_runtime_session_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));

        let mut payload = sample_stateless_chat_request();
        payload.session_id = Some("session-no-persist".to_string());
        payload.director_state = None;

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");
        let saved_state = storage
            .get_runtime_session("session-no-persist")
            .await
            .unwrap();

        assert!(saved_state.is_none());
        assert!(final_state.turn_count >= 1);
    }

    #[tokio::test]
    async fn live_service_managed_runtime_session_loads_and_persists_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![
                r#"{"next_agent":"teacher-1"}"#.to_string(),
                r#"[{"type":"text","content":"Resuming with managed runtime memory."}]"#.to_string(),
            ],
        );

        storage
            .save_runtime_session(
                "managed-session-1",
                &DirectorState {
                    turn_count: 1,
                    agent_responses: vec![AgentTurnSummary {
                        agent_id: "teacher-1".to_string(),
                        agent_name: "Ms. Rivera".to_string(),
                        content_preview: "Persisted turn".to_string(),
                        action_count: 0,
                        whiteboard_actions: vec![],
                    }],
                    whiteboard_ledger: vec![],
                    whiteboard_state: None,
                },
            )
            .await
            .unwrap();

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-session-1".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = None;

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");
        let persisted = storage
            .get_runtime_session("managed-session-1")
            .await
            .unwrap()
            .expect("managed session should be persisted");

        assert!(final_state.turn_count > 1);
        assert_eq!(persisted.turn_count, final_state.turn_count);
        assert_eq!(
            persisted.agent_responses[0].content_preview,
            "Persisted turn".to_string()
        );
    }

    #[tokio::test]
    async fn live_service_managed_runtime_session_can_create_empty_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"Fresh managed session."}]"#.to_string()],
        );

        let mut payload = sample_stateless_chat_request();
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        payload.config.agent_configs.truncate(1);
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-session-new".to_string()),
            create_if_missing: Some(true),
        });
        payload.director_state = None;

        let events = service.stateless_chat(payload).await.unwrap();
        let final_state = events
            .iter()
            .rev()
            .find_map(|event| event.director_state.clone())
            .expect("final director state should be returned");
        let persisted = storage
            .get_runtime_session("managed-session-new")
            .await
            .unwrap();

        assert!(final_state.turn_count >= 1);
        assert!(persisted.is_some());
    }

    #[tokio::test]
    async fn live_service_rejects_missing_managed_runtime_session() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("missing-managed".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = None;

        let error = service.stateless_chat(payload).await.unwrap_err();
        assert!(error.to_string().contains("managed runtime session not found"));
    }

    #[tokio::test]
    async fn live_service_system_status_reports_sqlite_backends_and_queue_depth() {
        let root = temp_root();
        let lesson_db_path = root.join("runtime").join("lessons.db");
        let runtime_db_path = root.join("runtime").join("runtime-sessions.db");
        let queue_db_path = root.join("runtime").join("lesson-queue.db");
        let job_db_path = root.join("runtime").join("lesson-jobs.db");
        let previous_lesson_db = std::env::var("AI_TUTOR_LESSON_DB_PATH").ok();
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        let previous_job_db = std::env::var("AI_TUTOR_JOB_DB_PATH").ok();
        std::env::set_var(
            "AI_TUTOR_LESSON_DB_PATH",
            lesson_db_path.to_string_lossy().to_string(),
        );
        std::env::set_var(
            "AI_TUTOR_QUEUE_DB_PATH",
            queue_db_path.to_string_lossy().to_string(),
        );
        std::env::set_var(
            "AI_TUTOR_JOB_DB_PATH",
            job_db_path.to_string_lossy().to_string(),
        );
        let storage = Arc::new(FileStorage::with_databases(
            &root,
            Some(lesson_db_path),
            Some(runtime_db_path.clone()),
            Some(job_db_path),
        ));
        let service = build_live_service_with_fakes(Arc::clone(&storage));

        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();
        let job = build_queued_job(
            "job-system-status".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&job).await.unwrap();
        FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path)
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-system-status".to_string(),
                job,
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();

        let status = service.get_system_status().await.unwrap();

        if let Some(value) = previous_lesson_db {
            std::env::set_var("AI_TUTOR_LESSON_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_LESSON_DB_PATH");
        }
        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }
        if let Some(value) = previous_job_db {
            std::env::set_var("AI_TUTOR_JOB_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_JOB_DB_PATH");
        }

        assert_eq!(status.queue_backend, "sqlite");
        assert_eq!(status.lesson_backend, "sqlite");
        assert_eq!(status.job_backend, "sqlite");
        assert_eq!(status.runtime_session_backend, "sqlite");
        assert_eq!(status.asset_backend, "local");
        assert_eq!(status.queue_pending_jobs, 1);
        assert_eq!(status.queue_active_leases, 0);
        assert_eq!(status.queue_stale_leases, 0);
        assert!(status.queue_status_error.is_none());
        assert_eq!(status.queue_poll_ms, 500);
        assert_eq!(status.queue_claim_heartbeat_interval_ms, 30_000);
        assert_eq!(status.queue_stale_timeout_ms, 300_000);
    }

    #[tokio::test]
    async fn live_service_system_status_reports_queue_active_and_stale_leases() {
        let root = temp_root();
        let queue_db_path = root.join("runtime").join("lesson-queue.db");
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        std::env::set_var(
            "AI_TUTOR_QUEUE_DB_PATH",
            queue_db_path.to_string_lossy().to_string(),
        );
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();

        let active_job = build_queued_job(
            "job-system-status-active-lease".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&active_job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-system-status-active-lease".to_string(),
                job: active_job.clone(),
                request: request.clone(),
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        let _ = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "status-worker-active-lease".to_string(),
        )
        .await
        .unwrap()
        .expect("active lease should be claimed");

        let stale_job = build_queued_job(
            "job-system-status-stale-lease".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&stale_job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-system-status-stale-lease".to_string(),
                job: stale_job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        let _ = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "status-worker-stale-lease".to_string(),
        )
        .await
        .unwrap()
        .expect("stale lease should be claimed");

        tokio::task::spawn_blocking({
            let db_path = queue_db_path.clone();
            let stale_id = stale_job.id.clone();
            move || -> anyhow::Result<()> {
                let connection = rusqlite::Connection::open(db_path)?;
                connection.execute(
                    "UPDATE lesson_queue
                     SET lease_until = ?2
                     WHERE job_id = ?1",
                    rusqlite::params![
                        stale_id,
                        (chrono::Utc::now() - chrono::Duration::minutes(10)).to_rfc3339()
                    ],
                )?;
                Ok(())
            }
        })
        .await
        .unwrap()
        .unwrap();

        let status = service.get_system_status().await.unwrap();

        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }

        assert_eq!(status.queue_active_leases, 1);
        assert_eq!(status.queue_stale_leases, 1);
        assert!(status.queue_status_error.is_none());
        assert_eq!(status.runtime_alert_level, "degraded");
        assert!(status
            .runtime_alerts
            .iter()
            .any(|alert| alert.contains("queue_stale_leases_detected")));
    }

    #[tokio::test]
    async fn health_route_returns_ok_json() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn auth_middleware_enforces_rbac_for_generate_route() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                generate_response: Mutex::new(Some(GenerateLessonResponse {
                    lesson_id: "lesson-auth".to_string(),
                    job_id: "job-auth".to_string(),
                    url: "http://localhost:8099/api/lessons/lesson-auth".to_string(),
                    scenes_count: 1,
                })),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([
                    ("reader-token".to_string(), ApiRole::Reader),
                    ("writer-token".to_string(), ApiRole::Writer),
                ]),
                require_https: false,
            },
        );

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "test auth".to_string(),
            language: Some("english".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("standard".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();

        let unauthorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let forbidden = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer reader-token")
                    .body(Body::from(payload.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let ok = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer writer-token")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn auth_middleware_allows_health_when_auth_enabled() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([("ops-token".to_string(), ApiRole::Admin)]),
                require_https: false,
            },
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn https_requirement_blocks_non_tls_requests_for_protected_routes() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: false,
                tokens: HashMap::new(),
                require_https: true,
            },
        );

        let blocked = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/system/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(blocked.status(), StatusCode::UPGRADE_REQUIRED);

        let allowed = app
            .oneshot(
                Request::builder()
                    .uri("/api/system/status")
                    .header("x-forwarded-proto", "https")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn system_status_route_returns_runtime_observability_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/system/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["status"], "ok");
        assert_eq!(parsed["deployment_environment"], "test");
        assert_eq!(parsed["rollout_phase"], "stable");
        assert_eq!(parsed["runtime_alert_level"], "ok");
        assert_eq!(parsed["runtime_alerts"], serde_json::json!([]));
        assert_eq!(parsed["configured_provider_priority"], serde_json::json!(["openai"]));
        assert_eq!(
            parsed["selected_model_profile"]["provider_id"],
            serde_json::json!("openai")
        );
        assert_eq!(
            parsed["selected_model_profile"]["model_id"],
            serde_json::json!("gpt-4o-mini")
        );
        assert_eq!(
            parsed["selected_model_profile"]["cost_tier"],
            serde_json::json!("economy")
        );
        assert_eq!(parsed["queue_backend"], "file");
        assert_eq!(parsed["job_backend"], "file");
        assert_eq!(parsed["runtime_session_backend"], "file");
        assert_eq!(parsed["asset_backend"], "local");
        assert_eq!(parsed["runtime_native_streaming_required"], false);
        assert_eq!(
            parsed["runtime_native_streaming_selectors"],
            serde_json::json!([])
        );
        assert_eq!(parsed["queue_active_leases"], 0);
        assert_eq!(parsed["queue_stale_leases"], 0);
        assert_eq!(parsed["queue_status_error"], serde_json::Value::Null);
        assert_eq!(parsed["queue_poll_ms"], 500);
        assert_eq!(parsed["queue_claim_heartbeat_interval_ms"], 30000);
        assert_eq!(parsed["queue_stale_timeout_ms"], 300000);
        assert_eq!(parsed["provider_total_requests"], 0);
        assert_eq!(parsed["provider_total_successes"], 0);
        assert_eq!(parsed["provider_total_failures"], 0);
        assert_eq!(parsed["provider_total_latency_ms"], 0);
        assert_eq!(parsed["provider_reported_input_tokens"], 0);
        assert_eq!(parsed["provider_reported_output_tokens"], 0);
        assert_eq!(parsed["provider_reported_total_tokens"], 0);
        assert_eq!(parsed["provider_reported_total_cost_microusd"], 0);
        assert_eq!(
            parsed["provider_average_latency_ms"],
            serde_json::Value::Null
        );
    }

    #[tokio::test]
    async fn ops_gate_route_returns_required_checks() {
        let app = build_router_with_auth(
            Arc::new(MockLessonAppService {
                generate_response: Mutex::new(None),
                queued_response: Mutex::new(None),
                cancel_outcome: Mutex::new(None),
                resume_outcome: Mutex::new(None),
                chat_events: Mutex::new(vec![]),
                action_acks: Mutex::new(vec![]),
                job: None,
                lesson: None,
                audio_asset: None,
                media_asset: None,
            }),
            ApiAuthConfig {
                enabled: true,
                tokens: HashMap::from([("ops-token".to_string(), ApiRole::Admin)]),
                require_https: false,
            },
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/system/ops-gate")
                    .header(header::AUTHORIZATION, "Bearer ops-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["mode"], "standard");
        assert!(parsed["checks"].as_array().is_some_and(|items| !items.is_empty()));
    }

    #[test]
    fn provider_runtime_status_mapping_exposes_streaming_path() {
        let mapped = map_provider_runtime_status(vec![
            ProviderRuntimeStatus {
                label: "openai:gpt-4o-mini".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 12,
                total_successes: 11,
                total_failures: 1,
                last_error: Some("429 Too Many Requests".to_string()),
                last_success_unix_ms: Some(1_700_000_001_000),
                last_failure_unix_ms: Some(1_700_000_000_000),
                total_latency_ms: 450,
                average_latency_ms: Some(37),
                last_latency_ms: Some(41),
                estimated_input_tokens: 4_000,
                estimated_output_tokens: 1_200,
                estimated_total_cost_microusd: 4_500,
                provider_reported_input_tokens: 3_900,
                provider_reported_output_tokens: 1_100,
                provider_reported_total_tokens: 5_000,
                provider_reported_total_cost_microusd: 4_200,
                streaming_path: StreamingPath::Native,
                capabilities: ai_tutor_providers::traits::ProviderCapabilities::native_text_and_typed(),
            },
            ProviderRuntimeStatus {
                label: "legacy:mock".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 3,
                total_successes: 3,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: Some(1_700_000_002_000),
                last_failure_unix_ms: None,
                total_latency_ms: 120,
                average_latency_ms: Some(40),
                last_latency_ms: Some(39),
                estimated_input_tokens: 1_000,
                estimated_output_tokens: 900,
                estimated_total_cost_microusd: 1_300,
                provider_reported_input_tokens: 900,
                provider_reported_output_tokens: 800,
                provider_reported_total_tokens: 1_700,
                provider_reported_total_cost_microusd: 1_100,
                streaming_path: StreamingPath::Compatibility,
                capabilities: ai_tutor_providers::traits::ProviderCapabilities::compatibility_only(),
            },
        ]);

        assert_eq!(mapped.len(), 2);
        assert_eq!(mapped[0].streaming_path, "native");
        assert!(mapped[0].native_streaming);
        assert_eq!(mapped[0].total_requests, 12);
        assert_eq!(mapped[0].total_failures, 1);
        assert_eq!(mapped[0].total_latency_ms, 450);
        assert_eq!(mapped[0].average_latency_ms, Some(37));
        assert_eq!(mapped[0].last_latency_ms, Some(41));
        assert_eq!(mapped[0].provider_reported_input_tokens, 3_900);
        assert_eq!(mapped[0].provider_reported_output_tokens, 1_100);
        assert_eq!(mapped[0].provider_reported_total_tokens, 5_000);
        assert_eq!(mapped[0].provider_reported_total_cost_microusd, 4_200);
        assert_eq!(
            mapped[0].last_error.as_deref(),
            Some("429 Too Many Requests")
        );
        assert_eq!(mapped[1].streaming_path, "compatibility");
        assert!(!mapped[1].native_streaming);
        assert_eq!(mapped[1].total_requests, 3);
        assert_eq!(mapped[1].total_failures, 0);
        assert_eq!(mapped[1].total_latency_ms, 120);
        assert_eq!(mapped[1].average_latency_ms, Some(40));
        assert_eq!(mapped[1].last_latency_ms, Some(39));

        let totals = aggregate_provider_runtime_status(&mapped);
        assert_eq!(totals.total_requests, 15);
        assert_eq!(totals.total_successes, 14);
        assert_eq!(totals.total_failures, 1);
        assert_eq!(totals.total_latency_ms, 570);
        assert_eq!(totals.average_latency_ms, Some(38));
        assert_eq!(totals.estimated_input_tokens, 5_000);
        assert_eq!(totals.estimated_output_tokens, 2_100);
        assert_eq!(totals.estimated_total_cost_microusd, 5_800);
        assert_eq!(totals.provider_reported_input_tokens, 4_800);
        assert_eq!(totals.provider_reported_output_tokens, 1_900);
        assert_eq!(totals.provider_reported_total_tokens, 6_700);
        assert_eq!(totals.provider_reported_total_cost_microusd, 5_300);
    }

    #[test]
    fn derive_runtime_alerts_flags_premium_selected_model() {
        let alerts = derive_runtime_alerts(
            &[],
            None,
            None,
            0,
            Some(&SelectedModelProfileResponse {
                provider_id: "openai".to_string(),
                provider_name: "OpenAI".to_string(),
                model_id: "gpt-5.2".to_string(),
                model_name: Some("GPT-5.2".to_string()),
                context_window: Some(400_000),
                output_window: Some(128_000),
                cost_tier: Some("premium".to_string()),
                input_cost_per_1m_usd: Some(2.0),
                output_cost_per_1m_usd: Some(8.0),
                supports_tools: true,
                supports_vision: true,
                supports_thinking: true,
            }),
        );

        assert!(alerts
            .iter()
            .any(|alert| alert == "selected_model_cost_tier_premium:openai:gpt-5.2"));
    }

    #[test]
    fn graph_event_mapping_supports_action_progress() {
        let tutor_event = map_graph_event_to_tutor_event(
            ai_tutor_orchestrator::chat_graph::ChatGraphEvent {
                kind: ai_tutor_orchestrator::chat_graph::ChatGraphEventKind::ActionProgress,
                agent_id: Some("teacher-1".to_string()),
                agent_name: Some("Teacher".to_string()),
                action_name: Some("wb_draw_text".to_string()),
                action_params: Some(serde_json::json!({"content":"1/2"})),
                content: None,
                message: Some("in-flight".to_string()),
                director_state: None,
                whiteboard_state: None,
                interruption_reason: None,
                resume_allowed: None,
            },
            "session-test",
            "session-test",
            "stateless_client_state",
        );

        assert!(matches!(tutor_event.kind, TutorEventKind::ActionProgress));
        assert_eq!(tutor_event.action_name.as_deref(), Some("wb_draw_text"));
        assert_eq!(
            tutor_event
                .action_params
                .as_ref()
                .and_then(|params| params.get("schema_version"))
                .and_then(|value| value.as_str()),
            Some("runtime_action_v1")
        );
        assert_eq!(
            tutor_event
                .action_params
                .as_ref()
                .and_then(|params| params.get("action_name"))
                .and_then(|value| value.as_str()),
            Some("wb_draw_text")
        );
    }

    #[test]
    fn runtime_native_streaming_selector_parsing_is_trimmed() {
        let previous = std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS").ok();
        std::env::set_var(
            "AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS",
            " openai:gpt-4o-mini , anthropic ",
        );

        let selectors = runtime_native_streaming_selectors();
        assert_eq!(
            selectors,
            vec!["openai:gpt-4o-mini".to_string(), "anthropic".to_string()]
        );

        if let Some(value) = previous {
            std::env::set_var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS", value);
        } else {
            std::env::remove_var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS");
        }
    }

    #[test]
    fn queue_poll_ms_reads_env_override_with_default_fallback() {
        let previous = std::env::var("AI_TUTOR_QUEUE_POLL_MS").ok();
        std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", "1200");
        assert_eq!(queue_poll_ms(), 1200);
        std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", "0");
        assert_eq!(queue_poll_ms(), 500);
        std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", "invalid");
        assert_eq!(queue_poll_ms(), 500);
        if let Some(value) = previous {
            std::env::set_var("AI_TUTOR_QUEUE_POLL_MS", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_POLL_MS");
        }
    }

    #[tokio::test]
    async fn generate_route_returns_json_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(Some(GenerateLessonResponse {
                lesson_id: "lesson-1".to_string(),
                job_id: "job-1".to_string(),
                url: "http://localhost:8099/lessons/lesson-1".to_string(),
                scenes_count: 2,
            })),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn generate_async_route_returns_accepted_json_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(Some(GenerateLessonResponse {
                lesson_id: "lesson-queued".to_string(),
                job_id: "job-queued".to_string(),
                url: "http://localhost:8099/lessons/lesson-queued".to_string(),
                scenes_count: 0,
            })),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate-async")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn cancel_job_route_returns_cancelled_job() {
        let cancelled_job = LessonGenerationJob {
            status: LessonGenerationJobStatus::Cancelled,
            step: LessonGenerationStep::Cancelled,
            progress: 100,
            message: "Lesson generation cancelled".to_string(),
            ..sample_job()
        };
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(Some(CancelLessonJobOutcome::Cancelled(cancelled_job))),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/cancel")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cancel_job_route_returns_conflict_for_running_job() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(Some(CancelLessonJobOutcome::AlreadyRunning)),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/cancel")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn resume_job_route_returns_accepted_job() {
        let resumed_job = LessonGenerationJob {
            status: LessonGenerationJobStatus::Queued,
            step: LessonGenerationStep::Queued,
            progress: 0,
            message: "Lesson generation re-queued".to_string(),
            ..sample_job()
        };
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(Some(ResumeLessonJobOutcome::Resumed(resumed_job))),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/resume")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn resume_job_route_returns_conflict_for_queued_job() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(Some(ResumeLessonJobOutcome::AlreadyQueuedOrRunning)),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/jobs/job-1/resume")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn job_and_lesson_routes_return_persisted_entities() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: Some(sample_job()),
            lesson: Some(sample_lesson()),
            audio_asset: None,
            media_asset: None,
        }));

        let job_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/jobs/job-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(job_response.status(), StatusCode::OK);

        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn lesson_events_route_streams_sse_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: Some(sample_lesson()),
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1/events")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/event-stream"
        );

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("session_started"));
        assert!(payload.contains("session_completed"));
    }

    #[tokio::test]
    async fn runtime_chat_stream_route_returns_sse_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![
                TutorStreamEvent {
                    kind: TutorEventKind::SessionStarted,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: None,
                    agent_name: None,
                    action_name: None,
                    action_params: None,
                    execution_id: None,
                    ack_policy: None,
                    execution: None,
                    whiteboard_state: None,
                    content: None,
                    message: Some("Starting tutor turn".to_string()),
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::TextDelta,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: None,
                    action_params: None,
                    execution_id: None,
                    ack_policy: None,
                    execution: None,
                    whiteboard_state: None,
                    content: Some("Hello learner".to_string()),
                    message: None,
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::ActionStarted,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: Some("wb_open".to_string()),
                    action_params: Some(serde_json::json!({})),
                    execution_id: Some("session-1:wb_open:{}".to_string()),
                    ack_policy: Some(ActionAckPolicy::AckRequired),
                    execution: action_execution_metadata_for_name("wb_open"),
                    whiteboard_state: None,
                    content: None,
                    message: Some("Starting action wb_open".to_string()),
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::ActionCompleted,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Running),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: Some("wb_open".to_string()),
                    action_params: Some(serde_json::json!({})),
                    execution_id: Some("session-1:wb_open:{}".to_string()),
                    ack_policy: Some(ActionAckPolicy::AckRequired),
                    execution: action_execution_metadata_for_name("wb_open"),
                    whiteboard_state: Some(ai_tutor_runtime::whiteboard::WhiteboardState {
                        id: "session-1".to_string(),
                        is_open: true,
                        objects: vec![],
                        version: 1,
                    }),
                    content: None,
                    message: Some("Completed action wb_open".to_string()),
                    interruption_reason: None,
                    resume_allowed: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::Done,
                    session_id: "session-1".to_string(),
                    runtime_session_id: Some("session-1".to_string()),
                    runtime_session_mode: Some("stateless_client_state".to_string()),
                    turn_status: Some(TutorTurnStatus::Completed),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    action_name: None,
                    action_params: None,
                    execution_id: None,
                    ack_policy: None,
                    execution: None,
                    whiteboard_state: None,
                    content: None,
                    message: Some("Tutor turn complete".to_string()),
                    interruption_reason: None,
                    resume_allowed: Some(false),
                    director_state: Some(DirectorState {
                        turn_count: 1,
                        agent_responses: vec![],
                        whiteboard_ledger: vec![],
                        whiteboard_state: None,
                    }),
                },
            ]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&StatelessChatRequest {
            session_id: None,
            runtime_session: Some(RuntimeSessionSelector {
                mode: RuntimeSessionMode::StatelessClientState,
                session_id: None,
                create_if_missing: None,
            }),
            messages: vec![ChatMessage {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: "Explain fractions".to_string(),
                metadata: None,
            }],
            store_state: ai_tutor_domain::runtime::ClientStageState {
                stage: None,
                scenes: vec![],
                current_scene_id: None,
                mode: ai_tutor_domain::runtime::RuntimeMode::Live,
                whiteboard_open: false,
            },
            config: ai_tutor_domain::runtime::StatelessChatConfig {
                agent_ids: vec!["assistant".to_string()],
                session_type: Some("discussion".to_string()),
                discussion_topic: Some("fractions".to_string()),
                discussion_prompt: None,
                trigger_agent_id: Some("assistant".to_string()),
                agent_configs: vec![],
            },
            director_state: None,
            user_profile: None,
            api_key: "test-key".to_string(),
            base_url: None,
            model: Some("openai:gpt-4o-mini".to_string()),
            provider_type: Some("openai".to_string()),
            requires_api_key: Some(true),
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/chat/stream")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/event-stream"
        );

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("text_delta"));
        assert!(payload.contains("action_started"));
        assert!(payload.contains("action_completed"));
        assert!(payload.contains("wb_open"));
        assert!(payload.contains("\"whiteboard_state\""));
        assert!(payload.contains("\"is_open\":true"));
        assert!(payload.contains("done"));
    }

    #[tokio::test]
    async fn runtime_action_ack_route_records_acknowledgements() {
        let service = Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        });
        let app = build_router(service.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/actions/ack")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "session_id": "session-ack",
                            "runtime_session_mode": "stateless_client_state",
                            "execution_id": "session-ack:wb_open:{}",
                            "action_name": "wb_open",
                            "status": "completed",
                            "error": null
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let recorded = service.action_acks.lock().unwrap().clone();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].execution_id, "session-ack:wb_open:{}");
        assert_eq!(recorded[0].status, "completed");
    }

    #[tokio::test]
    async fn live_service_runtime_action_acknowledgements_are_persisted_and_deduped() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );
        let event = TutorStreamEvent {
            kind: TutorEventKind::ActionStarted,
            session_id: "session-ack-persist".to_string(),
            runtime_session_id: Some("session-ack-persist".to_string()),
            runtime_session_mode: Some("stateless_client_state".to_string()),
            turn_status: Some(TutorTurnStatus::Running),
            agent_id: Some("teacher-1".to_string()),
            agent_name: Some("Ms. Rivera".to_string()),
            action_name: Some("wb_open".to_string()),
            action_params: Some(serde_json::json!({})),
            execution_id: Some("session-ack-persist:wb_open:{}".to_string()),
            ack_policy: Some(ActionAckPolicy::AckRequired),
            execution: action_execution_metadata_for_name("wb_open"),
            whiteboard_state: None,
            content: None,
            message: Some("Starting action wb_open".to_string()),
            interruption_reason: None,
            resume_allowed: None,
            director_state: None,
        };
        service.record_runtime_action_expectation(&event).await.unwrap();
        let execution_id = event
            .execution_id
            .clone()
            .expect("action expectation should include execution id");

        let persisted = storage
            .get_runtime_action_execution(&execution_id)
            .await
            .unwrap()
            .expect("execution record should be persisted");
        assert_eq!(persisted.status, RuntimeActionExecutionStatus::Pending);

        let accepted = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: persisted.session_id.clone(),
                runtime_session_id: Some(persisted.session_id.clone()),
                runtime_session_mode: Some(persisted.runtime_session_mode.clone()),
                execution_id: execution_id.clone(),
                action_name: Some(persisted.action_name.clone()),
                status: "accepted".to_string(),
                error: None,
            })
            .await
            .unwrap();
        assert!(accepted.accepted);
        assert!(!accepted.duplicate);
        assert_eq!(accepted.current_status, "accepted");

        let completed = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: persisted.session_id.clone(),
                runtime_session_id: Some(persisted.session_id.clone()),
                runtime_session_mode: Some(persisted.runtime_session_mode.clone()),
                execution_id: execution_id.clone(),
                action_name: Some(persisted.action_name.clone()),
                status: "completed".to_string(),
                error: None,
            })
            .await
            .unwrap();
        assert!(completed.accepted);
        assert!(!completed.duplicate);
        assert_eq!(completed.current_status, "completed");

        let duplicate = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: persisted.session_id.clone(),
                runtime_session_id: Some(persisted.session_id.clone()),
                runtime_session_mode: Some(persisted.runtime_session_mode.clone()),
                execution_id: execution_id.clone(),
                action_name: Some(persisted.action_name.clone()),
                status: "completed".to_string(),
                error: None,
            })
            .await
            .unwrap();
        assert!(!duplicate.accepted);
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.current_status, "completed");

        let final_record = storage
            .get_runtime_action_execution(&execution_id)
            .await
            .unwrap()
            .expect("execution record should still exist");
        assert_eq!(final_record.status, RuntimeActionExecutionStatus::Completed);
    }

    #[tokio::test]
    async fn live_service_managed_runtime_action_expectations_use_runtime_session_id() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );
        let event = TutorStreamEvent {
            kind: TutorEventKind::ActionStarted,
            session_id: "transport-session".to_string(),
            runtime_session_id: Some("managed-runtime-session".to_string()),
            runtime_session_mode: Some("managed_runtime_session".to_string()),
            turn_status: Some(TutorTurnStatus::Running),
            agent_id: Some("teacher-1".to_string()),
            agent_name: Some("Ms. Rivera".to_string()),
            action_name: Some("wb_open".to_string()),
            action_params: Some(serde_json::json!({})),
            execution_id: Some("transport-session:wb_open:{}".to_string()),
            ack_policy: Some(ActionAckPolicy::AckRequired),
            execution: action_execution_metadata_for_name("wb_open"),
            whiteboard_state: None,
            content: None,
            message: Some("Starting action wb_open".to_string()),
            interruption_reason: None,
            resume_allowed: None,
            director_state: None,
        };

        service.record_runtime_action_expectation(&event).await.unwrap();

        let persisted = storage
            .get_runtime_action_execution("transport-session:wb_open:{}")
            .await
            .unwrap()
            .expect("managed execution record should be persisted");
        assert_eq!(persisted.session_id, "managed-runtime-session");

        let managed_records = storage
            .list_runtime_action_executions_for_session("managed-runtime-session")
            .await
            .unwrap();
        assert_eq!(managed_records.len(), 1);

        let transport_records = storage
            .list_runtime_action_executions_for_session("transport-session")
            .await
            .unwrap();
        assert!(transport_records.is_empty());
    }

    #[tokio::test]
    async fn live_service_rejects_managed_runtime_resume_with_unresolved_action_execution() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );

        storage
            .save_runtime_session("managed-runtime-session", &empty_director_state())
            .await
            .unwrap();
        storage
            .save_runtime_action_execution(&RuntimeActionExecutionRecord {
                session_id: "managed-runtime-session".to_string(),
                runtime_session_mode: "managed_runtime_session".to_string(),
                execution_id: "managed-runtime-session:wb_open:{}".to_string(),
                action_name: "wb_open".to_string(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: 10,
                updated_at_unix_ms: 10,
                timeout_at_unix_ms: i64::MAX,
                last_error: None,
            })
            .await
            .unwrap();

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-runtime-session".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = None;

        let error = service
            .run_stateless_chat_graph(payload, "transport-session", None, None)
            .await
            .expect_err("resume should be blocked while unresolved actions remain");
        let message = format!("{error:#}");
        assert!(message.contains("unresolved action executions"));
        assert!(message.contains("wb_open"));
    }

    #[tokio::test]
    async fn live_service_runtime_action_ack_rejects_runtime_session_mismatch() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response_concrete(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );

        storage
            .save_runtime_action_execution(&RuntimeActionExecutionRecord {
                session_id: "managed-runtime-session".to_string(),
                runtime_session_mode: "managed_runtime_session".to_string(),
                execution_id: "managed-runtime-session:wb_open:{}".to_string(),
                action_name: "wb_open".to_string(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: 10,
                updated_at_unix_ms: 10,
                timeout_at_unix_ms: i64::MAX,
                last_error: None,
            })
            .await
            .unwrap();

        let error = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: "transport-session".to_string(),
                runtime_session_id: Some("other-runtime-session".to_string()),
                runtime_session_mode: Some("managed_runtime_session".to_string()),
                execution_id: "managed-runtime-session:wb_open:{}".to_string(),
                action_name: Some("wb_open".to_string()),
                status: "accepted".to_string(),
                error: None,
            })
            .await
            .expect_err("mismatched runtime session should be rejected");
        assert!(format!("{error:#}").contains("session mismatch"));
    }

    #[tokio::test]
    async fn live_service_runtime_action_acknowledgements_time_out_before_replay() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let service = build_live_chat_service_with_response(
            Arc::clone(&storage),
            vec![r#"[{"type":"text","content":"No-op response."}]"#.to_string()],
        );

        let record = RuntimeActionExecutionRecord {
            session_id: "session-timeout".to_string(),
            runtime_session_mode: "stateless_client_state".to_string(),
            execution_id: "session-timeout:wb_open:{}".to_string(),
            action_name: "wb_open".to_string(),
            status: RuntimeActionExecutionStatus::Pending,
            created_at_unix_ms: 10,
            updated_at_unix_ms: 10,
            timeout_at_unix_ms: 11,
            last_error: None,
        };
        storage.save_runtime_action_execution(&record).await.unwrap();

        let response = service
            .acknowledge_runtime_action(RuntimeActionAckRequest {
                session_id: record.session_id.clone(),
                runtime_session_id: Some(record.session_id.clone()),
                runtime_session_mode: Some(record.runtime_session_mode.clone()),
                execution_id: record.execution_id.clone(),
                action_name: Some(record.action_name.clone()),
                status: "completed".to_string(),
                error: None,
            })
            .await
            .unwrap();

        assert!(!response.accepted);
        assert!(response.duplicate);
        assert_eq!(response.current_status, "timed_out");

        let persisted = storage
            .get_runtime_action_execution(&record.execution_id)
            .await
            .unwrap()
            .expect("timed out record should still exist");
        assert_eq!(persisted.status, RuntimeActionExecutionStatus::TimedOut);
    }

    #[tokio::test]
    async fn runtime_chat_stream_route_rejects_missing_runtime_session_contract() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = None;

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/chat/stream")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("runtime_session"));
    }

    #[tokio::test]
    async fn runtime_chat_stream_route_rejects_ambiguous_managed_session_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let mut payload = sample_stateless_chat_request();
        payload.runtime_session = Some(RuntimeSessionSelector {
            mode: RuntimeSessionMode::ManagedRuntimeSession,
            session_id: Some("managed-ambiguous".to_string()),
            create_if_missing: Some(false),
        });
        payload.director_state = Some(empty_director_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/runtime/chat/stream")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let payload = String::from_utf8(body.to_vec()).unwrap();
        assert!(payload.contains("managed_runtime_session"));
        assert!(payload.contains("director_state"));
    }

    #[tokio::test]
    async fn live_service_stateless_chat_stream_aborts_on_downstream_disconnect() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let started = Arc::new(Notify::new());
        let cancelled = Arc::new(Notify::new());
        let started_wait = started.notified();
        let cancelled_wait = cancelled.notified();
        let service = build_live_chat_service_with_blocking_cancellable_provider(
            Arc::clone(&storage),
            Arc::clone(&started),
            Arc::clone(&cancelled),
        );

        let (sender, mut receiver) = mpsc::channel::<TutorStreamEvent>(8);
        let payload = sample_stateless_chat_request();
        let service_clone = Arc::clone(&service);
        let stream_task =
            tokio::spawn(async move { service_clone.stateless_chat_stream(payload, sender).await });

        let first_event =
            tokio::time::timeout(std::time::Duration::from_millis(150), receiver.recv())
                .await
                .expect("stream should send first event quickly")
                .expect("first event should exist");
        assert!(matches!(first_event.kind, TutorEventKind::SessionStarted));

        started_wait.await;
        drop(receiver);
        cancelled_wait.await;

        let completed = tokio::time::timeout(std::time::Duration::from_millis(250), stream_task)
            .await
            .expect("stream task should stop quickly after disconnect");
        let stream_result = completed.expect("stream task should join");
        assert!(
            stream_result.is_ok(),
            "stream should exit cleanly after disconnect"
        );
    }

    #[tokio::test]
    async fn audio_asset_route_returns_binary_audio() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: Some(vec![1, 2, 3, 4]),
            media_asset: None,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/audio/lesson-1/tts_action-1.mp3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "audio/mpeg"
        );
    }

    #[tokio::test]
    async fn media_asset_route_returns_binary_media() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: Some(vec![1, 2, 3, 4]),
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/media/lesson-1/image_image-1.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "image/png"
        );
    }

    #[tokio::test]
    async fn live_service_reads_persisted_lesson_and_job_from_file_storage() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let lesson = sample_lesson();
        let job = sample_job();

        storage.save_lesson(&lesson).await.unwrap();
        storage.create_job(&job).await.unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));

        let job_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/jobs/job-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(job_response.status(), StatusCode::OK);

        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn live_service_reads_persisted_lesson_from_sqlite_storage() {
        let root = temp_root();
        let lesson_db_path = root.join("runtime").join("lessons.db");
        let storage = Arc::new(FileStorage::with_lesson_db(&root, &lesson_db_path));
        let lesson = sample_lesson();

        storage.save_lesson(&lesson).await.unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));
        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/lesson-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
        assert!(lesson_db_path.exists());
    }

    #[tokio::test]
    async fn live_service_reads_persisted_audio_and_media_assets_from_file_storage() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let audio_dir = storage.assets_dir().join("audio").join("lesson-1");
        let media_dir = storage.assets_dir().join("media").join("lesson-1");
        std::fs::create_dir_all(&audio_dir).unwrap();
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(audio_dir.join("tts_action-1.mp3"), [1_u8, 2, 3, 4]).unwrap();
        std::fs::write(media_dir.join("image_image-1.png"), [5_u8, 6, 7, 8]).unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));

        let audio_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/assets/audio/lesson-1/tts_action-1.mp3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(audio_response.status(), StatusCode::OK);
        assert_eq!(
            audio_response.headers().get(header::CONTENT_TYPE).unwrap(),
            "audio/mpeg"
        );

        let media_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/media/lesson-1/image_image-1.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(media_response.status(), StatusCode::OK);
        assert_eq!(
            media_response.headers().get(header::CONTENT_TYPE).unwrap(),
            "image/png"
        );
    }

    #[tokio::test]
    async fn live_service_generates_and_persists_lesson_via_api_route() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let app = build_router(build_live_service_with_fakes(Arc::clone(&storage)));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(true),
            enable_video_generation: Some(false),
            enable_tts: Some(true),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();

        let generate_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(generate_response.status(), StatusCode::OK);

        let body = to_bytes(generate_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let generated: GenerateLessonResponse = serde_json::from_slice(&body).unwrap();
        assert!(generated.scenes_count >= 2);

        let lesson_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/lessons/{}", generated.lesson_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);

        let job_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/lessons/jobs/{}", generated.job_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(job_response.status(), StatusCode::OK);

        let lesson_bytes = to_bytes(lesson_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let lesson: Lesson = serde_json::from_slice(&lesson_bytes).unwrap();
        let speech_action = lesson
            .scenes
            .iter()
            .flat_map(|scene| scene.actions.iter())
            .find_map(|action| match action {
                ai_tutor_domain::action::LessonAction::Speech { audio_url, .. } => {
                    audio_url.clone()
                }
                _ => None,
            })
            .unwrap();
        assert!(speech_action.contains("/api/assets/audio/"));

        let image_src = lesson
            .scenes
            .iter()
            .find_map(|scene| match &scene.content {
                ai_tutor_domain::scene::SceneContent::Slide { canvas } => {
                    canvas.elements.iter().find_map(|element| match element {
                        ai_tutor_domain::scene::SlideElement::Image { src, .. } => {
                            Some(src.clone())
                        }
                        _ => None,
                    })
                }
                _ => None,
            })
            .unwrap();
        assert!(image_src.contains("/api/assets/media/"));
    }

    #[tokio::test]
    async fn live_service_generates_and_persists_lesson_via_async_api_route() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let app = build_router(build_live_service_with_fakes(Arc::clone(&storage)));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(true),
            enable_video_generation: Some(false),
            enable_tts: Some(true),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();

        let generate_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate-async")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(generate_response.status(), StatusCode::ACCEPTED);

        let body = to_bytes(generate_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let generated: GenerateLessonResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(generated.scenes_count, 0);

        let mut completed_job: Option<LessonGenerationJob> = None;
        for _ in 0..20 {
            let job_response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/api/lessons/jobs/{}", generated.job_id))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(job_response.status(), StatusCode::OK);
            let job_bytes = to_bytes(job_response.into_body(), usize::MAX)
                .await
                .unwrap();
            let job: LessonGenerationJob = serde_json::from_slice(&job_bytes).unwrap();
            if matches!(job.status, LessonGenerationJobStatus::Succeeded) {
                completed_job = Some(job);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        let completed_job = completed_job.expect("async job should complete");
        assert!(completed_job.result.is_some());

        let lesson_response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/lessons/{}", generated.lesson_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lesson_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn generate_route_returns_internal_error_for_invalid_payload() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&GenerateLessonPayload {
            requirement: "   ".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/lessons/generate")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn missing_asset_routes_return_not_found() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            cancel_outcome: Mutex::new(None),
            resume_outcome: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            action_acks: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let audio_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/assets/audio/lesson-1/missing.mp3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(audio_response.status(), StatusCode::NOT_FOUND);

        let media_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/assets/media/lesson-1/missing.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(media_response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn live_service_marks_stale_job_failed_through_api_route() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let stale_time = Utc::now() - ChronoDuration::minutes(31);
        let request = LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
                web_search: Some(false),
            },
            pdf_content: None,
            enable_web_search: false,
            enable_image_generation: false,
            enable_video_generation: false,
            enable_tts: false,
            agent_mode: AgentMode::Default,
        };
        let job = LessonGenerationJob {
            id: "job-stale".to_string(),
            status: LessonGenerationJobStatus::Running,
            step: LessonGenerationStep::GeneratingScenes,
            progress: 60,
            message: "still running".to_string(),
            input_summary: LessonGenerationJobInputSummary::from(&request),
            scenes_generated: 1,
            total_scenes: Some(3),
            result: None,
            error: None,
            created_at: stale_time,
            updated_at: stale_time,
            started_at: Some(stale_time),
            completed_at: None,
        };
        storage.create_job(&job).await.unwrap();

        let app = build_router(build_live_service(Arc::clone(&storage)));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/lessons/jobs/job-stale")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let persisted: LessonGenerationJob = serde_json::from_slice(&body).unwrap();
        assert!(matches!(
            persisted.status,
            LessonGenerationJobStatus::Failed
        ));
        assert!(matches!(persisted.step, LessonGenerationStep::Failed));
        assert!(persisted
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("Stale job"));
    }

    #[tokio::test]
    async fn live_service_cancels_queued_async_job_and_persists_cancelled_state() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        let service = build_live_service_with_fakes(Arc::clone(&storage));
        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: None,
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();
        let job = build_queued_job("job-cancel-live".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        FileBackedLessonQueue::new(Arc::clone(&storage))
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-cancel-live".to_string(),
                job: job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();

        let outcome = service.cancel_job(&job.id).await.unwrap();
        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }
        let CancelLessonJobOutcome::Cancelled(cancelled_job) = outcome else {
            panic!("expected cancelled outcome");
        };
        assert!(matches!(
            cancelled_job.status,
            LessonGenerationJobStatus::Cancelled
        ));

        let persisted = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(
            persisted.status,
            LessonGenerationJobStatus::Cancelled
        ));
        assert!(matches!(persisted.step, LessonGenerationStep::Cancelled));
    }

    #[tokio::test]
    async fn live_service_resumes_cancelled_job_and_requeues_request_snapshot() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let previous_queue_db = std::env::var("AI_TUTOR_QUEUE_DB_PATH").ok();
        std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        let service = build_live_service_with_delayed_fakes(Arc::clone(&storage), 250);

        let request = build_generation_request(GenerateLessonPayload {
            requirement: "Teach fractions".to_string(),
            language: Some("en-US".to_string()),
            model: Some("openai:gpt-4o-mini".to_string()),
            pdf_text: None,
            enable_web_search: Some(false),
            enable_image_generation: Some(false),
            enable_video_generation: Some(false),
            enable_tts: Some(false),
            agent_mode: Some("default".to_string()),
            user_nickname: None,
            user_bio: None,
        })
        .unwrap();
        let now = chrono::Utc::now();
        let job = LessonGenerationJob {
            id: "job-resume-live".to_string(),
            status: LessonGenerationJobStatus::Cancelled,
            step: LessonGenerationStep::Cancelled,
            progress: 100,
            message: "Lesson generation cancelled".to_string(),
            input_summary: LessonGenerationJobInputSummary::from(&request),
            scenes_generated: 0,
            total_scenes: None,
            result: None,
            error: None,
            created_at: now,
            updated_at: now,
            started_at: None,
            completed_at: Some(now),
        };
        storage.create_job(&job).await.unwrap();
        storage
            .save_queued_job_snapshot(
                &job.id,
                &QueuedLessonJobSnapshot {
                    lesson_id: "lesson-resume-live".to_string(),
                    request,
                    model_string: Some("openai:gpt-4o-mini".to_string()),
                    max_attempts: 3,
                },
            )
            .await
            .unwrap();

        let outcome = service.resume_job(&job.id).await.unwrap();
        if let Some(value) = previous_queue_db {
            std::env::set_var("AI_TUTOR_QUEUE_DB_PATH", value);
        } else {
            std::env::remove_var("AI_TUTOR_QUEUE_DB_PATH");
        }

        let ResumeLessonJobOutcome::Resumed(resumed_job) = outcome else {
            panic!("expected resumed outcome");
        };
        assert!(matches!(
            resumed_job.status,
            LessonGenerationJobStatus::Queued
        ));
        assert!(matches!(resumed_job.step, LessonGenerationStep::Queued));

        let queued_path = storage
            .root_dir()
            .join("lesson-queue")
            .join(format!("{}.json", job.id));
        let working_path = storage
            .root_dir()
            .join("lesson-queue")
            .join(format!("{}.json.working", job.id));
        assert!(queued_path.exists() || working_path.exists());
    }
}
