-- Create Classes Table
CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    grade INT NOT NULL CHECK (grade >= 1 AND grade <= 12),
    section VARCHAR(10),
    academic_year VARCHAR(20) NOT NULL,
    total_students INT DEFAULT 0,
    room_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_classes_grade ON classes(grade);
CREATE INDEX IF NOT EXISTS idx_classes_academic_year ON classes(academic_year);
CREATE INDEX IF NOT EXISTS idx_classes_school_id ON classes(school_id);
-- Note: class_teacher_id added later or nullable here to avoid circular dep if teacher table exists.
-- Teachers table is 005, so we can add it here if we want, or ALTER later.
-- Existing Go code did ALTER. Let's do ALTER in a later migration or separate entry.
-- Or just add it now since 005 is before 007.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_teacher_id UUID REFERENCES teachers(id);
