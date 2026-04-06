-- Add suspension support to tenant users
-- Suspended users cannot login but their data (materials, docs, quizzes, etc.) is preserved.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS suspended_by UUID DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_suspended ON users(is_suspended) WHERE is_suspended = TRUE;

COMMENT ON COLUMN users.is_suspended IS 'When TRUE the user cannot login. Data is fully preserved.';
COMMENT ON COLUMN users.suspended_by IS 'UUID of the admin or super_admin who suspended this user.';
