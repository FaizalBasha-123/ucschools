-- Tenant-only events hardening
-- Migrates any legacy public.events rows into tenant schemas, then drops public.events.

DO $$
DECLARE
    rec RECORD;
    target_schema TEXT;
    migrated_count INTEGER := 0;
    skipped_count INTEGER := 0;
    ref_count INTEGER;
BEGIN
    IF to_regclass('public.events') IS NULL THEN
        RAISE NOTICE 'public.events does not exist, skipping';
        RETURN;
    END IF;

    FOR rec IN
        SELECT id, school_id, title, description, event_date, start_time, end_time, type, location, created_at, updated_at
        FROM public.events
    LOOP
        target_schema := 'school_' || rec.school_id::text;

        IF to_regnamespace(target_schema) IS NULL OR to_regclass(format('%I.events', target_schema)) IS NULL THEN
            skipped_count := skipped_count + 1;
            CONTINUE;
        END IF;

        EXECUTE format(
            'INSERT INTO %I.events (id, school_id, title, description, event_date, start_time, end_time, type, location, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO NOTHING',
            target_schema
        )
        USING
            rec.id,
            rec.school_id,
            rec.title,
            rec.description,
            rec.event_date,
            rec.start_time,
            rec.end_time,
            CASE WHEN rec.type = 'cultural' THEN 'event' ELSE rec.type END,
            rec.location,
            rec.created_at,
            rec.updated_at;

        migrated_count := migrated_count + 1;
    END LOOP;

    SELECT COUNT(*) INTO ref_count
    FROM pg_constraint con
    JOIN pg_class cr ON cr.oid = con.confrelid
    JOIN pg_namespace nr ON nr.oid = cr.relnamespace
    WHERE con.contype = 'f'
      AND nr.nspname = 'public'
      AND cr.relname = 'events';

    IF ref_count > 0 THEN
        RAISE NOTICE 'Skipping public.events drop: % foreign key references still exist (migrated %, skipped %)', ref_count, migrated_count, skipped_count;
        RETURN;
    END IF;

    EXECUTE 'DROP TABLE IF EXISTS public.events';
    RAISE NOTICE 'Dropped public.events (migrated %, skipped %)', migrated_count, skipped_count;
END $$;
