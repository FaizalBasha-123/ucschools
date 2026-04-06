-- Per-assessment subject marks breakdown for report/assessment management
CREATE TABLE IF NOT EXISTS assessment_subject_marks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    max_marks NUMERIC(8,2) NOT NULL CHECK (max_marks > 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (assessment_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_subject_marks_assessment
    ON assessment_subject_marks(assessment_id);

CREATE INDEX IF NOT EXISTS idx_assessment_subject_marks_subject
    ON assessment_subject_marks(subject_id);

