-- Extend assessments for class-group targeting and subject mark breakdowns

ALTER TABLE IF EXISTS assessments
    ADD COLUMN IF NOT EXISTS class_grades INT[] DEFAULT '{}';

ALTER TABLE IF EXISTS assessment_subject_marks
    ADD COLUMN IF NOT EXISTS subject_label VARCHAR(120);

ALTER TABLE IF EXISTS assessment_subject_marks
    ALTER COLUMN subject_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS assessment_mark_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_subject_mark_id UUID NOT NULL REFERENCES assessment_subject_marks(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    marks NUMERIC(8,2) NOT NULL CHECK (marks > 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assessment_mark_breakdowns_subject_mark
    ON assessment_mark_breakdowns(assessment_subject_mark_id);

