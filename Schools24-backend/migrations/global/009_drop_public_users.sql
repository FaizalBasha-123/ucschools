-- Tenant-only users cutover (phase 2)
-- Drops public.users after phase 1 migration retargets all references.

DO $$
DECLARE
    ref_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO ref_count
    FROM pg_constraint con
    JOIN pg_class cr ON cr.oid = con.confrelid
    JOIN pg_namespace nr ON nr.oid = cr.relnamespace
    WHERE con.contype = 'f'
      AND nr.nspname = 'public'
      AND cr.relname = 'users';

    IF ref_count > 0 THEN
                RAISE NOTICE 'Skipping public.users drop: % foreign key references still exist', ref_count;
                RETURN;
    END IF;

        EXECUTE 'DROP TABLE IF EXISTS public.users';
END $$;
