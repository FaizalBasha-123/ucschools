# Authorization

## Route Guards

### Backend Middleware
1. **JWT Middleware**: Validates token, extracts claims
2. **Tenant Middleware**: Sets school context
3. **Role Guards**: Checks user role vs required role
4. **User Validation**: Checks active status, suspension

### Frontend Guards
- `middleware.ts` - Next.js middleware checks auth
- `AuthContext` - Global auth state
- Conditional rendering per role

## Role-Based Access

### Super Admin Routes
Pattern: `/api/v1/super-admin/*`
- Full system access
- Can impersonate school context

### Admin Routes
Pattern: `/api/v1/admin/*`
- School-scoped access
- Cannot access other schools

### Teacher Routes
Pattern: `/api/v1/teacher/*`
- Class-scoped access
- Can only access assigned classes

### Student Routes
Pattern: `/api/v1/student/*`
- Self-only access
- Cannot access other students

## Tenant Isolation
- JWT contains `school_id`
- Middleware sets `tenant_schema` context
- DB queries automatically scoped
- No manual WHERE school_id filters

## Permission Checks
```go
// Example permission check
if user.Role != "admin" && user.Role != "super_admin" {
    return c.JSON(403, gin.H{"error": "Forbidden"})
}
```

## Special Cases
- Super admin can pass `school_id` in request
- Admin can view teacher data in their school
- Teacher can view student data in their classes
- Students can only view own data
