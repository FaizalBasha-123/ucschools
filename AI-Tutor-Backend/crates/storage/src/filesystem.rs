use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use anyhow::Result as AnyResult;
use async_trait::async_trait;
use tokio::{fs, sync::Mutex};

use ai_tutor_domain::{
    job::{LessonGenerationJob, LessonGenerationJobStatus, LessonGenerationStep},
    lesson::Lesson,
};

use crate::repositories::{LessonJobRepository, LessonRepository};

const STALE_JOB_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
pub struct FileStorage {
    root: PathBuf,
    job_lock: Arc<Mutex<()>>,
}

impl FileStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn root_dir(&self) -> &Path {
        &self.root
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
}

#[async_trait]
impl LessonRepository for FileStorage {
    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {
        Self::write_json_atomic(&self.lesson_path(&lesson.id), lesson)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_lesson(&self, lesson_id: &str) -> Result<Option<Lesson>, String> {
        Self::read_json(&self.lesson_path(lesson_id))
            .await
            .map_err(|err| err.to_string())
    }
}

#[async_trait]
impl LessonJobRepository for FileStorage {
    async fn create_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let _guard = self.job_lock.lock().await;
        Self::write_json_atomic(&self.job_path(&job.id), job)
            .await
            .map_err(|err| err.to_string())
    }

    async fn update_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let _guard = self.job_lock.lock().await;
        Self::write_json_atomic(&self.job_path(&job.id), job)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_job(&self, job_id: &str) -> Result<Option<LessonGenerationJob>, String> {
        let _guard = self.job_lock.lock().await;
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
                job.error = Some("Stale job: process may have restarted during generation".to_string());
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use chrono::{Duration as ChronoDuration, Utc};
    use tokio::runtime::Runtime;

    use ai_tutor_domain::{
        generation::{AgentMode, Language, LessonGenerationRequest, UserRequirements},
        job::{LessonGenerationJob, LessonGenerationJobInputSummary, LessonGenerationJobStatus, LessonGenerationStep},
        lesson::Lesson,
        scene::Stage,
    };

    use super::FileStorage;
    use crate::repositories::{LessonJobRepository, LessonRepository};

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
}
