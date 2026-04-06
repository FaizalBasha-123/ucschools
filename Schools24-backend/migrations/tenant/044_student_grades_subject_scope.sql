-- Add subject scoping for teacher assessment marks uploads.

ALTER TABLE IF EXISTS student_grades
    ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id);

-- Old uniqueness (assessment_id, student_id) prevents per-subject marks rows.
DROP INDEX IF EXISTS uq_student_grades_assessment_student;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_grades_assessment_student_subject
    ON student_grades(assessment_id, student_id, subject_id)
    WHERE assessment_id IS NOT NULL
      AND subject_id IS NOT NULL;
