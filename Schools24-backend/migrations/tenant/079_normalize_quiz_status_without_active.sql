-- Normalize historical quiz status values and remove 'active' from allowed status values.
UPDATE quizzes
SET status = 'upcoming'
WHERE status = 'active';

ALTER TABLE quizzes
DROP CONSTRAINT IF EXISTS quizzes_status_check;

ALTER TABLE quizzes
ADD CONSTRAINT quizzes_status_check
CHECK (status IN ('upcoming', 'completed'));
