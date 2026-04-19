# AI-Tutor Production Quick Reference

## Environment Setup (5 minutes)

```bash
# 1. Copy config
cp AI-Tutor-Backend/.env.example AI-Tutor-Backend/.env

# 2. Set API key (choose one)
export OPENROUTER_API_KEY=sk-or-your-key-here
# or
export OPENAI_API_KEY=sk-proj-your-key-here

# 3. Verify build
cd AI-Tutor-Backend && cargo build --release
cd ../AI-Tutor-Frontend && pnpm build
```

## Deploy (Choose One)

### Cloud Run (Fastest)
```bash
cd AI-Tutor-Backend
docker build -t gcr.io/PROJECT/ai-tutor-backend:latest .
docker push gcr.io/PROJECT/ai-tutor-backend:latest
gcloud run deploy ai-tutor-backend --image gcr.io/PROJECT/ai-tutor-backend:latest
```

### Kubernetes
```bash
kubectl create secret generic ai-tutor-env --from-file=.env=AI-Tutor-Backend/.env
kubectl apply -f AI-Tutor-Backend/k8s/
```

### Local Testing
```bash
cd AI-Tutor-Backend
RUST_LOG=info cargo run --release -p ai_tutor_api
# Then open http://localhost:3000 (frontend)
```

## Test Deployment

```bash
# Health check
curl http://localhost:8099/api/health | jq

# Confused learner test (should trigger Reasoning tier)
curl -X POST http://localhost:8099/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "I am confused about quantum mechanics"}],
    "session_type": "qa"
  }' | jq '.events[] | select(.kind=="Thinking")'

# Expected: Thinking event with "Reasoning" tier indication
```

## Monitor Production

```bash
# Tail logs for routing decisions
tail -f logs/*.log | grep "tier = "

# Count tier distribution (live)
while true; do
  echo "=== Last 100 sessions ==="
  grep "tier = " logs/*.log | tail -100 | awk '{print $NF}' | sort | uniq -c
  sleep 30
done

# Alert on fallback usage
grep "fallback_triggered" logs/*.log | wc -l
# If > 5 in last hour: check provider status
```

## Config Cheat Sheet

| Setting | Default | When to Change |
|---------|---------|----------------|
| `AI_TUTOR_PEDAGOGY_CONFUSION_THRESHOLD_SCAFFOLD` | 3 | Too many Baseline→Scaffold? Raise to 4 |
| `AI_TUTOR_PEDAGOGY_CONFUSION_THRESHOLD_REASONING` | 5 | Reasoning tier too high? Raise to 6 |
| `AI_TUTOR_PEDAGOGY_*_FALLBACK` | Scaffold→Baseline | Provider failing? Disable with `none` |
| `AI_TUTOR_REQUIRE_HTTPS` | unset | Production deploy? Set to `1` |
| `RUST_LOG` | info | Troubleshooting? Set to `debug` |

## Cost Estimation

**Monthly cost for 10,000 sessions:**

| Model Dist | Avg Cost/Session | Monthly |
|---|---|---|
| 70% Base, 20% Scaffold, 10% Reason | $0.0045 | $450 |
| 80% Base, 15% Scaffold, 5% Reason | $0.0025 | $250 |
| 50% Base, 30% Scaffold, 20% Reason | $0.0090 | $900 |

**Token costs (OpenRouter):**
- Baseline (gpt-4o-mini): $0.15/M in, $0.60/M out
- Scaffold (gemini-2.5-flash): $0.075/M in, $0.30/M out
- Reasoning (claude-sonnet-4-6): $3/M in, $15/M out

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Thinking events not in UI | Check backend logs: `RUST_LOG=debug` |
| All sessions on Baseline | Lower confusion threshold to 2 |
| High cost spike | Raise reasoning threshold to 6+ |
| Provider rate limit hit | Rotate API key or add fallback provider |
| Response latency >5s | Provider degradation; check status page |
| Database connection error | Check DATABASE_URL and connection pool |

## Key Files

- **Config:** `.env.example` (see Pedagogy Routing section)
- **Operations:** `DEPLOYMENT.md` (full deployment guide)
- **Architecture:** `PEDAGOGY_ROUTING.md` (signal extraction, tier logic)
- **Implementation:** `crates/orchestrator/src/pedagogy_router.rs`
- **Frontend:** `apps/web/components/chat/process-sse-stream.ts`

## Metrics Dashboard SQL Queries

### Tier Distribution (Last 24 Hours)
```sql
SELECT 
  tier,
  COUNT(*) as sessions,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM routing_logs
WHERE timestamp > NOW() - INTERVAL 24 HOUR
GROUP BY tier;
```

### Response Latency by Tier
```sql
SELECT 
  tier,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99
FROM routing_logs
WHERE timestamp > NOW() - INTERVAL 1 HOUR
GROUP BY tier;
```

### Cost per Tier (Weekly)
```sql
SELECT 
  tier,
  ROUND(AVG(cost_usd), 4) as avg_cost,
  ROUND(SUM(cost_usd), 2) as total_cost,
  COUNT(*) as sessions
FROM routing_logs
WHERE timestamp > NOW() - INTERVAL 7 DAY
GROUP BY tier;
```

## Alert Rules (Prometheus)

```yaml
- alert: HighFallbackUsage
  expr: (increase(fallback_triggered[1h]) / increase(sessions_total[1h])) > 0.05
  for: 5m
  labels:
    severity: warning

- alert: ReasoningTierTooHigh
  expr: (increase(tier_reasoning[1h]) / increase(sessions_total[1h])) > 0.30
  for: 5m
  labels:
    severity: info

- alert: HighLatency
  expr: histogram_quantile(0.95, latency_ms) > 5000
  for: 5m
  labels:
    severity: critical
```

## Rollback (If Emergency)

```bash
# 1. Identify previous working commit
git log --oneline | head -5

# 2. Revert and rebuild
git revert HEAD
cargo build --release

# 3. Redeploy
# (Use deployment method from above)

# 4. Monitor
curl http://localhost:8099/api/health
```

---

**For full documentation:** See `DEPLOYMENT.md` and `PEDAGOGY_ROUTING.md`
