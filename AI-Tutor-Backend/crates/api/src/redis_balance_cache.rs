/// Redis read-through cache for wallet balances.
///
/// ## Why this instead of CDC / pg_replicate
///
/// Neon's serverless compute auto-suspends after 5 minutes of inactivity.
/// A `pg_replicate` logical replication slot requires a **persistent open connection**
/// to receive WAL changes — this prevents Neon from suspending and incurs continuous
/// billing even when no students are using the platform.
///
/// Our approach: cache the wallet balance in Redis with a 10-second TTL.
/// - Hot path (99%+ of debits): reads from Redis — zero DB, sub-millisecond latency.
/// - Cold start / TTL expiry:   single SELECT from Neon to warm cache → Neon suspends again.
/// - After DB flush of enriched events: cache is invalidated, next read re-warms.
///
/// This gives "zero-DB on the hot path" — the same goal as Lago's Debezium+Redis cache —
/// without keeping Neon awake.
///
/// ## Key format
/// `billing:cache:balance:{account_id}` → Redis HASH with fields:
///   promo  — promo_balance as string (NUMERIC precision)
///   paid   — paid_balance as string
///   at     — unix timestamp when cache was warmed
///
/// TTL: 10 seconds.
use anyhow::{anyhow, Result};
use redis::AsyncCommands;
use std::sync::Arc;
use tracing::{debug, warn};

use ai_tutor_domain::wallet::WalletBalance;
use ai_tutor_storage::{filesystem::FileStorage, repositories::WalletRepository};
use chrono::Utc;

const CACHE_TTL_SECS: u64 = 10;
const KEY_PREFIX: &str = "billing:cache:balance:";

#[derive(Clone)]
pub struct RedisBalanceCache {
    redis_client: redis::Client,
    storage: Arc<FileStorage>,
}

impl RedisBalanceCache {
    pub fn new(redis_client: redis::Client, storage: Arc<FileStorage>) -> Self {
        Self { redis_client, storage }
    }

    fn cache_key(account_id: &str) -> String {
        format!("{}{}", KEY_PREFIX, account_id)
    }

    async fn conn(&self) -> Result<redis::aio::MultiplexedConnection> {
        self.redis_client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| anyhow!("Redis connection: {}", e))
    }

    /// Read the wallet balance, using the cache if warm.
    ///
    /// On cache miss, fetches from Neon and warms the cache.
    /// Neon will auto-suspend after the query completes.
    pub async fn read_balance(&self, account_id: &str) -> Result<WalletBalance> {
        let key = Self::cache_key(account_id);
        let mut conn = self.conn().await?;

        // Try Redis first.
        let cached: Option<(String, String)> = redis::cmd("HMGET")
            .arg(&key)
            .arg("promo")
            .arg("paid")
            .query_async(&mut conn)
            .await
            .ok()
            .and_then(|vals: Vec<Option<String>>| {
                if vals.len() == 2 {
                    match (&vals[0], &vals[1]) {
                        (Some(p), Some(d)) => Some((p.clone(), d.clone())),
                        _ => None,
                    }
                } else {
                    None
                }
            });

        if let Some((promo_str, paid_str)) = cached {
            if let (Ok(promo), Ok(paid)) = (
                promo_str.parse::<f64>(),
                paid_str.parse::<f64>(),
            ) {
                debug!(account_id, promo, paid, "balance cache hit");
                return Ok(WalletBalance {
                    account_id: account_id.to_string(),
                    promo_balance: promo,
                    paid_balance: paid,
                    updated_at: Utc::now(),
                });
            }
        }

        // Cache miss — fetch from DB.
        debug!(account_id, "balance cache miss, fetching from DB");
        let balance = self.storage.get_wallet_balance(account_id).await
            .map_err(|e| anyhow!("get wallet balance: {}", e))?;

        // Warm the cache.
        if let Err(e) = self.warm_cache(account_id, &balance).await {
            warn!(account_id, error = %e, "failed to warm balance cache (non-fatal)");
        }

        Ok(balance)
    }

    /// Update the Redis cache after a debit (without going to DB).
    /// This keeps the cache accurate between bulk DB flushes.
    pub async fn apply_debit_to_cache(
        &self,
        account_id: &str,
        promo_debited: f64,
        paid_debited: f64,
    ) -> Result<()> {
        let key = Self::cache_key(account_id);
        let mut conn = self.conn().await?;

        // Use HINCRBYFLOAT to atomically decrement both fields.
        // These are negative increments (deduction).
        let _: f64 = redis::cmd("HINCRBYFLOAT")
            .arg(&key).arg("promo").arg(-promo_debited)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("HINCRBYFLOAT promo: {}", e))?;

        let _: f64 = redis::cmd("HINCRBYFLOAT")
            .arg(&key).arg("paid").arg(-paid_debited)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("HINCRBYFLOAT paid: {}", e))?;

        // Reset TTL after modification.
        let _: bool = conn.expire(&key, CACHE_TTL_SECS as i64).await
            .map_err(|e| anyhow!("EXPIRE balance cache: {}", e))?;

        Ok(())
    }

    /// Apply a grant to the cache (after a successful payment webhook or promo redemption).
    pub async fn apply_grant_to_cache(
        &self,
        account_id: &str,
        promo_amount: f64,
        paid_amount: f64,
    ) -> Result<()> {
        let key = Self::cache_key(account_id);
        let mut conn = self.conn().await?;

        if promo_amount > 0.0 {
            let _: f64 = redis::cmd("HINCRBYFLOAT")
                .arg(&key).arg("promo").arg(promo_amount)
                .query_async(&mut conn)
                .await
                .map_err(|e| anyhow!("HINCRBYFLOAT promo grant: {}", e))?;
        }

        if paid_amount > 0.0 {
            let _: f64 = redis::cmd("HINCRBYFLOAT")
                .arg(&key).arg("paid").arg(paid_amount)
                .query_async(&mut conn)
                .await
                .map_err(|e| anyhow!("HINCRBYFLOAT paid grant: {}", e))?;
        }

        let _: bool = conn.expire(&key, CACHE_TTL_SECS as i64).await
            .map_err(|e| anyhow!("EXPIRE balance cache: {}", e))?;

        Ok(())
    }

    /// Invalidate the cache for an account.
    /// Called after a bulk DB flush of enriched events completes.
    /// The next read will re-warm from the freshly committed DB state.
    pub async fn invalidate(&self, account_id: &str) -> Result<()> {
        let key = Self::cache_key(account_id);
        let mut conn = self.conn().await?;
        let _: i64 = conn.del(&key).await
            .map_err(|e| anyhow!("DEL balance cache: {}", e))?;
        debug!(account_id, "balance cache invalidated");
        Ok(())
    }

    /// Invalidate caches for multiple accounts at once (batch invalidation after DB flush).
    pub async fn invalidate_batch(&self, account_ids: &[String]) -> Result<()> {
        if account_ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn().await?;
        let keys: Vec<String> = account_ids.iter().map(|id| Self::cache_key(id)).collect();
        let _: i64 = conn.del(keys.as_slice()).await
            .map_err(|e| anyhow!("DEL batch balance cache: {}", e))?;
        debug!(count = account_ids.len(), "batch balance cache invalidated");
        Ok(())
    }

    /// Warm the cache with a freshly-fetched WalletBalance.
    async fn warm_cache(&self, account_id: &str, balance: &WalletBalance) -> Result<()> {
        let key = Self::cache_key(account_id);
        let mut conn = self.conn().await?;
        let now = Utc::now().timestamp().to_string();

        redis::cmd("HSET")
            .arg(&key)
            .arg("promo").arg(balance.promo_balance.to_string())
            .arg("paid").arg(balance.paid_balance.to_string())
            .arg("at").arg(&now)
            .query_async::<i64>(&mut conn)
            .await
            .map_err(|e| anyhow!("HSET balance cache: {}", e))?;

        let _: bool = conn.expire(&key, CACHE_TTL_SECS as i64).await
            .map_err(|e| anyhow!("EXPIRE balance cache: {}", e))?;

        Ok(())
    }
}
