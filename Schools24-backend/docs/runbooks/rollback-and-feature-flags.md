# Rollback & Feature Flags Runbook

## Feature Flags

| Flag | Env Variable | Default | Purpose |
|------|-------------|---------|---------|
| Interop enabled | `INTEROP_ENABLED` | `false` | Controls live API calls to external systems |
| DLQ retry sweeper | `INTEROP_RETRY_SWEEP_ENABLED` | `true` | Periodic retry of failed jobs |
| Max retries | `INTEROP_MAX_RETRIES` | `3` | Per-job retry limit |

## Rollback Procedures

### 1. Disable Interop (No Downtime)
```bash
INTEROP_ENABLED=false
# Restart server — existing dry-run jobs continue working
```

### 2. Rollback Consent/DSR Migrations
```sql
-- CAUTION: Only if no data has been written

-- Rollback 072 (audit events)
DROP TABLE IF EXISTS consent_audit_events;

-- Rollback 071 (DSR)
DROP TABLE IF EXISTS data_subject_requests;

-- Rollback 070 (consent lifecycle columns)
ALTER TABLE parental_consents
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS withdrawn_at,
  DROP COLUMN IF EXISTS withdrawn_by,
  DROP COLUMN IF EXISTS withdrawal_reason,
  DROP COLUMN IF EXISTS withdrawal_method;
```

### 3. Rollback Idempotency Key
```sql
DROP INDEX IF EXISTS idx_interop_jobs_idempotency_key;
ALTER TABLE interop_jobs DROP COLUMN IF EXISTS idempotency_key;
```

### 4. Rollback Identity Verification
```sql
DROP INDEX IF EXISTS idx_students_verification_status;
ALTER TABLE students
  DROP COLUMN IF EXISTS apaar_verified_at,
  DROP COLUMN IF EXISTS abc_verified_at,
  DROP COLUMN IF EXISTS identity_verification_status;
```

## Pre-Rollback Checklist
- [ ] Confirm no active DSR requests are in flight
- [ ] Export audit events for compliance record
- [ ] Notify affected admins
- [ ] Back up tables before dropping

## Post-Rollback Verification
- [ ] `go build ./...` passes
- [ ] Existing routes return expected responses
- [ ] No 500 errors in logs for 15 minutes
- [ ] Interop dry-run still works (if interop module kept)
