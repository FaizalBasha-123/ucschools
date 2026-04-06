use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    http::StatusCode,
    response::{IntoResponse, Response},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::error;
use uuid::Uuid;

use ai_tutor_domain::{
    generation::{AgentMode, Language, LessonGenerationRequest, PdfContent, UserRequirements},
    job::LessonGenerationJob,
    lesson::Lesson,
    runtime::{
        AgentTurnSummary, DirectorState, StatelessChatRequest,
        WhiteboardActionRecord,
    },
};
use ai_tutor_orchestrator::{
    generation::LlmGenerationPipeline, pipeline::{build_queued_job, LessonGenerationOrchestrator},
};
use ai_tutor_providers::{
    config::ServerProviderConfig,
    resolve::resolve_model,
    traits::{ImageProviderFactory, LlmProviderFactory, TtsProviderFactory, VideoProviderFactory},
};
use ai_tutor_runtime::session::{
    lesson_playback_events, PlaybackEvent, TutorEventKind, TutorStreamEvent,
};
use ai_tutor_storage::{
    filesystem::FileStorage,
    repositories::{LessonJobRepository, LessonRepository},
};
use crate::queue::{spawn_one_shot_queue_kick, FileBackedLessonQueue, QueuedLessonRequest};

#[derive(Clone)]
pub struct AppState {
    pub service: Arc<dyn LessonAppService>,
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
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[async_trait]
pub trait LessonAppService: Send + Sync {
    async fn generate_lesson(&self, payload: GenerateLessonPayload) -> Result<GenerateLessonResponse>;
    async fn queue_lesson(&self, payload: GenerateLessonPayload) -> Result<GenerateLessonResponse>;
    async fn stateless_chat(&self, payload: StatelessChatRequest) -> Result<Vec<TutorStreamEvent>>;
    async fn get_job(&self, id: &str) -> Result<Option<LessonGenerationJob>>;
    async fn get_lesson(&self, id: &str) -> Result<Option<Lesson>>;
    async fn get_audio_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>>;
    async fn get_media_asset(&self, lesson_id: &str, file_name: &str) -> Result<Option<Vec<u8>>>;
}

pub struct LiveLessonAppService {
    storage: Arc<FileStorage>,
    provider_config: Arc<ServerProviderConfig>,
    provider_factory: Arc<dyn LlmProviderFactory>,
    image_provider_factory: Arc<dyn ImageProviderFactory>,
    video_provider_factory: Arc<dyn VideoProviderFactory>,
    tts_provider_factory: Arc<dyn TtsProviderFactory>,
    base_url: String,
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
        }
    }

    pub(crate) fn build_orchestrator(
        &self,
        request: &LessonGenerationRequest,
        model_string: Option<&str>,
    ) -> Result<LessonGenerationOrchestrator<LlmGenerationPipeline, FileStorage, FileStorage>> {
        let resolved = resolve_model(
            &self.provider_config,
            model_string,
            None,
            None,
            None,
            None,
        )?;

        let llm = self.provider_factory.build(resolved.model_config)?;
        let pipeline = Arc::new(LlmGenerationPipeline::new(llm));
        let mut orchestrator = LessonGenerationOrchestrator::new(
            pipeline,
            Arc::clone(&self.storage),
            Arc::clone(&self.storage),
        )
        .with_asset_storage(self.storage.root_dir(), &self.base_url);

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

    pub(crate) fn base_url(&self) -> &str {
        &self.base_url
    }
}

#[async_trait]
impl LessonAppService for LiveLessonAppService {
    async fn generate_lesson(&self, payload: GenerateLessonPayload) -> Result<GenerateLessonResponse> {
        let model_string = payload
            .model
            .clone()
            .or_else(|| std::env::var("AI_TUTOR_MODEL").ok());
        let request = build_generation_request(payload)?;
        let orchestrator = self.build_orchestrator(&request, model_string.as_deref())?;

        let output = orchestrator.generate_lesson(request, &self.base_url).await?;
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
        let job = build_queued_job(Uuid::new_v4().to_string(), &request, chrono::Utc::now());
        self.storage
            .create_job(&job)
            .await
            .map_err(|err| anyhow!(err))?;
        let queue = Arc::new(FileBackedLessonQueue::new(Arc::clone(&self.storage)));
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: lesson_id.clone(),
                job: job.clone(),
                request,
                model_string: model_string.clone(),
                attempt: 0,
                max_attempts: 3,
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await?;
        let service = Arc::new(LiveLessonAppService::new(
            Arc::clone(&self.storage),
            Arc::clone(&self.provider_config),
            Arc::clone(&self.provider_factory),
            Arc::clone(&self.image_provider_factory),
            Arc::clone(&self.video_provider_factory),
            Arc::clone(&self.tts_provider_factory),
            self.base_url.clone(),
        ));
        spawn_one_shot_queue_kick(queue, service);

        Ok(GenerateLessonResponse {
            lesson_id: lesson_id.clone(),
            job_id: job.id,
            url: format!("{}/lessons/{}", self.base_url.trim_end_matches('/'), lesson_id),
            scenes_count: 0,
        })
    }

    async fn stateless_chat(&self, payload: StatelessChatRequest) -> Result<Vec<TutorStreamEvent>> {
        let session_id = Uuid::new_v4().to_string();
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
        let llm = self.provider_factory.build(resolved.model_config)?;

        let mut events = vec![
            TutorStreamEvent {
                kind: TutorEventKind::SessionStarted,
                session_id: session_id.clone(),
                agent_id: None,
                agent_name: None,
                content: None,
                message: Some("Starting stateless tutor session".to_string()),
                director_state: None,
            },
        ];
        let user_message = latest_user_message(&payload);
        let mut working_payload = payload.clone();
        let mut director_state = payload.director_state.clone().unwrap_or(DirectorState {
            turn_count: 0,
            agent_responses: vec![],
            whiteboard_ledger: vec![],
        });
        let max_turns = max_agent_turns_for_request(&working_payload);
        let mut turns_completed = 0;

        for _ in 0..max_turns {
            working_payload.director_state = Some(director_state.clone());
            let selected_agent = resolve_selected_agent(&working_payload);
            let system_prompt = build_stateless_chat_system_prompt(&working_payload, &selected_agent);
            let user_prompt = build_stateless_chat_user_prompt(&working_payload, &user_message);
            let generated = llm.generate_text(&system_prompt, &user_prompt).await?;
            let chunks = chunk_text(&generated, 140);
            director_state = update_director_state(&working_payload, &selected_agent, &generated);
            turns_completed += 1;

            events.push(TutorStreamEvent {
                kind: TutorEventKind::AgentSelected,
                session_id: session_id.clone(),
                agent_id: Some(selected_agent.id.clone()),
                agent_name: Some(selected_agent.name.clone()),
                content: None,
                message: Some(selected_agent.reason.clone()),
                director_state: None,
            });

            for chunk in chunks {
                events.push(TutorStreamEvent {
                    kind: TutorEventKind::TextDelta,
                    session_id: session_id.clone(),
                    agent_id: Some(selected_agent.id.clone()),
                    agent_name: Some(selected_agent.name.clone()),
                    content: Some(chunk),
                    message: None,
                    director_state: None,
                });
            }

            let outcome =
                next_stateless_session_outcome(&working_payload, &director_state, max_turns);
            if matches!(outcome, StatelessSessionOutcome::CueUser) {
                events.push(TutorStreamEvent {
                    kind: TutorEventKind::CueUser,
                    session_id: session_id.clone(),
                    agent_id: Some(selected_agent.id.clone()),
                    agent_name: Some(selected_agent.name.clone()),
                    content: None,
                    message: Some(build_cue_user_prompt(&working_payload, &selected_agent)),
                    director_state: None,
                });
            }

            if !matches!(outcome, StatelessSessionOutcome::Continue) {
                break;
            }
        }

        events.push(TutorStreamEvent {
            kind: TutorEventKind::Done,
            session_id,
            agent_id: director_state
                .agent_responses
                .last()
                .map(|summary| summary.agent_id.clone()),
            agent_name: director_state
                .agent_responses
                .last()
                .map(|summary| summary.agent_name.clone()),
            content: None,
            message: Some(format!("Tutor session complete after {} turn(s)", turns_completed)),
            director_state: Some(director_state),
        });

        Ok(events)
    }

    async fn get_job(&self, id: &str) -> Result<Option<LessonGenerationJob>> {
        self.storage.get_job(id).await.map_err(|err| anyhow!(err))
    }

    async fn get_lesson(&self, id: &str) -> Result<Option<Lesson>> {
        self.storage.get_lesson(id).await.map_err(|err| anyhow!(err))
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
}

pub fn build_router(service: Arc<dyn LessonAppService>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/health", get(health))
        .route("/api/lessons/generate", post(generate_lesson))
        .route("/api/lessons/generate-async", post(generate_lesson_async))
        .route("/api/runtime/chat/stream", post(stream_stateless_chat))
        .route("/api/lessons/jobs/{id}", get(get_job))
        .route("/api/lessons/{id}", get(get_lesson))
        .route("/api/lessons/{id}/events", get(stream_lesson_events))
        .route("/api/assets/media/{lesson_id}/{file_name}", get(get_media_asset))
        .route("/api/assets/audio/{lesson_id}/{file_name}", get(get_audio_asset))
        .with_state(AppState { service })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
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

async fn stream_stateless_chat(
    State(state): State<AppState>,
    Json(payload): Json<StatelessChatRequest>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let tutor_events = state
        .service
        .stateless_chat(payload)
        .await
        .map_err(ApiError::internal)?;

    let (sender, receiver) = mpsc::channel::<Result<Event, Infallible>>(16);
    tokio::spawn(async move {
        for tutor_event in tutor_events {
            let event = build_tutor_sse_event(&tutor_event);
            if sender.send(Ok(event)).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    });

    Ok(Sse::new(ReceiverStream::new(receiver)).keep_alive(KeepAlive::default()))
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
        .header(header::CONTENT_TYPE, media_content_type_for_file(&file_name))
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
        .unwrap_or_else(|_| Event::default().event("serialization_error").data(playback_event.summary.clone()))
}

fn build_tutor_sse_event(tutor_event: &TutorStreamEvent) -> Event {
    let event_name = match tutor_event.kind {
        TutorEventKind::SessionStarted => "session_started",
        TutorEventKind::AgentSelected => "agent_selected",
        TutorEventKind::TextDelta => "text_delta",
        TutorEventKind::CueUser => "cue_user",
        TutorEventKind::Done => "done",
        TutorEventKind::Error => "error",
    };

    Event::default()
        .event(event_name)
        .json_data(tutor_event)
        .unwrap_or_else(|_| {
            Event::default()
                .event("serialization_error")
                .data(tutor_event.message.clone().unwrap_or_else(|| "serialization error".to_string()))
        })
}

fn parse_provider_type(value: &str) -> Option<ai_tutor_domain::provider::ProviderType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "openai" => Some(ai_tutor_domain::provider::ProviderType::OpenAi),
        "anthropic" => Some(ai_tutor_domain::provider::ProviderType::Anthropic),
        "google" => Some(ai_tutor_domain::provider::ProviderType::Google),
        _ => None,
    }
}

#[derive(Debug, Clone)]
struct SelectedAgent {
    id: String,
    name: String,
    role: String,
    persona: String,
    reason: String,
}

#[derive(Debug, Clone)]
struct CandidateAgent {
    id: String,
    name: String,
    role: String,
    persona: String,
    priority: i32,
    bound_stage_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatelessSessionOutcome {
    Continue,
    CueUser,
    End,
}

fn resolve_selected_agent(payload: &StatelessChatRequest) -> SelectedAgent {
    let candidates = collect_candidate_agents(payload);
    if candidates.is_empty() {
        return SelectedAgent {
            id: "assistant".to_string(),
            name: "AI Tutor".to_string(),
            role: "teacher".to_string(),
            persona: "Supportive classroom tutor".to_string(),
            reason: "No configured agents were available, so the default tutor handled the turn."
                .to_string(),
        };
    }

    let prior_turn_count = payload
        .director_state
        .as_ref()
        .map(|state| state.turn_count)
        .unwrap_or(0);
    if prior_turn_count == 0 {
        if let Some(trigger_id) = payload.config.trigger_agent_id.as_ref() {
            if let Some(agent) = candidates.iter().find(|agent| &agent.id == trigger_id) {
                return SelectedAgent {
                    id: agent.id.clone(),
                    name: agent.name.clone(),
                    role: agent.role.clone(),
                    persona: agent.persona.clone(),
                    reason: format!(
                        "Director routed the opening turn to {} because it is the configured trigger agent.",
                        agent.name
                    ),
                };
            }
        }
    }

    let last_agent_id = payload
        .director_state
        .as_ref()
        .and_then(|state| state.agent_responses.last())
        .map(|summary| summary.agent_id.clone());
    let last_agent_role = payload
        .director_state
        .as_ref()
        .and_then(|state| state.agent_responses.last())
        .map(|summary| resolve_agent_role(payload, &summary.agent_id));
    let current_stage_id = resolve_current_stage_id(payload);

    let mut filtered = candidates.clone();
    if filtered.len() > 1 {
        if let Some(last_id) = last_agent_id.as_ref() {
            filtered.retain(|agent| &agent.id != last_id);
        }
    }

    let discussion_hint = payload
        .config
        .discussion_prompt
        .as_deref()
        .or(payload.config.discussion_topic.as_deref())
        .unwrap_or_default();
    let latest_user_message = payload
        .messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.as_str())
        .unwrap_or_default();

    let mut scored = filtered
        .iter()
        .map(|agent| {
            let mut score = 0_i32;
            let mut reasons = Vec::new();

            if let Some(stage_id) = current_stage_id.as_ref() {
                if agent.bound_stage_id.as_ref() == Some(stage_id) {
                    score += 40;
                    reasons.push("it is bound to the active stage".to_string());
                }
            }

            match last_agent_role.as_deref() {
                Some("teacher") => {
                    if agent.role.eq_ignore_ascii_case("student") {
                        score += 30;
                        reasons.push("it adds role diversity after a teacher turn".to_string());
                    } else if agent.role.eq_ignore_ascii_case("assistant") {
                        score += 18;
                        reasons.push("it can clarify without repeating another teacher turn".to_string());
                    }
                }
                Some("student") => {
                    if agent.role.eq_ignore_ascii_case("teacher") {
                        score += 28;
                        reasons.push("it can guide the lesson after a student response".to_string());
                    } else if agent.role.eq_ignore_ascii_case("assistant") {
                        score += 18;
                        reasons.push("it can support the student with a clarification".to_string());
                    }
                }
                Some("assistant") => {
                    if agent.role.eq_ignore_ascii_case("student") {
                        score += 24;
                        reasons.push("it keeps the discussion varied after an assistant turn".to_string());
                    } else if agent.role.eq_ignore_ascii_case("teacher") {
                        score += 22;
                        reasons.push("it can take over after an assistant clarification".to_string());
                    }
                }
                _ => {
                    if agent.role.eq_ignore_ascii_case("teacher") {
                        score += 24;
                        reasons.push("teacher is a strong default role for a fresh tutor turn".to_string());
                    } else if agent.role.eq_ignore_ascii_case("assistant") {
                        score += 16;
                    }
                }
            }

            let keyword_score = score_agent_relevance(agent, discussion_hint, latest_user_message);
            if keyword_score > 0 {
                score += keyword_score;
                reasons.push("its role or persona matches the current topic".to_string());
            }

            let normalized_priority = agent.priority.max(0);
            score += 20 - normalized_priority.min(20);
            reasons.push(format!("its priority {} supports earlier routing", agent.priority));

            (score, reasons, agent.clone())
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.2.priority.cmp(&right.2.priority))
            .then_with(|| left.2.name.cmp(&right.2.name))
    });

    let (_, reasons, winner) = scored
        .into_iter()
        .next()
        .expect("at least one candidate agent should remain");
    let winner_name = winner.name.clone();

    SelectedAgent {
        id: winner.id,
        name: winner.name,
        role: winner.role,
        persona: winner.persona,
        reason: format!(
            "Director selected {} because {}.",
            winner_name,
            reasons.join(", ")
        ),
    }
}

fn collect_candidate_agents(payload: &StatelessChatRequest) -> Vec<CandidateAgent> {
    if !payload.config.agent_configs.is_empty() {
        return payload
            .config
            .agent_configs
            .iter()
            .map(|agent| CandidateAgent {
                id: agent.id.clone(),
                name: agent.name.clone(),
                role: agent.role.clone(),
                persona: agent.persona.clone(),
                priority: agent.priority,
                bound_stage_id: agent.bound_stage_id.clone(),
            })
            .collect();
    }

    if !payload.config.agent_ids.is_empty() {
        return payload
            .config
            .agent_ids
            .iter()
            .map(|agent_id| CandidateAgent {
                id: agent_id.clone(),
                name: agent_id.clone(),
                role: if agent_id.to_ascii_lowercase().contains("student") {
                    "student".to_string()
                } else if agent_id.to_ascii_lowercase().contains("assistant") {
                    "assistant".to_string()
                } else {
                    "teacher".to_string()
                },
                persona: "Helpful classroom participant".to_string(),
                priority: 10,
                bound_stage_id: None,
            })
            .collect();
    }

    vec![]
}

fn resolve_current_stage_id(payload: &StatelessChatRequest) -> Option<String> {
    let current_scene_id = payload.store_state.current_scene_id.as_ref()?;
    payload
        .store_state
        .scenes
        .iter()
        .find(|scene| &scene.id == current_scene_id)
        .map(|scene| scene.stage_id.clone())
}

fn resolve_agent_role(payload: &StatelessChatRequest, agent_id: &str) -> String {
    payload
        .config
        .agent_configs
        .iter()
        .find(|agent| agent.id == agent_id)
        .map(|agent| agent.role.clone())
        .unwrap_or_else(|| "teacher".to_string())
}

fn score_agent_relevance(
    agent: &CandidateAgent,
    discussion_hint: &str,
    latest_user_message: &str,
) -> i32 {
    let haystack = format!(
        "{} {} {}",
        agent.name.to_lowercase(),
        agent.role.to_lowercase(),
        agent.persona.to_lowercase()
    );
    let query = format!("{} {}", discussion_hint, latest_user_message).to_lowercase();
    let mut score = 0;

    for keyword in query
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| token.len() >= 4)
    {
        if haystack.contains(keyword) {
            score += 6;
        }
    }

    score.min(18)
}

fn latest_user_message(payload: &StatelessChatRequest) -> String {
    payload
        .messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.clone())
        .unwrap_or_else(|| "Continue the lesson naturally.".to_string())
}

fn max_agent_turns_for_request(payload: &StatelessChatRequest) -> usize {
    let candidate_count = collect_candidate_agents(payload).len();
    let session_type = payload
        .config
        .session_type
        .as_deref()
        .unwrap_or("discussion")
        .to_ascii_lowercase();

    if candidate_count <= 1 {
        return 1;
    }

    if session_type == "discussion" {
        return 2;
    }

    1
}

fn next_stateless_session_outcome(
    payload: &StatelessChatRequest,
    director_state: &DirectorState,
    max_turns: usize,
) -> StatelessSessionOutcome {
    if director_state.agent_responses.len() >= max_turns {
        return if should_cue_user_after_turns(payload, director_state) {
            StatelessSessionOutcome::CueUser
        } else {
            StatelessSessionOutcome::End
        };
    }

    if collect_candidate_agents(payload).len() <= 1 {
        return if should_cue_user_after_turns(payload, director_state) {
            StatelessSessionOutcome::CueUser
        } else {
            StatelessSessionOutcome::End
        };
    }

    StatelessSessionOutcome::Continue
}

fn should_cue_user_after_turns(payload: &StatelessChatRequest, director_state: &DirectorState) -> bool {
    let session_type = payload
        .config
        .session_type
        .as_deref()
        .unwrap_or("discussion")
        .to_ascii_lowercase();

    session_type == "discussion" && director_state.turn_count >= 1
}

fn build_cue_user_prompt(payload: &StatelessChatRequest, selected_agent: &SelectedAgent) -> String {
    let topic = payload
        .config
        .discussion_topic
        .as_deref()
        .unwrap_or("this lesson");
    format!(
        "{} is ready for your response. Ask a follow-up, answer their prompt, or guide the discussion on {}.",
        selected_agent.name, topic
    )
}

fn build_stateless_chat_system_prompt(
    payload: &StatelessChatRequest,
    selected_agent: &SelectedAgent,
) -> String {
    let session_type = payload
        .config
        .session_type
        .clone()
        .unwrap_or_else(|| "discussion".to_string());
    let discussion_prompt = payload
        .config
        .discussion_prompt
        .clone()
        .or_else(|| payload.config.discussion_topic.clone())
        .unwrap_or_else(|| "Continue helping the learner clearly and directly.".to_string());
    let recent_turns = payload
        .director_state
        .as_ref()
        .map(|state| {
            state
                .agent_responses
                .iter()
                .rev()
                .take(3)
                .map(|summary| format!("{} ({}) said: {}", summary.agent_name, summary.agent_id, summary.content_preview))
                .collect::<Vec<_>>()
                .join(" | ")
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "No previous tutor turns in memory.".to_string());

    format!(
        "You are {} in an AI tutor runtime. Your role is {}. Persona: {}. Session type: {}. Discussion focus: {}. Director routing note: {}. Recent tutor memory: {}. Respond as this agent speaking directly to the learner. Keep it concise, helpful, classroom-appropriate, and move the lesson forward instead of repeating earlier turns.",
        selected_agent.name,
        selected_agent.role,
        selected_agent.persona,
        session_type,
        discussion_prompt,
        selected_agent.reason,
        recent_turns
    )
}

fn build_stateless_chat_user_prompt(payload: &StatelessChatRequest, latest_user_message: &str) -> String {
    let stage_context = payload
        .store_state
        .current_scene_id
        .clone()
        .unwrap_or_else(|| "no-current-scene".to_string());
    let current_turn = payload
        .director_state
        .as_ref()
        .map(|state| state.turn_count + 1)
        .unwrap_or(1);
    format!(
        "Current scene: {}. Whiteboard open: {}. Current director turn: {}. Latest learner message: {}",
        stage_context, payload.store_state.whiteboard_open, current_turn, latest_user_message
    )
}

fn update_director_state(
    payload: &StatelessChatRequest,
    selected_agent: &SelectedAgent,
    generated: &str,
) -> DirectorState {
    let mut director_state = payload.director_state.clone().unwrap_or(DirectorState {
        turn_count: 0,
        agent_responses: vec![],
        whiteboard_ledger: vec![],
    });

    director_state.turn_count += 1;
    director_state.agent_responses.push(AgentTurnSummary {
        agent_id: selected_agent.id.clone(),
        agent_name: selected_agent.name.clone(),
        content_preview: generated.chars().take(120).collect(),
        action_count: 0,
        whiteboard_actions: Vec::<WhiteboardActionRecord>::new(),
    });

    director_state
}

fn chunk_text(value: &str, max_chars: usize) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return vec!["I am ready to continue the lesson.".to_string()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for word in trimmed.split_whitespace() {
        let candidate_len = if current.is_empty() {
            word.len()
        } else {
            current.len() + 1 + word.len()
        };

        if candidate_len > max_chars && !current.is_empty() {
            chunks.push(current.clone());
            current.clear();
        }

        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    if chunks.is_empty() {
        chunks.push(trimmed.to_string());
    }

    chunks
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
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

    use axum::{body::{to_bytes, Body}, http::Request};
    use chrono::{Duration as ChronoDuration, Utc};
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
            GeneratedChatAgentConfig, RuntimeMode, StatelessChatConfig, StatelessChatRequest,
        },
        scene::{Scene, SceneContent, Stage},
    };
    use ai_tutor_providers::{
        factory::{DefaultImageProviderFactory, DefaultLlmProviderFactory, DefaultTtsProviderFactory, DefaultVideoProviderFactory},
        traits::{ImageProvider, LlmProvider, TtsProvider, VideoProvider, VideoProviderFactory},
    };
    use ai_tutor_storage::filesystem::FileStorage;

    use super::*;

    struct MockLessonAppService {
        generate_response: Mutex<Option<GenerateLessonResponse>>,
        queued_response: Mutex<Option<GenerateLessonResponse>>,
        chat_events: Mutex<Vec<TutorStreamEvent>>,
        job: Option<LessonGenerationJob>,
        lesson: Option<Lesson>,
        audio_asset: Option<Vec<u8>>,
        media_asset: Option<Vec<u8>>,
    }

    struct FakeLlmProvider {
        responses: Mutex<Vec<String>>,
    }

    struct FakeLlmProviderFactory;

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

        async fn stateless_chat(&self, _payload: StatelessChatRequest) -> Result<Vec<TutorStreamEvent>> {
            Ok(self.chat_events.lock().unwrap().clone())
        }

        async fn get_lesson(&self, _id: &str) -> Result<Option<Lesson>> {
            Ok(self.lesson.clone())
        }

        async fn get_audio_asset(&self, _lesson_id: &str, _file_name: &str) -> Result<Option<Vec<u8>>> {
            Ok(self.audio_asset.clone())
        }

        async fn get_media_asset(&self, _lesson_id: &str, _file_name: &str) -> Result<Option<Vec<u8>>> {
            Ok(self.media_asset.clone())
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
    }

    impl LlmProviderFactory for FakeLlmProviderFactory {
        fn build(&self, _model_config: ai_tutor_domain::provider::ModelConfig) -> Result<Box<dyn LlmProvider>> {
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

    #[async_trait]
    impl ImageProvider for FakeImageProvider {
        async fn generate_image(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> Result<String> {
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
        async fn generate_video(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> Result<String> {
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
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig::default()),
            Arc::new(DefaultLlmProviderFactory),
            Arc::new(DefaultImageProviderFactory),
            Arc::new(DefaultVideoProviderFactory),
            Arc::new(DefaultTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    fn build_live_service_with_fakes(storage: Arc<FileStorage>) -> Arc<dyn LessonAppService> {
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
                    },
                )]),
            }),
            Arc::new(FakeLlmProviderFactory),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    #[test]
    fn selected_agent_prefers_trigger_agent_on_first_turn() {
        let payload = sample_stateless_chat_request();

        let selected = resolve_selected_agent(&payload);

        assert_eq!(selected.id, "teacher-1");
        assert!(selected.reason.contains("trigger agent"));
    }

    #[test]
    fn selected_agent_rotates_away_from_previous_teacher_turn() {
        let mut payload = sample_stateless_chat_request();
        payload.director_state = Some(DirectorState {
            turn_count: 1,
            agent_responses: vec![AgentTurnSummary {
                agent_id: "teacher-1".to_string(),
                agent_name: "Ms. Rivera".to_string(),
                content_preview: "Fractions represent parts of a whole.".to_string(),
                action_count: 0,
                whiteboard_actions: vec![],
            }],
            whiteboard_ledger: vec![],
        });

        let selected = resolve_selected_agent(&payload);

        assert_eq!(selected.id, "student-1");
        assert!(selected.reason.contains("role diversity"));
    }

    #[test]
    fn selected_agent_prefers_stage_bound_agent_when_topics_are_similar() {
        let mut payload = sample_stateless_chat_request();
        payload.config.trigger_agent_id = None;
        payload.director_state = Some(DirectorState {
            turn_count: 2,
            agent_responses: vec![AgentTurnSummary {
                agent_id: "assistant-1".to_string(),
                agent_name: "Board Helper".to_string(),
                content_preview: "Let me summarize the fraction example.".to_string(),
                action_count: 0,
                whiteboard_actions: vec![],
            }],
            whiteboard_ledger: vec![],
        });
        payload.config.agent_configs = vec![
            sample_agent_config(
                "teacher-stage",
                "Stage Tutor",
                "teacher",
                "Math teacher for fraction scenes",
                4,
                Some("stage-1"),
            ),
            sample_agent_config(
                "teacher-global",
                "Global Tutor",
                "teacher",
                "General math teacher for any lesson",
                1,
                None,
            ),
        ];

        let selected = resolve_selected_agent(&payload);

        assert_eq!(selected.id, "teacher-stage");
        assert!(selected.reason.contains("active stage"));
    }

    #[test]
    fn multi_agent_discussion_allows_two_director_turns() {
        let payload = sample_stateless_chat_request();

        assert_eq!(max_agent_turns_for_request(&payload), 2);
    }

    #[test]
    fn discussion_sessions_cue_user_after_turn_budget_is_reached() {
        let payload = sample_stateless_chat_request();
        let director_state = DirectorState {
            turn_count: 2,
            agent_responses: vec![
                AgentTurnSummary {
                    agent_id: "teacher-1".to_string(),
                    agent_name: "Ms. Rivera".to_string(),
                    content_preview: "Fractions are parts of a whole.".to_string(),
                    action_count: 0,
                    whiteboard_actions: vec![],
                },
                AgentTurnSummary {
                    agent_id: "student-1".to_string(),
                    agent_name: "Asha".to_string(),
                    content_preview: "Can you give another example?".to_string(),
                    action_count: 0,
                    whiteboard_actions: vec![],
                },
            ],
            whiteboard_ledger: vec![],
        };

        assert_eq!(
            next_stateless_session_outcome(&payload, &director_state, 2),
            StatelessSessionOutcome::CueUser
        );
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
    async fn health_route_returns_ok_json() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let response = app
            .oneshot(Request::builder().uri("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
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
            chat_events: Mutex::new(vec![]),
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
            chat_events: Mutex::new(vec![]),
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
    async fn job_and_lesson_routes_return_persisted_entities() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
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
            chat_events: Mutex::new(vec![]),
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
            chat_events: Mutex::new(vec![
                TutorStreamEvent {
                    kind: TutorEventKind::SessionStarted,
                    session_id: "session-1".to_string(),
                    agent_id: None,
                    agent_name: None,
                    content: None,
                    message: Some("Starting tutor turn".to_string()),
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::TextDelta,
                    session_id: "session-1".to_string(),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    content: Some("Hello learner".to_string()),
                    message: None,
                    director_state: None,
                },
                TutorStreamEvent {
                    kind: TutorEventKind::Done,
                    session_id: "session-1".to_string(),
                    agent_id: Some("assistant".to_string()),
                    agent_name: Some("AI Tutor".to_string()),
                    content: None,
                    message: Some("Tutor turn complete".to_string()),
                    director_state: Some(DirectorState {
                        turn_count: 1,
                        agent_responses: vec![],
                        whiteboard_ledger: vec![],
                    }),
                },
            ]),
            job: None,
            lesson: None,
            audio_asset: None,
            media_asset: None,
        }));

        let payload = serde_json::to_vec(&StatelessChatRequest {
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
        assert!(payload.contains("done"));
    }

    #[tokio::test]
    async fn audio_asset_route_returns_binary_audio() {
        let app = build_router(Arc::new(MockLessonAppService {
            generate_response: Mutex::new(None),
            queued_response: Mutex::new(None),
            chat_events: Mutex::new(vec![]),
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
            chat_events: Mutex::new(vec![]),
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

        let body = to_bytes(generate_response.into_body(), usize::MAX).await.unwrap();
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

        let lesson_bytes = to_bytes(lesson_response.into_body(), usize::MAX).await.unwrap();
        let lesson: Lesson = serde_json::from_slice(&lesson_bytes).unwrap();
        let speech_action = lesson
            .scenes
            .iter()
            .flat_map(|scene| scene.actions.iter())
            .find_map(|action| match action {
                ai_tutor_domain::action::LessonAction::Speech { audio_url, .. } => audio_url.clone(),
                _ => None,
            })
            .unwrap();
        assert!(speech_action.contains("/api/assets/audio/"));

        let image_src = lesson
            .scenes
            .iter()
            .find_map(|scene| match &scene.content {
                ai_tutor_domain::scene::SceneContent::Slide { canvas } => canvas
                    .elements
                    .iter()
                    .find_map(|element| match element {
                        ai_tutor_domain::scene::SlideElement::Image { src, .. } => Some(src.clone()),
                        _ => None,
                    }),
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

        let body = to_bytes(generate_response.into_body(), usize::MAX).await.unwrap();
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
            let job_bytes = to_bytes(job_response.into_body(), usize::MAX).await.unwrap();
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
            chat_events: Mutex::new(vec![]),
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
            chat_events: Mutex::new(vec![]),
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
        assert!(matches!(persisted.status, LessonGenerationJobStatus::Failed));
        assert!(matches!(persisted.step, LessonGenerationStep::Failed));
        assert!(persisted.error.as_deref().unwrap_or_default().contains("Stale job"));
    }
}
