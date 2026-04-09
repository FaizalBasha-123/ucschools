//! ZeroClaw-grade provider resilience layer.
//!
//! Ported from `zeroclaw/src/providers/reliable.rs` — implements the same
//! three-level failover strategy:
//!
//!   Outer loop  → model fallback chain (original → fallback models)
//!   Middle loop → provider chain (primary → secondary providers)
//!   Inner loop  → retry with exponential backoff + Retry-After parsing
//!
//! Additional features:
//!   - Context window overflow detection + automatic history truncation
//!   - Non-retryable rate limit detection (quota exhaustion vs transient)
//!   - Structured failure aggregation for diagnostics

use anyhow::Result;
use async_trait::async_trait;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::traits::{
    LlmProvider, ProviderRuntimeStatus, ProviderStreamEvent, ProviderUsage, ProviderUsageSource,
};

struct ProviderEntry {
    label: String,
    provider: Box<dyn LlmProvider>,
    pricing: Option<ProviderPricing>,
}

#[derive(Debug, Clone, Copy)]
pub struct ProviderPricing {
    pub input_cost_per_1m_usd: f64,
    pub output_cost_per_1m_usd: f64,
}

#[derive(Debug, Clone)]
struct ProviderHealth {
    consecutive_failures: u32,
    circuit_open_until: Option<Instant>,
}

impl ProviderHealth {
    fn is_available(&self, now: Instant) -> bool {
        self.circuit_open_until.is_none_or(|until| until <= now)
    }
}

#[derive(Debug, Clone, Default)]
struct ProviderTelemetry {
    total_requests: u64,
    total_successes: u64,
    total_failures: u64,
    total_latency_ms: u64,
    estimated_input_tokens: u64,
    estimated_output_tokens: u64,
    estimated_total_cost_microusd: u64,
    provider_reported_input_tokens: u64,
    provider_reported_output_tokens: u64,
    provider_reported_total_tokens: u64,
    provider_reported_total_cost_microusd: u64,
    last_error: Option<String>,
    last_success_unix_ms: Option<u64>,
    last_failure_unix_ms: Option<u64>,
    last_latency_ms: Option<u64>,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn trim_error_for_status(message: &str) -> String {
    const MAX_STATUS_ERROR_CHARS: usize = 240;
    let mut trimmed = message.trim().to_string();
    if trimmed.chars().count() > MAX_STATUS_ERROR_CHARS {
        trimmed = trimmed
            .chars()
            .take(MAX_STATUS_ERROR_CHARS)
            .collect::<String>();
        trimmed.push_str("...");
    }
    trimmed
}

fn elapsed_ms(started_at: Instant) -> u64 {
    let elapsed = started_at.elapsed().as_millis();
    u64::try_from(elapsed).unwrap_or(u64::MAX).max(1)
}

fn estimate_tokens(text: &str) -> u64 {
    let chars = text.chars().count();
    u64::try_from((chars.max(1) + 3) / 4).unwrap_or(u64::MAX)
}

fn estimate_history_tokens(messages: &[(String, String)]) -> u64 {
    messages
        .iter()
        .map(|(role, content)| estimate_tokens(role) + estimate_tokens(content))
        .sum()
}

fn estimate_cost_microusd(
    pricing: Option<ProviderPricing>,
    input_tokens: u64,
    output_tokens: u64,
) -> u64 {
    let Some(pricing) = pricing else {
        return 0;
    };
    let input_cost =
        (input_tokens as f64 / 1_000_000.0) * pricing.input_cost_per_1m_usd * 1_000_000.0;
    let output_cost =
        (output_tokens as f64 / 1_000_000.0) * pricing.output_cost_per_1m_usd * 1_000_000.0;
    (input_cost + output_cost).round().max(0.0) as u64
}

#[derive(Debug, Clone, Copy)]
struct TokenAccounting {
    estimated_input_tokens: u64,
    estimated_output_tokens: u64,
    provider_input_tokens: u64,
    provider_output_tokens: u64,
    provider_total_tokens: u64,
}

fn token_accounting(
    estimated_input_tokens: u64,
    estimated_output_tokens: u64,
    usage: Option<&ProviderUsage>,
) -> TokenAccounting {
    let mut accounting = TokenAccounting {
        estimated_input_tokens,
        estimated_output_tokens,
        provider_input_tokens: 0,
        provider_output_tokens: 0,
        provider_total_tokens: 0,
    };
    if let Some(usage) = usage {
        if usage.source == ProviderUsageSource::ProviderReported {
            accounting.provider_input_tokens = usage.input_tokens;
            accounting.provider_output_tokens = usage.output_tokens;
            accounting.provider_total_tokens = usage
                .total_tokens
                .unwrap_or_else(|| usage.input_tokens.saturating_add(usage.output_tokens));
            if accounting.provider_total_tokens == 0
                && (usage.input_tokens > 0 || usage.output_tokens > 0)
            {
                accounting.provider_total_tokens =
                    usage.input_tokens.saturating_add(usage.output_tokens);
            }
        }
    }
    accounting
}

fn shared_runtime_telemetry_store() -> Arc<Mutex<HashMap<String, ProviderTelemetry>>> {
    #[cfg(test)]
    {
        Arc::new(Mutex::new(HashMap::new()))
    }
    #[cfg(not(test))]
    {
        static STORE: std::sync::OnceLock<Arc<Mutex<HashMap<String, ProviderTelemetry>>>> =
            std::sync::OnceLock::new();
        STORE
            .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
            .clone()
    }
}

// ── Error Classification ─────────────────────────────────────────────────

/// Check if an error is non-retryable (client errors that won't resolve with retries).
/// Context window errors are NOT non-retryable — they can be recovered by truncation.
pub fn is_non_retryable(err: &anyhow::Error) -> bool {
    // Context window errors are recoverable via truncation
    if is_context_window_exceeded(err) {
        return false;
    }

    let msg = err.to_string();
    let msg_lower = msg.to_lowercase();

    // 4xx HTTP status codes are generally non-retryable,
    // except 429 (rate-limit) and 408 (timeout)
    for word in msg.split(|c: char| !c.is_ascii_digit()) {
        if let Ok(code) = word.parse::<u16>() {
            if (400..500).contains(&code) {
                return code != 429 && code != 408;
            }
        }
    }

    // Auth failure heuristics
    let auth_hints = [
        "invalid api key",
        "incorrect api key",
        "missing api key",
        "api key not set",
        "authentication failed",
        "auth failed",
        "unauthorized",
        "forbidden",
        "permission denied",
        "access denied",
        "invalid token",
    ];
    if auth_hints.iter().any(|hint| msg_lower.contains(hint)) {
        return true;
    }

    // Model not found
    msg_lower.contains("model")
        && (msg_lower.contains("not found")
            || msg_lower.contains("unknown")
            || msg_lower.contains("unsupported")
            || msg_lower.contains("does not exist")
            || msg_lower.contains("invalid"))
}

/// Check if an error indicates the context window has been exceeded.
/// These errors are recoverable by truncating conversation history.
pub fn is_context_window_exceeded(err: &anyhow::Error) -> bool {
    let lower = err.to_string().to_lowercase();
    let hints = [
        "exceeds the context window",
        "exceeds the available context size",
        "context window of this model",
        "maximum context length",
        "context length exceeded",
        "too many tokens",
        "token limit exceeded",
        "prompt is too long",
        "input is too long",
        "prompt exceeds max length",
    ];
    hints.iter().any(|hint| lower.contains(hint))
}

/// Check if an error is a rate-limit (429) error.
fn is_rate_limited(err: &anyhow::Error) -> bool {
    let msg = err.to_string();
    msg.contains("429")
        && (msg.contains("Too Many") || msg.contains("rate") || msg.contains("limit"))
}

/// Check if a 429 is a business/quota error that retries cannot fix.
fn is_non_retryable_rate_limit(err: &anyhow::Error) -> bool {
    if !is_rate_limited(err) {
        return false;
    }

    let lower = err.to_string().to_lowercase();
    let business_hints = [
        "plan does not include",
        "doesn't include",
        "not include",
        "insufficient balance",
        "insufficient_balance",
        "insufficient quota",
        "insufficient_quota",
        "quota exhausted",
        "out of credits",
        "no available package",
        "package not active",
        "purchase package",
        "model not available for your plan",
    ];

    if business_hints.iter().any(|hint| lower.contains(hint)) {
        return true;
    }

    // Known provider business codes where retry is futile
    for token in lower.split(|c: char| !c.is_ascii_digit()) {
        if let Ok(code) = token.parse::<u16>() {
            if matches!(code, 1113 | 1311) {
                return true;
            }
        }
    }

    false
}

/// Try to extract a Retry-After value (in milliseconds) from an error message.
fn parse_retry_after_ms(err: &anyhow::Error) -> Option<u64> {
    let msg = err.to_string();
    let lower = msg.to_lowercase();

    for prefix in &[
        "retry-after:",
        "retry_after:",
        "retry-after ",
        "retry_after ",
    ] {
        if let Some(pos) = lower.find(prefix) {
            let after = &msg[pos + prefix.len()..];
            let num_str: String = after
                .trim()
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(secs) = num_str.parse::<f64>() {
                if secs.is_finite() && secs >= 0.0 {
                    let millis = Duration::from_secs_f64(secs).as_millis();
                    if let Ok(value) = u64::try_from(millis) {
                        return Some(value);
                    }
                }
            }
        }
    }
    None
}

fn failure_reason(rate_limited: bool, non_retryable: bool) -> &'static str {
    if rate_limited && non_retryable {
        "rate_limited_non_retryable"
    } else if rate_limited {
        "rate_limited"
    } else if non_retryable {
        "non_retryable"
    } else {
        "retryable"
    }
}

fn push_failure(
    failures: &mut Vec<String>,
    provider_idx: usize,
    model: &str,
    attempt: u32,
    max_attempts: u32,
    reason: &str,
    error_detail: &str,
) {
    failures.push(format!(
        "provider_idx={provider_idx} model={model} attempt {attempt}/{max_attempts}: {reason}; error={error_detail}"
    ));
}

/// Truncate conversation history by dropping the oldest non-system messages.
/// Keeps at least the system message (if any) and the most recent user message.
/// Returns the number of messages dropped.
pub fn truncate_for_context(messages: &mut Vec<(String, String)>) -> usize {
    // messages are (role, content) pairs
    let non_system: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter(|(_, (role, _))| role != "system")
        .map(|(i, _)| i)
        .collect();

    // Keep at least the last non-system message (most recent user turn)
    if non_system.len() <= 1 {
        return 0;
    }

    // Drop the oldest half of non-system messages
    let drop_count = non_system.len() / 2;
    let indices_to_remove: Vec<usize> = non_system[..drop_count].to_vec();

    // Remove in reverse order to preserve indices
    for &idx in indices_to_remove.iter().rev() {
        messages.remove(idx);
    }

    drop_count
}

// ── Response Validation (matches OpenMAIC's LLMRetryOptions.validate) ────

/// Default response validation: text must be non-empty and not pure whitespace.
/// This mirrors OpenMAIC's `DEFAULT_VALIDATE = (text: string) => text.trim().length > 0`.
fn validate_response(text: &str) -> bool {
    !text.trim().is_empty()
}

// ── Resilient Provider ────────────────────────────────────────────────────

/// ZeroClaw-grade provider wrapper with retry, fallback, and model failover.
///
/// Three-level failover strategy:
///   Outer:  model fallback chain (original model → configured alternatives)
///   Middle: provider chain (primary → secondary providers in priority order)
///   Inner:  retry with exponential backoff, respecting Retry-After headers
pub struct ResilientLlmProvider {
    providers: Vec<ProviderEntry>,
    max_retries: u32,
    /// How many times to retry when the LLM returns empty/invalid text
    validation_retries: u32,
    base_backoff_ms: u64,
    circuit_breaker_threshold: u32,
    circuit_breaker_cooldown_ms: u64,
    /// Per-model fallback chains: model_name → [fallback1, fallback2, ...]
    model_fallbacks: HashMap<String, Vec<String>>,
    /// The model this provider was built for (used for model chain resolution)
    model_id: Option<String>,
    health: Arc<Mutex<HashMap<String, ProviderHealth>>>,
    telemetry: Arc<Mutex<HashMap<String, ProviderTelemetry>>>,
}

impl ResilientLlmProvider {
    pub fn new(providers: Vec<(String, Box<dyn LlmProvider>, Option<ProviderPricing>)>) -> Self {
        Self {
            providers: providers
                .into_iter()
                .map(|(label, provider, pricing)| ProviderEntry {
                    label,
                    provider,
                    pricing,
                })
                .collect(),
            max_retries: 3,
            validation_retries: 2,
            base_backoff_ms: 1000,
            circuit_breaker_threshold: 2,
            circuit_breaker_cooldown_ms: 30_000,
            model_fallbacks: HashMap::new(),
            model_id: None,
            health: Arc::new(Mutex::new(HashMap::new())),
            telemetry: shared_runtime_telemetry_store(),
        }
    }

    pub fn with_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    pub fn with_validation_retries(mut self, retries: u32) -> Self {
        self.validation_retries = retries;
        self
    }

    pub fn with_model_fallbacks(mut self, fallbacks: HashMap<String, Vec<String>>) -> Self {
        self.model_fallbacks = fallbacks;
        self
    }

    pub fn with_model_id(mut self, model_id: String) -> Self {
        self.model_id = Some(model_id);
        self
    }

    pub fn with_circuit_breaker(mut self, threshold: u32, cooldown_ms: u64) -> Self {
        self.circuit_breaker_threshold = threshold.max(1);
        self.circuit_breaker_cooldown_ms = cooldown_ms.max(1);
        self
    }

    /// Compute backoff duration, respecting Retry-After if present.
    fn compute_backoff(&self, base: u64, err: &anyhow::Error) -> u64 {
        if let Some(retry_after) = parse_retry_after_ms(err) {
            // Use Retry-After but cap at 30s to avoid indefinite waits
            retry_after.min(30_000).max(base)
        } else {
            base
        }
    }

    fn can_attempt_provider(&self, label: &str) -> bool {
        let now = Instant::now();
        let health = self.health.lock().expect("provider health mutex poisoned");
        health
            .get(label)
            .is_none_or(|state| state.is_available(now))
    }

    fn mark_provider_success(
        &self,
        label: &str,
        latency_ms: u64,
        usage: TokenAccounting,
        pricing: Option<ProviderPricing>,
    ) {
        let mut health = self.health.lock().expect("provider health mutex poisoned");
        health.remove(label);
        drop(health);

        let mut telemetry = self
            .telemetry
            .lock()
            .expect("provider telemetry mutex poisoned");
        let entry = telemetry.entry(label.to_string()).or_default();
        entry.total_requests = entry.total_requests.saturating_add(1);
        entry.total_successes = entry.total_successes.saturating_add(1);
        entry.total_latency_ms = entry.total_latency_ms.saturating_add(latency_ms);
        entry.estimated_input_tokens = entry
            .estimated_input_tokens
            .saturating_add(usage.estimated_input_tokens);
        entry.estimated_output_tokens = entry
            .estimated_output_tokens
            .saturating_add(usage.estimated_output_tokens);
        entry.estimated_total_cost_microusd = entry
            .estimated_total_cost_microusd
            .saturating_add(estimate_cost_microusd(
                pricing,
                usage.estimated_input_tokens,
                usage.estimated_output_tokens,
            ));
        entry.provider_reported_input_tokens = entry
            .provider_reported_input_tokens
            .saturating_add(usage.provider_input_tokens);
        entry.provider_reported_output_tokens = entry
            .provider_reported_output_tokens
            .saturating_add(usage.provider_output_tokens);
        entry.provider_reported_total_tokens = entry
            .provider_reported_total_tokens
            .saturating_add(usage.provider_total_tokens);
        entry.provider_reported_total_cost_microusd = entry
            .provider_reported_total_cost_microusd
            .saturating_add(estimate_cost_microusd(
                pricing,
                usage.provider_input_tokens,
                usage.provider_output_tokens,
            ));
        entry.last_success_unix_ms = Some(now_unix_ms());
        entry.last_latency_ms = Some(latency_ms);
    }

    fn mark_provider_failure(
        &self,
        label: &str,
        non_retryable: bool,
        error_detail: &str,
        latency_ms: u64,
        estimated_input_tokens: u64,
        pricing: Option<ProviderPricing>,
    ) {
        let mut health = self.health.lock().expect("provider health mutex poisoned");
        let state = health.entry(label.to_string()).or_insert(ProviderHealth {
            consecutive_failures: 0,
            circuit_open_until: None,
        });

        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        if non_retryable || state.consecutive_failures >= self.circuit_breaker_threshold {
            state.circuit_open_until =
                Some(Instant::now() + Duration::from_millis(self.circuit_breaker_cooldown_ms));
        }
        drop(health);

        let mut telemetry = self
            .telemetry
            .lock()
            .expect("provider telemetry mutex poisoned");
        let entry = telemetry.entry(label.to_string()).or_default();
        entry.total_requests = entry.total_requests.saturating_add(1);
        entry.total_failures = entry.total_failures.saturating_add(1);
        entry.total_latency_ms = entry.total_latency_ms.saturating_add(latency_ms);
        entry.estimated_input_tokens = entry
            .estimated_input_tokens
            .saturating_add(estimated_input_tokens);
        entry.estimated_total_cost_microusd = entry
            .estimated_total_cost_microusd
            .saturating_add(estimate_cost_microusd(pricing, estimated_input_tokens, 0));
        entry.last_error = Some(trim_error_for_status(error_detail));
        entry.last_failure_unix_ms = Some(now_unix_ms());
        entry.last_latency_ms = Some(latency_ms);
    }
}

#[async_trait]
impl LlmProvider for ResilientLlmProvider {
    async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        let mut failures = Vec::new();
        let input_tokens =
            estimate_tokens(system_prompt).saturating_add(estimate_tokens(user_prompt));

        // Three-level failover: providers → retries (no model chain for
        // generate_text since the model is baked into the provider at construction)
        for (idx, provider) in self.providers.iter().enumerate() {
            if !self.can_attempt_provider(&provider.label) {
                push_failure(
                    &mut failures,
                    idx,
                    "default",
                    0,
                    self.max_retries + 1,
                    "circuit_open",
                    &format!("provider {} is cooling down", provider.label),
                );
                continue;
            }

            let mut backoff_ms = self.base_backoff_ms;

            for attempt in 0..=self.max_retries {
                let started_at = Instant::now();
                match provider
                    .provider
                    .generate_text_with_usage(system_prompt, user_prompt)
                    .await
                {
                    Ok((resp, usage)) => {
                        // ── Validation retry (matches OpenMAIC's LLMRetryOptions) ──
                        if !validate_response(&resp) {
                            // Retry up to validation_retries times on this provider
                            let mut valid_resp = None;
                            for v_attempt in 1..=self.validation_retries {
                                warn!(
                                    provider = %provider.label,
                                    v_attempt,
                                    max = self.validation_retries,
                                    "Response failed validation (empty/whitespace), retrying"
                                );
                                match provider
                                    .provider
                                    .generate_text_with_usage(system_prompt, user_prompt)
                                    .await
                                {
                                    Ok((retry_resp, retry_usage))
                                        if validate_response(&retry_resp) =>
                                    {
                                        valid_resp = Some((retry_resp, retry_usage));
                                        break;
                                    }
                                    Ok(_) => continue,
                                    Err(_) => break,
                                }
                            }
                            if let Some((good, good_usage)) = valid_resp {
                                self.mark_provider_success(
                                    &provider.label,
                                    elapsed_ms(started_at),
                                    token_accounting(
                                        input_tokens,
                                        estimate_tokens(&good),
                                        good_usage.as_ref(),
                                    ),
                                    provider.pricing,
                                );
                                return Ok(good);
                            }
                            // All validation retries exhausted — fall through to next attempt
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "validation_failed",
                                "LLM returned empty/whitespace text after validation retries",
                            );
                            continue;
                        }

                        self.mark_provider_success(
                            &provider.label,
                            elapsed_ms(started_at),
                            token_accounting(input_tokens, estimate_tokens(&resp), usage.as_ref()),
                            provider.pricing,
                        );
                        if attempt > 0 || idx > 0 {
                            info!(
                                attempt,
                                provider_idx = idx,
                                provider = %provider.label,
                                "Provider recovered (failover/retry)"
                            );
                        }
                        return Ok(resp);
                    }
                    Err(e) => {
                        // Context window exceeded with no history to truncate
                        // in generate_text (only system+user) — bail immediately
                        if is_context_window_exceeded(&e) {
                            let error_detail = e.to_string();
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "context_window_exceeded",
                                &error_detail,
                            );
                            anyhow::bail!(
                                "Request exceeds model context window and cannot be reduced further. \
                                 Try using a model with a larger context window. Attempts:\n{}",
                                failures.join("\n")
                            );
                        }

                        let non_retryable_rl = is_non_retryable_rate_limit(&e);
                        let non_retryable = is_non_retryable(&e) || non_retryable_rl;
                        let rate_limited = is_rate_limited(&e);
                        let reason = failure_reason(rate_limited, non_retryable);
                        let error_detail = e.to_string();

                        push_failure(
                            &mut failures,
                            idx,
                            "default",
                            attempt + 1,
                            self.max_retries + 1,
                            reason,
                            &error_detail,
                        );

                        if non_retryable {
                            self.mark_provider_failure(
                                &provider.label,
                                true,
                                &error_detail,
                                elapsed_ms(started_at),
                                input_tokens,
                                provider.pricing,
                            );
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                error = %error_detail,
                                "Non-retryable error, moving to next provider"
                            );
                            break;
                        }

                        if attempt < self.max_retries {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                input_tokens,
                                provider.pricing,
                            );
                            let wait = self.compute_backoff(backoff_ms, &e);
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                attempt = attempt + 1,
                                backoff_ms = wait,
                                reason,
                                error = %error_detail,
                                "Provider call failed, retrying"
                            );
                            tokio::time::sleep(Duration::from_millis(wait)).await;
                            backoff_ms = (backoff_ms.saturating_mul(2)).min(10_000);
                        } else {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                input_tokens,
                                provider.pricing,
                            );
                        }
                    }
                }
            }

            warn!(
                provider_idx = idx,
                "Exhausted retries, trying next provider if available"
            );
        }

        anyhow::bail!(
            "All providers/models failed. Attempts:\n{}",
            failures.join("\n")
        )
    }

    async fn generate_text_with_history(&self, messages: &[(String, String)]) -> Result<String> {
        let mut failures = Vec::new();
        let mut effective_messages = messages.to_vec();
        let mut context_truncated = false;

        for (idx, provider) in self.providers.iter().enumerate() {
            if !self.can_attempt_provider(&provider.label) {
                push_failure(
                    &mut failures,
                    idx,
                    "default",
                    0,
                    self.max_retries + 1,
                    "circuit_open",
                    &format!("provider {} is cooling down", provider.label),
                );
                continue;
            }

            let mut backoff_ms = self.base_backoff_ms;

            for attempt in 0..=self.max_retries {
                let started_at = Instant::now();
                match provider
                    .provider
                    .generate_text_with_history_and_usage(&effective_messages)
                    .await
                {
                    Ok((resp, usage)) => {
                        // ── Validation retry for history path ──
                        if !validate_response(&resp) {
                            let mut valid_resp = None;
                            for v_attempt in 1..=self.validation_retries {
                                warn!(
                                    provider = %provider.label,
                                    v_attempt,
                                    max = self.validation_retries,
                                    "Response failed validation (empty/whitespace), retrying"
                                );
                                match provider
                                    .provider
                                    .generate_text_with_history_and_usage(&effective_messages)
                                    .await
                                {
                                    Ok((retry_resp, retry_usage))
                                        if validate_response(&retry_resp) =>
                                    {
                                        valid_resp = Some((retry_resp, retry_usage));
                                        break;
                                    }
                                    Ok(_) => continue,
                                    Err(_) => break,
                                }
                            }
                            if let Some((good, good_usage)) = valid_resp {
                                self.mark_provider_success(
                                    &provider.label,
                                    elapsed_ms(started_at),
                                    token_accounting(
                                        estimate_history_tokens(&effective_messages),
                                        estimate_tokens(&good),
                                        good_usage.as_ref(),
                                    ),
                                    provider.pricing,
                                );
                                return Ok(good);
                            }
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "validation_failed",
                                "LLM returned empty/whitespace text after validation retries",
                            );
                            continue;
                        }

                        self.mark_provider_success(
                            &provider.label,
                            elapsed_ms(started_at),
                            token_accounting(
                                estimate_history_tokens(&effective_messages),
                                estimate_tokens(&resp),
                                usage.as_ref(),
                            ),
                            provider.pricing,
                        );
                        if attempt > 0 || idx > 0 || context_truncated {
                            info!(
                                attempt,
                                provider_idx = idx,
                                provider = %provider.label,
                                context_truncated,
                                "Provider recovered (failover/retry)"
                            );
                        }
                        return Ok(resp);
                    }
                    Err(e) => {
                        // Context window exceeded: truncate history and retry
                        if is_context_window_exceeded(&e) && !context_truncated {
                            let dropped = truncate_for_context(&mut effective_messages);
                            if dropped > 0 {
                                context_truncated = true;
                                warn!(
                                    provider_idx = idx,
                                    dropped,
                                    remaining = effective_messages.len(),
                                    "Context window exceeded; truncated history and retrying"
                                );
                                continue; // Retry with truncated messages
                            }
                            // Nothing to truncate — bail
                            let error_detail = e.to_string();
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "context_window_exceeded",
                                &error_detail,
                            );
                            anyhow::bail!(
                                "Request exceeds model context window and cannot be reduced further. Attempts:\n{}",
                                failures.join("\n")
                            );
                        }

                        let non_retryable_rl = is_non_retryable_rate_limit(&e);
                        let non_retryable = is_non_retryable(&e) || non_retryable_rl;
                        let rate_limited = is_rate_limited(&e);
                        let reason = failure_reason(rate_limited, non_retryable);
                        let error_detail = e.to_string();

                        push_failure(
                            &mut failures,
                            idx,
                            "default",
                            attempt + 1,
                            self.max_retries + 1,
                            reason,
                            &error_detail,
                        );

                        if non_retryable {
                            self.mark_provider_failure(
                                &provider.label,
                                true,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                error = %error_detail,
                                "Non-retryable error, moving to next provider"
                            );
                            break;
                        }

                        if attempt < self.max_retries {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                            let wait = self.compute_backoff(backoff_ms, &e);
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                attempt = attempt + 1,
                                backoff_ms = wait,
                                reason,
                                error = %error_detail,
                                "Provider call failed, retrying"
                            );
                            tokio::time::sleep(Duration::from_millis(wait)).await;
                            backoff_ms = (backoff_ms.saturating_mul(2)).min(10_000);
                        } else {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                        }
                    }
                }
            }

            warn!(
                provider_idx = idx,
                "Exhausted retries, trying next provider if available"
            );
        }

        anyhow::bail!(
            "All providers/models failed. Attempts:\n{}",
            failures.join("\n")
        )
    }

    async fn generate_text_stream_with_history(
        &self,
        messages: &[(String, String)],
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let cancellation = CancellationToken::new();
        self.generate_text_stream_with_history_cancellable(messages, &cancellation, on_delta)
            .await
    }

    async fn generate_text_stream_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_delta: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let mut failures = Vec::new();
        let mut effective_messages = messages.to_vec();
        let mut context_truncated = false;

        for (idx, provider) in self.providers.iter().enumerate() {
            if cancellation.is_cancelled() {
                anyhow::bail!("stream cancelled");
            }
            if !self.can_attempt_provider(&provider.label) {
                push_failure(
                    &mut failures,
                    idx,
                    "default",
                    0,
                    self.max_retries + 1,
                    "circuit_open",
                    &format!("provider {} is cooling down", provider.label),
                );
                continue;
            }

            let mut backoff_ms = self.base_backoff_ms;

            for attempt in 0..=self.max_retries {
                let started_at = Instant::now();
                match provider
                    .provider
                    .generate_text_stream_with_history_cancellable(
                        &effective_messages,
                        cancellation,
                        on_delta,
                    )
                    .await
                {
                    Ok(resp) => {
                        if !validate_response(&resp) {
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "validation_failed",
                                "LLM returned empty/whitespace text during streaming",
                            );
                            continue;
                        }

                        self.mark_provider_success(
                            &provider.label,
                            elapsed_ms(started_at),
                            token_accounting(
                                estimate_history_tokens(&effective_messages),
                                estimate_tokens(&resp),
                                None,
                            ),
                            provider.pricing,
                        );
                        if attempt > 0 || idx > 0 || context_truncated {
                            info!(
                                attempt,
                                provider_idx = idx,
                                provider = %provider.label,
                                context_truncated,
                                "Streaming provider recovered (failover/retry)"
                            );
                        }
                        return Ok(resp);
                    }
                    Err(e) => {
                        if cancellation.is_cancelled() {
                            anyhow::bail!("stream cancelled");
                        }
                        if is_context_window_exceeded(&e) && !context_truncated {
                            let dropped = truncate_for_context(&mut effective_messages);
                            if dropped > 0 {
                                context_truncated = true;
                                warn!(
                                    provider_idx = idx,
                                    dropped,
                                    remaining = effective_messages.len(),
                                    "Streaming context window exceeded; truncated history and retrying"
                                );
                                continue;
                            }

                            let error_detail = e.to_string();
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "context_window_exceeded",
                                &error_detail,
                            );
                            anyhow::bail!(
                                "Streaming request exceeds model context window and cannot be reduced further. Attempts:\n{}",
                                failures.join("\n")
                            );
                        }

                        let non_retryable_rl = is_non_retryable_rate_limit(&e);
                        let non_retryable = is_non_retryable(&e) || non_retryable_rl;
                        let rate_limited = is_rate_limited(&e);
                        let reason = failure_reason(rate_limited, non_retryable);
                        let error_detail = e.to_string();

                        push_failure(
                            &mut failures,
                            idx,
                            "default",
                            attempt + 1,
                            self.max_retries + 1,
                            reason,
                            &error_detail,
                        );

                        if non_retryable {
                            self.mark_provider_failure(
                                &provider.label,
                                true,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                error = %error_detail,
                                "Non-retryable streaming error, moving to next provider"
                            );
                            break;
                        }

                        if attempt < self.max_retries {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                            let wait = self.compute_backoff(backoff_ms, &e);
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                attempt = attempt + 1,
                                backoff_ms = wait,
                                reason,
                                error = %error_detail,
                                "Streaming provider call failed, retrying"
                            );
                            tokio::select! {
                                _ = cancellation.cancelled() => {
                                    anyhow::bail!("stream cancelled");
                                }
                                _ = tokio::time::sleep(Duration::from_millis(wait)) => {}
                            }
                            backoff_ms = (backoff_ms.saturating_mul(2)).min(10_000);
                        } else {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                        }
                    }
                }
            }

            warn!(
                provider_idx = idx,
                "Exhausted streaming retries, trying next provider if available"
            );
        }

        anyhow::bail!(
            "All providers/models failed during streaming. Attempts:\n{}",
            failures.join("\n")
        )
    }

    async fn generate_stream_events_with_history(
        &self,
        messages: &[(String, String)],
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<String> {
        let cancellation = CancellationToken::new();
        self.generate_stream_events_with_history_cancellable(messages, &cancellation, on_event)
            .await
    }

    async fn generate_stream_events_with_history_cancellable(
        &self,
        messages: &[(String, String)],
        cancellation: &CancellationToken,
        on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
    ) -> Result<String> {
        let mut failures = Vec::new();
        let mut effective_messages = messages.to_vec();
        let mut context_truncated = false;

        for (idx, provider) in self.providers.iter().enumerate() {
            if cancellation.is_cancelled() {
                anyhow::bail!("stream cancelled");
            }
            if !self.can_attempt_provider(&provider.label) {
                push_failure(
                    &mut failures,
                    idx,
                    "default",
                    0,
                    self.max_retries + 1,
                    "circuit_open",
                    &format!("provider {} is cooling down", provider.label),
                );
                continue;
            }

            let mut backoff_ms = self.base_backoff_ms;

            for attempt in 0..=self.max_retries {
                let started_at = Instant::now();
                let mut provider_usage: Option<ProviderUsage> = None;
                match provider
                    .provider
                    .generate_stream_events_with_history_cancellable(
                        &effective_messages,
                        cancellation,
                        &mut |event| {
                            if let ProviderStreamEvent::Done { usage, .. } = &event {
                                if provider_usage.is_none() {
                                    provider_usage = usage.clone();
                                }
                            }
                            on_event(event);
                        },
                    )
                    .await
                {
                    Ok(resp) => {
                        if !validate_response(&resp) {
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "validation_failed",
                                "LLM returned empty/whitespace text during typed streaming",
                            );
                            continue;
                        }

                        self.mark_provider_success(
                            &provider.label,
                            elapsed_ms(started_at),
                            token_accounting(
                                estimate_history_tokens(&effective_messages),
                                estimate_tokens(&resp),
                                provider_usage.as_ref(),
                            ),
                            provider.pricing,
                        );
                        if attempt > 0 || idx > 0 || context_truncated {
                            info!(
                                attempt,
                                provider_idx = idx,
                                provider = %provider.label,
                                context_truncated,
                                "Typed streaming provider recovered (failover/retry)"
                            );
                        }
                        return Ok(resp);
                    }
                    Err(e) => {
                        if cancellation.is_cancelled() {
                            anyhow::bail!("stream cancelled");
                        }
                        if is_context_window_exceeded(&e) && !context_truncated {
                            let dropped = truncate_for_context(&mut effective_messages);
                            if dropped > 0 {
                                context_truncated = true;
                                warn!(
                                    provider_idx = idx,
                                    dropped,
                                    remaining = effective_messages.len(),
                                    "Typed streaming context window exceeded; truncated history and retrying"
                                );
                                continue;
                            }

                            let error_detail = e.to_string();
                            push_failure(
                                &mut failures,
                                idx,
                                "default",
                                attempt + 1,
                                self.max_retries + 1,
                                "context_window_exceeded",
                                &error_detail,
                            );
                            anyhow::bail!(
                                "Typed streaming request exceeds model context window and cannot be reduced further. Attempts:\n{}",
                                failures.join("\n")
                            );
                        }

                        let non_retryable_rl = is_non_retryable_rate_limit(&e);
                        let non_retryable = is_non_retryable(&e) || non_retryable_rl;
                        let rate_limited = is_rate_limited(&e);
                        let reason = failure_reason(rate_limited, non_retryable);
                        let error_detail = e.to_string();

                        push_failure(
                            &mut failures,
                            idx,
                            "default",
                            attempt + 1,
                            self.max_retries + 1,
                            reason,
                            &error_detail,
                        );

                        if non_retryable {
                            self.mark_provider_failure(
                                &provider.label,
                                true,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                error = %error_detail,
                                "Non-retryable typed streaming error, moving to next provider"
                            );
                            break;
                        }

                        if attempt < self.max_retries {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                            let wait = self.compute_backoff(backoff_ms, &e);
                            warn!(
                                provider_idx = idx,
                                provider = %provider.label,
                                attempt = attempt + 1,
                                backoff_ms = wait,
                                reason,
                                error = %error_detail,
                                "Typed streaming provider call failed, retrying"
                            );
                            tokio::select! {
                                _ = cancellation.cancelled() => {
                                    anyhow::bail!("stream cancelled");
                                }
                                _ = tokio::time::sleep(Duration::from_millis(wait)) => {}
                            }
                            backoff_ms = (backoff_ms.saturating_mul(2)).min(10_000);
                        } else {
                            self.mark_provider_failure(
                                &provider.label,
                                false,
                                &error_detail,
                                elapsed_ms(started_at),
                                estimate_history_tokens(&effective_messages),
                                provider.pricing,
                            );
                        }
                    }
                }
            }

            warn!(
                provider_idx = idx,
                "Exhausted typed streaming retries, trying next provider if available"
            );
        }

        anyhow::bail!(
            "All providers/models failed during typed streaming. Attempts:\n{}",
            failures.join("\n")
        )
    }

    fn runtime_status(&self) -> Vec<ProviderRuntimeStatus> {
        let now = Instant::now();
        let health = self.health.lock().expect("provider health mutex poisoned");
        let telemetry = self
            .telemetry
            .lock()
            .expect("provider telemetry mutex poisoned");
        self.providers
            .iter()
            .map(|entry| {
                let state = health.get(&entry.label).cloned().unwrap_or(ProviderHealth {
                    consecutive_failures: 0,
                    circuit_open_until: None,
                });
                let stats = telemetry.get(&entry.label).cloned().unwrap_or_default();
                let average_latency_ms = if stats.total_requests > 0 {
                    Some(stats.total_latency_ms / stats.total_requests)
                } else {
                    None
                };
                let cooldown_remaining_ms = state
                    .circuit_open_until
                    .and_then(|until| {
                        if until > now {
                            Some((until - now).as_millis() as u64)
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0);
                ProviderRuntimeStatus {
                    label: entry.label.clone(),
                    available: state.is_available(now),
                    consecutive_failures: state.consecutive_failures,
                    cooldown_remaining_ms,
                    total_requests: stats.total_requests,
                    total_successes: stats.total_successes,
                    total_failures: stats.total_failures,
                    last_error: stats.last_error,
                    last_success_unix_ms: stats.last_success_unix_ms,
                    last_failure_unix_ms: stats.last_failure_unix_ms,
                    total_latency_ms: stats.total_latency_ms,
                    average_latency_ms,
                    last_latency_ms: stats.last_latency_ms,
                    estimated_input_tokens: stats.estimated_input_tokens,
                    estimated_output_tokens: stats.estimated_output_tokens,
                    estimated_total_cost_microusd: stats.estimated_total_cost_microusd,
                    provider_reported_input_tokens: stats.provider_reported_input_tokens,
                    provider_reported_output_tokens: stats.provider_reported_output_tokens,
                    provider_reported_total_tokens: stats.provider_reported_total_tokens,
                    provider_reported_total_cost_microusd: stats
                        .provider_reported_total_cost_microusd,
                    streaming_path: entry.provider.streaming_path(),
                    capabilities: entry.provider.capabilities(),
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use anyhow::anyhow;

    #[test]
    fn non_retryable_detects_common_patterns() {
        assert!(is_non_retryable(&anyhow::anyhow!("400 Bad Request")));
        assert!(is_non_retryable(&anyhow::anyhow!("401 Unauthorized")));
        assert!(is_non_retryable(&anyhow::anyhow!("403 Forbidden")));
        assert!(is_non_retryable(&anyhow::anyhow!("404 Not Found")));
        assert!(is_non_retryable(&anyhow::anyhow!(
            "invalid api key provided"
        )));
        assert!(is_non_retryable(&anyhow::anyhow!("authentication failed")));
        assert!(is_non_retryable(&anyhow::anyhow!(
            "model glm-4.7 not found"
        )));
        assert!(is_non_retryable(&anyhow::anyhow!(
            "unsupported model: glm-4.7"
        )));
        // Retryable errors
        assert!(!is_non_retryable(&anyhow::anyhow!("429 Too Many Requests")));
        assert!(!is_non_retryable(&anyhow::anyhow!("408 Request Timeout")));
        assert!(!is_non_retryable(&anyhow::anyhow!(
            "500 Internal Server Error"
        )));
        assert!(!is_non_retryable(&anyhow::anyhow!("502 Bad Gateway")));
        assert!(!is_non_retryable(&anyhow::anyhow!("timeout")));
        assert!(!is_non_retryable(&anyhow::anyhow!("connection reset")));
        // Context window errors are recoverable (not non-retryable)
        assert!(!is_non_retryable(&anyhow::anyhow!(
            "exceeds the context window of this model"
        )));
    }

    #[test]
    fn context_window_detection() {
        assert!(is_context_window_exceeded(&anyhow::anyhow!(
            "exceeds the context window"
        )));
        assert!(is_context_window_exceeded(&anyhow::anyhow!(
            "maximum context length exceeded"
        )));
        assert!(is_context_window_exceeded(&anyhow::anyhow!(
            "too many tokens"
        )));
        assert!(is_context_window_exceeded(&anyhow::anyhow!(
            "prompt is too long"
        )));
        assert!(!is_context_window_exceeded(&anyhow::anyhow!(
            "500 Internal Server Error"
        )));
        assert!(!is_context_window_exceeded(&anyhow::anyhow!(
            "invalid api key"
        )));
    }

    #[test]
    fn non_retryable_rate_limit_detection() {
        assert!(is_non_retryable_rate_limit(&anyhow::anyhow!(
            "429 rate limit: plan does not include this model"
        )));
        assert!(is_non_retryable_rate_limit(&anyhow::anyhow!(
            "429 Too Many Requests: insufficient balance"
        )));
        assert!(is_non_retryable_rate_limit(&anyhow::anyhow!(
            "429 rate limit: quota exhausted"
        )));
        // Transient 429 — retryable, NOT a business error
        assert!(!is_non_retryable_rate_limit(&anyhow::anyhow!(
            "429 Too Many Requests"
        )));
        // Not a 429 at all
        assert!(!is_non_retryable_rate_limit(&anyhow::anyhow!(
            "500 Internal Error"
        )));
    }

    #[test]
    fn retry_after_parsing() {
        assert_eq!(
            parse_retry_after_ms(&anyhow::anyhow!("Retry-After: 5")),
            Some(5000)
        );
        assert_eq!(
            parse_retry_after_ms(&anyhow::anyhow!("retry_after: 2.5")),
            Some(2500)
        );
        assert_eq!(
            parse_retry_after_ms(&anyhow::anyhow!("no retry info")),
            None
        );
    }

    #[test]
    fn truncate_for_context_drops_oldest_half() {
        let mut messages = vec![
            ("system".to_string(), "You are helpful.".to_string()),
            ("user".to_string(), "Message 1".to_string()),
            ("assistant".to_string(), "Reply 1".to_string()),
            ("user".to_string(), "Message 2".to_string()),
            ("assistant".to_string(), "Reply 2".to_string()),
            ("user".to_string(), "Message 3".to_string()),
        ];
        let dropped = truncate_for_context(&mut messages);
        assert_eq!(dropped, 2); // drops oldest 2 of 5 non-system messages
        assert_eq!(messages[0].0, "system"); // system message preserved
        assert_eq!(messages.len(), 4); // 6 - 2 = 4
    }

    #[test]
    fn truncate_preserves_single_message() {
        let mut messages = vec![
            ("system".to_string(), "You are helpful.".to_string()),
            ("user".to_string(), "Only message".to_string()),
        ];
        let dropped = truncate_for_context(&mut messages);
        assert_eq!(dropped, 0); // nothing to drop
        assert_eq!(messages.len(), 2);
    }

    struct FakeProvider {
        calls: Arc<AtomicUsize>,
        fail_message: Option<String>,
        response: String,
    }

    struct UsageReportingProvider;

    #[async_trait]
    impl LlmProvider for UsageReportingProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok("reported".to_string())
        }

        async fn generate_text_with_usage(
            &self,
            _system_prompt: &str,
            _user_prompt: &str,
        ) -> Result<(String, Option<ProviderUsage>)> {
            Ok((
                "reported".to_string(),
                Some(ProviderUsage {
                    input_tokens: 123,
                    output_tokens: 45,
                    total_tokens: Some(168),
                    source: ProviderUsageSource::ProviderReported,
                }),
            ))
        }
    }

    #[async_trait]
    impl LlmProvider for FakeProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(message) = &self.fail_message {
                return Err(anyhow!(message.clone()));
            }
            Ok(self.response.clone())
        }
    }

    #[tokio::test]
    async fn falls_back_to_secondary_provider_after_primary_failure() {
        let primary_calls = Arc::new(AtomicUsize::new(0));
        let secondary_calls = Arc::new(AtomicUsize::new(0));
        let resilient = ResilientLlmProvider::new(vec![
            (
                "openai:gpt-4o-mini".to_string(),
                Box::new(FakeProvider {
                    calls: Arc::clone(&primary_calls),
                    fail_message: Some("429 Too Many Requests".to_string()),
                    response: String::new(),
                }) as Box<dyn LlmProvider>,
                None,
            ),
            (
                "anthropic:claude-sonnet-4-6".to_string(),
                Box::new(FakeProvider {
                    calls: Arc::clone(&secondary_calls),
                    fail_message: None,
                    response: "{\"ok\":true}".to_string(),
                }) as Box<dyn LlmProvider>,
                None,
            ),
        ])
        .with_retries(0)
        .with_circuit_breaker(1, 60_000);

        let result = resilient.generate_text("system", "user").await.unwrap();

        assert_eq!(result, "{\"ok\":true}");
        assert_eq!(primary_calls.load(Ordering::SeqCst), 1);
        assert_eq!(secondary_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn skips_provider_while_circuit_is_open() {
        let primary_calls = Arc::new(AtomicUsize::new(0));
        let secondary_calls = Arc::new(AtomicUsize::new(0));
        let resilient = ResilientLlmProvider::new(vec![
            (
                "openai:gpt-4o-mini".to_string(),
                Box::new(FakeProvider {
                    calls: Arc::clone(&primary_calls),
                    fail_message: Some("429 Too Many Requests".to_string()),
                    response: String::new(),
                }) as Box<dyn LlmProvider>,
                None,
            ),
            (
                "anthropic:claude-sonnet-4-6".to_string(),
                Box::new(FakeProvider {
                    calls: Arc::clone(&secondary_calls),
                    fail_message: None,
                    response: "{\"ok\":true}".to_string(),
                }) as Box<dyn LlmProvider>,
                None,
            ),
        ])
        .with_retries(0)
        .with_circuit_breaker(1, 60_000);

        resilient.generate_text("system", "user").await.unwrap();
        resilient.generate_text("system", "user").await.unwrap();

        assert_eq!(primary_calls.load(Ordering::SeqCst), 1);
        assert_eq!(secondary_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn runtime_status_exposes_provider_telemetry_counters() {
        let resilient = ResilientLlmProvider::new(vec![(
            "openai:gpt-4o-mini".to_string(),
            Box::new(FakeProvider {
                calls: Arc::new(AtomicUsize::new(0)),
                fail_message: Some("429 Too Many Requests".to_string()),
                response: String::new(),
            }) as Box<dyn LlmProvider>,
            Some(ProviderPricing {
                input_cost_per_1m_usd: 2.0,
                output_cost_per_1m_usd: 8.0,
            }),
        )])
        .with_retries(0)
        .with_circuit_breaker(1, 60_000);

        let _ = resilient.generate_text("system", "user").await;
        let status = resilient.runtime_status();
        assert_eq!(status.len(), 1);
        let provider = &status[0];
        assert!(provider.total_requests >= 1);
        assert!(provider.total_failures >= 1);
        assert_eq!(provider.total_successes, 0);
        assert!(provider.last_failure_unix_ms.is_some());
        assert!(provider.estimated_input_tokens > 0);
        assert_eq!(provider.estimated_output_tokens, 0);
        assert!(provider.estimated_total_cost_microusd > 0);
        assert!(provider
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("429"));
    }

    #[tokio::test]
    async fn runtime_status_tracks_provider_reported_token_usage() {
        let resilient = ResilientLlmProvider::new(vec![(
            "openai:gpt-5.2".to_string(),
            Box::new(UsageReportingProvider) as Box<dyn LlmProvider>,
            Some(ProviderPricing {
                input_cost_per_1m_usd: 2.0,
                output_cost_per_1m_usd: 8.0,
            }),
        )])
        .with_retries(0)
        .with_circuit_breaker(1, 60_000);

        let response = resilient
            .generate_text("system prompt", "user prompt")
            .await
            .expect("provider usage call should succeed");
        assert_eq!(response, "reported");

        let status = resilient.runtime_status();
        assert_eq!(status.len(), 1);
        let provider = &status[0];
        assert_eq!(provider.provider_reported_input_tokens, 123);
        assert_eq!(provider.provider_reported_output_tokens, 45);
        assert_eq!(provider.provider_reported_total_tokens, 168);
        assert!(provider.provider_reported_total_cost_microusd > 0);
    }
}
