# Implementation Plan: Test Isolation, Image Disable, and Production Hardening

> Source root: `AI-Tutor-Backend/`
> Status: Draft — 2026-08-25
> Target: All `cargo test -p ai_tutor_api --lib` pass **in parallel** (default threads), zero warnings, image generation disabled platform-wide.

---

## 0. Context and Current State

### What's broken today

Running the full test suite with default parallelism (the way CI runs it):

```
cargo test -p ai_tutor_api --lib
→ 69 passed; 17 failed
```

With `--test-threads=1` all 86 tests pass. This proves the failures are **shared-state isolation bugs**, not logic bugs. The 17 failing tests fall into three root-cause groups:

| Group | Failing tests | Root cause |
|-------|---------------|------------|
| Billing FK violations | 8 billing maintenance tests | No parent `tutor_accounts` rows seeded; ON CONFLICT dedup is broken |
| Fake LLM response queue collision | 2 generation tests + ~7 runtime tests that spawn generation | `FAKE_LLM_RESPONSES` is a process-global `OnceLock` shared across all parallel tests |
| Postgres database pollution | Tests that read persisted lessons/jobs | No test truncates the DB except billing tests, so concurrent tests see each other's rows |

### What's already patched (in the working tree, uncommitted)

The current diff in `app.rs` (227 insertions, 99 deletions) contains **band-aids** that make `--test-threads=1` green but do NOT fix the underlying isolation problem:

1. `FAKE_LLM_RESPONSES` static with `OnceLock<RwLock<Option<…>>>` + `reset_fake_llm_responses()` — replaces per-instance `Mutex<Vec<String>>` with a shared queue. This fixes single-threaded execution but **makes parallel worse**: two tests calling `reset_fake_llm_responses()` simultaneously corrupt each other's queue.
2. `cleanup_database()` + `seed_all_billing_accounts()` — truncates all tables then re-seeds accounts. This works only if tests run sequentially; under parallelism, test A truncates while test B is mid-insert.
3. `reconcile_reversed_payment` idempotency check — a real fix (checks `list_credit_entries` before applying).
4. `get_system_status` pending-count fix — a real fix (uses `get_pending_count()` instead of `counts.active`).
5. Auth middleware `if !auth.enabled { return next.run(req).await; }` — a real fix for local/test environments.
6. Various test-assertion adjustments (SSE stream, role-gating, `viewport_height`/`outline`/`shadow` fields) — test-only fixes to match current domain types.

### The "no images" requirement

The user has decided: **the platform should not support image generation right now.** This means:

- The `enable_image_generation` flag must default to `false` everywhere and be **ignored** even if a client sends `true`.
- The image provider must not be wired into the orchestrator.
- No `media_generations` with `media_type: image` should appear in outlines.
- Existing image-related code paths (provider traits, pipeline logic, asset persistence) stay in the codebase but are **dead-pathed** — not removed, not called.

This is a **kill switch**, not a deletion. Video and TTS remain active.

---

## 1. Test Isolation: The Core Problem

### Diagnosis

Every test currently does:

```rust
let root = temp_root();              // unique temp dir — OK, no collision
let storage = Arc::new(FileStorage::new(&root));  // OK
let app = build_router(build_live_service_with_fakes(storage));  // ← problem
```

`build_live_service_with_fakes` constructs `LiveLessonAppService` with a `FakeLlmProviderFactory`. Every call to `build()` returns a `FakeLlmProvider` that draws from `FAKE_LLM_RESPONSES` — a **process-global static**. Two tests running in parallel both call `reset_fake_llm_responses()` (wiping the queue) then `fake_llm_responses()` (initializing it). The interleaving is non-deterministic.

Similarly, every test that touches Postgres (billing tests, persisted-lesson tests) shares the same database. `cleanup_database()` truncates all tables — if test A truncates while test B has an in-flight insert, test B fails with a FK violation or a missing-row assertion.

### The right fix: per-test owned state, not process-global state

The principle: **each test owns its own fake LLM response queue and its own database schema.** No `static`, no `OnceLock`, no shared mutable global.

#### 1a. Fake LLM: per-instance response queue

**File:** `AI-Tutor-Backend/crates/api/src/app.rs` (test module, ~line 13089)

**What to change:**

Remove the `FAKE_LLM_RESPONSES` static, `fake_llm_responses()`, and `reset_fake_llm_responses()` entirely.

Change `FakeLlmProviderFactory` from a unit struct to a struct that **owns** a shared response queue:

```rust
struct FakeLlmProviderFactory {
    responses: Arc<Mutex<Vec<String>>>,
}
```

Change `FakeLlmProvider` to hold an `Arc<Mutex<Vec<String>>>` (already done in the working tree):

```rust
struct FakeLlmProvider {
    responses: Arc<Mutex<Vec<String>>>,
}
```

The factory's `build()` returns a `FakeLlmProvider` that **clones the `Arc`**, so all phase LLMs (outlines, scene-content, scene-actions) share the same queue — but only within one test's service instance:

```rust
impl LlmProviderFactory for FakeLlmProviderFactory {
    fn build(&self, _model_config: ModelConfig) -> Result<Box<dyn LlmProvider>> {
        Ok(Box::new(FakeLlmProvider {
            responses: Arc::clone(&self.responses),
        }))
    }
}
```

Provide a constructor:

```rust
impl FakeLlmProviderFactory {
    fn new() -> Self {
        Self {
            responses: Arc::new(Mutex::new(default_fake_responses())),
        }
    }
}

fn default_fake_responses() -> Vec<String> {
    vec![
        // 0: outlines
        r#"{...}"#.to_string(),
        // 1: lesson title
        r#"Understanding Fractions"#.to_string(),
        // 2: agents
        r#"[]"#.to_string(),
        // 3: slide content (with Image element placeholder)
        r#"{...}"#.to_string(),
        // 4: slide actions
        r#"{...}"#.to_string(),
        // 5: quiz content
        r#"{...}"#.to_string(),
        // 6: quiz actions
        r#"{...}"#.to_string(),
    ]
}
```

**Why this works:** Each test creates its own `FakeLlmProviderFactory` (and thus its own `Arc<Mutex<Vec<String>>>`). `build_live_service_with_fakes` must accept the factory as a parameter (or construct it internally and return it alongside the service). All phase LLMs created from that factory share the same queue. Two parallel tests have two different factories with two different queues. Zero contention.

**Required change to `build_live_service_with_fakes`:**

Currently `build_live_service_with_fakes` constructs `Arc::new(FakeLlmProviderFactory)` internally. Change it to accept a `FakeLlmProviderFactory` argument:

```rust
fn build_live_service_with_fakes_and_factory(
    storage: Arc<FileStorage>,
    llm_factory: FakeLlmProviderFactory,
) -> Arc<dyn LessonAppService> { ... }
```

Or keep `build_live_service_with_fakes` as a convenience wrapper that calls the above with `FakeLlmProviderFactory::new()`.

**Tests that must be updated:** Every test that calls `build_live_service_with_fakes` or `build_live_service_with_fakes_and_queue` — remove the `reset_fake_llm_responses()` call, pass `FakeLlmProviderFactory::new()` instead.

#### 1b. Postgres: per-test database schema

**File:** `AI-Tutor-Backend/crates/api/src/app.rs` (test module, ~line 14744)

**What to change:**

Replace the single shared `aitutor_test` database with a **per-test schema** approach. Each test creates its own schema (or database) and tears it down on exit.

**Critical blocker: `PG_POOL` is a process-global static.**

`FileStorage` stores its `postgres_url` per-instance, but `get_pg_client()` (line 120) uses a `static PG_POOL: OnceLock<RwLock<Option<PgPool>>>`. On the fast path (pool already initialized), it returns a connection from the global pool **regardless of which URL was passed**. The URL is only used when building the pool for the first time. This means:

- All `FileStorage` instances share the same connection pool and thus the same database.
- Even if each test creates a `FileStorage` with a different `postgres_url`, they all hit the same database.
- Per-test databases or schemas are **impossible** without changing the storage layer.

**Fix required in `crates/storage/src/filesystem.rs`:**

Remove the global `PG_POOL` static. Move the pool into the `FileStorage` struct itself:

```rust
pub struct FileStorage {
    root: PathBuf,
    postgres_url: String,
    postgres_ready: Arc<AtomicBool>,
    pool: OnceLock<AnyResult<r2d2::Pool<PostgresConnectionManager<…>>>>,  // per-instance
}
```

Or simpler: replace the `r2d2` pool with a per-instance `r2d2::Pool` stored in the struct:

```rust
pub struct FileStorage {
    root: PathBuf,
    pool: r2d2::Pool<PostgresConnectionManager<…>>,
    postgres_ready: Arc<AtomicBool>,
}
```

`get_pg_client` becomes a method on `FileStorage` instead of a free function:

```rust
impl FileStorage {
    fn client(&self) -> AnyResult<PooledPgConnection> {
        // use self.pool, not a global static
    }
}
```

**Why this is necessary:** Every storage method currently calls `get_pg_client(&self.postgres_url)`, but the global pool ignores the URL after the first init. Moving the pool into the struct makes each `FileStorage` instance own its pool, connected to its own URL.

**Migration safety:** The production code only ever creates one `FileStorage` instance (in `main.rs`), so this change has zero production impact. Only tests create multiple instances.

**After this fix**, per-test isolation works:

**Option A (preferred): per-test schema within the same database**

```rust
async fn test_storage() -> (Arc<FileStorage>, String) {
    let schema = format!("test_{}", uuid::Uuid::new_v4().simple());
    let postgres_url = std::env::var("AI_TUTOR_POSTGRES_URL").unwrap();
    
    // Create schema
    let admin_pool = sqlx::PgPool::connect(&postgres_url).await.unwrap();
    sqlx::query(&format!("CREATE SCHEMA {}", schema))
        .execute(&admin_pool).await.unwrap();
    drop(admin_pool);
    
    // Set search_path via connection options
    let url = format!("{}&options=-c%20search_path%3D{}", postgres_url, schema);
    let storage = Arc::new(FileStorage::with_databases(temp_root(), Some(url)));
    
    // Migrations run automatically on first connection
    (storage, schema)
}

async fn drop_schema(schema: &str) {
    let postgres_url = std::env::var("AI_TUTOR_POSTGRES_URL").unwrap();
    let pool = sqlx::PgPool::connect(&postgres_url).await.unwrap();
    sqlx::query(&format!("DROP SCHEMA IF EXISTS {} CASCADE", schema))
        .execute(&pool).await.unwrap();
}
```

**Option B (simpler): per-test database**

If schema-level isolation is tricky with the r2d2 pool (search_path must be set per connection), create a separate database per test:

```rust
async fn test_storage() -> (Arc<FileStorage>, String) {
    let db_name = format!("aitutor_test_{}", uuid::Uuid::new_v4().simple());
    let base_url = std::env::var("AI_TUTOR_POSTGRES_URL_ADMIN").unwrap();
    let test_url = base_url.replace("aitutor_test", &db_name);
    
    let admin_pool = sqlx::PgPool::connect(&base_url).await.unwrap();
    sqlx::query(&format!("CREATE DATABASE {}", db_name))
        .execute(&admin_pool).await.unwrap();
    drop(admin_pool);
    
    let storage = Arc::new(FileStorage::with_databases(temp_root(), Some(test_url)));
    (storage, db_name)
}
```

**Why this works:** Each test gets a completely isolated database (or schema). No truncation needed, no FK violations, no row leakage. Tests can run in parallel without any coordination.

**What to remove:** `cleanup_database()`, `seed_all_billing_accounts()`, `seed_account()`. Billing tests create their own `TutorAccount` rows directly in their isolated database.

**Tests that must be updated:** Every test that currently uses `Arc::new(FileStorage::new(&root))`. Replace with `test_storage()` and use a `Drop` guard or explicit cleanup to drop the schema/database after the test.

#### 1c. Billing tests: seed accounts in each test's own DB

**File:** `AI-Tutor-Backend/crates/api/src/app.rs` (test module, billing tests ~line 15129+)

**What to change:**

With per-test databases (1b), each billing test creates its own `TutorAccount` before inserting subscription/invoice/payment rows. No shared `seed_all_billing_accounts` needed — each test seeds only the account(s) it uses:

```rust
#[tokio::test]
async fn live_service_subscription_payment_upserts_active_subscription() {
    let (storage, _schema) = test_storage().await;
    
    // Seed the one account this test needs
    storage.save_tutor_account(&TutorAccount {
        id: "acct-sub-success-1".to_string(),
        ...
    }).await.unwrap();
    
    // ... rest of test
}
```

**Why this works:** No cross-test interference. Each test's DB is empty until it seeds exactly what it needs.

---

## 2. Image Generation Kill Switch

### The requirement

The platform must not generate images. This is a **runtime kill switch**, not a code deletion. The image provider trait, pipeline logic, and asset persistence code remain in the codebase but are never invoked.

### Where to implement the kill switch

There are three layers where `enable_image_generation` flows:

```
Client request
  → GenerateLessonPayload.enable_image_generation (Option<bool>)   [app.rs:580]
  → LessonGenerationRequest.enable_image_generation (bool)         [app.rs:10628]
  → orchestrator pipeline                                           [app.rs:4418]
  → outline generation (media_generations)                         [outlines.rs:109]
```

### The fix: force `false` at the API boundary

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, line ~10628

**What to change:**

Hardcode `enable_image_generation: false` in the request construction, ignoring the client's value:

```rust
// Image generation is disabled platform-wide. The client flag is
// accepted for API compatibility but ignored.
enable_image_generation: false,
enable_video_generation: payload.enable_video_generation.unwrap_or(false),
```

**Why here and not in the orchestrator:** The API layer is the trust boundary. Forcing `false` here means the orchestrator never wires an image provider, never passes image media_generations to the outline prompt, and the pipeline's image branch (`pipeline.rs:710`) is dead code. No downstream changes needed.

**Why not remove the field:** The field exists in `GenerateLessonPayload` (the public API DTO) and `LessonGenerationRequest` (the domain type). Removing it would be a breaking API change for clients. Keeping it and ignoring the value is backward-compatible.

**Why not remove the image pipeline code:** The pipeline's image generation logic (`pipeline.rs:710-740`), the `ImageProvider` trait, `FakeImageProvider`, and `LocalFileAssetStore::persist_asset` for `AssetKind::Media` all stay. They're dead-pathed. When images are re-enabled, only the API-layer `false` needs to change to `payload.enable_image_generation.unwrap_or(false)`.

### What NOT to change

- **Do not** remove `ImageProvider` trait, `FakeImageProvider`, `FakeImageProviderFactory`, `wrap_image_provider`, or `with_image_provider`. These are infrastructure.
- **Do not** remove the image branch in `pipeline.rs:710-740`. It's guarded by `self.image.as_ref()` which will be `None` when the kill switch is active.
- **Do not** remove `media_generations` from `SceneOutline`. The outline LLM may still suggest image placeholders; they just won't be generated.
- **Do not** remove `replace_media_placeholders` or `persist_inline_media_assets`. These handle video too.

### Test impact

The two generation tests (`live_service_generates_and_persists_lesson_via_api_route` and `live_service_generates_and_persists_lesson_via_async_api_route`) currently set `enable_image_generation: Some(true)` and assert an Image element exists in the persisted lesson.

**With the kill switch, these assertions must change:**

1. Change `enable_image_generation: Some(true)` → `Some(false)` in both tests (or leave `Some(true)` to verify the flag is ignored — recommended, to prove the kill switch works).
2. Remove the `image_src` assertion block (lines 18406-18421) from the sync test. The lesson should have no Image elements.
3. Add an assertion that no Image elements exist:
   ```rust
   let has_image = lesson.scenes.iter().any(|scene| {
       matches!(&scene.content, SceneContent::Slide { canvas } if 
           canvas.elements.iter().any(|e| matches!(e, SlideElement::Image { .. })))
   });
   assert!(!has_image, "image generation is disabled platform-wide");
   ```

4. The fake LLM response queue no longer needs the Image element in the scene-content response. Simplify response 3 back to text-only:
   ```rust
   r#"{"elements":[{"kind":"text","content":"Fractions represent parts of a whole.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
   ```
   And the outlines response no longer needs `media_generations`:
   ```rust
   r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is","Parts of a fraction"],"scene_type":"slide"},{"title":"Fraction Quiz","description":"Check learning","key_points":["Identify numerator"],"scene_type":"quiz"}]}"#.to_string(),
   ```

5. The `openrouter` provider config addition (in `build_live_service_with_fakes_and_queue`) is still needed because the test uses `openrouter:deepseek/deepseek-chat` for LLM, TTS, etc. Keep it.

---

## 3. Production Bug Fixes (Real, Not Test-Only)

These are genuine logic bugs found during the investigation. They must be fixed regardless of the test isolation work.

### 3a. Payment reversal idempotency

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, line ~3265 (in `reconcile_reversed_payment`)

**The bug:** `apply_credit_entry` uses `ON CONFLICT DO NOTHING`, so a duplicate insert silently succeeds (returns Ok) instead of erroring. The old dedup logic relied on checking for an `"already exists"` error string — which never fires. A retried webhook could double-credit.

**The fix (already in working tree):** Check `list_credit_entries` for the reversal entry ID before calling `apply_credit_entry`:

```rust
let existing = self.storage
    .list_credit_entries(&debit_entry.account_id, 1000)
    .await
    .map_err(|e| anyhow!(e))?;
if existing.iter().any(|e| e.id == debit_entry.id) {
    return Ok(false);  // already applied
}
```

**Why this is correct:** `list_credit_entries` is a read query; the entry ID is deterministic (derived from the payment intent ID + reversal suffix). If it exists, the reversal was already applied. This is race-safe only if `apply_credit_entry` is the single writer for that ID; since the ID is derived, two concurrent calls would both find no existing entry and both insert — but `ON CONFLICT DO NOTHING` prevents the duplicate row, so only one wins. The check is a fast-path optimization, not the sole guard. The DB constraint is the real guard.

### 3b. Queue pending count

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, line ~4620 (in `get_system_status`)

**The bug:** `queue_pending_jobs` reported `counts.active` (active leases) instead of the actual pending count. The system status endpoint showed wrong queue depth.

**The fix (already in working tree):** Use `get_pending_count()` for pending, `counts.active` for active leases, `counts.stale` for stale:

```rust
let pending_count = self.queue.get_pending_count().await.unwrap_or(0);
let (queue_pending_jobs, queue_active_leases, queue_stale_leases, queue_status_error) =
    match &leases_result {
        Ok(counts) => (pending_count, counts.active, counts.stale, None),
        Err(err) => (0, 0, 0, Some(format!("get_lease_counts: {}", err))),
    };
```

**Why this is correct:** `get_pending_count` counts jobs with no active lease. `counts.active` counts jobs with an active (non-expired) lease. These are different metrics.

### 3c. Auth middleware: disabled auth passthrough

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, line ~448 (in `auth_middleware`)

**The bug:** When auth is fully disabled (no tokens, no explicit requirement), the middleware still tried to enforce role/session checks, causing 401s in local/test environments.

**The fix (already in working tree):** Early return when auth is disabled:

```rust
if !auth.enabled {
    return next.run(req).await;
}
```

**Why this is correct:** `auth.enabled` is `false` only when no auth configuration is present. In that mode, all routes should be open. This matches the existing behavior of `build_router` (which skips auth middleware entirely when no tokens are configured), but the middleware itself needed to respect the flag for cases where it's mounted but not configured.

---

## 4. Test Assertions to Correct (Match Current Domain Types)

These are test-only fixes where assertions were written against an older version of the domain types. They are not logic bugs.

### 4a. SlideCanvas: `viewport_height` removed, `outline`/`shadow` added

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, test structs at ~lines 17424 and 17541

**What changed:** `SlideCanvas` no longer has `viewport_height` (replaced by `viewport_ratio`). `SlideTheme` now has `outline: Option<…>` and `shadow: Option<…>`. `SlideElement::Video` now has `rotate: f32` and `shadow: Option<…>`.

**Fix (already in working tree):** Add `outline: None, shadow: None` to theme literals; add `rotate: 0.0, shadow: None` to Video element literals; remove `viewport_height` lines.

### 4b. SSE streaming test: wrong request type and over-specified assertions

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, `runtime_chat_stream_route_returns_sse_payload` at ~line 17744

**The problem:** The test sent a `StatelessChatRequest` to `/api/runtime/chat/stream`, but the route handler expects a `PblRuntimeChatRequest`. The test also asserted on SSE event content (`text_delta`, `action_started`, etc.) that the mock handler never emits.

**Fix (already in working tree):** Use `sample_pbl_runtime_chat_request()` and the correct route `/api/runtime/pbl/chat-stream`. Assert only on the negotiated `text/event-stream` content type. Remove event-content assertions (the mock returns `Ok(())` without emitting events).

### 4c. Role-gating test: generate/shelf routes are session-auth, not role-auth

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, auth role test at ~line 16257

**The problem:** The test expected static API tokens (reader/writer) to get `FORBIDDEN`/`OK` on `/api/lessons/generate` and `/api/shelf/items`. But these routes are session-authenticated (JWT), not role-gated. Static tokens are not JWT sessions, so they get `401 UNAUTHORIZED`, not `403 FORBIDDEN`.

**Fix (already in working tree):** Change assertions from `FORBIDDEN`/`OK` to `UNAUTHORIZED` for static-token requests to session-auth routes.

### 4d. Runtime streaming selectors: model changed

**File:** `AI-Tutor-Backend/crates/api/src/app.rs`, ~line 16985

**The problem:** `runtime_native_streaming_selectors()` expected `openrouter:deepseek/deepseek-chat` but the default routing changed to `openai:gpt-4o-mini`.

**Fix (already in working tree):** Update the expected value to `openai:gpt-4o-mini`.

---

## 5. Execution Order

The changes must be applied in this order to avoid intermediate breakage:

### Phase 1: Storage isolation (prerequisite — must come first)
0. Fix `PG_POOL` global static in `crates/storage/src/filesystem.rs` — move pool into `FileStorage` struct — **Section 1b**
1. Add `test_storage()` helper that creates a per-test database — **1b**

### Phase 2: Test infrastructure (no behavior change)
2. Change `FakeLlmProviderFactory` to own its response queue — **1a**
3. Update `build_live_service_with_fakes` to accept the factory — **1a**
4. Update all test call sites to use new factory and `test_storage()` — **1a, 1b**
5. Remove `cleanup_database()`, `seed_all_billing_accounts()`, `seed_account()` — **1b**

### Phase 3: Image kill switch
6. Hardcode `enable_image_generation: false` at the API boundary — **Section 2**
7. Simplify fake LLM responses (remove image element, remove `media_generations`) — **Section 2**
8. Update generation test assertions (assert no Image elements) — **Section 2**

### Phase 4: Production fixes (verify already in working tree)
9. Verify payment reversal idempotency check — **3a**
10. Verify queue pending count fix — **3b**
11. Verify auth middleware passthrough — **3c**

### Phase 5: Test assertion corrections (verify already in working tree)
12. Verify SlideCanvas/Theme/Video field updates — **4a**
13. Verify SSE streaming test — **4b**
14. Verify role-gating test — **4c**
15. Verify runtime streaming selectors — **4d**

### Phase 6: Cleanup
16. Remove `FAKE_LLM_RESPONSES` static, `fake_llm_responses()`, `reset_fake_llm_responses()` — **1a**
17. Remove unused import `AgentTurnSummary` (already done)

### Phase 7: Verification
18. Run `cargo test -p ai_tutor_api --lib` with default parallelism — expect 86 passed, 0 failed
19. Run `cargo test -p ai_tutor_api --lib -- --test-threads=1` — expect 86 passed, 0 failed
20. Run `cargo test -p ai_tutor_api --lib --no-run` — expect 0 warnings
21. Run `cargo clippy -p ai_tutor_api --lib --tests` — expect 0 warnings

---

## 6. What This Plan Does NOT Do

- **Does not delete image generation code.** The kill switch is a one-line `false` at the API boundary. All image infrastructure stays.
- **Does not change the public API.** `GenerateLessonPayload.enable_image_generation` remains `Option<bool>`. Clients can still send `true`; it's ignored.
- **Does not touch video or TTS.** Those remain active.
- **Does not refactor `app.rs`.** The 19K-line megafile decomposition is a separate project (see `APP_RS_REFACTOR_PLAN.md`).
- **Does not add new dependencies.** `sqlx`, `uuid`, `tokio` are already in the workspace.
- **Does not change the database schema.** Per-test schemas use the same migrations.
- **Does not modify the frontend.** This is backend-only.

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `FileStorage` global `PG_POOL` blocks per-test isolation | **Must fix** `crates/storage/src/filesystem.rs` — move pool into the struct. This is the highest-priority change; without it, no isolation is possible. |
| r2d2 pool doesn't support per-connection `search_path` | Use Option B (per-test database) instead of Option A (per-test schema) — database-level isolation doesn't need search_path |
| Per-test database creation is slow (~200ms each) | Acceptable for ~86 tests (~17s total); CI already takes minutes. Optimize later with a pool of pre-created databases if needed. |
| Parallel tests exhaust Postgres connection limits | r2d2 pool `max_size=10` per `FileStorage` instance; tests are short-lived and clean up quickly |
| `FakeLlmProviderFactory` change breaks `FakeChatLlmProviderFactory` | `FakeChatLlmProviderFactory` already uses `Arc::new(Mutex::new(self.responses.clone()))` — no change needed |
| Kill switch breaks existing lessons with images | Existing lessons are already persisted with image URLs; the kill switch only affects new generation. Read paths are unaffected. |
| Removing `media_generations` from fake outline breaks orchestrator tests | Orchestrator tests in `pipeline.rs` have their own stub providers and don't use `FakeLlmProviderFactory` — unaffected |
| `FileStorage` pool change breaks production | Production creates exactly one `FileStorage` in `main.rs`; moving from global to per-instance pool is behaviorally identical for a single instance |

---

## 8. File-Level Change Summary

| File | Changes | Lines affected |
|------|---------|----------------|
| `crates/storage/src/filesystem.rs` | Remove global `PG_POOL` static; move connection pool into `FileStorage` struct so each instance owns its pool | ~30 lines modified |
| `crates/api/src/app.rs` | Fake LLM refactor (per-instance queue), image kill switch, test isolation helpers (`test_storage()`), test assertion fixes, remove `cleanup_database`/`seed_*` helpers, remove `FAKE_LLM_RESPONSES` static | ~250 lines modified |

Two files. The storage change is small and has zero production impact (production creates one `FileStorage`; only tests create multiple).
