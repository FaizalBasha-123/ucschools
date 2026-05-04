use anyhow::{anyhow, Result};
use async_trait::async_trait;
use redis::AsyncCommands;
use tracing::info;

use crate::queue::{LessonQueue, QueuedLessonRequest, QueueLeaseCounts, QueueCancelResult};

pub struct RedisLessonQueue {
    client: redis::Client,
    queue_key: String,
    processing_key: String,
    lease_timeout_secs: u64,
}

impl RedisLessonQueue {
    pub fn new(redis_url: &str) -> Result<Self> {
        let client = redis::Client::open(redis_url)?;
        Ok(Self {
            client,
            queue_key: "ai_tutor:lesson_queue:pending".to_string(),
            processing_key: "ai_tutor:lesson_queue:processing".to_string(),
            lease_timeout_secs: 1800, // 30 minutes
        })
    }
}

#[async_trait]
impl LessonQueue for RedisLessonQueue {
    async fn enqueue(&self, request: &QueuedLessonRequest) -> Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let payload = serde_json::to_string(request)?;
        let _: () = conn.lpush(&self.queue_key, payload).await?;
        info!(job_id = %request.job.id, "job enqueued in redis");
        Ok(())
    }

    async fn claim_next(&self, worker_id: &str) -> Result<Option<QueuedLessonRequest>> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        
        // Use RPOPLPUSH for reliable queueing (atomic move from pending to processing)
        let payload: Option<String> = conn.rpoplpush(&self.queue_key, &self.processing_key).await?;
        
        if let Some(payload) = payload {
            let request: QueuedLessonRequest = serde_json::from_str(&payload)?;
            // Set a lease/heartbeat in a separate key to track worker ownership
            let lease_key = format!("ai_tutor:lesson_lease:{}", request.job.id);
            let _: () = conn.set_ex(&lease_key, worker_id, self.lease_timeout_secs.try_into().unwrap()).await?;
            
            info!(job_id = %request.job.id, worker_id = %worker_id, "job claimed from redis");
            Ok(Some(request))
        } else {
            Ok(None)
        }
    }

    async fn heartbeat(&self, job_id: &str, worker_id: &str) -> Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let lease_key = format!("ai_tutor:lesson_lease:{}", job_id);
        
        let current_worker: Option<String> = conn.get(&lease_key).await?;
        if current_worker.as_deref() == Some(worker_id) {
            let _: () = conn.expire(&lease_key, self.lease_timeout_secs.try_into().unwrap()).await?;
            Ok(())
        } else {
            Err(anyhow!("lease lost or owned by another worker"))
        }
    }

    async fn complete(&self, job_id: &str) -> Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let _: () = conn.del(format!("ai_tutor:lesson_lease:{}", job_id)).await?;
        info!(job_id = %job_id, "job completed in redis");
        Ok(())
    }

    async fn cancel(&self, job_id: &str) -> Result<QueueCancelResult> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let _: () = conn.del(format!("ai_tutor:lesson_lease:{}", job_id)).await?;
        Ok(QueueCancelResult::Cancelled)
    }

    async fn get_lease_counts(&self) -> Result<QueueLeaseCounts> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let processing: i64 = conn.llen(&self.processing_key).await?;
        
        Ok(QueueLeaseCounts {
            active: processing as usize,
            stale: 0, 
        })
    }

    async fn get_pending_count(&self) -> Result<usize> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let pending: i64 = conn.llen(&self.queue_key).await?;
        Ok(pending as usize)
    }

    fn backend_label(&self) -> &'static str {
        "redis"
    }
}
