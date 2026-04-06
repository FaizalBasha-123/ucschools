# Schools24 — Codex Instructions

## MANDATORY: Read Before ANY Task
You are working on `uc-school`, a multi-surface school management codebase with:
- a Go backend monolith
- a Next.js product frontend
- an Android mobile client wrapper
- a separate landing site
- new AI tutor translation workspaces

Before writing code, read:
- `.codex/skills/schools24-core/SKILL.md`
- `.copilot-memory/README.md`
- `memory/README.md`

## Architecture (Current Reality)
- **Backend** (`Schools24-backend/`) owns API truth, auth flows, tenant isolation, migrations, background jobs, object storage, and integration logic
- **Frontend** (`Schools24-frontend/`) owns authenticated UI, route surfaces for each role, hooks, and browser/mobile-web behavior
- **Mobile** (`client/android-mobile/`) owns native Android packaging and platform-specific UX around the web app
- **Landing** (`schools24-landing/`) owns public marketing content
- **AI Tutor Backend** (`AI-Tutor-Backend/`) is a new Rust workspace for the OpenMAIC architecture translation
- **AI Tutor Frontend** (`AI-Tutor-Frontend/`) is a new pnpm workspace for the tutor UI translation

## Working Methodology

### Step 1: Always Research Before Code
Before implementing anything:
1. Read the relevant source files in this repo
2. Read the matching `.copilot-memory` notes if they exist
3. Check whether the area is real production code or new scaffolded architecture
4. Update the plan mentally before editing

### Step 2: Use the Real Entry Points
Current key truth sources:
- `Schools24-backend/cmd/server/main.go` is the real backend wiring point
- `Schools24-backend/internal/router/routes.go` is deprecated
- `Schools24-frontend/src/app/` is the actual route structure
- `AI-Tutor-Backend/` and `AI-Tutor-Frontend/` are currently architecture-first scaffolds

### Step 3: Verify After Each Change
Backend:
```bash
cd Schools24-backend
go test ./...
```

Frontend:
```bash
cd Schools24-frontend
npm run build
```

Landing:
```bash
cd schools24-landing
npm run build
```

AI Tutor backend:
```bash
cd AI-Tutor-Backend
cargo check
```

### Step 4: Keep Contracts Synchronized
If you change backend APIs, also check:
- frontend API usage in `Schools24-frontend/src/lib/`
- route proxies in `Schools24-frontend/src/app/api/`
- any mobile or public landing dependencies if the endpoint is shared

## Current System State

### What Exists
| Surface | Status | Key Files |
|---|---|---|
| Go backend monolith | Active production code | `Schools24-backend/cmd/server/main.go` |
| Next.js product frontend | Active production code | `Schools24-frontend/src/app/` |
| Android mobile wrapper | Active packaging/client code | `client/android-mobile/` |
| Landing app | Active public website | `schools24-landing/` |
| `.copilot-memory` architecture docs | Present and useful | `.copilot-memory/` |
| AI tutor backend workspace | Scaffolded, compile-checked | `AI-Tutor-Backend/` |
| AI tutor frontend workspace | Scaffolded, not yet built out | `AI-Tutor-Frontend/` |
| OpenMAIC reference clone | Present for analysis | `OpenMAIC/` |

### What Is Not Done Yet
1. AI tutor backend is not implemented beyond the initial Rust architecture skeleton
2. AI tutor frontend is not implemented beyond the initial workspace shell
3. OpenMAIC architecture has not yet been fully translated into the new workspaces
4. The new AI tutor workspaces are not yet integrated into the main Schools24 product

## File Map

### Backend (Go)
```text
Schools24-backend/
├── cmd/
│   ├── server/main.go
│   ├── seeder/main.go
│   └── tasks/
├── internal/
│   ├── config/
│   ├── modules/
│   ├── shared/
│   └── router/        # deprecated placeholder route file
├── migrations/
│   ├── global/
│   └── tenant/
├── scripts/
└── uploads/
```

### Frontend (Next.js)
```text
Schools24-frontend/
├── src/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── contexts/
│   ├── lib/
│   └── types/
├── android/
├── public/
└── scripts/
```

### AI Tutor Translation Workspaces
```text
AI-Tutor-Backend/
├── docs/
└── crates/
    ├── api/
    ├── common/
    ├── domain/
    ├── orchestrator/
    ├── providers/
    ├── runtime/
    ├── storage/
    └── media/

AI-Tutor-Frontend/
├── apps/web/
├── packages/ui/
├── packages/types/
└── docs/
```

## Common Mistakes to Avoid
- ❌ Editing deprecated backend route placeholders instead of `cmd/server/main.go`
- ❌ Treating scaffolded tutor workspaces as if they already implement OpenMAIC
- ❌ Skipping `.copilot-memory` when trying to understand the repo
- ❌ Mixing landing-site requirements into the authenticated app without checking ownership
- ❌ Claiming features are complete when only architecture scaffolding exists
