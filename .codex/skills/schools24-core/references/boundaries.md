# Schools24 Boundaries

## Backend
- Owns auth, tenant-aware APIs, jobs, integrations, migrations, persistence, and storage orchestration
- Real backend entrypoint is `Schools24-backend/cmd/server/main.go`
- `internal/router/routes.go` is deprecated and should not be treated as route truth

## Frontend
- Owns App Router pages, role-specific interfaces, API consumption, and client interaction
- Primary code lives in `Schools24-frontend/src/`

## Mobile
- Owns Android-specific runtime and packaged client behavior
- Primary code lives in `client/android-mobile/`

## Landing
- Owns public-facing marketing content and non-authenticated brand pages
- Primary code lives in `schools24-landing/`

## AI Tutor Translation
- Owns the translation of OpenMAIC architecture into new Rust/Next workspaces
- Current state is scaffolded architecture, not production behavior
