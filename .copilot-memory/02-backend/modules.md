# Backend Modules

Location: `internal/modules/`

## Module List
| Module | Purpose |
|--------|---------|
| **academic** | Quizzes, homework, timetables |
| **admin** | Admin dashboards, fee mgmt, staff |
| **auth** | Authentication & authorization |
| **blog** | Public blog posts |
| **chat** | AI chatbot & WebSocket messaging |
| **demo** | Demo request tracking |
| **interop** | DIKSHA, DigiLocker, ABC integration |
| **operations** | Task scheduling, background jobs |
| **public** | Public admission/appointment forms |
| **school** | School management & multi-tenancy |
| **student** | Student profiles, attendance, reports |
| **support** | Support tickets (public + auth) |
| **teacher** | Teacher dashboard, messaging, uploads |
| **transport** | GPS tracking, bus routes |

## Module Structure Pattern
```
module_name/
├── handlers.go       # HTTP handlers
├── routes.go        # Route registration
├── service.go       # Business logic
├── repository.go    # Data access
└── models.go        # Data structures
```

## Shared Components
`internal/shared/`
- **middleware/**: Auth, tenant, CORS, rate-limit
- **database/**: DB connection pool
- **cache/**: Redis wrapper with fallback
- **fileupload/**: S3 integration
