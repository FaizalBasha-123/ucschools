# DLQ Retry Operations Runbook

## Overview
The Dead Letter Queue (DLQ) captures interop jobs that have exhausted all retry attempts. The sweeper runs periodically to re-attempt failed jobs.

## Monitoring

### Check Sweeper Stats
```bash
curl -H "Authorization: Bearer $TOKEN" \
  $API_URL/api/v1/admin/interop/sweeper/stats
```

Response:
```json
{
  "runs_total": 142,
  "lock_miss_total": 3,
  "retries_total": 28,
  "errors_total": 2,
  "retry_sweep_enabled": true
}
```

### Key Metrics
| Metric | Alert Threshold | Action |
|--------|----------------|--------|
| `errors_total` increasing | > 5 in 1 hour | Check external system status |
| `lock_miss_total` high | > 10% of runs | Check for competing sweeper instances |
| `retry_sweep_enabled` = false | Always | Re-enable via `INTEROP_RETRY_SWEEP_ENABLED=true` |

## Common Scenarios

### 1. External System Down
**Symptoms:** Multiple jobs stuck in `failed` status with same `last_error`
```bash
curl "$API_URL/api/v1/admin/interop/jobs?status=failed&system=diksha&limit=10"
```

**Resolution:**
1. Verify external system status
2. Wait for recovery
3. Sweeper will auto-retry, or manually retry:
```bash
curl -X POST "$API_URL/api/v1/admin/interop/jobs/$JOB_ID/retry"
```

### 2. Stale DLQ Entries
**Symptoms:** Old entries with `status=failed` not clearing
```bash
# Find stale entries (> 7 days)
SELECT id, system, operation, last_error, updated_at
FROM interop_jobs
WHERE status = 'failed' AND updated_at < NOW() - INTERVAL '7 days';
```

### 3. Sweeper Lock Contention
**Symptoms:** `lock_miss_total` increasing rapidly
**Root Cause:** Multiple server instances running sweeper
**Fix:** Ensure advisory lock is acquired properly; check `pg_advisory_lock` usage

## Emergency: Disable Sweeper
```bash
# Set env var and restart
INTEROP_RETRY_SWEEP_ENABLED=false
```
