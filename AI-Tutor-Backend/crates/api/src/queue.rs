use std::{path::{Path, PathBuf}, sync::Arc, time::Duration};

use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tracing::{error, info, warn};

use ai_tutor_domain::{
    generation::LessonGenerationRequest,
    job::{LessonGenerationJob, LessonGenerationJobStatus, LessonGenerationStep},
};
use ai_tutor_storage::{filesystem::FileStorage, repositories::LessonJobRepository};

use crate::app::LiveLessonAppService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedLessonRequest {
    pub lesson_id: String,
    pub job: LessonGenerationJob,
    pub request: LessonGenerationRequest,
    pub model_string: Option<String>,
    #[serde(default)]
    pub attempt: u32,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default = "Utc::now")]
    pub queued_at: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub available_at: DateTime<Utc>,
}

pub struct FileBackedLessonQueue {
    storage: Arc<FileStorage>,
}

const DEFAULT_MAX_ATTEMPTS: u32 = 3;
const STALE_WORKING_TIMEOUT: Duration = Duration::from_secs(5 * 60);

fn default_max_attempts() -> u32 {
    DEFAULT_MAX_ATTEMPTS
}

impl FileBackedLessonQueue {
    pub fn new(storage: Arc<FileStorage>) -> Self {
        Self { storage }
    }

    pub fn queue_dir(&self) -> PathBuf {
        self.storage.root_dir().join("lesson-queue")
    }

    pub async fn enqueue(&self, queued: &QueuedLessonRequest) -> Result<()> {
        fs::create_dir_all(self.queue_dir()).await?;
        let path = self.queue_dir().join(format!("{}.json", queued.job.id));
        let bytes = serde_json::to_vec_pretty(&normalized_queued_request(queued.clone()))?;
        fs::write(path, bytes).await?;
        Ok(())
    }

    async fn list_queue_files(&self) -> Result<Vec<PathBuf>> {
        let mut files = Vec::new();
        fs::create_dir_all(self.queue_dir()).await?;
        let mut dir = fs::read_dir(self.queue_dir()).await?;
        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            let is_json = path.extension().and_then(|ext| ext.to_str()) == Some("json");
            let is_working = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.ends_with(".working"))
                .unwrap_or(false);
            if is_json || is_working {
                files.push(path);
            }
        }
        files.sort();
        Ok(files)
    }

    async fn read_queued_request(path: &Path) -> Result<QueuedLessonRequest> {
        let bytes = fs::read(path).await?;
        let queued: QueuedLessonRequest = serde_json::from_slice(&bytes)?;
        Ok(normalized_queued_request(queued))
    }

    async fn write_queued_request(path: &Path, queued: &QueuedLessonRequest) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(&normalized_queued_request(queued.clone()))?;
        fs::write(path, bytes).await?;
        Ok(())
    }

    async fn reset_stale_working_file(path: &Path) -> Result<Option<PathBuf>> {
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            return Ok(None);
        };
        if !file_name.ends_with(".working") {
            return Ok(None);
        }

        let metadata = match fs::metadata(path).await {
            Ok(metadata) => metadata,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        let modified = metadata.modified()?;
        let elapsed = modified.elapsed().unwrap_or_default();
        if elapsed < STALE_WORKING_TIMEOUT {
            return Ok(None);
        }

        let original_name = file_name.trim_end_matches(".working");
        let original_path = path.with_file_name(original_name);
        match fs::rename(path, &original_path).await {
            Ok(()) => {
                warn!(
                    "AI Tutor queue reclaimed stale working file {:?} after {:?}",
                    path, elapsed
                );
                Ok(Some(original_path))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    async fn claim_file(path: &Path) -> Result<PathBuf> {
        let claimed = if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.ends_with(".working"))
            .unwrap_or(false)
        {
            path.to_path_buf()
        } else {
            path.with_extension("json.working")
        };

        if claimed != path {
            fs::rename(path, &claimed).await?;
        }
        Ok(claimed)
    }

    pub async fn process_pending_once(
        &self,
        service: Arc<LiveLessonAppService>,
    ) -> Result<usize> {
        let mut processed = 0usize;
        let files = self.list_queue_files().await?;
        for mut path in files {
            if let Some(reset_path) = Self::reset_stale_working_file(&path).await? {
                path = reset_path;
            }

            if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.ends_with(".working"))
                .unwrap_or(false)
            {
                continue;
            }

            let claimed = match Self::claim_file(&path).await {
                Ok(claimed) => claimed,
                Err(err) => {
                    error!("AI Tutor queue claim error for {:?}: {}", path, err);
                    continue;
                }
            };

            match self.process_claimed_file(&claimed, Arc::clone(&service)).await {
                Ok(()) => {
                    processed += 1;
                }
                Err(err) => {
                    error!("AI Tutor queue processing error for {:?}: {}", claimed, err);
                }
            }
        }

        Ok(processed)
    }

    async fn process_claimed_file(
        &self,
        path: &Path,
        service: Arc<LiveLessonAppService>,
    ) -> Result<()> {
        let queued = Self::read_queued_request(path).await?;
        if queued.available_at > Utc::now() {
            let queued_path = release_claimed_path(path);
            if queued_path != path {
                fs::rename(path, &queued_path).await?;
            }
            return Ok(());
        }

        let processing_result = match service
            .build_orchestrator(&queued.request, queued.model_string.as_deref())
        {
            Ok(orchestrator) => orchestrator
                .generate_lesson_for_job(
                    queued.request.clone(),
                    queued.lesson_id.clone(),
                    queued.job.clone(),
                    service.base_url(),
                    false,
                )
                .await
                .map(|_| ()),
            Err(err) => Err(err),
        };

        match processing_result {
            Ok(_) => {
                fs::remove_file(path).await?;
                Ok(())
            }
            Err(err) => {
                let error_message = err.to_string();
                if should_retry_queue_error(&error_message)
                    && queued.attempt + 1 < queued.max_attempts
                {
                    let mut retried = queued.clone();
                    retried.attempt += 1;
                    retried.last_error = Some(error_message.clone());
                    retried.job.status = LessonGenerationJobStatus::Queued;
                    retried.job.step = LessonGenerationStep::Queued;
                    retried.job.progress = 0;
                    retried.job.message = format!(
                        "Queued retry {}/{} after transient failure",
                        retried.attempt + 1,
                        retried.max_attempts
                    );
                    retried.job.error = Some(error_message.clone());
                    retried.job.started_at = None;
                    retried.job.completed_at = None;
                    retried.job.updated_at = Utc::now();
                    retried.available_at = Utc::now() + retry_backoff(retried.attempt);

                    self.storage
                        .update_job(&retried.job)
                        .await
                        .map_err(|update_err| anyhow!(update_err))?;

                    let queued_path = release_claimed_path(path);
                    Self::write_queued_request(&queued_path, &retried).await?;
                    if queued_path != path {
                        let _ = fs::remove_file(path).await;
                    }
                    info!(
                        "AI Tutor queue scheduled retry {}/{} for job {}",
                        retried.attempt + 1,
                        retried.max_attempts,
                        retried.job.id
                    );
                    return Ok(());
                }

                let mut failed_job = queued.job.clone();
                failed_job.status = LessonGenerationJobStatus::Failed;
                failed_job.step = LessonGenerationStep::Failed;
                failed_job.progress = 100;
                failed_job.message = "Lesson generation failed".to_string();
                failed_job.error = Some(error_message);
                failed_job.updated_at = chrono::Utc::now();
                failed_job.completed_at = Some(chrono::Utc::now());
                self.storage
                    .update_job(&failed_job)
                    .await
                    .map_err(|update_err| anyhow!(update_err))?;
                fs::remove_file(path).await?;
                Err(err)
            }
        }
    }

    pub fn spawn_worker_loop(
        self: Arc<Self>,
        service: Arc<LiveLessonAppService>,
        poll_interval: Duration,
    ) {
        tokio::spawn(async move {
            loop {
                if let Err(err) = self.process_pending_once(Arc::clone(&service)).await {
                    error!("AI Tutor queue worker loop error: {}", err);
                }
                tokio::time::sleep(poll_interval).await;
            }
        });
    }
}

fn normalized_queued_request(mut queued: QueuedLessonRequest) -> QueuedLessonRequest {
    if queued.max_attempts == 0 {
        queued.max_attempts = DEFAULT_MAX_ATTEMPTS;
    }
    queued
}

fn release_claimed_path(path: &Path) -> PathBuf {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return path.to_path_buf();
    };
    if let Some(original_name) = file_name.strip_suffix(".working") {
        path.with_file_name(original_name)
    } else {
        path.to_path_buf()
    }
}

fn retry_backoff(attempt: u32) -> chrono::Duration {
    let seconds = match attempt {
        0 => 1,
        1 => 5,
        _ => 15,
    };
    chrono::Duration::seconds(seconds)
}

fn should_retry_queue_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    if lower.contains("missing api key")
        || lower.contains("invalid api key")
        || lower.contains("unauthorized")
        || lower.contains("forbidden")
        || lower.contains("not implemented")
        || lower.contains("no image provider is configured")
        || lower.contains("no video provider is implemented")
        || lower.contains("no tts provider is configured")
    {
        return false;
    }

    lower.contains("timeout")
        || lower.contains("tempor")
        || lower.contains("rate limit")
        || lower.contains("too many requests")
        || lower.contains("connection reset")
        || lower.contains("connection refused")
        || lower.contains("network")
        || lower.contains("unavailable")
        || lower.contains("503")
        || lower.contains("502")
        || lower.contains("504")
}

pub fn spawn_one_shot_queue_kick(queue: Arc<FileBackedLessonQueue>, service: Arc<LiveLessonAppService>) {
    tokio::spawn(async move {
        if let Err(err) = queue.process_pending_once(service).await {
            error!("AI Tutor queue kick error: {}", err);
        }
    });
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, sync::{Arc, Mutex}, time::Duration};

    use anyhow::anyhow;
    use async_trait::async_trait;
    use chrono::Duration as ChronoDuration;

    use ai_tutor_domain::{
        generation::{AgentMode, Language, LessonGenerationRequest, UserRequirements},
        job::{LessonGenerationJobStatus, LessonGenerationStep},
        provider::ModelConfig,
    };
    use ai_tutor_providers::{
        config::{ServerProviderConfig, ServerProviderEntry},
        traits::{ImageProvider, ImageProviderFactory, LlmProvider, LlmProviderFactory, TtsProvider, TtsProviderFactory, VideoProvider, VideoProviderFactory},
    };
    use ai_tutor_storage::{filesystem::FileStorage, repositories::{LessonJobRepository, LessonRepository}};

    use crate::app::LiveLessonAppService;
    use ai_tutor_orchestrator::pipeline::build_queued_job;

    use super::{default_max_attempts, FileBackedLessonQueue, QueuedLessonRequest, STALE_WORKING_TIMEOUT};

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
    struct AlwaysFailLlmProviderFactory {
        error_message: String,
    }

    #[async_trait]
    impl LlmProvider for FakeLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> anyhow::Result<String> {
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("missing fake llm response"));
            }
            Ok(responses.remove(0))
        }
    }

    impl LlmProviderFactory for FakeLlmProviderFactory {
        fn build(&self, _model_config: ModelConfig) -> anyhow::Result<Box<dyn LlmProvider>> {
            Ok(Box::new(FakeLlmProvider {
                responses: Mutex::new(vec![
                    r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide","media_generations":[{"element_id":"gen_img_1","media_type":"image","prompt":"A pizza cut into fractions","aspect_ratio":"16:9"}]},{"title":"Fraction Quiz","description":"Check learning","key_points":["Identify numerator"],"scene_type":"quiz"}]}"#.to_string(),
                    r#"{"elements":[{"kind":"text","content":"Fractions represent parts of a whole.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"A fraction shows part of a whole."}]}"#.to_string(),
                    r#"{"questions":[{"question":"What part names the top number in a fraction?","options":["Numerator","Denominator"],"answer":["Numerator"]}]}"#.to_string(),
                    r#"{"actions":[{"action_type":"speech","text":"Now let's check what you learned."}]}"#.to_string(),
                ]),
            }))
        }
    }

    #[async_trait]
    impl ImageProvider for FakeImageProvider {
        async fn generate_image(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> anyhow::Result<String> {
            Ok("data:image/png;base64,ZmFrZQ==".to_string())
        }
    }

    impl ImageProviderFactory for FakeImageProviderFactory {
        fn build(&self, _model_config: ModelConfig) -> anyhow::Result<Box<dyn ImageProvider>> {
            Ok(Box::new(FakeImageProvider))
        }
    }

    #[async_trait]
    impl VideoProvider for FakeVideoProvider {
        async fn generate_video(&self, _prompt: &str, _aspect_ratio: Option<&str>) -> anyhow::Result<String> {
            Ok("data:video/mp4;base64,ZmFrZQ==".to_string())
        }
    }

    impl VideoProviderFactory for FakeVideoProviderFactory {
        fn build(&self, _model_config: ModelConfig) -> anyhow::Result<Box<dyn VideoProvider>> {
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
        ) -> anyhow::Result<String> {
            Ok("data:audio/mpeg;base64,ZmFrZQ==".to_string())
        }
    }

    impl TtsProviderFactory for FakeTtsProviderFactory {
        fn build(&self, _model_config: ModelConfig) -> anyhow::Result<Box<dyn TtsProvider>> {
            Ok(Box::new(FakeTtsProvider))
        }
    }

    impl LlmProviderFactory for AlwaysFailLlmProviderFactory {
        fn build(&self, _model_config: ModelConfig) -> anyhow::Result<Box<dyn LlmProvider>> {
            Err(anyhow!(self.error_message.clone()))
        }
    }

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-tutor-queue-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn sample_request() -> LessonGenerationRequest {
        LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
                web_search: Some(false),
            },
            pdf_content: None,
            enable_web_search: false,
            enable_image_generation: true,
            enable_video_generation: false,
            enable_tts: true,
            agent_mode: AgentMode::Default,
        }
    }

    fn build_service(storage: Arc<FileStorage>) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ServerProviderEntry {
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

    fn build_failing_service(storage: Arc<FileStorage>, error_message: &str) -> Arc<LiveLessonAppService> {
        Arc::new(LiveLessonAppService::new(
            storage,
            Arc::new(ServerProviderConfig {
                providers: std::collections::HashMap::from([(
                    "openai".to_string(),
                    ServerProviderEntry {
                        api_key: Some("test-key".to_string()),
                        base_url: Some("https://example.test/v1".to_string()),
                        proxy: None,
                        models: vec![],
                    },
                )]),
            }),
            Arc::new(AlwaysFailLlmProviderFactory {
                error_message: error_message.to_string(),
            }),
            Arc::new(FakeImageProviderFactory),
            Arc::new(FakeVideoProviderFactory),
            Arc::new(FakeTtsProviderFactory),
            "http://localhost:8099".to_string(),
        ))
    }

    #[tokio::test]
    async fn processes_persisted_queue_entry_and_removes_queue_file() {
        let storage = Arc::new(FileStorage::new(temp_root()));
        let queue = FileBackedLessonQueue::new(Arc::clone(&storage));
        let service = build_service(Arc::clone(&storage));
        let request = sample_request();
        let lesson_id = "lesson-queue-1".to_string();
        let job = build_queued_job("job-queue-1".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: lesson_id.clone(),
                job: job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: default_max_attempts(),
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();

        let processed = queue.process_pending_once(Arc::clone(&service)).await.unwrap();
        assert_eq!(processed, 1);

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(persisted_job.status, LessonGenerationJobStatus::Succeeded));
        let lesson = storage.get_lesson(&lesson_id).await.unwrap();
        assert!(lesson.is_some());
        let queue_file = queue.queue_dir().join(format!("{}.json", job.id));
        let queue_working_file = queue.queue_dir().join(format!("{}.json.working", job.id));
        assert!(!queue_file.exists());
        assert!(!queue_working_file.exists());
    }

    #[tokio::test]
    async fn retries_transient_queue_failures_and_keeps_queue_file() {
        let storage = Arc::new(FileStorage::new(temp_root()));
        let queue = FileBackedLessonQueue::new(Arc::clone(&storage));
        let service = build_failing_service(Arc::clone(&storage), "temporary upstream timeout");
        let request = sample_request();
        let lesson_id = "lesson-queue-retry".to_string();
        let job = build_queued_job("job-queue-retry".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: lesson_id.clone(),
                job: job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: default_max_attempts(),
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();

        let processed = queue.process_pending_once(Arc::clone(&service)).await.unwrap();
        assert_eq!(processed, 1);

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(persisted_job.status, LessonGenerationJobStatus::Queued));
        assert!(matches!(persisted_job.step, LessonGenerationStep::Queued));
        assert!(persisted_job.error.as_deref().unwrap_or_default().contains("temporary upstream timeout"));

        let queue_file = queue.queue_dir().join(format!("{}.json", job.id));
        assert!(queue_file.exists());
        let queued = FileBackedLessonQueue::read_queued_request(&queue_file).await.unwrap();
        assert_eq!(queued.attempt, 1);
        assert!(queued.last_error.as_deref().unwrap_or_default().contains("temporary upstream timeout"));
        assert!(queued.available_at > chrono::Utc::now());
    }

    #[tokio::test]
    async fn fails_queue_entry_immediately_for_non_retryable_errors() {
        let storage = Arc::new(FileStorage::new(temp_root()));
        let queue = FileBackedLessonQueue::new(Arc::clone(&storage));
        let service = build_failing_service(Arc::clone(&storage), "missing api key");
        let request = sample_request();
        let lesson_id = "lesson-queue-fail".to_string();
        let job = build_queued_job("job-queue-fail".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id,
                job: job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: default_max_attempts(),
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();

        let result = queue.process_pending_once(Arc::clone(&service)).await;
        assert!(result.is_ok());

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(persisted_job.status, LessonGenerationJobStatus::Failed));
        assert!(matches!(persisted_job.step, LessonGenerationStep::Failed));
        let queue_file = queue.queue_dir().join(format!("{}.json", job.id));
        assert!(!queue_file.exists());
    }

    #[tokio::test]
    async fn reclaims_stale_working_files_and_processes_them() {
        let storage = Arc::new(FileStorage::new(temp_root()));
        let queue = FileBackedLessonQueue::new(Arc::clone(&storage));
        let service = build_service(Arc::clone(&storage));
        let request = sample_request();
        let lesson_id = "lesson-queue-stale".to_string();
        let job = build_queued_job("job-queue-stale".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        let working_path = queue.queue_dir().join(format!("{}.json.working", job.id));
        tokio::fs::create_dir_all(queue.queue_dir()).await.unwrap();
        FileBackedLessonQueue::write_queued_request(
            &working_path,
            &QueuedLessonRequest {
                lesson_id: lesson_id.clone(),
                job: job.clone(),
                request,
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: default_max_attempts(),
                last_error: None,
                queued_at: chrono::Utc::now() - ChronoDuration::seconds(30),
                available_at: chrono::Utc::now() - ChronoDuration::seconds(30),
            },
        )
        .await
        .unwrap();

        let stale_time = filetime::FileTime::from_system_time(
            std::time::SystemTime::now() - STALE_WORKING_TIMEOUT - Duration::from_secs(5),
        );
        filetime::set_file_mtime(&working_path, stale_time).unwrap();

        let processed = queue.process_pending_once(Arc::clone(&service)).await.unwrap();
        assert_eq!(processed, 1);

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(persisted_job.status, LessonGenerationJobStatus::Succeeded));
        assert!(!working_path.exists());
    }
}
