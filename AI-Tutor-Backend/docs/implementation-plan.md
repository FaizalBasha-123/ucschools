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
- server-side provider config now also recognizes OpenAI-compatible env aliases for `groq`, `grok`/`xai`, and `openrouter`, so those providers can be wired into the existing resolver/factory path without custom frontend translation

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
- outline generation now accepts richer OpenMAIC-style metadata (`teaching_objective`, `estimated_duration`, `suggested_image_ids`, `quiz_config`, `interactive_config`, `project_config`) and normalizes those fields into typed Rust scene outlines instead of discarding them
- slide generation now uses a stronger OpenMAIC-inspired visual contract with richer element support (`chart`, `latex`, `shape`, `line`, `table`, `video`) plus layout/title repair after model output
- scene action generation now accepts OpenMAIC-style interleaved structured arrays for slide/quiz/interactive/PBL scenes while preserving compatibility with the legacy `{ "actions": [...] }` envelope
- interactive scene generation now uses a deeper two-step OpenMAIC-style path: generate a scientific model first, then generate constrained HTML using those formulas/mechanisms/constraints
- project/PBL scene generation now preserves a richer structured project plan (`driving_question`, `final_deliverable`, `target_skills`, `milestones`, `team_roles`, `assessment_focus`, `starter_prompt`) instead of flattening the model output into a short summary only
- live tutor graph now streams against history-aware provider messages instead of only a flattened prompt string
- provider contract now supports `generate_text_stream_with_history(...)`
- OpenAI-compatible, Anthropic, and Google providers now implement history-aware native streaming
- resilient provider now preserves retry/failover semantics for history-aware streaming
- the Rust response parser now supports first-pass incremental parsing of streamed structured text/action items
- the GraphBit-style tutor runtime now uses that streamed structured parser instead of waiting only for final whole-response parsing
- the tutor SSE route now streams live runtime events through the API path instead of collecting a full `Vec<TutorStreamEvent>` before sending
- tutor runtime now emits explicit `action_started` / `action_completed` lifecycle events with structured action payloads
- tutor SSE route now transports those structured runtime action events end to end
- lesson playback events now carry structured `action_payload` data so playback and live runtime can share one execution surface
- runtime action events now also carry backend-owned execution metadata describing whether an action belongs to audio, discussion, slide overlay, video, or whiteboard execution
- lesson playback events now include backend-derived whiteboard snapshots produced from ordered whiteboard action application in the runtime layer
- live tutor graph events now also carry backend-derived whiteboard snapshots, initialized from prior whiteboard ledger state and updated as streamed `wb_*` actions execute
- the tutor SSE route now forwards those live whiteboard snapshots to the client instead of only exposing whiteboard state on playback events
- generation adapter now retries transient LLM/provider failures before falling back to repaired or deterministic generation output
- non-retryable provider/configuration failures still surface immediately instead of being masked
- generation adapter verified with typed parsing tests
- outline generation now accepts richer OpenMAIC-style metadata (`teaching_objective`, `estimated_duration`, `suggested_image_ids`, `quiz_config`, `interactive_config`, `project_config`) and normalizes those fields into typed Rust scene outlines instead of discarding them
- slide generation now uses a stricter OpenMAIC-style visual contract: concise on-slide text, richer element kinds (`chart`, `latex`, `shape`, `line`, `table`, `video`), and post-generation layout repair that enforces positive dimensions, bounded placement, and title presence
- offline scene action generation now accepts interleaved OpenMAIC-style structured arrays (`text` + typed `action` items) while preserving backward compatibility with the older `{ "actions": [...] }` envelope
- slide, quiz, interactive, and PBL action prompts are now scene-type-specific instead of sharing one thin generic action planner prompt, improving narration/action pacing and reducing invalid tool choices

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
- lesson persistence can now also be switched to SQLite with `AI_TUTOR_LESSON_DB_PATH`, while preserving the existing file-backed lesson path for compatibility and tests
- lesson job persistence can now also be switched to SQLite with `AI_TUTOR_JOB_DB_PATH`, while preserving the existing file-backed job path for compatibility and tests
- async lesson queueing can now also be switched to SQLite with `AI_TUTOR_QUEUE_DB_PATH`, while preserving the existing file-backed queue path for compatibility and tests
- transient queue failures are now retried with backoff instead of failing immediately
- non-retryable queue failures now remain terminal and are surfaced back into persisted job state
- stale `.working` queue files can now be reclaimed and resumed after worker crashes/restarts
- queued async lesson jobs can now be cancelled through `POST /api/lessons/jobs/{id}/cancel`, and cancelled job state is persisted for both file-backed and SQLite-backed queue modes
- cancelled or failed async lesson jobs can now also be resumed through `POST /api/lessons/jobs/{id}/resume`, backed by persisted queued-request snapshots so the original async request can be requeued without the client resubmitting it
- first SSE playback stream now exists for persisted lessons, emitting session/scene/action events from stored lesson structure
- first stateless tutor SSE stream now exists for live chat turns, emitting session/agent/text/done events
- `/api/system/status` now exposes runtime observability for current model, queue backend, lesson backend, job backend, runtime-session backend, pending queue depth, and provider circuit-breaker/runtime health
- `/api/system/status` now also reports supported runtime-session modes so operators can verify whether the backend is running client-owned state only or explicit managed-session mode support
- `/api/system/status` now also exposes runtime native-typed-streaming policy plus per-provider capability-style fields (`native_typed_streaming`, `compatibility_streaming`, `cooperative_cancellation`) so degraded runtime mode is visible directly
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
- the provider layer now builds a real server-configured LLM failover chain instead of always wrapping a single provider
- OpenAI-compatible, Anthropic, and Google text providers are now wired into the Rust backend for LLM generation
- the resilient provider now tracks per-provider failure health and opens a cooldown-based circuit breaker before retrying the same unhealthy provider again
- server env/config now supports explicit provider priority ordering for failover (`AI_TUTOR_LLM_PROVIDER_PRIORITY`)
- the GraphBit-style chat graph now consumes provider runtime health from the resilient LLM layer
- director prompts now include provider runtime health, mirroring OpenMAIC's habit of routing with current runtime context instead of static agent config alone
- degraded provider health now shortens discussion turn budgets and biases the fallback selector toward teacher-led routing
- the LLM provider trait now exposes a graph-level streaming seam (`generate_text_stream`) so the runtime no longer depends directly on full-response generation calls
- the chat graph now consumes streamed deltas through that seam, matching OpenMAIC's adapter-first streaming architecture more closely
- the stateless tutor stream now carries structured action lifecycle events instead of collapsing runtime actions into one generic payload type
- `director_state` now also carries a persisted backend-owned whiteboard snapshot, so seeded live tutor sessions can resume from backend whiteboard state instead of relying only on action-ledger replay
- live tutor execution now has an explicit runtime-session mode split:
  - `stateless_client_state` keeps `director_state` client-owned in the runtime path (OpenMAIC-style request/response state transfer), with no backend persistence
  - `managed_runtime_session` loads/saves `director_state` through the runtime-session repository using explicit API contract fields instead of implicit `session_id` behavior
- invalid runtime-session combinations now fail at the API boundary instead of silently mixing client-owned and backend-owned state
- downstream SSE disconnects now cancel the graph/provider path cooperatively even when no further model events have been emitted yet, and the service only falls back to task abort if cooperative shutdown stalls
- the compatibility streaming fallback path now respects cancellation before full non-streaming generation completes
- streamed parser finalization now preserves ordered text/action emission and avoids replaying already-emitted partial text or duplicate actions when typed provider tool events and parsed JSON overlap
- interrupted runtime turns now emit explicit `interrupted` tutor events with the last safe `director_state` / whiteboard boundary, so managed-session persistence can save resume-safe state instead of treating cancellation as an opaque failure
- action lifecycle tutor events now also carry stable `execution_id` values plus an explicit ack policy (`no_ack_required`, `ack_optional`, `ack_required`), and the API now exposes `POST /api/runtime/actions/ack` so frontend execution outcomes are reported back to the backend
- runtime action execution records are now persisted through the storage repository layer for both file-backed and SQLite runtime storage, so ack-required actions survive beyond transient process memory
- backend ack handling now expires stale pending/accepted actions by timeout, enforces monotonic status transitions, and rejects replayed terminal acknowledgements deterministically
- the frontend lesson player now sends `stateless_client_state` explicitly on live tutor requests and acknowledges runtime action execution outcomes after action application
- lesson generation now degrades TTS per action instead of failing the whole lesson for one synthesis error, and media/audio asset persistence failures now keep inline/fallback assets in place while surfacing degraded job messages
- provider runtime status now carries explicit capability metadata (`native_text_streaming`, `native_typed_streaming`, `compatibility_streaming`, `cooperative_cancellation`) instead of inferring typed-stream support only from the active streaming path, and `/api/system/status` reflects those explicit capabilities
- server provider config now supports explicit per-provider transport capability overrides (`*_NATIVE_TEXT_STREAMING`, `*_NATIVE_TYPED_STREAMING`, `*_COMPATIBILITY_STREAMING`, `*_COOPERATIVE_CANCELLATION`) so broader OpenAI-compatible providers can be represented honestly even before a bespoke native adapter exists
- file-backed runtime action execution persistence now uses path-safe stable keys instead of raw `execution_id` filenames, fixing Windows-invalid path failures in the durable execution store
- runtime action execution persistence now uses a stable `runtime_session_id` coordination boundary, so managed runtime-session action acknowledgements survive transport-session changes
- managed runtime-session resume now fails fast when unresolved ack-required action executions still exist, preventing side-effect replay across interrupted/resumed turns
- provider-aware live routing is now broader than a simple healthy/degraded split: compatibility-only streaming, missing native typed streaming, and high-latency providers all trigger conservative-turn behavior and teacher-biased fallback selection
- the frontend live tutor runtime now acknowledges actions against `runtime_session_id` and resets runtime surfaces on interruption events, tightening end-to-end interruption/action coordination
- live tutor prompting is now more scene-aware: the runtime prompt builder injects scene-specific teaching guidance for slide, quiz, interactive, and project stages so the tutor turn planner is less generic and closer to OpenMAIC's scene-conditioned behavior
- live tutor prompting now also carries an explicit turn-plan block derived from scene type, learner confusion cues, and recent agent history, so the responding agent gets a clearer OpenMAIC-style teaching objective instead of only generic role instructions
- provider-native OpenAI-compatible streaming/event coverage is now broader within the existing adapter family: message-level tool calls, non-string tool arguments, and `output_text`-style content arrays are normalized into the same runtime event stream used by the chat graph
- interactive generation now includes a repair/post-process loop: HTML is post-processed for viewport/title/instructions and, when needed, a second repair pass is requested to add missing controls or feedback behavior
- the scientific-model pass now preserves richer OpenMAIC-style planning fields (`experiment_steps`, `observation_prompts`) so interactive generation and live tutoring can reference experiment flow instead of only static formulas/mechanisms
- PBL/project generation now goes beyond one structured blob: after the main project brief, the pipeline generates a collaboration plan (`agent_roles`, `success_criteria`, `facilitator_notes`) plus an issue-board style work breakdown (`issue_board`) before synthesizing the final project scene
- `/api/system/status` now reports the selected model's operator-facing profile, including provider/model identity, context/output window, tool/vision/thinking support, and a registry-backed cost tier so routing/ops can distinguish economy vs balanced vs premium models
- resilient provider telemetry now estimates input/output token volume per provider label and tracks estimated cost (`estimated_total_cost_microusd`) using model pricing metadata or env pricing overrides when available
- `/api/system/status` now aggregates provider-side cost telemetry (`provider_estimated_input_tokens`, `provider_estimated_output_tokens`, `provider_estimated_total_cost_microusd`) so operators can see runtime spend trends, not only health and latency counters
- provider config now supports explicit pricing overrides (`*_INPUT_COST_PER_1M_USD`, `*_OUTPUT_COST_PER_1M_USD`) so OpenAI-compatible providers without baked-in model pricing can still participate in cost accounting
- resilient/provider telemetry now also records provider-reported usage tokens where provider transports expose usage metadata (OpenAI-compatible, Anthropic, Google), and `/api/system/status` now exposes aggregated provider-reported counters (`provider_reported_input_tokens`, `provider_reported_output_tokens`, `provider_reported_total_tokens`, `provider_reported_total_cost_microusd`)
- OpenAI-compatible native stream parsing now also handles responses-style SSE envelopes (`response.output_text.delta`, `response.function_call_arguments.*`, `response.completed`) in addition to chat-completions deltas, with typed-tool + usage extraction on both paths
- interactive scientific-model generation now includes a critique-and-revision pass: sparse first-draft models are revised before HTML generation and merged to preserve stronger constraints/experiment guidance
- PBL project-plan generation now includes a critique-and-revision pass on the core project brief before role-plan and issue-board synthesis, improving driving-question/deliverable/milestone completeness

Still missing:
- richer live tutor turn generation beyond the current scene-aware prompting + turn-plan upgrade
- provider-native token/event streaming coverage beyond the current OpenAI-compatible/Anthropic/Google families and variants already normalized by the Rust adapters
- deeper provider-aware live routing policies beyond the current degraded/compatibility/high-latency/typed-capability-aware policy
- deeper OpenMAIC parity for scientific interactive generation and full PBL planning depth beyond the current repaired scientific-model flow and multi-pass structured-project generator
- provider-billed cost truth (token accounting is now provider-reported when transports expose usage, but USD still comes from configured model pricing rather than billing/invoice APIs)

## Backend MVP Definition

The backend MVP is complete when it can:

1. accept a tutor lesson request
2. generate outlines
3. generate scenes
4. generate actions
5. persist the result
6. return lesson/job state via API

The live tutor graph/SSE layer is phase 2 of backend implementation, not day 1.

## Immediate Remaining Gaps

The main remaining backend gaps after the verified runtime/session/streaming work are:
- deepen live tutor response quality and turn-planning beyond the current first-pass director+tutor prompt translation, scene-aware teaching context, and explicit turn-plan guidance
- expand provider-native streaming/event coverage beyond the current OpenAI-compatible, Anthropic, and Google implementations already normalized by the Rust adapters
- add richer provider-aware routing policy than the current degraded/compatibility/high-latency/typed-capability-aware policy
- continue closing whiteboard/action-engine parity so more runtime behavior is backend-owned instead of frontend-light
- continue closing generation-smartness parity with OpenMAIC for deeper scientific interactives, fuller agentic project-design loops, and more expressive slide layout grammars
