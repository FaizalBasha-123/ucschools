use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use anyhow::Result as AnyResult;
use async_trait::async_trait;
use rusqlite::{params, Connection, OptionalExtension};
use tokio::{fs, sync::Mutex};

use ai_tutor_domain::{
    job::{
        LessonGenerationJob, LessonGenerationJobStatus, LessonGenerationStep,
        QueuedLessonJobSnapshot,
    },
    lesson::Lesson,
    runtime::{DirectorState, RuntimeActionExecutionRecord},
};

use crate::repositories::{
    LessonJobRepository, LessonRepository, RuntimeActionExecutionRepository,
    RuntimeSessionRepository,
};

const STALE_JOB_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
pub struct FileStorage {
    root: PathBuf,
    lesson_db_path: Option<PathBuf>,
    runtime_db_path: Option<PathBuf>,
    job_db_path: Option<PathBuf>,
    job_lock: Arc<Mutex<()>>,
}

impl FileStorage {
    fn stable_path_key(value: &str) -> String {
        let mut encoded = String::with_capacity(value.len() * 2);
        for byte in value.as_bytes() {
            use std::fmt::Write as _;
            let _ = write!(&mut encoded, "{byte:02x}");
        }
        encoded
    }

    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: None,
            runtime_db_path: None,
            job_db_path: None,
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_runtime_db(root: impl Into<PathBuf>, runtime_db_path: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: None,
            runtime_db_path: Some(runtime_db_path.into()),
            job_db_path: None,
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_job_db(root: impl Into<PathBuf>, job_db_path: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: None,
            runtime_db_path: None,
            job_db_path: Some(job_db_path.into()),
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_lesson_db(root: impl Into<PathBuf>, lesson_db_path: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: Some(lesson_db_path.into()),
            runtime_db_path: None,
            job_db_path: None,
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_databases(
        root: impl Into<PathBuf>,
        lesson_db_path: Option<PathBuf>,
        runtime_db_path: Option<PathBuf>,
        job_db_path: Option<PathBuf>,
    ) -> Self {
        Self {
            root: root.into(),
            lesson_db_path,
            runtime_db_path,
            job_db_path,
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn root_dir(&self) -> &Path {
        &self.root
    }

    pub fn runtime_session_backend(&self) -> &'static str {
        if self.runtime_db_path.is_some() {
            "sqlite"
        } else {
            "file"
        }
    }

    pub fn lesson_backend(&self) -> &'static str {
        if self.lesson_db_path.is_some() {
            "sqlite"
        } else {
            "file"
        }
    }

    pub fn job_backend(&self) -> &'static str {
        if self.job_db_path.is_some() {
            "sqlite"
        } else {
            "file"
        }
    }

    pub fn lessons_dir(&self) -> PathBuf {
        self.root.join("lessons")
    }

    pub fn jobs_dir(&self) -> PathBuf {
        self.root.join("lesson-jobs")
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn runtime_sessions_dir(&self) -> PathBuf {
        self.root.join("runtime-sessions")
    }

    pub fn runtime_action_executions_dir(&self) -> PathBuf {
        self.root.join("runtime-action-executions")
    }

    pub fn queued_job_snapshots_dir(&self) -> PathBuf {
        self.root.join("queued-job-snapshots")
    }

    async fn ensure_dir(dir: &Path) -> AnyResult<()> {
        fs::create_dir_all(dir).await?;
        Ok(())
    }

    async fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> AnyResult<()> {
        if let Some(parent) = path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let tmp = path.with_extension(format!(
            "tmp.{}.{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));

        let content = serde_json::to_vec_pretty(value)?;
        fs::write(&tmp, content).await?;
        fs::rename(&tmp, path).await?;
        Ok(())
    }

    async fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> AnyResult<Option<T>> {
        match fs::read(path).await {
            Ok(bytes) => {
                let value = serde_json::from_slice::<T>(&bytes)?;
                Ok(Some(value))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    fn lesson_path(&self, lesson_id: &str) -> PathBuf {
        self.lessons_dir().join(format!("{lesson_id}.json"))
    }

    fn job_path(&self, job_id: &str) -> PathBuf {
        self.jobs_dir().join(format!("{job_id}.json"))
    }

    fn runtime_session_path(&self, session_id: &str) -> PathBuf {
        self.runtime_sessions_dir()
            .join(format!("{session_id}.json"))
    }

    fn runtime_action_execution_path(&self, execution_id: &str) -> PathBuf {
        self.runtime_action_executions_dir()
            .join(format!("{}.json", Self::stable_path_key(execution_id)))
    }

    fn queued_job_snapshot_path(&self, job_id: &str) -> PathBuf {
        self.queued_job_snapshots_dir()
            .join(format!("{job_id}.json"))
    }

    pub async fn save_queued_job_snapshot(
        &self,
        job_id: &str,
        snapshot: &QueuedLessonJobSnapshot,
    ) -> Result<(), String> {
        Self::write_json_atomic(&self.queued_job_snapshot_path(job_id), snapshot)
            .await
            .map_err(|err| err.to_string())
    }

    pub async fn get_queued_job_snapshot(
        &self,
        job_id: &str,
    ) -> Result<Option<QueuedLessonJobSnapshot>, String> {
        Self::read_json(&self.queued_job_snapshot_path(job_id))
            .await
            .map_err(|err| err.to_string())
    }

    async fn save_runtime_session_sqlite(
        db_path: PathBuf,
        session_id: String,
        director_state: DirectorState,
    ) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&director_state)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_sessions (
                    session_id TEXT PRIMARY KEY,
                    director_state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;
            connection.execute(
                "INSERT INTO runtime_sessions (session_id, director_state_json, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(session_id) DO UPDATE SET
                    director_state_json = excluded.director_state_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![session_id, payload],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_runtime_session_sqlite(
        db_path: PathBuf,
        session_id: String,
    ) -> AnyResult<Option<DirectorState>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<DirectorState>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_sessions (
                    session_id TEXT PRIMARY KEY,
                    director_state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;

            let mut statement = connection.prepare(
                "SELECT director_state_json
                 FROM runtime_sessions
                 WHERE session_id = ?1",
            )?;
            let mut rows = statement.query(params![session_id])?;
            if let Some(row) = rows.next()? {
                let json: String = row.get(0)?;
                let value = serde_json::from_str::<DirectorState>(&json)?;
                Ok(Some(value))
            } else {
                Ok(None)
            }
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_job_sqlite(db_path: PathBuf, job: LessonGenerationJob) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&job)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;
            connection.execute(
                "INSERT INTO lesson_jobs (job_id, job_json, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(job_id) DO UPDATE SET
                    job_json = excluded.job_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![job.id, payload],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_job_sqlite(
        db_path: PathBuf,
        job_id: String,
    ) -> AnyResult<Option<LessonGenerationJob>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<LessonGenerationJob>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;

            let json: Option<String> = connection
                .query_row(
                    "SELECT job_json FROM lesson_jobs WHERE job_id = ?1",
                    params![job_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(json) = json else {
                return Ok(None);
            };

            let mut job = serde_json::from_str::<LessonGenerationJob>(&json)?;
            let now = chrono::Utc::now();
            if job.status == LessonGenerationJobStatus::Running {
                let updated_age = now
                    .signed_duration_since(job.updated_at)
                    .to_std()
                    .unwrap_or_default();
                if updated_age > STALE_JOB_TIMEOUT {
                    job.status = LessonGenerationJobStatus::Failed;
                    job.step = LessonGenerationStep::Failed;
                    job.message =
                        "Job appears stale (no progress update for 30 minutes)".to_string();
                    job.error =
                        Some("Stale job: process may have restarted during generation".to_string());
                    job.updated_at = now;
                    job.completed_at = Some(now);

                    let payload = serde_json::to_string_pretty(&job)?;
                    connection.execute(
                        "UPDATE lesson_jobs
                         SET job_json = ?2, updated_at = CURRENT_TIMESTAMP
                         WHERE job_id = ?1",
                        params![job.id, payload],
                    )?;
                }
            }

            Ok(Some(job))
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_lesson_sqlite(db_path: PathBuf, lesson: Lesson) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&lesson)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lessons (
                    lesson_id TEXT PRIMARY KEY,
                    lesson_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;
            connection.execute(
                "INSERT INTO lessons (lesson_id, lesson_json, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(lesson_id) DO UPDATE SET
                    lesson_json = excluded.lesson_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![lesson.id, payload],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_lesson_sqlite(db_path: PathBuf, lesson_id: String) -> AnyResult<Option<Lesson>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<Lesson>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lessons (
                    lesson_id TEXT PRIMARY KEY,
                    lesson_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;

            let json: Option<String> = connection
                .query_row(
                    "SELECT lesson_json FROM lessons WHERE lesson_id = ?1",
                    params![lesson_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(json) = json else {
                return Ok(None);
            };

            let lesson = serde_json::from_str::<Lesson>(&json)?;
            Ok(Some(lesson))
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_runtime_action_execution_sqlite(
        db_path: PathBuf,
        record: RuntimeActionExecutionRecord,
    ) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_action_executions (
                    execution_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    runtime_session_mode TEXT NOT NULL,
                    action_name TEXT NOT NULL,
                    status_json TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_action_executions_session_id
                    ON runtime_action_executions(session_id);",
            )?;
            let status_json = serde_json::to_string(&record.status)?;
            let record_json = serde_json::to_string_pretty(&record)?;
            connection.execute(
                "INSERT INTO runtime_action_executions (
                    execution_id, session_id, runtime_session_mode, action_name, status_json, record_json, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(execution_id) DO UPDATE SET
                    session_id = excluded.session_id,
                    runtime_session_mode = excluded.runtime_session_mode,
                    action_name = excluded.action_name,
                    status_json = excluded.status_json,
                    record_json = excluded.record_json,
                    updated_at_unix_ms = excluded.updated_at_unix_ms;",
                params![
                    record.execution_id,
                    record.session_id,
                    record.runtime_session_mode,
                    record.action_name,
                    status_json,
                    record_json,
                    record.updated_at_unix_ms
                ],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_runtime_action_execution_sqlite(
        db_path: PathBuf,
        execution_id: String,
    ) -> AnyResult<Option<RuntimeActionExecutionRecord>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<RuntimeActionExecutionRecord>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_action_executions (
                    execution_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    runtime_session_mode TEXT NOT NULL,
                    action_name TEXT NOT NULL,
                    status_json TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_action_executions_session_id
                    ON runtime_action_executions(session_id);",
            )?;
            let payload = connection
                .query_row(
                    "SELECT record_json FROM runtime_action_executions WHERE execution_id = ?1",
                    params![execution_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            payload
                .map(|json| serde_json::from_str::<RuntimeActionExecutionRecord>(&json))
                .transpose()
                .map_err(Into::into)
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn list_runtime_action_executions_for_session_sqlite(
        db_path: PathBuf,
        session_id: String,
    ) -> AnyResult<Vec<RuntimeActionExecutionRecord>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Vec<RuntimeActionExecutionRecord>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_action_executions (
                    execution_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    runtime_session_mode TEXT NOT NULL,
                    action_name TEXT NOT NULL,
                    status_json TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_action_executions_session_id
                    ON runtime_action_executions(session_id);",
            )?;
            let mut statement = connection.prepare(
                "SELECT record_json
                 FROM runtime_action_executions
                 WHERE session_id = ?1
                 ORDER BY updated_at_unix_ms ASC",
            )?;
            let rows = statement.query_map(params![session_id], |row| row.get::<_, String>(0))?;
            let mut records = Vec::new();
            for row in rows {
                records.push(serde_json::from_str::<RuntimeActionExecutionRecord>(&row?)?);
            }
            Ok(records)
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }
}

#[async_trait]
impl LessonRepository for FileStorage {
    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::save_lesson_sqlite(db_path, lesson.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.lesson_path(&lesson.id), lesson)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_lesson(&self, lesson_id: &str) -> Result<Option<Lesson>, String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::get_lesson_sqlite(db_path, lesson_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.lesson_path(lesson_id))
                .await
                .map_err(|err| err.to_string())
        }
    }
}

#[async_trait]
impl LessonJobRepository for FileStorage {
    async fn create_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let _guard = self.job_lock.lock().await;
        if let Some(db_path) = self.job_db_path.clone() {
            Self::save_job_sqlite(db_path, job.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.job_path(&job.id), job)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn update_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let _guard = self.job_lock.lock().await;
        if let Some(db_path) = self.job_db_path.clone() {
            Self::save_job_sqlite(db_path, job.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.job_path(&job.id), job)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_job(&self, job_id: &str) -> Result<Option<LessonGenerationJob>, String> {
        let _guard = self.job_lock.lock().await;
        if let Some(db_path) = self.job_db_path.clone() {
            return Self::get_job_sqlite(db_path, job_id.to_string())
                .await
                .map_err(|err| err.to_string());
        }
        let Some(mut job) = Self::read_json::<LessonGenerationJob>(&self.job_path(job_id))
            .await
            .map_err(|err| err.to_string())?
        else {
            return Ok(None);
        };

        let now = chrono::Utc::now();
        if job.status == LessonGenerationJobStatus::Running {
            let updated_age = now
                .signed_duration_since(job.updated_at)
                .to_std()
                .unwrap_or_default();
            if updated_age > STALE_JOB_TIMEOUT {
                job.status = LessonGenerationJobStatus::Failed;
                job.step = LessonGenerationStep::Failed;
                job.message = "Job appears stale (no progress update for 30 minutes)".to_string();
                job.error =
                    Some("Stale job: process may have restarted during generation".to_string());
                job.updated_at = now;
                job.completed_at = Some(now);
                Self::write_json_atomic(&self.job_path(job_id), &job)
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }

        Ok(Some(job))
    }
}

#[async_trait]
impl RuntimeSessionRepository for FileStorage {
    async fn save_runtime_session(
        &self,
        session_id: &str,
        director_state: &DirectorState,
    ) -> Result<(), String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::save_runtime_session_sqlite(
                db_path,
                session_id.to_string(),
                director_state.clone(),
            )
            .await
            .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.runtime_session_path(session_id), director_state)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_runtime_session(&self, session_id: &str) -> Result<Option<DirectorState>, String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::get_runtime_session_sqlite(db_path, session_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.runtime_session_path(session_id))
                .await
                .map_err(|err| err.to_string())
        }
    }
}

#[async_trait]
impl RuntimeActionExecutionRepository for FileStorage {
    async fn save_runtime_action_execution(
        &self,
        record: &RuntimeActionExecutionRecord,
    ) -> Result<(), String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::save_runtime_action_execution_sqlite(db_path, record.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.runtime_action_execution_path(&record.execution_id), record)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_runtime_action_execution(
        &self,
        execution_id: &str,
    ) -> Result<Option<RuntimeActionExecutionRecord>, String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::get_runtime_action_execution_sqlite(db_path, execution_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.runtime_action_execution_path(execution_id))
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn list_runtime_action_executions_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<RuntimeActionExecutionRecord>, String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::list_runtime_action_executions_for_session_sqlite(db_path, session_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::ensure_dir(&self.runtime_action_executions_dir())
                .await
                .map_err(|err| err.to_string())?;
            let mut reader = fs::read_dir(self.runtime_action_executions_dir())
                .await
                .map_err(|err| err.to_string())?;
            let mut records = Vec::new();
            while let Some(entry) = reader.next_entry().await.map_err(|err| err.to_string())? {
                if let Some(record) =
                    Self::read_json::<RuntimeActionExecutionRecord>(&entry.path())
                        .await
                        .map_err(|err| err.to_string())?
                {
                    if record.session_id == session_id {
                        records.push(record);
                    }
                }
            }
            records.sort_by(|left, right| left.updated_at_unix_ms.cmp(&right.updated_at_unix_ms));
            Ok(records)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use chrono::{Duration as ChronoDuration, Utc};
    use tokio::runtime::Runtime;

    use ai_tutor_domain::{
        generation::{AgentMode, Language, LessonGenerationRequest, UserRequirements},
        job::{
            LessonGenerationJob, LessonGenerationJobInputSummary, LessonGenerationJobStatus,
            LessonGenerationStep, QueuedLessonJobSnapshot,
        },
        lesson::Lesson,
        runtime::{
            DirectorState, RuntimeActionExecutionRecord, RuntimeActionExecutionStatus,
        },
        scene::Stage,
    };

    use super::FileStorage;
    use crate::repositories::{
        LessonJobRepository, LessonRepository, RuntimeActionExecutionRepository,
        RuntimeSessionRepository,
    };

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-tutor-storage-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn saves_and_reads_lesson() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let now = Utc::now();
            let lesson = Lesson {
                id: "lesson-1".to_string(),
                title: "Gravity".to_string(),
                language: "en-US".to_string(),
                description: Some("Physics lesson".to_string()),
                stage: Some(Stage {
                    id: "stage-1".to_string(),
                    name: "Gravity".to_string(),
                    description: None,
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
            };

            storage.save_lesson(&lesson).await.unwrap();
            let loaded = storage.get_lesson("lesson-1").await.unwrap().unwrap();
            assert_eq!(loaded.id, lesson.id);
            assert_eq!(loaded.title, lesson.title);
        });
    }

    #[test]
    fn saves_and_reads_lesson_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("lessons.db");
            let storage = FileStorage::with_lesson_db(&root, &db_path);
            let now = Utc::now();
            let lesson = Lesson {
                id: "lesson-sqlite-1".to_string(),
                title: "Fractions".to_string(),
                language: "en-US".to_string(),
                description: Some("Understand fractions".to_string()),
                stage: None,
                scenes: vec![],
                style: Some("interactive".to_string()),
                agent_ids: vec![],
                created_at: now,
                updated_at: now,
            };

            storage.save_lesson(&lesson).await.unwrap();
            let loaded = storage
                .get_lesson("lesson-sqlite-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.id, lesson.id);
            assert_eq!(loaded.title, lesson.title);
            assert!(db_path.exists());
        });
    }

    #[test]
    fn marks_stale_running_job_as_failed_on_read() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let req = LessonGenerationRequest {
                requirements: UserRequirements {
                    requirement: "Teach me fractions".to_string(),
                    language: Language::EnUs,
                    user_nickname: None,
                    user_bio: None,
                    web_search: None,
                },
                pdf_content: None,
                enable_web_search: false,
                enable_image_generation: false,
                enable_video_generation: false,
                enable_tts: false,
                agent_mode: AgentMode::Default,
            };
            let stale_time = Utc::now() - ChronoDuration::minutes(31);
            let job = LessonGenerationJob {
                id: "job-1".to_string(),
                status: LessonGenerationJobStatus::Running,
                step: LessonGenerationStep::GeneratingScenes,
                progress: 70,
                message: "Generating".to_string(),
                created_at: stale_time,
                updated_at: stale_time,
                started_at: Some(stale_time),
                completed_at: None,
                input_summary: LessonGenerationJobInputSummary::from(&req),
                scenes_generated: 2,
                total_scenes: Some(5),
                result: None,
                error: None,
            };

            storage.create_job(&job).await.unwrap();
            let loaded = storage.get_job("job-1").await.unwrap().unwrap();
            assert!(matches!(loaded.status, LessonGenerationJobStatus::Failed));
            assert!(matches!(loaded.step, LessonGenerationStep::Failed));
        });
    }

    #[test]
    fn saves_and_reads_runtime_session_state() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let state = DirectorState {
                turn_count: 2,
                agent_responses: vec![],
                whiteboard_ledger: vec![],
                whiteboard_state: None,
            };

            storage
                .save_runtime_session("session-1", &state)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_session("session-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.turn_count, 2);
        });
    }

    #[test]
    fn saves_and_reads_runtime_session_state_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("runtime-sessions.db");
            let storage = FileStorage::with_runtime_db(&root, &db_path);
            let state = DirectorState {
                turn_count: 3,
                agent_responses: vec![],
                whiteboard_ledger: vec![],
                whiteboard_state: None,
            };

            storage
                .save_runtime_session("session-sqlite", &state)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_session("session-sqlite")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.turn_count, 3);
            assert!(!storage.runtime_session_path("session-sqlite").exists());
            assert!(db_path.exists());
        });
    }

    #[test]
    fn saves_and_reads_runtime_action_execution_state() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let record = RuntimeActionExecutionRecord {
                session_id: "session-1".to_string(),
                runtime_session_mode: "stateless_client_state".to_string(),
                execution_id: "exec-1".to_string(),
                action_name: "wb_open".to_string(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: 1_700_000_000_000,
                updated_at_unix_ms: 1_700_000_000_000,
                timeout_at_unix_ms: 1_700_000_015_000,
                last_error: None,
            };

            storage
                .save_runtime_action_execution(&record)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_action_execution("exec-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.execution_id, "exec-1");
            assert_eq!(loaded.session_id, "session-1");
            let listed = storage
                .list_runtime_action_executions_for_session("session-1")
                .await
                .unwrap();
            assert_eq!(listed.len(), 1);
        });
    }

    #[test]
    fn saves_and_reads_runtime_action_execution_state_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("runtime-actions.db");
            let storage = FileStorage::with_runtime_db(&root, &db_path);
            let record = RuntimeActionExecutionRecord {
                session_id: "session-sqlite".to_string(),
                runtime_session_mode: "managed_runtime_session".to_string(),
                execution_id: "exec-sqlite".to_string(),
                action_name: "wb_draw_text".to_string(),
                status: RuntimeActionExecutionStatus::Accepted,
                created_at_unix_ms: 1_700_000_000_000,
                updated_at_unix_ms: 1_700_000_000_500,
                timeout_at_unix_ms: 1_700_000_015_000,
                last_error: None,
            };

            storage
                .save_runtime_action_execution(&record)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_action_execution("exec-sqlite")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.action_name, "wb_draw_text");
            let listed = storage
                .list_runtime_action_executions_for_session("session-sqlite")
                .await
                .unwrap();
            assert_eq!(listed.len(), 1);
            assert!(db_path.exists());
        });
    }

    #[test]
    fn saves_and_reads_job_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("lesson-jobs.db");
            let storage = FileStorage::with_job_db(&root, &db_path);
            let req = LessonGenerationRequest {
                requirements: UserRequirements {
                    requirement: "Teach percentages".to_string(),
                    language: Language::EnUs,
                    user_nickname: None,
                    user_bio: None,
                    web_search: None,
                },
                pdf_content: None,
                enable_web_search: false,
                enable_image_generation: false,
                enable_video_generation: false,
                enable_tts: false,
                agent_mode: AgentMode::Default,
            };
            let now = Utc::now();
            let job = LessonGenerationJob {
                id: "job-sqlite-1".to_string(),
                status: LessonGenerationJobStatus::Queued,
                step: LessonGenerationStep::Queued,
                progress: 0,
                message: "Queued".to_string(),
                created_at: now,
                updated_at: now,
                started_at: None,
                completed_at: None,
                input_summary: LessonGenerationJobInputSummary::from(&req),
                scenes_generated: 0,
                total_scenes: None,
                result: None,
                error: None,
            };

            storage.create_job(&job).await.unwrap();
            let loaded = storage.get_job("job-sqlite-1").await.unwrap().unwrap();
            assert_eq!(loaded.id, "job-sqlite-1");
            assert!(matches!(loaded.status, LessonGenerationJobStatus::Queued));
            assert!(db_path.exists());
        });
    }

    #[test]
    fn saves_and_reads_queued_job_snapshot() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let snapshot = QueuedLessonJobSnapshot {
                lesson_id: "lesson-queued-1".to_string(),
                request: LessonGenerationRequest {
                    requirements: UserRequirements {
                        requirement: "Teach decimals".to_string(),
                        language: Language::EnUs,
                        user_nickname: None,
                        user_bio: None,
                        web_search: None,
                    },
                    pdf_content: None,
                    enable_web_search: false,
                    enable_image_generation: false,
                    enable_video_generation: false,
                    enable_tts: false,
                    agent_mode: AgentMode::Default,
                },
                model_string: Some("openai:gpt-4o-mini".to_string()),
                max_attempts: 3,
            };

            storage
                .save_queued_job_snapshot("job-snapshot-1", &snapshot)
                .await
                .unwrap();

            let loaded = storage
                .get_queued_job_snapshot("job-snapshot-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.lesson_id, "lesson-queued-1");
            assert_eq!(loaded.model_string.as_deref(), Some("openai:gpt-4o-mini"));
            assert_eq!(loaded.max_attempts, 3);
            assert_eq!(loaded.request.requirements.requirement, "Teach decimals");
        });
    }
}
