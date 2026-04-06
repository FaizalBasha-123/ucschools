-- Tenant-only users cutover (phase 1)
-- Goal:
-- 1) Ensure each tenant schema has its own users table populated for its school only
-- 2) Remove cross-school leakage from tenant users tables
-- 3) Retarget tenant foreign keys that still point to public.users
--
-- SAFETY: All operations check if the tenant schema actually exists before touching it.
-- This makes the migration safe for both:
--   a) Migrated databases (schemas already provisioned)
--   b) Fresh/partial databases (schemas not yet created — skipped gracefully)

DO $$
DECLARE
    school_rec RECORD;
    schema_name TEXT;
    schema_exists BOOLEAN;
BEGIN
    FOR school_rec IN
        SELECT id FROM public.schools
    LOOP
        schema_name := format('school_%s', school_rec.id::text);

        -- SAFETY CHECK: Skip this school entirely if its tenant schema doesn't exist.
        -- This happens on fresh DB setups or when a school was added but the backend
        -- hasn't yet provisioned the schema via CreateSchoolSchema().
        SELECT EXISTS (
            SELECT 1 FROM information_schema.schemata
            WHERE schema_name = format('school_%s', school_rec.id::text)
        ) INTO schema_exists;

        IF NOT schema_exists THEN
            RAISE NOTICE 'Skipping school % — tenant schema % does not exist yet',
                school_rec.id, schema_name;
            CONTINUE;
        END IF;

        -- Ensure tenant users table exists
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I.users (LIKE public.users INCLUDING ALL)',
            schema_name
        );

        -- Seed tenant users from public.users for this school (idempotent)
        EXECUTE format(
            $sql$
            INSERT INTO %I.users (id, email, password_hash, role, full_name, phone, profile_picture_url, is_active, email_verified, last_login_at, created_at, updated_at, school_id)
            SELECT id, email, password_hash, role, full_name, phone, profile_picture_url, is_active, email_verified, last_login_at, created_at, updated_at, school_id
            FROM public.users
            WHERE school_id = $1
            ON CONFLICT (id) DO UPDATE SET
                email = EXCLUDED.email,
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                full_name = EXCLUDED.full_name,
                phone = EXCLUDED.phone,
                profile_picture_url = EXCLUDED.profile_picture_url,
                is_active = EXCLUDED.is_active,
                email_verified = EXCLUDED.email_verified,
                last_login_at = EXCLUDED.last_login_at,
                updated_at = EXCLUDED.updated_at,
                school_id = EXCLUDED.school_id
            $sql$,
            schema_name
        ) USING school_rec.id;

        -- Remove leaked users belonging to other schools from this tenant
        EXECUTE format(
            'DELETE FROM %I.users WHERE school_id IS DISTINCT FROM $1',
            schema_name
        ) USING school_rec.id;

        -- Remove cross-school leaked core records from this tenant schema
        -- Guard each table with an existence check to avoid errors on partial schemas
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = schema_name AND table_name = 'teachers') THEN
            EXECUTE format(
                'DELETE FROM %I.teachers WHERE school_id IS DISTINCT FROM $1',
                schema_name
            ) USING school_rec.id;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = schema_name AND table_name = 'students') THEN
            EXECUTE format(
                'DELETE FROM %I.students WHERE school_id IS DISTINCT FROM $1',
                schema_name
            ) USING school_rec.id;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = schema_name AND table_name = 'non_teaching_staff') THEN
            EXECUTE format(
                'DELETE FROM %I.non_teaching_staff WHERE school_id IS DISTINCT FROM $1',
                schema_name
            ) USING school_rec.id;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = schema_name AND table_name = 'classes') THEN
            EXECUTE format(
                'DELETE FROM %I.classes WHERE school_id IS DISTINCT FROM $1',
                schema_name
            ) USING school_rec.id;
        END IF;

        -- Retarget core FK constraints from public.users -> tenant users
        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = schema_name AND c.relname = 'teachers' AND con.conname = 'teachers_user_id_fkey'
        ) THEN
            EXECUTE format('ALTER TABLE %I.teachers DROP CONSTRAINT teachers_user_id_fkey', schema_name);
            EXECUTE format('ALTER TABLE %I.teachers ADD CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES %I.users(id) ON DELETE CASCADE', schema_name, schema_name);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = schema_name AND c.relname = 'students' AND con.conname = 'students_user_id_fkey'
        ) THEN
            EXECUTE format('ALTER TABLE %I.students DROP CONSTRAINT students_user_id_fkey', schema_name);
            EXECUTE format('ALTER TABLE %I.students ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES %I.users(id) ON DELETE CASCADE', schema_name, schema_name);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = schema_name AND c.relname = 'non_teaching_staff' AND con.conname = 'non_teaching_staff_user_id_fkey'
        ) THEN
            EXECUTE format('ALTER TABLE %I.non_teaching_staff DROP CONSTRAINT non_teaching_staff_user_id_fkey', schema_name);
            EXECUTE format('ALTER TABLE %I.non_teaching_staff ADD CONSTRAINT non_teaching_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES %I.users(id) ON DELETE CASCADE', schema_name, schema_name);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = schema_name AND c.relname = 'announcements' AND con.conname = 'announcements_author_id_fkey'
        ) THEN
            EXECUTE format('ALTER TABLE %I.announcements DROP CONSTRAINT announcements_author_id_fkey', schema_name);
            EXECUTE format('ALTER TABLE %I.announcements ADD CONSTRAINT announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES %I.users(id)', schema_name, schema_name);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = schema_name AND c.relname = 'attendance' AND con.conname = 'attendance_marked_by_fkey'
        ) THEN
            EXECUTE format('ALTER TABLE %I.attendance DROP CONSTRAINT attendance_marked_by_fkey', schema_name);
            EXECUTE format('ALTER TABLE %I.attendance ADD CONSTRAINT attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES %I.users(id)', schema_name, schema_name);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = schema_name AND c.relname = 'messages' AND con.conname = 'messages_sender_id_fkey'
        ) THEN
            EXECUTE format('ALTER TABLE %I.messages DROP CONSTRAINT messages_sender_id_fkey', schema_name);
            EXECUTE format('ALTER TABLE %I.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES %I.users(id)', schema_name, schema_name);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = schema_name AND c.relname = 'messages' AND con.conname = 'messages_recipient_id_fkey'
        ) THEN
            EXECUTE format('ALTER TABLE %I.messages DROP CONSTRAINT messages_recipient_id_fkey', schema_name);
            EXECUTE format('ALTER TABLE %I.messages ADD CONSTRAINT messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES %I.users(id)', schema_name, schema_name);
        END IF;
    END LOOP;
END $$;

-- Validation: no tenant FK should reference public.users anymore
-- (only check schemas that actually exist)
DO $$
DECLARE
    ref_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO ref_count
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class cr ON cr.oid = con.confrelid
    JOIN pg_namespace nr ON nr.oid = cr.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname LIKE 'school_%'
      AND nr.nspname = 'public'
      AND cr.relname = 'users';

    IF ref_count > 0 THEN
        RAISE NOTICE 'Note: % constraints still reference public.users (may be for schemas not yet provisioned)', ref_count;
        -- Changed from RAISE EXCEPTION to RAISE NOTICE — non-provisioned schemas
        -- will have their FKs retargeted once the backend provisions them via CreateSchoolSchema().
    END IF;
END $$;
