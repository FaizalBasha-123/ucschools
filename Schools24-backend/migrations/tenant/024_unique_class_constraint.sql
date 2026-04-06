-- Add unique constraint for grade + section + academic_year
-- This prevents duplicate classes like "Class 5-A" for the same year
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'unique_class_grade_section_year'
	) THEN
		ALTER TABLE classes
			ADD CONSTRAINT unique_class_grade_section_year
			UNIQUE (school_id, grade, section, academic_year);
	END IF;
END $$;
