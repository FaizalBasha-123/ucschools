---
description: How to implement features in uc-school correctly
---

# Schools24 — Implementation Workflow

## MANDATORY: Before Writing ANY Code

### Step 1: Understand the Product Boundaries
Read these files first:
- `.codex/instructions.md` — current architecture, file map, and working rules
- `.copilot-memory/01-architecture/overview.md` — high-level system overview
- `.copilot-memory/01-architecture/tech-stack.md` — current stack snapshot
- `memory/schools24-system-map.md` — project-specific architecture summary

**Core ownership rules:**
- `Schools24-backend/` owns business logic, tenant isolation, APIs, jobs, and storage integration
- `Schools24-frontend/` owns the authenticated product UI, App Router pages, and client-side data flow
- `client/android-mobile/` owns Android packaging and native mobile adaptations
- `schools24-landing/` owns the public marketing surface
- `AI-Tutor-Backend/` and `AI-Tutor-Frontend/` are new translation workspaces and are not yet integrated product paths

### Step 2: Read the Existing Implementation First
Before changing any area, read the real entry points and nearby modules:
- Backend entry point: `Schools24-backend/cmd/server/main.go`
- Backend config: `Schools24-backend/internal/config/config.go`
- Frontend root: `Schools24-frontend/src/app/layout.tsx`
- Frontend routes: `Schools24-frontend/src/app/`
- Existing architecture notes: `.copilot-memory/`

### Step 2A: For AI Tutor Work, Analyze OpenMAIC Layer by Layer First
If the task touches `AI-Tutor-Backend/` or `AI-Tutor-Frontend/`, you MUST study the OpenMAIC source before implementing:
- API routes: `OpenMAIC/app/api/`
- server orchestration: `OpenMAIC/lib/server/`
- generation pipeline: `OpenMAIC/lib/generation/`
- orchestration/chat: `OpenMAIC/lib/orchestration/`
- core types: `OpenMAIC/lib/types/`

Required supporting notes:
- `memory/openmaic-backend-layer-analysis.md`
- `AI-Tutor-Backend/docs/system-design.md`
- `AI-Tutor-Backend/docs/implementation-plan.md`
- `AI-Tutor-Frontend/docs/implementation-plan.md`

Current AI tutor backend translation status:
- domain contracts are implemented and checked
- provider registry/model resolution is implemented and tested
- first OpenAI-compatible outbound LLM client is implemented
- file-backed lesson/job storage is implemented and tested
- first orchestrator pipeline skeleton is implemented and tested
- provider-backed outline/content/action generation exists in the orchestrator layer
- the LLM generation pipeline can now emit first-pass image media requests and bind slide placeholders for backend media enrichment
- the backend now injects missing image requests and repairs empty image placeholders as a first recovery layer
- the backend now repairs noisy JSON responses and falls back to deterministic outlines/slides/quizzes/actions when generation output is malformed
- the backend now retries transient LLM/provider failures in generation, while still surfacing hard provider/config errors directly
- HTTP API routes exist for health, lesson generation, job lookup, and lesson retrieval
- API application service seam and router tests are in place
- live-service API tests now verify file-backed lesson/job retrieval and persisted media/audio asset serving
- live-service API tests now also verify end-to-end generation, persistence, and retrieval when provider test seams are injected
- API tests now also verify invalid requests, missing assets, and stale-job failure behavior through the live service path
- an explicit async generation route now exists and is covered by queue-and-poll API tests, backed by a durable file queue plus worker loop
- queue processing is now shared through the API crate library and a dedicated `queue_worker` binary exists for separate worker-process execution
- the file-backed queue now supports retry metadata, transient retry with backoff, and stale `.working` file reclamation after worker interruption
- lesson persistence can now also be switched to SQLite through `AI_TUTOR_LESSON_DB_PATH`, so lesson retrieval is no longer limited to per-lesson JSON files
- lesson job persistence can now also be switched to SQLite through `AI_TUTOR_JOB_DB_PATH`, so queued/running/cancelled/resumed job metadata is no longer limited to per-job JSON files
- the async lesson queue can now also be switched to SQLite through `AI_TUTOR_QUEUE_DB_PATH`, so queued generation work is no longer limited to per-entry JSON files
- queued async lesson jobs can now also be cancelled through `POST /api/lessons/jobs/{id}/cancel`, with cancelled job state persisted for both file-backed and SQLite-backed queue modes
- cancelled or failed async lesson jobs can now also be resumed through `POST /api/lessons/jobs/{id}/resume`, using a persisted queued-request snapshot so the original async request can be requeued without the client resending it
- a first SSE lesson playback route now exists and streams session/scene/action events from persisted lessons
- a first stateless tutor SSE route now exists and streams single-turn session/agent/text/done events
- media task collection and placeholder replacement foundation exists in `AI-Tutor-Backend`
- first OpenAI-compatible provider-backed image generation path is implemented and wired through the backend
- first OpenAI-compatible provider-backed video generation path is implemented and wired through the backend
- generated lesson media can now be persisted into local backend asset storage and served via API
- TTS task collection and speech-action audio enrichment foundation exists in `AI-Tutor-Backend`
- first OpenAI-compatible provider-backed TTS path is implemented and wired through the backend
- generated teacher audio can now be persisted into local backend asset storage and served via API
- frontend contract consumption exists in `AI-Tutor-Frontend` for generation and lesson retrieval
- frontend routes `/generate` and `/lessons/[id]` build successfully
- lesson player shell now includes scene controls and action timeline state
- lesson player now renders distinct UI surfaces for speech, discussion, and spotlight actions
- lesson player now renders inline teacher audio playback and real slide image/video media surfaces
- lesson player now supports a first guided audio mode that advances after narration clips finish
- lesson player now supports a first guided video mode that advances after focused slide videos finish
- lesson player discussion UI now consumes the stateless tutor SSE route and renders streamed tutor text
- the backend stateless tutor SSE route now has a first director-style selector that honors trigger agents, rotates speakers, and prefers scene-bound agents
- the backend stateless tutor SSE route now also supports a first multi-turn discussion loop and returns accumulated director state for that streamed session
- true in-flight provider abort, broader queue concurrency coordination, deeper video generation parity, and richer director-loop live tutor orchestration are still pending

**Do NOT trust deprecated placeholders over real entry points.**
For example:
- `Schools24-backend/internal/router/routes.go` is marked deprecated
- real route registration lives in `Schools24-backend/cmd/server/main.go`

### Step 3: Respect Current Reality
- The backend is a large Go monolith with many modules already wired directly in `main.go`
- The frontend is a large Next.js App Router app with role-based route groups
- The AI tutor workspaces are scaffolded, not feature-complete
- Do not claim a feature exists in the new AI tutor workspaces unless it is actually implemented

### Step 4: Check Dependencies and Build Commands
- Backend: `Schools24-backend/go.mod`
- Frontend: `Schools24-frontend/package.json`
- Landing: `schools24-landing/package.json`
- AI Tutor backend workspace: `AI-Tutor-Backend/Cargo.toml`
- AI Tutor frontend workspace: `AI-Tutor-Frontend/pnpm-workspace.yaml`

## Implementation Rules

### Writing Code
1. Follow the current repo structure instead of inventing a new one mid-change
2. Keep tenant/business logic in the Go backend unless we are explicitly moving it
3. Keep UI concerns in the appropriate frontend surface
4. Treat `AI-Tutor-Backend/` and `AI-Tutor-Frontend/` as a translation project, not as already-live product code
5. No mocks when wiring product-facing features unless the task explicitly asks for placeholders

### Verification After EVERY Logical Unit
1. After backend changes:
   ```bash
   cd Schools24-backend
   go test ./...
   ```
2. After frontend changes:
   ```bash
   cd Schools24-frontend
   npm run build
   ```
3. After landing changes:
   ```bash
   cd schools24-landing
   npm run build
   ```
4. After AI tutor backend changes:
   ```bash
   cd AI-Tutor-Backend
   cargo check
   ```
5. Do not move to the next area until the current one compiles or the blocker is clearly documented

## Key Files Quick Reference

| What | Where |
|---|---|
| Backend entry | `Schools24-backend/cmd/server/main.go` |
| Backend config | `Schools24-backend/internal/config/config.go` |
| Backend modules | `Schools24-backend/internal/modules/` |
| Tenant/global migrations | `Schools24-backend/migrations/` |
| Frontend app routes | `Schools24-frontend/src/app/` |
| Frontend components | `Schools24-frontend/src/components/` |
| Frontend hooks | `Schools24-frontend/src/hooks/` |
| Frontend API proxy | `Schools24-frontend/src/app/api/` |
| Mobile Android client | `client/android-mobile/` |
| Landing app | `schools24-landing/` |
| AI tutor backend | `AI-Tutor-Backend/` |
| AI tutor frontend | `AI-Tutor-Frontend/` |
| Context docs | `.copilot-memory/` |
| Working memory | `memory/` |

## Current Priority Themes

1. Stabilize and understand the current Schools24 monolith
2. Preserve the current product while extending it
3. Translate OpenMAIC ideas carefully into the AI tutor workspaces
4. Avoid pretending the AI tutor architecture is already integrated

## Common Mistakes to Avoid

- ❌ Editing deprecated route files instead of the real backend entrypoint
- ❌ Mixing landing-site concerns into the main app
- ❌ Treating the AI tutor scaffolds as production-ready
- ❌ Adding API or data assumptions without checking the current backend modules
- ❌ Copying OpenMAIC concepts blindly without adapting them to Schools24 ownership boundaries
- ❌ Skipping builds/tests after touching code

## AI-Tutor Translation Reality Check

- The Rust provider layer now has real multi-provider LLM failover and cooldown-based circuit breaking.
- OpenAI-compatible, Anthropic, and Google text providers are wired for the backend generation/runtime path.
- The GraphBit-style tutor runtime now reads provider health and can simplify routing when runtime health is degraded.
- The tutor runtime now also supports history-aware streaming through the provider layer, with native history streaming implemented for OpenAI-compatible, Anthropic, and Google providers.
- The tutor SSE route now forwards runtime events as they are produced by the graph instead of buffering the whole session first.
- The tutor runtime now emits explicit `action_started` / `action_completed` events with structured action payloads, and the frontend lesson player consumes those runtime actions during discussion sessions.
- Lesson playback SSE now carries structured action payloads too, and the web player applies playback and discussion actions through the same whiteboard/spotlight/video execution helper.
- Backend runtime events now also label execution surface, and the frontend uses a shared runtime action executor hook instead of separate playback/discussion action routing paths.
- Speech/teacher-audio actions now also run through that shared runtime action executor path, so guided and manual narration playback no longer rely on a separate UI-only token branch.
- Playback whiteboard semantics are now partly backend-owned: the runtime derives whiteboard snapshots from ordered whiteboard actions and the frontend can hydrate from those snapshots.
- Live tutor whiteboard semantics are now stronger too: the GraphBit-style chat runtime rebuilds whiteboard state from prior ledger history and attaches updated whiteboard snapshots to streamed `wb_*` tutor events and the final `done` event.
- `director_state` now also carries a persisted whiteboard snapshot, so seeded live tutor sessions can resume from backend-owned whiteboard state across turns instead of depending only on replaying the whiteboard ledger.
- Live tutor runtime sessions can now also be resumed by `session_id` through file-backed persistence, so the backend can reload and save `director_state` across stateless chat requests instead of relying on the frontend to resend all runtime state on every turn.
- Runtime-session persistence can now also be pointed at SQLite through `AI_TUTOR_RUNTIME_DB_PATH`, so live tutor state is no longer locked to JSON files even though lessons/jobs/assets still use the file-backed storage path.
- The backend now also exposes `/api/system/status` so queue depth, queue/runtime backend mode, current model, and provider runtime/circuit-breaker state are visible through an API surface instead of only logs.
- This is still not full OpenMAIC parity: true provider-streaming orchestration, tool calling, and channel/gateway integration are still separate remaining work.
