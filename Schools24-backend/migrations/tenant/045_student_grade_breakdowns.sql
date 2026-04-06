-- Per-breakdown marks storage for teacher assessment uploads.

CREATE TABLE IF NOT EXISTS student_grade_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_grade_id UUID NOT NULL REFERENCES student_grades(id) ON DELETE CASCADE,
    assessment_mark_breakdown_id UUID NOT NULL REFERENCES assessment_mark_breakdowns(id) ON DELETE CASCADE,
    marks_obtained DECIMAL(6,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_grade_id, assessment_mark_breakdown_id)
);

CREATE INDEX IF NOT EXISTS idx_student_grade_breakdowns_grade
    ON student_grade_breakdowns(student_grade_id);

CREATE INDEX IF NOT EXISTS idx_student_grade_breakdowns_assessment_breakdown
    ON student_grade_breakdowns(assessment_mark_breakdown_id);
