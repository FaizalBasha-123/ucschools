-- Student quiz attempts schema (tenant isolated)

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id          UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    started_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at     TIMESTAMP,
    score            INTEGER NOT NULL DEFAULT 0,
    total_marks      INTEGER NOT NULL DEFAULT 0,
    percentage       NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_completed     BOOLEAN NOT NULL DEFAULT false,
    is_expired       BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT quiz_attempts_score_nonneg CHECK (score >= 0),
    CONSTRAINT quiz_attempts_total_nonneg CHECK (total_marks >= 0),
    CONSTRAINT quiz_attempts_pct_range   CHECK (percentage >= 0 AND percentage <= 100)
);

CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id         UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id        UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    selected_option_id UUID REFERENCES quiz_options(id) ON DELETE SET NULL,
    is_correct         BOOLEAN NOT NULL DEFAULT false,
    marks_obtained     INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_student
    ON quiz_attempts(quiz_id, student_id);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student_completed
    ON quiz_attempts(student_id, is_completed);

CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_attempt
    ON quiz_attempt_answers(attempt_id);
