# Schools24 Codebase Memory

This folder contains structured documentation of the Schools24 codebase for efficient LLM context loading.

## Structure

### 01-architecture/
High-level system design
- `overview.md` - System architecture overview
- `tech-stack.md` - Complete technology stack

### 02-backend/
Go backend documentation
- `entry-point.md` - Startup flow & server config
- `modules.md` - Feature modules & structure

### 03-frontend/
Next.js frontend documentation
- `structure.md` - App structure & routing
- `components.md` - UI components organization
- `hooks.md` - Custom React hooks (40+)

### 04-database/
Database schema & isolation
- `schema-global.md` - Global (public) schema
- `schema-tenant.md` - Tenant schema (school_*)
- `tenant-isolation.md` - Multi-tenant strategy

### 05-features/
Feature documentation
- `user-roles.md` - Roles & permissions
- `key-features.md` - Core functionality

### 06-auth/
Authentication & authorization
- `authentication.md` - Auth flow & JWT
- `authorization.md` - Role-based access control

### 07-api-reference/
API endpoint documentation
- `admin-routes.md` - Admin API endpoints
- `teacher-routes.md` - Teacher API endpoints
- `student-routes.md` - Student API endpoints
- `super-admin-routes.md` - Super admin API endpoints

### 08-deployment/
Deployment guides
- `docker.md` - Docker & Docker Compose
- `production.md` - Production deployment

## Usage

Load only the files you need for your current task:
- Working on backend? → `02-backend/`
- Working on frontend? → `03-frontend/`
- Need database info? → `04-database/`
- Need API reference? → `07-api-reference/`

## Benefits

✅ **Smaller files** - Faster loading, less context usage
✅ **Organized** - Easy to find specific information
✅ **Focused** - Load only what you need
✅ **Maintainable** - Easy to update individual sections
