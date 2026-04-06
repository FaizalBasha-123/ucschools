# Backend Entry Point

## Main File
`D:/uc-schools/Schools24-backend/cmd/server/main.go`

## Startup Flow
1. Load environment config
2. Initialize Redis/Valkey (with fallback)
3. Connect to PostgreSQL
4. Run global migrations
5. Run tenant migrations (for all schools)
6. Initialize MongoDB (optional)
7. Bootstrap all modules
8. Register routes
9. Start Gin server (port 8080)

## Server Configuration
- **Port**: 8080 (default)
- **Environment**: dev/staging/prod
- **Health Check**: `/health`
- **Readiness**: `/ready`

## Middleware Stack (order matters)
1. CORS
2. Compression
3. Security headers
4. Rate limiting
5. JWT validation
6. Tenant context injection
7. User validation
8. CSRF protection (for write operations)

## Module Bootstrapping
All modules in `internal/modules/` are initialized:
- auth, student, teacher, admin
- academic, fees, transport
- chat, support, blog, demo
- operations, interop, public, school
