-- NDEAR Phase PR-02: Immutable consent audit event log.
-- Records every consent grant, withdrawal, DSR state change for compliance audit.
-- This table is append-only by design: no UPDATEs or DELETEs expected.

CREATE TABLE IF NOT EXISTS consent_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

    -- Optional FK references (one or both may be set)
    consent_id UUID,       -- references parental_consents(id) when applicable
    dsr_id UUID,           -- references data_subject_requests(id) when applicable

    -- Event classification
    event_type VARCHAR(64) NOT NULL CHECK (
        event_type IN (
            'consent_granted',
            'consent_withdrawn',
            'dsr_submitted',
            'dsr_under_review',
            'dsr_approved',
            'dsr_rejected',
            'dsr_completed',
            'dsr_cancelled'
        )
    ),

    -- Who performed the action
    actor_id VARCHAR(64),
    actor_role VARCHAR(32),

    -- Flexible metadata (e.g. old/new status, IP, user agent)
    metadata JSONB NOT NULL DEFAULT '{}',

    -- Immutable timestamp
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Primary query path: list events for a school by type
CREATE INDEX IF NOT EXISTS idx_consent_audit_school_type_time
    ON consent_audit_events (school_id, event_type, created_at DESC);

-- Lookup by consent record
CREATE INDEX IF NOT EXISTS idx_consent_audit_consent_id
    ON consent_audit_events (consent_id)
    WHERE consent_id IS NOT NULL;

-- Lookup by DSR record
CREATE INDEX IF NOT EXISTS idx_consent_audit_dsr_id
    ON consent_audit_events (dsr_id)
    WHERE dsr_id IS NOT NULL;
