use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
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
    queue_db_path: Option<PathBuf>,
    worker_id: String,
}

#[async_trait]
impl LessonQueue for FileBackedLessonQueue {
    async fn enqueue(&self, request: &QueuedLessonRequest) -> Result<()> {
        self.enqueue_request(request).await
    }

    async fn claim_next(&self, worker_id: &str) -> Result<Option<QueuedLessonRequest>> {
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::claim_next_sqlite(db_path, worker_id.to_string()).await;
        }

        let files = self.list_queue_files().await?;
        if !files.is_empty() {
             println!("DEBUG: claim_next found {} files in queue", files.len());
        }
        for mut path in files {
            println!("DEBUG: claim_next examining {:?}", path);
            if let Some(reset_path) = Self::reset_stale_working_file(&path).await? {
                println!("DEBUG: claim_next reset stale file {:?}", reset_path);
                path = reset_path;
            }

            if path.extension().and_then(|ext| ext.to_str()) == Some("working") {
                println!("DEBUG: claim_next skipping .working file");
                continue;
            }

            println!("DEBUG: claim_next attempting to claim {:?}", path);
            let claimed = Self::claim_file(&path).await?;
            println!("DEBUG: claim_next successfully claimed {:?}", claimed);
            return Ok(Some(Self::read_queued_request(&claimed).await?));
        }
        Ok(None)
    }

    async fn heartbeat(&self, job_id: &str, worker_id: &str) -> Result<()> {
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::touch_claim_sqlite(db_path, job_id.to_string(), worker_id.to_string()).await;
        }
        Ok(())
    }

    async fn complete(&self, job_id: &str) -> Result<()> {
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::delete_sqlite_entry(db_path, job_id).await;
        }
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
        if self.queue_db_path.is_some() {
            "sqlite"
        } else {
            "filesystem"
        }
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

fn queue_worker_id() -> String {
    if let Ok(explicit) = std::env::var("AI_TUTOR_QUEUE_WORKER_ID") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let require_explicit = matches!(
        std::env::var("AI_TUTOR_QUEUE_REQUIRE_EXPLICIT_WORKER_ID")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );

    if require_explicit {
        panic!(
            "AI_TUTOR_QUEUE_REQUIRE_EXPLICIT_WORKER_ID is enabled but AI_TUTOR_QUEUE_WORKER_ID is missing"
        );
    }

    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string());
    format!(
        "worker-{}-{}-{}",
        host,
        std::process::id(),
        Utc::now().timestamp_millis()
    )
}

fn default_max_attempts() -> u32 {
    DEFAULT_MAX_ATTEMPTS
}

impl FileBackedLessonQueue {
    pub fn new(storage: Arc<FileStorage>) -> Self {
        Self {
            storage,
            queue_db_path: None,
            worker_id: queue_worker_id(),
        }
    }

    pub fn with_queue_db(storage: Arc<FileStorage>, queue_db_path: impl Into<PathBuf>) -> Self {
        Self {
            storage,
            queue_db_path: Some(queue_db_path.into()),
            worker_id: queue_worker_id(),
        }
    }

    pub fn queue_dir(&self) -> PathBuf {
        self.storage.root_dir().join("lesson-queue")
    }

    pub async fn enqueue_request(&self, request: &QueuedLessonRequest) -> Result<()> {
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::enqueue_sqlite(db_path, request.clone()).await;
        }
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
        if let Some(db_path) = self.queue_db_path.clone() {
            return self.process_pending_once_sqlite(db_path, service).await;
        }

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
            .build_orchestrator(&queued.request, queued.model_string.as_deref())
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
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::pending_count_sqlite(db_path).await;
        }

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
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::lease_counts_sqlite(db_path).await;
        }

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
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::cancel_sqlite(db_path, job_id.to_string()).await;
        }

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

    async fn enqueue_sqlite(db_path: PathBuf, queued: QueuedLessonRequest) -> Result<()> {
        let queued = normalized_queued_request(queued);
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        tokio::task::spawn_blocking(move || -> Result<()> {
            let connection = open_queue_db(&db_path)?;
            let payload_json = serde_json::to_string_pretty(&queued)?;
            connection.execute(
                "INSERT INTO lesson_queue (
                    job_id, payload_json, status, queued_at, available_at, claimed_at, claimed_by, lease_until
                 ) VALUES (?1, ?2, 'queued', ?3, ?4, NULL, NULL, NULL)
                 ON CONFLICT(job_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    status = 'queued',
                    queued_at = excluded.queued_at,
                    available_at = excluded.available_at,
                    claimed_at = NULL,
                    claimed_by = NULL,
                    lease_until = NULL",
                params![
                    queued.job.id,
                    payload_json,
                    queued.queued_at.to_rfc3339(),
                    queued.available_at.to_rfc3339(),
                ],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    async fn process_pending_once_sqlite(
        &self,
        db_path: PathBuf,
        service: Arc<LiveLessonAppService>,
    ) -> Result<usize> {
        let mut processed = 0usize;
        while let Some(queued) =
            Self::claim_next_sqlite(db_path.clone(), self.worker_id.clone()).await?
        {
            processed += 1;
            let (heartbeat_stop, heartbeat_handle) = Self::spawn_sqlite_claim_heartbeat(
                db_path.clone(),
                queued.job.id.clone(),
                self.worker_id.clone(),
            );
            let processing_result = match service
                .build_orchestrator(&queued.request, queued.model_string.as_deref())
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
                    Self::delete_sqlite_entry(db_path.clone(), &queued.job.id).await?;
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
                        Self::requeue_sqlite(db_path.clone(), retried).await?;
                        info!(
                            "AI Tutor queue scheduled SQLite retry for job {}",
                            queued.job.id
                        );
                        continue;
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
                    Self::delete_sqlite_entry(db_path.clone(), &queued.job.id).await?;
                    error!(
                        "AI Tutor SQLite queue processing error for {}: {}",
                        queued.job.id, err
                    );
                }
            }
        }

        Ok(processed)
    }

    pub(crate) async fn claim_next_sqlite(
        db_path: PathBuf,
        worker_id: String,
    ) -> Result<Option<QueuedLessonRequest>> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        tokio::task::spawn_blocking(move || -> Result<Option<QueuedLessonRequest>> {
            let mut connection = open_queue_db(&db_path)?;
            let now = Utc::now();
            let stale_before = now
                - chrono::Duration::from_std(STALE_WORKING_TIMEOUT)
                    .unwrap_or_else(|_| chrono::Duration::minutes(5));
            let lease_until = now
                + chrono::Duration::from_std(STALE_WORKING_TIMEOUT)
                    .unwrap_or_else(|_| chrono::Duration::minutes(5));
            let tx = connection.transaction()?;

            let row: Option<(String, String)> = tx
                .query_row(
                    "SELECT job_id, payload_json
                     FROM lesson_queue
                     WHERE
                       (status = 'queued' AND available_at <= ?1)
                       OR
                       (
                         status = 'working'
                         AND (
                             (lease_until IS NOT NULL AND lease_until <= ?2)
                             OR
                             (lease_until IS NULL AND claimed_at IS NOT NULL AND claimed_at <= ?3)
                         )
                       )
                     ORDER BY queued_at
                     LIMIT 1",
                    params![
                        now.to_rfc3339(),
                        now.to_rfc3339(),
                        stale_before.to_rfc3339()
                    ],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;

            let Some((job_id, payload_json)) = row else {
                tx.commit()?;
                return Ok(None);
            };

            let claimed = tx.execute(
                "UPDATE lesson_queue
                 SET status = 'working', claimed_at = ?2, claimed_by = ?3, lease_until = ?4
                 WHERE job_id = ?1
                   AND (
                        (status = 'queued' AND available_at <= ?5)
                     OR (
                        status = 'working'
                        AND (
                            (lease_until IS NOT NULL AND lease_until <= ?6)
                            OR (lease_until IS NULL AND claimed_at IS NOT NULL AND claimed_at <= ?7)
                        )
                     )
                   )",
                params![
                    job_id,
                    now.to_rfc3339(),
                    worker_id,
                    lease_until.to_rfc3339(),
                    now.to_rfc3339(),
                    now.to_rfc3339(),
                    stale_before.to_rfc3339()
                ],
            )?;
            if claimed == 0 {
                tx.commit()?;
                return Ok(None);
            }
            tx.commit()?;

            let queued: QueuedLessonRequest = serde_json::from_str(&payload_json)?;
            Ok(Some(normalized_queued_request(queued)))
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    async fn requeue_sqlite(db_path: PathBuf, queued: QueuedLessonRequest) -> Result<()> {
        tokio::task::spawn_blocking(move || -> Result<()> {
            let connection = open_queue_db(&db_path)?;
            let payload_json =
                serde_json::to_string_pretty(&normalized_queued_request(queued.clone()))?;
            connection.execute(
                "UPDATE lesson_queue
                 SET payload_json = ?2,
                     status = 'queued',
                     available_at = ?3,
                     claimed_at = NULL,
                     claimed_by = NULL,
                     lease_until = NULL
                 WHERE job_id = ?1",
                params![
                    queued.job.id,
                    payload_json,
                    queued.available_at.to_rfc3339()
                ],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    async fn delete_sqlite_entry(db_path: PathBuf, job_id: &str) -> Result<()> {
        let job_id = job_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let connection = open_queue_db(&db_path)?;
            connection.execute(
                "DELETE FROM lesson_queue WHERE job_id = ?1",
                params![job_id],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    async fn pending_count_sqlite(db_path: PathBuf) -> Result<usize> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        tokio::task::spawn_blocking(move || -> Result<usize> {
            let connection = open_queue_db(&db_path)?;
            let now = Utc::now();
            let stale_before = now
                - chrono::Duration::from_std(STALE_WORKING_TIMEOUT)
                    .unwrap_or_else(|_| chrono::Duration::minutes(5));
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM lesson_queue
                 WHERE
                   status = 'queued'
                   OR (
                        status = 'working'
                        AND (
                            (lease_until IS NOT NULL AND lease_until <= ?1)
                            OR (lease_until IS NULL AND claimed_at IS NOT NULL AND claimed_at <= ?2)
                        )
                   )",
                params![now.to_rfc3339(), stale_before.to_rfc3339()],
                |row| row.get(0),
            )?;
            Ok(count as usize)
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    async fn lease_counts_sqlite(db_path: PathBuf) -> Result<QueueLeaseCounts> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        tokio::task::spawn_blocking(move || -> Result<QueueLeaseCounts> {
            let connection = open_queue_db(&db_path)?;
            let now = Utc::now();
            let stale_before = now
                - chrono::Duration::from_std(STALE_WORKING_TIMEOUT)
                    .unwrap_or_else(|_| chrono::Duration::minutes(5));
            let (active, stale): (i64, i64) = connection.query_row(
                "SELECT
                    SUM(CASE
                        WHEN status = 'working'
                         AND NOT (
                            (lease_until IS NOT NULL AND lease_until <= ?1)
                            OR (lease_until IS NULL AND claimed_at IS NOT NULL AND claimed_at <= ?2)
                         )
                        THEN 1 ELSE 0 END),
                    SUM(CASE
                        WHEN status = 'working'
                         AND (
                            (lease_until IS NOT NULL AND lease_until <= ?1)
                            OR (lease_until IS NULL AND claimed_at IS NOT NULL AND claimed_at <= ?2)
                         )
                        THEN 1 ELSE 0 END)
                 FROM lesson_queue",
                params![now.to_rfc3339(), stale_before.to_rfc3339()],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                        row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    ))
                },
            )?;
            Ok(QueueLeaseCounts {
                active: active as usize,
                stale: stale as usize,
            })
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    async fn cancel_sqlite(db_path: PathBuf, job_id: String) -> Result<QueueCancelResult> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        tokio::task::spawn_blocking(move || -> Result<QueueCancelResult> {
            let connection = open_queue_db(&db_path)?;
            let row: Option<(String, Option<String>, Option<String>)> = connection
                .query_row(
                    "SELECT status, claimed_at, lease_until
                     FROM lesson_queue
                     WHERE job_id = ?1",
                    params![job_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;

            match row {
                Some((status, _claimed_at, _lease_until)) if status == "queued" => {
                    connection.execute(
                        "DELETE FROM lesson_queue WHERE job_id = ?1",
                        params![job_id],
                    )?;
                    Ok(QueueCancelResult::Cancelled)
                }
                Some((status, claimed_at, lease_until)) if status == "working" => {
                    let now = Utc::now();
                    let stale_before = now
                        - chrono::Duration::from_std(STALE_WORKING_TIMEOUT)
                            .unwrap_or_else(|_| chrono::Duration::minutes(5));
                    let lease_expired = lease_until
                        .as_deref()
                        .and_then(parse_rfc3339_utc)
                        .map(|lease| lease <= now)
                        .unwrap_or_else(|| {
                            claimed_at
                                .as_deref()
                                .and_then(parse_rfc3339_utc)
                                .map(|claimed| claimed <= stale_before)
                                .unwrap_or(false)
                        });

                    if lease_expired {
                        connection.execute(
                            "DELETE FROM lesson_queue WHERE job_id = ?1",
                            params![job_id],
                        )?;
                        Ok(QueueCancelResult::Cancelled)
                    } else {
                        Ok(QueueCancelResult::AlreadyClaimed)
                    }
                }
                Some((_status, _claimed_at, _lease_until)) => Ok(QueueCancelResult::NotFound),
                None => Ok(QueueCancelResult::NotFound),
            }
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    async fn touch_claim_sqlite(db_path: PathBuf, job_id: String, worker_id: String) -> Result<()> {
        tokio::task::spawn_blocking(move || -> Result<()> {
            let connection = open_queue_db(&db_path)?;
            let now = Utc::now();
            let lease_until = now
                + chrono::Duration::from_std(STALE_WORKING_TIMEOUT)
                    .unwrap_or_else(|_| chrono::Duration::minutes(5));
            connection.execute(
                "UPDATE lesson_queue
                 SET claimed_at = ?2,
                     lease_until = ?3
                 WHERE job_id = ?1 AND status = 'working' AND claimed_by = ?4",
                params![
                    job_id,
                    now.to_rfc3339(),
                    lease_until.to_rfc3339(),
                    worker_id
                ],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow!(err))?
    }

    fn spawn_sqlite_claim_heartbeat(
        db_path: PathBuf,
        job_id: String,
        worker_id: String,
    ) -> (oneshot::Sender<()>, tokio::task::JoinHandle<()>) {
        let (stop_tx, mut stop_rx) = oneshot::channel();
        let handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    _ = tokio::time::sleep(CLAIM_HEARTBEAT_INTERVAL) => {
                        if let Err(err) = Self::touch_claim_sqlite(db_path.clone(), job_id.clone(), worker_id.clone()).await {
                            warn!("AI Tutor SQLite queue heartbeat failed for {}: {}", job_id, err);
                        }
                    }
                }
            }
        });
        (stop_tx, handle)
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

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
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

fn open_queue_db(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(2))?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS lesson_queue (
            job_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL,
            queued_at TEXT NOT NULL,
            available_at TEXT NOT NULL,
            claimed_at TEXT,
            claimed_by TEXT,
            lease_until TEXT
        );",
    )?;
    ensure_queue_column_exists(&connection, "claimed_by", "TEXT")?;
    ensure_queue_column_exists(&connection, "lease_until", "TEXT")?;
    Ok(connection)
}

fn ensure_queue_column_exists(
    connection: &Connection,
    column: &str,
    column_type: &str,
) -> Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(lesson_queue)")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(());
        }
    }

    connection.execute(
        &format!(
            "ALTER TABLE lesson_queue ADD COLUMN {} {}",
            column, column_type
        ),
        [],
    )?;
    Ok(())
}

fn normalize_locked_claim_result(
    result: Result<Option<QueuedLessonRequest>>,
) -> Option<QueuedLessonRequest> {
    match result {
        Ok(value) => value,
        Err(err)
            if err
                .to_string()
                .to_ascii_lowercase()
                .contains("database is locked") =>
        {
            None
        }
        Err(err) => panic!("unexpected sqlite claim error: {}", err),
    }
}
