# Soft Delete & Trash Bin Architecture - Technical Documentation

## Overview
This document explains the complete soft-delete system with trash bin functionality and password verification for all sensitive super admin operations.

---

## 1. DATABASE SCHEMA CHANGES

### Migration: `006_add_soft_delete_to_schools.sql`

**Changes to `public.schools` table:**
```sql
ALTER TABLE public.schools 
ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL,
ADD COLUMN deleted_by UUID DEFAULT NULL,
ADD CONSTRAINT fk_schools_deleted_by 
FOREIGN KEY (deleted_by) REFERENCES public.super_admins(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX idx_schools_deleted_at ON public.schools(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_schools_active ON public.schools(deleted_at) WHERE deleted_at IS NULL;
```

**What these fields do:**
- `deleted_at`: Timestamp when school was soft-deleted (NULL = active, NOT NULL = deleted)
- `deleted_by`: UUID of the super admin who deleted it
- Indexes speed up queries filtering by deleted status

---

## 2. PASSWORD VERIFICATION LAYER

### Auth Service: `VerifySuperAdminPassword()`

**Purpose:** Verify super admin identity before sensitive operations

**Flow:**
```
1. Client sends: superAdminID + password
2. Backend fetches super_admins row from DB: SELECT * FROM super_admins WHERE id = ?
3. Retrieve password_hash from database
4. Compare: bcrypt.CompareHashAndPassword(stored_hash, provided_password)
5. Return: nil (success) or ErrInvalidPassword
```

**Used in 5 operations:**
1. Create School
2. Delete School (soft delete)
3. Restore School
4. Create Super Admin
5. Delete Super Admin

---

## 3. SOFT DELETE OPERATIONS

### A. Create School (with password verification)

**API Endpoint:** `POST /api/v1/super-admin/schools`

**Request Body:**
```json
{
  "name": "Test School",
  "address": "123 Main St",
  "contact_email": "admin@school.com",
  "admins": [{"name": "Admin User", "email": "admin@test.com", "password": "pass123"}],
  "password": "super_admin_password_here"
}
```

**Backend Flow:**
```
Handler (handler.go):
├─ Extract super_admin_id from JWT claims
├─ Parse request body (school data + password)
└─ Call service.CreateSchoolWithAdmin(ctx, superAdminID, password, schoolData)

Service (service.go):
├─ 1. authService.VerifySuperAdminPassword(superAdminID, password)
│   ├─ Query: SELECT password_hash FROM super_admins WHERE id = ?
│   └─ Verify: bcrypt compare
├─ 2. Generate school UUID + slug
├─ 3. Start Transaction:
│   ├─ INSERT INTO schools (id, name, slug, ...) VALUES (...)
│   └─ INSERT INTO users (admin records) VALUES (...)
├─ 4. db.CreateSchoolSchema(schoolID)
│   ├─ CREATE SCHEMA "school_<uuid>"
│   └─ Run tenant migrations (students, classes, attendance, etc.)
└─ 5. Copy admin users to tenant schema

Database State After:
✓ schools table: new row with deleted_at = NULL
✓ users table: admin users with school_id
✓ New schema: school_<uuid> with all tenant tables
```

---

### B. Delete School (Soft Delete)

**API Endpoint:** `DELETE /api/v1/super-admin/schools/:id`

**Request Body:**
```json
{
  "password": "super_admin_password"
}
```

**Backend Flow:**
```
Handler (handler.go):
├─ Extract super_admin_id from JWT claims
├─ Parse school_id from URL params
├─ Parse password from request body
└─ Call service.SoftDeleteSchool(ctx, schoolID, superAdminID, password)

Service (service.go):
├─ 1. authService.VerifySuperAdminPassword(superAdminID, password)
├─ 2. Check school exists: SELECT * FROM schools WHERE id = ? AND deleted_at IS NULL
├─ 3. Soft delete: UPDATE schools 
│       SET deleted_at = NOW(), deleted_by = ?, updated_at = NOW()
│       WHERE id = ?
└─ Return success

Database State After:
✓ schools.deleted_at = '2026-02-11 14:30:00'
✓ schools.deleted_by = '<super_admin_uuid>'
✗ School does NOT show in GET /schools (filtered: WHERE deleted_at IS NULL)
✓ Tenant schema still exists (school_<uuid>)
✓ All data preserved (users, students, classes, etc.)
```

**Key Point:** School is hidden but data is intact. 24-hour recovery window starts.

---

### C. Get Deleted Schools (Trash Bin)

**API Endpoint:** `GET /api/v1/super-admin/schools/trash`

**Backend Flow:**
```
Handler:
└─ Call service.GetDeletedSchools()

Service:
└─ repo.GetDeletedSchools()

Repository (repository.go):
├─ Query:
│   SELECT s.id, s.name, s.deleted_at, s.deleted_by, 
│          sa.full_name as deleted_by_name
│   FROM schools s
│   LEFT JOIN super_admins sa ON s.deleted_by = sa.id
│   WHERE s.deleted_at IS NOT NULL
│   ORDER BY s.deleted_at DESC
└─ Return array of deleted schools

Response includes:
- School details
- When it was deleted (deleted_at)
- Who deleted it (deleted_by_name)
- Time remaining before permanent deletion
```

---

### D. Restore School

**API Endpoint:** `POST /api/v1/super-admin/schools/:id/restore`

**Request Body:**
```json
{
  "password": "super_admin_password"
}
```

**Backend Flow:**
```
Handler:
├─ Extract super_admin_id from JWT
├─ Parse school_id from URL
├─ Parse password from body
└─ Call service.RestoreSchool(ctx, schoolID, superAdminID, password)

Service:
├─ 1. authService.VerifySuperAdminPassword(superAdminID, password)
├─ 2. Get deleted schools: SELECT * FROM schools WHERE id = ? AND deleted_at IS NOT NULL
├─ 3. Check 24-hour window:
│   hoursSinceDeletion = time.Since(deleted_at).Hours()
│   if hoursSinceDeletion > 24 {
│       return error("cannot restore - more than 24 hours")
│   }
├─ 4. Restore: UPDATE schools 
│       SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
│       WHERE id = ?
└─ Return success

Database State After:
✓ schools.deleted_at = NULL (active again)
✓ schools.deleted_by = NULL
✓ School appears in GET /schools again
✓ All data still intact (no data was ever deleted)
```

---

## 4. PERMANENT DELETION (Background Job)

### Cleanup Job: Runs every 1 hour

**Location:** `cmd/server/main.go` (goroutine)

**Flow:**
```
Every Hour:
├─ service.CleanupOldDeletedSchools()
│   ├─ repo.GetSchoolsToCleanup()
│   │   └─ SELECT id FROM schools 
│   │       WHERE deleted_at IS NOT NULL 
│   │       AND deleted_at < NOW() - INTERVAL '24 hours'
│   └─ For each school_id:
│       └─ service.PermanentlyDeleteSchool(schoolID)

PermanentlyDeleteSchool (service.go):
├─ Start Transaction:
│   ├─ DELETE FROM users WHERE school_id = ?
│   └─ DELETE FROM schools WHERE id = ?
├─ db.DropSchoolSchema(schoolID)
│   └─ DROP SCHEMA "school_<uuid>" CASCADE
└─ Return

Database State After:
✗ schools row: DELETED
✗ users with school_id: DELETED
✗ schema school_<uuid>: DROPPED
✗ ALL tenant data: DELETED (students, classes, attendance, grades, etc.)
⚠️ IRREVERSIBLE - Data cannot be recovered
```

---

## 5. SUPER ADMIN MANAGEMENT (Password Verification)

### A. Create Super Admin

**API Endpoint:** `POST /api/v1/super-admins`

**Request:**
```json
{
  "email": "newadmin@schools24.com",
  "password": "new_admin_password",
  "full_name": "New Admin",
  "current_password": "current_super_admin_password"
}
```

**Flow:**
```
1. Verify current super admin password
2. Check if email exists: SELECT * FROM super_admins WHERE email = ?
3. Hash new admin password: bcrypt.GenerateFromPassword
4. INSERT INTO super_admins (id, email, password_hash, full_name, ...) VALUES (...)
```

---

### B. Delete Super Admin

**API Endpoint:** `DELETE /api/v1/super-admins/:id`

**Request:**
```json
{
  "password": "current_super_admin_password"
}
```

**Flow:**
```
1. Verify current super admin password
2. Check cannot delete self: if current_id == target_id { error }
3. Check at least 1 remains: SELECT COUNT(*) FROM super_admins
4. DELETE FROM super_admins WHERE id = ?
```

---

## 6. SECURITY MEASURES

### Password Verification Required For:
1. ✅ Create School
2. ✅ Delete School (soft delete)
3. ✅ Restore School
4. ✅ Create Super Admin
5. ✅ Delete Super Admin

### Safety Checks:
- ✅ Cannot delete self (super admin)
- ✅ Cannot delete last super admin
- ✅ Cannot restore after 24 hours
- ✅ All passwords hashed with bcrypt (DefaultCost = 10 rounds)
- ✅ JWT authentication on all endpoints
- ✅ Role verification: only `super_admin` role can access

---

## 7. API ENDPOINTS SUMMARY

| Method | Endpoint | Password Required | Purpose |
|--------|----------|-------------------|---------|
| POST | `/super-admin/schools` | ✅ | Create school |
| GET | `/super-admin/schools` | ❌ | List active schools |
| GET | `/super-admin/schools/trash` | ❌ | List deleted schools |
| GET | `/super-admin/schools/:id` | ❌ | Get school details |
| DELETE | `/super-admin/schools/:id` | ✅ | Soft delete school |
| POST | `/super-admin/schools/:id/restore` | ✅ | Restore school |
| GET | `/super-admins` | ❌ | List super admins |
| POST | `/super-admins` | ✅ | Create super admin |
| DELETE | `/super-admins/:id` | ✅ | Delete super admin |

---

## 8. DATABASE STATE TRANSITIONS

### School Lifecycle:

```
Create School
     ↓
[ACTIVE] (deleted_at = NULL)
     ↓ DELETE (with password)
[TRASH] (deleted_at = timestamp, 24hr window)
     ↓
   ┌─────────┬─────────┐
   ↓         ↓         ↓
RESTORE   < 24hrs   > 24hrs
(password)            ↓
   ↓              [PERMANENT]
[ACTIVE]          (row deleted,
                  schema dropped,
                  no recovery)
```

---

## 9. ERROR HANDLING

| Error | HTTP Code | When |
|-------|-----------|------|
| `incorrect password` | 401 | Password verification failed |
| `password verification required` | 401 | Password missing |
| `school not found` | 404 | School doesn't exist |
| `school is already deleted` | 400 | Trying to delete already deleted school |
| `school not found in trash` | 404 | School not in trash (restore failed) |
| `cannot restore (deleted more than 24 hours ago)` | 400 | Restore window expired |
| `cannot delete current super admin` | 400 | Self-delete blocked |
| `cannot delete last super admin` | 400 | Must keep 1+ super admin |
| `email already registered` | 400 | Email exists |

---

## 10. TESTING THE SYSTEM

### Test Soft Delete:
```bash
# 1. Delete school (needs password)
curl -X DELETE http://localhost:8081/api/v1/super-admin/schools/<school_id> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"password": "your_password"}'

# 2. Verify school hidden from main list
curl http://localhost:8081/api/v1/super-admin/schools \
  -H "Authorization: Bearer <token>"

# 3. Check trash bin
curl http://localhost:8081/api/v1/super-admin/schools/trash \
  -H "Authorization: Bearer <token>"

# 4. Restore school (within 24 hours)
curl -X POST http://localhost:8081/api/v1/super-admin/schools/<school_id>/restore \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"password": "your_password"}'
```

### Test Cleanup Job:
```bash
# Wait 1 hour OR restart server to trigger cleanup
# Schools deleted > 24 hours ago will be permanently deleted
```

---

## 11. KEY TAKEAWAYS

✅ **Soft Delete**: School hidden but data preserved (24-hour window)  
✅ **Password Security**: All sensitive operations require password verification  
✅ **Automatic Cleanup**: Background job permanently deletes after 24 hours  
✅ **Data Integrity**: Transactional operations ensure consistency  
✅ **Audit Trail**: `deleted_by` tracks who deleted schools  
✅ **No Mocks**: All database operations are real, tested against PostgreSQL  

This system balances **user safety** (recovery window) with **data hygiene** (automatic cleanup) while maintaining **security** (password verification for all destructive actions).
