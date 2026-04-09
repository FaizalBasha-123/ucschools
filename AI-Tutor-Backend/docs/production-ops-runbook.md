# AI Tutor Production Ops Runbook

This runbook defines the minimum production gates for the Rust tutor backend.

## 1. Security Baseline

- Enable API auth:
  - set `AI_TUTOR_API_SECRET` (legacy admin token), or
  - set `AI_TUTOR_API_TOKENS` with explicit roles (`reader`, `writer`, `admin`)
- Enable HTTPS enforcement at API edge:
  - set `AI_TUTOR_REQUIRE_HTTPS=1`
  - ensure proxy sends `X-Forwarded-Proto=https`
- Use object storage for generated assets:
  - set `AI_TUTOR_ASSET_STORE=r2`
  - keep `AI_TUTOR_ALLOW_INSECURE_R2` unset in production

## 2. Multi-Instance Queue Ownership

- Set explicit worker identity:
  - `AI_TUTOR_QUEUE_WORKER_ID=<unique-instance-id>`
- Enable worker-id hardening warning:
  - `AI_TUTOR_QUEUE_REQUIRE_EXPLICIT_WORKER_ID=1`
- Recommended backend stores for scale:
  - `AI_TUTOR_QUEUE_DB_PATH`
  - `AI_TUTOR_JOB_DB_PATH`
  - `AI_TUTOR_RUNTIME_DB_PATH`
  - `AI_TUTOR_LESSON_DB_PATH`

## 3. Observability and Alerting

- Poll `/api/system/status` and alert on:
  - `runtime_alert_level != "ok"`
  - `queue_stale_leases > 0`
  - provider unavailability/high failure/high latency alerts
- Poll `/api/system/ops-gate` for rollout automation:
  - `pass=true` required for canary promotion
  - use `AI_TUTOR_OPS_GATE_STRICT=1` in production to enforce DB/object-storage checks
- Optional hardening alerts:
  - set `AI_TUTOR_PRODUCTION_HARDENING_ALERTS=1`
  - this surfaces auth/https/asset-backend/worker-id warnings in `runtime_alerts`

## 4. Canary and Rollback

- Canary rollout:
  - route 5% traffic to new version
  - hold for 15 minutes minimum
  - check `/api/system/status` alert level, queue stale leases, provider failures, and p95 latency
- Promote to 100% only if stable.
- Rollback trigger:
  - `runtime_alert_level` degraded for >5 minutes or SLA breach.
- Rollback method:
  - redeploy previous image/tag
  - verify `/api/health` and `/api/system/status`

## 5. Disaster Recovery Drills

- Quarterly drill minimum:
  1. simulate region/service outage
  2. restore backend from infra IaC + env secrets
  3. restore DB-backed queue/runtime stores from backup
  4. validate lesson/job retrieval and runtime chat stream
- Record:
  - RTO (recovery time objective)
  - RPO (recovery point objective)
  - action items for next cycle

## 6. Current Known Limits (Honest)

- Safekeeper is improved but not consensus-complete.
- Remote object storage is available, but DR-grade fault injection coverage is still expanding.
- Full autoscaling ownership fencing and automated signal pipelines still need further hardening work.
