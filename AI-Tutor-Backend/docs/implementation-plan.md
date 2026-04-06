# AI-Tutor-Backend Implementation Plan

## Goal

Build a Rust-native backend that preserves the core OpenMAIC backend architecture:

- outline generation
- scene content generation
- action generation
- lesson/job orchestration
- provider abstraction
- SSE/live tutor orchestration
- media and TTS post-processing
- persistence

This plan is backend-first. Frontend implementation should consume the contracts produced here rather than inventing its own.

## Source Architecture Used

OpenMAIC backend analysis:
- [openmaic-backend-layer-analysis.md](d:/uc-school/memory/openmaic-backend-layer-analysis.md)

Current Rust workspace:
- [AI-Tutor-Backend](d:/uc-school/AI-Tutor-Backend)

## Translation Principles

1. Translate architecture, not framework files
2. Keep domain contracts explicit and typed
3. Preserve the generation phase ordering
4. Preserve graph/state-machine orchestration semantics
5. Start with parity-friendly persistence before deep optimization
6. No fake feature claims during the buildout

## Target Backend Layers

### 1. `domain`

Owns:
- lesson request types
- job types
- scene outline types
- scene content enums
- action enums
- runtime session types
- provider request/response contracts

Deliverables:
- complete Rust structs/enums for all major OpenMAIC concepts
- serde-compatible API DTOs
- validation helpers

### 2. `providers`

Owns:
- provider traits
- model/provider registry
- capability metadata
- API key and base URL resolution
- concrete provider clients

Deliverables:
- `LlmProvider`
- `TtsProvider`
- `AsrProvider`
- `ImageProvider`
- `VideoProvider`
- `SearchProvider`
- provider resolver/registry

### 3. `orchestrator`

Owns:
- lesson generation state
- graph/node execution
- step transitions
- retries and progress
- checkpoint/resume contracts

Deliverables:
- `GenerationState`
- node trait/runner
- initial graph execution engine
- first lesson pipeline flow

### 4. `storage`

Owns:
- lesson persistence
- job persistence
- atomic writes / repositories
- future DB adapters

Deliverables:
- file-backed repositories for parity
- clean repository traits
- future PostgreSQL/object storage seam

### 5. `media`

Owns:
- media generation task lifecycle
- placeholder replacement
- TTS post-processing integration

Deliverables:
- media task model
- scene placeholder replacement pass
- speech-action audio enrichment pass

### 6. `runtime`

Owns:
- tutor playback session state
- live discussion/tutor session state
- event sequencing contract for frontend

Deliverables:
- runtime session types
- event schema for scene/action streaming
- playback cursor model

### 7. `api`

Owns:
- HTTP routes
- SSE streaming
- request validation
- mapping requests to orchestrator/runtime/storage

Deliverables:
- health route
- lesson generation routes
- job status routes
- lesson retrieval routes
- chat/tutor streaming routes

## Phased Implementation Plan

## Phase 1: Domain Completion

Target:
- fully define the Rust domain model for parity with OpenMAIC’s backend contracts

Build:
- `LessonRequest`
- `LessonGenerationJob`
- `SceneOutline`
- `Scene`
- `SceneContent`
- `LessonAction`
- `GeneratedMediaRequest`
- `RuntimeSession`

Why first:
- every later layer depends on stable domain types

Verification:
- `cargo check`
- serialization tests for key models

## Phase 2: Provider Abstraction

Target:
- model the provider layer independently of orchestration

Build:
- provider traits
- model string parsing
- registry/capability metadata
- env/config resolution module
- first LLM provider adapter

Why second:
- generation pipeline depends on unified provider calls

Verification:
- unit tests for model/provider resolution
- config parsing tests

Current progress:
- provider traits exist
- built-in provider registry added
- model string parsing added
- env-based server provider resolution added
- first outbound LLM client added for OpenAI-compatible providers
- provider factory added for concrete LLM client construction

## Phase 3: File-Backed Job and Lesson Storage

Target:
- parity-friendly persistence similar to OpenMAIC’s current storage style

Build:
- job repository
- lesson repository
- atomic write helpers
- stale job detection

Why now:
- orchestrator needs progress and result persistence

Verification:
- repository tests
- file write/read/update tests

Current progress:
- file-backed lesson repository added
- file-backed job repository added
- atomic JSON write helper added
- stale running job detection added on read
- storage crate verified with repository tests

## Phase 4: Lesson Generation Orchestrator

Target:
- build the backend generation pipeline without media/TTS first

Build:
- generation state model
- node runner
- initial nodes:
  - normalize_request
  - optional_research
  - generate_outlines
  - generate_scene_content
  - generate_scene_actions
  - assemble_lesson
  - persist_lesson

Why now:
- this is the core backend value chain

Verification:
- unit tests for node transitions
- integration-style tests for end-to-end orchestration with a provider test double

Current progress:
- sequential orchestration graph primitive added
- generation state expanded to carry request, job, stage, outlines, and scenes
- backend pipeline skeleton added:
  - initialize job
  - generate outlines
  - generate scene content
  - generate scene actions
  - assemble lesson
  - persist lesson
  - finalize job result
- orchestrator verified with an end-to-end test double
- provider-backed generation adapter added for:
  - outline generation
  - slide content generation
  - quiz content generation
  - scene action generation
- generation adapter can now emit `media_generations` requests from outlines when media is enabled
- slide generation now binds media placeholders into slide elements so post-generation enrichment can replace them
- generation adapter now injects fallback image requests for slide scenes when media is enabled but the model omits them
- slide generation now repairs empty image placeholders by binding them to generated media ids
- generation adapter now repairs noisy/fenced JSON responses before parsing
- deterministic fallback outlines, slide content, quiz content, and narration are now used when model output is malformed or empty
- generation adapter now retries transient LLM/provider failures before falling back to repaired or deterministic generation output
- non-retryable provider/configuration failures still surface immediately instead of being masked
- generation adapter verified with typed parsing tests

## Phase 5: Media and TTS Post-Processing

Target:
- add post-generation enrichment after scenes exist

Build:
- image/video generation pipeline
- media placeholder replacement
- TTS speech-action enrichment

Why after orchestration:
- scenes must exist before placeholder replacement and TTS assignment

Verification:
- media task tests
- speech action enrichment tests

Current progress:
- media task model added
- media task collection from scene outlines added
- placeholder replacement pass added for slide image/video/background sources
- first OpenAI-compatible image provider path added
- first OpenAI-compatible video provider path added
- orchestrator can now run image enrichment for outline-declared media requests
- orchestrator can now run video enrichment for outline-declared media requests
- generated inline media assets can now be persisted into backend asset storage
- TTS task model added
- TTS task collection from speech actions added
- speech-action audio enrichment pass added
- first OpenAI-compatible TTS provider path added
- orchestrator can now run post-generation TTS enrichment when `enable_tts` is true
- generated inline TTS audio can now be persisted into backend asset storage
- API layer now wires TTS provider construction and asset storage into lesson generation
- API route now serves persisted teacher-audio assets from `/api/assets/audio/:lesson_id/:file_name`
- media crate verified with task/replacement tests

## Phase 6: HTTP API Layer

Target:
- expose backend capabilities to frontend clients

Build:
- `POST /api/lessons/generate`
- `GET /api/lessons/jobs/:id`
- `GET /api/lessons/:id`
- `GET /api/health`

Then:
- SSE route for tutor chat/session streaming

Verification:
- route tests
- request validation tests

Current progress:
- `api` crate now exposes:
  - `GET /health`
  - `GET /api/health`
  - `POST /api/lessons/generate`
  - `POST /api/lessons/generate-async`
  - `POST /api/runtime/chat/stream`
  - `GET /api/lessons/jobs/:id`
  - `GET /api/lessons/:id`
  - `GET /api/lessons/:id/events`
  - `GET /api/assets/media/:lesson_id/:file_name`
  - `GET /api/assets/audio/:lesson_id/:file_name`
- API routes are wired to:
  - env-based model resolution
  - provider factory
  - file-backed storage
  - lesson generation orchestrator
  - persisted media asset serving
  - persisted TTS asset serving
- request validation and JSON error responses are in place
- API handlers now sit behind an application service seam
- router-level tests cover:
  - health response
  - lesson generation response shape
  - job retrieval
  - lesson retrieval
  - media asset retrieval
  - audio asset retrieval
- live-service router tests now verify file-backed lesson/job retrieval and persisted asset serving through `LiveLessonAppService`
- live-service API tests now verify end-to-end generation, persistence, and retrieval when provider test seams are injected
- API tests now also verify invalid generate requests, missing-asset 404s, and stale-job failure projection through the live service path
- async generation route now persists a queued request to a file-backed queue, and background worker processing is covered by polling-based API tests
- queue processing logic is now shared through the `api` crate library and a dedicated `queue_worker` binary exists for separate worker-process execution
- queue tests now verify persisted queue-file recovery and removal after successful processing
- queue entries now carry retry metadata and delayed requeue state
- transient queue failures are now retried with backoff instead of failing immediately
- non-retryable queue failures now remain terminal and are surfaced back into persisted job state
- stale `.working` queue files can now be reclaimed and resumed after worker crashes/restarts
- first SSE playback stream now exists for persisted lessons, emitting session/scene/action events from stored lesson structure
- first stateless tutor SSE stream now exists for live chat turns, emitting session/agent/text/done events
- stateless tutor streaming now includes a first director-style agent selector that:
  - honors the trigger agent on the opening turn
  - rotates away from the most recent speaker when alternatives exist
  - prefers scene-bound agents for the active stage
  - uses role diversity, topic hints, and priority to pick the responding agent
- director-style selector behavior is now covered by API crate tests
- stateless tutor streaming now runs a first multi-turn discussion loop:
  - discussion mode can route up to two tutor turns in one SSE session
  - returned `director_state` now accumulates multiple agent responses from one streamed session
- multi-turn discussion-loop behavior is now covered by API crate tests

## Phase 7: Live Tutor / Stateless Chat Orchestration

Target:
- preserve the OpenMAIC-style SSE turn orchestration path

Build:
- stateless turn request contract
- orchestration state per turn
- event streaming schema
- Rust-native graph-like director flow

Why later:
- build static lesson generation first, then the interactive runtime layer

Verification:
- SSE event tests
- orchestration parser/stream tests

Current progress:
- runtime event contracts now exist in `ai_tutor_runtime`
- API exposes a first SSE lesson-playback stream backed by persisted lessons
- SSE route currently streams session/scene/action envelopes from stored lesson data
- API now also exposes a first stateless tutor SSE route backed by provider-generated text chunks
- the stateless tutor route now has a first director-style agent selection layer instead of always defaulting to the trigger or first configured agent
- the stateless tutor route now also supports a first multi-turn director loop for discussion sessions

Still missing:
- richer live tutor turn generation
- full director-agent orchestration loop
- interruption/resume semantics
- per-turn LLM-driven streaming behavior beyond the current chunked single-response stream

## Backend MVP Definition

The backend MVP is complete when it can:

1. accept a tutor lesson request
2. generate outlines
3. generate scenes
4. generate actions
5. persist the result
6. return lesson/job state via API

The live tutor graph/SSE layer is phase 2 of backend implementation, not day 1.

## Immediate Next Coding Task

Implement the next backend slice:
- extend fallback repair beyond first-pass image support and start the video provider path
- move from file-backed queueing to a stronger production queue backend and worker policy
- deepen provider-aware retry/fallback behavior closer to OpenMAIC
