-- Ensure code column exists in schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS code VARCHAR(50) UNIQUE DEFAULT 'SCH-UNKNOWN';
-- Drop default after adding
ALTER TABLE schools ALTER COLUMN code DROP DEFAULT;

-- Legacy safety: some older environments may have had a public.staff table.
-- Guard this so fresh installs don't fail global migrations.
DO $$
BEGIN
	IF to_regclass('public.staff') IS NOT NULL THEN
		EXECUTE 'ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS rating DECIMAL(3, 1) DEFAULT 0.0';
	END IF;
END $$;
