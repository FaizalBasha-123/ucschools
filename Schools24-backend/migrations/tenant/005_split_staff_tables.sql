-- Drop the incorrect 'staff' table
DROP TABLE IF EXISTS staff;

-- Create Teachers Table
CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) NOT NULL,
    department VARCHAR(100),
    qualification TEXT,
    experience_years INT DEFAULT 0,
    salary DECIMAL(10, 2) DEFAULT 0.00,
    hire_date TIMESTAMP,
    subjects TEXT[], -- Array of strings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Non-Teaching Staff Table
CREATE TABLE IF NOT EXISTS non_teaching_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) NOT NULL,
    department VARCHAR(100),
    designation VARCHAR(100),
    qualification TEXT,
    experience_years INT DEFAULT 0,
    salary DECIMAL(10, 2) DEFAULT 0.00,
    hire_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON teachers(school_id);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_non_teaching_staff_school_id ON non_teaching_staff(school_id);
CREATE INDEX IF NOT EXISTS idx_non_teaching_staff_user_id ON non_teaching_staff(user_id);
