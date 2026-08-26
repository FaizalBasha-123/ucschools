# AI-Tutor Cross-App Contracts

> What crosses the frontend↔backend boundary, and the shared domain model.
> Last verified: 2026-08-25.

This doc is the single place to look before changing a type, route, or
persisted shape that both apps depend on. If you change one side, update the
other and this doc in the same session.

## 1. HTTP surface

### Base wiring
- Frontend → backend base URL: `NEXT_PUBLIC_AI_TUTOR_API_BASE_URL`
  (default in `next.config.ts` rewrites: `http://localhost:8000`;
  docker-compose sets `http://localhost:4041`; Render sets the public URL).
- `next.config.ts` **rewrites** (not route handlers) pass through:
  `/api/assets/*` and `/api/classroom-media/*` straight to the backend.
- All other `/api/*` are real Next.js route handlers in
  `apps/web/app/api/**/route.ts`. Some own logic; some proxy to the backend.
  Open the file before assuming.

### Backend route ownership (from `crates/api/src/app.rs`)
- The backend registers routes in `build_router`. The auth/role table lives in
  `required_role_for_request(method, path)` (code, not config).
- Roles: `Reader` < `Writer` < `Operator`.
- A separate router in `llm_proxy.rs` exposes `/api/generate/llm`,
  `/api/generate/llm/stream`, `/api/generate/profiles`.

> ⚠ I did not extract the full backend route list verbatim because the route
> registration in `app.rs` is large and interleaved. To enumerate backend routes
> authoritatively, read `crates/api/src/app.rs` around `build_router`. The
> frontend `/app/api` handlers are the reliable mirror of what the client
> calls. When you need the exact backend path/verb, grep `app.rs` for the path.

### Frontend route handlers (authoritative list of what the client calls)
83 handlers under `apps/web/app/api/`. See `docs/frontend/ARCHITECTURE.md`
for the full enumeration. Grouped: auth, generate/lessons/lesson-shelf, pbl,
media/parse-pdf, billing/credits/subscriptions, operator/* (admin), system.

## 2. Shared domain model (the Stage/Scene/Action vocabulary)

This is the most important contract: the backend (`crates/domain/`) and the
frontend (`apps/web/lib/types/`) define parallel types. They are **not
generated** from one source — they are hand-maintained mirrors. Changing one
requires changing the other.

### Backend (`crates/domain/src/`)
- `scene.rs`: `Stage`, `Scene` { id, stage_id, title, order, content, actions,
  whiteboards, multi_agent }, `SceneContent` (tagged enum: `Slide{canvas}`,
  `Quiz{questions}`, `Interactive{url,html,scientific_model}`,
  `Project{project_config}`), `SceneOutline`, `MultiAgentConfig`,
  `SlideCanvas`, `Whiteboard`, `GeneratedAgentConfig`.
- `generation.rs`: `LessonGenerationRequest` { requirements, pdf_content,
  enable_web_search/image/video/tts, agent_mode, account_id, school_id,
  pdf_images, quality_mode, learning_mode, precharged_credits,
  extra_scenes_consent, ... }, `UserRequirements` { requirement, language,
  user_nickname, user_bio }, `Language` { ZhCn, EnUs }, `AgentMode`.
- `action.rs`: `LessonAction` (the playback action contract).
- `job.rs`: `LessonGenerationJob`, status/step enums.
- `routing.rs`: `GenerationTask`, `QualityTier` (Basic/Standard/Premium),
  `TopicComplexity`, `GenerationBudget`, `compute_generation_budget`.
- `runtime.rs`: `DirectorState`, `RuntimeActionExecutionRecord`,
  `StatelessChatRequest`.

### Frontend (`apps/web/lib/types/`)
- `stage.ts`: `Stage` { id, name, whiteboard, agentIds, generatedAgentConfigs,
  max_scenes, ... }, `Scene` { id, stageId, type, title, order, content,
  actions, whiteboards, multiAgent }, `SceneType` =
  `'slide'|'quiz'|'interactive'|'pbl'`, `StageMode` =
  `'autonomous'|'playback'`, `Whiteboard`.
- `generation.ts`: `UserRequirements`, `SceneOutline`, `PdfImage`,
  `AudienceProfile`, `StylePreferences`, `UploadedDocument` — two-stage
  generation types (requirements → outlines → scenes).
- `action.ts`: `Action`/`ActionType` (playback script).
- `slides.ts`: `PPTElement` (slide element union).
- `roundtable.ts`, `chat.ts`, `whiteboard-doubt.ts`, `provider.ts`,
  `settings.ts`, `pdf.ts`, `edit.ts`, `export.ts`.

### Mirror rules (verified equivalences)
| Concept | Backend | Frontend |
|---|---|---|
| Scene content types | `SceneContent` enum (snake_case tag) | `SceneType` string union |
| Quality tier | `QualityTier` (Basic/Standard/Premium) | `QualityMode` string |
| Learning mode | `learning_mode` opt string | `LearningMode` string |
| Generation request | `LessonGenerationRequest` | `UserRequirements` + outline types |
| Action script | `LessonAction` | `Action`/`ActionType` |

> `quality_mode`/`learning_mode` strings (`basic`/`standard`/`premium`,
> `explain`/`revision`/`exam`/`placement_prep`) must match exactly across the
> boundary; they drive `orchestrator/engine.rs` budget math and the frontend
> settings store's model stack selection.

## 3. Stage API (frontend agent toolkit)

`apps/web/lib/api/stage-api.ts` → `createStageAPI(store)` returns
`{ scene, navigation, element, canvas, whiteboard, mode, stage }`. This is the
**programmatic surface** AI agents (CopilotKit/MCP) use to build/edit classroom
content on the client. It operates on the Zustand `StageStore`, not the backend.
The backend owns generation; the Stage API owns in-client editing.

## 4. Persistence shape

- **Postgres** is the sole persistent store for lessons, jobs, billing,
  accounts, runtime sessions, lesson shelf. Schema authority:
  `crates/storage/src/filesystem.rs` (embedded migrations) +
  `AI-Tutor-Backend/docs/DATABASE_SCHEMA.md` (23 tables).
- **Redis/Valkey** holds the lesson generation queue and runtime sessions
  (`queue_redis.rs`, `redis_storage.rs`).
- **Frontend IndexedDB** (`apps/web/lib/utils/database.ts`, Dexie) holds
  media blobs (images/video) and playback/draft caches — not source of truth
  for lessons.
- ⚠ `data/*.db` are vestigial; no SQLite code path exists in the crates
  (verified: no `sqlite`/`rusqlite` references). Ignore them.

## 5. Media pipeline split
- **Image/video generation** runs on the backend (`/api/generate/image`,
  `/api/generate/video`) but is **orchestrated from the frontend**
  (`lib/media/media-orchestrator.ts`): collects `mediaGenerations` from
  outlines, calls the APIs, fetches blobs, stores in IndexedDB, updates the
  Zustand store. Runs in parallel with content/action generation.
- **TTS/ASR**: backend providers (`providers/` traits) + frontend audio
  adapters (`lib/audio/`).

## 6. Auth contract
- Firebase phone auth + Google OAuth (callback `/auth/callback`) + session
  JWT (refresh `/api/auth/refresh`). Operator auth: OTP → cookie +
  `X-Operator-Header` CSRF. Backend enforces roles via the `app.rs` table.
