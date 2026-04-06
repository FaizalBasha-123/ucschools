-- Assessment exam timetable + class-scoped exam events + stable grade upsert

CREATE TABLE IF NOT EXISTS assessment_exam_timetable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    class_grade INT NOT NULL,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    exam_date DATE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (assessment_id, class_grade, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_exam_timetable_assessment
    ON assessment_exam_timetable(assessment_id);

CREATE INDEX IF NOT EXISTS idx_assessment_exam_timetable_class_grade
    ON assessment_exam_timetable(class_grade);

ALTER TABLE IF EXISTS events
    ADD COLUMN IF NOT EXISTS target_grade INT;

ALTER TABLE IF EXISTS events
    ADD COLUMN IF NOT EXISTS source_assessment_id UUID;

ALTER TABLE IF EXISTS events
    ADD COLUMN IF NOT EXISTS source_subject_id UUID;

CREATE INDEX IF NOT EXISTS idx_events_target_grade
    ON events(target_grade);

CREATE INDEX IF NOT EXISTS idx_events_source_assessment
    ON events(source_assessment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_grades_assessment_student
    ON student_grades(assessment_id, student_id)
    WHERE assessment_id IS NOT NULL;
