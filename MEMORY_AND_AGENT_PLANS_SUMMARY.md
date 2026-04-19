# Memory and Agent Implementation Plans Summary

Date: 2026-04-13

This summary consolidates implementation-plan intent from the workspace memory folder and agent workflow folders.

## Scope Included
- memory/*.md plan, roadmap, task, checklist, and readiness documents
- .agent/workflows/implementation.md
- .codex/production-readiness-plan.md

## A. Memory Folder Plan Summary

### A1. Strategic Direction
- Keep translation honest: AI-Tutor is a staged OpenMAIC-to-Rust/Next architecture translation, not full parity yet.
- Execute backend-first to stabilize contracts before deep frontend runtime behavior.
- Prioritize production-truth over optimistic status claims.

### A2. Confirmed Completed Foundation
- Domain contracts are in place across lesson, scene, action, runtime, and job models.
- Provider registry/config/model-resolution foundations exist.
- Multi-provider LLM support is present with resilient fallback/circuit-breaker behavior.
- Generation pipeline exists and already includes repair/fallback and partial media request handling.
- Queue/job/runtime persistence now supports file plus SQLite paths with cancellation/resume and lease-safety progress.
- Runtime and SSE surfaces exist, including streaming event and action-lifecycle improvements.

### A3. Major Remaining Gaps (Cross-File Consensus)
- Full production parity still missing in these areas:
  - richer streaming-first runtime semantics end-to-end
  - stronger typed tool/action streaming parity beyond parser-led fallback
  - deeper whiteboard/action runtime parity under all playback/live paths
  - complete subscription lifecycle, refund/reversal, and entitlement correctness
  - production-grade persistence and queue architecture beyond local-first patterns
  - full observability and operational control loops (tracing, cost telemetry, alert readiness)
  - full ASR/voice-mode capabilities

### A4. Execution Priority (Condensed)
1. Harden core generation parity and structured recovery paths.
2. Complete runtime streaming and action execution parity.
3. Finish whiteboard/state parity across playback and live discussion.
4. Complete billing/subscription lifecycle truth and entitlement behavior.
5. Finalize production persistence/queue posture and operational telemetry.
6. Complete frontend runtime consumption parity and E2E validation.

### A5. Current Readiness Position
- Foundation: complete.
- Working vertical slice: complete.
- Production-complete architecture translation: not yet complete.

## B. Agent Folder Plan Summary

### B1. .agent/workflows/implementation.md
Core intent:
- Enforce architecture-first implementation discipline.
- Require reading current system maps and entry points before coding.
- Prevent false completion claims for AI-Tutor translation status.
- Mandate per-surface verification commands after each logical unit.

Operational rules emphasized:
- Respect current ownership boundaries (backend/frontend/mobile/landing/AI-tutor workspaces).
- Do not rely on deprecated entry points.
- Keep documentation synchronized with architectural truth.

### B2. .codex/production-readiness-plan.md
Core intent:
- Keep production work anchored in currently active product surfaces.
- Treat AI-Tutor workspaces as translation stage, not production-integrated paths.
- Sequence work by stability first, then translation depth, then integration.

Primary themes:
- backend hardening
- frontend stability
- AI tutor translation readiness with honest gatekeeping

### B3. Agent-Plan Synthesis
Combined policy from both files:
- Understand first, implement second, verify continuously.
- Never overstate parity or readiness.
- Preserve existing product stability while extending architecture.
- Use strict build/test gates per touched subsystem.

## C. Recommended Next Operating Use
- Use this file as the single high-level index for memory and agent plans.
- Keep detailed source plans for implementation-level evidence and command history.
- Update this summary whenever readiness status or priority order changes materially.
