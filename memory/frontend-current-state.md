# Frontend Current State

## Product Frontend

- root: `Schools24-frontend/`
- framework: Next.js App Router
- key source root: `Schools24-frontend/src/`

## Main Areas Observed

- `src/app/` — route tree
- `src/components/` — shared UI and feature components
- `src/hooks/` — data and interaction hooks
- `src/app/api/` — proxy routes and helper endpoints

## Role-Based Route Surfaces Seen

- admin
- teacher
- student
- super-admin
- public admission
- public teacher appointments
- transport/driver

## Notable Patterns

- large route surface under App Router
- many role dashboards and operational pages
- custom hooks for admin, teacher, student, support, transport, and leaderboard flows
- frontend proxies some API traffic through `src/app/api/`

## Other Frontend Surfaces

- `client/android-mobile/` — Android wrapper
- `schools24-landing/` — separate landing/public marketing app
