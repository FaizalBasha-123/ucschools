use std::sync::Arc;
use std::path::PathBuf;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Utc;
use uuid::Uuid;

use ai_tutor_domain::{
    action::LessonAction,
    generation::{Language, LessonGenerationRequest},
    job::{LessonGenerationJob, LessonGenerationJobInputSummary, LessonGenerationJobResult, LessonGenerationJobStatus, LessonGenerationStep},
    lesson::Lesson,
    scene::{Scene, SceneContent, SceneOutline, Stage},
};
use ai_tutor_media::{apply_tts_results, collect_tts_tasks, persist_inline_audio_assets};
use ai_tutor_media::{collect_media_tasks, persist_inline_media_assets, replace_media_placeholders};
use ai_tutor_providers::traits::{ImageProvider, TtsProvider, VideoProvider};
use ai_tutor_storage::repositories::{LessonJobRepository, LessonRepository};

use crate::state::{GenerationOutput, GenerationState};

#[async_trait]
pub trait LessonGenerationPipeline: Send + Sync {
    async fn generate_outlines(&self, request: &LessonGenerationRequest) -> Result<Vec<SceneOutline>>;

    async fn generate_scene_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
    ) -> Result<SceneContent>;

    async fn generate_scene_actions(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        content: &SceneContent,
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
    asset_root: Option<PathBuf>,
    asset_base_url: Option<String>,
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
            asset_root: None,
            asset_base_url: None,
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

    pub fn with_asset_storage(
        mut self,
        asset_root: impl Into<PathBuf>,
        asset_base_url: impl Into<String>,
    ) -> Self {
        self.asset_root = Some(asset_root.into());
        self.asset_base_url = Some(asset_base_url.into());
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

        let mut state = GenerationState {
            request_id,
            lesson_id: lesson_id.clone(),
            request,
            job,
            stage,
            outlines: Vec::new(),
            scenes: Vec::new(),
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
        update_job(
            &self.jobs,
            &mut state.job,
            LessonGenerationJobStatus::Running,
            LessonGenerationStep::GeneratingOutlines,
            15,
            "Generating scene outlines",
        )
        .await?;

        state.outlines = self.pipeline.generate_outlines(&state.request).await?;
        state.job.total_scenes = Some(state.outlines.len() as i32);
        state.job.updated_at = Utc::now();
        self.jobs
            .update_job(&state.job)
            .await
            .map_err(|err| anyhow!(err))?;

        if state.outlines.is_empty() {
            return Err(anyhow!("No scene outlines were generated"));
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

        for (index, outline) in state.outlines.iter().enumerate() {
            let content = self
                .pipeline
                .generate_scene_content(&state.request, outline)
                .await?;
            let actions = self
                .pipeline
                .generate_scene_actions(&state.request, outline, &content)
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
                scenes_generated,
                total,
                outline.title
            );
            state.job.updated_at = Utc::now();
            self.jobs
                .update_job(&state.job)
                .await
                .map_err(|err| anyhow!(err))?;
        }

        let media_tasks = collect_media_tasks(&state.lesson_id, &state.outlines);
        if !media_tasks.is_empty() {
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

            for task in media_tasks {
                match task.media_type {
                    ai_tutor_domain::scene::MediaType::Image => {
                        let image = self.image.as_ref().ok_or_else(|| {
                            anyhow!("image generation requested but no image provider is configured")
                        })?;
                        let output_url = image
                            .generate_image(&task.prompt, task.aspect_ratio.as_deref())
                            .await?;
                        media_map.insert(task.element_id, output_url);
                    }
                    ai_tutor_domain::scene::MediaType::Video => {
                        let video = self.video.as_ref().ok_or_else(|| {
                            anyhow!("video generation requested but no video provider is configured")
                        })?;
                        let output_url = video
                            .generate_video(&task.prompt, task.aspect_ratio.as_deref())
                            .await?;
                        media_map.insert(task.element_id, output_url);
                    }
                }
            }

            replace_media_placeholders(&mut state.scenes, &media_map)?;

            if let (Some(asset_root), Some(asset_base_url)) =
                (&self.asset_root, &self.asset_base_url)
            {
                persist_inline_media_assets(
                    asset_root,
                    &state.lesson_id,
                    &mut state.scenes,
                    asset_base_url,
                )?;
            }
        }

        if state.request.enable_tts {
            if let Some(tts) = &self.tts {
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

                for task in tasks {
                    let audio_url = tts
                        .synthesize(&task.text, task.voice.as_deref(), task.speed)
                        .await?;
                    audio_map.insert(task.action_id, audio_url);
                }

                apply_tts_results(&mut state.scenes, &audio_map)?;

                if let (Some(asset_root), Some(asset_base_url)) =
                    (&self.asset_root, &self.asset_base_url)
                {
                    persist_inline_audio_assets(
                        asset_root,
                        &state.lesson_id,
                        &mut state.scenes,
                        asset_base_url,
                    )?;
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

        Ok(())
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

fn build_stage(lesson_id: &str, request: &LessonGenerationRequest, now: chrono::DateTime<Utc>) -> Stage {
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

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Mutex};

    use super::*;
    use ai_tutor_domain::{
        generation::{AgentMode, UserRequirements},
        scene::{MediaGenerationRequest, MediaType, QuizQuestion, QuizQuestionType, SceneType},
    };
    use ai_tutor_providers::traits::{ImageProvider, TtsProvider, VideoProvider};

    struct StubPipeline;
    struct StubTtsProvider;
    struct StubImageProvider;
    struct StubVideoProvider;
    struct StubMediaPipeline;
    struct StubVideoMediaPipeline;

    #[async_trait]
    impl LessonGenerationPipeline for StubPipeline {
        async fn generate_outlines(&self, request: &LessonGenerationRequest) -> Result<Vec<SceneOutline>> {
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
                },
                SceneType::Pbl => SceneContent::Project {
                    project_config: ai_tutor_domain::scene::ProjectConfig {
                        summary: "Project summary".to_string(),
                    },
                },
            })
        }

        async fn generate_scene_actions(
            &self,
            _request: &LessonGenerationRequest,
            outline: &SceneOutline,
            _content: &SceneContent,
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
    impl ImageProvider for StubImageProvider {
        async fn generate_image(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> Result<String> {
            Ok("data:image/png;base64,ZmFrZQ==".to_string())
        }
    }

    #[async_trait]
    impl VideoProvider for StubVideoProvider {
        async fn generate_video(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> Result<String> {
            Ok("data:video/mp4;base64,ZmFrZQ==".to_string())
        }
    }

    #[async_trait]
    impl LessonGenerationPipeline for StubMediaPipeline {
        async fn generate_outlines(&self, request: &LessonGenerationRequest) -> Result<Vec<SceneOutline>> {
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
        async fn generate_outlines(&self, request: &LessonGenerationRequest) -> Result<Vec<SceneOutline>> {
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
    }

    #[async_trait]
    impl LessonJobRepository for InMemoryJobRepository {
        async fn create_job(&self, job: &LessonGenerationJob) -> std::result::Result<(), String> {
            self.jobs.lock().unwrap().insert(job.id.clone(), job.clone());
            Ok(())
        }

        async fn update_job(&self, job: &LessonGenerationJob) -> std::result::Result<(), String> {
            self.jobs.lock().unwrap().insert(job.id.clone(), job.clone());
            Ok(())
        }

        async fn get_job(
            &self,
            job_id: &str,
        ) -> std::result::Result<Option<LessonGenerationJob>, String> {
            Ok(self.jobs.lock().unwrap().get(job_id).cloned())
        }
    }

    fn sample_request() -> LessonGenerationRequest {
        LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach me fractions".to_string(),
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
        assert!(matches!(output.job.status, LessonGenerationJobStatus::Succeeded));
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
                assert_eq!(audio_url.as_deref(), Some("data:audio/mpeg;base64,ZmFrZQ=="));
            }
            _ => panic!("expected speech action"),
        }
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
        .with_asset_storage(&temp_root, "http://localhost:3000");

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
        .with_asset_storage(&temp_root, "http://localhost:3000");

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
        .with_asset_storage(&temp_root, "http://localhost:3000");

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
}
