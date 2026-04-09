# OpenMAIC Gap Closure Master Task List

## Purpose

This is the strict execution board to close the remaining OpenMAIC → AI-Tutor parity gaps.

Rules:
- no task is `Done` without code + tests + command evidence
- every task links to OpenMAIC source behavior it is translating
- statuses are honest: `Done`, `In Progress`, `Pending`, `Blocked`

## Current Honest State

- Translation foundation: `Done`
- Working vertical slice: `Done`
- Production-complete parity: `Pending`

## Phase Tasks

### Phase 1. Native Structured Stream Contract
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/ai-sdk-adapter.ts`
AI-Tutor refs:
- `AI-Tutor-Backend/crates/providers/src/traits.rs`
- `AI-Tutor-Backend/crates/providers/src/resilient.rs`
Acceptance:
- provider layer exposes a typed stream-event contract, not only raw string callbacks
- compatibility path still adapts text-only providers honestly
- resilient failover preserves typed streaming semantics
Evidence:
- `AI-Tutor-Backend/crates/providers/src/traits.rs` now defines `ProviderStreamEvent` and `ProviderToolCall`
- `AI-Tutor-Backend/crates/providers/src/resilient.rs` now retries/fails over typed stream events
- `AI-Tutor-Backend/crates/providers/src/openai.rs` emits native SSE text + `tool_calls` as typed events
- `AI-Tutor-Backend/crates/providers/src/anthropic.rs` parses `tool_use`/`input_json_delta` into typed tool-call events
- `AI-Tutor-Backend/crates/providers/src/google.rs` parses Gemini `functionCall` stream parts into typed tool-call events
- `cargo test -p ai_tutor_providers --lib` passed (25/25)

### Phase 2. GraphBit Typed Stream Consumption
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/stateless-generate.ts`
- `OpenMAIC/lib/orchestration/director-graph.ts`
AI-Tutor refs:
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/response_parser.rs`
Acceptance:
- chat graph consumes typed provider stream events directly
- provider-native tool/action events bypass JSON reconstruction
- parser remains as fallback for text-only structured outputs
Evidence:
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs` now consumes `ProviderStreamEvent`
- tool-call events map straight to runtime action lifecycle emission
- parser fallback in `response_parser.rs` remains active for text-only providers
- `cargo test -p ai_tutor_orchestrator --lib` passed (49/49)

### Phase 3. Whiteboard and Runtime Action Executor Hardening
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/stateless-generate.ts`
AI-Tutor refs:
- `AI-Tutor-Backend/crates/runtime/src/whiteboard.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- `AI-Tutor-Frontend/apps/web/components/whiteboard/*`
Acceptance:
- canonical backend-owned runtime action payloads drive whiteboard execution
- playback/live parity is proven by replay tests
Progress notes:
- Canonical live runtime payload contract `runtime_action_v1` added in `AI-Tutor-Backend/crates/runtime/src/session.rs` (`canonical_runtime_action_params`)
- Chat graph action lifecycle now emits canonical action params on every action event in `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- API mapping now enforces canonical action payload shape at SSE boundary in `AI-Tutor-Backend/crates/api/src/app.rs` (`map_graph_event_to_tutor_event`)
- Frontend runtime event parser now consumes canonical `runtime_action_v1` payloads first in `AI-Tutor-Frontend/apps/web/components/lesson-player-shell.tsx`, with legacy parser path retained as fallback.
- Tests:
  - `cargo test -p ai_tutor_runtime --lib` passed (3/3)
  - `cargo test -p ai_tutor_orchestrator --lib` passed (49/49)
  - `cargo test -p ai_tutor_api --lib` passed (45/45)
  - `pnpm -C AI-Tutor-Frontend/apps/web exec tsc --noEmit` passed

### Phase 4. Persistence and Queue Production Upgrade
Status: `In Progress`
OpenMAIC refs:
- production deployment expectations inferred from OpenMAIC runtime architecture
AI-Tutor refs:
- `AI-Tutor-Backend/crates/storage/src/*`
- `AI-Tutor-Backend/crates/api/src/queue.rs`
- `AI-Tutor-Backend/crates/media/src/storage.rs`
Acceptance:
- object storage, DB-backed persistence, and multi-instance-safe queue posture exist
- SQLite/local paths remain honest dev fallback only
Progress notes:
- Object storage foundation is implemented with Cloudflare R2 path in `AI-Tutor-Backend/crates/media/src/storage.rs`
- Queue claim lease heartbeats are now implemented for both SQLite and file-backed queue claims in `AI-Tutor-Backend/crates/api/src/queue.rs`, preventing long-running jobs from being reclaimed as stale by another worker.
- SQLite queue claims now include explicit ownership + lease fields (`claimed_by`, `lease_until`) with heartbeat lease extension and stale-lease reclaim logic in `AI-Tutor-Backend/crates/api/src/queue.rs`.
- SQLite queue cancel + pending-count semantics are now lease-aware for stale `working` entries, and schema migration for new lease columns is handled in-place in `AI-Tutor-Backend/crates/api/src/queue.rs`.
- Queue lease observability is now exposed in `/api/system/status` via `queue_active_leases`, `queue_stale_leases`, and `queue_status_error`, backed by queue-level lease counting in `AI-Tutor-Backend/crates/api/src/queue.rs`.
- Media provider factories now build resilient image/video provider chains (retry + failover across resolved model chain) in `AI-Tutor-Backend/crates/providers/src/factory.rs`, following OpenMAIC’s provider-first media orchestration intent from `OpenMAIC/lib/server/classroom-media-generation.ts` while adding stronger failover semantics.
- Full DB/queue multi-instance hardening remains open
Verification:
- `cargo test -p ai_tutor_api sqlite_claim_heartbeat_refreshes_claim_timestamp -- --nocapture`
- `cargo test -p ai_tutor_api sqlite_claim_is_single_owner_under_concurrent_workers -- --nocapture`
- `cargo test -p ai_tutor_api cancels_sqlite_stale_working_entry -- --nocapture`
- `cargo test -p ai_tutor_api sqlite_pending_count_includes_stale_working_claims -- --nocapture`
- `cargo test -p ai_tutor_api sqlite_lease_counts_split_active_and_stale_working_claims -- --nocapture`
- `cargo test -p ai_tutor_api live_service_system_status_reports_queue_active_and_stale_leases -- --nocapture`
- `cargo test -p ai_tutor_api --lib` passed (52/52)

### Phase 5. Operability and Safety
Status: `Pending`
OpenMAIC refs:
- live orchestration observability expectations across adapter/graph flow
AI-Tutor refs:
- `AI-Tutor-Backend/crates/api/src/app.rs`
- `AI-Tutor-Backend/crates/providers/src/resilient.rs`
Acceptance:
- request tracing, cost telemetry, provider health, and worker visibility are production-usable

---

## Workstream A: Streaming + Runtime Orchestration Parity

### A1. In-flight text/action event streaming (OpenMAIC stream cadence)
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/ai-sdk-adapter.ts`
- `OpenMAIC/lib/orchestration/stateless-generate.ts`
- `OpenMAIC/lib/orchestration/director-graph.ts`
AI-Tutor refs:
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/response_parser.rs`
Acceptance:
- tutor graph emits `text_delta` and action lifecycle events while stream is active
- no full-response buffering before first runtime events
Verification:
- `cargo test -p ai_tutor_orchestrator`
- `cargo test -p ai_tutor_api`

### A2. Stream capability observability (native vs compatibility)
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/ai-sdk-adapter.ts` (true stream intent)
AI-Tutor refs:
- `AI-Tutor-Backend/crates/providers/src/traits.rs`
- `AI-Tutor-Backend/crates/providers/src/resilient.rs`
- `AI-Tutor-Backend/crates/api/src/app.rs`
Acceptance:
- `/api/system/status` exposes per-provider streaming path
- runtime warns when compatibility stream path is active
Verification:
- `cargo test -p ai_tutor_api provider_runtime_status_mapping_exposes_streaming_path`

### A3. Abort-on-disconnect at service + HTTP edge
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/ai-sdk-adapter.ts` (`AbortSignal` input)
AI-Tutor refs:
- `AI-Tutor-Backend/crates/api/src/app.rs`
Acceptance:
- on SSE disconnect, running stateless stream task is aborted quickly
Verification:
- `cargo test -p ai_tutor_api live_service_stateless_chat_stream_aborts_on_downstream_disconnect`

### A4. Provider-level cooperative cancellation token propagation
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/ai-sdk-adapter.ts` (abort propagated into stream call)
AI-Tutor target files:
- `AI-Tutor-Backend/crates/providers/src/traits.rs`
- `AI-Tutor-Backend/crates/providers/src/openai.rs`
- `AI-Tutor-Backend/crates/providers/src/anthropic.rs`
- `AI-Tutor-Backend/crates/providers/src/google.rs`
- `AI-Tutor-Backend/crates/providers/src/resilient.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- `AI-Tutor-Backend/crates/api/src/app.rs`
Acceptance:
- cancellation signal can terminate in-flight provider stream loops without waiting for next natural event
- resilient wrapper preserves retry/failover semantics when not cancelled
Verification:
- provider/orchestrator/API tests including cancellation-focused tests

### A5. Richer director end/cue/interruption semantics
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/director-graph.ts`
AI-Tutor target files:
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/director_prompt.rs`
Acceptance:
- deterministic + LLM director logic supports stronger interruption/resume rules
- multi-turn orchestration remains bounded and state-consistent
Verification:
- `cargo test -p ai_tutor_orchestrator`
- `cargo test -p ai_tutor_api`

---

## Workstream B: Whiteboard Parity (Backend + Frontend)

### B1. Backend-owned whiteboard document model hardening
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/stateless-generate.ts`
- `OpenMAIC/lib/orchestration/director-graph.ts`
AI-Tutor target files:
- `AI-Tutor-Backend/crates/runtime/src/whiteboard.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- `AI-Tutor-Backend/crates/domain/src/runtime.rs`
Acceptance:
- whiteboard snapshots/ledger stay deterministic across playback and live runtime
- resume from persisted `director_state` reproduces same document state
Verification:
- runtime/orchestrator whiteboard tests

### B2. Frontend runtime whiteboard renderer + executor parity
Status: `Done`
OpenMAIC refs:
- runtime action/whiteboard behavior in orchestration layer
AI-Tutor target files:
- `AI-Tutor-Frontend/apps/web/components/whiteboard/*`
- `AI-Tutor-Frontend/apps/web/components/lesson-player-shell.tsx`
- `AI-Tutor-Frontend/apps/web/hooks/*`
Acceptance:
- playback + discussion actions both execute against one whiteboard runtime
- whiteboard hydration uses backend snapshots/events
Verification:
- frontend build + runtime action integration checks

### B3. Playback/live synchronization tests for whiteboard state
Status: `Done`
OpenMAIC refs:
- streamed structured output + action ordering behavior
AI-Tutor target files:
- backend API/orchestrator tests
- frontend integration tests
Acceptance:
- same ordered action stream yields same whiteboard state across modes
Verification:
- `cargo test -p ai_tutor_api`
- `cargo test -p ai_tutor_orchestrator`

---

## Workstream C: Generation Parity (Static Lesson Quality)

### C1. Research/search phase integration
Status: `Done`
OpenMAIC refs:
- generation pipeline and orchestration notes in backend analysis
AI-Tutor target files:
- `AI-Tutor-Backend/crates/orchestrator/src/generation.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/pipeline.rs`
- `AI-Tutor-Backend/crates/api/src/app.rs`
Acceptance:
- optional research path enriches outline/content/action prompts
- failures degrade gracefully to non-research mode
Verification:
- orchestrator generation tests

### C2. Interactive + PBL scene-type parity
Status: `Done`
OpenMAIC refs:
- scene generation architecture in OpenMAIC layer analysis
AI-Tutor target files:
- `AI-Tutor-Backend/crates/orchestrator/src/generation.rs`
- `AI-Tutor-Backend/crates/domain/src/scene.rs`
Acceptance:
- generation can emit richer scene types with valid actions/contracts
Verification:
- generation tests for each scene type

### C3. Structured output repair/fallback parity deepening
Status: `Done`
OpenMAIC refs:
- `OpenMAIC/lib/orchestration/stateless-generate.ts`
AI-Tutor target files:
- `AI-Tutor-Backend/crates/orchestrator/src/response_parser.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/generation.rs`
Acceptance:
- malformed/partial outputs recover across outlines, scenes, actions, and runtime responses
Verification:
- parser + generation test suites

---

## Workstream D: Media / TTS / ASR Parity

### D1. Media generation hardening (video lifecycle + broader providers)
Status: `In Progress`
OpenMAIC refs:
- post-generation enrichment architecture
AI-Tutor target files:
- `AI-Tutor-Backend/crates/media/src/*`
- `AI-Tutor-Backend/crates/providers/src/*`
Acceptance:
- resilient image/video task orchestration with retries/fallbacks and clear error surfaces
Verification:
- media + orchestrator tests
Progress notes:
- `AI-Tutor-Backend/crates/providers/src/factory.rs` now includes resilient media provider wrappers:
  - `ResilientImageProvider` (retry + provider failover)
  - `ResilientVideoProvider` (retry + provider failover)
- `DefaultImageProviderFactory` and `DefaultVideoProviderFactory` now resolve provider/model chains from server config (instead of single-provider-only build), and `AI-Tutor-Backend/crates/api/src/main.rs` plus `AI-Tutor-Backend/crates/api/src/app.rs` test wiring now pass server config into these factories.
- Added provider-level tests:
  - `resilient_image_provider_fails_over_to_next_candidate`
  - `resilient_video_provider_retries_transient_failure_before_success`
- Command evidence:
  - `cargo test -p ai_tutor_providers --lib` passed (28/28)
  - `cargo test -p ai_tutor_orchestrator --lib` passed (49/49)
  - `cargo test -p ai_tutor_api --lib` passed (52/52)

### D2. TTS hardening and multi-provider coverage
Status: `In Progress`
OpenMAIC refs:
- provider abstraction behavior
AI-Tutor target files:
- `AI-Tutor-Backend/crates/providers/src/*`
- `AI-Tutor-Backend/crates/media/src/*`
Acceptance:
- non-OpenAI provider support and stronger retry/fallback handling for audio generation
Verification:
- provider/media tests
Progress notes:
- `AI-Tutor-Backend/crates/providers/src/factory.rs` now includes `ResilientTtsProvider` with retry + provider failover across resolved provider/model chain, and `DefaultTtsProviderFactory` now resolves server-configured chains (instead of single-provider-only build).
- App and worker wiring now pass server provider config into `DefaultTtsProviderFactory::new(...)` in:
  - `AI-Tutor-Backend/crates/api/src/main.rs`
  - `AI-Tutor-Backend/crates/api/src/bin/queue_worker.rs`
  - `AI-Tutor-Backend/crates/api/src/app.rs` test live-service builder
- Added provider test:
  - `resilient_tts_provider_fails_over_to_next_candidate`
- Command evidence:
  - `cargo test -p ai_tutor_providers --lib` passed (28/28)
  - `cargo test -p ai_tutor_api --lib` passed (52/52)
  - `cargo check -p ai_tutor_api` passed

### D3. ASR + voice runtime path
Status: `Pending`
OpenMAIC refs:
- live runtime architecture expectation
AI-Tutor target files:
- `AI-Tutor-Backend/crates/providers/src/whisper.rs` (expand)
- API runtime chat routes
- frontend voice controls
Acceptance:
- voice input transcribed and routed into live tutor runtime
Verification:
- API integration tests + frontend voice flow checks

---

## Workstream E: Production Data + Queue Foundation

### E1. Postgres-backed lesson/job/runtime persistence adapters
Status: `Pending`
OpenMAIC refs:
- production architecture expectations in analysis docs
AI-Tutor target files:
- `AI-Tutor-Backend/crates/storage/src/*`
Acceptance:
- DB backend selectable by config, with migration path and parity tests
Verification:
- storage tests against DB adapters

### E2. Object storage for media/audio assets
Status: `Pending`
OpenMAIC refs:
- production media architecture expectation
AI-Tutor target files:
- media/storage/api crates
Acceptance:
- media/audio URLs served from object storage with fallback strategy
Verification:
- integration tests for asset persistence/retrieval

### E3. Worker concurrency and queue policy hardening
Status: `In Progress`
OpenMAIC refs:
- background orchestration reliability principles
AI-Tutor target files:
- `AI-Tutor-Backend/crates/api/src/queue.rs`
- `AI-Tutor-Backend/crates/api/src/bin/queue_worker.rs`
Acceptance:
- safe multi-worker coordination, lease/claim semantics, cancellation/resume invariants
Verification:
- queue tests for contention/retry/recovery paths

---

## Workstream F: Observability + Security + Productization

### F1. Runtime tracing/metrics/cost telemetry
Status: `In Progress`
OpenMAIC refs:
- production runtime operability needs
AI-Tutor target files:
- API/orchestrator/providers instrumentation
Acceptance:
- per-request traces + provider latency/error/cost metrics + dashboards/alerts
Verification:
- telemetry assertions + operational docs
Progress notes:
- `/api/system/status` now exposes provider aggregate runtime counters (`provider_total_requests`, `provider_total_successes`, `provider_total_failures`, `provider_total_latency_ms`, `provider_average_latency_ms`) derived from provider runtime status snapshots in `AI-Tutor-Backend/crates/api/src/app.rs`.
- Queue lease health telemetry is also exposed in `/api/system/status` (`queue_active_leases`, `queue_stale_leases`, `queue_status_error`) backed by queue lease counting in `AI-Tutor-Backend/crates/api/src/queue.rs`.
- `/api/system/status` now exposes queue worker timing posture (`queue_poll_ms`, `queue_claim_heartbeat_interval_ms`, `queue_stale_timeout_ms`) so production can verify worker polling/lease configuration directly from runtime status.

### F2. Auth, quotas, and tenant-safe boundaries
Status: `Pending`
OpenMAIC refs:
- production gateway/channel posture expectations
AI-Tutor target files:
- API auth layer + rate/usage policy
Acceptance:
- authenticated runtime routes with quota/rate controls
Verification:
- API auth and quota tests

### F3. Frontend live runtime UX parity
Status: `Pending`
OpenMAIC refs:
- live tutor orchestration UX behavior
AI-Tutor target files:
- `AI-Tutor-Frontend/apps/web/components/*`
- `AI-Tutor-Frontend/apps/web/lib/*`
Acceptance:
- frontend consumes runtime stream events directly for multi-agent, whiteboard, audio/video, and cues
Verification:
- frontend integration tests + production build

---

## Immediate Execution Queue (Do Next)

1. `D1` Media generation hardening (video lifecycle + broader providers) completion
2. `F1` Telemetry foundation

## Definition of “Production-Complete Translation”

Only when all `Pending` items above are moved to `Done` with evidence.
