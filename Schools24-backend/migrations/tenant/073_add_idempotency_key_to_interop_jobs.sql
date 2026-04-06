-- NDEAR Phase PR-05: Add idempotency key support to interop_jobs.
-- Allows clients to safely retry CreateJob without duplicate execution.

ALTER TABLE interop_jobs
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- Partial unique index: only enforce uniqueness on non-null keys.
-- This allows existing jobs (without keys) to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_interop_jobs_idempotency_key
    ON interop_jobs (school_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
