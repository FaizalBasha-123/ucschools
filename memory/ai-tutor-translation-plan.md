# AI Tutor Translation Plan

## Current Goal

Translate the OpenMAIC architecture into dedicated Schools24 tutor workspaces without pretending the implementation already exists.

## Current Workspace Status

### Backend
- `AI-Tutor-Backend/` exists
- Rust workspace created
- crate boundaries defined
- `cargo check` passes
- domain/orchestrator/runtime/provider/storage skeletons exist

### Frontend
- `AI-Tutor-Frontend/` exists
- pnpm workspace created
- `apps/web` shell exists
- shared package placeholders exist
- no real tutor player/runtime UI implemented yet

## Translation Strategy

1. analyze OpenMAIC architecture completely
2. extract domain contracts:
   - lesson
   - scene outline
   - scene content
   - actions
   - runtime session
3. model LangGraph-like orchestration in Rust-native form
4. define API contracts for tutor generation and playback
5. build frontend player surfaces around those contracts

## Important Honesty Rule

Do not claim:
- OpenMAIC has been ported
- tutor runtime exists
- tutor UI is production-ready

until those pieces are actually implemented and verified.
