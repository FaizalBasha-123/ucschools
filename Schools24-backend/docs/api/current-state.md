# Current-State API Snapshot

**Generated:** 2026-03-18  
**Purpose:** Lock current endpoint behavior before NDEAR compliance changes.

---

## Public Endpoints (No Auth)

| Method | Path | Module | Notes |
|--------|------|--------|-------|
| GET | `/health` | core | Service health |
| GET | `/ready` | core | Readiness (DB + cache) |
| POST | `/api/v1/auth/login` | auth | Rate-limited per IP |
| GET | `/api/v1/auth/csrf` | auth | CSRF token |
| POST | `/api/v1/auth/refresh` | auth | Token refresh |
| POST | `/api/v1/auth/logout` | auth | Session logout |
| GET | `/api/v1/public/admission/:slug` | public | Admission form info |
| POST | `/api/v1/public/admission/:slug` | public | Submit admission |
| GET | `/api/v1/public/teacher-appointments/:slug` | public | Teacher appointment info |
| POST | `/api/v1/public/teacher-appointments/:slug` | public | Submit teacher appointment |
| POST | `/api/v1/public/support/tickets` | support | Public ticket |
| GET | `/api/v1/public/blogs` | blog | Published blogs |
| GET | `/api/v1/public/blogs/:slug` | blog | Blog by slug |

## WebSocket/SSE Endpoints

| Method | Path | Module | Auth |
|--------|------|--------|------|
| GET | `/api/v1/chat/ws` | chat | Query param |
| GET | `/api/v1/teacher/ws` | teacher | Query param |
| GET | `/api/v1/transport/driver/ws` | transport | Query param |
| GET | `/api/v1/transport/track/:routeID` | transport | SSE |
| GET | `/api/v1/transport/admin-live/ws` | transport | Query param |
| GET | `/api/v1/super-admin/support/ws` | support | Query param |
| GET | `/api/v1/admin/admissions/ws` | admin | Query param |

## Protected: Auth

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/v1/auth/me` | All |
| PUT | `/api/v1/auth/me` | All |
| POST | `/api/v1/auth/change-password` | All |
| GET | `/api/v1/auth/ws-ticket` | All |
| POST | `/api/v1/auth/push-tokens` | All |
| DELETE | `/api/v1/auth/push-tokens` | All |
| POST | `/api/v1/auth/push-tokens/test` | All |

## Protected: Super Admin Only

| Method | Path | Handler/Purpose |
|--------|------|-----------------|
| POST | `/super-admin/register` | Create user accounts |
| POST/GET/PUT/DELETE | `/super-admin/schools*` | School CRUD + trash/restore |
| GET/POST/PUT/DELETE | `/super-admin/catalog/*` | Global classes + subjects |
| GET/POST/PUT/DELETE | `/super-admin/quizzes/*` | Global quiz management |
| GET/POST/DELETE | `/super-admin/materials/*` | Study materials |
| GET/POST/DELETE | `/super-admin/question-documents/*` | Question docs |
| GET/PUT | `/super-admin/settings/global` | Global settings |
| GET/POST/PUT/DELETE | `/super-admin/blogs/*` | Blog management |
| GET | `/super-admin/analytics/monthly-users` | Analytics |
| GET | `/super-admin/storage/overview` | Storage stats |
| POST | `/super-admin/schema` | DB schema introspection |

### Super Admin — Interop (6 routes)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/super-admin/interop/readiness` | `interopHandler.GetReadiness` |
| GET | `/super-admin/interop/sweeper/stats` | `interopHandler.GetSweeperStats` |
| GET | `/super-admin/interop/jobs` | `interopHandler.ListJobs` |
| GET | `/super-admin/interop/jobs/:id` | `interopHandler.GetJob` |
| POST | `/super-admin/interop/jobs` | `interopHandler.CreateJob` |
| POST | `/super-admin/interop/jobs/:id/retry` | `interopHandler.RetryJob` |

### Super Admin — Reconciliation (4 routes)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/super-admin/reconciliations` | `adminHandler.ListLearnerReconciliations` |
| POST | `/super-admin/reconciliations/scan` | `adminHandler.ScanLearnerReconciliations` |
| PUT | `/super-admin/reconciliations/:id/review` | `adminHandler.ReviewLearnerReconciliation` |
| PUT | `/super-admin/reconciliations/:id/unmerge` | `adminHandler.UnmergeLearnerReconciliation` |

## Protected: Admin (admin + super_admin)

### Core Admin

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/dashboard` | Dashboard stats |
| GET/POST/PUT/DELETE | `/admin/users*` | User CRUD + suspend |
| POST/GET/PUT/DELETE | `/admin/students*` | Student CRUD |
| POST/GET/PUT/DELETE | `/admin/teachers*` | Teacher CRUD |
| GET/POST/PUT/DELETE | `/admin/staff*` | Staff CRUD |
| GET/POST | `/admin/fees/*` | Fee structures, demands, payments |
| GET/POST/PUT/DELETE | `/admin/assessments*` | Assessment CRUD |
| GET/POST/PUT/DELETE | `/admin/events*` | Events CRUD |
| GET/POST/PUT/DELETE | `/admin/bus-routes*` | Bus route CRUD + stops |
| GET/POST/PUT/DELETE | `/admin/transport/*` | Transport sessions + schedules |
| GET/PUT | `/admin/timetable/*` | Timetable management |
| GET/POST/PUT/DELETE | `/admin/inventory*` | Inventory CRUD |
| GET/PUT | `/admin/admissions*` | Admission management |
| GET/PUT | `/admin/teacher-appointments*` | Teacher appointment management |
| GET/PUT | `/admin/settings/admissions` | Admission settings |

### Admin — Transfers (7 routes)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/admin/transfers/destination-schools` | `adminHandler.ListTransferDestinationSchools` |
| GET | `/admin/transfers` | `adminHandler.ListLearnerTransfers` |
| POST | `/admin/transfers` | `adminHandler.InitiateLearnerTransfer` |
| POST | `/admin/transfers/:id/complete` | `adminHandler.CompleteLearnerTransfer` |
| PUT | `/admin/transfers/:id/review` | `adminHandler.ReviewLearnerTransfer` |
| POST | `/admin/transfers/:id/gov-sync` | `adminHandler.TriggerTransferGovSync` |
| POST | `/admin/transfers/:id/gov-sync/retry` | `adminHandler.RetryTransferGovSync` |

### Admin — Interop (6 routes)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/admin/interop/readiness` | `interopHandler.GetReadiness` |
| GET | `/admin/interop/sweeper/stats` | `interopHandler.GetSweeperStats` |
| GET | `/admin/interop/jobs` | `interopHandler.ListJobs` |
| GET | `/admin/interop/jobs/:id` | `interopHandler.GetJob` |
| POST | `/admin/interop/jobs` | `interopHandler.CreateJob` |
| POST | `/admin/interop/jobs/:id/retry` | `interopHandler.RetryJob` |

## Endpoints Implemented Since Snapshot

| Category | Delivered In | Notes |
|----------|--------------|-------|
| Consent history/withdrawal | PR-03 | Admin + super-admin endpoints added |
| Data Subject Requests (DSR) | PR-03 | Create/list/detail/status APIs added |
| Consent audit events | PR-03 | Audit listing endpoint added |
| Federated identity verification | PR-04 | Verify/identity/unverified/summary APIs added |
| Versioning baseline | PR-05 | Existing routes remain under `/api/v1/` |
| Idempotency key support | PR-05 | `X-Idempotency-Key` extraction and DB uniqueness added |
| OpenAPI specs | PR-08 | Interop + consent/DSR + reconciliation specs added |

## Database Schema Summary

### Global Tables (public schema)
- `schools`, `super_admins`, `learners`, `learner_enrollments`
- `learner_transfer_requests`, `learner_reconciliation_cases`, `learner_merge_history`
- `global_classes`, `global_subjects`, `global_settings`, `blog_posts`
- `auth_sessions`, `push_device_tokens`, `support_tickets`

### Tenant Tables (per school_<uuid> schema)
- `users`, `students`, `teachers`, `non_teaching_staff`, `classes`, `subjects`
- `attendance`, `assessments`, `fees`, `events`, `homework`, `quizzes`
- `parental_consents` (064), `student_federated_ids` (065)
- `interop_jobs` (068), `interop_dead_letter_queue` (068)
- NDEAR phase migrations: `070` through `074`
