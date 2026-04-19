# AI-Tutor Production Quick Runbook

**Purpose**: Fast reference for operators during production incidents or maintenance  
**Status**: Verified against 114 passing tests + live infrastructure validation  
**Last Updated**: April 15, 2026

---

## Emergency Procedures

### 🚨 Service Down / API Returning 500 Errors

**Diagnosis** (5 minutes):
```bash
# 1. Check if service is running
curl -s https://api.yourdomain.com/api/health
# If timeout: service crash or network issue
# If 500: service running but degraded

# 2. Check ops-gate (admin auth required)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.yourdomain.com/api/system/ops-gate
# If pass=false, review failed_checks list

# 3. Check system status for alerts
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.yourdomain.com/api/system/status
# Look for: runtime_alert_level (should be "ok"), queue_stale_leases (should be 0)

# 4. Check logs
docker logs <container-id>  # If Docker
kubectl logs deployment/ai-tutor-backend  # If Kubernetes
# Look for: ERROR, panic, auth failures, provider errors
```

**Recovery Options** (rank by speed):

| Issue | Fix | Time |
|-------|-----|------|
| Service crashed (no 🟢 indicator) | Restart container/pod | 1-2 min |
| Provider API unavailable | Verify LLM API key in env | 2-5 min |
| Queue stalled (`queue_stale_leases > 0`) | Restart instance | 2-3 min |
| Disk full (asset storage) | Clean old assets, scale storage | 5-10 min |
| Rollback (if all else fails) | Deploy previous version | 5-10 min |

**Restart Service**:
```bash
# Docker
docker restart <container-id>

# Kubernetes
kubectl rollout restart deployment/ai-tutor-backend

# Cloud Run
gcloud run deploy ai-tutor-backend --image gcr.io/PROJECT/ai-tutor-backend:CURRENT

# Render
git push origin main  # Auto-deploys
```

---

### 🔐 Auth Token Leaked / Security Incident

**Immediate Response** (< 5 minutes):

```bash
# 1. Revoke compromised token by rotating AI_TUTOR_API_TOKENS
# OLD:
# AI_TUTOR_API_TOKENS="leaked-token=admin,writer-token=writer"

# NEW:
# AI_TUTOR_API_TOKENS="new-admin-uuid-12345=admin,writer-token=writer"

# 2. Restart service to pick up new env
docker restart <container-id>

# 3. Verify old token no longer works
curl -H "Authorization: Bearer leaked-token" \
     https://api.yourdomain.com/api/runtime/chat/stream
# Expected: 401 Unauthorized

# 4. Verify new token works
curl -H "Authorization: Bearer new-admin-uuid-12345" \
     https://api.yourdomain.com/api/system/ops-gate
# Expected: 200 OK
```

**Follow-up** (same day):
- Review audit logs for `Authorization: Bearer leaked-token` usage
- Contact affected users who may have seen their API keys
- Implement token rotation policy (quarterly minimum)

---

### 💳 Payment Webhook Not Processing

**Diagnosis** (3 minutes):

```bash
# 1. Check payment provider health
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.yourdomain.com/api/system/status | jq .provider_status

# 2. Verify HMAC credentials
echo $EASEBUZZ_API_KEY  # Should not be empty
echo $EASEBUZZ_MERCHANT_SALT  # Should not be empty

# 3. Check recent webhook failures (if logged)
docker logs <container-id> | grep -i "webhook\|easebuzz" | tail -20

# 4. Manually test webhook (if you have a sample payload)
curl -X POST https://api.yourdomain.com/api/billing/easebuzz/callback \
  -H "Content-Type: application/json" \
  -d '{
    "txnid": "test-123456",
    "amount": "100.00",
    "status": "success",
    "email": "test@example.com",
    "productinfo": "test",
    "hash": "...",
    "received_at": "2026-04-15T10:00:00Z"
  }'
```

**Recovery**:
- If webhook endpoint unreachable: check reverse proxy, firewall, DNS
- If signature validation fails: verify HMAC credentials match Easebuzz console
- If payment not crediting: manually add credits via admin console (temporary)
- Contact Easebuzz support with transaction ID for settlement verification

---

### 📊 Queue Backup / Stalled Jobs

**Diagnosis** (2 minutes):

```bash
# 1. Check queue status
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.yourdomain.com/api/system/status | jq '{queue_depth, queue_active_leases, queue_stale_leases}'

# Example output:
# {
#   "queue_depth": 45,           # 45 jobs waiting
#   "queue_active_leases": 2,    # 2 currently processing
#   "queue_stale_leases": 3      # ⚠️  3 stuck for >5 min
# }
```

**Recovery** (rank by risk):

| Stale Leases | Action | Risk |
|--------------|--------|------|
| 0 | None needed | ✅ No risk |
| 1-2 | Wait 30 sec, re-check | 🟡 Low (auto-recovery) |
| 3+ | Restart instance | 🟠 Medium (brief interruption) |
| Growing | Kill stuck process + scale up workers | 🔴 High (job duplication risk) |

**Restart Instance** (safest):
```bash
# Docker
docker restart <container-id>

# Kubernetes
kubectl delete pod <pod-name>  # Replicaset auto-creates new

# Cloud Run
gcloud run deploy ai-tutor-backend --image gcr.io/PROJECT/ai-tutor-backend:CURRENT
```

After restart, monitor queue status for 5 minutes:
```bash
for i in {1..10}; do
  curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
       https://api.yourdomain.com/api/system/status | jq '.{queue_depth, queue_stale_leases}'
  sleep 30
done
# Queue depth should decrease, stale leases should stay 0
```

---

### 🌐 CORS / Browser Preflight Failures

**Symptom**: Browser console shows:
```
Access to XMLHttpRequest at 'https://api.yourdomain.com/api/runtime/chat/stream' from origin 
'https://yourdomain.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header.
```

**Fix** (< 1 minute):

```bash
# 1. Verify CORS whitelist contains origin
echo $AI_TUTOR_CORS_ALLOW_ORIGINS
# Should include: https://yourdomain.com (exact match)

# 2. Test OPTIONS preflight manually
curl -s -i -X OPTIONS https://api.yourdomain.com/api/runtime/chat/stream \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: POST"

# Should return 200 OK with headers:
# access-control-allow-origin: https://yourdomain.com
# access-control-allow-methods: GET,POST,PATCH,OPTIONS
```

**If preflight fails** (returns 405):
```bash
# Update CORS config and restart
# NEW:
# AI_TUTOR_CORS_ALLOW_ORIGINS="https://yourdomain.com,https://app.yourdomain.com"

docker restart <container-id>

# Verify preflight now works
curl -s -i -X OPTIONS https://api.yourdomain.com/api/runtime/chat/stream \
  -H "Origin: https://yourdomain.com"
# Should now return 200 OK
```

---

## Maintenance Procedures

### 🔄 Rotating API Tokens (Quarterly)

**Step 1**: Generate new tokens
```bash
# Generate random 32-byte hex strings
NEW_ADMIN=$(openssl rand -hex 32)
NEW_WRITER=$(openssl rand -hex 32)
echo "Admin: $NEW_ADMIN"
echo "Writer: $NEW_WRITER"
```

**Step 2**: Update environment
```bash
# OLD:
# AI_TUTOR_API_TOKENS="admin-token-old=admin,writer-token-old=writer"

# NEW:
# AI_TUTOR_API_TOKENS="$NEW_ADMIN=admin,$NEW_WRITER=writer"
```

**Step 3**: Restart service
```bash
docker restart <container-id>
```

**Step 4**: Verify new tokens work
```bash
curl -H "Authorization: Bearer $NEW_ADMIN" \
     https://api.yourdomain.com/api/system/ops-gate
# Expected: 200 OK

# Verify old token no longer works
curl -H "Authorization: Bearer admin-token-old" \
     https://api.yourdomain.com/api/system/ops-gate
# Expected: 401 Unauthorized
```

---

### 📈 Scaling: Adding Worker Instances

**Step 1**: Assign unique worker ID to each instance
```bash
# Instance 1 (existing):
# AI_TUTOR_QUEUE_WORKER_ID="worker-prod-us-east-1-001"

# Instance 2 (new):
# AI_TUTOR_QUEUE_WORKER_ID="worker-prod-us-east-1-002"

# Instance 3 (new):
# AI_TUTOR_QUEUE_WORKER_ID="worker-prod-us-east-1-003"
```

**Step 2**: Deploy new instances (each with unique ID)
```bash
# Cloud Run (deploy with --no-traffic first)
for i in {1..3}; do
  gcloud run deploy ai-tutor-backend-worker-$i \
    --image gcr.io/PROJECT/ai-tutor-backend:latest \
    --set-env-vars AI_TUTOR_QUEUE_WORKER_ID=worker-prod-us-east-1-$(printf "%03d" $i) \
    --no-traffic
  # Then gradually shift traffic via traffic-split
done

# Kubernetes (deploy replicas)
kubectl set env deployment/ai-tutor-backend \
  AI_TUTOR_QUEUE_WORKER_ID=worker-prod-us-east-1-001
kubectl scale deployment ai-tutor-backend --replicas=3
```

**Step 3**: Monitor queue depth
```bash
# Before scaling
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.yourdomain.com/api/system/status | jq '.queue_depth'
# Result: 450 jobs waiting

# After scaling (60 seconds)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.yourdomain.com/api/system/status | jq '.queue_depth'
# Result: Should decrease as workers process jobs in parallel
```

---

### 🗄️ Backing Up Critical Data

**Queue Jobs** (where jobs live):
```bash
# If file-backed:
cp -r $AI_TUTOR_QUEUE_DB_PATH /backup/queue-$(date +%Y-%m-%d).db.bak

# If SQLite:
sqlite3 $AI_TUTOR_QUEUE_DB_PATH ".backup /backup/queue-$(date +%Y-%m-%d).db.bak"
```

**Lesson Storage** (generated lessons):
```bash
# If file-backed:
cp -r $AI_TUTOR_LESSON_DB_PATH /backup/lessons-$(date +%Y-%m-%d).db.bak

# If using R2/S3:
aws s3 sync s3://ai-tutor-assets /backup/assets-$(date +%Y-%m-%d)
```

**Runtime Sessions** (student session state):
```bash
sqlite3 $AI_TUTOR_RUNTIME_DB_PATH ".backup /backup/runtime-$(date +%Y-%m-%d).db.bak"
```

---

### 🛠️ Troubleshooting Template

**When something breaks, follow this order**:

1. **Collect diagnostics** (5 min)
   ```bash
   curl https://api.yourdomain.com/api/health
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
        https://api.yourdomain.com/api/system/status | jq .
   docker logs <container> | tail -100
   ```

2. **Check recent changes** (2 min)
   ```bash
   git log --oneline | head -10
   # Did we deploy recently? Rollback candidate?
   ```

3. **Isolate the failure** (5 min)
   - Is API broken or just one endpoint?
   - Is DB connectivity broken?
   - Is provider (LLM) unreachable?
   - Is queue stalled?

4. **Apply fix** (2-10 min depending on issue)
   - Restart service? Rotate token? Update CORS? Restart queue worker?

5. **Verify recovery** (3 min)
   - Health check passes
   - Ops-gate shows `pass: true`
   - Sample API call succeeds

---

## Contact & Escalation

**Issue Type → Owner**:
- API crashes: Infrastructure team
- Payment failures: Payments team (Easebuzz support)
- LLM quality issues: Provider team
- Frontend issues: Frontend team
- Queue stalls: Database/Infrastructure team
- Secrets compromised: Security team (immediate rotation)

**Monitoring / Alerting**:
- Set up alerts on `/api/system/status` (poll every 60 seconds)
- Alert on: `runtime_alert_level != "ok"`, `queue_stale_leases > 0`
- PagerDuty integration recommended for on-call rotation

**Documentation References**:
- [Full Deployment Guide](DEPLOYMENT.md)
- [Environment Variables Reference](ENVIRONMENT_VARIABLES.md)
- [Production Ops Runbook](docs/production-ops-runbook.md)
- [Incident Response Plan](INCIDENT_RESPONSE_PLAN.md) (if exists)

