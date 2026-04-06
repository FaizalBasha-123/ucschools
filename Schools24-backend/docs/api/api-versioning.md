# API Versioning Strategy

## Current Version: v1

All endpoints are served under `/api/v1/`. This is the only supported version.

## Versioning Rules

1. **Non-breaking changes** (additive fields, new endpoints) do NOT require a version bump
2. **Breaking changes** (field removal, type change, behavior change) require a new version prefix
3. **Deprecation**: old versions stay available for 6 months after a new version ships

## Version Headers

| Header | Purpose |
|--------|---------|
| `X-API-Version` | Response header — current version |
| `X-Idempotency-Key` | Request header — prevents duplicate mutations |
| `X-Idempotency-Hit` | Response header — `true` when cached result is returned |
| `X-Request-ID` | Response header — correlation ID for debugging |

## Error Contract

All error responses follow a structured format:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable description",
    "details": {}
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INTEROP_DISABLED` | 412 | Interop not enabled |
| `INVALID_SYSTEM` | 400 | Unknown external system |
| `INVALID_OPERATION` | 400 | Unknown operation type |
| `VALIDATION_FAILED` | 400 | Request validation error |
| `JOB_NOT_FOUND` | 404 | Job ID does not exist |
| `IDEMPOTENCY_HIT` | 200 | Returned cached result |
| `INVALID_SCOPE` | 400 | Missing school_id |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Migration Path

When v2 is introduced:
1. Both `/api/v1/` and `/api/v2/` serve simultaneously
2. v1 responses include `Sunset: <date>` header
3. After sunset date, v1 returns 410 Gone
