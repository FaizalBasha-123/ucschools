-- Teacher-managed chapter catalog for quiz scheduler (tenant isolated)
CREATE TABLE IF NOT EXISTS quiz_subject_chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    chapter_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(teacher_id, class_id, subject_id, chapter_name)
);

CREATE INDEX IF NOT EXISTS idx_quiz_chapters_teacher_class_subject
    ON quiz_subject_chapters(teacher_id, class_id, subject_id);

CREATE INDEX IF NOT EXISTS idx_quiz_chapters_subject_name
    ON quiz_subject_chapters(subject_id, chapter_name);
