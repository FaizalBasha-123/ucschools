# OpenMAIC to AI-Tutor Production Checklist

## Purpose

This file is the shortest strict checklist for whether the `OpenMAIC` to `AI-Tutor` architecture translation is production-ready.

Status meanings used here:

- `Done`: implemented and verified well enough to count as present
- `Partial`: real work exists, but it is not yet enough for honest production parity
- `Missing`: not implemented in a meaningful production-ready form

Primary references:
- [openmaic-backend-layer-analysis.md](d:/uc-school/memory/openmaic-backend-layer-analysis.md)
- [openmaic-to-ai-tutor-readiness-matrix.md](d:/uc-school/memory/openmaic-to-ai-tutor-readiness-matrix.md)
- [openmaic-to-ai-tutor-execution-roadmap.md](d:/uc-school/memory/openmaic-to-ai-tutor-execution-roadmap.md)
- [implementation-plan.md](d:/uc-school/AI-Tutor-Backend/docs/implementation-plan.md)
- [implementation-plan.md](d:/uc-school/AI-Tutor-Frontend/docs/implementation-plan.md)

## Verdict

- `Architecture translation foundation`: `Done`
- `Working vertical slice`: `Done`
- `Production-complete architecture translation`: `Missing`

## Strict Layer Checklist

| Layer | Status | Evidence | Main Remaining Work |
|---|---|---|---|
| Domain contracts | `Done` | [scene.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/scene.rs), [action.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/action.rs), [runtime.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/runtime.rs) | deepen behavior behind the contracts |
| Provider registry/model resolution | `Done` | [config.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/config.rs), [registry.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/registry.rs), [resolve.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/resolve.rs) | broader provider runtime coverage |
| Concrete LLM calling | `Partial` | [openai.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/openai.rs), [factory.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/factory.rs) | Anthropic/Google support, provider-specific streaming, stronger hardening |
| File-backed lesson/job persistence | `Done` | [filesystem.rs](d:/uc-school/AI-Tutor-Backend/crates/storage/src/filesystem.rs) | replace for production scale later |
| Generation pipeline | `Partial` | [generation.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/generation.rs), [pipeline.rs](d:/uc-school/AI-Tutor-Backend/crates/orchestrator/src/pipeline.rs) | search/research phase, stronger scene-type parity, richer fallback logic |
| Media generation | `Partial` | [lib.rs](d:/uc-school/AI-Tutor-Backend/crates/media/src/lib.rs), [tasks.rs](d:/uc-school/AI-Tutor-Backend/crates/media/src/tasks.rs), [openai.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/openai.rs) | stronger video lifecycle, broader providers, production asset storage |
| TTS | `Partial` | [lib.rs](d:/uc-school/AI-Tutor-Backend/crates/media/src/lib.rs), [openai.rs](d:/uc-school/AI-Tutor-Backend/crates/providers/src/openai.rs) | broader providers, stronger retries, production asset storage |
| ASR / voice input | `Missing` | none | ASR provider, backend flow, frontend controls, live voice session handling |
| Backend HTTP surface | `Partial` | [app.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/app.rs), [main.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/main.rs) | parse-pdf, grading, auth, richer runtime endpoints |
| SSE / runtime streaming | `Partial` | [session.rs](d:/uc-school/AI-Tutor-Backend/crates/runtime/src/session.rs), [app.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/app.rs) | true live tutor streaming, turn orchestration, interrupt/resume |
| LangGraph-equivalent orchestration | `Partial` | [session.rs](d:/uc-school/AI-Tutor-Backend/crates/runtime/src/session.rs), [runtime.rs](d:/uc-school/AI-Tutor-Backend/crates/domain/src/runtime.rs) | director flow, per-turn state machine, LLM-driven live stream logic |
| Background jobs / queue | `Partial` | [queue.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/queue.rs), [queue_worker.rs](d:/uc-school/AI-Tutor-Backend/crates/api/src/bin/queue_worker.rs) | cancellation/resume, concurrency control, production queue backend |
| Production persistence architecture | `Missing` | current file-backed storage only | Postgres, object storage, migrations, backup plan |
| Observability | `Missing` | basic logs only | tracing, metrics, alerts, provider cost tracking |
| Security / tenant readiness | `Missing` | no production auth boundary in AI tutor workspace | auth, rate limits, quotas, tenant safety |
| Frontend contract consumption | `Done` | [api.ts](d:/uc-school/AI-Tutor-Frontend/apps/web/lib/api.ts), [index.ts](d:/uc-school/AI-Tutor-Frontend/packages/types/src/index.ts) | keep aligned with backend runtime expansion |
| Frontend lesson player shell | `Partial` | [lesson-player-shell.tsx](d:/uc-school/AI-Tutor-Frontend/apps/web/components/lesson-player-shell.tsx), [globals.css](d:/uc-school/AI-Tutor-Frontend/apps/web/app/globals.css) | timed playback, whiteboard, deeper action automation |
| Frontend guided playback | `Partial` | [lesson-player-shell.tsx](d:/uc-school/AI-Tutor-Frontend/apps/web/components/lesson-player-shell.tsx) | full playback engine, action scheduler, stream-driven UI |
| Whiteboard runtime | `Missing` | concept only in contracts | canvas, execution, synchronization |
| Frontend live tutor UI | `Missing` | discussion shell only | streaming chat, live state, ASR/TTS controls |
| Production deployment posture | `Missing` | buildable workspaces only | Docker/prod config, worker deployment, TLS/proxy, scaling plan |

## Production Readiness Gates

These are the minimum gates that must be true before the translation can honestly be called production-complete:

1. `Core generation parity`
- lesson generation must cover the important OpenMAIC flow reliably
- outline -> scene content -> actions -> media -> TTS must all work together robustly

2. `Runtime parity`
- live tutor orchestration must exist beyond static playback
- SSE must be tied to real runtime/session state, not only persisted lesson playback

3. `Voice and whiteboard parity`
- ASR must exist
- whiteboard actions must execute in runtime, not only exist in contracts

4. `Production data architecture`
- jobs and lessons cannot rely only on local JSON files
- media/audio cannot rely only on local asset folders

5. `Operational safety`
- observability, auth, quotas, and failure handling must be present

6. `Frontend runtime consumption`
- frontend must consume runtime/SSE events directly
- player must become a real playback runtime, not just a guided shell

## Short Answer

Is the architecture translation project ready from OpenMAIC to AI-Tutor?

- `As a foundation`: `Yes`
- `As a production-complete translation`: `No`

## Best Next Step

The single highest-value next step is:

- build the real live tutor runtime path on top of the new SSE surface

Why:
- it is the biggest remaining OpenMAIC architecture gap
- many other missing pieces depend on it
- it turns the project from “structured lesson generator with guided playback” into “interactive tutor runtime”
