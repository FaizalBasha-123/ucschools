-- Add created_by column to track who created each user account
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- Add index for created_by lookups
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);

-- Add comment for documentation
COMMENT ON COLUMN users.created_by IS 'The user (admin/staff) who created this account. NULL for self-registered or system-created users.';
