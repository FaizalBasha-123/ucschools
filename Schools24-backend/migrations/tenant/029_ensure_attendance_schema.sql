-- Ensure attendance table matches application expectations
-- (teacher mark attendance uses class_id and ON CONFLICT(student_id,date))

-- If the table doesn't exist in this schema (unexpected), safely no-op.
DO $$
BEGIN
    IF to_regclass('attendance') IS NULL THEN
        RETURN;
    END IF;
END $$;

-- 1) Ensure missing columns exist
ALTER TABLE IF EXISTS attendance
    ADD COLUMN IF NOT EXISTS class_id UUID;

-- 2) Ensure status validation (matches existing app values)
DO $$
BEGIN
    IF to_regclass('attendance') IS NULL THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_status_check'
          AND conrelid = 'attendance'::regclass
    ) THEN
        ALTER TABLE attendance
            ADD CONSTRAINT attendance_status_check
            CHECK (status IN ('present', 'absent', 'late', 'excused'));
    END IF;
END $$;

-- 3) Ensure uniqueness for upsert path
-- Fail fast if duplicates exist.
DO $$
BEGIN
    IF to_regclass('attendance') IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM attendance
        GROUP BY student_id, date
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot add UNIQUE(student_id, date): duplicates exist in attendance.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_student_date_unique'
          AND conrelid = 'attendance'::regclass
    ) THEN
        ALTER TABLE attendance
            ADD CONSTRAINT attendance_student_date_unique
            UNIQUE (student_id, date);
    END IF;
END $$;

-- 4) Indexes aligned to real query patterns
-- Student timeline: student_id + date
CREATE INDEX IF NOT EXISTS idx_attendance_student_date
ON attendance (student_id, date);

-- Class/day reporting and date-range queries
CREATE INDEX IF NOT EXISTS idx_attendance_class_date
ON attendance (class_id, date);
