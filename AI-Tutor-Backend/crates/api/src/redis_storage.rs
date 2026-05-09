use async_trait::async_trait;
use anyhow::{anyhow, Result};
use redis::{AsyncCommands, Client};
use serde_json;
use ai_tutor_domain::runtime::DirectorState;
use ai_tutor_storage::repositories::RuntimeSessionRepository;

pub struct RedisRuntimeSessionRepository {
    client: Client,
    ttl_secs: u64,
}

impl RedisRuntimeSessionRepository {
    pub fn new(client: Client) -> Self {
        Self {
            client,
            ttl_secs: 24 * 60 * 60, // 24 hours
        }
    }

    async fn get_conn(&self) -> Result<redis::aio::MultiplexedConnection> {
        self.client
            .get_multiplexed_tokio_connection()
            .await
            .map_err(|e| anyhow!("Failed to connect to Redis: {}", e))
    }

    fn key(&self, session_id: &str) -> String {
        format!("session:runtime:{}", session_id)
    }
}

#[async_trait]
impl RuntimeSessionRepository for RedisRuntimeSessionRepository {
    async fn save_runtime_session(
        &self,
        session_id: &str,
        director_state: &DirectorState,
    ) -> Result<(), String> {
        let mut conn = self.get_conn().await.map_err(|e| e.to_string())?;
        let payload = serde_json::to_string(director_state).map_err(|e| e.to_string())?;
        let _: () = conn
            .set_ex(self.key(session_id), payload, self.ttl_secs)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn get_runtime_session(&self, session_id: &str) -> Result<Option<DirectorState>, String> {
        let mut conn = self.get_conn().await.map_err(|e| e.to_string())?;
        let payload: Option<String> = conn.get(self.key(session_id)).await.map_err(|e| e.to_string())?;
        
        match payload {
            Some(p) => {
                let state: DirectorState = serde_json::from_str(&p).map_err(|e| e.to_string())?;
                Ok(Some(state))
            }
            None => Ok(None),
        }
    }
}
