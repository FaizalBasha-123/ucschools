/// Billing event queue backed by Redis Streams.
///
/// This is the AI-Tutor equivalent of Lago's Apache Kafka event ingestion.
/// Instead of Kafka (which requires a separate cluster), we use Redis Streams
/// which provide identical semantics for our scale:
///   - XADD:        Producer "fire and forget" - returns immediately, no DB touch
///   - XREADGROUP:  Consumer groups with at-least-once delivery guarantee
///   - XACK:        Explicit acknowledgement after successful processing
///   - XAUTOCLAIM:  Automatic reclaim of stale messages (crashed worker recovery)
///
/// ## Stream Keys
/// ```
/// billing:events:raw          - Raw credit deduction requests (from lesson generation)
/// billing:events:enriched     - Processed events with bucket split computed
/// billing:events:rejected     - Events rejected due to insufficient balance
/// billing:jobs:renewal        - Hourly tick from the AlarmClock task
/// billing:jobs:renewal:tasks  - Per-subscription renewal tasks (fanned out)
/// ```
///
/// ## Lago Parallel
/// Lago: event → Kafka(RAW_EVENTS_TOPIC) → Go consumer → Kafka(ENRICHED_EVENTS_TOPIC) → DB
/// Ours: event → Redis(billing:events:raw) → Rust task → Redis(billing:events:enriched) → DB
use anyhow::{anyhow, Result};
use redis::{AsyncCommands, RedisResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, error, info, warn};

// ── Stream key constants ──────────────────────────────────────────────────────

pub const STREAM_RAW_EVENTS:      &str = "billing:events:raw";
pub const STREAM_ENRICHED_EVENTS: &str = "billing:events:enriched";
pub const STREAM_REJECTED_EVENTS: &str = "billing:events:rejected";
pub const STREAM_RENEWAL_TICKS:   &str = "billing:jobs:renewal";
pub const STREAM_RENEWAL_TASKS:   &str = "billing:jobs:renewal:tasks";

pub const GROUP_BILLING_PROCESSOR: &str = "billing-processor";
pub const GROUP_RENEWAL_BATCH:     &str = "renewal-batch-workers";
pub const GROUP_RENEWAL_TASKS:     &str = "renewal-task-workers";

/// Stale message reclaim threshold: if a consumer hasn't ACKed in 5 minutes,
/// another worker claims the message. This is Lago's "note in sorting bin"
/// failure recovery pattern.
pub const STALE_MESSAGE_MS: u64 = 300_000; // 5 minutes

/// Max stream length (MAXLEN ~): prevents unbounded growth.
pub const MAX_STREAM_LEN: usize = 10_000;

// ── Event / message types ─────────────────────────────────────────────────────

/// A raw billing debit event - written on every lesson generation (async, no DB).
/// This is the "drop into Kafka and return 200" pattern from Lago.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawBillingEvent {
    /// Unique event ID - also the idempotency key for the credit_ledger entry.
    pub event_id: String,
    pub account_id: String,
    pub lesson_id: String,
    /// Number of credits to debit (from the fixed pricing matrix).
    pub credits_amount: f64,
    /// Quality mode string (e.g. "standard").
    pub quality: String,
    /// Learning mode string (e.g. "explain").
    pub learning_mode: String,
    /// Unix timestamp of when this event was enqueued.
    pub enqueued_at: i64,
}

/// An enriched billing event - after the processor has determined the bucket split.
/// Written to billing:events:enriched and then bulk-inserted into credit_ledger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichedBillingEvent {
    pub event_id: String,
    pub account_id: String,
    pub lesson_id: String,
    pub credits_amount: f64,
    pub quality: String,
    pub learning_mode: String,
    /// Credits taken from the promo bucket.
    pub promo_debited: f64,
    /// Credits taken from the paid bucket.
    pub paid_debited: f64,
    pub enqueued_at: i64,
    pub processed_at: i64,
}

/// A rejected billing event - written when a debit fails due to insufficient balance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RejectedBillingEvent {
    pub event_id: String,
    pub account_id: String,
    pub lesson_id: String,
    pub credits_amount: f64,
    pub rejection_reason: String,
    pub rejected_at: i64,
}

/// A renewal tick emitted by the AlarmClock task once per hour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewalTick {
    /// ISO-8601 timestamp of the hour start (truncated to :00:00).
    pub hour_start: String,
    /// ISO-8601 timestamp of the hour end.
    pub hour_end: String,
    /// When the alarm clock actually fired.
    pub triggered_at: String,
}

/// A per-subscription renewal task fanned out by the RenewalBatchWorker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewalTask {
    pub subscription_id: String,
    pub account_id: String,
    pub plan_code: String,
    /// Unix timestamp of current_period_end - used as the idempotency key suffix
    /// for the credit_ledger entry, preventing double-charges on retry.
    pub period_end_ts: i64,
}

/// A parsed message from XREADGROUP: the stream entry ID + deserialized payload.
#[derive(Debug)]
pub struct StreamMessage<T> {
    /// Redis Stream entry ID (e.g. "1234567890123-0").
    pub entry_id: String,
    pub payload: T,
}

// ── BillingEventQueue ─────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct BillingEventQueue {
    client: redis::Client,
}

impl BillingEventQueue {
    pub fn new(redis_url: &str) -> Result<Self> {
        let client = redis::Client::open(redis_url)?;
        Ok(Self { client })
    }

    async fn conn(&self) -> Result<redis::aio::MultiplexedConnection> {
        self.client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| anyhow!("Redis connection failed: {}", e))
    }

    /// Ensure all consumer groups exist. Called once at startup.
    /// Redis XGROUP CREATE returns BUSYGROUP if group already exists - we ignore that.
    pub async fn ensure_consumer_groups(&self) -> Result<()> {
        let mut conn = self.conn().await?;

        let groups = [
            (STREAM_RAW_EVENTS,    GROUP_BILLING_PROCESSOR),
            (STREAM_ENRICHED_EVENTS, GROUP_BILLING_PROCESSOR),
            (STREAM_RENEWAL_TICKS,  GROUP_RENEWAL_BATCH),
            (STREAM_RENEWAL_TASKS,  GROUP_RENEWAL_TASKS),
        ];

        for (stream, group) in &groups {
            let result: RedisResult<()> = redis::cmd("XGROUP")
                .arg("CREATE")
                .arg(stream)
                .arg(group)
                .arg("$")
                .arg("MKSTREAM")
                .query_async(&mut conn)
                .await;

            match result {
                Ok(_) => info!(stream, group, "consumer group created"),
                Err(e) if e.to_string().contains("BUSYGROUP") => {
                    debug!(stream, group, "consumer group already exists");
                }
                Err(e) => {
                    warn!(stream, group, error = %e, "failed to create consumer group");
                    return Err(anyhow!("XGROUP CREATE {} {}: {}", stream, group, e));
                }
            }
        }
        Ok(())
    }

    /// Try to ensure consumer groups exist, returning Ok even if Redis is down.
    /// Used during startup so the server can start without Redis.
    pub async fn ensure_consumer_groups_best_effort(&self) {
        match self.ensure_consumer_groups().await {
            Ok(_) => info!("billing consumer groups ready"),
            Err(e) => warn!("billing consumer groups not available (non-fatal): {}", e),
        }
    }

    /// Check if an error string contains NOGROUP and attempt to recreate groups.
    /// Returns true if the error was NOGROUP (caller should retry the consume).
    pub async fn recover_from_nogroup(&self, error_msg: &str) -> bool {
        if error_msg.contains("NOGROUP") {
            warn!("NOGROUP detected - attempting to recreate consumer groups");
            match self.ensure_consumer_groups().await {
                Ok(_) => {
                    info!("consumer groups recreated successfully");
                    true
                }
                Err(e) => {
                    warn!("failed to recreate consumer groups: {}", e);
                    false
                }
            }
        } else {
            false
        }
    }

    // ── PRODUCER: Raw billing event ingestion ─────────────────────────────────

    /// Enqueue a raw billing debit event.
    /// Returns immediately - never touches the database.
    /// This is the "drop into Kafka and return 200 OK" pattern from Lago.
    pub async fn enqueue_raw_event(&self, event: &RawBillingEvent) -> Result<String> {
        let mut conn = self.conn().await?;
        let entry_id: String = redis::cmd("XADD")
            .arg(STREAM_RAW_EVENTS)
            .arg("MAXLEN")
            .arg("~")
            .arg(MAX_STREAM_LEN)
            .arg("*")
            .arg("event_id").arg(&event.event_id)
            .arg("account_id").arg(&event.account_id)
            .arg("lesson_id").arg(&event.lesson_id)
            .arg("credits").arg(event.credits_amount.to_string())
            .arg("quality").arg(&event.quality)
            .arg("learning_mode").arg(&event.learning_mode)
            .arg("enqueued_at").arg(event.enqueued_at.to_string())
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XADD raw event: {}", e))?;
        debug!(event_id = %event.event_id, stream_id = %entry_id, "raw billing event enqueued");
        Ok(entry_id)
    }

    // ── CONSUMER: Raw events (billing-processor group) ─────────────────────────

    /// Read a batch of raw events for the billing processor.
    /// `>` means "give me new messages not yet delivered to this group".
    /// BLOCK 2000 means wait up to 2s for messages before returning empty.
    pub async fn consume_raw_events(
        &self,
        consumer_name: &str,
        count: usize,
    ) -> Result<Vec<StreamMessage<RawBillingEvent>>> {
        let mut conn = self.conn().await?;
        let results: redis::Value = redis::cmd("XREADGROUP")
            .arg("GROUP").arg(GROUP_BILLING_PROCESSOR).arg(consumer_name)
            .arg("COUNT").arg(count)
            .arg("BLOCK").arg(2000u64)
            .arg("STREAMS").arg(STREAM_RAW_EVENTS).arg(">")
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XREADGROUP raw events: {}", e))?;

        parse_stream_messages(results, |fields| {
            let f = &fields;
            Ok(RawBillingEvent {
                event_id:       get_field(f, "event_id")?,
                account_id:     get_field(f, "account_id")?,
                lesson_id:      get_field(f, "lesson_id")?,
                credits_amount: get_field(f, "credits")?.parse::<f64>()
                    .map_err(|_| anyhow!("parse credits"))?,
                quality:        get_field(f, "quality")?,
                learning_mode:  get_field(f, "learning_mode")?,
                enqueued_at:    get_field(f, "enqueued_at")?.parse::<i64>()
                    .map_err(|_| anyhow!("parse enqueued_at"))?,
            })
        })
    }

    /// Acknowledge a successfully processed raw event.
    pub async fn ack_raw_event(&self, entry_id: &str) -> Result<()> {
        let mut conn = self.conn().await?;
        let _: i64 = redis::cmd("XACK")
            .arg(STREAM_RAW_EVENTS)
            .arg(GROUP_BILLING_PROCESSOR)
            .arg(entry_id)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XACK raw event: {}", e))?;
        Ok(())
    }

    /// Reclaim stale raw events (from crashed workers).
    /// Returns messages that were pending for > STALE_MESSAGE_MS milliseconds.
    pub async fn reclaim_stale_raw_events(
        &self,
        consumer_name: &str,
        count: usize,
    ) -> Result<Vec<StreamMessage<RawBillingEvent>>> {
        let mut conn = self.conn().await?;
        // XAUTOCLAIM stream group consumer min-idle-time start COUNT count
        let results: redis::Value = redis::cmd("XAUTOCLAIM")
            .arg(STREAM_RAW_EVENTS)
            .arg(GROUP_BILLING_PROCESSOR)
            .arg(consumer_name)
            .arg(STALE_MESSAGE_MS)
            .arg("0-0")
            .arg("COUNT").arg(count)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XAUTOCLAIM raw events: {}", e))?;

        // XAUTOCLAIM returns [next_id, [[entry_id, [fields...]], ...], [deleted_ids]]
        parse_xautoclaim_messages(results, |fields| {
            let f = &fields;
            Ok(RawBillingEvent {
                event_id:       get_field(f, "event_id")?,
                account_id:     get_field(f, "account_id")?,
                lesson_id:      get_field(f, "lesson_id")?,
                credits_amount: get_field(f, "credits")?.parse::<f64>()
                    .map_err(|_| anyhow!("parse credits"))?,
                quality:        get_field(f, "quality")?,
                learning_mode:  get_field(f, "learning_mode")?,
                enqueued_at:    get_field(f, "enqueued_at")?.parse::<i64>()
                    .map_err(|_| anyhow!("parse enqueued_at"))?,
            })
        })
    }

    // ── PRODUCER: Enriched events ─────────────────────────────────────────────

    pub async fn enqueue_enriched_event(&self, event: &EnrichedBillingEvent) -> Result<String> {
        let mut conn = self.conn().await?;
        let entry_id: String = redis::cmd("XADD")
            .arg(STREAM_ENRICHED_EVENTS)
            .arg("MAXLEN").arg("~").arg(MAX_STREAM_LEN)
            .arg("*")
            .arg("event_id").arg(&event.event_id)
            .arg("account_id").arg(&event.account_id)
            .arg("lesson_id").arg(&event.lesson_id)
            .arg("credits").arg(event.credits_amount.to_string())
            .arg("quality").arg(&event.quality)
            .arg("learning_mode").arg(&event.learning_mode)
            .arg("promo_debited").arg(event.promo_debited.to_string())
            .arg("paid_debited").arg(event.paid_debited.to_string())
            .arg("enqueued_at").arg(event.enqueued_at.to_string())
            .arg("processed_at").arg(event.processed_at.to_string())
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XADD enriched event: {}", e))?;
        Ok(entry_id)
    }

    // ── PRODUCER: Rejected events ─────────────────────────────────────────────

    pub async fn enqueue_rejected_event(&self, event: &RejectedBillingEvent) -> Result<()> {
        let mut conn = self.conn().await?;
        let _: String = redis::cmd("XADD")
            .arg(STREAM_REJECTED_EVENTS)
            .arg("MAXLEN").arg("~").arg(1000usize)
            .arg("*")
            .arg("event_id").arg(&event.event_id)
            .arg("account_id").arg(&event.account_id)
            .arg("lesson_id").arg(&event.lesson_id)
            .arg("credits").arg(event.credits_amount.to_string())
            .arg("rejection_reason").arg(&event.rejection_reason)
            .arg("rejected_at").arg(event.rejected_at.to_string())
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XADD rejected event: {}", e))?;
        Ok(())
    }

    // ── PRODUCER: Renewal ticks (AlarmClock) ──────────────────────────────────

    pub async fn enqueue_renewal_tick(&self, tick: &RenewalTick) -> Result<String> {
        let mut conn = self.conn().await?;
        let entry_id: String = redis::cmd("XADD")
            .arg(STREAM_RENEWAL_TICKS)
            .arg("MAXLEN").arg("~").arg(100usize)
            .arg("*")
            .arg("hour_start").arg(&tick.hour_start)
            .arg("hour_end").arg(&tick.hour_end)
            .arg("triggered_at").arg(&tick.triggered_at)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XADD renewal tick: {}", e))?;
        info!(hour_start = %tick.hour_start, stream_id = %entry_id, "renewal tick enqueued");
        Ok(entry_id)
    }

    /// Read renewal tick messages for the RenewalBatchWorker.
    pub async fn consume_renewal_ticks(
        &self,
        consumer_name: &str,
    ) -> Result<Vec<StreamMessage<RenewalTick>>> {
        let mut conn = self.conn().await?;
        let results: redis::Value = redis::cmd("XREADGROUP")
            .arg("GROUP").arg(GROUP_RENEWAL_BATCH).arg(consumer_name)
            .arg("COUNT").arg(5u64)
            .arg("BLOCK").arg(10_000u64)
            .arg("STREAMS").arg(STREAM_RENEWAL_TICKS).arg(">")
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XREADGROUP renewal ticks: {}", e))?;

        parse_stream_messages(results, |fields| {
            let f = &fields;
            Ok(RenewalTick {
                hour_start:   get_field(f, "hour_start")?,
                hour_end:     get_field(f, "hour_end")?,
                triggered_at: get_field(f, "triggered_at")?,
            })
        })
    }

    pub async fn ack_renewal_tick(&self, entry_id: &str) -> Result<()> {
        let mut conn = self.conn().await?;
        let _: i64 = redis::cmd("XACK")
            .arg(STREAM_RENEWAL_TICKS)
            .arg(GROUP_RENEWAL_BATCH)
            .arg(entry_id)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XACK renewal tick: {}", e))?;
        Ok(())
    }

    // ── PRODUCER: Renewal tasks ───────────────────────────────────────────────

    /// Fan out a per-subscription renewal task from the RenewalBatchWorker.
    pub async fn enqueue_renewal_task(&self, task: &RenewalTask) -> Result<String> {
        let mut conn = self.conn().await?;
        let entry_id: String = redis::cmd("XADD")
            .arg(STREAM_RENEWAL_TASKS)
            .arg("MAXLEN").arg("~").arg(50_000usize)
            .arg("*")
            .arg("subscription_id").arg(&task.subscription_id)
            .arg("account_id").arg(&task.account_id)
            .arg("plan_code").arg(&task.plan_code)
            .arg("period_end_ts").arg(task.period_end_ts.to_string())
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XADD renewal task: {}", e))?;
        Ok(entry_id)
    }

    /// Read a renewal task for one of the N RenewalTaskWorkers.
    pub async fn consume_renewal_task(
        &self,
        consumer_name: &str,
    ) -> Result<Vec<StreamMessage<RenewalTask>>> {
        let mut conn = self.conn().await?;
        let results: redis::Value = redis::cmd("XREADGROUP")
            .arg("GROUP").arg(GROUP_RENEWAL_TASKS).arg(consumer_name)
            .arg("COUNT").arg(1u64)
            .arg("BLOCK").arg(15_000u64)
            .arg("STREAMS").arg(STREAM_RENEWAL_TASKS).arg(">")
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XREADGROUP renewal tasks: {}", e))?;

        parse_stream_messages(results, |fields| {
            let f = &fields;
            Ok(RenewalTask {
                subscription_id: get_field(f, "subscription_id")?,
                account_id:      get_field(f, "account_id")?,
                plan_code:       get_field(f, "plan_code")?,
                period_end_ts:   get_field(f, "period_end_ts")?.parse::<i64>()
                    .map_err(|_| anyhow!("parse period_end_ts"))?,
            })
        })
    }

    pub async fn ack_renewal_task(&self, entry_id: &str) -> Result<()> {
        let mut conn = self.conn().await?;
        let _: i64 = redis::cmd("XACK")
            .arg(STREAM_RENEWAL_TASKS)
            .arg(GROUP_RENEWAL_TASKS)
            .arg(entry_id)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XACK renewal task: {}", e))?;
        Ok(())
    }

    /// Reclaim stale renewal tasks from crashed workers.
    pub async fn reclaim_stale_renewal_tasks(
        &self,
        consumer_name: &str,
        count: usize,
    ) -> Result<Vec<StreamMessage<RenewalTask>>> {
        let mut conn = self.conn().await?;
        let results: redis::Value = redis::cmd("XAUTOCLAIM")
            .arg(STREAM_RENEWAL_TASKS)
            .arg(GROUP_RENEWAL_TASKS)
            .arg(consumer_name)
            .arg(STALE_MESSAGE_MS)
            .arg("0-0")
            .arg("COUNT").arg(count)
            .query_async(&mut conn)
            .await
            .map_err(|e| anyhow!("XAUTOCLAIM renewal tasks: {}", e))?;

        parse_xautoclaim_messages(results, |fields| {
            let f = &fields;
            Ok(RenewalTask {
                subscription_id: get_field(f, "subscription_id")?,
                account_id:      get_field(f, "account_id")?,
                plan_code:       get_field(f, "plan_code")?,
                period_end_ts:   get_field(f, "period_end_ts")?.parse::<i64>()
                    .map_err(|_| anyhow!("parse period_end_ts"))?,
            })
        })
    }

    // ── Metrics: stream depths for operator panel ─────────────────────────────

    pub async fn get_stream_depths(&self) -> Result<StreamDepths> {
        let mut conn = self.conn().await?;
        let raw: i64 = redis::cmd("XLEN").arg(STREAM_RAW_EVENTS)
            .query_async(&mut conn).await.unwrap_or(0);
        let enriched: i64 = redis::cmd("XLEN").arg(STREAM_ENRICHED_EVENTS)
            .query_async(&mut conn).await.unwrap_or(0);
        let rejected: i64 = redis::cmd("XLEN").arg(STREAM_REJECTED_EVENTS)
            .query_async(&mut conn).await.unwrap_or(0);
        let renewal_tasks: i64 = redis::cmd("XLEN").arg(STREAM_RENEWAL_TASKS)
            .query_async(&mut conn).await.unwrap_or(0);
        Ok(StreamDepths { raw, enriched, rejected, renewal_tasks })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamDepths {
    pub raw: i64,
    pub enriched: i64,
    pub rejected: i64,
    pub renewal_tasks: i64,
}

// ── Stream parsing helpers ────────────────────────────────────────────────────

fn get_field(fields: &HashMap<String, String>, key: &str) -> Result<String> {
    fields.get(key)
        .cloned()
        .ok_or_else(|| anyhow!("missing field '{}' in stream message", key))
}

/// Parse XREADGROUP response into typed StreamMessages.
///
/// XREADGROUP returns:
/// Value::Array([
///   Value::Array([stream_name, Value::Array([
///     Value::Array([entry_id, Value::Array([field, value, ...])])
///   ])])
/// ])
fn parse_stream_messages<T, F>(
    value: redis::Value,
    parse_fn: F,
) -> Result<Vec<StreamMessage<T>>>
where
    F: Fn(HashMap<String, String>) -> Result<T>,
{
    let mut messages = Vec::new();

    let streams = match value {
        redis::Value::Array(arr) => arr,
        redis::Value::Nil => return Ok(vec![]),
        _ => return Ok(vec![]),
    };

    for stream_entry in streams {
        let stream_arr = match stream_entry {
            redis::Value::Array(arr) => arr,
            _ => continue,
        };
        if stream_arr.len() < 2 {
            continue;
        }
        let entries = match &stream_arr[1] {
            redis::Value::Array(arr) => arr.clone(),
            _ => continue,
        };
        for entry in entries {
            let entry_arr = match entry {
                redis::Value::Array(arr) => arr,
                _ => continue,
            };
            if entry_arr.len() < 2 {
                continue;
            }
            let entry_id = match &entry_arr[0] {
                redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
                redis::Value::SimpleString(s) => s.clone(),
                _ => continue,
            };
            let fields_arr = match &entry_arr[1] {
                redis::Value::Array(arr) => arr.clone(),
                _ => continue,
            };
            let fields = parse_fields_array(fields_arr);
            match parse_fn(fields) {
                Ok(payload) => messages.push(StreamMessage { entry_id, payload }),
                Err(e) => error!(error = %e, "failed to parse stream message fields"),
            }
        }
    }
    Ok(messages)
}

/// Parse XAUTOCLAIM response (different structure from XREADGROUP).
///
/// XAUTOCLAIM returns:
/// Value::Array([next_id, Value::Array([entries...]), Value::Array([deleted_ids])])
fn parse_xautoclaim_messages<T, F>(
    value: redis::Value,
    parse_fn: F,
) -> Result<Vec<StreamMessage<T>>>
where
    F: Fn(HashMap<String, String>) -> Result<T>,
{
    let outer = match value {
        redis::Value::Array(arr) => arr,
        _ => return Ok(vec![]),
    };
    if outer.len() < 2 {
        return Ok(vec![]);
    }
    let entries = match &outer[1] {
        redis::Value::Array(arr) => arr.clone(),
        _ => return Ok(vec![]),
    };

    let mut messages = Vec::new();
    for entry in entries {
        let entry_arr = match entry {
            redis::Value::Array(arr) => arr,
            _ => continue,
        };
        if entry_arr.len() < 2 {
            continue;
        }
        let entry_id = match &entry_arr[0] {
            redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
            redis::Value::SimpleString(s) => s.clone(),
            _ => continue,
        };
        let fields_arr = match &entry_arr[1] {
            redis::Value::Array(arr) => arr.clone(),
            _ => continue,
        };
        let fields = parse_fields_array(fields_arr);
        match parse_fn(fields) {
            Ok(payload) => messages.push(StreamMessage { entry_id, payload }),
            Err(e) => error!(error = %e, "failed to parse autoclamed stream message"),
        }
    }
    Ok(messages)
}

fn parse_fields_array(arr: Vec<redis::Value>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut i = 0;
    while i + 1 < arr.len() {
        let key = match &arr[i] {
            redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
            redis::Value::SimpleString(s) => s.clone(),
            _ => { i += 2; continue; }
        };
        let val = match &arr[i + 1] {
            redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
            redis::Value::SimpleString(s) => s.clone(),
            redis::Value::Int(n) => n.to_string(),
            redis::Value::Nil => String::new(),
            _ => String::new(),
        };
        map.insert(key, val);
        i += 2;
    }
    map
}
