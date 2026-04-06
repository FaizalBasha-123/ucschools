# Production Deployment

## Infrastructure

### Backend
**Platform**: Render / Google Cloud Run / Kubernetes
- Docker container
- Auto-scaling enabled
- Health checks configured
- Environment variables from secrets

### Frontend
**Platform**: Vercel / Netlify
- Next.js optimized build
- CDN distribution
- Preview deployments for PRs
- Environment variables in dashboard

### Database
**Platform**: Neon PostgreSQL (serverless)
- Connection pooling enabled
- Automated backups
- Point-in-time recovery
- Read replicas (optional)

### Cache
**Platform**: Render Valkey (serverless)
- Connection pooling
- Automatic failover
- Persistence enabled

### Message Queue
**Platform**: NATS JetStream
- Self-hosted or managed
- Persistent storage
- Stream replication

## Environment Variables

### Required Backend Vars
```
APP_NAME=Schools24
APP_ENV=production
PORT=8080
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
AWS_S3_BUCKET=...
SENDGRID_API_KEY=...
RAZORPAY_KEY_ID=...
FCM_CREDENTIALS=...
```

### Required Frontend Vars
```
NEXT_PUBLIC_API_URL=https://api.schools24.com
NEXT_PUBLIC_WS_URL=wss://api.schools24.com
```

## Health Monitoring
- `/health` - Cache stats, goroutines
- `/ready` - Database connectivity
- Uptime monitoring (UptimeRobot)
- Error tracking (Sentry)

## SSL/TLS
- Automatic HTTPS via platform
- Force HTTPS redirect
- HSTS headers enabled

## Backup Strategy
- Automated daily database backups
- 30-day retention
- Point-in-time recovery
- S3 file storage redundancy
