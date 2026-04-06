CREATE TABLE IF NOT EXISTS auth_mfa_factors (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    school_id UUID NULL,
    role VARCHAR(32) NOT NULL,
    method VARCHAR(32) NOT NULL DEFAULT 'totp',
    secret_ciphertext TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_mfa_factors_subject
ON auth_mfa_factors (user_id, role, COALESCE(school_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_auth_mfa_factors_school_id ON auth_mfa_factors(school_id);
CREATE INDEX IF NOT EXISTS idx_auth_mfa_factors_enabled ON auth_mfa_factors(enabled);
