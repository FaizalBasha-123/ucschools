-- Migration 055: Add email to admission_applications + login_count to users
-- email: used to create the actual login account when admission is approved
-- login_count: tracks how many times a user has logged in (for first-login password prompt)

ALTER TABLE admission_applications
    ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS login_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN admission_applications.email IS 'Email address provided by parent at admission time; used as login email when student account is created on approval';
COMMENT ON COLUMN users.login_count IS 'Total successful login count. Used to prompt first-time password change for auto-created student accounts (shown for first 4 logins).';
