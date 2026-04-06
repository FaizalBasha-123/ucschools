-- Schools24 Database Schema: Students Table
-- Fixes missing students table and ensures proper relations

-- Drop existing if any (cleanup from potential bad state, though unlikely in prod without this migration)
DROP TABLE IF EXISTS students CASCADE;

CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    admission_number VARCHAR(50) NOT NULL,
    roll_number VARCHAR(50),
    class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    section VARCHAR(10),
    
    -- Personal Details
    date_of_birth DATE NOT NULL,
    gender VARCHAR(20) NOT NULL CHECK (gender IN ('male', 'female', 'other')),
    blood_group VARCHAR(5),
    address TEXT,
    
    -- Parent Details
    parent_name VARCHAR(255),
    parent_email VARCHAR(255),
    parent_phone VARCHAR(20),
    emergency_contact VARCHAR(20),
    
    -- Academic Details
    admission_date DATE DEFAULT CURRENT_DATE,
    academic_year VARCHAR(20) NOT NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(school_id, admission_number)
);

-- Indexes
CREATE INDEX idx_students_school_id ON students(school_id);
CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_students_class_id ON students(class_id);
CREATE INDEX idx_students_admission_number ON students(admission_number);
