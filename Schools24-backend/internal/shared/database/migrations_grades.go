package database

import (
	"context"
	"log"
)

// RunGradesMigrations creates grades and assessment tables
func (db *PostgresDB) RunGradesMigrations(ctx context.Context) error {
	log.Println("Running grades-related migrations...")

	// Assessments table (exams, tests, quizzes)
	assessmentsTable := `
		CREATE TABLE IF NOT EXISTS assessments (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			assessment_type VARCHAR(50) NOT NULL CHECK (assessment_type IN ('exam', 'test', 'quiz', 'assignment', 'project')),
			subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
			class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
			max_marks DECIMAL(5, 2) NOT NULL,
			scheduled_date DATE,
			academic_year VARCHAR(20) NOT NULL,
			created_by UUID REFERENCES users(id),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_assessments_school_id ON assessments(school_id);
		CREATE INDEX IF NOT EXISTS idx_assessments_class_id ON assessments(class_id);
		CREATE INDEX IF NOT EXISTS idx_assessments_academic_year ON assessments(academic_year);
	`
	if err := db.Exec(ctx, assessmentsTable); err != nil {
		return err
	}
	log.Println("✓ assessments table ready")

	// Student Grades table (individual assessment results)
	studentGradesTable := `
		CREATE TABLE IF NOT EXISTS student_grades (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
			assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
			marks_obtained DECIMAL(5, 2) NOT NULL,
			grade_letter VARCHAR(5),  -- A+, A, B+, B, etc. or 'X' for not graded
			percentage DECIMAL(5, 2),
			remarks TEXT,
			graded_by UUID REFERENCES users(id),
			graded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(student_id, assessment_id)
		);

		CREATE INDEX IF NOT EXISTS idx_student_grades_student_id ON student_grades(student_id);
		CREATE INDEX IF NOT EXISTS idx_student_grades_assessment_id ON student_grades(assessment_id);
	`
	if err := db.Exec(ctx, studentGradesTable); err != nil {
		return err
	}
	log.Println("✓ student_grades table ready")

	// Student Overall Grades (aggregated current grade per subject)
	overallGradesTable := `
		CREATE TABLE IF NOT EXISTS student_overall_grades (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
			subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
			academic_year VARCHAR(20) NOT NULL,
			term VARCHAR(20),  -- 'Term 1', 'Term 2', 'Annual'
			average_percentage DECIMAL(5, 2) DEFAULT 0,
			grade_letter VARCHAR(5) DEFAULT 'X',  -- Default to 'X' (Not Graded)
			class_rank INT,
			total_assessments INT DEFAULT 0,
			completed_assessments INT DEFAULT 0,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(student_id, subject_id, academic_year, term)
		);

		CREATE INDEX IF NOT EXISTS idx_overall_grades_student_id ON student_overall_grades(student_id);
		CREATE INDEX IF NOT EXISTS idx_overall_grades_academic_year ON student_overall_grades(academic_year);
	`
	if err := db.Exec(ctx, overallGradesTable); err != nil {
		return err
	}
	log.Println("✓ student_overall_grades table ready")

	log.Println("✓ All grades migrations completed")
	return nil
}
