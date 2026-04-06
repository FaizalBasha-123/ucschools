# Multi-Tenant Isolation

## Schema Strategy
**Schema-per-tenant**: Each school has isolated PostgreSQL schema

## Naming Convention
- Global: `public` schema
- Tenant: `school_<uuid>` schema

## Middleware Flow
1. JWT decoded → extract `school_id`
2. Tenant middleware sets context: `tenant_schema = "school_<uuid>"`
3. DB query uses search path: `SET search_path TO school_<uuid>, public`

## Migration Strategy
- **Global migrations**: `migrations/global/` (35 files)
  - Run once on public schema
  - Platform-wide tables
  
- **Tenant migrations**: `migrations/tenant/` (76 files)
  - Run for each school schema
  - School-specific tables

## Runtime Schema Creation
On app startup:
1. Query all schools from `public.schools`
2. For each school: `CREATE SCHEMA IF NOT EXISTS school_<uuid>`
3. Apply tenant migrations to each schema

## Super Admin Handling
- Super admins can pass `school_id` in requests
- Allows cross-tenant admin operations
- Context middleware validates super admin role

## Benefits
- Complete data isolation
- No WHERE school_id filters needed
- Database-level security
- Easy backup/restore per school
- Compliance-friendly (data residency)
