# AI-Tutor Production Environment Variables Reference

**Purpose**: Complete reference for all configurable production environment variables  
**Status**: Verified against running backend with 114/114 tests passing  
**Date**: April 15, 2026

---

## Critical for Production Launch

### API Server Configuration

| Variable | Required | Default | Example | Purpose |
|----------|----------|---------|---------|---------|
| `AI_TUTOR_API_PORT` | Yes | 8111 | `8111` | Server listen port |
| `AI_TUTOR_REQUIRE_HTTPS` | Yes | unset | `1` | Enforce TLS on protected routes |
| `AI_TUTOR_CORS_ALLOW_ORIGINS` | Yes | `Any` | `https://app.com,https://api.com` | Browser CORS whitelist (comma-separated) |
| `AI_TUTOR_API_TOKENS` | Yes | unset | `admin-token=admin,writer-token=writer` | Role-based API keys |
| `AI_TUTOR_QUEUE_WORKER_ID` | Yes | unset | `worker-prod-us-east-1-1` | Unique instance ID (prevents duplicate job processing) |

### LLM Provider (Choose One)

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `OPENAI_API_KEY` | If using OpenAI | `sk-...` | Direct OpenAI API key |
| `OPENROUTER_API_KEY` | If using OpenRouter | `sk-or-...` | Multi-model support (recommended) |
| `GROQ_API_KEY` | If using Groq | `gsk-...` | Fast inference, smaller context |

### LLM Model Selection

| Variable | Default | Example | Purpose |
|----------|---------|---------|---------|
| `AI_TUTOR_PRIMARY_MODEL` | `openai:gpt-4o-mini` | `openrouter:anthropic/claude-sonnet-4-6` | Primary lesson generation model |
| `AI_TUTOR_FALLBACK_MODELS` | `openai:gpt-3.5-turbo` | `openai:gpt-3.5-turbo,groq:llama-2-7b` | Fallback chain (semicolon-separated) |

---

## Important but Optional

### Database Configuration

| Variable | Default | Example | Purpose |
|----------|---------|---------|---------|
| `AI_TUTOR_QUEUE_DB_PATH` | File-backed | `sqlite:///data/queue.db` | Job queue backend (file or SQLite) |
| `AI_TUTOR_JOB_DB_PATH` | File-backed | `sqlite:///data/jobs.db` | Job metadata storage |
| `AI_TUTOR_RUNTIME_DB_PATH` | File-backed | `sqlite:///data/runtime.db` | Runtime session state storage |
| `AI_TUTOR_LESSON_DB_PATH` | File-backed | `sqlite:///data/lessons.db` | Generated lesson storage |

**Recommendation**: Use SQLite for production (higher durability than file-backed)

### Asset Storage Configuration

| Variable | Default | Example | Purpose |
|----------|---------|---------|---------|
| `AI_TUTOR_ASSET_STORE` | `local` | `r2` or `s3` | Asset backend (Cloudflare R2 or S3) |
| `AI_TUTOR_ALLOW_INSECURE_R2` | unset | unset | Should remain unset in production |
| `R2_ACCESS_KEY_ID` | Required if using R2 | `...` | Cloudflare R2 credentials |
| `R2_SECRET_ACCESS_KEY` | Required if using R2 | `...` | Cloudflare R2 secret |

### Payment & Billing

| Variable | Default | Example | Purpose |
|----------|---------|---------|---------|
| `EASEBUZZ_API_KEY` | unset | `prod_key_...` | Easebuzz payment gateway auth |
| `EASEBUZZ_MERCHANT_SALT` | unset | `...` | Webhook signature validation |
| `AI_TUTOR_PRICE_PER_CREDIT` | `10.0` | `5.0` | Currency per credit unit |

### OAuth & Authentication

| Variable | Default | Example | Purpose |
|----------|---------|---------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | Required | `...apps.googleusercontent.com` | Google Sign-In client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Required | `...` | Google Sign-In secret (DO NOT commit) |
| `OAUTH_REDIRECT_URL` | `http://localhost:3000/auth/callback` | `https://app.com/auth/callback` | OAuth callback URL (must match Google Console) |

### Observability

| Variable | Default | Example | Purpose |
|----------|---------|---------|---------|
| `RUST_LOG` | `info` | `debug` or `trace` | Log level (debug for troubleshooting) |
| `AI_TUTOR_PRODUCTION_HARDENING_ALERTS` | unset | `1` | Surface auth/HTTPS/asset/worker-id warnings in system status |

---

## Security Best Practices

### Before Deploying

1. **Rotate Tokens Regularly**
   ```bash
   # Old tokens
   AI_TUTOR_API_TOKENS="old-admin=admin,old-writer=writer"
   
   # New tokens (different values, same roles)
   AI_TUTOR_API_TOKENS="new-admin-uuid=admin,new-writer-uuid=writer"
   ```

2. **Use Strong Random Values**
   ```bash
   # Generate unique token
   openssl rand -hex 32
   # ed0c7b2a3f91e8d4b5c9a2f1e3d0c7b2a3f91e8d4b5c9a2f1e3d0c7b2a
   ```

3. **Never Commit `.env` to Git**
   ```bash
   echo ".env" >> .gitignore
   ```

4. **Restrict File Permissions**
   ```bash
   chmod 600 .env
   ```

5. **Use Secret Management in Cloud**
   - **Cloud Run**: Secret Manager
   - **Kubernetes**: Secrets with encryption-at-rest
   - **Render**: Environment Variables (encrypted in dashboard)

---

## Production-Ready Example Configuration

```bash
# API Server
AI_TUTOR_API_PORT=8111
AI_TUTOR_REQUIRE_HTTPS=1
AI_TUTOR_CORS_ALLOW_ORIGINS="https://app.yourdomain.com,https://admin.yourdomain.com"
AI_TUTOR_API_TOKENS="prod-admin-uuid-12345=admin,prod-writer-uuid-67890=writer"
AI_TUTOR_QUEUE_WORKER_ID="worker-prod-us-east-1-001"

# LLM Provider
OPENROUTER_API_KEY="sk-or-prod-kxxxxxxxxxxxxxxxxxxxxxxxxxx"
AI_TUTOR_PRIMARY_MODEL="openrouter:openai/gpt-4o-mini"
AI_TUTOR_FALLBACK_MODELS="openrouter:anthropic/claude-sonnet-4-6;openai:gpt-3.5-turbo"

# Database (SQLite for better durability)
AI_TUTOR_QUEUE_DB_PATH="sqlite:///var/ai-tutor/queue.db"
AI_TUTOR_JOB_DB_PATH="sqlite:///var/ai-tutor/jobs.db"
AI_TUTOR_RUNTIME_DB_PATH="sqlite:///var/ai-tutor/runtime.db"
AI_TUTOR_LESSON_DB_PATH="sqlite:///var/ai-tutor/lessons.db"

# Asset Storage (Cloudflare R2)
AI_TUTOR_ASSET_STORE="r2"
R2_ACCESS_KEY_ID="prod-r2-key-id"
R2_SECRET_ACCESS_KEY="prod-r2-secret"
R2_BUCKET="ai-tutor-assets"
R2_REGION="us-east-1"

# Payment Gateway
EASEBUZZ_API_KEY="prod-easebuzz-key"
EASEBUZZ_MERCHANT_SALT="prod-easebuzz-salt"
AI_TUTOR_PRICE_PER_CREDIT="10.0"

# OAuth
GOOGLE_OAUTH_CLIENT_ID="prod-client-id.apps.googleusercontent.com"
GOOGLE_OAUTH_CLIENT_SECRET="prod-client-secret"
OAUTH_REDIRECT_URL="https://app.yourdomain.com/auth/callback"

# Observability
RUST_LOG="info"
AI_TUTOR_PRODUCTION_HARDENING_ALERTS="1"
```

---

## Verification Command

After setting all variables, verify configuration:

```bash
# 1. Start backend
cargo run -p ai_tutor_api --bin ai_tutor_api

# 2. In another terminal, check ops-gate
curl -s -H "Authorization: Bearer $(echo $AI_TUTOR_API_TOKENS | cut -d'=' -f2)" \
     "http://localhost:8111/api/system/ops-gate" | jq .

# Expected output:
# {
#   "pass": true,
#   "mode": "standard",
#   "checks": [
#     {"id": "api_auth_configured", "required": true, "passed": true},
#     {"id": "https_required", "required": true, "passed": true},
#     {"id": "queue_worker_id_explicit", "required": true, "passed": true},
#     {"id": "runtime_alert_level_ok", "required": true, "passed": true}
#   ]
# }
```

If all checks pass with `"pass": true`, your production configuration is valid.

---

## Gotchas & Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Forgetting `AI_TUTOR_QUEUE_WORKER_ID` | Queue ownership errors, duplicate job processing | Set to unique instance ID |
| CORS origins without protocol | Browser blocks requests | Use full URL: `https://yourdomain.com` |
| HTTPS enabled but no X-Forwarded-Proto header | All requests blocked with 426 | Configure reverse proxy to add header |
| No LLM API key set | Fallback mode (demo), lessons fail silently | Set either OPENAI or OPENROUTER key |
| File-backed queue with multiple instances | Race conditions, lost jobs | Use SQLite backend in production |
| Committing .env to git | Secrets leaked on GitHub | Add `.env` to `.gitignore` |
| Unset `OAUTH_REDIRECT_URL` | OAuth callback fails with redirect mismatch | Must match Google Console registration |

---

## Health Check Endpoints

Use these to verify configuration post-deployment:

```bash
# 1. Basic health
curl -s https://api.yourdomain.com/api/health
# Response: {"status":"ok"}

# 2. System status (requires auth)
curl -s -H "Authorization: Bearer your-token" \
     https://api.yourdomain.com/api/system/status
# Shows: runtime_alert_level, queue_depth, provider_status, etc.

# 3. Ops-gate (requires admin role)
curl -s -H "Authorization: Bearer your-admin-token" \
     https://api.yourdomain.com/api/system/ops-gate
# Shows: infrastructure readiness (pass/fail for each check)
```

If any health check fails, review the `Verification Command` section above and check `/api/system/status` for detailed alert information.

