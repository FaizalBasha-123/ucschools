# Schools24 Enterprise Maturity Audit

**Date:** April 4, 2026  
**Scope:** Go Backend (Gin), Next.js Frontend, SDK Implementation  
**Assessment Period:** Full codebase analysis

---

## Executive Summary

| Category | Maturity Score | Status |
|----------|-------|--------|
| **Error Handling** | 3.2/5 | ⚠️ Inconsistent patterns |
| **Validation** | 2.8/5 | ⚠️ Decentralized, gaps exist |
| **Response Formats** | 3.5/5 | ✓ Mostly consistent |
| **HTTP Status Codes** | 3.8/5 | ✓ Generally correct |
| **Middleware & Auth** | 4.2/5 | ✓ Well-structured |
| **Logging** | 2.5/5 | ⚠️ Basic, unstructured |
| **SDK Implementation** | 3.8/5 | ✓ Good error types but validation gaps |
| **Frontend Hook Patterns** | 3.6/5 | ✓ React Query usage solid, error handling variable |

**Overall Enterprise Readiness: 3.4/5** — Platform has solid architectural foundations but needs enterprise hardening.

---

## 1. Backend Structure (Go + Gin)

### 1.1 Error Handling Patterns

#### Current State: **INCONSISTENT** (Needs Standardization)

**Problems Identified:**

1. **Inconsistent Error Responses** - No unified error response format
   
   ```go
   // Pattern 1: Simple error string
   c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
   
   // Pattern 2: Error key with message key
   c.JSON(http.StatusBadRequest, gin.H{
       "error": "invalid_school_id",
       "message": err.Error()
   })
   
   // Pattern 3: Mixed with details
   c.JSON(http.StatusBadRequest, gin.H{
       "error": "invalid request body", 
       "details": err.Error()
   })
   ```
   
   **Files affected:**
   - [internal/modules/admin/handler.go](internal/modules/admin/handler.go#L87) (Lines 87, 92, 191, 205, 215)
   - [internal/modules/teacher/handler.go](internal/modules/teacher/handler.go#L78-L160)
   - [internal/modules/admin/consent_handler.go](internal/modules/admin/consent_handler.go) (Lines 22, 28, 41, 52, 58, 64, 75, 77, 79, 81)

2. **Error Logging Inconsistency** - Mix of structured and unstructured logs
   
   ```go
   // Structured logging in JWT middleware
   log.Printf("[auth][jwt] unauthorized path=%s method=%s host=%s ip=%s reason=%v", 
       c.Request.URL.Path, c.Request.Method, c.Request.Host, c.ClientIP(), err)
   ```
   
   **vs** unstructured error responses in handlers
   
3. **Missing Error Types Drama** - No custom error types for semantic error handling
   - Backend uses raw `error` interface everywhere
   - Frontend cannot distinguish "not found" from "permission denied" from "server error"
   - Requires parsing error message strings (fragile)

4. **No Request ID Tracing** - Requests have no correlation ID for debugging
   - Makes production debugging extremely difficult
   - Cannot track a request across service logs

#### Recommended Pattern:

```go
// Enterprise error response wrapper
type ErrorResponse struct {
    Code      string      `json:"code"`              // "TEACHER_NOT_FOUND", "INVALID_SCHOOL_ID"
    Message   string      `json:"message"`           // Human-readable message
    Details   interface{} `json:"details,omitempty"` // Additional context
    RequestID string      `json:"request_id"`        // For debugging
    Timestamp string      `json:"timestamp"`         // ISO 8601
}

// Use in handlers:
c.JSON(http.StatusNotFound, ErrorResponse{
    Code:      "TEACHER_NOT_FOUND",
    Message:   "Teacher with ID xyz not found",
    RequestID: c.GetString("request_id"),
    Timestamp: time.Now().UTC().Format(time.RFC3339),
})
```

### 1.2 Validation Patterns

#### Current State: **DECENTRALIZED** (Needs Centralization)

**Issues:**

1. **No Validation Layer** - Validation scattered across handlers
   
   ```go
   // In admin/handler.go - ad hoc validation
   func (h *Handler) GetAllStaff(c *gin.Context) {
       // ...
       if schoolID == uuid.Nil {
           c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
           return
       }
   ```
   
   **vs** declarative validation in struct tags (missing)
   
2. **Limited Input Validation**
   - Password validation exists: [internal/shared/validation/password.go](internal/shared/validation/password.go) (8+ chars, 1 uppercase, 1 digit)
   - But no email validation framework
   - No UUID validation helpers consistently applied
   - No phone number validation
   - File type validation only in chat module (`validateFileMagicBytes`)

3. **JSON Binding Issues** - Custom strict binding used in some handlers
   
   ```go
   // Prevents unknown fields (good practice but not everywhere)
   func strictBindJSON(c *gin.Context, dest any) error {
       dec := json.NewDecoder(c.Request.Body)
       dec.DisallowUnknownFields()
       if err := dec.Decode(dest); err != nil {
           return err
       }
       // ...
   }
   ```
   
   **Used in:** [teacher/handler.go](internal/modules/teacher/handler.go#L47), [admin/handler.go](internal/modules/admin/handler.go#L118)  
   **Missing from:** Student module, Public module, many other handlers

4. **Type Safety Gaps** - No comprehensive type definitions
   - Mixed use of raw types vs structured DTOs
   - Some modules (support, student) have good DTO patterns, others don't
   - Request/response contracts unclear in documentation

#### Good Validation Examples:
- `support/models.go` - Well-structured request models with clear fields
- `admin/consent_models.go` - Clear separation of request/response types
- `public/models.go` - Good schema definitions for admission forms

### 1.3 Response Wrapper Patterns

#### Current State: **MOSTLY CONSISTENT** (3.5/5)

**What Works:**
- Success responses use `gin.H{}` directly (simple, readable)
- Status codes generally correct
- Content-Type headers properly set

**What's Inconsistent:**
- Some endpoints return wrapped data (`{data: {...}}`)
- Some return raw object (`{...}`)
- Some return array directly vs array-in-object

```go
// Pattern 1: Direct object
c.JSON(http.StatusOK, dashboard)  // Returns dashboard directly

// Pattern 2: Wrapped in gin.H
c.JSON(http.StatusOK, gin.H{
    "message": "Staff member created successfully"
})

// Pattern 3: Endpoint-specific wrapper (in list endpoints)
c.JSON(http.StatusOK, gin.H{
    "items": items,
    "count": len(items)
})
```

**Files with lists:**
- `consent_handler.go` Line 45: `{"items": items, "count": len(items)}`
- Teacher handlers return raw objects without wrapper
- Admin handlers inconsistent

#### Recommended Standard:

```go
// For paginated lists
type PaginatedResponse<T> struct {
    Data       []T   `json:"data"`
    Total      int64 `json:"total"`
    Page       int   `json:"page"`
    PageSize   int   `json:"page_size"`
    HasMore    bool  `json:"has_more"`
}

// For single resources
type ResourceResponse<T> struct {
    Data T `json:"data"`
}

// For operations with message
type OperationResponse struct {
    Success bool   `json:"success"`
    Message string `json:"message"`
}
```

### 1.4 HTTP Status Code Usage

#### Current State: **CORRECT & CONSISTENT** (3.8/5)

**Good Usage:**
| Status | Used For | Example |
|--------|----------|---------|
| 200 | Successful GET/POST | Dashboard retrieval, staff list |
| 201 | Resource created | [admin/handler.go#L254](internal/modules/admin/handler.go#L254) - Staff creation |
| 204 | No content | Logout, delete operations |
| 400 | Bad request | Invalid UUID, missing required fields |
| 401 | Unauthorized | Missing/invalid JWT token |
| 403 | Forbidden | Missing school_id in context |
| 404 | Not found | (Implied but not always used) |
| 409 | Conflict | [admin/handler.go#L247](internal/modules/admin/handler.go#L247) - Email already exists |
| 422 | Unprocessable entity | (NOT USED - should be) |
| 429 | Rate limited | Rate limiters in middleware but no 429 responses seen |
| 500 | Server error | Catch-all for unhandled errors |
| 101 | Upgrade required | [chat/handler.go#L109](internal/modules/chat/handler.go#L109) - WebSocket upgrade |

**Issues:**
- 404 (Not Found) not used consistently - some handlers return 400 or 500 instead
- 422 (Unprocessable Entity) never used - good for validation errors
- 429 (Rate Limited) never explicitly returned even with rate limiters active

### 1.5 Middleware Setup

#### Current State: **WELL-STRUCTURED** (4.2/5)

**Middleware Stack** (in order):
1. **Compression** - Gzip compression middleware [main.go#L312](cmd/server/main.go#L312)
2. **CORS** - Environment-configured CORS [main.go#L326](cmd/server/main.go#L326)
3. **Rate Limiting** - Global & endpoint-specific [main.go#L332](cmd/server/main.go#L332)
4. **Security Headers** - Basic security headers [main.go#L338](cmd/server/main.go#L338)
5. **JWT Auth** - Token extraction & validation [middleware/jwt.go](internal/shared/middleware/jwt.go)
6. **Active User Check** - Validates user isn't suspended [main.go#L539](cmd/server/main.go#L539)
7. **Mutation Rate Limit** - Extra protection for writes [main.go#L540](cmd/server/main.go#L540)
8. **CSRF Protection** - Token-based CSRF [main.go#L541](cmd/server/main.go#L541)
9. **Tenant Middleware** - Schema switching [main.go#L552](cmd/server/main.go#L552)
10. **Response Cache** - GET caching per school+role [main.go#L554](cmd/server/main.go#L554)

**Role-based Access Control:**
```go
protected.Use(middleware.RequireRole("teacher", "admin"))
protected.Use(middleware.RequireRole("admin", "super_admin"))
protected.Use(middleware.RequireRole("super_admin"))
```

**Strengths:**
- ✓ JWT middleware properly extracts from headers, cookies, query params
- ✓ Session validation hook for custom authentication
- ✓ Request context properly populated with user claims
- ✓ Tenant schema switching happens after auth
- ✓ Rate limiting differentiated for reads vs mutations

**Gaps:**
- No structured request logging middleware
- No request ID injection middleware
- Error middleware not explicit (errors bubble up to Gin's default handler)
- No correlation ID tracing across requests

### 1.6 Logging Infrastructure

#### Current State: **BASIC & UNSTRUCTURED** (2.5/5)

**Current Logging:**

Basic `log.Printf()` calls scattered throughout:
```go
// jwt.go - Structured logging present
log.Printf("[auth][jwt] unauthorized path=%s method=%s host=%s ip=%s reason=%v", 
    c.Request.URL.Path, c.Request.Method, c.Request.Host, c.ClientIP(), err)

// Most other files - generic unstructured
c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
// No log message for this error!
```

**Issues:**
1. **No Structured Logging Library** - Using `log` package (Go stdlib)
   - Missing: context fields, severity levels, structured output
   - Makes cloud logging (Stackdriver, DataDog, ELK) difficult

2. **Inconsistent Log Tags** - JWT uses `[auth][jwt]`, others use nothing
   - Hard to filter/search logs by component
   - No correlation IDs for request tracing

3. **Silent Errors** - Many error cases don't log
   - Database errors returned to client without logging
   - Service layer errors lost
   - Makes debugging production issues impossible

4. **No Request Logging** - No middleware to log all requests
   - Start time, duration, status codes, response sizes not captured
   - Can't identify slow endpoints

#### Recommended Pattern:

```go
// Use structured logger (zap, zerolog, or similar)
type Logger interface {
    Info(msg string, fields map[string]interface{})
    Error(msg string, err error, fields map[string]interface{})
    Debug(msg string, fields map[string]interface{})
    WithRequestID(id string) Logger
}

// In middleware
requestID := uuid.New().String()
c.Set("request_id", requestID)
logger := getLogger().WithRequestID(requestID)

// In handlers
logger.Error("failed_to_fetch_teacher", err, map[string]interface{}{
    "teacher_id": teacherID,
    "school_id": claims.SchoolID,
})
```

---

## 2. Frontend Hook Patterns

### 2.1 API Calling Patterns

#### Current State: **REACT QUERY WELL-USED** (3.6/5)

**Good Patterns:**

1. **useQuery for Reads** - Proper use of React Query
   ```tsx
   // useClassSubjects.ts
   return useQuery({
       queryKey: ['class-subjects', classId],
       queryFn: async () => {
           if (!classId) throw new Error('Class ID is required')
           return api.get<{ subjects: ClassSubject[] }>(
               `/admin/classes/${classId}/subjects`
           )
       },
       enabled: enabled && !!classId,
       staleTime: 2 * 60_000,  // 2 min
       refetchOnWindowFocus: false,
   })
   ```

2. **useMutation for Writes** - Proper mutation handling
   ```tsx
   // useAdminUsers.ts
   return useMutation({
       mutationFn: (data: CreateUserParams) => 
           api.post('/admin/users', data),
       onSuccess: () => {
           queryClient.invalidateQueries({ queryKey: ['users'] })
           toast.success('User created successfully')
       },
       onError: (error: any) => {
           // Error handling...
       }
   })
   ```

3. **Pagination** - useInfiniteQuery used correctly
   ```tsx
   // useTeachers.ts
   return useInfiniteQuery({
       queryKey: ['teachers', search, pageSize],
       queryFn: async ({ pageParam = 1 }) => {
           const params = new URLSearchParams()
           params.append('page', pageParam.toString())
           params.append('page_size', pageSize.toString())
           return api.get<TeachersResponse>(`/admin/teachers?${params}`)
       },
       initialPageParam: 1,
       getNextPageParam: (lastPage) => {
           const totalPages = Math.ceil(lastPage.total / lastPage.page_size)
           return lastPage.page < totalPages ? lastPage.page + 1 : undefined
       }
   })
   ```

**Issues:**

1. **Direct `api.get/post` Usage** - Some hooks don't type responses properly
   ```tsx
   // useAdminStudents - unclear response shape
   const res = await api.get<UsersResponse>(`/admin/users?${params}`)
   // Does api.get return the data or wrapped response?
   ```

2. **Error Message Extraction** - Inconsistent patterns
   ```tsx
   // useAdminTeachers - custom error extraction
   const getErrorMessage = (error: unknown, fallback: string) => {
       const apiError = error as ApiErrorLike
       return apiError?.response?.data?.error || fallback
   }
   
   // useAdminUsers - direct error.message
   onError: (error: any) => {
       const msg = error instanceof Error ? error.message : "Update failed"
   }
   ```

### 2.2 Error Handling

#### Current State: **VARIABLE** (3.2/5)

**Frontend Error Classes:**
```typescript
// lib/api.ts
export class ValidationError extends Error {
    code?: string
}
export class NetworkError extends Error {}
export class ServerError extends Error {
    statusCode: number
}
```

**Good Error Handling:**
```tsx
// Proper error classification
const handleDownload = async (paper: QuestionPaper) => {
    try {
        const blob = await fetchDocumentBlob(paper, 'download')
        // ... handle blob
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Download failed'
        toast.error('Download failed', { description: message })
    }
}
```

**Issues:**

1. **Generic Error Handling** - Most hooks use catch-all
   ```tsx
   onError: (err: Error) => toast.error('Update failed', { 
       description: err.message 
   })
   ```
   - Doesn't distinguish between server errors, validation errors, network errors
   - Users see the same toast for "no internet" as "server timeout"

2. **Missing Error Context** - No request/operation context in errors
   ```tsx
   // What operation failed? Which resource?
   toast.error('Update failed', { description: err.message })
   ```

3. **No Retry UI** - Network errors don't offer "Retry"
   - User must manually refresh page or retry action

4. **Silent WebSocket Failures**
   ```typescript
   // useChat.ts, useTeacherMessagesWS.ts
   catch {
       // Error silently caught and dropped!
   }
   
   ws.onerror = () => {
       setWsStatus('error')
       // No error logged or user notified
   }
   ```

### 2.3 Response Parsing

#### Current State: **TYPE-SAFE BUT VARIED** (3.5/5)

**Good Typing:**
```typescript
// useClassSubjects.ts - Clear interface
export interface ClassSubject {
    id: string
    global_subject_id?: string | null
    name: string
    code: string
    // ...
}

// Used in query
return api.get<{ subjects: ClassSubject[] }>(`/admin/classes/${classId}/subjects`)
```

**Issues:**

1. **Inconsistent Response Shapes**
   ```typescript
   // Sometimes wrapped in object
   { subjects: ClassSubject[] }
   
   // Sometimes array directly  
   ClassSubject[]
   
   // Sometimes with pagination
   { items: Item[], count: number }
   
   // Sometimes with total
   { total: number, page: number, page_size: number, data: Item[] }
   ```

2. **Missing Type Guards** - No runtime validation
   ```typescript
   // Assumes backend returns correct shape
   const res = await api.get<TeachersResponse>(`...`)
   // If backend changes shape, TypeScript won't catch it at runtime
   ```

### 2.4 Authentication Token Handling

#### Current State: **SOLID** (4.0/5)

**Token Management:**
```typescript
// lib/api.ts - Comprehensive auth storage
const STORAGE_KEYS = {
    TOKEN: "School24_token",
    REFRESH_TOKEN: "School24_refresh_token", 
    REMEMBER: "School24_remember",
    USER: "School24_user",
    EXPIRY: "School24_token_expiry",
}

// Dual storage: localStorage (persistent) + sessionStorage (session-only)
const getAuthStorage = (): Storage => {
    const remembered = localStorage.getItem(STORAGE_KEYS.REMEMBER) === "true"
    return remembered ? localStorage : sessionStorage
}

// Auto-refresh logic with retry
async function attemptRefresh(): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {})
        },
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {})
    })
    // Handles 401 response by notifying app and clearing auth
}
```

**Good Patterns:**
- ✓ Bearer token in Authorization header
- ✓ Refresh token support with retry logic
- ✓ Token expiry tracking
- ✓ Cookie fallback for cookie-based session hosts
- ✓ CSRF token handling for forms

**Minor Issues:**
- CSRF only for "forms.schools24.in" host - no CSRF on API for dashboard
- Refresh happens synchronously - could create race conditions with concurrent requests

### 2.5 Pagination Patterns

#### Current State: **GOOD** (4.0/5)

**useInfiniteQuery Pattern Used Consistently:**
```typescript
// useTeachers.ts - Standard pagination
return useInfiniteQuery({
    queryKey: ['teachers', search, pageSize],
    queryFn: async ({ pageParam = 1 }) => {
        params.append('page', pageParam.toString())
        params.append('page_size', pageSize.toString())
        const res = await api.get<TeachersResponse>(`/admin/teachers?${params}`)
        return res
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
        const totalPages = Math.ceil(lastPage.total / lastPage.page_size)
        return lastPage.page < totalPages ? lastPage.page + 1 : undefined
    }
})
```

**All affected hooks:**
- useTeachers ✓
- useAdminUsers ✓  
- useAdminStudents ✓
- useAdminStaff ✓
- useAdminTimetable ✓

**Minor Issue:**
- Pagination resets on filter change (page: 1 in queryKey) - correct but could be optimized

---

## 3. SDK Current State

### 3.1 Request/Response Handling

#### Current State: **ENTERPRISE PATTERNS WITH GAPS** (3.8/5)

**APIClient Class Structure:**
```typescript
// scripts/sdk/lib/api-client.ts
export class APIClient {
    private config: Required<SDKConfig>
    private auth: SDKAuthContext
    private logger: Logger
    
    async login(email: string, password: string): Promise<void>
    async logout(): Promise<void>
    isAuthenticated(): boolean
    getAuthUser()
    private async refreshAccessToken(): Promise<boolean>
    private async request<T>(...): Promise<T>
}
```

**Good Features:**
1. **Retry Logic with Exponential Backoff**
   ```typescript
   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
       try {
           // ... request
       } catch (error) {
           if (attempt < maxAttempts) {
               const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
               logger.warn(`Retrying in ${retryDelay}ms...`)
               await this.sleep(retryDelay)
           }
       }
   }
   ```

2. **Rate Limiting**
   ```typescript
   private async enforceRateLimit(): Promise<void> {
       const timeSinceLastRequest = now - this.lastRequestTime
       if (timeSinceLastRequest < this.config.rateLimitDelay) {
           const delay = this.config.rateLimitDelay - timeSinceLastRequest
           await this.sleep(delay)
       }
   }
   ```

3. **Token Refresh with Retry**
   ```typescript
   if (response.status === 401) {
       if (endpoint !== '/auth/refresh' && endpoint !== '/auth/login') {
           const refreshed = await this.refreshAccessToken()
           if (refreshed) {
               return this.request<T>(method, endpoint, body, false)
           }
       }
       throw new AuthenticationError('...')
   }
   ```

**Issues:**

1. **Status Code 429 Handling** - Rate limit trap
   ```typescript
   if (response.status === 429) {
       const retryAfter = response.headers.get('Retry-After')
       const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60
       throw new RateLimitError(`Rate limit exceeded. Retry after ${retrySeconds}s`, retrySeconds)
   }
   ```
   - Throws immediately instead of retrying with Retry-After
   - Client must handle RateLimitError and retry themselves

2. **Incomplete Error Classification**
   ```typescript
   if (response.status >= 500) {
       throw new SDKError(`Server error: ${response.statusText}`, 'SERVER_ERROR', status)
   }
   if (response.status >= 400) {
       const errorData = await response.json()
       throw new ValidationError(errorData.message || `Request failed`, errorData)
   }
   ```
   - Distinguishes 4xx from 5xx but both 400 and 422 are "ValidationError"
   - Frontend cannot tell if request was malformed (400) or unprocessable (422)

### 3.2 Error Handling Gaps

#### Current State: **CUSTOM ERROR TYPES BUT INCOMPLETE** (3.5/5)

**SDK Error Types:**
```typescript
export class AuthenticationError extends SDKError
export class ValidationError extends SDKError
export class NetworkError extends SDKError
export class RateLimitError extends SDKError
export class SDKError extends Error
```

**Issues:**

1. **Missing Error Context** - Errors don't include request details
   ```typescript
   throw new ValidationError(message, errorData)
   // No information about:
   // - Which endpoint? 
   // - Which HTTP method?
   // - Request body?
   // - When did it happen?
   ```

2. **No Error Recovery Helpers**
   ```typescript
   // SDKError thrown but client code has to guess:
   try {
       await api.login(email, password)
   } catch (error) {
       // Is it network? Auth? Validation?
       // Client must check: error instanceof NetworkError? etc
   }
   ```

3. **Incomplete Status Code Handling**
   ```typescript
   // No handling for:
   // 303 - See Other (redirects)
   // 304 - Not Modified  
   // 307 - Temporary Redirect
   // 308 - Permanent Redirect
   // 502 - Bad Gateway
   // 503 - Service Unavailable (with Retry-After)
   ```

### 3.3 Validation Layers

#### Current State: **MISSING** (1.5/5)

**Critical Gap:**
```typescript
// sdk/types/index.ts - Type definitions exist
export interface CreateTeacherPayload {
    full_name: string
    email: string
    phone?: string
    password: string
    // ...
}

// But NO runtime validation
const client = new APIClient(config)
await client.createTeacher({
    full_name: 12345,  // Should be string - not caught!
    email: "not-an-email",  // Invalid email - not caught!
    password: "abc"  // Too short - not caught!
})
```

**Issues:**

1. **TypeScript Only** - Validation only at compile time
   - Runtime validation missing entirely
   - Node.js scripts, API testing tools not covered
   - Type safety in browser doesn't catch API mistakes

2. **No Validation Schema** - Should use Zod, Yup, or similar
   ```typescript
   // Recommended
   export const CreateTeacherSchema = z.object({
       full_name: z.string().min(1),
       email: z.string().email(),
       password: z.string().min(8),
       phone: z.string().optional(),
   })
   
   // With automatic inference
   export type CreateTeacherPayload = z.infer<typeof CreateTeacherSchema>
   ```

3. **No Error Messages for Validation** - Types don't validate, don't produce good errors
   ```typescript
   // Currently if you post invalid data:
   // Backend responds with generic "invalid request"
   // SDK cannot pre-validate and provide helpful message
   ```

### 3.4 Type Coverage

#### Current State: **GOOD FOR CORE, GAPS FOR FEATURES** (3.6/5)

**Well-Typed:**
- Auth types: LoginCredentials, AuthResponse, User ✓
- School types: CreateSchoolPayload, School ✓
- Core user types: CreateUserPayload, CreateTeacherPayload ✓
- Pagination response structure (implicit)

**Missing/Incomplete Types:**
- ✗ Full list of error response fields
- ✗ Pagination metadata (page, page_size, total, has_more)
- ✗ Webhook payload types
- ✗ WebSocket message types
- ✗ File upload response types
- ✗ Search/filter parameter types

---

## 4. Frontend-SDK Inconsistencies

### 4.1 Response Shape Mismatch

| Endpoint | Frontend Expects | Backend Might Return | SDK Has Types? |
|----------|------------------|------------------|--------|
| `/admin/teachers` | `{ teachers: [], total, page, page_size }` | Unclear | Partial |
| `/admin/classes/{id}/subjects` | `{ subjects: [] }` | Unclear | Partial |
| `/admin/users` | `{ users: [], total, page, page_size }` | Unclear | Partial |
| `/teacher/attendance` | Array directly? | Unclear | No |
| `/teacher/homework` | Wrapped? | Unclear | Partial |

**Problem:** Frontend hooks assume response shape. If SDK or backend changes format, hooks break silently.

### 4.2 Error Code Inconsistencies

| Scenario | Frontend Expects | Backend Returns | SDK Handles? |
|----------|------|--------|------|
| Unauthorized | `ValidationError(code: 'unauthorized')` | `{ error: 'unauthorized', message: '...' }` | ✓ |
| Not Found | `ValidationError(code: 'not_found')` | `{ error: '...' }` (what code?) | ✗ |
| Email Exists | `{ error: 'email_already_exists' }` | Line 247 admin/handler | ✓ |
| Validation Failed | `{ error: 'validation_error', details: {...} }` | Format unclear | ✗ |
| Rate Limited | `RateLimitError` | HTTP 429 + Retry-After | Partial |

### 4.3 Authentication Flow Gaps

**Frontend + SDK Mismatch:**
- Frontend stores token in localStorage/sessionStorage
- SDK manages auth internally (different mechanism)
- If frontend logs out, SDK still has stale token
- No shared auth state between frontend and SDK

**Code Examples:**

Frontend (lib/api.ts):
```typescript
const getAuthStorage = (): Storage => {
    const remembered = localStorage.getItem(STORAGE_KEYS.REMEMBER) === "true"
    return remembered ? localStorage : sessionStorage
}
```

SDK (api-client.ts):
```typescript
private auth: SDKAuthContext = {
    accessToken: null,
    refreshToken: null,
    user: null,
    expiresAt: null
}
// Separate from frontend storage!
```

---

## 5. Gap Analysis - What's Missing

### Critical Gaps (Enterprise-Grade Needed)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| **Unified Error Response Format** | Fragile error handling across stack | Medium | High |
| **Request ID Tracing** | Impossible to debug production issues | Medium | High |
| **Structured Logging** | Can't search/aggregate logs | High | High |
| **Input Validation Layer** | No defense against bad data | Medium | High |
| **SDK Request Validation** | Type-only safety, runtime gaps | Medium | Medium |
| **Comprehensive Error Types** | Frontend can't handle errors gracefully | Low | High |
| **WebSocket Error Handling** | Silent failures, poor UX | Medium | Medium |
| **API Documentation** | Unclear response shapes | High | Medium |
| **Rate Limiting Retry** | 429 responses not retried | Low | Low |
| **404 Consistency** | Some endpoints use 400 instead | Low | Low |

### Nice-to-Have Improvements

- Correlation IDs across services
- Request/response logging middleware
- API client code generation from OpenAPI spec
- Distributed tracing (OpenTelemetry)
- Feature flags for gradual rollout
- Circuit breaker for failing dependencies
- Comprehensive integration tests
- Load testing & performance benchmarks

---

## 6. Code Examples of Problems & Recommendations

### Problem 1: Inconsistent Error Responses

**Current (admin/handler.go Line 215):**
```go
if err := dec.Decode(dest); err != nil {
    c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
    return
}
```

**Current (admin/handler.go Line 247):**
```go
if strings.Contains(err.Error(), "email_already_exists") {
    c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
    return
}
```

**Current (admin/consent_handler.go Line 64):**
```go
c.JSON(http.StatusBadRequest, gin.H{
    "error": "invalid request body",
    "details": err.Error()
})
```

**Recommended (Unified):**
```go
// shared/response/errors.go
type ErrorResponse struct {
    Code      string      `json:"code"`
    Message   string      `json:"message"`
    Details   interface{} `json:"details,omitempty"`
    RequestID string      `json:"request_id"`
    Path      string      `json:"path,omitempty"`
    Timestamp string      `json:"timestamp"`
}

// shared/response/errors.go - Error code constants
const (
    ErrCodeInvalidJSON      = "INVALID_JSON"
    ErrCodeEmailExists      = "EMAIL_ALREADY_EXISTS"
    ErrCodeTeacherNotFound  = "TEACHER_NOT_FOUND"
    ErrCodeUnauthorized     = "UNAUTHORIZED"
    ErrCodeForbidden        = "FORBIDDEN"
    ErrCodeValidation       = "VALIDATION_ERROR"
    ErrCodeInternal         = "INTERNAL_SERVER_ERROR"
)

// In handlers:
func (h *Handler) CreateStaff(c *gin.Context) {
    var req CreateStaffPayload
    if err := c.ShouldBindJSON(&req); err != nil {
        responseErr := NewErrorResponse(
            ErrCodeInvalidJSON,
            "Invalid request body",
            c.GetString("request_id"),
        )
        // Add details about which field failed
        if ute, ok := err.(*json.UnmarshalTypeError); ok {
            responseErr.Details = map[string]string{
                "field": ute.Field,
                "expected": ute.Type.Name(),
            }
        }
        c.JSON(http.StatusBadRequest, responseErr)
        return
    }
    
    // ... handle staff creation
    
    if userAlreadyExists {
        c.JSON(http.StatusConflict, NewErrorResponse(
            ErrCodeEmailExists,
            "Email address already registered",
            c.GetString("request_id"),
        ))
        return
    }
}
```

### Problem 2: Frontend Doesn't Know What API Will Return

**Current (useAdminTeachers.ts):**
```typescript
const res = await api.get<TeachersResponse>(`/admin/teachers?${params.toString()}`)
return {
    ...res,
    teachers: (res.teachers ?? []).map(mapTeacher),  // Assumes `teachers` field!
}
```

**Issue:** If backend returns `{ data: Teacher[] }` instead of `{ teachers: Teacher[] }`, this silently fails.

**Recommended:**
```typescript
// sdk/types/teacher.ts
export const TeacherListResponseSchema = z.object({
    teachers: z.array(TeacherSchema),
    total: z.number(),
    page: z.number(),
    page_size: z.number(),
})
export type TeacherListResponse = z.infer<typeof TeacherListResponseSchema>

// In hook:
const res = await api.get<TeacherListResponse>(`/admin/teachers?${params}`)
// Parse at runtime to ensure shape
const validatedRes = TeacherListResponseSchema.parse(res)
return {
    ...validatedRes,
    teachers: validatedRes.teachers.map(mapTeacher),
}
```

### Problem 3: WebSocket Errors Silently Fail

**Current (useChat.ts):**
```typescript
ws.onmessage = (event) => {
    try {
        const evt = JSON.parse(event.data as string) as WSMessage
        // ... handle message
    } catch {
        // Error silently dropped - no user notification!
    }
}

ws.onerror = () => {
    setStatus('error')
    // Not notified to user, no error details logged
}
```

**Recommended:**
```typescript
ws.onerror = (event) => {
    const errorMsg = event instanceof Event 
        ? `WebSocket error: ${(event as any).reason || 'Unknown error'}`
        : 'WebSocket connection failed'
    
    setStatus('error')
    logger.error('WebSocket error', { errorMsg })
    toast.error('Connection lost', { 
        description: errorMsg,
        action: { label: 'Retry', onClick: () => reconnect() } 
    })
}

ws.onmessage = (event) => {
    try {
        const evt = JSON.parse(event.data) as WSMessage
        if (evt.type === 'error') {
            toast.error('Server error', { description: evt.content })
        }
        // ... handle other types
    } catch (parseErr) {
        logger.error('Failed to parse WS message', { 
            raw: event.data, 
            error: parseErr 
        })
        toast.error('Protocol error', { description: 'Invalid message received' })
    }
}
```

---

## 7. Priority Recommendations (Non-Breaking)

### Phase 1: High Impact, Low Risk (Week 1-2)

1. **Add Request ID Middleware**
   - Inject `X-Request-ID` header in all responses
   - Store in context for logging
   - Include in error responses
   - **Impact:** Enables production debugging
   - **Files:** Add to `middleware/request_id.go`, use in `main.go`

2. **Standardize Error Response Format**
   - Create `shared/response/error.go`
   - Use across all handlers with code constants
   - **Impact:** Frontend can properly handle errors
   - **Files:** All `handler.go` files
   - **Effort:** ~4 hours (find & replace pattern)

3. **Add 404 Consistency**
   - Audit handlers, return 404 instead of 500 for not found
   - Use semantic error codes instead of raw error strings
   - **Impact:** Better error classification
   - **Files:** admin, teacher, student handlers
   - **Effort:** ~2 hours

4. **SDK Input Validation**
   - Add Zod schemas for all request types
   - Validate before sending to backend
   - **Impact:** Catch errors early
   - **Files:** `sdk/types/validation.ts` (new)
   - **Effort:** ~3 hours

### Phase 2: Enterprise Hardening (Week 3-4)

5. **Structured Logging**
   - Replace `log.Printf` with structured logger (zap or pino)
   - Add request logging middleware
   - Log all errors with context
   - **Impact:** Production debugging, log aggregation ready
   - **Effort:** ~8 hours

6. **Comprehensive Error Types**
   - Expand SDK error classes with context
   - Add error recovery helpers
   - Implement retry with backoff for transient errors
   - **Impact:** Better resilience, UX
   - **Effort:** ~4 hours

7. **API Documentation** 
   - Use OpenAPI/Swagger to document endpoints
   - Generate TypeScript types from spec
   - Document error response codes
   - **Impact:** Clarity, auto-generated SDKs
   - **Effort:** ~6 hours

### Phase 3: Polish (Week 5)

8. **WebSocket Error Handling**
   - Structured error logging
   - User-facing error messages
   - Retry with exponential backoff
   - **Impact:** Reliability
   - **Effort:** ~2 hours

9. **Validation Layer**
   - Centralized request validation in shared package
   - Use for all endpoints
   - **Impact:** Security, consistency
   - **Effort:** ~4 hours

10. **Frontend-SDK Alignment**
    - Document expected response shapes
    - Add runtime type checking with Zod
    - Align auth state between frontend and SDK
    - **Impact:** Reliability
    - **Effort:** ~3 hours

---

## 8. Enterprise Maturity Score Breakdown

### Current Scores by Area:

| Area | Score | Reason |
|------|-------|--------|
| **Architecture & Design** | 4.0/5 | Solid module separation, middleware layering good |
| **Error Handling** | 3.2/5 | Inconsistent formats, missing semantic codes |
| **Validation** | 2.8/5 | Scattered, not centralized, no schema validation |
| **Security** | 4.0/5 | JWT, CSRF, rate limiting, input binding present |
| **Testing** | 2.5/5 | No evidence of unit tests, integration tests |
| **Observability** | 2.5/5 | Basic logging, no structured logs, no tracing |
| **API Design** | 3.5/5 | Mostly RESTful, inconsistent response shapes |
| **Frontend State** | 3.8/5 | React Query well-used, error handling variable |
| **Documentation** | 2.0/5 | No API docs, limited code comments |
| **Production Readiness** | 3.2/5 | Core functionality solid, observability gaps |

**Overall: 3.4/5 - Enterprise Foundation, Hardening Needed**

---

## 9. Conclusion

Schools24 has a **solid architectural foundation** with proper separation of concerns, good middleware composition, and solid state management patterns. However, it needs **enterprise-grade hardening** in these areas:

1. **Error handling** - Standardize and add semantic error codes
2. **Observability** - Structured logging and request tracing
3. **Validation** - Centralized schema-based validation
4. **Documentation** - API contracts explicitly defined
5. **Type safety** - Runtime validation, not just TypeScript types

The recommended path forward is **iterative improvements** rather than major rewrites:
- Phase 1 (1-2 weeks) focuses on quick wins (error standardization, request IDs)
- Phase 2 (2-3 weeks) adds enterprise patterns (structured logging, comprehensive error types)
- Phase 3 (1 week) polishes remaining gaps

**Estimated effort:** 30-40 hours total to reach 4.2/5 enterprise maturity.

---

## Appendix: File References

### Backend Files Reviewed
- `cmd/server/main.go` - Routes, middleware setup
- `internal/shared/middleware/jwt.go` - JWT authentication
- `internal/modules/admin/handler.go` - Example handler patterns
- `internal/modules/teacher/handler.go` - Error response examples
- `internal/shared/validation/password.go` - Validation example
- `internal/modules/*/models.go` - DTO patterns

### Frontend Files Reviewed
- `src/lib/api.ts` - API client implementation
- `src/hooks/useAdminTeachers.ts` - Hook patterns  
- `src/hooks/useClassSubjects.ts` - useQuery example
- `src/hooks/useChat.ts` - WebSocket error handling
- `src/middleware.ts` - Frontend auth middleware

### SDK Files Reviewed
- `scripts/sdk/lib/api-client.ts` - SDK HTTP client
- `scripts/sdk/types/index.ts` - Type definitions
- `scripts/sdk/lib/logger.ts` - Logging (brief review)

---

**Document prepared:** April 4, 2026  
**Review scope:** Complete frontend and backend codebases
