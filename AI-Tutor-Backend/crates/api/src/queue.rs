use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::{fs, sync::oneshot};
use tracing::{error, info, warn};

use ai_tutor_domain::{
    generation::LessonGenerationRequest,
    job::{LessonGenerationJob, LessonGenerationJobStatus, LessonGenerationStep},
};
use ai_tutor_storage::{filesystem::FileStorage, repositories::LessonJobRepository};

use crate::app::{LessonAppService, LiveLessonAppService};

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

#[async_trait]
pub trait LessonQueue: Send + Sync {
    async fn enqueue(&self, request: &QueuedLessonRequest) -> Result<()>;
    async fn claim_next(&self, worker_id: &str) -> Result<Option<QueuedLessonRequest>>;
    async fn heartbeat(&self, job_id: &str, worker_id: &str) -> Result<()>;
    async fn complete(&self, job_id: &str) -> Result<()>;
    async fn cancel(&self, job_id: &str) -> Result<QueueCancelResult>;
    async fn get_lease_counts(&self) -> Result<QueueLeaseCounts>;
    async fn get_pending_count(&self) -> Result<usize>;
    fn backend_label(&self) -> &'static str;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueCancelResult {
    Cancelled,
    AlreadyClaimed,
    NotFound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueueLeaseCounts {
    pub active: usize,
    pub stale: usize,
}

pub struct FileBackedLessonQueue {
    storage: Arc<FileStorage>,
}

#[async_trait]
impl LessonQueue for FileBackedLessonQueue {
    async fn enqueue(&self, request: &QueuedLessonRequest) -> Result<()> {
        self.enqueue_request(request).await
    }

    async fn claim_next(&self, _worker_id: &str) -> Result<Option<QueuedLessonRequest>> {
        let files = self.list_queue_files().await?;
        for mut path in files {
            if let Some(reset_path) = Self::reset_stale_working_file(&path).await? {
                path = reset_path;
            }

            if path.extension().and_then(|ext| ext.to_str()) == Some("working") {
                continue;
            }

            let claimed = Self::claim_file(&path).await?;
            return Ok(Some(Self::read_queued_request(&claimed).await?));
        }
        Ok(None)
    }

    async fn heartbeat(&self, _job_id: &str, _worker_id: &str) -> Result<()> {
        Ok(())
    }

    async fn complete(&self, job_id: &str) -> Result<()> {
        let working_path = self.queue_dir().join(format!("{}.json.working", job_id));
        if fs::try_exists(&working_path).await? {
            fs::remove_file(working_path).await?;
        }
        Ok(())
    }

    async fn cancel(&self, job_id: &str) -> Result<QueueCancelResult> {
        self.cancel_request(job_id).await
    }

    async fn get_lease_counts(&self) -> Result<QueueLeaseCounts> {
        self.lease_counts().await
    }

    async fn get_pending_count(&self) -> Result<usize> {
        self.pending_count().await
    }

    fn backend_label(&self) -> &'static str {
        "filesystem"
    }
}

const DEFAULT_MAX_ATTEMPTS: u32 = 3;
const STALE_WORKING_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const CLAIM_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub fn stale_working_timeout_ms() -> u64 {
    STALE_WORKING_TIMEOUT.as_millis() as u64
}

pub fn claim_heartbeat_interval_ms() -> u64 {
    CLAIM_HEARTBEAT_INTERVAL.as_millis() as u64
}

fn default_max_attempts() -> u32 {
    DEFAULT_MAX_ATTEMPTS
}

impl FileBackedLessonQueue {
    pub fn new(storage: Arc<FileStorage>) -> Self {
        Self {
            storage,
        }
    }

    pub fn queue_dir(&self) -> PathBuf {
        self.storage.root_dir().join("lesson-queue")
    }

    pub async fn enqueue_request(&self, request: &QueuedLessonRequest) -> Result<()> {
        fs::create_dir_all(self.queue_dir()).await?;
        let path = self.queue_dir().join(format!("{}.json", request.job.id));
        let bytes = serde_json::to_vec_pretty(&normalized_queued_request(request.clone()))?;
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
            path.with_extension("working")
        };

        if claimed != path {
            fs::rename(path, &claimed).await?;
        }
        Ok(claimed)
    }

    pub async fn process_pending_once(&self, service: Arc<LiveLessonAppService>) -> Result<usize> {
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

            match self
                .process_claimed_file(&claimed, Arc::clone(&service))
                .await
            {
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

        let (heartbeat_stop, heartbeat_handle) =
            Self::spawn_file_claim_heartbeat(path.to_path_buf(), queued.clone());

        let processing_result = match service
            .build_orchestrator(
                &queued.request,
                queued.model_string.as_deref(),
                Some(queued.lesson_id.clone()),
            )
            .await
        {
            Ok(orchestrator) => {
                orchestrator
                    .generate_lesson_for_job(
                        queued.request.clone(),
                        queued.lesson_id.clone(),
                        queued.job.clone(),
                        service.base_url(),
                        false,
                    )
                    .await
            }
            Err(err) => Err(err),
        };
        let _ = heartbeat_stop.send(());
        let _ = heartbeat_handle.await;

        match processing_result {
            Ok(output) => {
                service
                    .apply_credit_debit_for_output(&queued.request, &output.lesson)
                    .await
                    .map_err(|err| anyhow!(err))?;
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
        let worker_queue = Arc::clone(&self);
        tokio::spawn(async move {
            loop {
                if let Err(err) = worker_queue.process_pending_once(Arc::clone(&service)).await {
                    error!("AI Tutor queue worker loop error: {}", err);
                }
                tokio::time::sleep(poll_interval).await;
            }
        });
    }

    pub async fn pending_count(&self) -> Result<usize> {
        let mut count = 0usize;
        let files = self.list_queue_files().await?;
        for path in files {
            let is_working = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.ends_with(".working"))
                .unwrap_or(false);
            if !is_working {
                count += 1;
            }
        }
        Ok(count)
    }

    pub async fn lease_counts(&self) -> Result<QueueLeaseCounts> {
        let mut active = 0usize;
        let mut stale = 0usize;
        let files = self.list_queue_files().await?;
        for path in files {
            let is_working = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.ends_with(".working"))
                .unwrap_or(false);
            if !is_working {
                continue;
            }

            let metadata = match fs::metadata(&path).await {
                Ok(metadata) => metadata,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => return Err(err.into()),
            };
            let modified = metadata.modified()?;
            let elapsed = modified.elapsed().unwrap_or_default();
            if elapsed >= STALE_WORKING_TIMEOUT {
                stale += 1;
            } else {
                active += 1;
            }
        }

        Ok(QueueLeaseCounts { active, stale })
    }

    pub async fn cancel_request(&self, job_id: &str) -> Result<QueueCancelResult> {
        let queued_path = self.queue_dir().join(format!("{}.json", job_id));
        let working_path = self.queue_dir().join(format!("{}.json.working", job_id));

        if fs::try_exists(&queued_path).await? {
            fs::remove_file(queued_path).await?;
            return Ok(QueueCancelResult::Cancelled);
        }

        if fs::try_exists(&working_path).await? {
            return Ok(QueueCancelResult::AlreadyClaimed);
        }

        Ok(QueueCancelResult::NotFound)
    }

    fn spawn_file_claim_heartbeat(
        claimed_path: PathBuf,
        queued: QueuedLessonRequest,
    ) -> (oneshot::Sender<()>, tokio::task::JoinHandle<()>) {
        let (stop_tx, mut stop_rx) = oneshot::channel();
        let heartbeat_payload = serde_json::to_vec_pretty(&normalized_queued_request(queued))
            .unwrap_or_else(|_| b"{}".to_vec());
        let handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    _ = tokio::time::sleep(CLAIM_HEARTBEAT_INTERVAL) => {
                        match fs::write(&claimed_path, &heartbeat_payload).await {
                            Ok(()) => {}
                            Err(err) if err.kind() == std::io::ErrorKind::NotFound => break,
                            Err(err) => warn!(
                                "AI Tutor file queue heartbeat failed for {:?}: {}",
                                claimed_path, err
                            ),
                        }
                    }
                }
            }
        });
        (stop_tx, handle)
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

pub fn spawn_one_shot_queue_kick(
    queue: Arc<dyn LessonQueue>,
    service: Arc<LiveLessonAppService>,
) {
    tokio::spawn(async move {
        match queue.claim_next("one-shot-worker").await {
            Ok(Some(request)) => {
                if let Err(err) = service.process_queued_job(request).await {
                    error!("AI Tutor one-shot worker failed to process job: {}", err);
                }
            }
            Ok(None) => {}
            Err(err) => {
                error!("AI Tutor queue kick error: {}", err);
            }
        }
    });
}
