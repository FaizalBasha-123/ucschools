# Schools24 System Map

## Repo Type

Multi-surface school platform repository with a production backend/frontend stack and separate AI tutor translation workspaces.

## Major Roots

- `Schools24-backend/` — Go monolith API and job runner
- `Schools24-frontend/` — Next.js product frontend
- `client/android-mobile/` — Android app wrapper
- `schools24-landing/` — public landing app
- `OpenMAIC/` — cloned reference repo for architecture analysis
- `AI-Tutor-Backend/` — Rust workspace scaffold for tutor backend translation
- `AI-Tutor-Frontend/` — pnpm workspace scaffold for tutor frontend translation
- `.copilot-memory/` — existing structured repo notes

## Core Current Architecture

- backend: Go + Gin + pgx + Redis + NATS + object storage
- frontend: Next.js App Router + React + TanStack Query + Radix + Tailwind
- data model: schema-per-tenant multi-tenancy on PostgreSQL
- mobile: Android/Capacitor
- public surface: separate landing app plus public admission/support flows

## Important Current Truths

- Real backend route registration is in `Schools24-backend/cmd/server/main.go`
- `Schools24-backend/internal/router/routes.go` is deprecated
- `.copilot-memory/` already documents much of the active codebase
- AI tutor workspaces currently define architecture boundaries, not full product behavior
