# Deploy Queue Worker Runbook

## Purpose

Operate and recover the async lesson queue worker in production with predictable startup checks and safe retry behavior.

## Scope

- Backend service: AI-Tutor-Backend
- Queue path: async lesson generation and retries
- Storage modes: filesystem with optional SQLite/Postgres-backed metadata

## Required environment

- `AI_TUTOR_STORAGE_ROOT`
- `AI_TUTOR_BASE_URL`
- `AI_TUTOR_API_SECRET`
- `AI_TUTOR_MODEL` and provider credentials
- Optional queue DB: `AI_TUTOR_QUEUE_DB_PATH`
- Optional Postgres: `AI_TUTOR_NEON_DATABASE_URL` or `AI_TUTOR_POSTGRES_URL`

## Pre-deploy checks

1. Confirm provider API keys are present for the selected model profile.
2. Confirm storage root is writable by the runtime user.
3. If Postgres is enabled, verify connectivity and startup migration success.
4. Confirm `/api/system/status` returns `status=ok` before rollout traffic.

## Deployment procedure

1. Deploy backend image/revision with new config.
2. Wait for health checks to pass on `/health` and `/api/health`.
3. Verify `/api/system/status` queue metrics:
   - `queue_pending_jobs`
   - `queue_active_leases`
   - `queue_stale_leases`
4. Verify logs for absence of repeated startup readiness errors.

## Runtime monitoring

- Alert when `queue_stale_leases > 0` for sustained periods.
- Alert on repeated queue processing failures for same job IDs.
- Alert on persistent growth of pending queue depth.

## Failure recovery

### Symptom: stuck jobs with stale leases

1. Confirm no active worker is processing the same lease.
2. Trigger worker restart.
3. Verify stale lease count returns to 0.
4. Requeue failed snapshots where appropriate.

### Symptom: repeated generation failures for same payload

1. Inspect job error payload in queue records.
2. Validate model/provider credentials and quota.
3. Retry single job after remediation.
4. If systemic, pause ingestion until provider health stabilizes.

## Rollback

1. Roll back to last known good backend revision.
2. Keep storage root and queue DB untouched.
3. Re-run health/status checks.
4. Resume traffic after queue worker stability is confirmed.

## Post-incident verification

1. New jobs transition queued -> running -> completed.
2. No unbounded pending growth.
3. No stale lease accumulation after 2 processing cycles.