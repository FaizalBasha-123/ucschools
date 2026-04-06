# AI-Tutor-Frontend Implementation Plan

## Goal

Build the frontend after backend contracts are explicit, using the OpenMAIC frontend architecture as inspiration while staying separate from the existing Schools24 product frontend.

This frontend should eventually consume structured lesson/stage/action payloads from `AI-Tutor-Backend`.

## Dependency Rule

Frontend work should follow backend contract definition.

Backend-first sequence:
1. define lesson/scene/action/job contracts
2. expose generation and retrieval APIs
3. then build player/generation UI around those contracts

## Frontend Layers

### 1. App Shell

Owns:
- routing
- layout
- page-level entry points

Initial routes to build:
- `/`
- `/generate`
- `/lessons/[id]`

### 2. Data Contract Layer

Owns:
- frontend types matching backend API
- API client helpers
- query/mutation boundaries

Build after backend contract stabilization.

### 3. Lesson Generation UI

Owns:
- requirement input
- optional file/material upload
- generation state display
- job polling

### 4. Lesson Player UI

Owns:
- scene navigation
- slide rendering shell
- quiz rendering shell
- whiteboard shell
- playback controls
- audio/video controls

### 5. Live Tutor UI

Owns:
- text prompt chat input
- future ASR controls
- streaming response rendering
- tutor session state display

## Phased Implementation Plan

## Phase F1: Contract Alignment

Build:
- shared frontend types package
- API client abstractions
- job/result DTO alignment with Rust backend

Current progress:
- `packages/types` now defines frontend DTOs for:
  - lesson generation payload/result
  - job status
  - lesson/scene/action data
- web app API helpers now call:
  - `POST /api/lessons/generate`
  - `GET /api/lessons/:id`
  - `GET /api/lessons/jobs/:id`

## Phase F2: Generation Surface

Build:
- generation form page
- job status polling
- result handoff into lesson page

Current progress:
- `/generate` now submits real generation requests to the Rust backend
- result handoff into `/lessons/[id]` is implemented
- current backend call is synchronous, so polling is not yet used

## Phase F3: Player Surface

Build:
- lesson page shell
- scene switcher
- slide scene renderer shell
- quiz renderer shell
- playback controls

Current progress:
- `/lessons/[id]` now fetches persisted lesson data from the Rust backend
- scene navigator is implemented
- slide scene shell is implemented
- quiz scene shell is implemented
- action list rendering is implemented
- player state now tracks selected scene and selected action
- previous/next scene controls are implemented
- action timeline and active-action summary are implemented
- `speech` actions render a narration surface
- speech surfaces can now expose an attached audio slot when `audio_url` is present
- speech surfaces now also expose an inline audio dock for guided playback
- `discussion` actions render a tutor-discussion shell
- `spotlight` actions visibly target slide elements
- slide media elements now render as real image/video surfaces instead of only raw URLs
- guided mode can now auto-advance lesson actions after narration audio finishes
- guided mode can now auto-advance after focused slide video playback finishes
- discussion scenes can now call the backend stateless tutor SSE route and render streamed tutor text
- playback runtime is not yet implemented

## Phase F4: Whiteboard and Action UI

Build:
- whiteboard overlay shell
- action-aware player state
- audio/video state integration

## Phase F5: Live Tutor Surface

Build:
- streaming tutor panel
- text interaction
- future ASR/TTS controls

## Honest Scope Rule

Do not claim:
- OpenMAIC-style stage runtime exists
- whiteboard playback is working
- live tutor orchestration is integrated

until the backend contracts and corresponding frontend components are implemented and verified.

## Immediate Next Coding Task

Implement the next frontend slice:
- prepare whiteboard/audio/video UI seams without claiming playback parity yet
- add job polling or progress UX once the backend exposes async generation more clearly
- start mapping action types to visual/audio behaviors incrementally
