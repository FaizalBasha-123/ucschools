-- Transport manual tracking sessions
-- Persists admin-initiated manual GPS tracking sessions to PostgreSQL so they
-- survive Valkey/Redis restarts and work even when the cache is unavailable.

CREATE TABLE IF NOT EXISTS transport_manual_sessions (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id      UUID         NOT NULL,
    started_by_id  TEXT         NOT NULL,
    started_by_name TEXT        NOT NULL,
    started_at     BIGINT       NOT NULL,   -- Unix milliseconds
    expires_at     BIGINT       NOT NULL,   -- Unix milliseconds
    stopped_at     BIGINT,                  -- NULL while active
    stopped_by_id  TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup of the active session for a school
CREATE INDEX IF NOT EXISTS idx_transport_manual_sessions_school_active
    ON transport_manual_sessions (school_id, expires_at)
    WHERE stopped_at IS NULL;
