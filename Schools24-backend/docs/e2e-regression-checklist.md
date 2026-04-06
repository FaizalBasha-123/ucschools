# NDEAR Phase — E2E Regression Checklist

## Pre-Release Validation

### Build Gates
- [ ] `go build ./...` — exit code 0
- [ ] `npx tsc --noEmit` — exit code 0
- [ ] All migrations run idempotently (re-run without error)

---

### PR-01: ADR Lock
- [ ] ADR files exist at `docs/adr/001-*.md`, `002-*.md`, `003-*.md`
- [ ] API snapshot at `docs/api/current-state.md`
- [ ] Delta checklist at `docs/api/ndear-delta-checklist.md`

### PR-02: DB Foundations
- [ ] Migration 070: `parental_consents` has `status`, `withdrawn_at/by/reason/method` columns
- [ ] Migration 071: `data_subject_requests` table exists with correct constraints
- [ ] Migration 072: `consent_audit_events` table exists (append-only)
- [ ] All migrations are idempotent (run twice without error)

### PR-03: Backend Consent + DSR
- [ ] `GET /admin/consent/history` returns consent records
- [ ] `POST /admin/consent/:id/withdraw` transitions status to `withdrawn`
- [ ] Double withdrawal returns error (idempotent guard)
- [ ] `POST /admin/dsr` creates a new DSR ticket
- [ ] DSR state machine enforced: submitted → under_review → approved → completed
- [ ] Invalid state transitions rejected with 400
- [ ] `GET /admin/consent/audit` returns events
- [ ] All routes also work under `/super-admin/` prefix

### PR-04: Federated Identity + Reconciliation
- [ ] `POST /admin/learners/:id/verify` verifies APAAR/ABC IDs
- [ ] Dry-run mode returns result without persisting
- [ ] `GET /admin/learners/unverified` lists students needing verification
- [ ] `GET /admin/reconciliations/summary` returns counts
- [ ] Student not found returns 404

### PR-05: API Governance
- [ ] Migration 073: `idempotency_key` column exists on `interop_jobs`
- [ ] Sending same `X-Idempotency-Key` twice returns cached job (no duplicate)
- [ ] Error responses match structured format: `{"error": {"code": "...", "message": "..."}}`
- [ ] Existing job creation without idempotency key still works

### PR-06: Frontend Compliance Console
- [ ] `/admin/compliance` page renders
- [ ] Sidebar shows "Compliance" nav item for admin role
- [ ] Overview tab shows 4 summary cards
- [ ] Consent tab lists records with status filter
- [ ] DSR tab shows tickets with status transitions
- [ ] Identity tab shows unverified students
- [ ] Audit tab shows event log

### PR-07: Cookie Truth
- [ ] Cookie banner says "essential cookies only" (no analytics/marketing toggles)
- [ ] No `gtag()` or GA script loaded in app (verify in DevTools Network tab)
- [ ] Landing site: GA only loads after explicit consent
- [ ] Cookie policy page text matches runtime behavior

### PR-08: OpenAPI + Contract Docs
- [ ] OpenAPI specs exist: `interop.yaml`, `consent-dsr.yaml`, `reconciliation.yaml`
- [ ] `api-versioning.md` documents error codes and migration path
- [ ] Specs match actual route behavior

### PR-09: Observability
- [ ] Runbooks exist: `dlq-retry-ops.md`, `consent-withdrawal-incidents.md`, `dsr-sla-management.md`, `rollback-and-feature-flags.md`
- [ ] No PII in log statements (grep for email/phone patterns in log.Printf calls)

### PR-10: Final Hardening
- [ ] This checklist completed
- [ ] All routes return expected HTTP status codes
- [ ] No 500 errors during smoke test

---

## Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| Developer | | | |
| Reviewer | | | |
| QA | | | |

## Notes
- Interop is disabled by default (`INTEROP_ENABLED=false`). Enable only after external system credentials are provisioned.
- DSR SLA clock starts at `submitted_at`. Monitor via `dsr-sla-management.md` queries.
- Cookie consent changes are frontend-only; no backend cookie logic exists.
