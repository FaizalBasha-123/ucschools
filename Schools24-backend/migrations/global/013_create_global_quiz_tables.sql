-- Global super-admin quiz scheduler schema (shared across all schools)

CREATE TABLE IF NOT EXISTS global_quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    super_admin_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES global_classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES global_subjects(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    chapter_name VARCHAR(255) NOT NULL DEFAULT '',
    scheduled_at TIMESTAMP NULL,
    is_anytime BOOLEAN NOT NULL DEFAULT FALSE,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    total_marks INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    question_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT global_quizzes_status_check CHECK (status IN ('upcoming', 'active', 'completed')),
    CONSTRAINT global_quizzes_duration_positive CHECK (duration_minutes > 0),
    CONSTRAINT global_quizzes_total_marks_nonnegative CHECK (total_marks >= 0),
    CONSTRAINT global_quizzes_question_count_nonnegative CHECK (question_count >= 0)
);

CREATE TABLE IF NOT EXISTS global_quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES global_quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    marks INTEGER NOT NULL DEFAULT 1,
    order_index INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT global_quiz_questions_marks_positive CHECK (marks > 0),
    CONSTRAINT global_quiz_questions_order_positive CHECK (order_index > 0)
);

CREATE TABLE IF NOT EXISTS global_quiz_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES global_quiz_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT false,
    order_index INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT global_quiz_options_order_positive CHECK (order_index > 0)
);

CREATE INDEX IF NOT EXISTS idx_global_quizzes_class_subject
    ON global_quizzes(class_id, subject_id);

CREATE INDEX IF NOT EXISTS idx_global_quizzes_anytime_scheduled
    ON global_quizzes(is_anytime, COALESCE(scheduled_at, created_at));

CREATE INDEX IF NOT EXISTS idx_global_quizzes_creator
    ON global_quizzes(super_admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_global_quiz_questions_quiz_order
    ON global_quiz_questions(quiz_id, order_index);

CREATE INDEX IF NOT EXISTS idx_global_quiz_options_question_order
    ON global_quiz_options(question_id, order_index);
