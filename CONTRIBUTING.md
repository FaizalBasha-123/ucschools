# Contributing to AI Tutor

Thank you for your interest in contributing to AI Tutor. This project is
proprietary software (see [LICENSE](./LICENSE)), so contribution rights are
limited to authorized collaborators only. This document describes how
authorized contributors should work on the repository.

## Repository Access

Contributions are accepted only from collaborators who have been explicitly
granted write access by the repository owner
([FaizalBasha-123](https://github.com/FaizalBasha-123)). If you are not a
collaborator and would like to propose a change, open an issue describing the
problem and your suggested fix; the owner will evaluate whether to implement it
or grant access.

## Project Layout

```
aitutor/
├── AI-Tutor-Backend/      # Rust workspace (api, orchestrator, providers, routing, storage)
├── AI-Tutor-Frontend/     # pnpm monorepo (Next.js web app + internal packages)
└── docs/                  # Architecture and implementation documentation
```

- Backend code lives under `AI-Tutor-Backend/crates/`.
- Frontend code lives under `AI-Tutor-Frontend/apps/web/`.
- Architecture docs live under `docs/` (see `docs/README.md` for the index).

## Before You Start

- Work on the `main` branch for the current development line. If the owner
  directs you to a feature branch, use it.
- Pull the latest before starting: `git pull --rebase`.

## Code Standards

### Backend (Rust)

- Format with `cargo fmt` before committing.
- Lint with `cargo clippy -- -D warnings`; resolve all warnings.
- Keep modules small and focused. The `crates/api/src/app.rs` router file is
  intentionally kept as a route table only — put handlers and logic in their
  own modules, not inline in `app.rs`.
- Do not commit the `target/` directory (it is git-ignored).

### Frontend (TypeScript / React / Next.js)

- Format with the project's Prettier/ESLint config.
- Type-check with `tsc --noEmit` (or `pnpm --filter ai-tutor-web build`).
- Run tests for any route or component you touch. For example, for the PBL chat
  route:
  ```bash
  pnpm --filter ai-tutor-web test \
    app/api/pbl/chat/route.test.ts
  ```
- Component tests colocate alongside the component
  (e.g. `scene-checkin-widget.test.ts`).
- Do not commit `node_modules/`, `.next/`, or `*.tsbuildinfo` (all git-ignored).

### Documentation

- When you change architecture, routing, or module boundaries, update the
  matching file under `docs/` (see `docs/README.md` for the file map).
- Keep docs in sync with code — a PR that changes behavior must update the
  relevant doc, or call out in the description that the doc update is pending.

## Testing

Run the touched test files directly rather than the whole suite when your
change is focused:

- Frontend route test:
  ```bash
  pnpm --filter ai-tutor-web test \
    AI-Tutor-Frontend/apps/web/app/api/pbl/chat/route.test.ts
  ```
- Backend tests:
  ```bash
  cd AI-Tutor-Backend && cargo test
  ```

Ensure all tests pass before pushing. If a test is genuinely stale and needs
updating, update it in the same change and explain why in the commit message.

## Commit Messages

Use a concise summary line, optionally followed by a blank line and a body:

```
type: short description

- Bullet point details
- Why the change was made
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

Example:
```
fix: update pbl/chat route test for SSE streaming endpoint

- Switch assertions to chat-stream SSE response
- Normalize header casing to match authHeadersFrom()
```

## Submitting Changes

1. Stage only the files relevant to your change. Do **not** run
   `git add -A` blindly — the repo root contains sibling projects and build
   artifacts that must not be committed (see `.gitignore`).
2. Verify no ignored content (node_modules, target, .next, *.deb) is staged:
   ```bash
   git diff --cached --name-only | grep -Ei \
     'node_modules|\.next/|target/|tsbuildinfo|\.deb|OpenMAIC|graphbit|zeroclaw'
   # This should print nothing.
   ```
3. Commit with a descriptive message following the format above.
4. Push to the agreed-upon branch.

## Confidentiality

The source code in this repository is proprietary and confidential per the
[License](./LICENSE). Do not share, publish, or redistribute the code or any
derivative works outside the scope of your authorized access.

## Questions

For access requests or licensing questions, contact the repository owner via
GitHub: https://github.com/FaizalBasha-123
