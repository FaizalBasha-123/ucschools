CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    school_id UUID NULL,
    role VARCHAR(32) NOT NULL,
    token_family_id UUID NOT NULL,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    device_id TEXT NULL,
    device_name TEXT NULL,
    user_agent TEXT NULL,
    client_ip TEXT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ NULL,
    replaced_by_session_id UUID NULL REFERENCES auth_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_school_id ON auth_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_family_id ON auth_sessions(token_family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions(revoked_at);
