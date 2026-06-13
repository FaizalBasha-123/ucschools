use async_trait::async_trait;
use sqlx::{PgPool, Row};

use ai_tutor_domain::{
    job::LessonGenerationJob,
    lesson::Lesson,
    runtime::DirectorState,
    lesson_shelf::{LessonShelfItem, LessonShelfStatus},
};
use crate::repositories::{LessonJobRepository, LessonRepository, RuntimeSessionRepository, LessonShelfRepository};

#[derive(Clone)]
pub struct PgStorage {
    pub pool: PgPool,
}

impl PgStorage {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LessonJobRepository for PgStorage {
    async fn create_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let data = serde_json::to_value(job).map_err(|e| e.to_string())?;
        let status = format!("{:?}", job.status);
        sqlx::query(
            r#"
            INSERT INTO jobs (id, account_id, status, data)
            VALUES ($1, $2, $3, $4)
            "#
        )
        .bind(&job.id)
        .bind(&job.account_id)
        .bind(&status)
        .bind(&data)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn update_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let data = serde_json::to_value(job).map_err(|e| e.to_string())?;
        let status = format!("{:?}", job.status);
        sqlx::query(
            r#"
            UPDATE jobs
            SET account_id = $1, status = $2, data = $3, updated_at = NOW()
            WHERE id = $4
            "#
        )
        .bind(&job.account_id)
        .bind(&status)
        .bind(&data)
        .bind(&job.id)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_job(&self, job_id: &str) -> Result<Option<LessonGenerationJob>, String> {
        let row = sqlx::query(
            r#"
            SELECT data FROM jobs WHERE id = $1
            "#
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        match row {
            Some(r) => {
                let data: serde_json::Value = r.try_get("data").map_err(|e| e.to_string())?;
                let job = serde_json::from_value(data).map_err(|e| e.to_string())?;
                Ok(Some(job))
            }
            None => Ok(None),
        }
    }

    async fn list_all_jobs(&self, limit: usize) -> Result<Vec<LessonGenerationJob>, String> {
        let rows = sqlx::query(
            r#"
            SELECT data FROM jobs ORDER BY created_at DESC LIMIT $1
            "#
        )
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut jobs = Vec::new();
        for r in rows {
            let data: serde_json::Value = r.try_get("data").map_err(|e| e.to_string())?;
            let job = serde_json::from_value(data).map_err(|e| e.to_string())?;
            jobs.push(job);
        }
        Ok(jobs)
    }

    async fn delete_jobs_by_lesson(&self, lesson_id: &str) -> Result<(), String> {
        sqlx::query(
            r#"
            DELETE FROM jobs WHERE data->>'result'->>'lesson_id' = $1
            "#
        )
        .bind(lesson_id)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[async_trait]
impl LessonRepository for PgStorage {
    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {
        let data = serde_json::to_value(lesson).map_err(|e| e.to_string())?;
        sqlx::query(
            r#"
            INSERT INTO lessons (id, account_id, data)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET account_id = EXCLUDED.account_id, data = EXCLUDED.data, updated_at = NOW()
            "#
        )
        .bind(&lesson.id)
        .bind(None::<String>) // TODO: Handle account_id when added to Lesson
        .bind(&data)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_lesson(&self, lesson_id: &str) -> Result<Option<Lesson>, String> {
        let row = sqlx::query("SELECT data FROM lessons WHERE id = $1")
            .bind(lesson_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        match row {
            Some(r) => {
                let data: serde_json::Value = r.try_get("data").map_err(|e| e.to_string())?;
                let lesson = serde_json::from_value(data).map_err(|e| e.to_string())?;
                Ok(Some(lesson))
            }
            None => Ok(None),
        }
    }

    async fn delete_lesson(&self, lesson_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM lessons WHERE id = $1")
            .bind(lesson_id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[async_trait]
impl RuntimeSessionRepository for PgStorage {
    async fn save_runtime_session(
        &self,
        session_id: &str,
        director_state: &DirectorState,
    ) -> Result<(), String> {
        let data = serde_json::to_value(director_state).map_err(|e| e.to_string())?;
        sqlx::query(
            r#"
            INSERT INTO runtime_sessions (id, data)
            VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
            "#
        )
        .bind(session_id)
        .bind(&data)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_runtime_session(&self, session_id: &str) -> Result<Option<DirectorState>, String> {
        let row = sqlx::query("SELECT data FROM runtime_sessions WHERE id = $1")
            .bind(session_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        match row {
            Some(r) => {
                let data: serde_json::Value = r.try_get("data").map_err(|e| e.to_string())?;
                let state = serde_json::from_value(data).map_err(|e| e.to_string())?;
                Ok(Some(state))
            }
            None => Ok(None),
        }
    }
}

#[async_trait]
impl LessonShelfRepository for PgStorage {
    async fn upsert_lesson_shelf_item(&self, item: &LessonShelfItem) -> Result<(), String> {
        let data = serde_json::to_value(item).map_err(|e| e.to_string())?;
        let status = format!("{:?}", item.status);
        sqlx::query(
            r#"
            INSERT INTO lesson_shelf_items (id, account_id, lesson_id, status, data)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET account_id = EXCLUDED.account_id, lesson_id = EXCLUDED.lesson_id, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = NOW()
            "#
        )
        .bind(&item.id)
        .bind(&item.account_id)
        .bind(&item.lesson_id)
        .bind(&status)
        .bind(&data)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_lesson_shelf_item(&self, item_id: &str) -> Result<Option<LessonShelfItem>, String> {
        let row = sqlx::query("SELECT data FROM lesson_shelf_items WHERE id = $1")
            .bind(item_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        match row {
            Some(r) => {
                let data: serde_json::Value = r.try_get("data").map_err(|e| e.to_string())?;
                let item = serde_json::from_value(data).map_err(|e| e.to_string())?;
                Ok(Some(item))
            }
            None => Ok(None),
        }
    }

    async fn get_lesson_shelf_item_by_lesson_id(
        &self,
        account_id: &str,
        lesson_id: &str,
    ) -> Result<Option<LessonShelfItem>, String> {
        let row = sqlx::query(
            "SELECT data FROM lesson_shelf_items WHERE account_id = $1 AND lesson_id = $2"
        )
        .bind(account_id)
        .bind(lesson_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        match row {
            Some(r) => {
                let data: serde_json::Value = r.try_get("data").map_err(|e| e.to_string())?;
                let item = serde_json::from_value(data).map_err(|e| e.to_string())?;
                Ok(Some(item))
            }
            None => Ok(None),
        }
    }

    async fn list_lesson_shelf_items_for_account(
        &self,
        account_id: &str,
        status: Option<LessonShelfStatus>,
        limit: usize,
    ) -> Result<Vec<LessonShelfItem>, String> {
        let rows = if let Some(s) = status {
            let status_str = format!("{:?}", s);
            sqlx::query(
                "SELECT data FROM lesson_shelf_items WHERE account_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT $3"
            )
            .bind(account_id)
            .bind(&status_str)
            .bind(limit as i64)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?
        } else {
            sqlx::query(
                "SELECT data FROM lesson_shelf_items WHERE account_id = $1 ORDER BY updated_at DESC LIMIT $2"
            )
            .bind(account_id)
            .bind(limit as i64)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?
        };

        let mut items = Vec::new();
        for r in rows {
            let data: serde_json::Value = r.try_get("data").map_err(|e| e.to_string())?;
            let item = serde_json::from_value(data).map_err(|e| e.to_string())?;
            items.push(item);
        }
        Ok(items)
    }

    async fn mark_lesson_shelf_opened(&self, item_id: &str) -> Result<(), String> {
        let mut item = match self.get_lesson_shelf_item(item_id).await? {
            Some(i) => i,
            None => return Err("Item not found".into()),
        };
        item.last_opened_at = Some(chrono::Utc::now());
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn rename_lesson_shelf_item(&self, item_id: &str, title: &str) -> Result<(), String> {
        let mut item = match self.get_lesson_shelf_item(item_id).await? {
            Some(i) => i,
            None => return Err("Item not found".into()),
        };
        item.title = title.to_string();
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn archive_lesson_shelf_item(&self, item_id: &str) -> Result<(), String> {
        let mut item = match self.get_lesson_shelf_item(item_id).await? {
            Some(i) => i,
            None => return Err("Item not found".into()),
        };
        item.status = LessonShelfStatus::Archived;
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn reopen_lesson_shelf_item(&self, item_id: &str) -> Result<(), String> {
        let mut item = match self.get_lesson_shelf_item(item_id).await? {
            Some(i) => i,
            None => return Err("Item not found".into()),
        };
        item.status = LessonShelfStatus::Ready;
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn delete_lesson_shelf_item(&self, item_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM lesson_shelf_items WHERE id = $1")
            .bind(item_id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
