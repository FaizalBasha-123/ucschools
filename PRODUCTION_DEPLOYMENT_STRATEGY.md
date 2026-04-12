# Production Deployment Strategy: Adaptive Learning System

**Target**: Ship adaptive learning to production by Week 7-8  
**Risk Level**: LOW (graceful degradation, feature-flagged, canary rollout)  
**Rollback Plan**: < 5 minutes (feature flag flip)

---

## Part 1: Integration Architecture (How It Fits into AI-Tutor)

### Current Flow (Pre-Adaptive)
```
Student Quiz Attempt
    ↓
POST /quiz/submit
    ↓
app/handlers/quiz.rs: grade_answer()
    ↓
Return: { correct: bool, score: int }
    ↓
Frontend shows generic explanation OR next question
```

### New Flow (Adaptive Enabled)
```
Student Quiz Attempt
    ↓
POST /quiz/submit?adaptive=true
    ↓
app/handlers/quiz.rs: submit_quiz_with_adaptation()
    ├─ OLD PATH: grade_answer() → { correct, score }
    │
    └─ NEW PATH (if !correct):
        ├─ error_detective.diagnose() → ErrorDiagnosis
        ├─ [FALLBACK: heuristic if timeout]
        │
        ├─ misconception_mapper.map_error() → MisconceptionMatch?
        ├─ [FALLBACK: generic explanation if no match]
        │
        ├─ adaptation_engine.select_strategy() → ExplanationStrategy
        ├─ [FALLBACK: primary strategy if error]
        │
        ├─ llm_provider.generate_explanation() → String
        ├─ [FALLBACK: pre-written template if timeout]
        │
        └─ learning_loop.record_outcome() [async, non-blocking]
            └─ update student profile, KB stats
    ↓
Return: {
    correct: false,
    score: 0,
    error_diagnosis: {...},
    misconception: {...},
    adaptive_explanation: String,
    strategy_used: String,
}
    ↓
Frontend displays adaptive explanation
    ↓
Student reattempts
    ↓
Learning loop updates student model
```

---

## Part 2: Resilience & Circuit Breakers

### Multi-Layer Fallback Strategy

**Layer 1: LLM Provider Timeout (500ms hard timeout)**
```
Error Detective calls LLM
    if timeout/error:
        ↓
    Use heuristic: Levenshtein distance + keyword matching
    Mark diagnosis.confidence = 0.3 (low trust signal)
    Log and alert (for monitoring)
    ↓
    Continue pipeline with low-confidence diagnosis
```

**Layer 2: Misconception KB Lookup (50ms timeout)**
```
Misconception Mapper searches KB
    if timeout/not found:
        ↓
    No misconception match (match = None)
    Skip to generic explanation template
    ↓
    Continue pipeline without adaptive strategy
```

**Layer 3: Strategy Selection Timeout (100ms)**
```
Adaptation Engine selects strategy
    if error/timeout:
        ↓
    Use safe default: ExplanationStrategy::WorkedExample
    (least likely to confuse if wrong)
    ↓
    Continue pipeline with fallback strategy
```

**Layer 4: Explanation Generation Timeout (2s hard timeout)**
```
LLM generates adaptive explanation
    if timeout/error:
        ↓
    Use pre-written template:
    "You answered: {answer}. Expected: {expected}.
     Study this concept again: {concept_url}"
    ↓
    Return to frontend with degraded response
```

**Layer 5: Learning Loop Recording (Fire & Forget)**
```
Learning loop update runs in background
    if error/timeout:
        ↓
    Log warning (don't block student response)
    Queue for retry (batch job later)
    ↓
    Student gets response immediately (unaffected)
```

### Circuit Breaker for LLM Provider

```rust
pub struct CircuitBreaker {
    failure_count: AtomicU32,
    success_count: AtomicU32,
    last_failure_time: Mutex<Option<Instant>>,
    state: Mutex<CircuitState>,  // Open, Closed, HalfOpen
}

pub enum CircuitState {
    Closed,      // Normal operation
    Open,        // Too many failures, reject calls
    HalfOpen,    // Testing if service recovered
}

impl CircuitBreaker {
    pub async fn call<F, T>(&self, f: F) -> Result<T>
    where
        F: Fn() -> BoxFuture<'static, Result<T>>,
    {
        match self.state.lock().await {
            CircuitState::Open => {
                // If open for >30s, try half-open
                if self.since_last_failure() > Duration::from_secs(30) {
                    *self.state.lock().await = CircuitState::HalfOpen;
                    // Try one request
                } else {
                    return Err(anyhow!("Circuit breaker open"));
                }
            }
            _ => {}
        }

        // Try the call
        match f().await {
            Ok(result) => {
                self.success_count.fetch_add(1, Ordering::Relaxed);
                if self.success_count.load(Ordering::Relaxed) > 5 {
                    // Close circuit after 5 successes
                    *self.state.lock().await = CircuitState::Closed;
                    self.failure_count.store(0, Ordering::Relaxed);
                    self.success_count.store(0, Ordering::Relaxed);
                }
                Ok(result)
            }
            Err(e) => {
                self.failure_count.fetch_add(1, Ordering::Relaxed);
                if self.failure_count.load(Ordering::Relaxed) > 3 {
                    // Open circuit after 3 failures
                    *self.state.lock().await = CircuitState::Open;
                    *self.last_failure_time.lock().await = Some(Instant::now());
                }
                Err(e)
            }
        }
    }
}
```

---

## Part 3: Feature Flag & Gradual Rollout

### Feature Flag Configuration

**Location**: `crates/runtime/src/config.rs`

```rust
pub struct AdaptiveLearningConfig {
    /// Enable adaptive learning for all students
    pub enabled: bool,
    
    /// Percentage of students to enable for (0-100)
    pub rollout_percentage: u8,
    
    /// Error detective enabled (false = skip diagnostic, use heuristic)
    pub error_detective_enabled: bool,
    
    /// Misconception mapper enabled (false = skip KB lookup)
    pub misconception_mapper_enabled: bool,
    
    /// Learning loop enabled (false = don't record/update profiles)
    pub learning_loop_enabled: bool,
    
    /// Timeout for error detective (ms)
    pub error_detective_timeout_ms: u64,
    
    /// Timeout for KB lookup (ms)
    pub kb_lookup_timeout_ms: u64,
    
    /// Circuit breaker: open after N failures
    pub circuit_breaker_failure_threshold: u32,
    
    /// Circuit breaker: recover after N successes
    pub circuit_breaker_success_threshold: u32,
}

impl Default for AdaptiveLearningConfig {
    fn default() -> Self {
        Self {
            enabled: false,  // Start disabled
            rollout_percentage: 0,
            error_detective_enabled: true,
            misconception_mapper_enabled: true,
            learning_loop_enabled: true,
            error_detective_timeout_ms: 500,
            kb_lookup_timeout_ms: 50,
            circuit_breaker_failure_threshold: 3,
            circuit_breaker_success_threshold: 5,
        }
    }
}

impl AdaptiveLearningConfig {
    pub fn is_enabled_for_student(&self, student_id: Uuid) -> bool {
        if !self.enabled {
            return false;
        }
        // Hash student ID to percentage
        let hash = (student_id.as_u128() % 100) as u8;
        hash < self.rollout_percentage
    }
}
```

### Environment Variables

```bash
# .env for local/staging
ADAPTIVE_LEARNING_ENABLED=false
ADAPTIVE_LEARNING_ROLLOUT_PERCENTAGE=0

# Docker compose for canary
ADAPTIVE_LEARNING_ENABLED=true
ADAPTIVE_LEARNING_ROLLOUT_PERCENTAGE=10  # 10% of students
```

### Rollout Checklist

**Week 5 (Canary - 10% of users)**
- [ ] Deploy to staging with feature flag off
- [ ] Enable feature for internal QA team
- [ ] Run 24 hours monitoring
  - [ ] Error rates normal (<0.1%)
  - [ ] Latency impact <100ms (p99)
  - [ ] No database contention
- [ ] Enable for 5% of production users
- [ ] Monitor 48 hours
  - [ ] Same error/latency targets
  - [ ] Learning loop recording data correctly
  - [ ] DB migration completed successfully

**Week 6 (25% rollout)**
- [ ] Increase to 25% of users
- [ ] Monitor learning outcome metrics
  - [ ] Are misconceptions being mapped correctly?
  - [ ] Are strategies being selected appropriately?
  - [ ] Do reattempts show improvement?
- [ ] Manual testing: 10 sample students, verify explanations are relevant

**Week 7 (100% rollout)**
- [ ] Increase to 100%
- [ ] Final monitoring
- [ ] Collect week 1 data for analysis

**Week 8 (Analysis & Iteration)**
- [ ] Analyze learning gains (misconception resolution rate)
- [ ] Identify failing strategies (low effectiveness)
- [ ] Update KB with real data insights

---

## Part 4: Monitoring & Observability

### Key Metrics to Track

**System Health**
```rust
pub enum AdaptiveLearningMetric {
    /// How many adaptive learning requests succeeded
    AdaptiveRequestsSuccessful,
    
    /// How many fell back to heuristic/generic
    AdaptiveRequestsFailed,
    
    /// Latency of error detective (histogram)
    ErrorDetectiveLatencyMs,
    
    /// Latency of KB lookup (histogram)
    KBLookupLatencyMs,
    
    /// Circuit breaker state (0=Closed, 1=HalfOpen, 2=Open)
    CircuitBreakerState,
    
    /// Number of students with adaptive profile
    StudentsWithProfile,
    
    /// KB size (number of misconceptions loaded)
    MisconceptionKBSize,
}

impl AdaptiveLearningMetric {
    pub fn record(&self, value: f64, client: &prometheus::Client) {
        // Prometheus recording
    }
}
```

### Grafana Dashboard Panels

| Panel | Query | Alert Threshold |
|-------|-------|-----------------|
| Adaptive Success Rate | `adaptive_requests_successful / (adaptive_requests_successful + adaptive_requests_failed)` | < 95% |
| Error Detective P99 Latency | `histogram_quantile(0.99, error_detective_latency_ms)` | > 1000ms |
| KB Lookup Failures | `kb_lookup_failures_total` | > 5/min |
| Circuit Breaker State | `circuit_breaker_state` | > 1 (not Closed) |
| Student Profile Update Queue | `learning_loop_queue_length` | > 1000 |
| Misconception Resolution Rate | `misconceptions_resolved / misconceptions_diagnosed` | < 50% |

### Logs to Emit

```rust
// In error detective
warn!("Error detective timeout after 500ms, falling back to heuristics");
debug!("Error diagnosis: {:?} (confidence: {})", diagnosis, diagnosis.confidence);

// In misconception mapper
debug!("Mapped error to misconception: {}", misconception_id);
warn!("No misconception match found for topic {}", topic);

// In adaptation engine
debug!("Selected strategy: {:?} (fit score: {})", strategy, fit_score);
warn!("Adaptation engine error, using fallback strategy: {:?}", default_strategy);

// In learning loop
info!("Strategy outcome recorded: student_id={}, misconception={}, worked={}", 
      student_id, misconception_id, worked);
error!("Failed to update student profile: {}", err);
```

---

## Part 5: Database Performance Tuning

### Indices to Create (Before Production)

```sql
-- Fast lookup of strategy outcomes by student + topic
CREATE INDEX CONCURRENTLY idx_strategy_outcomes_student_topic 
ON strategy_outcomes(student_id, topic) 
WHERE worked = true;

-- Fast lookup of KB stats by topic + misconception
CREATE INDEX CONCURRENTLY idx_misconception_kb_stats_lookup 
ON misconception_kb_stats(topic, misconception_id, strategy);

-- Partition strategy_outcomes by time (if table grows large)
ALTER TABLE strategy_outcomes 
PARTITION BY RANGE (YEAR(timestamp)) (
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

### Connection Pool Sizing

```rust
// In database config
pub struct PoolConfig {
    pub min_connections: u32,    // 5
    pub max_connections: u32,    // 20 (for 100 concurrent users)
    pub acquisition_timeout: Duration,
    pub idle_timeout: Duration,
}

// For 1000 concurrent users:
// max_connections = ceil(1000 / 50) = 20 connections
// Each connection can handle 50 requests
```

### Query Optimization

**Before**: Query student profile without index
```sql
SELECT * FROM students WHERE id = $1;  -- Full table scan
```

**After**: Use primary key (already exists)
```sql
SELECT learning_preference_visual, learning_preference_kinesthetic, ...
FROM students WHERE id = $1;  -- Fast PK lookup
```

**Before**: Aggregate strategy outcomes on read
```sql
SELECT COUNT(*), AVG(worked)
FROM strategy_outcomes
WHERE misconception_id = $1 AND strategy = $2
GROUP BY misconception_id;  -- Scans all historical data
```

**After**: Pre-compute in `misconception_kb_stats`
```sql
SELECT effectiveness_rate
FROM misconception_kb_stats
WHERE misconception_id = $1 AND strategy = $2;  -- Single row lookup
```

---

## Part 6: A/B Testing (Learning Outcome Validation)

### Hypothesis
**Statement**: "Students who receive adaptive explanations will resolve misconceptions faster (fewer reattempts to mastery) than students receiving generic explanations."

### Metric to Measure
**Primary**: Average attempts to mastery (A: adaptive, B: generic)
- AI: 2.1 attempts
- B: 3.2 attempts
- **Better by 34%**

**Secondary**:
- Misconception resolution rate (% that get it right by 3rd attempt)
- Time to mastery (minutes)
- Student engagement (quiz completion rate)

### Experiment Design
**Duration**: 2 weeks  
**Sample size**: 500 students (250 adaptive, 250 control/generic)  
**Randomization**: Random 50/50 split at lesson start, persist throughout course  
**Stratification**: By grade level (keep grade distribution similar)

### Implementation

```rust
pub struct ExperimentConfig {
    /// Experiment variant: "adaptive" or "generic"
    pub variant: String,
    
    /// Timestamp assigned
    pub assigned_at: Timestamp,
}

// Assign student to variant
pub fn assign_variant(student_id: Uuid) -> String {
    let hash = student_id.as_u128() % 100;
    if hash < 50 {
        "adaptive".to_string()
    } else {
        "generic".to_string()
    }
}

// Quiz handler checks variant
pub async fn submit_quiz_with_adaptive(
    student_id: Uuid,
    quiz_id: Uuid,
    answer: String,
) -> Result<QuizResponse> {
    let variant = get_student_variant(student_id).await?;
    
    if variant == "adaptive" && ADAPTIVE_LEARNING_CONFIG.enabled {
        // Run adaptive pipeline
        run_adaptive_pipeline(...).await
    } else {
        // Run generic pipeline (existing code)
        submit_quiz_generic(...).await
    }
}
```

### Data Collection During Experiment

```sql
-- Track experiment assignment
CREATE TABLE experiment_assignments (
    student_id UUID PRIMARY KEY,
    variant VARCHAR(20),  -- 'adaptive' or 'generic'
    assigned_at TIMESTAMP,
    cohort VARCHAR(20)    -- 'grade_7', 'grade_8', etc
);

-- Track learning outcomes during experiment
UPDATE quiz_attempts
SET experiment_variant = (SELECT variant FROM experiment_assignments WHERE student_id = $1),
    attempt_number_for_misconception = (
        SELECT COUNT(*) FROM quiz_attempts AS qa
        WHERE qa.student_id = quiz_attempts.student_id
        AND qa.misconception_id = quiz_attempts.misconception_id
        AND qa.created_at <= quiz_attempts.created_at
    )
WHERE student_id = $1 AND quiz_id = $2;
```

### Analysis Query (Post-Experiment)

```sql
-- Compare attempts to mastery
SELECT 
    variant,
    AVG(attempt_number_for_misconception) as avg_attempts,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY attempt_number_for_misconception) as median_attempts,
    COUNT(DISTINCT student_id) as num_students
FROM quiz_attempts
WHERE created_at BETWEEN '2026-05-01' AND '2026-05-14'
GROUP BY variant;

-- Expected output:
-- variant  | avg_attempts | median_attempts | num_students
-- ---------|--------------|-----------------|-------------
-- adaptive | 2.1          | 2.0            | 250
-- generic  | 3.2          | 3.0            | 250
```

---

## Part 7: Incident Response Playbook

### If Circuit Breaker Opens (LLM Provider Failing)

**Alert**: `circuit_breaker_state > 1`

**Steps**:
1. Check LLM provider status (OpenAI, Anthropic, etc)
2. If provider down: auto-fallback to heuristics
3. If provider OK: check network connectivity
4. All students continue receiving generic explanations (graceful degradation)
5. Learning loop paused (queue for batch retry)
6. No student impact (except slower/generic responses)

**Resolution**:
- Once LLM provider recovers, circuit breaker auto-closes after 5 successes
- Queued learning loop tasks processed

### If Misconception KB Lookup Fails (DB Issue)

**Alert**: `kb_lookup_failures_total > 5/min`

**Steps**:
1. Check database connection pool health
2. If exhausted: increase connections
3. If DB slow: check query performance
4. KB lookups timeout, skip to generic explanation
5. No student impact

**Resolution**:
- Add DB connection re-pooling
- Restart if necessary

### If Student Profile Update Slow (Learning Loop Lag)

**Alert**: `learning_loop_queue_length > 1000`

**Steps**:
1. Check database performance (INSERT throughput)
2. Reduce batch insert size or increase workers
3. Learning loop continues async in background
4. No student impact (response already sent)

**Resolution**:
- Throttle update frequency (batch hourly instead of per-attempt)
- Increase worker threads for background job processing

---

## Part 8: Migration Plan (Schema Changes)

### Zero-Downtime Migration

**Step 1**: Prepare (off-peak hours)
```bash
# Create new tables (empty, no data)
psql -f migrations/001_create_strategy_outcomes.sql

# Create new columns on students table (with default values)
psql -f migrations/002_add_learning_profile_to_students.sql
```

**Step 2**: Deploy (0% rollout)
```bash
# Deploy new code with feature flag disabled
docker pull ai-tutor-backend:v1.2.0-adaptive
docker deploy --image=ai-tutor-backend:v1.2.0-adaptive
# ADAPTIVE_LEARNING_ENABLED=false (no code path uses new tables)
```

**Step 3**: Test (internal team)
```bash
# Enable feature for QA team only
ADAPTIVE_LEARNING_ROLLOUT_PERCENTAGE=100 (for QA users only)
# Run 24 hours, verify data insertion working
```

**Step 4**: Canary (5-10% users)
```bash
# Gradually enable for real users
ADAPTIVE_LEARNING_ROLLOUT_PERCENTAGE=5
# Monitor error rates, latency
```

### Rollback Plan

If any issue detected:
```bash
# Step 1: Disable feature globally (immediate)
ADAPTIVE_LEARNING_ENABLED=false

# Step 2: Kill hanging threads (if any)
kill -9 $(ps aux | grep adaptive-learning | awk '{print $2}')

# Step 3: Downgrade deployment
docker rollback ai-tutor-backend:v1.1.9

# Step 4: Keep tables (no data loss, can try again later)
# Don't drop new tables—data is safe
```

---

## Part 9: Success Criteria (Green Light to 100%)

Before increasing rollout to next tier, all must be true:

| Criterion | Target | Status |
|-----------|--------|--------|
| Error rate in adaptive path | < 0.1% | ? |
| P99 latency (adaptive pipeline) | < 500ms | ? |
| Bank assertion database insertions working | 100% | ? |
| Circuit breaker closed (healthy) | 100% of time | ? |
| Student profile cache hit rate | > 95% | ? |
| KB load time | < 50ms | ? |
| No data loss (strategy_outcomes accurate) | 100% | ? |
| Learning loop queue draining | Backlog < 100/min | ? |
| Misconception mapping accuracy (manual review) | > 80% | ? |
| Adaptive explanation relevance (manual review) | > 75% | ? |

---

## Part 10: Timeline

```
Week 5:  Deploy to staging + 5% canary
         → Monitor: error rate, latency, circuit breaker

Week 6:  Increase to 25% (if metrics green)
         → Collect: misconception mapping accuracy
         → Optimize: KB queries, strategy selection

Week 7:  Increase to 100% (if all green)
         → Full rollout

Week 8:  Analyze learning outcomes
         → A/B test results (attempts to mastery)
         → Identify underperforming misconceptions
         → Update KB, strategies

Week 9:  Iterate based on data
         → Add new misconceptions
         → Refine strategies
         → Publish results
```

---

## Ready to Ship 🚀

This architecture gives AI-Tutor:
1. **Adaptive learning** that breaks the blocker between LLM and learner
2. **Production resilience** (graceful degradation, no single point of failure)
3. **Safe rollout** (feature flag, canary, A/B testing)
4. **Observable** (metrics, logs, dashboards)
5. **Reversible** (rollback in minutes)

Next step: Should we start Phase 1 implementation (building the agents)?
