-- Migration 054: Repair admission_applications column widths
--
-- Migration 053 was silently no-op'd for some schools because the DO block
-- had EXCEPTION WHEN OTHERS THEN NULL which swallowed the ALTER TABLE failure,
-- yet still recorded 053 as applied in schema_migrations.
--
-- This migration uses plain ALTER TABLE (no DO block, no EXCEPTION handler,
-- no IF EXISTS) so any failure is visible and the migration is not marked
-- as applied unless it actually succeeds.
--
-- The SET LOCAL search_path from RunTenantMigrations ensures these unqualified
-- table names resolve to the correct tenant schema.

ALTER TABLE admission_applications ALTER COLUMN academic_year  TYPE TEXT;
ALTER TABLE admission_applications ALTER COLUMN blood_group    TYPE VARCHAR(20);
ALTER TABLE admission_applications ALTER COLUMN aadhaar_number TYPE VARCHAR(50);
ALTER TABLE admission_applications ALTER COLUMN pincode        TYPE VARCHAR(20);
