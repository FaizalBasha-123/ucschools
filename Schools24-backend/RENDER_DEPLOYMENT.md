# Schools24 - Render Deployment Guide

Deploy to **Render Free Tier** (500MB RAM, 0.1 CPU). Our optimized Go binary uses ~150MB, leaving plenty of headroom.

---

## Method 1: Blueprint (Easiest)

1. Push this repo to GitHub
2. Go to [render.com/blueprints](https://dashboard.render.com/blueprints)
3. Click **New Blueprint Instance**
4. Connect your `Schools24-Workspace` repository
5. Render auto-reads `render.yaml` and creates the service
6. **Add Environment Variables** (see below)

---

## Method 2: Manual Setup

1. Go to [render.com](https://dashboard.render.com)
2. Click **New → Web Service**
3. Connect your repo: `Schools24-Workspace`
4. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `schools24-backend` |
| **Root Directory** | `schools24-backend` |
| **Environment** | `Go` |
| **Build Command** | `go build -ldflags="-s -w" -o app ./cmd/server/main.go` |
| **Start Command** | `./app` |
| **Plan** | `Free` |

---

## Environment Variables (REQUIRED)

Go to your service → **Environment** tab and add these:

### Required Variables
| Key | Example Value | Description |
|-----|---------------|-------------|
| `PORT` | `10000` | Render uses 10000 by default |
| `GIN_MODE` | `release` | Production mode |
| `DATABASE_URL` | `postgresql://user:pass@xxx.neon.tech/neondb?sslmode=require` | Neon PostgreSQL |
| `R2_ENABLED` | `true` | Enable Cloudflare R2 storage |
| `R2_ACCOUNT_ID` | `your_cloudflare_account_id` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | `your_r2_access_key_id` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | `your_r2_secret_access_key` | R2 secret key |
| `R2_BUCKET_NAME` | `schools24-documents` | R2 bucket name |
| `R2_REGION` | `auto` | R2 signing region |
| `JWT_SECRET` | `your-super-secret-key-min-32-chars` | JWT signing key |

### Optional Variables
| Key | Default | Description |
|-----|---------|-------------|
| `JWT_EXPIRATION_HOURS` | `24` | Token validity |
| `RATE_LIMIT_REQUESTS_PER_MIN` | `100` | Rate limiting |
| `RATE_LIMIT_BURST` | `50` | Burst allowance |
| `CACHE_MAX_SIZE_MB` | `200` | In-memory cache size |
| `CORS_ALLOWED_ORIGINS` | `*` | Frontend domains |
| `REDIS_URL` | auto from Render Valkey | Redis/Valkey cache |

---

## Get Your Database URLs

### Neon PostgreSQL (Free)
1. Go to [neon.tech](https://neon.tech)
2. Create project → Copy connection string
3. Format: `postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`

### Cloudflare R2
1. Go to Cloudflare Dashboard → R2
2. Create bucket (example: `schools24-documents`)
3. Create API token with read/write access
4. Copy `Account ID`, `Access Key ID`, and `Secret Access Key`
5. Set `R2_REGION=auto` and keep endpoint default unless custom is required

---

## Verify Deployment

After deploy completes:
```bash
curl https://your-app.onrender.com/health
# {"status":"healthy","service":"schools24-backend"}
```

---

## Troubleshooting

### "Out of Memory" Error
- Set `CACHE_MAX_SIZE_MB=100` (reduce cache)
- Set `RATE_LIMIT_BURST=20` (reduce burst)

### "Connection Refused" to Database
- Neon: Check `?sslmode=require` is in URL
- Atlas: Ensure `0.0.0.0/0` is in Network Access

### Cold Starts (Slow First Request)
- Free tier sleeps after 15 min inactivity
- First request takes 30-60 seconds to wake up
- Solution: Upgrade to paid tier ($7/month) or use uptime monitor
