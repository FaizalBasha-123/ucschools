-- Add missing teacher detail columns
ALTER TABLE teachers
    ADD COLUMN IF NOT EXISTS designation VARCHAR(100),
    ADD COLUMN IF NOT EXISTS qualifications TEXT[],
    ADD COLUMN IF NOT EXISTS subjects_taught TEXT[],
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Keep status values consistent
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'teachers_status_check'
    ) THEN
        ALTER TABLE teachers
            ADD CONSTRAINT teachers_status_check
            CHECK (status IN ('active', 'on-leave', 'inactive'));
    END IF;
END $$;
