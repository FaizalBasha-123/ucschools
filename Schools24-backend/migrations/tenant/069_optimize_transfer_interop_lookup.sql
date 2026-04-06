-- Optimize transfer->interop lookups for transfer page plug-and-play workflow.
-- Adds expression index to avoid scanning interop_jobs JSON payload for transfer_request_id.

CREATE INDEX IF NOT EXISTS idx_interop_jobs_transfer_request_lookup
    ON interop_jobs ((payload->>'transfer_request_id'), created_at DESC)
    WHERE operation = 'transfer_event_sync';

CREATE INDEX IF NOT EXISTS idx_interop_jobs_operation_created
    ON interop_jobs (operation, created_at DESC);
