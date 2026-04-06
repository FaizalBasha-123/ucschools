# AI-Tutor-Frontend

Frontend workspace for the OpenMAIC-style AI tutor experience.

This folder is intentionally separated from the existing Schools24 frontend so we can translate the OpenMAIC UI architecture cleanly before integrating selected pieces back into the product.

## Goals

- preserve the strong parts of OpenMAIC's frontend architecture
- keep a dedicated AI tutor surface instead of forcing it into all existing pages
- support slide playback, teacher voice, quiz mode, whiteboard, and future voice interaction
- stay pnpm-based and workspace-ready

## Current Status

- pnpm workspace scaffold created
- Next.js app shell created
- base packages for shared UI/types created
- architecture tree documented
- no fake runtime features are claimed yet
