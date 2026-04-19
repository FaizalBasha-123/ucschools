# Backup And Restore Failure Runbook

## Purpose

Provide a deterministic response when backup validation or restore execution fails for AI Tutor backend data.

## Data surfaces to protect

- Lesson/job/runtime metadata under `AI_TUTOR_STORAGE_ROOT`
- Queue snapshots and runtime state files
- SQLite databases (if enabled)
- Postgres state (if enabled): accounts, credits, billing, subscriptions

## Backup policy baseline

1. Daily full snapshot of storage root.
2. Hourly incremental backup for DB-backed state where available.
3. Weekly restore drill in non-production environment.

## Failure types

### A. Backup job failed

1. Capture failure timestamp and host/revision.
2. Check disk space and object-store quota.
3. Re-run backup job once after fixing infra issue.
4. If second attempt fails, escalate to incident and freeze risky migrations.

### B. Restore succeeded partially

1. Stop write traffic to affected backend instance.
2. Validate integrity of:
   - lesson/job tables/files
   - queue state
   - billing/credits/subscriptions
3. Re-run restore from previous known-good backup point.
4. Run consistency checks before reopening traffic.

### C. Restore checksum mismatch

1. Reject restored artifact.
2. Select earlier backup generation.
3. Verify checksum chain and storage-provider audit logs.
4. Escalate security review if tampering is suspected.

## Verification checklist after restore

1. `/health` and `/api/health` return OK.
2. `/api/system/status` shows stable queue/provider metrics.
3. Sample reads succeed for:
   - recent lessons
   - recent jobs
   - runtime sessions
   - billing/credit records
4. New lesson generation works end-to-end.
5. No elevated error rate in first 30 minutes after traffic reopen.

## Roll-forward guardrails

- Do not run schema migrations until restore validation completes.
- Do not resume async queue worker until job/runtime consistency checks pass.
- Keep incident timeline with exact backup artifact IDs used for recovery.

## Escalation triggers

- Two consecutive restore attempts fail.
- Billing/credit integrity cannot be confirmed.
- Queue state cannot be reconciled to a safe processing baseline.