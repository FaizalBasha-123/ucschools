package database

import (
	"context"
	"log"
)

// RunStudentMigrations creates student-related tables
func (db *PostgresDB) RunStudentMigrations(ctx context.Context) error {
	log.Println("Running student-related migrations...")

	// Classes table
	classesTable := `
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
	`
	if err := db.Exec(ctx, classesTable); err != nil {
		return err
	}
	// Add school_id if missing (for existing tables)
	db.Exec(ctx, "ALTER TABLE classes ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")

	// Create index AFTER column exists
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_classes_school_id ON classes(school_id);")

	log.Println("✓ classes table ready")

	// Teachers table
	teachersTable := `
		CREATE TABLE IF NOT EXISTS teachers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
			user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			employee_id VARCHAR(50) NOT NULL,
			department VARCHAR(100),
			designation VARCHAR(100),
			qualification VARCHAR(255),
			qualifications TEXT[],
			experience_years INT DEFAULT 0,
			subjects TEXT[],
			subjects_taught TEXT[],
			hire_date DATE NOT NULL,
			salary DECIMAL(10, 2),
			rating DECIMAL(3, 1) DEFAULT 0.0 CHECK (rating >= 0.0 AND rating <= 5.0),
			status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'on-leave', 'inactive')),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_teachers_employee_id ON teachers(employee_id);
	`
	if err := db.Exec(ctx, teachersTable); err != nil {
		return err
	}
	// Add missing columns if table already exists
	db.Exec(ctx, "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")
	db.Exec(ctx, "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS designation VARCHAR(100);")
	db.Exec(ctx, "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS qualifications TEXT[];")
	db.Exec(ctx, "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS subjects_taught TEXT[];")
	db.Exec(ctx, "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';")
	db.Exec(ctx, "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS rating DECIMAL(3, 1) DEFAULT 0.0;")
	db.Exec(ctx, "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_rating_check') THEN ALTER TABLE teachers ADD CONSTRAINT teachers_rating_check CHECK (rating >= 0.0 AND rating <= 5.0); END IF; END $$;")
	db.Exec(ctx, "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_status_check') THEN ALTER TABLE teachers ADD CONSTRAINT teachers_status_check CHECK (status IN ('active', 'on-leave', 'inactive')); END IF; END $$;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON teachers(school_id);")
	log.Println("✓ teachers table ready")

	// Non-Teaching Staff table
	staffTable := `
		CREATE TABLE IF NOT EXISTS non_teaching_staff (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
			user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			employee_id VARCHAR(50) NOT NULL,
			department VARCHAR(100),
			designation VARCHAR(100),
			qualification VARCHAR(255),
			experience_years INT DEFAULT 0,
			hire_date DATE NOT NULL,
			salary DECIMAL(10, 2),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_non_teaching_staff_employee_id ON non_teaching_staff(employee_id);
		CREATE INDEX IF NOT EXISTS idx_non_teaching_staff_school_id ON non_teaching_staff(school_id);
	`
	if err := db.Exec(ctx, staffTable); err != nil {
		return err
	}
	log.Println("✓ non_teaching_staff table ready")

	// Add class_teacher_id to classes
	alterClasses := `
		DO $$ 
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
				WHERE table_name = 'classes' AND column_name = 'class_teacher_id') THEN
				ALTER TABLE classes ADD COLUMN class_teacher_id UUID REFERENCES teachers(id);
			END IF;
		END $$;
	`
	if err := db.Exec(ctx, alterClasses); err != nil {
		log.Printf("Note: class_teacher_id column may already exist")
	}

	// Students table
	studentsTable := `
		CREATE TABLE IF NOT EXISTS students (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
			user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			admission_number VARCHAR(50) NOT NULL,
			roll_number VARCHAR(50),
			class_id UUID REFERENCES classes(id),
			section VARCHAR(10),
			date_of_birth DATE NOT NULL,
			gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other')),
			blood_group VARCHAR(5),
			address TEXT,
			parent_name VARCHAR(255),
			parent_email VARCHAR(255),
			parent_phone VARCHAR(20),
			emergency_contact VARCHAR(20),
			admission_date DATE NOT NULL,
			academic_year VARCHAR(20),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(school_id, admission_number)
		);

		CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
		CREATE INDEX IF NOT EXISTS idx_students_admission_number ON students(admission_number);
		CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
	`
	if err := db.Exec(ctx, studentsTable); err != nil {
		return err
	}
	db.Exec(ctx, "ALTER TABLE students ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);")
	log.Println("✓ students table ready")

	// Subjects table
	subjectsTable := `
		CREATE TABLE IF NOT EXISTS subjects (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
			name VARCHAR(100) NOT NULL,
			code VARCHAR(20) NOT NULL,
			description TEXT,
			grade_levels INT[],
			credits INT DEFAULT 1,
			is_optional BOOLEAN DEFAULT false,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(school_id, code)
		);

		CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects(code);
	`
	if err := db.Exec(ctx, subjectsTable); err != nil {
		return err
	}
	db.Exec(ctx, "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON subjects(school_id);")
	log.Println("✓ subjects table ready")

	// Attendance table
	attendanceTable := `
		CREATE TABLE IF NOT EXISTS attendance (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
			student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
			class_id UUID NOT NULL REFERENCES classes(id),
			date DATE NOT NULL,
			status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
			marked_by UUID REFERENCES users(id),
			remarks TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(student_id, date)
		);

		CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id);
		CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
		CREATE INDEX IF NOT EXISTS idx_attendance_class_id ON attendance(class_id);
	`
	if err := db.Exec(ctx, attendanceTable); err != nil {
		return err
	}
	db.Exec(ctx, "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_attendance_school_id ON attendance(school_id);")
	log.Println("✓ attendance table ready")

	log.Println("All student-related migrations completed!")
	return nil
}
