-- Migration 053: Widen restrictive VARCHAR columns in admission_applications
-- Previous VARCHAR(20) for academic_year and VARCHAR(10) for blood_group/pincode
-- were too narrow and caused SQLSTATE 22001 overflows in production.
--
-- Uses a DO block with IF EXISTS so this migration is safe even on schemas
-- where the table does not yet exist (fresh installs). A single combined
-- ALTER TABLE statement is atomic — all columns widen together or none do.
-- No EXCEPTION handler: real errors surface clearly in migration logs.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name   = 'admission_applications'
    ) THEN
        -- academic_year: VARCHAR(20) → TEXT  (values like "Academic Year 2025-2026" = 24 chars)
        -- blood_group:   VARCHAR(10) → VARCHAR(20) ("AB Negative" = 11 chars)
        -- aadhaar_number:VARCHAR(20) → VARCHAR(50) (formatted "1234 5678 9012" etc.)
        -- pincode:       VARCHAR(10) → VARCHAR(20) (international postal codes)
        ALTER TABLE admission_applications
            ALTER COLUMN academic_year  TYPE TEXT,
            ALTER COLUMN blood_group    TYPE VARCHAR(20),
            ALTER COLUMN aadhaar_number TYPE VARCHAR(50),
            ALTER COLUMN pincode        TYPE VARCHAR(20);
    END IF;
END $$;
