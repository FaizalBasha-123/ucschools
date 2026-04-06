-- Teacher quiz scheduler schema (tenant isolated)

CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    total_marks INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    question_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT quizzes_status_check CHECK (status IN ('upcoming', 'active', 'completed')),
    CONSTRAINT quizzes_duration_positive CHECK (duration_minutes > 0),
    CONSTRAINT quizzes_total_marks_nonnegative CHECK (total_marks >= 0),
    CONSTRAINT quizzes_question_count_nonnegative CHECK (question_count >= 0)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    marks INTEGER NOT NULL DEFAULT 1,
    order_index INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT quiz_questions_marks_positive CHECK (marks > 0),
    CONSTRAINT quiz_questions_order_positive CHECK (order_index > 0)
);

CREATE TABLE IF NOT EXISTS quiz_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT false,
    order_index INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT quiz_options_order_positive CHECK (order_index > 0)
);

CREATE INDEX IF NOT EXISTS idx_quizzes_teacher_class_subject_status
    ON quizzes(teacher_id, class_id, subject_id, status);

CREATE INDEX IF NOT EXISTS idx_quizzes_teacher_scheduled_at
    ON quizzes(teacher_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_id_order
    ON quiz_questions(quiz_id, order_index);

CREATE INDEX IF NOT EXISTS idx_quiz_options_question_id_order
    ON quiz_options(question_id, order_index);

