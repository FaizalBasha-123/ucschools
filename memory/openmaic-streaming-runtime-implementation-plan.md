# OpenMAIC-Informed Streaming Runtime Gap Closure Plan

Date: 2026-04-08

## Purpose

This document is the approval-stage implementation plan for closing the remaining
OpenMAIC -> AI-Tutor gaps around:

- streaming-first runtime behavior
- native structured action/tool streaming
- production-grade persistence/queue foundations

It is intentionally honest:

- it does not repeat old gap claims that are no longer true in the Rust codebase
- it separates already-implemented work from still-missing parity
- it translates OpenMAIC behavior into concrete Rust tasks rather than vague goals

## Source Evidence Reviewed

OpenMAIC references:

- `OpenMAIC/lib/orchestration/ai-sdk-adapter.ts`
- `OpenMAIC/lib/orchestration/stateless-generate.ts`
- `OpenMAIC/lib/orchestration/director-graph.ts`

AI-Tutor references:

- `AI-Tutor-Backend/crates/providers/src/traits.rs`
- `AI-Tutor-Backend/crates/providers/src/openai.rs`
- `AI-Tutor-Backend/crates/providers/src/anthropic.rs`
- `AI-Tutor-Backend/crates/providers/src/google.rs`
- `AI-Tutor-Backend/crates/providers/src/resilient.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/chat_graph.rs`
- `AI-Tutor-Backend/crates/orchestrator/src/response_parser.rs`
- `AI-Tutor-Backend/crates/api/src/app.rs`
- `AI-Tutor-Backend/crates/api/src/queue.rs`
- `AI-Tutor-Backend/crates/storage/src/filesystem.rs`

## Honest Current State

### What OpenMAIC really does

OpenMAIC is genuinely streaming-first in the live runtime path:

- `ai-sdk-adapter.ts` streams through `streamLLM(...)` and yields `delta` chunks immediately
- `stateless-generate.ts` incrementally parses a structured JSON array while the stream is still active
- `stateless-generate.ts` yields interleaved runtime events during generation, not only after the model finishes
- `director-graph.ts` passes cancellation through `signal`

OpenMAIC is not just "streaming text". Its architecture is:

- provider stream
- incremental structured parser
- event-yielding orchestration graph
- cancellation-aware runtime loop

### What AI-Tutor already has now

Some earlier gap statements are outdated. AI-Tutor already has these real capabilities:

- provider-native history-aware streaming contracts in `traits.rs`
- native streaming implementations for OpenAI, Anthropic, and Google providers
- cooperative cancellation propagation from API -> graph -> resilient provider -> concrete providers
- streamed `text_delta`, `action_started`, `action_progress`, and `action_completed` events in `chat_graph.rs`
- SQLite-backed lesson, job, runtime-session, and queue support
- queue cancellation/resume support and SQLite claim coordination

That means the following old claim is no longer fully true:

- "AI-Tutor still only does full generation first and then chunks text"

That still exists as a compatibility fallback path in `traits.rs`, but it is no longer the only runtime path.

## Remaining Real Gaps

These are the gaps that are still real after reviewing the code.

### Gap 1: AI-Tutor still relies on model-emitted JSON/text parsing for actions

OpenMAIC evidence:

- `ai-sdk-adapter.ts` defines stream chunk types that include `tool_calls`
- `stateless-generate.ts` expects structured streaming semantics at the orchestration layer

AI-Tutor evidence:

- `response_parser.rs` still parses action intent from streamed JSON/text content
- `chat_graph.rs` emits actions after parsing model output, not from provider-native tool-call envelopes

Why this matters:

- action reliability is still prompt-sensitive
- malformed JSON still requires repair/fallback logic
- true tool-call streaming parity with OpenMAIC is not there yet

### Gap 2: AI-Tutor streaming parity is provider-strong but orchestration semantics are still thinner

OpenMAIC evidence:

- `stateless-generate.ts` tracks ordered interleaving of text and action segments
- `director-graph.ts` is built around graph-stream semantics

AI-Tutor evidence:

- `chat_graph.rs` now streams events in-flight, which is good
- but the graph still depends on parsed response items rather than a first-class typed tool stream
- there is no provider-agnostic native tool event contract in `traits.rs`

Why this matters:

- text streaming parity is close
- action streaming parity is still adapter-level, not transport-level

### Gap 3: Production persistence exists in SQLite, but not yet in a full production deployment model

AI-Tutor evidence:

- `filesystem.rs` supports SQLite for lesson/job/runtime-session storage
- `queue.rs` supports SQLite queue rows and guarded claim semantics
- the service layer in `app.rs` still routes through `FileStorage` / `FileBackedLessonQueue` abstractions with compatibility file paths retained

Why this matters:

- local file dependency is no longer mandatory if SQLite env vars are set
- but the architecture is still not at "production-final" posture:
  - no Postgres adapter
  - no object storage for media/audio
  - no distributed queue backend
  - no migration/ops story for multi-instance deployment beyond local SQLite

### Gap 4: Whiteboard parity is much better, but still not fully OpenMAIC-grade runtime tooling

AI-Tutor evidence:

- streamed whiteboard actions and persisted whiteboard state exist
- backend snapshots and ledgers now flow through runtime events

Remaining issue:

- execution is still centered on parsed actions and frontend application
- no stronger backend-owned action runtime with the same "tool execution contract" feel as OpenMAIC's orchestration/tool layer

### Gap 5: Observability is improving, but not yet enough for production control loops

AI-Tutor evidence:

- `/api/system/status` reports backend mode, provider runtime status, stream mode, counters, and latency telemetry

Remaining issue:

- no request-level tracing
- no cost accounting
- no alert-oriented health surface
- no queue lease/worker dashboards or provider burn-rate visibility

## Translation Strategy

We should not blindly "copy OpenMAIC". We should translate its architecture into Rust-native layers:

1. `OpenClaw` behavior -> `ZeroClaw` resilient provider policy
2. `LangGraph` behavior -> `GraphBit`-style streaming orchestration contract
3. AI SDK tool-call semantics -> Rust provider event model + orchestrator action dispatch

That means the next real work is not "add more JSON parsing". It is:

- move action transport closer to provider-native typed events
- make orchestration consume typed streamed items, not only text chunks
- keep SQLite as a real intermediate production step, but plan beyond it

## Approval-Stage Implementation Plan

## Phase 1: Native Structured Stream Contract

Goal:

- give Rust providers a typed streaming surface for both text and actions

Tasks:

- `P1.1` Add a provider stream event enum in `traits.rs`
- `P1.2` Extend provider implementations to expose typed streamed items
- `P1.3` Keep compatibility fallback by adapting plain text streams into typed text events only
- `P1.4` Extend `resilient.rs` to fail over typed streams without breaking event ordering

Acceptance:

- orchestrator no longer depends only on string chunk callbacks for the live path
- provider layer can carry text deltas and, where supported, native tool-call/tool-result events

Risk:

- provider APIs are not uniform across OpenAI/Anthropic/Google, so the first version should normalize only the event shapes we can support honestly

## Phase 2: GraphBit Runtime Consumes Typed Stream Events

Goal:

- make `chat_graph.rs` consume a typed stream instead of primarily reconstructing actions from text

Tasks:

- `P2.1` add a typed event ingestion loop in `chat_graph.rs`
- `P2.2` map provider text events directly to `TextDelta`
- `P2.3` map provider tool/action events directly to runtime action lifecycle events
- `P2.4` keep `response_parser.rs` only as fallback mode, not as the primary live-path contract
- `P2.5` add event-ordering tests that prove text/action interleaving is preserved

Acceptance:

- native-tool capable providers can stream action intent without waiting for reconstructed JSON parsing
- fallback parsing still works for providers/models that only emit text

## Phase 3: Whiteboard and Runtime Action Executor Hardening

Goal:

- make whiteboard/runtime action execution truly backend-contract-driven

Tasks:

- `P3.1` define canonical runtime action payload schemas for whiteboard, spotlight, laser, video, and audio
- `P3.2` make backend emit those schemas from one action execution layer
- `P3.3` tighten frontend executor to consume only canonical payloads
- `P3.4` add replay tests proving playback and live discussion produce the same whiteboard document

Acceptance:

- whiteboard is no longer "best effort from parsed model text"
- execution semantics are stable across playback, live tutoring, and resume

## Phase 4: Persistence and Queue Production Upgrade

Goal:

- move from "SQLite-capable local worker architecture" to "production deployment ready"

Tasks:

- `P4.1` introduce a storage trait split that distinguishes local compatibility adapters from production adapters
- `P4.2` add Postgres-backed lesson/job/runtime repositories
- `P4.3` add object storage for media/audio assets
- `P4.4` add a production queue backend or queue abstraction suitable for multi-instance workers
- `P4.5` preserve SQLite for dev/single-node deployment

Acceptance:

- production deployment no longer depends on local disk semantics
- queue/workers can scale beyond a single machine safely

Important note:

- this is not needed to test the app locally
- it is needed to claim production-grade architecture parity honestly

## Phase 5: Operability and Safety

Goal:

- make the runtime debuggable and supportable under load

Tasks:

- `P5.1` add request-scoped tracing ids through API -> graph -> provider
- `P5.2` add provider cost accounting and per-model usage telemetry
- `P5.3` add queue lease and worker state metrics
- `P5.4` add alert-friendly status surfaces for provider degradation, queue backlog, and stream fallback activation

Acceptance:

- operators can see when AI-Tutor falls back from native stream to compatibility mode
- operators can see provider latency/error/cost pressure before user-visible failure

## Recommended Execution Order

1. `Phase 1`
2. `Phase 2`
3. `Phase 3`
4. `Phase 5`
5. `Phase 4`

Reason:

- the biggest remaining OpenMAIC parity gap is native structured streaming/action transport
- persistence upgrade matters for production, but it is not the fastest path to behavioral parity

## Definition of "Gap Filled"

We should only say the original gap is filled when all of the following are true:

- AI-Tutor live runtime primarily consumes typed provider stream events, not reconstructed JSON text
- action execution can stream with first-class typed semantics comparable to OpenMAIC's live orchestration path
- fallback parser mode still exists, but is no longer the primary architecture
- persistence/queue can run without local-disk assumptions in production deployment mode
- tracing/metrics are sufficient to operate the runtime safely

## Approval Decision

Recommended approval scope for the next coding phase:

- approve `Phase 1` + `Phase 2` together as the highest-value OpenMAIC parity work
- keep `Phase 3` in the same implementation wave if time permits
- treat `Phase 4` as production-foundation workstream after runtime semantics are hardened

## Short Answer

If the question is "can we already honestly say the OpenMAIC streaming/runtime gap is fully closed?" the answer is:

- No, not fully.

If the question is "has AI-Tutor already closed meaningful parts of that gap?" the answer is:

- Yes.

The remaining hard gap is no longer basic text streaming or cancellation. It is native structured action/tool streaming plus final production deployment foundations.
