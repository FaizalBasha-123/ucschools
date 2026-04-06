-- Separate Super Admins from School-Scoped Users
-- Security Enhancement: Isolate super admin credentials from tenant data

-- Create dedicated super_admins table (no school_id constraint)
CREATE TABLE IF NOT EXISTS super_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    profile_picture_url TEXT,
    email_verified BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for super_admins
CREATE INDEX IF NOT EXISTS idx_super_admins_email ON super_admins(LOWER(email));

-- Migrate existing super_admin from users table to super_admins table
INSERT INTO super_admins (id, email, password_hash, full_name, phone, profile_picture_url, email_verified, last_login_at, created_at, updated_at)
SELECT id, email, password_hash, full_name, phone, profile_picture_url, email_verified, last_login_at, created_at, updated_at
FROM users
WHERE role = 'super_admin'
ON CONFLICT (email) DO NOTHING;

-- Remove super_admin from users table (they now live in super_admins)
DELETE FROM users WHERE role = 'super_admin';

-- Update users table CHECK constraint to remove super_admin role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
    CHECK (role IN ('admin', 'teacher', 'student', 'staff', 'parent'));

-- Add comment for clarity
COMMENT ON TABLE super_admins IS 'Global administrators with cross-school access - isolated from tenant users';
COMMENT ON TABLE users IS 'School-scoped users (admin, teacher, student, staff, parent) - requires school_id';
