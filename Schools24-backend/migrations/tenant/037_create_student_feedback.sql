CREATE TABLE IF NOT EXISTS student_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    feedback_type VARCHAR(30) NOT NULL CHECK (feedback_type IN ('teacher')),
    teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    subject_name VARCHAR(150),
    rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    message TEXT NOT NULL,
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'responded')),
    response_text TEXT,
    responded_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_feedback_student_created
    ON student_feedback (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_feedback_teacher_type
    ON student_feedback (teacher_id, feedback_type, created_at DESC);
