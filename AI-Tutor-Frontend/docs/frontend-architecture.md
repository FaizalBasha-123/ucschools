# AI Tutor Frontend Architecture

## Purpose

This frontend follows the OpenMAIC-style separation between:

- application shell
- stage/canvas rendering
- scene renderers
- tutor interaction panels
- shared UI packages

Unlike the existing Schools24 frontend, this workspace is focused only on the AI tutor experience.

## Initial Tree

```text
AI-Tutor-Frontend/
├── package.json
├── pnpm-workspace.yaml
├── docs/
│   └── frontend-architecture.md
├── apps/
│   └── web/
└── packages/
    ├── ui/
    └── types/
```

## Planned App Shape

- `apps/web/app/`
  - route-level pages
  - AI tutor landing
  - lesson player
  - future lesson session pages
- `apps/web/components/`
  - stage
  - slide renderer
  - whiteboard
  - quiz
  - tutor controls
- `packages/ui/`
  - reusable primitives
- `packages/types/`
  - lesson/stage/action/shared types

## Relationship to Backend

This frontend will target `AI-Tutor-Backend` APIs and consume structured lesson/stage/action payloads.
