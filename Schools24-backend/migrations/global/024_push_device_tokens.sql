CREATE TABLE IF NOT EXISTS push_device_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    school_id UUID NULL,
    role VARCHAR(50) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    token TEXT NOT NULL UNIQUE,
    device_id VARCHAR(255) NULL,
    device_name VARCHAR(255) NULL,
    app_version VARCHAR(50) NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_device_tokens_user_id
    ON push_device_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_push_device_tokens_school_id
    ON push_device_tokens(school_id);

CREATE INDEX IF NOT EXISTS idx_push_device_tokens_platform
    ON push_device_tokens(platform);

CREATE INDEX IF NOT EXISTS idx_push_device_tokens_last_seen_at
    ON push_device_tokens(last_seen_at DESC);
