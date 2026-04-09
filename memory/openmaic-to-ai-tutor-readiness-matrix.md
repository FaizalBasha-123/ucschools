# OpenMAIC to AI-Tutor Readiness Matrix

## Purpose

This file is the strict readiness checklist for the architecture translation project from `OpenMAIC` to `AI-Tutor`.

Status meanings used here:

- `Done`: implemented and verified in the current repo
- `In Progress`: partially implemented, structurally real, but not production-complete
- `Missing`: not implemented yet in a way that supports honest production claims

This matrix is based on:
- [openmaic-backend-layer-analysis.md](d:/uc-school/memory/openmaic-backend-layer-analysis.md)
- [implementation-plan.md](d:/uc-school/AI-Tutor-Backend/docs/implementation-plan.md)
- [implementation-plan.md](d:/uc-school/AI-Tutor-Frontend/docs/implementation-plan.md)

## 1. Domain Contract Translation

Status: `Done`

Evidence:
- [scene.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/scene.rs)
- [action.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/action.rs)
- [generation.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/generation.rs)
- [job.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/job.rs)
- [runtime.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/runtime.rs)

What is covered:
- lesson request model
- scene outlines
- scene content variants
- action variants
- generation jobs
- runtime/session contracts

Remaining caution:
- contract existence is complete enough to claim translation foundation
- runtime behavior behind many contracts is still not complete

## 2. Provider Registry and Model Resolution

Status: `Done`

Evidence:
- [registry.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/registry.rs)
- [resolve.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/resolve.rs)
- [config.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/config.rs)

What is covered:
- provider registry
- provider capability metadata
- model string parsing
- env-based credential/base URL resolution

Remaining caution:
- registry parity is not the same as provider runtime parity

## 3. Concrete LLM Provider Calling

Status: `In Progress`

Evidence:
- [openai.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/openai.rs)
- [anthropic.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/anthropic.rs)
- [google.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/google.rs)
- [factory.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/factory.rs)
- [resilient.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/resilient.rs)

What exists:
- outbound OpenAI-compatible path
- outbound Anthropic text path
- outbound Google Gemini text path
- server-configured fallback-chain construction across configured providers
- cooldown-based per-provider circuit breaker
- provider factory wiring

What is still missing:
- provider-specific streaming behavior
- provider-specific structured-output hardening
- richer provider health scoring and live routing

## 4. File-Backed Persistence Parity

Status: `Done`

Evidence:
- [filesystem.rs](d:/uc-school/AI-Tutor-Backend/crates/storage/src/filesystem.rs)
- [repositories.rs](d:/uc-school/AI-Tutor-Backend/crates/storage/src/repositories.rs)

What is covered:
- lesson persistence
- job persistence
- atomic JSON write behavior
- stale running job detection

Remaining caution:
- file-backed parity is enough for translation parity
- it is not enough for production-grade scale by itself

## 5. Lesson Generation Pipeline

Status: `In Progress`

Evidence:
- [pipeline.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/pipeline.rs)
- [generation.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/generation.rs)

What exists:
- outline generation
- slide content generation
- quiz content generation
- scene action generation
- lesson assembly
- job progress updates
- basic media-generation-aware outline/content flow for image placeholders
- backend-side fallback injection/repair for missing image media requests
- JSON repair and deterministic fallbacks for malformed generation output
- transient LLM failure retry handling in the generation layer

What is still missing:
- optional research/search phase parity
- richer provider-aware fallback logic closer to OpenMAIC beyond the first transient retry layer
- richer media-generation-aware generation flow beyond the current first-pass image placeholder support
- interactive scene parity
- PBL parity
- stronger structured output recovery across more scene/runtime types

## 6. Backend HTTP Surface

Status: `In Progress`

Evidence:
- [app.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/app.rs)
- [main.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/main.rs)

What exists:
- health routes
- lesson generation route
- async lesson generation route
- stateless tutor SSE route
- job lookup route
- lesson lookup route
- lesson SSE event route
- persisted media asset route
- persisted audio asset route
- application service seam
- router-level tests
- live-service file-backed retrieval coverage for lessons, jobs, audio assets, and media assets
- live-service end-to-end generation/persistence/retrieval coverage with provider test seams
- error-path coverage for invalid requests, missing assets, and stale-job projection
- file-backed queued async generation flow with queue-and-poll API coverage

What is still missing:
- live tutor streaming routes
- parse-pdf style endpoints
- grading/quiz feedback endpoints
- authentication/authorization around API use

## 7. LangGraph-Equivalent Live Orchestration

Status: `In Progress`

Why this matters:
- this is one of the most important OpenMAIC architecture layers
- OpenMAIC uses graph/stateful orchestration for live tutoring and agent turns

What is missing:
- full Rust-native director flow
- per-turn orchestration state machine
- resumable turn state
- live LLM-driven streaming event emission beyond the current single-response chunking
- interruption/resume behavior

What now exists:
- runtime playback event contracts
- a first SSE stream for persisted lesson playback events
- a first stateless tutor SSE stream for single-turn chat responses
- a first director-style selector for stateless tutor turns
- opening-turn trigger-agent routing, last-speaker rotation, active-stage preference, and role/topic/priority heuristics
- selector behavior is covered by API crate tests
- a first multi-turn discussion loop for stateless tutor SSE sessions
- returned `director_state` can now accumulate more than one responding agent in a single streamed tutor session
- a first explicit `cue_user` tutor runtime event now exists for discussion sessions
- provider runtime health now flows into the GraphBit-style chat graph and director prompt
- degraded provider health now shortens discussion turn budgets and biases teacher-led fallback routing
- the live tutor graph now consumes a dedicated LLM streaming seam instead of only full-response generation calls

Evidence:
- [session.rs](d:/uc-school/AI-Tutor-Backend/crates/runtime/src/session.rs)
- [app.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/app.rs)
- [chat_graph.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs)
- [director_prompt.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/director_prompt.rs)
- [traits.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/traits.rs)

Related reference:
- [openmaic-backend-layer-analysis.md](d:/uc-school/memory/openmaic-backend-layer-analysis.md)

## 8. Media Generation Layer

Status: `In Progress`

What exists:
- media task model
- media request collection from outlines
- placeholder replacement pass into slide scenes
- first provider-backed image generation path
- first provider-backed video generation path
- persisted media asset storage and serving path
- LLM pipeline can now emit image media requests and slide placeholder bindings
- backend fallback repair now injects missing image requests and repairs empty image placeholders

Evidence:
- [tasks.rs](d:/uc-school/AI-Tutor-Backend/crates/media/src/tasks.rs)
- [lib.rs](d:/uc-school/AI-Tutor-Backend/crates/media/src/lib.rs)
- [openai.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/openai.rs)
- [factory.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/factory.rs)
- [pipeline.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/pipeline.rs)
- [app.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/app.rs)

What is still missing:
- richer video-generation task lifecycle beyond the current first provider path
- automatic high-quality generation of `media_generations` requests from the current outline/content pipeline
- provider coverage beyond the first OpenAI-compatible image path
- production object-storage strategy beyond local file assets

Why this blocks full parity:
- OpenMAIC supports post-generation media enrichment
- current `AI-Tutor` backend implements the first-pass layer, but not full production media parity

## 9. TTS Layer

Status: `In Progress`

What exists:
- TTS task model
- TTS task collection from speech actions
- speech-action audio enrichment pass back into scenes
- first OpenAI-compatible provider-backed TTS path
- API/orchestrator integration for `enable_tts`
- persisted inline audio asset storage and serving path

Evidence:
- [tasks.rs](d:/uc-school/AI-Tutor-Backend/crates/media/src/tasks.rs)
- [lib.rs](d:/uc-school/AI-Tutor-Backend/crates/media/src/lib.rs)
- [openai.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/openai.rs)
- [factory.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/factory.rs)
- [pipeline.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/pipeline.rs)
- [app.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/app.rs)
- [filesystem.rs](d:/uc-school/AI-Tutor-Backend/crates/storage/src/filesystem.rs)
- [lesson-player-shell.tsx](d:/uc-school/AI-Tutor-Frontend/apps/web/components/lesson-player-shell.tsx)

What is still missing:
- broader provider coverage
- richer retry/fallback handling
- production object-storage strategy beyond local file assets
- stronger frontend playback controls beyond basic audio slot

Why this blocks full parity:
- teacher-like audio is one of the stated target capabilities

## 10. ASR / Voice Interaction Layer

Status: `Missing`

What is missing:
- ASR provider layer
- voice input backend flow
- frontend voice controls
- live voice tutor session flow

Why this blocks full parity:
- interactive voice mode is a key requested capability

## 11. Frontend Contract Consumption

Status: `Done`

Evidence:
- [api.ts](d:/uc-school/AI-Tutor-Frontend/apps/web/lib/api.ts)
- [page.tsx](d:/uc-school/AI-Tutor-Frontend/apps/web/app/generate/page.tsx)
- [page.tsx](d:/uc-school/AI-Tutor-Frontend/apps/web/app/lessons/[id]/page.tsx)
- [index.ts](d:/uc-school/AI-Tutor-Frontend/packages/types/src/index.ts)

What is covered:
- lesson generation request from frontend
- lesson retrieval
- job retrieval
- shared DTO package

## 12. Frontend Lesson Player Shell

Status: `In Progress`

Evidence:
- [lesson-player-shell.tsx](d:/uc-school/AI-Tutor-Frontend/apps/web/components/lesson-player-shell.tsx)
- [globals.css](d:/uc-school/AI-Tutor-Frontend/apps/web/app/globals.css)

What exists:
- scene navigation
- action timeline
- action-aware selection state
- slide shell
- quiz shell
- speech surface
- discussion surface
- spotlight highlighting
- inline teacher-audio playback surface for `speech` actions with `audio_url`
- real image/video rendering for slide media elements
- first guided audio-driven action progression step
- first guided video-driven action progression step
- first stateless tutor-stream consumption in the discussion UI

What is still missing:
- timed playback engine
- broader automated audio playback behavior
- automated video playback behavior
- whiteboard rendering/execution
- automatic action progression
- multi-agent live tutor UI/runtime parity

## 13. Whiteboard Layer

Status: `Missing`

What is missing:
- whiteboard canvas/UI
- whiteboard action execution
- whiteboard state synchronization

Why this matters:
- whiteboard is a distinct OpenMAIC runtime layer
- current frontend/backend only reserve space conceptually

## 14. Production Persistence Architecture

Status: `Missing`

Current state:
- file-backed persistence is working

What is still needed for production:
- PostgreSQL or equivalent durable relational storage
- object storage for media/audio assets
- migrations
- backup strategy
- operational data model

## 15. Background Jobs / Queue Strategy

Status: `In Progress`

What exists:
- explicit async generation route
- persisted queued job record
- file-backed queued request persistence
- worker loop that scans and processes queued work on startup/runtime
- dedicated `queue_worker` binary for separate worker-process execution
- background execution that updates the same job id returned by the API
- retry metadata and delayed requeue behavior for transient worker failures
- terminal-failure handling for non-retryable worker failures
- stale `.working` queue file reclamation after worker interruption

What is still needed:
- cancellation/resume policy
- safer concurrency model for production load
- stronger production queue backend beyond local files

## 16. Observability and Operations

Status: `Missing`

What is still needed:
- structured logs across service boundaries
- tracing across generation steps
- metrics
- alerts
- cost tracking for model/provider usage

## 17. Security and Multi-Tenant Readiness

Status: `Missing`

What is still needed:
- auth integration
- user/session binding
- quota/rate limiting
- secrets handling hardening
- tenant-safe boundaries if integrated into Schools24

## 18. Frontend Build and Workspace Health

Status: `Done`

Evidence:
- [apps/web/package.json](d:/uc-school/AI-Tutor-Frontend/apps/web/package.json)
- [next.config.ts](d:/uc-school/AI-Tutor-Frontend/apps/web/next.config.ts)
- [packages/ui/package.json](d:/uc-school/AI-Tutor-Frontend/packages/ui/package.json)
- [packages/types/package.json](d:/uc-school/AI-Tutor-Frontend/packages/types/package.json)

Verified commands:
- `pnpm --filter ai-tutor-web build`
- `pnpm --filter ai-tutor-web exec tsc -p tsconfig.json --noEmit`

## Production Translation Verdict

### Done
- typed architecture foundation
- provider/model resolution layer
- file-backed persistence parity
- basic frontend/backend contract flow
- basic API surface
- basic frontend lesson flow

### In Progress
- LLM-backed generation pipeline
- backend API maturity
- frontend player runtime shell

### Missing
- live tutor orchestration parity
- media/TTS/ASR parity
- whiteboard parity
- production data/storage architecture
- observability
- security
- queue/background execution

## Final Readiness Call

Is the OpenMAIC to AI-Tutor architecture translation project complete?

- `Translation foundation`: Yes
- `Partial working vertical slice`: Yes
- `Production-complete architecture translation`: No

The project becomes production-complete only when the `Missing` layers above are moved to a
