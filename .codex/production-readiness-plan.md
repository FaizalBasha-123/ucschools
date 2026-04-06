# Schools24 — Production Readiness Plan

## Context

You are working on `uc-school`, which already contains a substantial production codebase plus new AI tutor workspaces that are still at the architecture stage.

Read these first:
- `.codex/instructions.md`
- `.agent/workflows/implementation.md`
- `.copilot-memory/README.md`

## Current State

| Surface | Status | Key Files |
|---|---|---|
| Backend API monolith | Active and large | `Schools24-backend/cmd/server/main.go` |
| Product frontend | Active and large | `Schools24-frontend/src/app/` |
| Android mobile wrapper | Active | `client/android-mobile/` |
| Landing site | Active | `schools24-landing/` |
| AI tutor backend | Scaffold only | `AI-Tutor-Backend/` |
| AI tutor frontend | Scaffold only | `AI-Tutor-Frontend/` |

## Main Production Themes

### 1. Backend Hardening
- reduce `main.go` wiring pressure by clarifying module boundaries
- keep deprecated router code from becoming a trap
- ensure health, readiness, jobs, and tenant migrations stay coherent
- keep object storage, Redis, NATS, and interop paths verifiable

### 2. Frontend Stability
- role-specific routes should remain consistent with backend contracts
- avoid stale direct API assumptions when proxy routes exist
- keep native/mobile-specific behavior working alongside browser behavior

### 3. AI Tutor Translation Readiness
- keep the tutor workspaces honest and architecture-driven
- do not overstate implementation progress
- translate OpenMAIC in slices:
  1. domain contracts
  2. orchestration model
  3. API contracts
  4. frontend player surfaces

## Immediate Implementation Order

1. Preserve current Schools24 stability
2. Build shared architectural memory for this repo
3. Translate OpenMAIC concepts into Rust/Next tutor workspaces carefully
4. Integrate only after contracts and runtime are real

## Verification Baseline

Run the relevant checks after touching each area:

```bash
cd Schools24-backend && go test ./...
cd Schools24-frontend && npm run build
cd schools24-landing && npm run build
cd AI-Tutor-Backend && cargo check
```

## Critical Rules

1. No fake “complete” AI tutor progress
2. No route or API assumptions without reading the current source
3. No copying OpenMAIC blindly without adapting to Schools24
4. Keep memory/docs updated when a major architectural truth changes
