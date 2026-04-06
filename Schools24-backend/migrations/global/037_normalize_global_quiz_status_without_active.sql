-- Normalize historical global quiz status values and remove 'active' from allowed status values.
UPDATE public.global_quizzes
SET status = 'upcoming'
WHERE status = 'active';

ALTER TABLE public.global_quizzes
DROP CONSTRAINT IF EXISTS global_quizzes_status_check;

ALTER TABLE public.global_quizzes
ADD CONSTRAINT global_quizzes_status_check
CHECK (status IN ('upcoming', 'completed'));
