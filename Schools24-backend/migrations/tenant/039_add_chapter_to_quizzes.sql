-- Add chapter_name to quizzes so teacher can tag each quiz to a chapter/topic
-- A quiz represents one chapter's practice test within a subject

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS chapter_name VARCHAR(255) NOT NULL DEFAULT '';

-- Index for fast chapter-level lookups per subject
CREATE INDEX IF NOT EXISTS idx_quizzes_subject_chapter
    ON quizzes(subject_id, chapter_name);
