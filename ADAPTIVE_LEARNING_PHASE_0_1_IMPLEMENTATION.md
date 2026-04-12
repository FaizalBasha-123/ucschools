# Adaptive Learning System: Phase 0-1 Implementation Plan

**Codebase Target**: AI-Tutor-Backend  
**Status**: Ready for immediate implementation  
**Estimation**: Phase 1 = 2 weeks (40 hours)

---

## Pre-Implementation: Project Structure

### New Crate: `adaptive-learning`

**Location**: `AI-Tutor-Backend/crates/adaptive-learning/`

```
crates/adaptive-learning/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── agents/
│   │   ├── mod.rs
│   │   ├── error_detective.rs      # Agent 1: Diagnose error type
│   │   ├── misconception_mapper.rs # Agent 2: Map to known misconception
│   │   ├── adaptation_engine.rs    # Agent 3: Select explanation strategy
│   │   ├── learning_loop.rs        # Agent 4: Track outcomes & update profile
│   │   └── orchestrator.rs         # Resilient coordination of 4 agents
│   │
│   ├── models/
│   │   ├── mod.rs
│   │   ├── error_diagnosis.rs      # ErrorDiagnosis struct
│   │   ├── misconception.rs        # MisconceptionMatch, ExplanationStrategy
│   │   ├── student_profile.rs      # StudentProfile, StrategyOutcome
│   │   └── adaptive_response.rs    # Response DTO for API
│   │
│   ├── knowledge_base/
│   │   ├── mod.rs
│   │   ├── loader.rs               # Load misconceptions from JSON
│   │   ├── store.rs                # In-memory KB with Redis cache layer
│   │   └── seed_data/
│   │       ├── photosynthesis.json
│   │       ├── quadratic_equations.json
│   │       └── ... (per-topic misconceptions)
│   │
│   ├── persistence/
│   │   ├── mod.rs
│   │   ├── student_profile_repo.rs # CRUD for student learner profiles
│   │   └── strategy_outcome_repo.rs # Track strategy effectiveness
│   │
│   └── errors.rs                   # Error types
```

### Integration Points

**Integrate with existing crates**:
1. `domain/`: Add `learning/` module for data models
2. `providers/`: Use existing `LlmProvider` for Error Detective & Adaptation Engine
3. `runtime/`: Expose via `session/` for active quiz handling
4. `api/`: Add new quiz routes

---

## Phase 0: Setup & Data Layer (Days 1-3)

### Step 1: Add Crate to Workspace

**File**: `AI-Tutor-Backend/Cargo.toml`
```toml
[workspace]
members = [
    # ... existing ...
    "crates/adaptive-learning",
]

[workspace.dependencies]
# ... existing ...
uuid = { version = "1.10", features = ["v4", "serde"] }
serde_json = "1.0"
redis = { version = "0.25", optional = true }
tokio = { version = "1", features = ["full"] }
```

### Step 2: Database Migrations

**Location**: `AI-Tutor-Backend/migrations/` (or use SQLx migrations)

**Migration 1**: Create `strategy_outcomes` table
```sql
-- File: AI-Tutor-Backend/migrations/001_create_strategy_outcomes.sql

CREATE TABLE IF NOT EXISTS strategy_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    topic VARCHAR(100) NOT NULL,
    misconception_id VARCHAR(100) NOT NULL,
    strategy_used VARCHAR(50) NOT NULL,  -- 'Analogy', 'WorkedExample', etc
    worked BOOLEAN NOT NULL,
    improvement_score FLOAT NOT NULL,    -- 0-100: improvement percentage
    explanation_id UUID,                  -- Optional: link back to explanation given
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    
    INDEX idx_student_topic (student_id, topic),
    INDEX idx_misconception_strategy (misconception_id, strategy_used),
    INDEX idx_timestamp (timestamp)
);

-- Table for tracking KB effectiveness (aggregate)
CREATE TABLE IF NOT EXISTS misconception_kb_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic VARCHAR(100) NOT NULL,
    misconception_id VARCHAR(100) NOT NULL,
    strategy VARCHAR(50) NOT NULL,
    attempts_total INT NOT NULL DEFAULT 0,
    attempts_successful INT NOT NULL DEFAULT 0,
    effectiveness_rate FLOAT NOT NULL DEFAULT 0.5,  -- 0-1
    last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE(topic, misconception_id, strategy),
    INDEX idx_topic_misconception (topic, misconception_id)
);
```

**Migration 2**: Extend `students` table with learning profile
```sql
-- File: AI-Tutor-Backend/migrations/002_add_learning_profile_to_students.sql

ALTER TABLE students ADD COLUMN IF NOT EXISTS (
    learning_preference_visual FLOAT NOT NULL DEFAULT 0.5,
    learning_preference_kinesthetic FLOAT NOT NULL DEFAULT 0.5,
    learning_preference_linguistic FLOAT NOT NULL DEFAULT 0.5,
    learning_preference_logical FLOAT NOT NULL DEFAULT 0.5,
    
    adaptive_learning_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_error_diagnosis_json JSONB,
    learning_profile_updated_at TIMESTAMP DEFAULT NOW()
);
```

### Step 3: Create New Crate

**File**: `AI-Tutor-Backend/crates/adaptive-learning/Cargo.toml`
```toml
[package]
name = "adaptive-learning"
version = "0.1.0"
edition = "2021"

[dependencies]
common = { path = "../common" }
domain = { path = "../domain" }
providers = { path = "../providers" }

tokio = { workspace = true }
uuid = { workspace = true }
serde = { version = "1.0", features = ["derive"] }
serde_json = { workspace = true }
anyhow = "1.0"
thiserror = "1.0"
tracing = "0.1"

# Optional: for Redis caching KB
redis = { workspace = true, optional = true }
```

### Step 4: Create Data Models

**File**: `AI-Tutor-Backend/crates/adaptive-learning/src/models/error_diagnosis.rs`
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ErrorType {
    /// Math calculation mistake: wrong arithmetic, slipped decimal
    Computational,
    
    /// Misunderstood core concept: wrong formula, backwards logic
    Conceptual,
    
    /// Right concept, wrong process: skipped step, wrong order
    Procedural,
    
    /// Misread or misinterpreted question
    Linguistic,
    
    /// Missing prerequisite knowledge
    KnowledgeGap(String),  // What's missing?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorDiagnosis {
    pub error_type: ErrorType,
    pub severity: u8,                          // 1-10: minor slip vs fundamental misunderstanding
    pub confidence: f32,                       // 0-1: how sure are we?
    pub root_cause: String,                    // Human-readable explanation
    pub prerequisite_gap: Option<String>,      // If KnowledgeGap, what specifically?
    pub error_markers: Vec<String>,            // Words/phrases that triggered detection
}

impl Default for ErrorDiagnosis {
    fn default() -> Self {
        Self {
            error_type: ErrorType::Computational,
            severity: 5,
            confidence: 0.5,
            root_cause: "Unknown".to_string(),
            prerequisite_gap: None,
            error_markers: vec![],
        }
    }
}
```

**File**: `AI-Tutor-Backend/crates/adaptive-learning/src/models/misconception.rs`
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum ExplanationStrategy {
    Analogy,
    WorkedExample,
    Graphic,
    Comparison,
    Kinesthetic,
    Mnemonics,
    Video,
    Socratic,
}

impl std::fmt::Display for ExplanationStrategy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Analogy => "Analogy",
            Self::WorkedExample => "WorkedExample",
            Self::Graphic => "Graphic",
            Self::Comparison => "Comparison",
            Self::Kinesthetic => "Kinesthetic",
            Self::Mnemonics => "Mnemonics",
            Self::Video => "Video",
            Self::Socratic => "Socratic",
        };
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Misconception {
    pub topic: String,
    pub misconception_id: String,
    pub name: String,
    pub description: String,
    pub error_markers: Vec<String>,
    
    pub strategy_primary: ExplanationStrategy,
    pub strategy_backup: ExplanationStrategy,
    pub strategy_fallback: ExplanationStrategy,
    
    pub effectiveness: f32,  // Historical success rate 0-1
}

#[derive(Debug, Clone)]
pub struct MisconceptionMatch {
    pub misconception: Misconception,
    pub confidence: f32,                           // How sure are we?
    pub effectiveness_history: Vec<bool>,          // Past outcomes
}

impl MisconceptionMatch {
    pub fn recommended_strategy(&self) -> ExplanationStrategy {
        // If enough history and strategy worked before, use it
        if self.effectiveness_history.len() > 2 {
            let success_rate = self.effectiveness_history.iter().filter(|w| **w).count() as f32
                / self.effectiveness_history.len() as f32;
            if success_rate > 0.6 {
                return self.misconception.strategy_primary;
            }
        }
        // Otherwise, use recommended for this misconception
        self.misconception.strategy_primary
    }
}
```

**File**: `crates/adaptive-learning/src/models/student_profile.rs`
```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningPreferences {
    pub visual: f32,        // 0-1: responds to diagrams
    pub kinesthetic: f32,   // 0-1: responds to interactive
    pub linguistic: f32,    // 0-1: responds to verbal
    pub logical: f32,       // 0-1: responds to step-by-step logic
}

impl Default for LearningPreferences {
    fn default() -> Self {
        Self {
            visual: 0.5,
            kinesthetic: 0.5,
            linguistic: 0.5,
            logical: 0.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudentProfile {
    pub student_id: Uuid,
    pub learning_preferences: LearningPreferences,
    pub strategy_history: Vec<StrategyOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyOutcome {
    pub strategy: super::ExplanationStrategy,
    pub topic: String,
    pub misconception_id: String,
    pub worked: bool,
    pub improvement_score: f32,  // 0-100
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl StudentProfile {
    pub fn new(student_id: Uuid) -> Self {
        Self {
            student_id,
            learning_preferences: LearningPreferences::default(),
            strategy_history: vec![],
        }
    }

    /// Filter strategy history for a specific misconception
    pub fn history_for_misconception(&self, misconception_id: &str) -> Vec<&StrategyOutcome> {
        self.strategy_history
            .iter()
            .filter(|s| s.misconception_id == misconception_id)
            .collect()
    }

    /// Adjust learning preference based on successful strategy
    pub fn reinforce_strategy(&mut self, strategy: super::ExplanationStrategy, delta: f32) {
        match strategy {
            super::ExplanationStrategy::Graphic => self.learning_preferences.visual += delta,
            super::ExplanationStrategy::Kinesthetic => self.learning_preferences.kinesthetic += delta,
            super::ExplanationStrategy::Analogy => self.learning_preferences.linguistic += delta,
            super::ExplanationStrategy::WorkedExample => self.learning_preferences.logical += delta,
            _ => {}
        }
        // Clamp to 0-1
        self.learning_preferences.visual = self.learning_preferences.visual.clamp(0.0, 1.0);
        self.learning_preferences.kinesthetic =
            self.learning_preferences.kinesthetic.clamp(0.0, 1.0);
        self.learning_preferences.linguistic =
            self.learning_preferences.linguistic.clamp(0.0, 1.0);
        self.learning_preferences.logical = self.learning_preferences.logical.clamp(0.0, 1.0);
    }
}
```

### Step 5: Persistence Layer (Repository)

**File**: `crates/adaptive-learning/src/persistence/student_profile_repo.rs`
```rust
use sqlx::PgPool;
use super::super::models::StudentProfile;
use uuid::Uuid;
use anyhow::Result;

pub struct StudentProfileRepository {
    db: PgPool,
}

impl StudentProfileRepository {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    pub async fn get(&self, student_id: Uuid) -> Result<Option<StudentProfile>> {
        let row = sqlx::query!(
            r#"
            SELECT 
                student_id,
                learning_preference_visual,
                learning_preference_kinesthetic,
                learning_preference_linguistic,
                learning_preference_logical
            FROM students
            WHERE id = $1
            "#,
            student_id,
        )
        .fetch_optional(&self.db)
        .await?;

        Ok(row.map(|r| StudentProfile {
            student_id: r.student_id,
            learning_preferences: super::super::models::LearningPreferences {
                visual: r.learning_preference_visual as f32,
                kinesthetic: r.learning_preference_kinesthetic as f32,
                linguistic: r.learning_preference_linguistic as f32,
                logical: r.learning_preference_logical as f32,
            },
            strategy_history: vec![], // TODO: Load from strategy_outcomes table
        }))
    }

    pub async fn update_preferences(
        &self,
        student_id: Uuid,
        prefs: &super::super::models::LearningPreferences,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE students
            SET 
                learning_preference_visual = $2,
                learning_preference_kinesthetic = $3,
                learning_preference_linguistic = $4,
                learning_preference_logical = $5,
                learning_profile_updated_at = NOW()
            WHERE id = $1
            "#,
            student_id,
            prefs.visual as f64,
            prefs.kinesthetic as f64,
            prefs.linguistic as f64,
            prefs.logical as f64,
        )
        .execute(&self.db)
        .await?;

        Ok(())
    }
}
```

---

## Phase 1: Agent Implementation (Days 4-14)

### Agent 1: Error Detective

**File**: `crates/adaptive-learning/src/agents/error_detective.rs`

```rust
use crate::models::{ErrorDiagnosis, ErrorType};
use providers::base::LlmProvider;
use anyhow::Result;
use tracing::{warn, debug};

pub struct ErrorDetective {
    llm: LlmProvider,
}

impl ErrorDetective {
    pub fn new(llm: LlmProvider) -> Self {
        Self { llm }
    }

    pub async fn diagnose(
        &self,
        student_answer: &str,
        expected_answer: &str,
        question: &str,
        topic: &str,
    ) -> Result<ErrorDiagnosis> {
        // Try LLM-based diagnosis
        let system_prompt = format!(
            "You are an expert educational diagnostician. Analyze the student's error and identify \
             the type of mistake. Return JSON with keys: error_type, severity (1-10), confidence (0-1), \
             root_cause, prerequisite_gap (null if none), error_markers (list of key phrases).\n\
             \n\
             Topics: Computational, Conceptual, Procedural, Linguistic, KnowledgeGap",
        );

        let prompt = format!(
            "Topic: {}\nQuestion: {}\nStudent Answer: {}\nExpected: {}\n\nAnalyze this error.",
            topic, question, student_answer, expected_answer
        );

        match self.llm.generate_json(&system_prompt, &prompt, 5000).await {
            Ok(json_str) => {
                debug!("LLM error diagnosis succeeded");
                self.parse_error_diagnosis(&json_str).map_err(|e| {
                    warn!("Failed to parse LLM response: {}", e);
                    anyhow::anyhow!("Parse error: {}", e)
                })
            }
            Err(e) => {
                warn!("LLM error diagnosis failed: {}, falling back to heuristics", e);
                self.heuristic_diagnosis(student_answer, expected_answer, question)
            }
        }
    }

    fn parse_error_diagnosis(&self, json_str: &str) -> Result<ErrorDiagnosis> {
        let parsed: serde_json::Value = serde_json::from_str(json_str)?;

        let error_type = match parsed["error_type"].as_str() {
            Some("Computational") => ErrorType::Computational,
            Some("Conceptual") => ErrorType::Conceptual,
            Some("Procedural") => ErrorType::Procedural,
            Some("Linguistic") => ErrorType::Linguistic,
            Some("KnowledgeGap") => {
                let gap = parsed["prerequisite_gap"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                ErrorType::KnowledgeGap(gap)
            }
            _ => ErrorType::Computational,
        };

        let severity = parsed["severity"]
            .as_u64()
            .unwrap_or(5)
            .min(10) as u8;

        let confidence = parsed["confidence"].as_f64().unwrap_or(0.5) as f32;

        let markers: Vec<String> = parsed["error_markers"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(ErrorDiagnosis {
            error_type,
            severity,
            confidence,
            root_cause: parsed["root_cause"]
                .as_str()
                .unwrap_or("Unknown error")
                .to_string(),
            prerequisite_gap: parsed["prerequisite_gap"].as_str().map(|s| s.to_string()),
            error_markers: markers,
        })
    }

    fn heuristic_diagnosis(
        &self,
        student_answer: &str,
        expected_answer: &str,
        question: &str,
    ) -> Result<ErrorDiagnosis> {
        // Simple heuristics when LLM fails
        let lev_distance = levenshtein::levenshtein(student_answer, expected_answer);
        let max_len = student_answer.len().max(expected_answer.len());
        let similarity = 1.0 - (lev_distance as f32 / max_len as f32);

        let severity = if similarity > 0.9 {
            2 // Typo
        } else if similarity > 0.5 {
            5 // Moderate error
        } else {
            9 // Major error
        };

        Ok(ErrorDiagnosis {
            error_type: ErrorType::Computational, // Conservative guess
            severity,
            confidence: 0.3, // Low confidence in heuristic
            root_cause: format!("Heuristic: {} similarity vs expected", 
                (similarity * 100.0) as u8),
            prerequisite_gap: None,
            error_markers: vec![],
        })
    }
}
```

### Agent 2: Misconception Mapper

**File**: `crates/adaptive-learning/src/agents/misconception_mapper.rs`

```rust
use crate::models::{ErrorDiagnosis, Misconception, MisconceptionMatch, ExplanationStrategy};
use crate::knowledge_base::MisconceptionKB;
use anyhow::Result;
use tracing::{debug, warn};

pub struct MisconceptionMapper {
    kb: MisconceptionKB,
}

impl MisconceptionMapper {
    pub fn new(kb: MisconceptionKB) -> Self {
        Self { kb }
    }

    /// Match error diagnosis to known misconception
    pub async fn map_error(
        &self,
        error: &ErrorDiagnosis,
        topic: &str,
    ) -> Result<Option<MisconceptionMatch>> {
        // Get misconceptions for this topic
        let misconceptions = match self.kb.get_topic(topic).await {
            Ok(m) => m,
            Err(e) => {
                warn!("Failed to load misconceptions for topic {}: {}", topic, e);
                return Ok(None);
            }
        };

        // Try to find the best match based on error markers
        let best_match = misconceptions
            .iter()
            .map(|m| {
                let confidence = self.compute_match_confidence(&error.error_markers, &m.error_markers);
                (m, confidence)
            })
            .filter(|(_, conf)| *conf > 0.3) // Filter out low-confidence matches
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(m, conf)| MisconceptionMatch {
                misconception: m.clone(),
                confidence: conf,
                effectiveness_history: vec![], // TODO: Load from DB
            });

        debug!(
            "Mapped error from topic {} to misconception: {:?}",
            topic,
            best_match.as_ref().map(|m| &m.misconception.misconception_id)
        );

        Ok(best_match)
    }

    fn compute_match_confidence(&self, error_markers: &[String], kb_markers: &[String]) -> f32 {
        if error_markers.is_empty() || kb_markers.is_empty() {
            return 0.5; // Default confidence
        }

        let matches = error_markers
            .iter()
            .filter(|em| kb_markers.iter().any(|km| km.contains(em.as_str())))
            .count();

        matches as f32 / error_markers.len().max(kb_markers.len()) as f32
    }
}
```

### Agent 3: Adaptation Engine

**File**: `crates/adaptive-learning/src/agents/adaptation_engine.rs`

```rust
use crate::models::{StudentProfile, MisconceptionMatch, ExplanationStrategy, ErrorDiagnosis};
use anyhow::Result;

pub struct AdaptationEngine;

impl AdaptationEngine {
    pub fn select_strategy(
        student: &StudentProfile,
        error: &ErrorDiagnosis,
        misconception: &MisconceptionMatch,
    ) -> ExplanationStrategy {
        // Step 1: Check student's history with recommended strategy
        let history = student.history_for_misconception(&misconception.misconception.misconception_id);
        if !history.is_empty() {
            let success_rate = history.iter().filter(|s| s.worked).count() as f32 / history.len() as f32;
            if success_rate > 0.6 {
                return misconception.recommended_strategy();
            }
        }

        // Step 2: Check fit with student's learning preferences
        let primary_fit = Self::strategy_fit(
            &misconception.misconception.strategy_primary,
            &student.learning_preferences,
        );

        if primary_fit > 0.6 {
            return misconception.misconception.strategy_primary;
        }

        // Step 3: If error severity is HIGH, escalate to kinesthetic
        if error.severity > 7 {
            return ExplanationStrategy::Kinesthetic;
        }

        // Default
        misconception.misconception.strategy_primary
    }

    fn strategy_fit(strategy: &ExplanationStrategy, prefs: &crate::models::LearningPreferences) -> f32 {
        match strategy {
            ExplanationStrategy::Graphic => prefs.visual * 0.8 + prefs.logical * 0.2,
            ExplanationStrategy::Analogy => prefs.linguistic * 0.7 + prefs.logical * 0.3,
            ExplanationStrategy::Kinesthetic => prefs.kinesthetic,
            ExplanationStrategy::WorkedExample => prefs.logical,
            ExplanationStrategy::Comparison => prefs.logical * 0.6 + prefs.linguistic * 0.4,
            ExplanationStrategy::Socratic => prefs.linguistic,
            ExplanationStrategy::Mnemonics => prefs.linguistic * 0.5 + prefs.logical * 0.5,
            ExplanationStrategy::Video => prefs.visual * 0.9 + prefs.kinesthetic * 0.1,
        }
    }
}
```

### Knowledge Base: Seed Data Example

**File**: `crates/adaptive-learning/src/knowledge_base/seed_data/photosynthesis.json`

```json
{
  "topic": "photosynthesis",
  "misconceptions": [
    {
      "misconception_id": "photo_01",
      "name": "Photosynthesis produces CO2",
      "description": "Student thinks photosynthesis RELEASES CO2 (actually: consumes it, releases O2)",
      "error_markers": ["CO2 output", "carbon dioxide out", "plants breathe out", "produces CO2"],
      "strategy_primary": "Analogy",
      "strategy_backup": "Comparison",
      "strategy_fallback": "WorkedExample",
      "effectiveness": 0.87
    },
    {
      "misconception_id": "photo_02",
      "name": "Photosynthesis = Respiration",
      "description": "Student confuses photosynthesis with cellular respiration (opposite processes)",
      "error_markers": ["same process", "both use glucose", "both oxygen"],
      "strategy_primary": "Comparison",
      "strategy_backup": "Analogy",
      "strategy_fallback": "Video",
      "effectiveness": 0.92
    },
    {
      "misconception_id": "photo_03",
      "name": "Plants don't need soil nutrients for photosynthesis",
      "description": "Student thinks photosynthesis only needs sunlight and water, ignores minerals",
      "error_markers": ["soil not needed", "just water and sun", "dirt not important"],
      "strategy_primary": "WorkedExample",
      "strategy_backup": "Graphic",
      "strategy_fallback": "Kinesthetic",
      "effectiveness": 0.79
    }
  ]
}
```

---

## Phase 1: Testing & Validation

### Unit Test File: `crates/adaptive-learning/tests/error_detective_tests.rs`

```rust
#[tokio::test]
async fn test_error_detective_computation_error() {
    let llm = MockLlmProvider::new();
    let detective = ErrorDetective::new(llm);

    let diagnosis = detective
        .diagnose("2 + 2 = 5", "2 + 2 = 4", "2 + 2 = ?", "arithmetic")
        .await
        .expect("diagnosis should succeed");

    assert!(matches!(diagnosis.error_type, ErrorType::Computational));
    assert!(diagnosis.severity >= 2 && diagnosis.severity <= 4);
}

#[tokio::test]
async fn test_error_detective_fallback_on_llm_timeout() {
    let llm = TimeoutLlmProvider::new();
    let detective = ErrorDetective::new(llm);

    let diagnosis = detective
        .diagnose(
            "photosynthesis produces CO2",
            "photosynthesis consumes CO2",
            // ...
        )
        .await
        .expect("should fall back to heuristics");

    assert_eq!(diagnosis.confidence, 0.3); // Low confidence indicates heuristic
}
```

---

## Expected Outcomes: Phase 1

✅ **Deliverables**:
- Error Detective agent can classify 4+ error types
- Misconception KB loaded with 3 topics × 3-5 misconceptions each = 10-15 entries
- Student profile persistence working (read/write to DB)
- Integration tests passing (mock LLM provider)
- 95%+ code coverage on core logic

✅ **Metrics**:
- Error diagnosis latency: <500ms (with fallback)
- KB lookup: <50ms (in-memory)
- Student profile CRUD: <100ms each

✅ **Code Quality**:
- Clippy lints: 0 warnings
- Tests: 20+ unit + integration tests
- Documentation: Doc comments on all public APIs

---

## Next: API Integration (Phase 2 Preview)

**New route** to be created in `AI-Tutor-Backend/crates/api/src/handlers/quiz.rs`:

```rust
#[post("/lessons/{lesson_id}/quiz/{quiz_id}/submit-with-adaptation")]
pub async fn submit_quiz_with_adaptation(
    State(state): State<AppState>,
    Path((lesson_id, quiz_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<SubmitQuizWithAdaptationPayload>,
) -> Result<impl IntoResponse> {
    // 1. Grade answer
    let correct = grade_answer(&payload.answer).await?;

    if correct {
        return Ok(Json(json!({ "correct": true, "score": 100 })));
    }

    // 2. Run adaptive learning cycle
    let error_diagnosis = state.error_detective.diagnose(...).await?;
    let misconception = state.misconception_mapper.map_error(...).await?;
    let strategy = AdaptationEngine::select_strategy(&student_profile, &error_diagnosis, &misconception);
    let explanation = state.llm_provider.generate_explanation(...).await?;

    Ok(Json(json!({
        "correct": false,
        "score": 0,
        "adaptive_response": {
            "explanation": explanation,
            "strategy_used": format!("{:?}", strategy),
            "misconception_id": misconception.misconception.misconception_id,
        }
    })))
}
```

---

## Deployment Roadmap

**Week 1-2**: Implement Phase 1 (agents + KB + data layer)  
**Week 3**: Integration with quiz routes + testing  
**Week 4**: Canary deployment (10% of students)  
**Week 5-6**: Monitor, collect data, measure learning gains  
**Week 7+**: Full rollout + iterate based on metrics

---

## Success Metrics (To Measure)

| Metric | Target | Current |
|--------|--------|---------|
| Misconception resolution (% that pass on 2nd attempt) | >65% | 45% (generic) |
| Avg attempts to mastery | <3 | 4.2 (generic) |
| Student engagement (time spent) | +20% | TBD |
| KB accuracy (% of mapped misconceptions correct) | >85% | TBD |
| Adaptation strategy reuse (% time recommended) | >70% | TBD |

Are you ready to begin Phase 1 implementation? Should I:
1. Create the Cargo.toml and project scaffolding?
2. Start implementing Error Detective?
3. Create the database migrations?
