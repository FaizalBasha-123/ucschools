-- Add AnyTime support to quiz scheduling

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS is_anytime BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE quizzes
    ALTER COLUMN scheduled_at DROP NOT NULL;

UPDATE quizzes
SET is_anytime = FALSE
WHERE is_anytime IS DISTINCT FROM FALSE;

CREATE INDEX IF NOT EXISTS idx_quizzes_class_subject_anytime
    ON quizzes(class_id, subject_id, is_anytime);

CREATE INDEX IF NOT EXISTS idx_quizzes_scheduled_at_nullable
    ON quizzes((COALESCE(scheduled_at, created_at)) DESC);
