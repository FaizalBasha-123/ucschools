# Docker Deployment

## Dockerfile
Location: `Schools24-backend/Dockerfile`

### Build Strategy
Multi-stage build for minimal image size:

**Stage 1: Builder**
- Base: golang:1.25.0-alpine
- Install build dependencies
- Copy go.mod, go.sum
- Download dependencies
- Copy source code
- Build binary with CGO disabled

**Stage 2: Runtime**
- Base: alpine:latest
- Install CA certificates, timezone data
- Copy binary from builder
- Expose port 8080
- Health check on `/health`
- Run as non-root user

### Build Command
```bash
docker build -t schools24-backend:latest .
```

### Run Command
```bash
docker run -d \
  -p 8080:8080 \
  --env-file .env \
  --name schools24-backend \
  schools24-backend:latest
```

## Docker Compose
Location: `Schools24-backend/docker-compose.yml`

### Services
1. **PostgreSQL**: Database
   - Port: 5432
   - Volume: postgres-data

2. **Redis**: Cache
   - Port: 6379
   - Volume: redis-data

3. **NATS**: Message queue
   - Port: 4222
   - JetStream enabled

4. **Backend**: Go API
   - Port: 8080
   - Depends on: PostgreSQL, Redis, NATS

### Start All Services
```bash
docker-compose up -d
```

### Stop All Services
```bash
docker-compose down
```

### View Logs
```bash
docker-compose logs -f backend
```
