CREATE TABLE IF NOT EXISTS queue_jobs (
    id VARCHAR(255) PRIMARY KEY,
    payload JSONB NOT NULL,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(255),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_jobs_available ON queue_jobs(available_at) WHERE locked_at IS NULL;
