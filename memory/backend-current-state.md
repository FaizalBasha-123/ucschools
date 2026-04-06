# Backend Current State

## Entry Point

- `Schools24-backend/cmd/server/main.go`

## What It Does

- loads config
- initializes Redis/Valkey cache
- connects PostgreSQL
- runs global and tenant migration/update flows
- provisions tenant schemas
- initializes object store
- wires major modules directly
- registers all routes
- starts recurring cleanup/scheduled jobs

## Module Areas Observed

- `academic`
- `admin`
- `auth`
- `blog`
- `chat`
- `demo`
- `interop`
- `models3d`
- `operations`
- `public`
- `school`
- `student`
- `support`
- `teacher`
- `transport`

## Current Architectural Character

- large Go monolith
- strong direct wiring in `main.go`
- many responsibilities live close to startup
- tenant-aware data model and background loops are already built into the current runtime

## Important Caution

`Schools24-backend/internal/router/routes.go` is explicitly marked deprecated and contains placeholders. Do not treat it as the real routing layer.
