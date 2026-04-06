-- Migration 048: Repair orphaned user profiles
--
-- Problem: Users created via the User Management page (POST /admin/users) only
-- get a row in the `users` table. If their role is 'student' or 'teacher', they
-- also need corresponding rows in the `students` / `teachers` profile tables to
-- appear in the students-details / teachers-details pages.
--
-- This migration creates minimal stub profile rows for any existing orphaned users.

DO $$
DECLARE
    tenant_uuid UUID;
    y INT := EXTRACT(YEAR FROM NOW())::INT;
    academic_year_default TEXT;
BEGIN
    -- Derive tenant UUID from the current schema name (e.g. school_<uuid>)
    tenant_uuid := NULLIF(regexp_replace(current_schema(), '^school_', ''), '')::UUID;
    IF tenant_uuid IS NULL THEN
        RAISE NOTICE 'Skipping migration 048 – not running in a tenant schema';
        RETURN;
    END IF;

    academic_year_default := y::text || '-' || (y + 1)::text;

    -- ── Students ──────────────────────────────────────────────────────────────
    -- Create stub student profiles for users with role='student' who have no
    -- matching row in the `students` table.
    INSERT INTO students (
        school_id, user_id, admission_number,
        gender, academic_year, date_of_birth, admission_date
    )
    SELECT
        tenant_uuid,
        u.id,
        'ADM-' || UPPER(SUBSTRING(u.id::text, 1, 8)),
        'other',
        academic_year_default,
        '2000-01-01'::date,
        CURRENT_DATE
    FROM users u
    WHERE u.role = 'student'
      AND NOT EXISTS (
          SELECT 1 FROM students s WHERE s.user_id = u.id
      )
    ON CONFLICT DO NOTHING;

    -- ── Teachers ──────────────────────────────────────────────────────────────
    -- Create stub teacher profiles for users with role='teacher' who have no
    -- matching row in the `teachers` table.
    INSERT INTO teachers (
        school_id, user_id, employee_id, department, status
    )
    SELECT
        tenant_uuid,
        u.id,
        'EMP-' || UPPER(SUBSTRING(u.id::text, 1, 8)),
        'General',
        'active'
    FROM users u
    WHERE u.role = 'teacher'
      AND NOT EXISTS (
          SELECT 1 FROM teachers t WHERE t.user_id = u.id
      )
    ON CONFLICT DO NOTHING;

END $$;
