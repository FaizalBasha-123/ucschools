# AI-Tutor Production Deployment Guide

## Overview

This guide covers deploying AI-Tutor with the new **pedagogy-aware model routing** system to production. The system automatically selects optimal LLM models based on learner signals (confusion, complexity, session type) to balance cost and quality.

**Status:** Production-Ready (v1 launch)

---

## Pre-Deployment Checklist

### 1. Environment Configuration

- [ ] Copy `.env.example` to `.env` in production environment
- [ ] Set `OPENAI_API_KEY` or `OPENROUTER_API_KEY` (or both for fallover)
- [ ] Configure pedagogy tier model IDs:
  - `AI_TUTOR_PEDAGOGY_BASELINE_MODEL` (default: `openrouter:openai/gpt-4o-mini`)
  - `AI_TUTOR_PEDAGOGY_SCAFFOLD_MODEL` (default: `openrouter:google/gemini-2.5-flash`)
  - `AI_TUTOR_PEDAGOGY_REASONING_MODEL` (default: `openrouter:anthropic/claude-sonnet-4-6`)
- [ ] Set fallback models for each tier (critical for resilience)
- [ ] Enable HTTPS: Set `AI_TUTOR_REQUIRE_HTTPS=1`
- [ ] Configure CORS: Set `AI_TUTOR_ALLOWED_ORIGINS=https://your-frontend.com`
- [ ] Set log level: `RUST_LOG=info` (or `debug` for troubleshooting)

### 2. Database Setup

- [ ] Initialize persistent storage (one of):
  - SQLite: Set `AI_TUTOR_LESSON_DB_PATH`, `AI_TUTOR_RUNTIME_DB_PATH`, etc.
  - PostgreSQL/Neon: Set `AI_TUTOR_POSTGRES_URL` with `sslmode=require`
- [ ] Run schema migrations automatically on first API startup
- [ ] Verify database connectivity: Call `/api/health` and check response

### 3. Media Asset Storage

- [ ] Choose asset persistence backend:
  - **Local filesystem** (default): For small/self-hosted deployments
    - Set `AI_TUTOR_ASSET_STORE` unset (default)
  - **Cloudflare R2**: For cloud-scale deployments
    - Set `AI_TUTOR_ASSET_STORE=r2`
    - Configure: `AI_TUTOR_R2_ENDPOINT`, `AI_TUTOR_R2_BUCKET`, keys
    - Set `AI_TUTOR_R2_PUBLIC_BASE_URL` for CDN distribution
- [ ] Test asset upload/download: Generate a sample lesson

### 4. Authentication & Security

- [ ] If open access desired: Leave `AI_TUTOR_API_SECRET` empty (dev only)
- [ ] If token-based access: Set `AI_TUTOR_API_SECRET` to strong random value
- [ ] Optional: Configure Google OAuth for multi-tenant access
- [ ] Optional: Configure Neon database for account persistence
- [ ] Generate HTTPS certificates and configure TLS termination (reverse proxy/load balancer)

### 5. LLM Providers & Cost Management

- [ ] Test primary LLM provider:
  ```bash
  curl -X POST http://localhost:8099/api/chat \
    -H "Content-Type: application/json" \
    -d '{"messages": [{"role": "user", "content": "Hello"}], "session_type": "qa"}'
  ```
- [ ] Verify fallover chain by simulating provider outage
- [ ] Set API rate limits and budget alerts (via provider dashboard)
- [ ] Document model costs for each tier:
  - **Baseline tier:** ~$0.15/M tokens (gpt-4o-mini)
  - **Scaffold tier:** ~$0.075/M tokens (gemini-2.5-flash)
  - **Reasoning tier:** ~$3/M tokens (claude-sonnet-4-6)

### 6. Frontend Integration

- [ ] Verify frontend `.env` points to production backend URL
- [ ] Build frontend: `pnpm build` from `AI-Tutor-Frontend`
- [ ] Confirm SSE thinking events arrive in browser (open DevTools → Network → chat stream)
- [ ] Verify roundtable director indicator shows routing detail (e.g., "Baseline (model: gpt-4o-mini)")

### 7. Monitoring & Observability

- [ ] Set up logging aggregation (e.g., CloudWatch, Datadog, ELK)
- [ ] Enable structured JSON logging: `AI_TUTOR_LOG_FORMAT=json` (optional, for log parsing)
- [ ] Configure alerts for:
  - API error rate > 1%
  - Response latency > 5s (95th percentile)
  - LLM provider failures
  - Database connection pool exhaustion
- [ ] Create dashboard to monitor:
  - Routing distribution (% Baseline/Scaffold/Reasoning per hour)
  - Model cost per session
  - Learner outcomes by tier (future: integrate with analytics)

### 8. Load Testing

- [ ] Run baseline load test (~10-50 concurrent sessions):
  ```bash
  # From AI-Tutor-Backend root:
  cargo build --release
  # Then use a tool like Apache JMeter or k6 to simulate concurrent chat requests
  ```
- [ ] Verify response latency remains <2s for Baseline tier (p95)
- [ ] Verify database connection pool doesn't exhaust
- [ ] Monitor memory usage during sustained load (target: <2GB for 50 concurrent)

### 9. Feature Flags & Fallbacks

- [ ] Set `AI_TUTOR_PEDAGOGY_ROUTING_ENABLED=1` (default) to activate routing
- [ ] Optional: Set `AI_TUTOR_MODEL` to force static fallback if routing fails
- [ ] Test manual model override: POST `/api/chat` with `model: "openai:gpt-4o"` in request

### 10. Backup & Disaster Recovery

- [ ] Set up daily backups of persistent storage (SQLite/Postgres + R2 assets)
- [ ] Document recovery procedure: restore DB, restart API, verify SSE stream
- [ ] Test backup restoration in staging environment

---

## Architecture: Pedagogy-Aware Model Routing

### Signal Extraction

The router analyzes incoming chat requests to extract **pedagogy signals**:

| Signal | Trigger | Score Impact |
|--------|---------|---------------|
| **Confusion Keywords** | "confused", "stuck", "help", "why" | +4 points |
| **Multi-Agent Discussion** | `session_type == "discussion"` | +1 point |
| **High Turn Count** | `director_turn_count >= 4` | +1 point |
| **Whiteboard Interactive** | `whiteboard_state.has_interactive` | +2 points |
| **Complex Reasoning Flag** | Explicit request param | +3 points |

### Tier Selection Logic

```
confusion_score = sum(signal_scores)

if confusion_score >= 5:
    tier = Reasoning (premium model)
elif confusion_score >= 3:
    tier = Scaffold (balanced model)
else:
    tier = Baseline (cost-optimized model)
```

### Model Selection by Tier

| Tier | Primary Model | Fallback | Cost | Latency | Quality |
|------|---------------|----------|------|---------|---------|
| **Baseline** | `gpt-4o-mini` | none | ⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Scaffold** | `gemini-2.5-flash` | `gpt-4o-mini` | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Reasoning** | `claude-sonnet-4-6` | `gemini-2.5-flash` | ⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐ |

### Decision Visibility

The routing decision flows through the SSE event stream:

1. **Backend emits** `Thinking` event with formatted message:
   ```
   "Scaffold (model: openrouter:google/gemini-2.5-flash, fallback: openrouter:openai/gpt-4o-mini)"
   ```

2. **Frontend receives** event and parses `message` field into `detail`

3. **UI renders** detail in director thinking indicator (shows learner the model choice reason)

### Logging & Telemetry

Each routing decision is logged at `info!()` level:

```
{
  "tier": "Scaffold",
  "confidence": 0.85,
  "reason": "multi-agent discussion detected",
  "model": "openrouter:google/gemini-2.5-flash",
  "fallback": "openrouter:openai/gpt-4o-mini",
  "confusion_score": 3,
  "turn_count": 5,
  "session_type": "discussion"
}
```

**Operators:** Query logs for:
- `tier=Reasoning` to find high-complexity sessions
- `confidence<0.5` to identify edge cases needing tuning
- Model fallback usage to detect provider issues

---

## Deployment Scenarios

### Scenario 1: Cloud Run (Google Cloud)

```bash
# 1. Build backend Docker image
cd AI-Tutor-Backend
docker build -t gcr.io/your-project/ai-tutor-backend:latest .

# 2. Push to Google Container Registry
docker push gcr.io/your-project/ai-tutor-backend:latest

# 3. Deploy to Cloud Run with .env as secret
gcloud run deploy ai-tutor-backend \
  --image gcr.io/your-project/ai-tutor-backend:latest \
  --region us-central1 \
  --set-env-vars OPENROUTER_API_KEY=sk-or-xxx,AI_TUTOR_PEDAGOGY_BASELINE_MODEL=openrouter:openai/gpt-4o-mini \
  --require-auth

# 4. Verify
curl https://ai-tutor-backend-xxx.run.app/api/health
```

### Scenario 2: Kubernetes (Self-Hosted / EKS)

```bash
# 1. Build & push image (as above)

# 2. Create Kubernetes secret for .env
kubectl create secret generic ai-tutor-env \
  --from-literal=OPENROUTER_API_KEY=sk-or-xxx \
  --from-literal=AI_TUTOR_POSTGRES_URL=postgresql://...

# 3. Apply deployment manifest (see k8s/deployment.yaml)
kubectl apply -f AI-Tutor-Backend/k8s/deployment.yaml

# 4. Expose via LoadBalancer or Ingress
kubectl apply -f AI-Tutor-Backend/k8s/service.yaml
kubectl apply -f AI-Tutor-Backend/k8s/ingress.yaml

# 5. Verify rollout
kubectl rollout status deployment/ai-tutor-backend
kubectl port-forward svc/ai-tutor-backend 8099:8099
curl http://localhost:8099/api/health
```

### Scenario 3: Render.yaml (render.com)

Pre-configured in `AI-Tutor-Backend/render.yaml`:

```bash
# 1. Commit .env to GitHub (or use Render environment variables)
git add AI-Tutor-Backend/.env
git commit -m "chore: production env"
git push

# 2. Connect repository to render.com and deploy
# (Render auto-detects render.yaml and deploys)

# 3. Verify health endpoint
curl https://ai-tutor-backend.renderusercontent.com/api/health
```

---

## Post-Deployment Validation

### 1. Health Check

```bash
curl -s http://localhost:8099/api/health | jq
# Expected response:
# {
#   "status": "ok",
#   "version": "0.1.0",
#   "uptime_seconds": 42,
#   "database": "connected",
#   "llm_providers": ["openai", "openrouter"]
# }
```

### 2. End-to-End Chat Test

```bash
# 1. Start a QA session
curl -X POST http://localhost:8099/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "I am confused about algebra"}],
    "session_type": "qa"
  }' | jq

# 2. Stream SSE events and verify Thinking event arrives:
# Event: thinking
# Data: {"stage": "director", "detail": "Reasoning (model: ..., fallback: ...)"}
```

### 3. Frontend SSE Stream Verification

1. Open frontend at `https://your-frontend.com/classroom/lesson-id`
2. Start a chat message
3. Open browser DevTools → Network tab
4. Find the `POST /api/chat` request
5. Scroll to response → verify SSE events include `event: thinking` with routing detail

### 4. Metrics Dashboard

Create a simple dashboard in your monitoring tool:

```
Metrics:
- Routing tier distribution (pie chart: % Baseline/Scaffold/Reasoning)
- Avg response latency by tier (bar chart)
- Fallback usage rate (threshold alert if > 5%)
- LLM provider error rate (threshold alert if > 1%)

Recommended Tools:
- Datadog (all-in-one)
- CloudWatch (AWS)
- Grafana + Prometheus (self-hosted)
```

---

## Troubleshooting

### Problem: Thinking events not appearing in frontend

**Debug:**
1. Check backend logs for "Thinking event emitted" message
2. Open DevTools → Network → filter for `POST /api/chat` → Response tab → search for `event: thinking`
3. If missing, check that `AI_TUTOR_PEDAGOGY_ROUTING_ENABLED=1`

**Fix:**
- Verify `pedagogy_router.rs` is compiled (check backend build logs)
- Restart backend with `RUST_LOG=debug` for detailed routing traces

### Problem: Fallback model being used (high fallback rate)

**Debug:**
1. Check logs for `fallback_triggered` or provider error messages
2. Verify LLM provider API keys are correct
3. Check API rate limits and quota usage in provider dashboard

**Fix:**
- Rotate API keys (may be compromised/rate-limited)
- Increase rate limits with provider
- Switch primary model to a cheaper alternative temporarily

### Problem: Model selection always stays on Baseline tier

**Debug:**
1. Add `AI_TUTOR_LOG_FORMAT=json` and check confusion_score in logs
2. Verify pedagogy signals are present (keywords, turn count, etc.)

**Fix:**
- Adjust thresholds: Lower `AI_TUTOR_PEDAGOGY_CONFUSION_THRESHOLD_SCAFFOLD`
- Verify confusion keywords are present in learner messages
- Manually test tier selection by setting explicit `model` parameter in chat request

### Problem: High latency on Reasoning tier requests

**Debug:**
1. Check if `claude-sonnet-4-6` API is responding slowly
2. Monitor queue depth in logs (may indicate provider concurrency limit)

**Fix:**
- Use fallback model (reduced one tier): `AI_TUTOR_PEDAGOGY_REASONING_FALLBACK=openrouter:google/gemini-2.5-flash`
- Contact OpenRouter support if consistent slowness
- Temporarily disable Reasoning tier: Modify router logic to cap at Scaffold tier

---

## Rollback Procedure

If prod deployment encounters critical issues:

```bash
# 1. Identify last known-good deployment
git log --oneline -5

# 2. Revert to previous version
git revert HEAD
git push

# 3. Rebuild & redeploy
cargo build --release
# (Re-run deployment scenario steps above)

# 4. Monitor health for 5 minutes
watch -n 5 'curl -s http://localhost:8099/api/health | jq .uptime_seconds'

# 5. If stable, notify team; if not, continue reverting
```

---

## Future Work (Post-v1)

- [ ] **Generation Pipeline Routing:** Apply pedagogy tiers to lesson outline/content generation
- [ ] **Reasoning Budget Enforcement:** Enforce thinking token limits per tier
- [ ] **Session-Scoped Overrides:** Allow explicit tier override in API request (e.g., `reasoning_tier: premium`)
- [ ] **Metrics & Analytics:** Dashboard showing cost/outcome correlation by tier
- [ ] **A/B Testing Framework:** Run experiments comparing routing policies
- [ ] **Adaptive Thresholds:** Auto-tune signal thresholds based on learner outcome data

---

## Support & Questions

For issues or feature requests:
1. Check logs: `grep "pedagogy_router" /path/to/backend.log`
2. Consult architecture docs: See `PEDAGOGY_ROUTING.md` (forthcoming)
3. Contact ops team with deployment ID and SSE stream snippet
