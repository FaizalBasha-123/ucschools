-- Ensure all expected columns exist in the schools table.
-- After a pg_dump/restore cycle, some columns may be missing if the dumped
-- table schema differed from what migrations create. This migration is
-- idempotent and safe to run on any state.

-- email: used by repository queries (GetAll, GetByID, Create, GetDeletedSchools)
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- phone: defined in original 002_admin_init.sql
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- website: defined in original 002_admin_init.sql
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS website VARCHAR(255);

-- slug: defined in 007_slug_and_email_ci.sql
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS slug TEXT;

-- code: defined in 002_admin_init.sql / 004_fix_schools_schema.sql
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS code VARCHAR(50);

-- soft delete columns: defined in 006_add_soft_delete_to_schools.sql
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS deleted_by UUID DEFAULT NULL;
