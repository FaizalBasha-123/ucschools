# NDEAR Delta Checklist

**Purpose:** Track all changes introduced by the NDEAR compliance PR series.  
**Generated:** 2026-03-18  

## PR-02: DB Foundations for Consent Lifecycle + DSR

- [ ] **Migration 070**: Extend `parental_consents` — add `withdrawn_at`, `withdrawn_by`, `withdrawal_reason`, `withdrawal_method`, `status`
- [ ] **Migration 071**: New `data_subject_requests` table — DSR ticket lifecycle
- [ ] **Migration 072**: New `consent_audit_events` table — immutable audit log
- [ ] No runtime code changes
- [ ] Verify existing `parental_consents` queries still work

## PR-03: Backend Consent + DSR Endpoints

- [ ] New files: `consent_models.go`, `consent_repository.go`, `consent_service.go`, `consent_handler.go`
- [ ] New admin routes: `/admin/consent/history`, `/admin/consent/:id/withdraw`, `/admin/dsr`, `/admin/dsr/:id`, `/admin/dsr/:id/status`, `/admin/consent/audit`
- [ ] Wire routes in `main.go` under `adminRoutes` and `superAdminRoutes`
- [ ] Role enforcement: `admin`, `super_admin` only
- [ ] Tenant scope enforcement via `middleware.GetSchoolID(c)`
- [ ] First `*_test.go` files in the backend

## PR-04: Federated Identity Verification + Reconciliation Hardening

- [ ] New files: `reconciliation_models.go`, `reconciliation_repository.go`, `reconciliation_handler.go`
- [ ] New admin routes: `/admin/learners/:id/verify`, `/admin/reconciliations`, `/admin/reconciliations/:id`, `/admin/reconciliations/:id/resolve`
- [ ] Wire routes in `main.go`
- [ ] Audit events for conflict resolution actions

## PR-05: Interop API Governance

- [ ] **Migration 073**: Add `idempotency_key` to `interop_jobs`
- [ ] Modified: `interop/handler.go` — idempotency header, error contract
- [ ] Modified: `interop/service.go` — idempotency check before `CreateJob`
- [ ] Modified: `interop/repository.go` — `FindJobByIdempotencyKey`
- [ ] New: `interop/errors.go` — structured error types
- [ ] Versioned route validation

## PR-06: Frontend Admin Compliance Console

- [ ] New pages: `admin/compliance/*` (consent, DSR, reconciliation)
- [ ] New: `services/complianceApi.ts`, `hooks/useCompliance.ts`, `types/compliance.ts`
- [ ] Admin layout navigation update
- [ ] No backend changes

## PR-07: Cookie Truth Alignment

- [ ] Modified: `CookieConsent.tsx` — remove analytics/marketing toggles, add policyVersion
- [ ] Modified: `cookie-policy/page.tsx` — align text with essential-only reality
- [ ] Modified: `CookieConsentBanner.tsx` (landing) — minor text alignment
- [ ] Verified: `cookieConsent.ts` (landing) — GA consent-gating correct
- [ ] No backend changes

## PR-08: OpenAPI + Contract Tests

- [ ] New: `docs/api/openapi/interop.yaml`
- [ ] New: `docs/api/openapi/consent-dsr.yaml`
- [ ] New: `docs/api/openapi/reconciliation.yaml`
- [ ] New: Backend contract test files
- [ ] New: `docs/api-versioning.md`

## PR-09: Observability + Ops Runbook

- [ ] Modified: Service files — structured logging for consent/DSR/interop events
- [ ] New: `docs/runbooks/*.md` (4 runbook files)
- [ ] PII audit on all log statements

## PR-10: Final Hardening + E2E Regression Gate

- [ ] E2E tests for transfer + gov-sync + retry
- [ ] E2E tests for consent withdrawal lifecycle
- [ ] E2E tests for DSR lifecycle
- [ ] E2E tests for cookie consent behavior
- [ ] Release checklist document
