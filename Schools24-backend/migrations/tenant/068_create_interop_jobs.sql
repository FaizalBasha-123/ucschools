-- Option A foundation: tenant-scoped interop orchestration and dead-letter queue.
-- Designed for low compute overhead: narrow indexes for list/status queries only.

CREATE TABLE IF NOT EXISTS interop_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

    system VARCHAR(30) NOT NULL CHECK (system IN ('diksha', 'digilocker', 'abc')),
    operation VARCHAR(64) NOT NULL CHECK (
        operation IN (
            'learner_profile_sync',
            'learning_progress_sync',
            'transfer_event_sync',
            'document_metadata_sync',
            'apaar_verify'
        )
    ),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),

    dry_run BOOLEAN NOT NULL DEFAULT TRUE,
    payload JSONB NOT NULL,

    requested_by VARCHAR(64),
    requested_role VARCHAR(32) NOT NULL,

    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 10),

    last_error TEXT,
    response_code INT,
    response_body TEXT,

    started_at TIMESTAMP,
    completed_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interop_jobs_created
    ON interop_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interop_jobs_status_created
    ON interop_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interop_jobs_system_status_created
    ON interop_jobs (system, status, created_at DESC);

CREATE TABLE IF NOT EXISTS interop_dead_letter_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES interop_jobs(id) ON DELETE CASCADE,

    system VARCHAR(30) NOT NULL,
    operation VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,

    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    error_message TEXT,
    response_code INT,
    response_body TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'abandoned')),
    resolution_notes TEXT,
    resolved_by VARCHAR(64),
    resolved_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_interop_dlq_status_created
    ON interop_dead_letter_queue (status, created_at DESC);
