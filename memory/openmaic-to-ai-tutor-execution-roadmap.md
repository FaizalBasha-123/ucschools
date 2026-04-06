# OpenMAIC to AI-Tutor Execution Roadmap

## Purpose

This file turns the readiness matrix into an execution sequence for the production architecture translation project.

It is not a feature wishlist. It is the practical order of work needed to move from:

- `partial working vertical slice`

to:

- `production-complete architecture translation`

Reference:
- [openmaic-to-ai-tutor-readiness-matrix.md](d:/uc-school/memory/openmaic-to-ai-tutor-readiness-matrix.md)

## Priority Rules

### Must-Do

These directly block honest production parity with OpenMAIC-style architecture.

### Should-Do

These are not the first blockers, but they are required for reliability, maintainability, and safer rollout.

### Later

These improve the platform after the core production translation is already credible.

## Must-Do

### 1. Finish the Core Backend Generation Path

Why first:
- current generation is real but still simplified
- this is the backbone for every other layer

Must deliver:
- stronger structured output parsing and repair
- retries and fallback logic closer to OpenMAIC
- research/search phase integration
- better scene-type coverage:
  - interactive scene parity
  - PBL scene parity
- stronger provider-failure handling

Evidence base:
- [generation.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/generation.rs)
- [pipeline.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/pipeline.rs)

### 2. Build the Media Generation Layer

Why second:
- OpenMAIC architecture expects outlines -> scenes -> media enrichment
- image/video placeholders are part of the intended design

Must deliver:
- image generation task pipeline
- video generation task pipeline
- placeholder replacement pass
- storage strategy for generated assets
- provider abstraction for media generation

Current note:
- first provider-backed image generation path is implemented
- first provider-backed video generation path is implemented
- local persisted media asset storage/serving is implemented
- the LLM pipeline now emits first-pass image media requests and slide placeholder bindings
- backend fallback repair now injects missing image requests and repairs empty image placeholders
- JSON repair plus deterministic fallbacks now protect outlines, slides, quizzes, and actions from malformed model output
- transient LLM/provider failures are now retried in the generation layer before fallback logic applies
- current generation pipeline still needs richer media request quality, stronger video handling, and broader coverage

Target backend area:
- `AI-Tutor-Backend/crates/media/`

### 3. Build the TTS Layer

Why third:
- teacher-like audio is one of the key target capabilities
- frontend `speech` surfaces should be backed by real audio generation

Must deliver:
- TTS provider abstraction
- TTS generation for speech actions
- persistence of generated audio assets
- action enrichment with audio URLs
- frontend audio slot / playback control integration

Current note:
- first provider-backed TTS generation path is implemented
- local persisted audio asset storage/serving is implemented
- the remaining TTS work is broader provider coverage, retries/fallbacks, and production object storage strategy

### 4. Build the Live Tutor / LangGraph-Equivalent Runtime

Why fourth:
- this is one of the most important missing OpenMAIC architecture layers
- without this, the translation is not architecture-complete

Must deliver:
- Rust-native graph/state-machine orchestration
- per-turn director state
- resumable runtime state
- streaming event model
- interruption/resume semantics
- SSE or streaming API route

This is the hardest architecture gap.

Current note:
- a first SSE route now exists for persisted lesson playback events
- a first stateless tutor SSE route now exists for single-turn live chat responses
- a first director-style selector now exists for stateless tutor turns, covering trigger-agent routing, speaker rotation, and stage-aware selection
- a first multi-turn discussion loop now exists for stateless tutor sessions
- a first `cue_user` runtime outcome now exists for discussion sessions
- the remaining runtime work is a richer director loop, stronger turn-state management, and better end/cue/streaming semantics

### 5. Build the Whiteboard Layer

Why fifth:
- whiteboard is a distinct runtime surface in OpenMAIC
- many teaching actions depend on it conceptually

Must deliver:
- frontend whiteboard canvas shell
- whiteboard action execution model
- backend/frontend state contract for whiteboard actions
- whiteboard synchronization with scene playback state

### 6. Add ASR / Voice Mode

Why sixth:
- interactive voice mode is part of the target product direction
- it depends on live tutor runtime and audio architecture

Must deliver:
- ASR provider abstraction
- backend voice input flow
- frontend voice controls
- integration with live tutor session runtime

### 7. Replace File-Only Persistence for Production

Why seventh:
- file-backed persistence is good parity scaffolding
- it is not enough for real production architecture

Must deliver:
- PostgreSQL-backed primary persistence
- object storage for media/audio assets
- migration strategy
- lesson/job/media relational model

### 8. Build Production Job Execution

Why eighth:
- long-running generation/media/TTS work should not rely on request-bound execution forever

Current note:
- an explicit async generation route now exists
- the current async implementation now uses a durable file-backed queue plus persisted polling state
- a dedicated `queue_worker` binary now exists for separate worker-process execution
- transient retry/backoff and stale-working-file recovery are now implemented in the local file-backed queue
- the remaining gap is cancellation/resume semantics, stronger concurrency control, and a production queue backend beyond local files

Must deliver:
- background worker model
- queue/retry strategy
- cancellation/resume handling
- concurrency control

## Should-Do

### 9. Expand Provider Coverage

Why:
- current provider runtime is only OpenAI-compatible in practice

Should deliver:
- Anthropic-native support
- Google-native support
- provider-specific streaming behavior
- provider-specific request/response hardening

### 10. Add API Integration Coverage

Why:
- router tests exist
- live-service retrieval, generation-path, key error-path, and async-generation coverage now exist, but worker-backed async coverage is still thin

Should deliver:
- job retrieval after generation
- lesson retrieval after generation
- async/background-generation coverage once the queue model exists

### 11. Harden Frontend Generation UX

Why:
- current frontend works, but generation UX is still basic

Should deliver:
- job polling/progress display once backend path is async
- failure/retry UX
- better empty/loading/error states

### 12. Deepen Frontend Player Runtime

Why:
- current player is action-aware but still not true playback

Should deliver:
- timed action progression
- richer audio playback state beyond the current guided dock
- richer video playback state beyond the current guided video dock
- richer tutor-stream UI beyond the current single-turn discussion panel
- richer scene transitions
- better spotlight animation behavior

### 13. Add Observability

Why:
- production architecture needs operational clarity

Should deliver:
- structured logs
- traces across generation steps
- metrics
- alerts
- provider cost tracking

### 14. Add Security and Multi-Tenant Readiness

Why:
- if this enters Schools24 product space, it cannot remain unauthenticated and flat

Should deliver:
- auth/session integration
- rate limiting
- per-user or per-tenant boundaries
- secrets management hardening
- quota controls

## Later

### 15. Frontend Polish and Advanced Runtime UX

Later improvements:
- richer tutor persona presentation
- smoother motion and transitions
- session resume UX
- better scene thumbnails / lesson library UX

### 16. Advanced Authoring / Admin Tooling

Later improvements:
- lesson inspection tools
- action debugging views
- content regeneration controls
- admin moderation and audit tools

### 17. Optimization and Cost Controls

Later improvements:
- caching prompt outputs
- model routing optimization
- partial regeneration
- cost-aware provider selection

## Recommended Execution Order

### Phase A: Complete static lesson generation parity

1. finish core generation fallbacks and scene-type coverage
2. add media generation layer
3. add TTS layer
4. add production persistence and asset storage seams

Outcome:
- prompt -> lesson -> media -> audio -> persisted result

### Phase B: Complete runtime parity

5. build live tutor orchestration runtime
6. add SSE/event streaming
7. build whiteboard layer
8. add ASR/voice mode

Outcome:
- lesson playback + live tutor interaction

### Phase C: Production hardening

9. add queue/background workers
10. add observability
11. add security/tenant boundaries
12. add integration/load/failure testing

Outcome:
- production-grade service posture

### Phase D: Product refinement

13. improve frontend generation UX
14. deepen playback polish
15. add admin/debug tools
16. optimize cost/performance

Outcome:
- scalable and maintainable product experience

## Practical Next Three Moves

If we stay disciplined, the next three implementation moves should be:

1. backend: deepen the tutor runtime from the new two-turn loop into a richer director loop with stronger cue-user/end policies
2. frontend: connect the player/runtime UI more deeply to streaming tutor and playback state
3. backend: strengthen queue policy, retries, and cancellation on top of the file-backed worker model

Why these three:
- they move the biggest remaining OpenMAIC runtime gap instead of only polishing the static lesson path
- they preserve the correct phase ordering
- they produce visible product value while building toward the hardest live-orchestration work

Current note:
- media task collection and placeholder replacement foundation is now implemented
- first provider-backed image generation path is now implemented
- first provider-backed video generation path is now implemented
- local persisted media asset storage/serving is now implemented
- the remaining media work is richer media request emission, stronger video handling, and broader provider coverage
- TTS task collection and speech-action audio enrichment foundation is now implemented
- first provider-backed TTS path now exists
- local persisted audio asset storage/serving is now implemented
- the remaining TTS work is broader provider coverage, retries/fallbacks, and production object storage strategy
- queue retries and stale-worker recovery are now implemented on the current file-backed worker path
- the next queue work is cancellation/resume behavior and a stronger production queue backend
- the stateless tutor path now has a first director-style selector, a first multi-turn discussion loop, and a first `cue_user` outcome, so the next runtime work is richer orchestration control and frontend consumption of those runtime decisions

## Final Call

The production architecture translation project should be considered complete only after all `Must-Do` items are at least `In Progress`, and the most important ones are actually working:

- core generation parity
- media parity
- TTS parity
- live runtime orchestration
- whiteboard/runtime parity
- product