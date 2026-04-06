-- Ensure leaderboard tables exist in each tenant schema
-- This is a safety migration in case prior migrations were marked applied without tables.

CREATE TABLE IF NOT EXISTS student_leaderboard_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    academic_year VARCHAR(20) NOT NULL,
    average_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    attendance_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    exams_taken INT NOT NULL DEFAULT 0,
    trend VARCHAR(10) NOT NULL DEFAULT 'stable' CHECK (trend IN ('up', 'down', 'stable')),
    composite_score DECIMAL(6,2) NOT NULL DEFAULT 0,
    rank INT NOT NULL DEFAULT 0,
    last_calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, student_id, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_student_leaderboard_school_year_rank
    ON student_leaderboard_entries (school_id, academic_year, rank);
CREATE INDEX IF NOT EXISTS idx_student_leaderboard_class_year_rank
    ON student_leaderboard_entries (class_id, academic_year, rank);
CREATE INDEX IF NOT EXISTS idx_student_leaderboard_student_year
    ON student_leaderboard_entries (student_id, academic_year);

CREATE TABLE IF NOT EXISTS teacher_leaderboard_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    academic_year VARCHAR(20) NOT NULL,
    rating DECIMAL(3,1) NOT NULL DEFAULT 0,
    students_count INT NOT NULL DEFAULT 0,
    assignments_count INT NOT NULL DEFAULT 0,
    graded_records_count INT NOT NULL DEFAULT 0,
    average_student_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    trend VARCHAR(10) NOT NULL DEFAULT 'stable' CHECK (trend IN ('up', 'down', 'stable')),
    composite_score DECIMAL(6,2) NOT NULL DEFAULT 0,
    rank INT NOT NULL DEFAULT 0,
    last_calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, teacher_id, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_teacher_leaderboard_school_year_rank
    ON teacher_leaderboard_entries (school_id, academic_year, rank);
CREATE INDEX IF NOT EXISTS idx_teacher_leaderboard_teacher_year
    ON teacher_leaderboard_entries (teacher_id, academic_year);
