# AI-Tutor Architecture Documentation

This `docs/` folder is the **agent-facing mental map** of the AI-Tutor codebase.
It is written from direct inspection of the real source tree (not mocked, not
guessed) and is intended to be updated after every edit session that changes
structure, contracts, or wiring.

## What lives here

| File | Scope | When to read |
|------|-------|--------------|
| [`frontend/ARCHITECTURE.md`](./frontend/ARCHITECTURE.md) | Next.js monorepo (`AI-Tutor-Frontend/`) | Touching pages, API routes, the Stage store, scene renderers, media/export, or PBL |
| [`backend/ARCHITECTURE.md`](./backend/ARCHITECTURE.md) | Rust workspace (`AI-Tutor-Backend/`) | Touching the API, orchestrator, providers, routing, runtime, storage, or billing |
| [`TREE.md`](./TREE.md) | Complete file/folder map of both apps | Orienting before any edit; finding where a symbol lives |
| [`CONTRACTS.md`](./CONTRACTS.md) | Cross-app contracts: API surface, Stage/Scene/Action model, persistence shape | Before changing a type that crosses the frontend↔backend boundary |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Deployment topology, env vars, Docker/Render/Vercel | Deploying, debugging env/auth, or reasoning about where code runs |

## Honest scope notes (verified, not assumed)

These were confirmed by reading the actual files on 2026-08-25:

- The backend is a **Rust workspace** (`Cargo.toml`, edition 2021) with 10 crates,
  built with `cargo build --release -p ai_tutor_api --bin ai_tutor_api`. The
  single deployable is the `api` crate's `main.rs`.
- The frontend is a **pnpm monorepo** (`pnpm@10.28.0`) with one Next.js 16 app
  (`apps/web`) and four workspace packages (`ui`, `types`, `mathml2omml`,
  `pptxgenjs`). The app uses the Webpack bundler (`next dev --webpack`).
- There is **no existing `AGENT.md` / `AGENTS.md`** in the repo. This folder is
  the first such agent-instruction surface. A top-level `AGENT.md` is created
  alongside this folder to point harnesses here and to mandate keeping it fresh.

### Known discrepancies / smells (do not clean up silently — ask first)

1. **Scratch/patch scripts at the backend root.** `AI-Tutor-Backend/` contains
   ~50 `fix_*.py`, `patch_*.py`, `render_latex.py`, `test.rs`, `katex_test.rs`,
   `libnull.rlib`, and `*.backup` files that are one-off repair scripts, not
   part of the build graph. The Dockerfile builds only `-p ai_tutor_api`, so
   these are not shipped. Treat them as orphaned unless a task names them.
2. **Two storage backends, one schema source.** `crates/storage/` has both
   `postgres.rs` (sqlx-based) and `filesystem.rs` (r2d2-postgres-based, 5407
   lines, contains the embedded `POSTGRES_MIGRATIONS`). The authoritative
   schema reference is [`AI-Tutor-Backend/docs/DATABASE_SCHEMA.md`](../AI-Tutor-Backend/docs/DATABASE_SCHEMA.md),
   **not** the `migrations/*.sql` folder (which has only 2 files and lags the
   21 embedded migrations). If you change a table, update both the embedded
   migration in `filesystem.rs` **and** the DATABASE_SCHEMA doc.
3. **Frontend API routes proxy/translate, not own, some logic.** Some Next.js
   `/app/api/*` routes are thin passthroughs to the Rust backend; others own
   real logic (PDF parsing, PBL MCP, billing checkout, email). Check the route
   before assuming where a behavior lives.

## How this doc stays correct

- After any edit session that adds/removes files, changes a crate/package's
  public surface, moves a route, or alters a cross-app contract, update the
  relevant file here **in the same session** and bump the "Last verified" date.
- Each architecture file ends with a "Last verified" line. Trust the date; if
  it is stale, re-inspect before relying on specifics.
- When unsure whether a fact is structural or incidental, prefer `TREE.md` +
  a direct file read over memory.
