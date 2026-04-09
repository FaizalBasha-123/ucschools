# OpenMAIC Gap Closure Task Plan

## Purpose

This file converts the remaining `OpenMAIC` → `AI-Tutor` smartness/performance gaps into executable tasks.

It is intentionally stricter than the general roadmap:

- each track is broken into work items
- each work item should end in code + verification
- no task should be marked done until the repo state matches the claim

## Honest Baseline

Already present:
- native provider streaming exists for OpenAI-compatible, Anthropic, and Google providers
- structured response parsing exists in Rust
- GraphBit-style live tutor runtime exists
- ZeroClaw-style failover/circuit breaking exists

Still not at parity:
- streamed action execution is more durable now, but still thinner than OpenMAIC's full action engine
- whiteboard execution is still frontend-light compared with OpenMAIC's action engine
- persistence/queueing now have file + SQLite support, but broader operational depth is still behind OpenMAIC

## Track 1: Streaming-First Runtime

Goal:
- make live tutor/runtime flow truly streaming-first like OpenMAIC's adapter path

Tasks:
- `T1.1` Add history-aware streaming to the Rust `LlmProvider` contract
- `T1.2` Implement provider-native `generate_text_stream_with_history(...)` for:
  - OpenAI-compatible
  - Anthropic
  - Google
- `T1.3` Implement resilient-provider pass-through for history-aware streaming with retry/failover semantics
- `T1.4` Update the GraphBit chat graph to stream against structured history instead of only flattened prompt text
- `T1.5` Add runtime tests covering streamed history flow

Verification:
- `cargo test -p ai_tutor_providers`
- `cargo test -p ai_tutor_orchestrator`
- `cargo test -p ai_tutor_api`

Status:
- `T1.1` completed
- `T1.2` completed
- `T1.3` completed
- `T1.4` completed
- `T1.5` completed

## Track 2: Structured Streamed Actions

Goal:
- match OpenMAIC's interleaved streaming of text and actions more closely

Tasks:
- `T2.1` extend runtime events for streamed action lifecycle
- `T2.2` parse interleaved streamed action/text output during live tutor generation
- `T2.3` emit whiteboard/spotlight/video actions directly from the streamed graph path
- `T2.4` add frontend handling for streamed runtime actions instead of post-hoc action shells
- `T2.5` add integration tests for streamed action transport
- `T2.6` harden parser parity for trailing partial text chunks from unclosed streamed JSON items

Status:
- `T2.1` completed
- `T2.2` completed
- `T2.3` completed
- `T2.4` completed
- `T2.5` completed
- `T2.6` completed

Current note:
- the Rust runtime now incrementally parses complete streamed text/action items
- the parser now also streams trailing partial text deltas from unclosed `{"type":"text","content":"..."}` items, matching OpenMAIC `parseStructuredChunk` intent more closely
- the live tutor SSE route now forwards tutor events as they are produced instead of buffering the full session first
- the GraphBit tutor node now emits `text_delta` and `action_started` / `action_completed` during in-flight chunk parsing (not only after full generation), closer to OpenMAIC's `streamLLM` event cadence
- tutor runtime now emits `action_started` / `action_completed` with structured payloads
- the frontend lesson player now reacts to streamed whiteboard / spotlight / video actions during discussion sessions

## Track 3: Shared Action Execution Layer

Goal:
- create an OpenMAIC-style shared action execution contract for playback and live runtime

Tasks:
- `T3.1` define backend action-execution lifecycle events
- `T3.2` centralize frontend execution policy behind one runtime controller
- `T3.3` route whiteboard/audio/video/spotlight/laser through the same execution surface
- `T3.4` add backend-owned whiteboard event semantics

Status:
- `T3.1` completed
- `T3.2` completed
- `T3.3` completed
- `T3.4` in_progress

Current note:
- playback SSE events now carry structured `action_payload` data from the backend
- backend now tags action events with execution metadata (`audio`, `discussion`, `slide_overlay`, `video`, `whiteboard`)
- live tutor action events now also carry stable `execution_id` values plus an explicit acknowledgement policy so frontend/runtime side effects no longer have to be treated as implicitly successful
- frontend lesson playback and live tutor discussion now share one runtime action executor hook for whiteboard, spotlight, laser, and play-video actions
- speech/teacher-audio actions now also run through that same runtime executor path, so manual and guided narration playback no longer depend on a separate ad hoc audio token branch
- backend playback events now also carry whiteboard snapshots derived from ordered whiteboard action application, and the frontend whiteboard hook can hydrate from those snapshots
- live tutor graph events now also carry backend-derived whiteboard snapshots, seeded from prior whiteboard ledger state and updated as streamed `wb_*` actions execute
- tutor SSE now forwards those live whiteboard snapshots end to end, so runtime whiteboard state is no longer playback-only
- backend whiteboard state reconstruction is now ledger-first when ledger exists (snapshot fallback only when ledger is empty), preventing stale snapshot drift during session resume
- whiteboard draw/annotate object application is now idempotent by object id (upsert semantics), reducing duplicate-object drift during replay/retry paths
- the frontend now reports runtime action acknowledgements back through `POST /api/runtime/actions/ack`
- backend runtime action execution state is now persisted through the storage repository layer (file or SQLite via `AI_TUTOR_RUNTIME_DB_PATH`), with durable `pending` → `accepted` / `completed` / `failed` / `timed_out` transitions
- runtime action acknowledgements now enforce monotonic state transitions, expire stale pending/accepted executions by timeout, and suppress replayed terminal acknowledgements deterministically
- runtime action acknowledgements now also use a stable `runtime_session_id` coordination key, so managed runtime sessions do not lose action state across transport-session boundaries
- managed runtime-session resume is now blocked while ack-required action executions remain `pending` / `accepted`, preventing replay across unresolved side effects
- the frontend now acknowledges action execution against `runtime_session_id` when available and clears runtime surfaces on interruption boundaries
- file-backed runtime action execution records now use path-safe stable keys instead of raw `execution_id` filenames, avoiding Windows-invalid path failures for execution ids such as `session:action:{...}`

## Track 4: Whiteboard Parity

Goal:
- move from whiteboard shell to real execution parity

Tasks:
- `T4.1` persist whiteboard document state as runtime data
- `T4.2` add ordered whiteboard action application semantics
- `T4.3` align frontend whiteboard rendering with persisted/runtime state
- `T4.4` add playback/runtime synchronization tests
- `T4.5` add an explicit server-side runtime-session gateway (opt-in) so stateless chat can choose DB-backed resume without breaking client-owned state mode

Current note:
- `director_state` now also carries a persisted backend-owned whiteboard snapshot, not just a whiteboard action ledger
- seeded live tutor sessions can resume from that persisted whiteboard snapshot across turns
- live runtime now has an explicit session-mode split:
  - `stateless_client_state`: request/response owns `director_state`, backend does not persist runtime state
  - `managed_runtime_session`: backend loads/saves `director_state` through the runtime-session repository, using explicit `runtime_session.mode` + `runtime_session.session_id`
- invalid or ambiguous runtime-session combinations now fail clearly instead of silently mixing client-owned and backend-owned state
- runtime-session repositories (file + SQLite via `AI_TUTOR_RUNTIME_DB_PATH`) are now wired into the live tutor path only for `managed_runtime_session`

## Track 5: Production Runtime Foundation

Goal:
- replace parity scaffolding with production-grade storage/job foundations

Tasks:
- `T5.1` move jobs from local file queue to durable DB-backed queue
- `T5.2` move runtime sessions from local JSON files to DB persistence
- `T5.3` move media/audio assets to object storage
- `T5.4` add worker-safe concurrency control and cancellation/resume
- `T5.5` add observability around generation/runtime/provider health

Current note:
- lessons can now also be persisted in SQLite via `AI_TUTOR_LESSON_DB_PATH`, so lesson retrieval no longer has to depend only on per-lesson JSON files
- runtime sessions can now be persisted either as JSON files or in SQLite via `AI_TUTOR_RUNTIME_DB_PATH`
- lesson job state can now also be persisted in SQLite via `AI_TUTOR_JOB_DB_PATH`, so queued/running/cancelled/resumed job metadata no longer has to live only in per-job JSON files
- async lesson queue entries can now also be persisted in SQLite via `AI_TUTOR_QUEUE_DB_PATH`, while keeping the existing file-backed queue path available for compatibility
- queued async lesson jobs can now be cancelled through `POST /api/lessons/jobs/{id}/cancel`, with persisted `Cancelled` job status written back to storage for both file-backed and SQLite-backed queue modes
- cancelled or failed async lesson jobs can now also be resumed through `POST /api/lessons/jobs/{id}/resume`, using a persisted queued-request snapshot so the backend can requeue the original request instead of requiring the client to resend it
- the backend now also exposes `/api/system/status`, which reports queue backend, lesson backend, job backend, runtime-session backend, queue depth, and provider runtime/circuit-breaker state as a first observability surface
- provider runtime observability now also reports per-provider streaming path (`native` vs `compatibility`) so runtime status can prove whether true provider streaming is in effect
- live stateless tutor streaming now detects downstream SSE disconnects directly, cancels the in-flight graph/provider path cooperatively, and only falls back to task abort if the graph does not stop promptly
- provider-layer cooperative streaming cancellation is now threaded end to end (API -> graph -> resilient provider -> concrete provider stream loops), including the compatibility streaming fallback path, giving the Rust path an OpenMAIC-style abort-signal equivalent for in-flight streaming
- runtime observability now also exposes supported runtime-session modes through `/api/system/status`, alongside queue/runtime/provider health
- interrupted runtime turns now surface as explicit `interrupted` events with resumable `director_state` boundaries instead of only bubbling cancellation as an opaque error path
- `/api/system/status` now also exposes runtime native-typed-streaming policy and per-provider capability fields (`native_text_streaming`, `native_typed_streaming`, `compatibility_streaming`, `cooperative_cancellation`) backed by explicit provider capability metadata rather than inferring typed support from the active streaming path alone
- server provider config now also supports per-provider transport-capability overrides via env so broader OpenAI-compatible providers can be surfaced honestly in runtime status before bespoke native adapters are added
- provider-aware live routing now also treats compatibility-only streaming, missing native typed streaming, and high-latency providers as conservative-turn conditions instead of relying only on a binary healthy/degraded split
- outline generation now keeps richer OpenMAIC-style scene metadata instead of flattening everything to title/description/key points only
- slide generation now follows a stronger OpenMAIC-inspired visual contract with richer element kinds plus layout/title repair after model output
- offline action generation now accepts OpenMAIC-style interleaved structured arrays for slide/quiz/interactive/PBL scenes while preserving compatibility with the older legacy action envelope
- interactive generation now follows a closer OpenMAIC-style two-step path by generating a scientific model first and then generating constrained HTML against that model
- PBL/project generation now preserves richer structured planning fields (`driving_question`, `final_deliverable`, `target_skills`, `milestones`, `team_roles`, `assessment_focus`, `starter_prompt`) instead of collapsing to a short summary
- live tutor prompting now injects scene-specific teaching context for slide, quiz, interactive, and project stages so turn generation is less generic
- provider env/config resolution now also supports OpenAI-compatible aliases for `groq`, `grok`/`xai`, and `openrouter` within the existing backend provider registry flow
- OpenAI-compatible provider event parsing now also normalizes message-level tool calls, non-string tool arguments, and `output_text`-style content arrays into the same native runtime event stream
- live tutor prompting now includes an explicit turn-plan block derived from scene type, learner confusion cues, and recent agent history, so the runtime gives the selected agent a clearer teaching objective
- interactive generation now runs a repair/post-process loop when the first HTML draft is missing viewport metadata, visible controls, or feedback behavior
- the scientific-model planning pass now keeps `experiment_steps` and `observation_prompts`, so both interactive HTML generation and tutor prompting can reference experiment flow explicitly
- PBL/project generation now adds a second-pass collaboration design (`agent_roles`, `success_criteria`, `facilitator_notes`) and an issue-board style work breakdown before finalizing project content
- `/api/system/status` now includes a selected-model profile with a registry-backed `cost_tier`, and runtime alerts now flag premium-model selection explicitly for operator visibility
- resilient provider runtime telemetry now records estimated input/output tokens and estimated spend per provider label, and `/api/system/status` now surfaces aggregated cost counters (`provider_estimated_input_tokens`, `provider_estimated_output_tokens`, `provider_estimated_total_cost_microusd`)
- provider env config now supports explicit per-provider pricing overrides (`*_INPUT_COST_PER_1M_USD`, `*_OUTPUT_COST_PER_1M_USD`) for OpenAI-compatible providers lacking built-in model pricing metadata
- resilient/provider telemetry now also records provider-reported usage tokens where provider transports expose usage metadata (OpenAI-compatible, Anthropic, Google), and `/api/system/status` now surfaces provider-reported counters (`provider_reported_input_tokens`, `provider_reported_output_tokens`, `provider_reported_total_tokens`, `provider_reported_total_cost_microusd`)
- OpenAI-compatible native stream parsing now covers responses-style SSE events (`response.output_text.delta`, `response.function_call_arguments.*`, `response.completed`) in addition to chat-completions deltas, with typed tool + usage extraction on both paths
- interactive scientific modeling now runs a revision pass when the first draft is sparse (missing variables/steps/observation prompts), then merges revised constraints before interactive HTML generation
- PBL project content now runs a revision pass on the first draft brief before role-plan and issue-board expansion, improving completeness of driving question, deliverable, milestones, and facilitation fields
- SQLite queue claiming now uses claimable-state guarded updates plus a DB busy timeout/WAL setup to reduce lock failures under concurrent workers, with a concurrency regression test proving single-owner claim behavior
- this moves `T5.1`, `T5.2`, and more of `T5.4` forward meaningfully, but assets are still local-file based and broader worker coordination is still pending

## Suggested Execution Order

1. Track 1
2. Track 2
3. Track 3
4. Track 4
5. Track 5

## Current Focus

Current implementation slice:
- `A4` provider-level cooperative cancellation propagation (Done)
- `B1` backend whiteboard deterministic hardening (Done)
- `C1` generation research/search integration with Tavily + graceful fallback (Done)
- `A5` richer director interruption/end + resume-safe turn budgeting (Done)
- `B2` frontend whiteboard runtime hardening: lifecycle dedupe + action param alias parity (Done)
- `C2` interactive + PBL scene generation support in Rust pipeline (Done)
- `C3` structured output repair/fallback parity deepening (Done)
- `B3` playback/live whiteboard synchronization parity tests (Done)
- `E3` queue concurrency hardening (Done)
- `D1` media generation hardening (In Progress): per-task retry/backoff + non-retryable detection + fallback asset substitution so single media failures do not fail the whole lesson; OpenAI-compatible video provider now supports async task lifecycle (submit→poll) with task/status/url extraction and file-id download resolution, aligned with OpenMAIC adapter patterns
- `D1` media generation hardening (In Progress): TTS enrichment now also degrades per action instead of failing the entire lesson when one synthesis call fails, and asset persistence failures now leave generated inline/fallback media in place instead of hard-failing the lesson after generation
- `F1` telemetry foundation (In Progress): ZeroClaw runtime status now carries per-provider request/success/failure counters, last error, and last success/failure timestamps; `/api/system/status` now exposes these fields through `provider_runtime` for operational evidence
- `F1` telemetry foundation (In Progress): provider runtime telemetry now also carries per-provider latency metrics (`total_latency_ms`, `average_latency_ms`, `last_latency_ms`) computed from real request attempts inside the resilient provider path, and `/api/system/status` now exposes these values through `provider_runtime`
- `F1` telemetry foundation (In Progress): runtime action acknowledgements are now logged with session/mode/execution metadata, and runtime stream events now include interruption status plus session-mode context for downstream operators and clients
- `E2` object storage foundation (In Progress): generated audio/media assets can now be persisted through a backend asset-store abstraction instead of only hardcoded local-disk writes; local file storage remains the dev fallback, and Cloudflare R2-backed persistence is now supported through presigned S3-compatible uploads with public URL rewriting
- `A1` streaming parity hardening (In Progress): chat graph now emits in-flight `action_progress` events between start/completion to better match OpenMAIC incremental action cadence, preserves ordered text/action emission across parser + typed tool paths, and runtime can now enforce native-provider streaming via `AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING=1` (fails fast when compatibility chunking is the only active path)
- `A1` streaming parity hardening (In Progress): native-streaming enforcement now also supports targeted selectors via `AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS` (comma-separated provider/model label fragments), and `/api/system/status` now exposes runtime native-streaming policy flags for production observability
- `C4` deeper OpenMAIC generation parity (Done): interactive generation now builds a scientific-model pass before HTML generation, PBL/project content keeps richer structured planning fields, and scene action/content prompts are more scene-specific
- `A6` scene-aware live tutor prompting (Done): runtime tutor prompts now include scene-specific teaching context so slide/quiz/interactive/project turns are conditioned differently
- `A7` richer live-turn planning (Done): runtime prompts now include an explicit turn-plan block keyed to scene type, confusion cues, and recent prior turns
- `P1` broader OpenAI-compatible provider coverage (Done for config/resolution): provider env/config resolution now supports `groq`, `grok`/`xai`, and `openrouter` aliases through the existing registry/factory path
- `P2` broader OpenAI-compatible event coverage (Done): the provider parser now accepts message-level tool calls, JSON-valued tool arguments, and `output_text` content arrays without falling back to compatibility chunk reconstruction
- `C5` deeper multi-pass scientific/PBL generation (Done): interactive HTML now has a repair loop, and project generation now synthesizes collaboration roles plus issue-board tasks after the primary project brief
- next: remaining runtime-quality work beyond the now-verified OpenMAIC-style generation/runtime upgrades:
  - richer tutor turn-planning and content quality beyond the current scene-aware + turn-plan prompting
  - broader provider-native streaming coverage beyond the current implemented provider families and normalized OpenAI-compatible variants
  - stronger cost precision beyond provider-reported token telemetry (billing/invoice-truth integration), plus wider action-engine parity
  - deeper OpenMAIC parity for scientific interactives and agentic multi-step PBL planning beyond the current repaired multi-pass generators

Execution board:
- [openmaic-gap-closure-master-task-list.md](d:/uc-school/memory/openmaic-gap-closure-master-task-list.md)
