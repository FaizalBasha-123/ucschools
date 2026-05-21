use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Utc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn};
use uuid::Uuid;

use ai_tutor_domain::{
    action::LessonAction,
    generation::{Language, LessonGenerationRequest},
    job::{
        LessonGenerationJob, LessonGenerationJobInputSummary, LessonGenerationJobResult,
        LessonGenerationJobStatus, LessonGenerationStep,
    },
    lesson::Lesson,
    routing::{compute_generation_budget, tier_limits, QualityTier, TopicComplexity},
    scene::{Scene, SceneContent, SceneOutline, Stage},
};
use ai_tutor_media::{
    apply_tts_results, collect_media_tasks, collect_tts_tasks, persist_inline_audio_assets,
    persist_inline_media_assets, replace_media_placeholders, storage::DynAssetStore,
};
use ai_tutor_providers::resilient::is_non_retryable;
use ai_tutor_providers::traits::{ImageProvider, TtsProvider, VideoProvider};
use ai_tutor_storage::repositories::{LessonJobRepository, LessonRepository};

use crate::complexity;
use crate::context::{self, detect_complexity};
use crate::cost_guard::{self, CostDecision};
use crate::state::{GenerationOutput, GenerationState};
use crate::telemetry::PipelineTelemetry;
use crate::validator;

#[async_trait]
pub trait LessonGenerationPipeline: Send + Sync {
    async fn generate_outlines(
        &self,
        request: &LessonGenerationRequest,
        pdf_context: Option<&str>,
    ) -> Result<Vec<SceneOutline>>;

    async fn generate_scene_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        pdf_context: Option<&str>,
    ) -> Result<SceneContent>;

    async fn generate_scene_actions(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        content: &SceneContent,
        pdf_context: Option<&str>,
    ) -> Result<Vec<LessonAction>>;
}

pub struct LessonGenerationOrchestrator<P, L, J>
where
    P: LessonGenerationPipeline,
    L: LessonRepository,
    J: LessonJobRepository,
{
    pipeline: Arc<P>,
    lessons: Arc<L>,
    jobs: Arc<J>,
    image: Option<Arc<dyn ImageProvider>>,
    video: Option<Arc<dyn VideoProvider>>,
    tts: Option<Arc<dyn TtsProvider>>,
    asset_store: Option<DynAssetStore>,
}

impl<P, L, J> LessonGenerationOrchestrator<P, L, J>
where
    P: LessonGenerationPipeline,
    L: LessonRepository,
    J: LessonJobRepository,
{
    pub fn new(pipeline: Arc<P>, lessons: Arc<L>, jobs: Arc<J>) -> Self {
        Self {
            pipeline,
            lessons,
            jobs,
            image: None,
            video: None,
            tts: None,
            asset_store: None,
        }
    }

    pub fn with_image_provider(mut self, image: Arc<dyn ImageProvider>) -> Self {
        self.image = Some(image);
        self
    }

    pub fn with_video_provider(mut self, video: Arc<dyn VideoProvider>) -> Self {
        self.video = Some(video);
        self
    }

    pub fn with_tts(mut self, tts: Arc<dyn TtsProvider>) -> Self {
        self.tts = Some(tts);
        self
    }

    pub fn with_asset_store(mut self, asset_store: DynAssetStore) -> Self {
        self.asset_store = Some(asset_store);
        self
    }

    pub async fn generate_lesson(
        &self,
        request: LessonGenerationRequest,
        base_url: &str,
    ) -> Result<GenerationOutput> {
        let now = Utc::now();
        let lesson_id = Uuid::new_v4().to_string();
        let job = build_queued_job(Uuid::new_v4().to_string(), &request, now);

        self.generate_lesson_for_job(request, lesson_id, job, base_url, true)
            .await
    }

    pub async fn generate_lesson_for_job(
        &self,
        request: LessonGenerationRequest,
        lesson_id: String,
        mut job: LessonGenerationJob,
        base_url: &str,
        create_job: bool,
    ) -> Result<GenerationOutput> {
        let now = job.created_at;
        let request_id = Uuid::new_v4().to_string();
        let stage = build_stage(&lesson_id, &request, now);

        if create_job {
            self.jobs
                .create_job(&job)
                .await
                .map_err(|err| anyhow!(err))?;
        }

        update_job(
            &self.jobs,
            &mut job,
            LessonGenerationJobStatus::Running,
            LessonGenerationStep::Initializing,
            5,
            "Initializing lesson generation",
        )
        .await?;
        job.started_at = Some(now);
        job.updated_at = Utc::now();
        self.jobs
            .update_job(&job)
            .await
            .map_err(|err| anyhow!(err))?;

        let pdf_images = request.pdf_images.clone();
        let mut state = GenerationState {
            request_id,
            lesson_id: lesson_id.clone(),
            request,
            job,
            stage,
            outlines: Vec::new(),
            scenes: Vec::new(),
            pdf_context: None,
            pdf_images,
            started_at: now,
        };

        let generation_result = self.run_pipeline(&mut state, base_url).await;
        if let Err(err) = generation_result {
            state.job.status = LessonGenerationJobStatus::Failed;
            state.job.step = LessonGenerationStep::Failed;
            state.job.progress = 100;
            state.job.message = "Lesson generation failed".to_string();
            state.job.error = Some(err.to_string());
            state.job.updated_at = Utc::now();
            state.job.completed_at = Some(Utc::now());
            self.jobs
                .update_job(&state.job)
                .await
                .map_err(|update_err| anyhow!(update_err))?;
            return Err(err);
        }

        let lesson = Lesson {
            id: lesson_id.clone(),
            account_id: state.job.account_id.clone(),
            school_id: state.job.school_id.clone(),
            title: state.stage.name.clone(),
            language: language_code(&state.request.requirements.language).to_string(),
            description: Some(state.request.requirements.requirement.clone()),
            stage: Some(state.stage.clone()),
            scenes: state.scenes.clone(),
            style: state.stage.style.clone(),
            agent_ids: state.stage.agent_ids.clone(),
            created_at: now,
            updated_at: Utc::now(),
        };

        self.lessons
            .save_lesson(&lesson)
            .await
            .map_err(|err| anyhow!(err))?;

        state.job.status = LessonGenerationJobStatus::Succeeded;
        state.job.step = LessonGenerationStep::Completed;
        state.job.progress = 100;
        state.job.message = "Lesson generation completed".to_string();
        state.job.result = Some(LessonGenerationJobResult {
            lesson_id: lesson_id.clone(),
            url: format!("{}/lessons/{}", base_url.trim_end_matches('/'), lesson_id),
            scenes_count: lesson.scenes.len() as i32,
        });
        state.job.updated_at = Utc::now();
        state.job.completed_at = Some(Utc::now());
        self.jobs
            .update_job(&state.job)
            .await
            .map_err(|err| anyhow!(err))?;

        Ok(GenerationOutput {
            lesson,
            job: state.job,
        })
    }

    async fn run_pipeline(&self, state: &mut GenerationState, _base_url: &str) -> Result<()> {
        let mut telemetry = PipelineTelemetry::new();

        // Step 0: PDF Processing
        if let Some(pdf_b64) = &state.request.pdf_content {
            let pdf_start = Instant::now();
            update_job(
                &self.jobs,
                &mut state.job,
                LessonGenerationJobStatus::Running,
                LessonGenerationStep::AnalyzingInput,
                10,
                "Analyzing PDF content",
            )
            .await?;

            use ai_tutor_media::pdf_processor::PdfProcessor;
            use base64::{engine::general_purpose::STANDARD, Engine as _};

            let pdf_bytes = STANDARD
                .decode(pdf_b64)
                .map_err(|err| anyhow!("Failed to decode PDF content: {}", err))?;

            if let Ok(pdf_result) = PdfProcessor::process_pdf(&pdf_bytes) {
                let tier = resolve_quality_tier(&state.request);
                let limits = tier_limits(tier);
                let compressed =
                    context::compress_pdf(&pdf_result.full_text, limits.max_pdf_context_chars);
                info!(
                    "PDF compressed: {} chars → {} chars (tier={:?})",
                    pdf_result.full_text.len(),
                    compressed.len(),
                    tier
                );
                state.pdf_context = Some(compressed);
            }
            telemetry.record_pdf_timing(pdf_start.elapsed());
        }

        update_job(
            &self.jobs,
            &mut state.job,
            LessonGenerationJobStatus::Running,
            LessonGenerationStep::GeneratingOutlines,
            15,
            "Generating scene outlines",
        )
        .await?;

        let outlines_start = Instant::now();
        state.outlines = self
            .pipeline
            .generate_outlines(&state.request, state.pdf_context.as_deref())
            .await?;
        telemetry.record_outlines_timing(outlines_start.elapsed());

        // ── Scene budget: deterministic from tier + complexity ──────────
        let tier = resolve_quality_tier(&state.request);
        let complexity = detect_complexity(&state.request.requirements.requirement);
        let scene_budget = complexity::compute_scene_budget(tier, complexity);

        // When user has consented to extra scenes, effective target includes them.
        let effective_target = if state.request.extra_scenes_consented {
            (scene_budget.target_scenes + scene_budget.extra_scene_allowance)
                .min(scene_budget.hard_max_scenes)
        } else {
            scene_budget.target_scenes
        };
        let hard_max = scene_budget.hard_max_scenes;
        let original_count = state.outlines.len();

        // Consent gate: if outlines exceed target without consent, bail with details
        // so the frontend can surface the budget to the user before we proceed.
        if !state.request.extra_scenes_consented
            && state.outlines.len() > scene_budget.target_scenes
        {
            let quality_label = tier_label(tier);
            let extra_cost = (state.outlines.len() - scene_budget.target_scenes) as f64
                * scene_budget_extra_credit_cost(complexity);
            anyhow::bail!(
                "BUDGET_EXCEEDED: scene_count={}, target={}, hard_cap={}, quality={}, extra_cost={:.2}",
                state.outlines.len(),
                scene_budget.target_scenes,
                hard_max,
                quality_label,
                extra_cost,
            );
        }

        // Phase 1: Priority-aware truncation to hard_max (absolute cap)
        if state.outlines.len() > hard_max {
            info!(
                "Trimming outlines from {} to hard_max={} (tier={:?}, complexity={:?})",
                state.outlines.len(),
                hard_max,
                tier,
                complexity
            );
            let mut with_priority: Vec<(usize, &SceneOutline, u8)> = state
                .outlines
                .iter()
                .enumerate()
                .map(|(i, o)| {
                    let priority = scene_priority(o, i, state.outlines.len());
                    (i, o, priority)
                })
                .collect();
            with_priority.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
            let kept: std::collections::HashSet<usize> = with_priority
                .into_iter()
                .take(hard_max)
                .map(|(i, _, _)| i)
                .collect();
            let mut trimmed: Vec<SceneOutline> = state
                .outlines
                .drain(..)
                .enumerate()
                .filter(|(i, _)| kept.contains(i))
                .map(|(_, o)| o)
                .collect();
            for (idx, outline) in trimmed.iter_mut().enumerate() {
                outline.order = (idx + 1) as i32;
            }
            state.outlines = trimmed;
            telemetry.record_outline_truncation(original_count, state.outlines.len());
        }

        // Phase 2: Merge similar scenes when count > effective target
        if state.outlines.len() > effective_target {
            let before = state.outlines.len();
            merge_similar_outlines(&mut state.outlines, effective_target);
            info!(
                "Merged outlines from {} to {} (target={}, consented={})",
                before,
                state.outlines.len(),
                effective_target,
                state.request.extra_scenes_consented
            );
        }

        telemetry.record_outlines(state.outlines.len());

        // Ensure budget constraints against outlines
        let budget = compute_generation_budget(tier, complexity);
        if let Some(issue) = validator::validate_interaction_count(&state.outlines, &budget) {
            telemetry.record_validation(1.0, &[issue]);
        }
        if let Some(issue) = validator::validate_visual_count(&state.outlines, &budget) {
            telemetry.record_validation(1.0, &[issue]);
        }

        state.job.total_scenes = Some(state.outlines.len() as i32);
        state.job.updated_at = Utc::now();
        self.jobs
            .update_job(&state.job)
            .await
            .map_err(|err| anyhow!(err))?;

        if state.outlines.is_empty() {
            return Err(anyhow!("No scene outlines were generated"));
        }

        let tier = resolve_quality_tier(&state.request);

        // ── Pre-generation cost guard: check all outlines fit within tier budget ──
        let outline_texts: Vec<String> = state
            .outlines
            .iter()
            .map(|o| {
                format!(
                    "{} {} {}",
                    state.request.requirements.requirement,
                    o.title,
                    o.key_points.join(" ")
                )
            })
            .collect();
        let outline_refs: Vec<&str> = outline_texts.iter().map(|s| s.as_str()).collect();
        let budget_tracker = cost_guard::BudgetTracker::new();
        if matches!(budget_tracker.check_outlines(&outline_refs, tier), CostDecision::Deny) {
            warn!(
                "CostGuard OUTLINE DENY: total estimated cost exceeds tier budget (tier={:?})",
                tier
            );
            telemetry.record_cost_decision("Deny");
            return Err(anyhow!(
                "Estimated generation cost exceeds the maximum allowed for this plan tier"
            ));
        }

        update_job(
            &self.jobs,
            &mut state.job,
            LessonGenerationJobStatus::Running,
            LessonGenerationStep::GeneratingScenes,
            30,
            "Generating scenes",
        )
        .await?;

        let mut budget_tracker = cost_guard::BudgetTracker::new();

        for (index, outline) in state.outlines.iter().enumerate() {
            // ── Step 1: Cost Guard — estimate and check budget ────────
            let prompt_estimate = format!(
                "{} {} {}",
                state.request.requirements.requirement,
                outline.title,
                outline.key_points.join(" ")
            );
            let cost_estimate = cost_guard::estimate_cost_from_text(&prompt_estimate, &tier);
            match budget_tracker.record_scene(&cost_estimate, tier) {
                CostDecision::Deny => {
                    warn!(
                        "CostGuard DENIED scene {}: est_tokens={} est_cost=${:.6} total=${:.6}",
                        outline.title,
                        cost_estimate.estimated_tokens,
                        cost_estimate.estimated_cost_usd,
                        budget_tracker.total_estimated_cost_usd
                    );
                    telemetry.record_cost_decision("Deny");
                    continue;
                }
                CostDecision::Compress => {
                    info!("CostGuard: compressing context for scene {}", outline.title);
                    telemetry.record_cost_decision("Compress");
                }
                CostDecision::Warn => {
                    info!(
                        "CostGuard WARN: scene {} approaching budget limit (total=${:.6})",
                        outline.title,
                        budget_tracker.total_estimated_cost_usd
                    );
                    telemetry.record_cost_decision("Warn");
                }
                CostDecision::Allow => {
                    telemetry.record_cost_decision("Allow");
                }
            }

            // ── Step 2: Generate content ──────────────────────────────
            let content_start = Instant::now();
            let mut content = self
                .pipeline
                .generate_scene_content(&state.request, outline, state.pdf_context.as_deref())
                .await?;
            telemetry.record_scene_content_timing(&outline.title, content_start.elapsed());

            // ── Step 3: Validate (structural + semantic) with fix-in-place
            let validation = validator::validate_content(&mut content, &tier);
            telemetry.record_validation(validation.score, &validation.issues);
            if !validation.issues.is_empty() {
                info!(
                    "Validator fixed {} issues in scene {} (score={})",
                    validation.issues.len(),
                    outline.title,
                    validation.score
                );
            }

            // ── Step 4: Quality Escalation (Premium only) ────────────
            if crate::router::should_escalate(validation.score, &tier) {
                info!(
                    "Quality escalation triggered for scene {} (score={})",
                    outline.title, validation.score
                );
            }

            // ── Step 5: Generate actions for this scene ───────────────
            let actions = self
                .pipeline
                .generate_scene_actions(
                    &state.request,
                    outline,
                    &content,
                    state.pdf_context.as_deref(),
                )
                .await?;

            state.scenes.push(Scene {
                id: format!("scene-{}", Uuid::new_v4()),
                stage_id: state.stage.id.clone(),
                title: outline.title.clone(),
                order: outline.order,
                content,
                actions,
                whiteboards: vec![],
                multi_agent: None,
                created_at: Some(Utc::now().timestamp_millis()),
                updated_at: Some(Utc::now().timestamp_millis()),
            });

            let scenes_generated = (index + 1) as i32;
            let total = state.outlines.len().max(1) as i32;
            state.job.scenes_generated = scenes_generated;
            state.job.progress = 30 + ((scenes_generated * 60) / total);
            state.job.message = format!(
                "Generated scene {}/{}: {}",
                scenes_generated, total, outline.title
            );
            state.job.updated_at = Utc::now();
            self.jobs
                .update_job(&state.job)
                .await
                .map_err(|err| anyhow!(err))?;
        }

        let media_tasks = collect_media_tasks(&state.lesson_id, &state.outlines);
        if !media_tasks.is_empty() {
            let media_start = Instant::now();
            update_job(
                &self.jobs,
                &mut state.job,
                LessonGenerationJobStatus::Running,
                LessonGenerationStep::GeneratingMedia,
                88,
                "Generating lesson media",
            )
            .await?;

            let mut media_map = std::collections::HashMap::new();
            let mut failed_media = Vec::new();
            let mut successful_media = 0_usize;
            let total_media_tasks = media_tasks.len();

            // OpenMAIC reference:
            // - lib/media/media-orchestrator.ts processes media tasks with explicit
            //   per-task status transitions.
            // AI-Tutor parity:
            // - update lesson job progress/message for each asset so queue/API
            //   observers can track in-flight media orchestration.
            for (index, task) in media_tasks.into_iter().enumerate() {
                state.job.progress =
                    88 + (((index as i32) * 3) / (total_media_tasks.max(1) as i32));
                state.job.message = format!(
                    "Generating media asset {}/{} ({}:{})",
                    index + 1,
                    total_media_tasks,
                    media_type_label(&task.media_type),
                    task.element_id
                );
                state.job.updated_at = Utc::now();
                self.jobs
                    .update_job(&state.job)
                    .await
                    .map_err(|err| anyhow!(err))?;

                    match task.media_type {
                        ai_tutor_domain::scene::MediaType::Image => {
                            let image = self.image.as_ref().ok_or_else(|| {
                                anyhow!(
                                    "image generation requested but no image provider is configured"
                                )
                            })?;
                            match generate_image_with_retry(
                                image.as_ref(),
                                &task.prompt,
                                task.aspect_ratio.as_deref(),
                                &task.element_id,
                            )
                            .await
                            {
                                Ok(output_url) => {
                                    media_map.insert(task.element_id.clone(), output_url);
                                    successful_media += 1;
                                    telemetry.record_image_success();
                                }
                                Err(err) => {
                                    warn!(
                                        "Image generation failed for {} after retries: {}",
                                        task.element_id, err
                                    );
                                    failed_media.push(task.element_id.clone());
                                    telemetry.record_image_failure();
                                    media_map
                                        .insert(task.element_id.clone(), fallback_image_data_uri());
                                }
                            }
                        }
                        ai_tutor_domain::scene::MediaType::Video => {
                            let video = self.video.as_ref().ok_or_else(|| {
                                anyhow!(
                                    "video generation requested but no video provider is configured"
                                )
                            })?;
                            match generate_video_with_retry(
                                video.as_ref(),
                                &task.prompt,
                                task.aspect_ratio.as_deref(),
                                &task.element_id,
                            )
                            .await
                            {
                                Ok(output_url) => {
                                    media_map.insert(task.element_id.clone(), output_url);
                                    successful_media += 1;
                                    telemetry.record_video_success();
                                }
                                Err(err) => {
                                    warn!(
                                        "Video generation failed for {} after retries: {}",
                                        task.element_id, err
                                    );
                                    failed_media.push(task.element_id.clone());
                                    telemetry.record_video_failure();
                                    media_map
                                        .insert(task.element_id.clone(), fallback_video_data_uri());
                                }
                            }
                        }
                    }
            }

            replace_media_placeholders(&mut state.scenes, &media_map)?;
            state.job.progress = 91;
            if !failed_media.is_empty() {
                state.job.message = format!(
                    "Media generation complete with fallback. success={} failed={} ({})",
                    successful_media,
                    failed_media.len(),
                    failed_media.join(", ")
                );
                state.job.updated_at = Utc::now();
                self.jobs
                    .update_job(&state.job)
                    .await
                    .map_err(|err| anyhow!(err))?;
            } else {
                state.job.message = format!(
                    "Media generation complete. success={} failed=0",
                    successful_media
                );
                state.job.updated_at = Utc::now();
                self.jobs
                    .update_job(&state.job)
                    .await
                    .map_err(|err| anyhow!(err))?;
            }

            if let Some(asset_store) = self.asset_store.as_ref() {
                // OpenMAIC keeps generation/orchestration decoupled from local-disk
                // assumptions. This asset-store seam does the same for the Rust path,
                // allowing file-backed dev mode or object-storage production mode.
                if let Err(err) = persist_inline_media_assets(
                    asset_store.as_ref(),
                    &state.lesson_id,
                    &mut state.scenes,
                )
                .await
                {
                    warn!(
                        lesson_id = %state.lesson_id,
                        error = %err,
                        "Persisting generated media assets failed; keeping inline or fallback media references"
                    );
                    state.job.message =
                        format!("{}; media asset persistence degraded", state.job.message);
                    state.job.updated_at = Utc::now();
                    self.jobs
                        .update_job(&state.job)
                        .await
                        .map_err(|update_err| anyhow!(update_err))?;
                }
            }
            telemetry.record_media_timing(media_start.elapsed());
        }

        if state.request.enable_tts {
            if let Some(tts) = &self.tts {
                let tts_start = Instant::now();
                update_job(
                    &self.jobs,
                    &mut state.job,
                    LessonGenerationJobStatus::Running,
                    LessonGenerationStep::GeneratingTts,
                    92,
                    "Generating teacher audio",
                )
                .await?;

                let tasks = collect_tts_tasks(&state.lesson_id, &state.scenes);
                let mut audio_map = std::collections::HashMap::new();
                let mut failed_tts = Vec::new();

                for task in tasks {
                    match tts
                        .synthesize(&task.text, task.voice.as_deref(), task.speed)
                        .await
                    {
                        Ok(audio_url) => {
                            audio_map.insert(task.action_id, audio_url);
                            telemetry.record_tts_success();
                        }
                        Err(err) => {
                            warn!(
                                lesson_id = %state.lesson_id,
                                action_id = %task.action_id,
                                error = %err,
                                "TTS synthesis failed for one lesson action; continuing without audio"
                            );
                            failed_tts.push(task.action_id);
                            telemetry.record_tts_failure();
                        }
                    }
                }
                telemetry.record_tts_timing(tts_start.elapsed());

                apply_tts_results(&mut state.scenes, &audio_map)?;

                if !failed_tts.is_empty() {
                    state.job.message = format!(
                        "Teacher audio completed with partial fallback. success={} failed={} ({})",
                        audio_map.len(),
                        failed_tts.len(),
                        failed_tts.join(", ")
                    );
                    state.job.updated_at = Utc::now();
                    self.jobs
                        .update_job(&state.job)
                        .await
                        .map_err(|err| anyhow!(err))?;
                }

                if let Some(asset_store) = self.asset_store.as_ref() {
                    if let Err(err) = persist_inline_audio_assets(
                        asset_store.as_ref(),
                        &state.lesson_id,
                        &mut state.scenes,
                    )
                    .await
                    {
                        warn!(
                            lesson_id = %state.lesson_id,
                            error = %err,
                            "Persisting generated audio assets failed; keeping inline audio references"
                        );
                        state.job.message =
                            format!("{}; audio asset persistence degraded", state.job.message);
                        state.job.updated_at = Utc::now();
                        self.jobs
                            .update_job(&state.job)
                            .await
                            .map_err(|update_err| anyhow!(update_err))?;
                    }
                }
            }
        }

        update_job(
            &self.jobs,
            &mut state.job,
            LessonGenerationJobStatus::Running,
            LessonGenerationStep::Persisting,
            95,
            "Persisting lesson",
        )
        .await?;

        telemetry.finish();
        telemetry.report();

        Ok(())
    }
}

const MEDIA_GENERATION_MAX_ATTEMPTS: usize = 3;
const MEDIA_GENERATION_BACKOFF_MS: u64 = 250;

async fn generate_image_with_retry(
    provider: &dyn ImageProvider,
    prompt: &str,
    aspect_ratio: Option<&str>,
    element_id: &str,
) -> Result<String> {
    let mut last_error = None;
    for attempt in 0..MEDIA_GENERATION_MAX_ATTEMPTS {
        match provider.generate_image(prompt, aspect_ratio).await {
            Ok(url) => return Ok(url),
            Err(err) => {
                let non_retryable = is_non_retryable(&err);
                warn!(
                    "Image generation attempt {}/{} failed for {} (non_retryable={}): {}",
                    attempt + 1,
                    MEDIA_GENERATION_MAX_ATTEMPTS,
                    element_id,
                    non_retryable,
                    err
                );
                last_error = Some(err);
                if non_retryable || attempt + 1 == MEDIA_GENERATION_MAX_ATTEMPTS {
                    break;
                }
                sleep(Duration::from_millis(
                    MEDIA_GENERATION_BACKOFF_MS * (attempt as u64 + 1),
                ))
                .await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("image generation failed without details")))
}

async fn generate_video_with_retry(
    provider: &dyn VideoProvider,
    prompt: &str,
    aspect_ratio: Option<&str>,
    element_id: &str,
) -> Result<String> {
    let mut last_error = None;
    for attempt in 0..MEDIA_GENERATION_MAX_ATTEMPTS {
        match provider.generate_video(prompt, aspect_ratio).await {
            Ok(url) => return Ok(url),
            Err(err) => {
                let non_retryable = is_non_retryable(&err);
                warn!(
                    "Video generation attempt {}/{} failed for {} (non_retryable={}): {}",
                    attempt + 1,
                    MEDIA_GENERATION_MAX_ATTEMPTS,
                    element_id,
                    non_retryable,
                    err
                );
                last_error = Some(err);
                if non_retryable || attempt + 1 == MEDIA_GENERATION_MAX_ATTEMPTS {
                    break;
                }
                sleep(Duration::from_millis(
                    MEDIA_GENERATION_BACKOFF_MS * (attempt as u64 + 1),
                ))
                .await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("video generation failed without details")))
}

fn fallback_image_data_uri() -> String {
    // Tiny valid SVG placeholder to keep slide rendering stable when generation fails.
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='960' height='540'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-family='Arial' font-size='28'>Image unavailable</text></svg>".to_string()
}

fn fallback_video_data_uri() -> String {
    // Keep deterministic URL replacement even when video generation fails.
    // Frontend can treat this as unavailable media.
    "data:text/plain;base64,dmlkZW8gdW5hdmFpbGFibGU=".to_string()
}

fn media_type_label(media_type: &ai_tutor_domain::scene::MediaType) -> &'static str {
    match media_type {
        ai_tutor_domain::scene::MediaType::Image => "image",
        ai_tutor_domain::scene::MediaType::Video => "video",
    }
}

async fn update_job<J>(
    jobs: &Arc<J>,
    job: &mut LessonGenerationJob,
    status: LessonGenerationJobStatus,
    step: LessonGenerationStep,
    progress: i32,
    message: &str,
) -> Result<()>
where
    J: LessonJobRepository,
{
    job.status = status;
    job.step = step;
    job.progress = progress;
    job.message = message.to_string();
    job.updated_at = Utc::now();
    jobs.update_job(job).await.map_err(|err| anyhow!(err))?;
    Ok(())
}

fn build_stage(
    lesson_id: &str,
    request: &LessonGenerationRequest,
    now: chrono::DateTime<Utc>,
) -> Stage {
    Stage {
        id: format!("stage-{lesson_id}"),
        name: request
            .requirements
            .requirement
            .chars()
            .take(80)
            .collect::<String>(),
        description: Some(request.requirements.requirement.clone()),
        created_at: now.timestamp_millis(),
        updated_at: now.timestamp_millis(),
        language: Some(language_code(&request.requirements.language).to_string()),
        style: Some("interactive".to_string()),
        whiteboard: vec![],
        agent_ids: vec![],
        generated_agent_configs: vec![],
    }
}

pub fn build_queued_job(
    job_id: String,
    request: &LessonGenerationRequest,
    now: chrono::DateTime<Utc>,
) -> LessonGenerationJob {
    LessonGenerationJob {
        id: job_id,
        account_id: request.account_id.clone(),
        school_id: request.school_id.clone(),
        status: LessonGenerationJobStatus::Queued,
        step: LessonGenerationStep::Queued,
        progress: 0,
        message: "Queued lesson generation".to_string(),
        input_summary: LessonGenerationJobInputSummary::from(request),
        scenes_generated: 0,
        total_scenes: None,
        result: None,
        error: None,
        created_at: now,
        updated_at: now,
        started_at: None,
        completed_at: None,
    }
}

fn language_code(language: &Language) -> &'static str {
    match language {
        Language::ZhCn => "zh-CN",
        Language::EnUs => "en-US",
    }
}

/// Map the request's `quality_mode` string to the routing engine's `QualityTier`.
fn resolve_quality_tier(request: &LessonGenerationRequest) -> QualityTier {
    match request.quality_mode.as_deref() {
        Some("basic") => QualityTier::Basic,
        Some("premium") => QualityTier::Premium,
        _ => QualityTier::Standard,
    }
}

fn tier_label(tier: QualityTier) -> &'static str {
    match tier {
        QualityTier::Basic => "basic",
        QualityTier::Standard => "standard",
        QualityTier::Premium => "premium",
    }
}

fn scene_budget_extra_credit_cost(complexity: TopicComplexity) -> f64 {
    // Rough per-scene cost estimate for the consent dialog (varies by learning mode,
    // but this gives a ballpark for user visibility).
    match complexity {
        TopicComplexity::Low | TopicComplexity::Normal => 0.5,
        TopicComplexity::High => 0.6,
        TopicComplexity::VeryHigh => 0.7,
        TopicComplexity::Extreme => 0.8,
    }
}

/// Priority-aware scene truncation: assign a priority score to each outline.
/// Higher = more important to keep.
///
/// Priority tiers:
///   - First scene (intro) → 100 (Critical)
///   - Last scene (recap) → 80 (Important)
///   - Quiz scenes → 70 (Important)
///   - PBL scenes → 60 (Important)
///   - Slide scenes → 50 (Important)
///   - Interactive scenes → 30 (Optional)
fn scene_priority(outline: &SceneOutline, index: usize, total: usize) -> u8 {
    if index == 0 {
        return 100; // intro: critical
    }
    if index == total - 1 {
        return 80; // recap/assessment: important
    }
    match outline.scene_type {
        ai_tutor_domain::scene::SceneType::Quiz => 70,
        ai_tutor_domain::scene::SceneType::Pbl => 60,
        ai_tutor_domain::scene::SceneType::Slide => 50,
        ai_tutor_domain::scene::SceneType::Interactive => 30,
    }
}

/// Merge similar consecutive outlines until count <= target.
///
/// Strategy: walk through outlines in order, merging consecutive slide-type
/// outlines with overlapping key points into a single outline. Low-priority
/// scenes (Interactive, Slide with no distinct key points) are merged first.
fn merge_similar_outlines(outlines: &mut Vec<SceneOutline>, target: usize) {
    while outlines.len() > target {
        let before = outlines.len();

        // Pass 1: merge consecutive slide outlines with overlapping content
        let mut i = 1;
        while i < outlines.len() && outlines.len() > target {
            let prev = &outlines[i - 1];
            let curr = &outlines[i];

            let both_slides = matches!(prev.scene_type, ai_tutor_domain::scene::SceneType::Slide)
                && matches!(curr.scene_type, ai_tutor_domain::scene::SceneType::Slide);

            let has_overlap = prev.key_points.iter().any(|kp| {
                curr.key_points.iter().any(|ckp| {
                    let words: Vec<&str> = kp.split_whitespace().collect();
                    words.iter().any(|w| w.len() > 3 && ckp.contains(w))
                })
            });

            if both_slides && has_overlap {
                let curr = outlines.remove(i);
                let prev = &mut outlines[i - 1];
                prev.key_points.extend(curr.key_points);
                prev.description.push_str("; ");
                prev.description.push_str(&curr.description);
                // Don't increment i — check the new current against previous
            } else {
                i += 1;
            }
        }

        if outlines.len() == before {
            // Pass 2: merge lowest-priority consecutive scenes
            let mut worst_idx = 1;
            let mut worst_score = u8::MAX;
            for i in 1..outlines.len() - 1 {
                let score = scene_priority(&outlines[i], i, outlines.len());
                if score < worst_score {
                    worst_score = score;
                    worst_idx = i;
                }
            }
            if worst_idx < outlines.len() - 1 {
                // Merge worst into the next scene
                let removed = outlines.remove(worst_idx);
                if worst_idx < outlines.len() {
                    outlines[worst_idx].key_points.extend(removed.key_points);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };

    use super::*;
    use ai_tutor_domain::{
        generation::{AgentMode, UserRequirements},
        scene::{MediaGenerationRequest, MediaType, QuizQuestion, QuizQuestionType, SceneType},
    };
    use ai_tutor_media::storage::LocalFileAssetStore;
    use ai_tutor_providers::traits::{ImageProvider, TtsProvider, VideoProvider};

    struct StubPipeline;
    struct StubTtsProvider;
    struct FailingTtsProvider;
    struct StubImageProvider;
    struct StubVideoProvider;
    struct AlwaysFailImageProvider;
    struct FlakyVideoProvider {
        failures_before_success: AtomicUsize,
        call_count: AtomicUsize,
    }
    struct StubMediaPipeline;
    struct StubVideoMediaPipeline;

    #[async_trait]
    impl LessonGenerationPipeline for StubPipeline {
        async fn generate_outlines(
            &self,
            request: &LessonGenerationRequest,
            _pdf_context: Option<&str>,
        ) -> Result<Vec<SceneOutline>> {
            Ok(vec![
                SceneOutline {
                    id: "outline-1".to_string(),
                    scene_type: SceneType::Slide,
                    title: "Intro".to_string(),
                    description: request.requirements.requirement.clone(),
                    key_points: vec!["Point 1".to_string()],
                    teaching_objective: Some("Understand basics".to_string()),
                    estimated_duration: Some(120),
                    order: 1,
                    language: Some("en-US".to_string()),
                    suggested_image_ids: vec![],
                    media_generations: vec![],
                    quiz_config: None,
                    interactive_config: None,
                    project_config: None,
                },
                SceneOutline {
                    id: "outline-2".to_string(),
                    scene_type: SceneType::Quiz,
                    title: "Check understanding".to_string(),
                    description: "Quiz".to_string(),
                    key_points: vec!["Point 1".to_string()],
                    teaching_objective: Some("Check understanding".to_string()),
                    estimated_duration: Some(60),
                    order: 2,
                    language: Some("en-US".to_string()),
                    suggested_image_ids: vec![],
                    media_generations: vec![],
                    quiz_config: None,
                    interactive_config: None,
                    project_config: None,
                },
            ])
        }

        async fn generate_scene_content(
            &self,
            _request: &LessonGenerationRequest,
            outline: &SceneOutline,
            _pdf_context: Option<&str>,
        ) -> Result<SceneContent> {
            Ok(match outline.scene_type {
                SceneType::Slide => SceneContent::Slide {
                    canvas: ai_tutor_domain::scene::SlideCanvas {
                        id: "canvas-1".to_string(),
                        viewport_width: 1000,
                        viewport_height: 563,
                        viewport_ratio: 0.5625,
                        theme: ai_tutor_domain::scene::SlideTheme {
                            background_color: "#ffffff".to_string(),
                            theme_colors: vec!["#1f2937".to_string()],
                            font_color: "#111827".to_string(),
                            font_name: "Geist".to_string(),
                        },
                        elements: vec![],
                        background: None,
                    },
                },
                SceneType::Quiz => SceneContent::Quiz {
                    questions: vec![QuizQuestion {
                        id: "q1".to_string(),
                        question_type: QuizQuestionType::Single,
                        question: "What is 2 + 2?".to_string(),
                        options: Some(vec![]),
                        answer: Some(vec!["4".to_string()]),
                        analysis: None,
                        comment_prompt: None,
                        has_answer: Some(true),
                        points: Some(1),
                    }],
                },
                SceneType::Interactive => SceneContent::Interactive {
                    url: "/interactive".to_string(),
                    html: None,
                    scientific_model: None,
                },
                SceneType::Pbl => SceneContent::Project {
                    project_config: ai_tutor_domain::scene::ProjectConfig {
                        summary: "Project summary".to_string(),
                        title: None,
                        driving_question: None,
                        final_deliverable: None,
                        target_skills: None,
                        milestones: None,
                        team_roles: None,
                        assessment_focus: None,
                        starter_prompt: None,
                        success_criteria: None,
                        facilitator_notes: None,
                        agent_roles: None,
                        issue_board: None,
                    },
                },
            })
        }

        async fn generate_scene_actions(
            &self,
            _request: &LessonGenerationRequest,
            outline: &SceneOutline,
            _content: &SceneContent,
            _pdf_context: Option<&str>,
        ) -> Result<Vec<LessonAction>> {
            Ok(vec![LessonAction::Speech {
                id: format!("action-{}", outline.id),
                title: Some(outline.title.clone()),
                description: Some("Narration".to_string()),
                text: format!("Let's learn about {}.", outline.title),
                audio_id: None,
                audio_url: None,
                voice: None,
                speed: None,
            }])
        }
    }

    #[async_trait]
    impl TtsProvider for StubTtsProvider {
        async fn synthesize(
            &self,
            _text: &str,
            _voice: Option<&str>,
            _speed: Option<f32>,
        ) -> Result<String> {
            Ok("data:audio/mpeg;base64,ZmFrZQ==".to_string())
        }
    }

    #[async_trait]
    impl TtsProvider for FailingTtsProvider {
        async fn synthesize(
            &self,
            _text: &str,
            _voice: Option<&str>,
            _speed: Option<f32>,
        ) -> Result<String> {
            Err(anyhow!("tts provider unavailable"))
        }
    }

    #[async_trait]
    impl ImageProvider for StubImageProvider {
        async fn generate_image(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            Ok("data:image/png;base64,ZmFrZQ==".to_string())
        }
    }

    #[async_trait]
    impl VideoProvider for StubVideoProvider {
        async fn generate_video(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            Ok("data:video/mp4;base64,ZmFrZQ==".to_string())
        }
    }

    #[async_trait]
    impl ImageProvider for AlwaysFailImageProvider {
        async fn generate_image(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            Err(anyhow!("missing api key"))
        }
    }

    #[async_trait]
    impl VideoProvider for FlakyVideoProvider {
        async fn generate_video(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> Result<String> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            let remaining = self.failures_before_success.load(Ordering::SeqCst);
            if remaining > 0 {
                self.failures_before_success.fetch_sub(1, Ordering::SeqCst);
                return Err(anyhow!("temporary upstream timeout"));
            }
            Ok("data:video/mp4;base64,ZmFrZQ==".to_string())
        }
    }

    #[async_trait]
    impl LessonGenerationPipeline for StubMediaPipeline {
        async fn generate_outlines(
            &self,
            request: &LessonGenerationRequest,
            _pdf_context: Option<&str>,
        ) -> Result<Vec<SceneOutline>> {
            Ok(vec![SceneOutline {
                id: "outline-1".to_string(),
                scene_type: SceneType::Slide,
                title: "Intro".to_string(),
                description: request.requirements.requirement.clone(),
                key_points: vec!["Point 1".to_string()],
                teaching_objective: Some("Understand basics".to_string()),
                estimated_duration: Some(120),
                order: 1,
                language: Some("en-US".to_string()),
                suggested_image_ids: vec![],
                media_generations: vec![MediaGenerationRequest {
                    element_id: "gen_img_1".to_string(),
                    media_type: MediaType::Image,
                    prompt: "A circle split into fractions".to_string(),
                    aspect_ratio: Some("16:9".to_string()),
                }],
                quiz_config: None,
                interactive_config: None,
                project_config: None,
            }])
        }

        async fn generate_scene_content(
            &self,
            _request: &LessonGenerationRequest,
            _outline: &SceneOutline,
            _pdf_context: Option<&str>,
        ) -> Result<SceneContent> {
            Ok(SceneContent::Slide {
                canvas: ai_tutor_domain::scene::SlideCanvas {
                    id: "canvas-1".to_string(),
                    viewport_width: 1000,
                    viewport_height: 563,
                    viewport_ratio: 0.5625,
                    theme: ai_tutor_domain::scene::SlideTheme {
                        background_color: "#ffffff".to_string(),
                        theme_colors: vec!["#1f2937".to_string()],
                        font_color: "#111827".to_string(),
                        font_name: "Geist".to_string(),
                    },
                    elements: vec![ai_tutor_domain::scene::SlideElement::Image {
                        id: "gen_img_1".to_string(),
                        left: 0.0,
                        top: 0.0,
                        width: 500.0,
                        height: 280.0,
                        src: "gen_img_1".to_string(),
                    }],
                    background: None,
                },
            })
        }

        async fn generate_scene_actions(
            &self,
            _request: &LessonGenerationRequest,
            outline: &SceneOutline,
            _content: &SceneContent,
            _pdf_context: Option<&str>,
        ) -> Result<Vec<LessonAction>> {
            Ok(vec![LessonAction::Speech {
                id: format!("action-{}", outline.id),
                title: Some(outline.title.clone()),
                description: Some("Narration".to_string()),
                text: format!("Let's learn about {}.", outline.title),
                audio_id: None,
                audio_url: None,
                voice: None,
                speed: None,
            }])
        }
    }

    #[async_trait]
    impl LessonGenerationPipeline for StubVideoMediaPipeline {
        async fn generate_outlines(
            &self,
            request: &LessonGenerationRequest,
            _pdf_context: Option<&str>,
        ) -> Result<Vec<SceneOutline>> {
            Ok(vec![SceneOutline {
                id: "outline-1".to_string(),
                scene_type: SceneType::Slide,
                title: "Intro Video".to_string(),
                description: request.requirements.requirement.clone(),
                key_points: vec!["Point 1".to_string()],
                teaching_objective: Some("Understand basics".to_string()),
                estimated_duration: Some(120),
                order: 1,
                language: Some("en-US".to_string()),
                suggested_image_ids: vec![],
                media_generations: vec![MediaGenerationRequest {
                    element_id: "gen_vid_1".to_string(),
                    media_type: MediaType::Video,
                    prompt: "A short animation showing fractions splitting a circle".to_string(),
                    aspect_ratio: Some("16:9".to_string()),
                }],
                quiz_config: None,
                interactive_config: None,
                project_config: None,
            }])
        }

        async fn generate_scene_content(
            &self,
            _request: &LessonGenerationRequest,
            _outline: &SceneOutline,
            _pdf_context: Option<&str>,
        ) -> Result<SceneContent> {
            Ok(SceneContent::Slide {
                canvas: ai_tutor_domain::scene::SlideCanvas {
                    id: "canvas-1".to_string(),
                    viewport_width: 1000,
                    viewport_height: 563,
                    viewport_ratio: 0.5625,
                    theme: ai_tutor_domain::scene::SlideTheme {
                        background_color: "#ffffff".to_string(),
                        theme_colors: vec!["#1f2937".to_string()],
                        font_color: "#111827".to_string(),
                        font_name: "Geist".to_string(),
                    },
                    elements: vec![ai_tutor_domain::scene::SlideElement::Video {
                        id: "gen_vid_1".to_string(),
                        left: 0.0,
                        top: 0.0,
                        width: 500.0,
                        height: 280.0,
                        src: "gen_vid_1".to_string(),
                    }],
                    background: None,
                },
            })
        }

        async fn generate_scene_actions(
            &self,
            _request: &LessonGenerationRequest,
            outline: &SceneOutline,
            _content: &SceneContent,
            _pdf_context: Option<&str>,
        ) -> Result<Vec<LessonAction>> {
            Ok(vec![LessonAction::Speech {
                id: format!("action-{}", outline.id),
                title: Some(outline.title.clone()),
                description: Some("Narration".to_string()),
                text: format!("Let's learn about {}.", outline.title),
                audio_id: None,
                audio_url: None,
                voice: None,
                speed: None,
            }])
        }
    }

    #[derive(Default)]
    struct InMemoryLessonRepository {
        lessons: Mutex<HashMap<String, Lesson>>,
    }

    #[async_trait]
    impl LessonRepository for InMemoryLessonRepository {
        async fn save_lesson(&self, lesson: &Lesson) -> std::result::Result<(), String> {
            self.lessons
                .lock()
                .unwrap()
                .insert(lesson.id.clone(), lesson.clone());
            Ok(())
        }

        async fn get_lesson(&self, lesson_id: &str) -> std::result::Result<Option<Lesson>, String> {
            Ok(self.lessons.lock().unwrap().get(lesson_id).cloned())
        }
    }

    #[derive(Default)]
    struct InMemoryJobRepository {
        jobs: Mutex<HashMap<String, LessonGenerationJob>>,
        update_messages: Mutex<HashMap<String, Vec<String>>>,
    }

    impl InMemoryJobRepository {
        fn messages_for_job(&self, job_id: &str) -> Vec<String> {
            self.update_messages
                .lock()
                .unwrap()
                .get(job_id)
                .cloned()
                .unwrap_or_default()
        }
    }

    #[async_trait]
    impl LessonJobRepository for InMemoryJobRepository {
        async fn create_job(&self, job: &LessonGenerationJob) -> std::result::Result<(), String> {
            self.jobs
                .lock()
                .unwrap()
                .insert(job.id.clone(), job.clone());
            Ok(())
        }

        async fn update_job(&self, job: &LessonGenerationJob) -> std::result::Result<(), String> {
            self.jobs
                .lock()
                .unwrap()
                .insert(job.id.clone(), job.clone());
            self.update_messages
                .lock()
                .unwrap()
                .entry(job.id.clone())
                .or_default()
                .push(job.message.clone());
            Ok(())
        }

        async fn get_job(
            &self,
            job_id: &str,
        ) -> std::result::Result<Option<LessonGenerationJob>, String> {
            Ok(self.jobs.lock().unwrap().get(job_id).cloned())
        }

        async fn list_all_jobs(
            &self,
            limit: usize,
        ) -> std::result::Result<Vec<LessonGenerationJob>, String> {
            Ok(self
                .jobs
                .lock()
                .unwrap()
                .values()
                .take(limit)
                .cloned()
                .collect())
        }
    }

    fn sample_request() -> LessonGenerationRequest {
        LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach me fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
            },
            pdf_content: None,
            pdf_images: vec![],
            enable_web_search: false,
            enable_image_generation: false,
            enable_video_generation: false,
            enable_tts: false,
            agent_mode: AgentMode::Default,
            account_id: None,
            school_id: None,
            quality_mode: None,
            learning_mode: None,
            precharged_credits: None,
            extra_scenes_consented: false,
        }
    }

    #[tokio::test]
    async fn generates_and_persists_lesson() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());
        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        );

        let output = orchestrator
            .generate_lesson(sample_request(), "http://localhost:3000")
            .await
            .unwrap();

        assert_eq!(output.lesson.scenes.len(), 2);
        assert!(matches!(
            output.job.status,
            LessonGenerationJobStatus::Succeeded
        ));
        assert!(output.job.result.is_some());

        let persisted = lessons.get_lesson(&output.lesson.id).await.unwrap();
        assert!(persisted.is_some());
        let persisted_job = jobs.get_job(&output.job.id).await.unwrap();
        assert!(persisted_job.is_some());
    }

    #[tokio::test]
    async fn enriches_speech_actions_when_tts_is_enabled() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());
        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_tts(Arc::new(StubTtsProvider));

        let mut request = sample_request();
        request.enable_tts = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        match &output.lesson.scenes[0].actions[0] {
            LessonAction::Speech { audio_url, .. } => {
                assert_eq!(
                    audio_url.as_deref(),
                    Some("data:audio/mpeg;base64,ZmFrZQ==")
                );
            }
            _ => panic!("expected speech action"),
        }
    }

    #[tokio::test]
    async fn continues_when_tts_fails_for_actions() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());
        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_tts(Arc::new(FailingTtsProvider));

        let mut request = sample_request();
        request.enable_tts = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        assert!(matches!(
            output.job.status,
            LessonGenerationJobStatus::Succeeded
        ));
        match &output.lesson.scenes[0].actions[0] {
            LessonAction::Speech { audio_url, .. } => {
                assert!(audio_url.is_none());
            }
            _ => panic!("expected speech action"),
        }

        let messages = jobs.messages_for_job(&output.job.id);
        assert!(messages
            .iter()
            .any(|message| { message.contains("Teacher audio completed with partial fallback") }));
    }

    #[tokio::test]
    async fn persists_tts_audio_when_asset_storage_is_configured() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());
        let temp_root = std::env::temp_dir().join(format!(
            "ai-tutor-orchestrator-audio-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_tts(Arc::new(StubTtsProvider))
        .with_asset_store(Arc::new(LocalFileAssetStore::new(
            &temp_root,
            "http://localhost:3000",
        )));

        let mut request = sample_request();
        request.enable_tts = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        match &output.lesson.scenes[0].actions[0] {
            LessonAction::Speech { audio_url, .. } => {
                let url = audio_url.as_deref().unwrap();
                assert!(url.starts_with("http://localhost:3000/api/assets/audio/"));
            }
            _ => panic!("expected speech action"),
        }
    }

    #[tokio::test]
    async fn persists_generated_image_assets_when_media_is_enabled() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());
        let temp_root = std::env::temp_dir().join(format!(
            "ai-tutor-orchestrator-media-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubMediaPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_image_provider(Arc::new(StubImageProvider))
        .with_asset_store(Arc::new(LocalFileAssetStore::new(
            &temp_root,
            "http://localhost:3000",
        )));

        let mut request = sample_request();
        request.enable_image_generation = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        match &output.lesson.scenes[0].content {
            SceneContent::Slide { canvas } => match &canvas.elements[0] {
                ai_tutor_domain::scene::SlideElement::Image { src, .. } => {
                    assert!(src.starts_with("http://localhost:3000/api/assets/media/"));
                }
                _ => panic!("expected image element"),
            },
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn media_generation_reports_per_asset_job_progress_messages() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());

        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubMediaPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_image_provider(Arc::new(StubImageProvider));

        let mut request = sample_request();
        request.enable_image_generation = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        let messages = jobs.messages_for_job(&output.job.id);
        assert!(messages
            .iter()
            .any(|message| message.contains("Generating media asset 1/1 (image:gen_img_1)")));
        assert!(messages
            .iter()
            .any(|message| message.contains("Media generation complete. success=1 failed=0")));
    }

    #[tokio::test]
    async fn persists_generated_video_assets_when_media_is_enabled() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());
        let temp_root = std::env::temp_dir().join(format!(
            "ai-tutor-orchestrator-video-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubVideoMediaPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_video_provider(Arc::new(StubVideoProvider))
        .with_asset_store(Arc::new(LocalFileAssetStore::new(
            &temp_root,
            "http://localhost:3000",
        )));

        let mut request = sample_request();
        request.enable_video_generation = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        match &output.lesson.scenes[0].content {
            SceneContent::Slide { canvas } => match &canvas.elements[0] {
                ai_tutor_domain::scene::SlideElement::Video { src, .. } => {
                    assert!(src.starts_with("http://localhost:3000/api/assets/media/"));
                }
                _ => panic!("expected video element"),
            },
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn media_generation_falls_back_when_image_provider_fails_non_retryable() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());

        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubMediaPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_image_provider(Arc::new(AlwaysFailImageProvider));

        let mut request = sample_request();
        request.enable_image_generation = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        assert!(matches!(
            output.job.status,
            LessonGenerationJobStatus::Succeeded
        ));
        match &output.lesson.scenes[0].content {
            SceneContent::Slide { canvas } => match &canvas.elements[0] {
                ai_tutor_domain::scene::SlideElement::Image { src, .. } => {
                    assert!(src.starts_with("data:image/svg+xml"));
                }
                _ => panic!("expected image element"),
            },
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn media_generation_retries_transient_video_failures_before_succeeding() {
        let lessons = Arc::new(InMemoryLessonRepository::default());
        let jobs = Arc::new(InMemoryJobRepository::default());
        let flaky_video = Arc::new(FlakyVideoProvider {
            failures_before_success: AtomicUsize::new(2),
            call_count: AtomicUsize::new(0),
        });

        let orchestrator = LessonGenerationOrchestrator::new(
            Arc::new(StubVideoMediaPipeline),
            Arc::clone(&lessons),
            Arc::clone(&jobs),
        )
        .with_video_provider(flaky_video.clone());

        let mut request = sample_request();
        request.enable_video_generation = true;

        let output = orchestrator
            .generate_lesson(request, "http://localhost:3000")
            .await
            .unwrap();

        assert!(matches!(
            output.job.status,
            LessonGenerationJobStatus::Succeeded
        ));
        assert_eq!(flaky_video.call_count.load(Ordering::SeqCst), 3);
        match &output.lesson.scenes[0].content {
            SceneContent::Slide { canvas } => match &canvas.elements[0] {
                ai_tutor_domain::scene::SlideElement::Video { src, .. } => {
                    assert!(src.starts_with("data:video/mp4;base64"));
                }
                _ => panic!("expected video element"),
            },
            _ => panic!("expected slide content"),
        }
    }
}
