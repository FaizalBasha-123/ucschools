-- Tenant homework metadata and performance indexes
-- Keeps homework isolated per school schema while supporting object-storage attachments.

ALTER TABLE IF EXISTS homework
    ADD COLUMN IF NOT EXISTS attachment_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS homework
    ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS homework
    ALTER COLUMN attachments SET DEFAULT ARRAY[]::TEXT[];

UPDATE homework
SET attachments = ARRAY[]::TEXT[]
WHERE attachments IS NULL;

CREATE INDEX IF NOT EXISTS idx_homework_teacher_status_due_date
    ON homework(teacher_id, status, due_date DESC);

CREATE INDEX IF NOT EXISTS idx_homework_class_subject_status_due_date
    ON homework(class_id, subject_id, status, due_date DESC);

