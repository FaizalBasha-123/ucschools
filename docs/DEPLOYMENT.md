# AI-Tutor Deployment & Operations

> Where code runs, how it's built, and the env that wires it.
> Last verified: 2026-08-25.

Full env reference: `AI-Tutor-Backend/ENVIRONMENT_VARIABLES.md` (authoritative).
This doc is the topology map; defer to that file for exact var names.

## Topology

```
            ┌─────────────────────────────┐
            │  Frontend (Next.js 16)       │  Vercel (prod) or Docker (compose)
            │  apps/web — pnpm monorepo    │  build: pnpm build (mathml2omml+pptxgenjs first)
            │  Webpack bundler, standalone │  port 4040 (compose)
            └───────────────┬─────────────┘
                            │ NEXT_PUBLIC_AI_TUTOR_API_BASE_URL
                            │ (rewrites /api/assets/*, /api/classroom-media/* → backend)
                            ▼
            ┌─────────────────────────────┐        ┌──────────────────────┐
            │  Backend (Rust, axum)        │ ◀────▶ │  Valkey/Redis         │
            │  single bin: ai_tutor_api    │        │  queue + runtime      │
            │  crates/api/main.rs          │        │  sessions             │
            │  port 10000 (Render) / 4041  │        └──────────────────────┘
            │  (compose)                    │
            └───────────────┬─────────────┘
                            │ AI_TUTOR_POSTGRES_URL
                            ▼
            ┌─────────────────────────────┐
            │  PostgreSQL                  │  lessons, jobs, billing, accounts,
            │  (embedded migrations in      │  runtime sessions, shelf (23 tables)
            │   storage/filesystem.rs)      │
            └─────────────────────────────┘
```

## Backend deploy

### Docker (local compose)
`docker-compose.ai-tutor.yml`:
- `backend`: builds `AI-Tutor-Backend/Dockerfile`, port 4041, volume
  `ai_tutor_backend_data` → `/app-data`, env for providers + models, depends
  on `valkey`.
- `frontend`: builds `AI-Tutor-Frontend/Dockerfile`, port 4040, env
  `NEXT_PUBLIC_AI_TUTOR_API_BASE_URL=http://localhost:4041`.
- `valkey`: `valkey/valkey:8-alpine`, ephemeral (no AOF/save).

Dockerfile (backend): cargo-chef staged build (planner → cook deps → build
`-p ai_tutor_api --bin ai_tutor_api` → `debian:bookworm-slim` runtime). Sets
`CARGO_BUILD_JOBS=1`, LTO off, 256 codegen units to avoid Render OOM.
Runtime env: `AI_TUTOR_API_HOST=0.0.0.0`, `PORT=10000`, `STORAGE_ROOT=/data`,
`LOG_FORMAT=json`. Exposes 10000.

### Render (prod)
`render.yaml`: free web service (`ai-tutor-backend-free`, docker, singapore) +
free keyvalue (Valkey). Health check `/api/health`. Key env:
- `AI_TUTOR_REQUIRE_HTTPS=1`, `AI_TUTOR_COOKIE_SECURE=1`
- `AI_TUTOR_PEDAGOGY_ROUTING_ENABLED=1`, `AI_TUTOR_MIN_GENERATION_CREDITS=2.0`
- Redis: `AI_TUTOR_AIVEN_REDIS_URL` (primary, sync:false) or `REDIS_URL`
  (from keyvalue service).
- CORS: `AI_TUTOR_ALLOWED_ORIGINS=https://uc-aitutor.vercel.app`
- Auth secrets (sync:false): `AI_TUTOR_API_SECRET`,
  `AI_TUTOR_PARTIAL_AUTH_SECRET`, `AI_TUTOR_SESSION_JWT_SECRET`,
  Google OAuth client id/secret/state, `AI_TUTOR_OPERATOR_OTP_SECRET`,
  `AI_TUTOR_OPERATOR_ALLOWED_EMAILS`.
- Models (balanced-mode env): generation/chat/pdf/pbl split across
  openrouter + groq; image (flux-schnell), tts (kokoro-82m), asr
  (groq whisper-large-v3). Provider keys (sync:false): OPENROUTER, OPENAI, GROQ.

## Frontend deploy

### Vercel (prod)
`vercel.json`: framework `nextjs`, `installCommand: pnpm install`,
`buildCommand: pnpm build`, `outputDirectory: apps/web/.next`.
`next.config.ts`: `output: undefined` on Vercel/win, else `standalone`.
`transpilePackages: ['mathml2omml','pptxgenjs']`.
`serverExternalPackages: ['nodemailer','pdfjs-dist','tesseract.js','canvas']`.
`experimental.proxyClientMaxBodySize: '200mb'`.
Strict CSP header on all routes.

### Docker (compose)
`AI-Tutor-Frontend/Dockerfile`: node:20-bookworm-slim, copies workspace
package.json files, `pnpm install --no-frozen-lockfile`, runs
`next dev -H 0.0.0.0 -p 4040` (⚠ this is a **dev** image, not a production
server).

## Storage truth (verified)
- **Postgres** = sole persistent store. No SQLite code path in any crate
  (grep confirmed: no `sqlite`/`rusqlite` refs). `data/*.db` are vestigial.
- **Redis/Valkey** = generation queue + runtime sessions.
- **R2/S3** (optional) = media assets (`AI_TUTOR_ASSET_STORE=r2|s3`).
- Schema lives in `crates/storage/src/filesystem.rs` (embedded migrations, 21
  migrations / 23 tables); reference doc `docs/DATABASE_SCHEMA.md`. The
  `migrations/*.sql` folder is partial/lagging.

## Startup readiness (from `main.rs`)
- Storage root must be writable.
- `AI_TUTOR_STARTUP_STRICT_PROVIDER_READINESS=1` → fail if no provider key.
- `AI_TUTOR_AUTH_REQUIRED=1` → require `AI_TUTOR_API_SECRET` or
  `AI_TUTOR_API_TOKENS`.
- Operator OTP, Firebase phone auth, Google OAuth each gate startup when
  their `*_ENABLED` flags are set.

## Runbooks (in `AI-Tutor-Backend/docs/`)
- `production-ops-runbook.md`, `PRODUCTION_QUICKSTART_RUNBOOK.md`,
  `PRODUCTION_LAUNCH_CHECKLIST.md`.
- `runbooks/deploy-queue-worker.md` (split queue worker deployment),
  `runbooks/backup-restore-failure.md`, `runbooks/nginx-pingora-gateway.conf`.

## What I could not fully verify (honest gaps)
- The exact backend route registration list in `app.rs` (large/interleaved);
  for a verbatim route map, read `build_router` in `crates/api/src/app.rs`.
- Whether the `gateway/` crate's `main.rs` is actually deployed (it's not in
  the default Docker build and not referenced from `render.yaml`). Treat as
  exploratory until confirmed.
- Whether a Playwright e2e suite is wired (the dep exists; no e2e config was
  found at the app root).
