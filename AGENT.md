# AGENT.md — AI-Tutor agent operating manual

> Read this first. It tells you where things are, how to behave in this repo,
> and how to keep the architecture docs honest.

## What this is
AI-Tutor is a two-app product:
- `AI-Tutor-Backend/` — a Rust modular monolith (10 crates), one binary
  `ai_tutor_api`, axum + Postgres + Redis/Valkey.
- `AI-Tutor-Frontend/` — a pnpm monorepo, one Next.js 16 app (`apps/web`)
  + 4 packages (`ui`, `types`, `mathml2omml`, `pptxgenjs`).

## The architecture docs (authoritative mental map)
A `docs/` folder lives at the repo root. **Use it before editing, and update
it after structural changes.**

| File | When to consult |
|------|-----------------|
| `docs/README.md` | Start here — index + scope notes + known discrepancies |
| `docs/TREE.md` | Orient: full file/folder map of both apps + "where does X live" table |
| `docs/backend/ARCHITECTURE.md` | Any backend (Rust) edit: crates, pipeline, providers, storage, auth |
| `docs/frontend/ARCHITECTURE.md` | Any frontend edit: pages, API routes, stores, Stage API, components |
| `docs/CONTRACTS.md` | Before changing a type/route/shape that crosses the frontend↔backend boundary |
| `docs/DEPLOYMENT.md` | Deploy, env vars, Docker/Render/Vercel, storage topology |

## Working rules (important — this repo has rough edges)

1. **No mocks, be honest.** Don't claim a file does something you didn't read.
   When you infer, say so. When a fact is stale, re-inspect.

2. **Scratch scripts are not code.** `AI-Tutor-Backend/` has ~50 `fix_*.py` /
   `patch*.py` files plus `test.rs`, `katex_test.rs`, `libnull.rlib`,
   `*.backup`, `*.patch`. They are orphaned and **not in the build graph**
   (Dockerfile builds only `-p ai_tutor_api --bin ai_tutor_api`). Don't edit
   them to "fix" behavior; find the real source. Same for frontend root
   `fix.js`, `replace_colors.js`, `replace_slate*.py`, `scripts/*.mjs`.

3. **Schema truth is in code, not the migrations folder.** The real Postgres
   schema is the embedded `POSTGRES_MIGRATIONS` in
   `AI-Tutor-Backend/crates/storage/src/filesystem.rs` (~5407 lines), mirrored
   in `AI-Tutor-Backend/docs/DATABASE_SCHEMA.md`. The `migrations/*.sql` folder
   has only 2 files and lags. If you change a table, update both the embedded
   migration and DATABASE_SCHEMA.md.

4. **No SQLite.** Despite `data/*.db` existing, no crate references
   sqlite/rusqlite (verified). Postgres is the only persistent store; Redis
   holds the queue + runtime sessions. Ignore the `.db` files.

5. **Domain types are hand-mirrored, not generated.** `crates/domain/src/`
   (Rust) and `apps/web/lib/types/` (TS) define parallel types. Changing one
   side requires changing the other. See `docs/CONTRACTS.md`.

6. **Frontend `/app/api` routes mix owned and proxied logic.** Some own real
   logic (PDF parse, PBL MCP, billing checkout, email); others proxy the Rust
   backend. Open the route file before assuming where behavior lives.
   `next.config.ts` rewrites `/api/assets/*` and `/api/classroom-media/*`
   straight to the backend.

7. **Verify, don't assume, the backend route list.** Backend routes are
   registered in `crates/api/src/app.rs` `build_router_with_auth` and gated by
   the `required_role_for_request` table. For an exact route/verb, grep
   `app.rs`. Note: `app.rs` is an 18,957-line megafile; a decomposition plan
   exists at `docs/backend/APP_RS_REFACTOR_PLAN.md` but is **not yet executed** —
   treat `app.rs` as monolithic until then.

## Build & test
- Backend build: `cargo build --release -p ai_tutor_api --bin ai_tutor_api`
  (run in `AI-Tutor-Backend/`). Tests: `cargo test` per crate.
- Frontend: `pnpm install` then `pnpm build` (root; builds mathml2omml +
  pptxgenjs first). Dev: `pnpm dev` (Next Webpack). Tests: `vitest`
  (`apps/web/vitest.config.ts`); test files sit beside source (`*.test.ts`).
- Compose: `docker compose -f docker-compose.ai-tutor.yml up` (backend :4041,
  frontend :4040, valkey).

## Keep docs fresh — mandatory update step
**After every edit session** that does any of the following, update the
relevant `docs/*` file **in the same session** and bump its "Last verified" date:

- adds/removes/moves files or folders → update `docs/TREE.md`.
- changes a crate's public surface, a backend route, provider contract,
  storage schema, or auth model → update `docs/backend/ARCHITECTURE.md` and
  `docs/CONTRACTS.md` (+ `DATABASE_SCHEMA.md` if schema).
- changes a frontend page, API route, store, Stage API, or component tree
  shape → update `docs/frontend/ARCHITECTURE.md`.
- changes a cross-app type/route/persistence contract → update
  `docs/CONTRACTS.md`.
- changes deployment topology, env vars, or build/run → update
  `docs/DEPLOYMENT.md`.

Then re-verify by re-reading the changed file; don't trust memory. If a doc's
"Last verified" date is older than the file it describes, re-inspect before
relying on it.

## Honest gaps already known (don't re-discover)
- Exact backend route registration list not extracted verbatim (large); grep
  `app.rs` `build_router` when needed.
- `crates/gateway/main.rs` role/deployment status unconfirmed (not in default
  Docker build, not in render.yaml).
- Playwright e2e wiring unconfirmed (dep present, no config found at app root).
- `crates/orchestrator/src/prompts/` mixes `.ts` + `.md` + `build_prompts.sh`;
  confirm which prompt path is active before editing generation prompts.
