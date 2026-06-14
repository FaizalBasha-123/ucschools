use anyhow::Result;
use async_trait::async_trait;
use sqlx::{PgPool, Row};

use crate::queue::{LessonQueue, QueueCancelResult, QueueLeaseCounts, QueuedLessonRequest};

pub struct PgLessonQueue {
    pool: PgPool,
}

impl PgLessonQueue {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LessonQueue for PgLessonQueue {
    async fn enqueue(&self, request: &QueuedLessonRequest) -> Result<()> {
        let payload = serde_json::to_value(request)?;
        sqlx::query(
            r#"
            INSERT INTO queue_jobs (id, payload, available_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, available_at = EXCLUDED.available_at, locked_at = NULL, locked_by = NULL
            "#
        )
        .bind(&request.job.id)
        .bind(&payload)
        .bind(request.available_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn claim_next(&self, worker_id: &str) -> Result<Option<QueuedLessonRequest>> {
        let row = sqlx::query(
            r#"
            UPDATE queue_jobs
            SET locked_at = NOW(), locked_by = $1
            WHERE id = (
                SELECT id FROM queue_jobs
                WHERE locked_at IS NULL AND available_at <= NOW()
                ORDER BY available_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING payload
            "#
        )
        .bind(worker_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(r) = row {
            let payload: serde_json::Value = r.try_get("payload")?;
            let req = serde_json::from_value(payload)?;
            Ok(Some(req))
        } else {
            Ok(None)
        }
    }

    async fn heartbeat(&self, job_id: &str, worker_id: &str) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE queue_jobs
            SET locked_at = NOW()
            WHERE id = $1 AND locked_by = $2
            "#
        )
        .bind(job_id)
        .bind(worker_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn complete(&self, job_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM queue_jobs WHERE id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn cancel(&self, job_id: &str) -> Result<QueueCancelResult> {
        let result = sqlx::query("DELETE FROM queue_jobs WHERE id = $1 AND locked_at IS NULL")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
            
        if result.rows_affected() > 0 {
            return Ok(QueueCancelResult::Cancelled);
        }

        // If it exists but is locked
        let row = sqlx::query("SELECT 1 FROM queue_jobs WHERE id = $1")
            .bind(job_id)
            .fetch_optional(&self.pool)
            .await?;

        if row.is_some() {
            Ok(QueueCancelResult::AlreadyClaimed)
        } else {
            Ok(QueueCancelResult::NotFound)
        }
    }

    async fn get_lease_counts(&self) -> Result<QueueLeaseCounts> {
        let row = sqlx::query(
            r#"
            SELECT 
                COUNT(*) FILTER (WHERE locked_at IS NOT NULL AND locked_at > NOW() - INTERVAL '5 minutes') as active,
                COUNT(*) FILTER (WHERE locked_at IS NOT NULL AND locked_at <= NOW() - INTERVAL '5 minutes') as stale
            FROM queue_jobs
            "#
        )
        .fetch_one(&self.pool)
        .await?;

        let active: i64 = row.try_get("active").unwrap_or(0);
        let stale: i64 = row.try_get("stale").unwrap_or(0);

        Ok(QueueLeaseCounts {
            active: active as usize,
            stale: stale as usize,
        })
    }

    async fn get_pending_count(&self) -> Result<usize> {
        let row = sqlx::query("SELECT COUNT(*) FROM queue_jobs WHERE locked_at IS NULL")
            .fetch_one(&self.pool)
            .await?;

        let count: i64 = row.try_get(0).unwrap_or(0);
        Ok(count as usize)
    }

    fn backend_label(&self) -> &'static str {
        "PostgreSQL (NeonDB)"
    }
}
