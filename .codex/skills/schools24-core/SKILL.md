---
name: schools24-core
description: Use when working on the Schools24 architecture, repo structure, backend/frontend boundaries, role-based product surfaces, or the new AI tutor translation workspaces. This skill preserves the current agreed design and implementation reality.
---

# Schools24 Core

Use this skill whenever the task touches the main Schools24 codebase or the new AI tutor translation workspaces.

## Non-negotiable architecture rules

- Keep the current system split into:
  - Go backend monolith
  - Next.js authenticated frontend
  - Android mobile client wrapper
  - public landing site
  - separate AI tutor translation workspaces
- Backend owns:
  - business truth
  - tenant isolation
  - auth and role enforcement
  - persistence
  - storage/integration logic
  - background jobs
- Frontend owns:
  - product UI
  - route surfaces for each role
  - hook-driven API consumption
  - browser/mobile-web experience
- Mobile owns:
  - Android-specific packaging and native runtime behavior
- Landing owns:
  - public site and brand-facing content
- AI tutor workspaces own:
  - the OpenMAIC translation effort
  - not current production feature truth

## Repo structure

```text
Schools24-backend/       # Go backend monolith
Schools24-frontend/      # Next.js product app
client/android-mobile/   # Android mobile wrapper
schools24-landing/       # Public landing app
OpenMAIC/                # Reference repo for analysis
AI-Tutor-Backend/        # Rust tutor architecture workspace
AI-Tutor-Frontend/       # pnpm tutor frontend workspace
.copilot-memory/         # Existing codebase notes
memory/                  # Working memory for this repo
```

## Required reading before changes

- `.codex/instructions.md`
- `.agent/workflows/implementation.md`
- `memory/schools24-system-map.md`
- `memory/ai-tutor-translation-plan.md`
- `.copilot-memory/01-architecture/overview.md`
- `.copilot-memory/01-architecture/tech-stack.md`

## Key patterns to follow

1. Backend route truth lives in `Schools24-backend/cmd/server/main.go`
2. Frontend route truth lives in `Schools24-frontend/src/app/`
3. Existing `.copilot-memory` is the fast path for context
4. AI tutor work should preserve OpenMAIC concepts but not pretend to be implemented before it is

## Verification commands

### Backend
```bash
cd Schools24-backend && go test ./...
```

### Frontend
```bash
cd Schools24-frontend && npm run build
```

### Landing
```bash
cd schools24-landing && npm run build
```

### AI Tutor backend
```bash
cd AI-Tutor-Backend && cargo check
```

## References

- [references/boundaries.md](references/boundaries.md)
- [references/surfaces.md](references/surfaces.md)
