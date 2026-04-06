# Schools24 Architecture Overview

## System Type
Enterprise school management system (multi-tenant SaaS)

## Core Stack
- **Backend**: Go 1.25 + Gin framework
- **Frontend**: Next.js 16 + React 19
- **Database**: PostgreSQL (primary), MongoDB (optional), Redis (cache)
- **Real-time**: NATS JetStream + WebSockets
- **Mobile**: Capacitor (Android)

## Architecture Pattern
**Multi-tenant with schema-per-tenant**
- Global schema (`public`): Platform data
- Tenant schemas (`school_<uuid>`): School-isolated data

## Deployment
- Docker containers
- Kubernetes-ready
- Hosted on Render/Cloud Run
- Neon PostgreSQL (serverless)

## Key Directories
```
D:/uc-schools/
├── Schools24-backend/    # Go API
├── Schools24-frontend/   # Next.js app
├── schools24-landing/    # Marketing site
└── client/              # Mobile app
```

## Communication Flow
```
Client → Next.js → Go API → PostgreSQL
                         → MongoDB
                         → Redis
         ↓
    WebSocket (real-time)
```
