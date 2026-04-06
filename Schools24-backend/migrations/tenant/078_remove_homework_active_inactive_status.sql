-- Remove homework active/inactive status from tenant schema.

DROP INDEX IF EXISTS idx_homework_teacher_status_due_date;
DROP INDEX IF EXISTS idx_homework_class_subject_status_due_date;

ALTER TABLE IF EXISTS homework
    DROP COLUMN IF EXISTS status;

CREATE INDEX IF NOT EXISTS idx_homework_teacher_due_date
    ON homework(teacher_id, due_date DESC);

CREATE INDEX IF NOT EXISTS idx_homework_class_subject_due_date
    ON homework(class_id, subject_id, due_date DESC);
