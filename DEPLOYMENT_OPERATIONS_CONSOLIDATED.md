# Deployment and Operations Consolidated Guide

Date: 2026-04-13

This file consolidates deployment, incident response, monitoring, checklist, runcard, and troubleshooting references.

## Source Files Consolidated
- DEPLOYMENT_RUNBOOK.md
- INCIDENT_RESPONSE_PLAYBOOK.md
- MONITORING_DASHBOARD.md
- PRODUCTION_DEPLOYMENT_CHECKLIST.md
- RUNCARD.md
- TROUBLESHOOTING_GUIDE.md

## 1. Pre-Deployment Gate

### Validation
- Backend: cargo test, cargo check, clippy strict.
- Frontend: TypeScript noEmit, lint, production build.
- Startup readiness checks must pass for database, storage, payment, auth, and model providers.

### Configuration
- All production secrets sourced from secure secret store.
- OAuth, payment, and model provider credentials verified.
- Migration plan and rollback plan tested on staging snapshot.

## 2. Recommended Deployment Strategy

### Blue-Green
1. Deploy to green and run smoke checks.
2. Keep blue at 100 percent, green at 0 percent until checks pass.
3. Shift traffic gradually (canary increments).
4. Monitor critical metrics during and after cutover.
5. Keep blue in rollback-ready standby during stabilization window.

### Canary Trigger Rules
- Abort rollout on sustained error-rate spike.
- Abort rollout on payment processing failure spike.
- Abort rollout on generation latency regression above threshold.

## 3. Critical Monitoring Signals

### Tier-1 (Page Immediately)
- API 5xx rate above threshold.
- Database pool exhaustion.
- Payment/webhook failure surge.
- Credit ledger integrity mismatch.

### Tier-2 (Respond Quickly)
- Generation latency p95 degradation.
- SSE disconnect-rate spikes.
- OAuth refresh latency spikes.
- Database query p95 degradation.

### Tier-3 (Daily Product/Operations)
- Active sessions trend.
- Generation success rate.
- Subscription conversion/churn trend.
- Credit consumption anomalies.

## 4. Incident Response Standard

### First 2 Minutes
1. Acknowledge incident.
2. Check health endpoint component statuses.
3. Determine blast radius and severity.
4. Check for recent deployment correlation.

### Fast Path Fixes
- Restart affected service only when safe.
- Recheck health and key metrics.
- If unresolved within 15 minutes, escalate to L3.

### Root-Cause Tracks
- Database: connection pressure, long-running queries, pool exhaustion.
- Cache: availability/memory pressure/stale data.
- Payment: provider status, credentials, idempotency and replay safety.
- Model providers: rate limits, fallback behavior, timeout tuning.

## 5. Rollback Rules
- Keep prior environment hot during stabilization.
- Roll back immediately for critical customer-impacting regressions.
- Validate post-rollback service health and financial correctness.

## 6. Production Troubleshooting Patterns
- Auth/login failures: token validity, provider status, session freshness.
- Generation timeout: provider latency, model fallback, timeout tuning.
- Stream interruption: network path, SSE lifecycle, resume semantics.
- Credit mismatch: ledger audit and webhook replay history.

## 7. Operational Discipline
- Log every command and intervention during incidents.
- Prefer deterministic runbook steps over ad hoc edits.
- Preserve financial correctness over temporary convenience fixes.
- Keep this consolidated file updated after every major process change.
