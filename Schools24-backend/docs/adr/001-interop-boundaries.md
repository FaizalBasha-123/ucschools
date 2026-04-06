# ADR-001: Interop Service Boundaries

**Status:** Accepted  
**Date:** 2026-03-18  
**Decision-makers:** Schools24 Platform Engineering  

## Context

Schools24 integrates with India's NDEAR ecosystem (DIKSHA, DigiLocker, APAAR/ABC) via
a dedicated interop module. This ADR records the current service boundaries so that
future compliance and governance PRs can introduce changes diff-safely.

## Current Architecture

### Module Ownership

| Module | Responsibilities | Touches Interop? |
|--------|-----------------|------------------|
| `interop` | Job orchestration, DLQ, signed requests, sweeper | **Owner** |
| `admin` | Transfer initiation, gov-sync trigger, reconciliation scan | Consumer |
| `school` | UDISE codes, school registry | Data source |
| `student` | Learner profiles, federated IDs | Data source |
| `auth` | JWT, sessions, CSRF | No |
| `chat`, `academic`, `transport`, `operations` | Domain features | No |

### Route Wiring (as of 2026-03-18)

**Admin routes** (`/api/v1/admin/...`, roles: `admin`, `super_admin`):

| Method | Path | Handler |
|--------|------|---------|
| GET | `/admin/interop/readiness` | `interopHandler.GetReadiness` |
| GET | `/admin/interop/sweeper/stats` | `interopHandler.GetSweeperStats` |
| GET | `/admin/interop/jobs` | `interopHandler.ListJobs` |
| GET | `/admin/interop/jobs/:id` | `interopHandler.GetJob` |
| POST | `/admin/interop/jobs` | `interopHandler.CreateJob` |
| POST | `/admin/interop/jobs/:id/retry` | `interopHandler.RetryJob` |
| GET | `/admin/transfers/destination-schools` | `adminHandler.ListTransferDestinationSchools` |
| GET | `/admin/transfers` | `adminHandler.ListLearnerTransfers` |
| POST | `/admin/transfers` | `adminHandler.InitiateLearnerTransfer` |
| POST | `/admin/transfers/:id/complete` | `adminHandler.CompleteLearnerTransfer` |
| PUT | `/admin/transfers/:id/review` | `adminHandler.ReviewLearnerTransfer` |
| POST | `/admin/transfers/:id/gov-sync` | `adminHandler.TriggerTransferGovSync` |
| POST | `/admin/transfers/:id/gov-sync/retry` | `adminHandler.RetryTransferGovSync` |

**Super-admin routes** (`/api/v1/super-admin/...`, role: `super_admin`):

| Method | Path | Handler |
|--------|------|---------|
| GET | `/super-admin/interop/readiness` | `interopHandler.GetReadiness` |
| GET | `/super-admin/interop/sweeper/stats` | `interopHandler.GetSweeperStats` |
| GET | `/super-admin/interop/jobs` | `interopHandler.ListJobs` |
| GET | `/super-admin/interop/jobs/:id` | `interopHandler.GetJob` |
| POST | `/super-admin/interop/jobs` | `interopHandler.CreateJob` |
| POST | `/super-admin/interop/jobs/:id/retry` | `interopHandler.RetryJob` |
| GET | `/super-admin/reconciliations` | `adminHandler.ListLearnerReconciliations` |
| POST | `/super-admin/reconciliations/scan` | `adminHandler.ScanLearnerReconciliations` |
| PUT | `/super-admin/reconciliations/:id/review` | `adminHandler.ReviewLearnerReconciliation` |
| PUT | `/super-admin/reconciliations/:id/unmerge` | `adminHandler.UnmergeLearnerReconciliation` |

### Tenant Isolation Model

- `interop_jobs` and `interop_dead_letter_queue` are **tenant-scoped** tables (per-school schema).
- `learners`, `learner_transfer_requests`, `learner_reconciliation_cases`, `learner_merge_history` are **global** tables.
- `parental_consents` is **tenant-scoped**.
- Interop handler uses `resolveSchoolScopeContext()` to set `search_path` per request.
- Super-admin must provide `?school_id=` query parameter; admins use JWT-embedded school ID.

### DLQ Sweeper

Runs as a background goroutine in `main.go` with per-school advisory locks, capped batch sizes,
and configurable interval. Only processes `status='failed'` + non-dry-run jobs.

## Consequences

- All future PRs that add consent, DSR, or verification endpoints MUST follow existing tenant isolation.
- New routes MUST be wired in `main.go` under the appropriate role group.
- Interop module public API is: `NewService`, `NewHandler`, `SweepPendingRetries`.
- Admin module calls interop via `interopService` dependency injection.
