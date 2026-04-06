-- Schools Table
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    code VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent: ensure `code` column exists in case the table was created
-- by an earlier partial migration run without this column.
-- This handles existing Neon databases that had a failed/partial migration.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'schools'
          AND column_name  = 'code'
    ) THEN
        ALTER TABLE schools ADD COLUMN code VARCHAR(50) UNIQUE;
    END IF;
END $$;

-- Note: Staff tables (teachers, non_teaching_staff) are now created in tenant schemas
-- See migrations/tenant/005_split_staff_tables.sql

-- Indexes (IF NOT EXISTS makes these safe to re-run)
CREATE INDEX IF NOT EXISTS idx_schools_code ON schools(code);
