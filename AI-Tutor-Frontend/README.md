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

## Vercel Deployment

This workspace is now Vercel-hostable with the root `vercel.json`:
- install command: `pnpm install`
- build command: `pnpm build` (builds `apps/web` via workspace filter)
- framework: Next.js

Set these environment variables in Vercel:
- `NEXT_PUBLIC_AI_TUTOR_API_BASE_URL`: your Rust backend public URL (recommended for separate backend hosting)
- `NEXT_PUBLIC_AI_TUTOR_API_TOKEN`: optional, if backend auth is enabled

If `NEXT_PUBLIC_AI_TUTOR_API_BASE_URL` is not set, the app resolves API base in this order:
1. Same-origin in browser (`window.location.origin`)
2. `https://${VERCEL_URL}` on server side
3. Local fallback `http://127.0.0.1:8099` for dev
