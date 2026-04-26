use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{anyhow, Result};
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
    queue_db_path: Option<PathBuf>,
    worker_id: String,
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

    pub async fn enqueue(&self, queued: &QueuedLessonRequest) -> Result<()> {
        if let Some(db_path) = self.queue_db_path.clone() {
            return Self::enqueue_sqlite(db_path, queued.clone()).await;
        }
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
        tokio::spawn(async move {
            loop {
                if let Err(err) = self.process_pending_once(Arc::clone(&service)).await {
                    error!("AI Tutor queue worker loop error: {}", err);
                }
                tokio::time::sleep(poll_interval).await;
            }
        });
    }

    pub fn backend_label(&self) -> &'static str {
        if self.queue_db_path.is_some() {
            "sqlite"
        } else {
            "file"
        }
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

    pub async fn cancel(&self, job_id: &str) -> Result<QueueCancelResult> {
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
    queue: Arc<FileBackedLessonQueue>,
    service: Arc<LiveLessonAppService>,
) {
    tokio::spawn(async move {
        if let Err(err) = queue.process_pending_once(service).await {
            error!("AI Tutor queue kick error: {}", err);
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

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use anyhow::anyhow;
    use async_trait::async_trait;
    use chrono::Duration as ChronoDuration;
    use rusqlite::params;

    use ai_tutor_domain::{
        generation::{AgentMode, Language, LessonGenerationRequest, UserRequirements},
        job::{LessonGenerationJobStatus, LessonGenerationStep},
        provider::ModelConfig,
    };
    use ai_tutor_providers::{
        config::{ServerProviderConfig, ServerProviderEntry},
        traits::{
            ImageProvider, ImageProviderFactory, LlmProvider, LlmProviderFactory, TtsProvider,
            TtsProviderFactory, VideoProvider, VideoProviderFactory,
        },
    };
    use ai_tutor_storage::{
        filesystem::FileStorage,
        repositories::{LessonJobRepository, LessonRepository},
    };

    use crate::app::LiveLessonAppService;
    use ai_tutor_orchestrator::pipeline::build_queued_job;

    use super::{
        default_max_attempts, open_queue_db, FileBackedLessonQueue, QueuedLessonRequest,
        STALE_WORKING_TIMEOUT,
    };

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
        async fn generate_text(
            &self,
            _system_prompt: &str,
            _user_prompt: &str,
        ) -> anyhow::Result<String> {
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
        async fn generate_image(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> anyhow::Result<String> {
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
        async fn generate_video(
            &self,
            _prompt: &str,
            _aspect_ratio: Option<&str>,
        ) -> anyhow::Result<String> {
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
            account_id: None,
            generation_mode: None,
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
        ))
    }

    fn build_failing_service(
        storage: Arc<FileStorage>,
        error_message: &str,
    ) -> Arc<LiveLessonAppService> {
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
                        transport_override: None,
                        pricing_override: None,
                    },
                )]),
                ..Default::default()
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

        let processed = queue
            .process_pending_once(Arc::clone(&service))
            .await
            .unwrap();
        assert_eq!(processed, 1);

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(
            persisted_job.status,
            LessonGenerationJobStatus::Succeeded
        ));
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

        let processed = queue
            .process_pending_once(Arc::clone(&service))
            .await
            .unwrap();
        assert_eq!(processed, 1);

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(
            persisted_job.status,
            LessonGenerationJobStatus::Queued
        ));
        assert!(matches!(persisted_job.step, LessonGenerationStep::Queued));
        assert!(persisted_job
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("temporary upstream timeout"));

        let queue_file = queue.queue_dir().join(format!("{}.json", job.id));
        assert!(queue_file.exists());
        let queued = FileBackedLessonQueue::read_queued_request(&queue_file)
            .await
            .unwrap();
        assert_eq!(queued.attempt, 1);
        assert!(queued
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("temporary upstream timeout"));
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
        assert!(matches!(
            persisted_job.status,
            LessonGenerationJobStatus::Failed
        ));
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

        let processed = queue
            .process_pending_once(Arc::clone(&service))
            .await
            .unwrap();
        assert_eq!(processed, 1);

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(
            persisted_job.status,
            LessonGenerationJobStatus::Succeeded
        ));
        assert!(!working_path.exists());
    }

    #[tokio::test]
    async fn processes_sqlite_queue_entry_and_removes_db_row() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let queue_db_path = root.join("queue").join("lesson-queue.db");
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let service = build_service(Arc::clone(&storage));
        let request = sample_request();
        let lesson_id = "lesson-queue-sqlite".to_string();
        let job = build_queued_job("job-queue-sqlite".to_string(), &request, chrono::Utc::now());
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

        let processed = queue
            .process_pending_once(Arc::clone(&service))
            .await
            .unwrap();
        assert_eq!(processed, 1);

        let persisted_job = storage.get_job(&job.id).await.unwrap().unwrap();
        assert!(matches!(
            persisted_job.status,
            LessonGenerationJobStatus::Succeeded
        ));
        let lesson = storage.get_lesson(&lesson_id).await.unwrap();
        assert!(lesson.is_some());

        let remaining: i64 = tokio::task::spawn_blocking({
            let queue_db_path = queue_db_path.clone();
            move || -> anyhow::Result<i64> {
                let connection = open_queue_db(&queue_db_path)?;
                let count = connection.query_row(
                    "SELECT COUNT(*) FROM lesson_queue WHERE job_id = ?1",
                    params![job.id],
                    |row| row.get(0),
                )?;
                Ok(count)
            }
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(remaining, 0);
    }

    #[tokio::test]
    async fn cancels_file_backed_queued_entry_before_claim() {
        let storage = Arc::new(FileStorage::new(temp_root()));
        let queue = FileBackedLessonQueue::new(Arc::clone(&storage));
        let request = sample_request();
        let job = build_queued_job("job-queue-cancel".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-cancel".to_string(),
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

        let result = queue.cancel(&job.id).await.unwrap();
        assert_eq!(result, super::QueueCancelResult::Cancelled);
        assert!(!queue.queue_dir().join(format!("{}.json", job.id)).exists());
    }

    #[tokio::test]
    async fn cancels_sqlite_queued_entry_before_claim() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let queue_db_path = root.join("queue").join("lesson-queue.db");
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = sample_request();
        let job = build_queued_job(
            "job-queue-cancel-sqlite".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-cancel-sqlite".to_string(),
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

        let result = queue.cancel(&job.id).await.unwrap();
        assert_eq!(result, super::QueueCancelResult::Cancelled);
    }

    #[tokio::test]
    async fn cancels_sqlite_stale_working_entry() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let queue_db_path = root.join("queue").join("lesson-queue.db");
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = sample_request();
        let job = build_queued_job(
            "job-queue-cancel-stale-working".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-cancel-stale-working".to_string(),
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

        let claimed = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "test-worker-stale".to_string(),
        )
        .await
        .unwrap()
        .expect("claim should succeed");
        assert_eq!(claimed.job.id, job.id);

        tokio::task::spawn_blocking({
            let db = queue_db_path.clone();
            let id = job.id.clone();
            move || -> anyhow::Result<()> {
                let connection = open_queue_db(&db)?;
                connection.execute(
                    "UPDATE lesson_queue
                     SET lease_until = ?2
                     WHERE job_id = ?1",
                    params![
                        id,
                        (chrono::Utc::now() - ChronoDuration::minutes(10)).to_rfc3339()
                    ],
                )?;
                Ok(())
            }
        })
        .await
        .unwrap()
        .unwrap();

        let result = queue.cancel(&job.id).await.unwrap();
        assert_eq!(result, super::QueueCancelResult::Cancelled);
    }

    #[tokio::test]
    async fn sqlite_claim_is_single_owner_under_concurrent_workers() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let queue_db_path = root.join("queue").join("lesson-queue.db");
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = sample_request();
        let job = build_queued_job("job-queue-race".to_string(), &request, chrono::Utc::now());
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-race".to_string(),
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

        let db_path_a = queue_db_path.clone();
        let db_path_b = queue_db_path.clone();
        let (claim_a, claim_b) = tokio::join!(
            FileBackedLessonQueue::claim_next_sqlite(db_path_a, "test-worker-a".to_string()),
            FileBackedLessonQueue::claim_next_sqlite(db_path_b, "test-worker-b".to_string())
        );

        let first = normalize_locked_claim_result(claim_a);
        let second = normalize_locked_claim_result(claim_b);
        let claim_count = usize::from(first.is_some()) + usize::from(second.is_some());

        if claim_count == 0 {
            // Under extreme test contention, both concurrent attempts can observe
            // transient lock windows. A follow-up claim must still yield a single owner.
            let recovered = FileBackedLessonQueue::claim_next_sqlite(
                queue_db_path.clone(),
                "test-worker-recovered".to_string(),
            )
            .await
            .unwrap();
            assert!(recovered.is_some());
            let next = FileBackedLessonQueue::claim_next_sqlite(
                queue_db_path.clone(),
                "test-worker-next".to_string(),
            )
            .await
            .unwrap();
            assert!(next.is_none());
            return;
        }

        assert_eq!(claim_count, 1);
    }

    #[tokio::test]
    async fn sqlite_claim_heartbeat_refreshes_claim_timestamp() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let queue_db_path = root.join("queue").join("lesson-queue.db");
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = sample_request();
        let job = build_queued_job(
            "job-queue-heartbeat".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-heartbeat".to_string(),
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

        let claimed = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "test-worker-heartbeat".to_string(),
        )
        .await
        .unwrap()
        .expect("expected sqlite claim");
        assert_eq!(claimed.job.id, job.id);

        let claimed_at_before: String = {
            let connection = open_queue_db(&queue_db_path).unwrap();
            connection
                .query_row(
                    "SELECT claimed_at FROM lesson_queue WHERE job_id = ?1",
                    params![job.id.clone()],
                    |row| row.get(0),
                )
                .unwrap()
        };
        tokio::time::sleep(Duration::from_millis(25)).await;
        FileBackedLessonQueue::touch_claim_sqlite(
            queue_db_path.clone(),
            job.id.clone(),
            "test-worker-heartbeat".to_string(),
        )
        .await
        .unwrap();
        let claimed_at_after: String = {
            let connection = open_queue_db(&queue_db_path).unwrap();
            connection
                .query_row(
                    "SELECT claimed_at FROM lesson_queue WHERE job_id = ?1",
                    params![job.id.clone()],
                    |row| row.get(0),
                )
                .unwrap()
        };

        assert_ne!(claimed_at_before, claimed_at_after);
    }

    #[tokio::test]
    async fn sqlite_pending_count_includes_stale_working_claims() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let queue_db_path = root.join("queue").join("lesson-queue.db");
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = sample_request();
        let job = build_queued_job(
            "job-queue-stale-pending".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-stale-pending".to_string(),
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

        let _ = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "test-worker-pending".to_string(),
        )
        .await
        .unwrap()
        .expect("claim should succeed");

        tokio::task::spawn_blocking({
            let db = queue_db_path.clone();
            let id = job.id.clone();
            move || -> anyhow::Result<()> {
                let connection = open_queue_db(&db)?;
                connection.execute(
                    "UPDATE lesson_queue
                     SET lease_until = ?2
                     WHERE job_id = ?1",
                    params![
                        id,
                        (chrono::Utc::now() - ChronoDuration::minutes(10)).to_rfc3339()
                    ],
                )?;
                Ok(())
            }
        })
        .await
        .unwrap()
        .unwrap();

        let pending = queue.pending_count().await.unwrap();
        assert_eq!(pending, 1);
    }

    #[tokio::test]
    async fn sqlite_lease_counts_split_active_and_stale_working_claims() {
        let root = temp_root();
        let storage = Arc::new(FileStorage::new(&root));
        let queue_db_path = root.join("queue").join("lesson-queue.db");
        let queue = FileBackedLessonQueue::with_queue_db(Arc::clone(&storage), &queue_db_path);
        let request = sample_request();

        let active_job = build_queued_job(
            "job-queue-lease-active".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&active_job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-lease-active".to_string(),
                job: active_job.clone(),
                request: request.clone(),
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: default_max_attempts(),
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        let _ = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "test-worker-lease-active".to_string(),
        )
        .await
        .unwrap()
        .expect("active claim should exist");

        let stale_job = build_queued_job(
            "job-queue-lease-stale".to_string(),
            &request,
            chrono::Utc::now(),
        );
        storage.create_job(&stale_job).await.unwrap();
        queue
            .enqueue(&QueuedLessonRequest {
                lesson_id: "lesson-queue-lease-stale".to_string(),
                job: stale_job.clone(),
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
        let _ = FileBackedLessonQueue::claim_next_sqlite(
            queue_db_path.clone(),
            "test-worker-lease-stale".to_string(),
        )
        .await
        .unwrap()
        .expect("stale claim should exist");

        tokio::task::spawn_blocking({
            let db = queue_db_path.clone();
            let id = stale_job.id.clone();
            move || -> anyhow::Result<()> {
                let connection = open_queue_db(&db)?;
                connection.execute(
                    "UPDATE lesson_queue
                     SET lease_until = ?2
                     WHERE job_id = ?1",
                    params![
                        id,
                        (chrono::Utc::now() - ChronoDuration::minutes(10)).to_rfc3339()
                    ],
                )?;
                Ok(())
            }
        })
        .await
        .unwrap()
        .unwrap();

        let counts = queue.lease_counts().await.unwrap();
        assert_eq!(counts.active, 1);
        assert_eq!(counts.stale, 1);
    }

    #[tokio::test]
    async fn file_lease_counts_split_active_and_stale_working_claims() {
        let storage = Arc::new(FileStorage::new(temp_root()));
        let queue = FileBackedLessonQueue::new(Arc::clone(&storage));
        tokio::fs::create_dir_all(queue.queue_dir()).await.unwrap();

        let active_path = queue.queue_dir().join("job-active.json.working");
        let stale_path = queue.queue_dir().join("job-stale.json.working");
        FileBackedLessonQueue::write_queued_request(
            &active_path,
            &QueuedLessonRequest {
                lesson_id: "lesson-active".to_string(),
                job: build_queued_job(
                    "job-active".to_string(),
                    &sample_request(),
                    chrono::Utc::now(),
                ),
                request: sample_request(),
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: default_max_attempts(),
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            },
        )
        .await
        .unwrap();
        FileBackedLessonQueue::write_queued_request(
            &stale_path,
            &QueuedLessonRequest {
                lesson_id: "lesson-stale".to_string(),
                job: build_queued_job(
                    "job-stale".to_string(),
                    &sample_request(),
                    chrono::Utc::now(),
                ),
                request: sample_request(),
                model_string: Some("openai:gpt-4o-mini".to_string()),
                attempt: 0,
                max_attempts: default_max_attempts(),
                last_error: None,
                queued_at: chrono::Utc::now(),
                available_at: chrono::Utc::now(),
            },
        )
        .await
        .unwrap();

        let stale_time = filetime::FileTime::from_system_time(
            std::time::SystemTime::now() - STALE_WORKING_TIMEOUT - Duration::from_secs(5),
        );
        filetime::set_file_mtime(&stale_path, stale_time).unwrap();

        let counts = queue.lease_counts().await.unwrap();
        assert_eq!(counts.active, 1);
        assert_eq!(counts.stale, 1);
    }

    fn normalize_locked_claim_result(
        result: anyhow::Result<Option<QueuedLessonRequest>>,
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
}
