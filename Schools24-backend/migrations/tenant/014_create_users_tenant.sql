-- Create Users Table in Tenant Schema for Isolation/Backup
CREATE TABLE IF NOT EXISTS users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	email VARCHAR(255) UNIQUE NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	role VARCHAR(50) NOT NULL,
	full_name VARCHAR(255) NOT NULL,
	phone VARCHAR(20),
	profile_picture_url TEXT,
	is_active BOOLEAN DEFAULT true,
	email_verified BOOLEAN DEFAULT false,
	last_login_at TIMESTAMP,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	school_id UUID,
	CONSTRAINT users_role_check CHECK (role IN ('admin', 'teacher', 'student', 'staff', 'parent'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Ensure Foreign Keys in other tables point to valid users if possible, 
-- or rely on global FKs. Since this runs late, we just ensure the table capacity exists.
-- Future migrations or app logic will populate this.
