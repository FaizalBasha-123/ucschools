-- NDEAR Phase PR-02: Data Subject Request (DSR) tracking.
-- Tenant-scoped table for DPDPA access/rectification/erasure/portability requests.

CREATE TABLE IF NOT EXISTS data_subject_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

    -- Requester (guardian/parent/student)
    requester_name VARCHAR(200) NOT NULL,
    requester_email VARCHAR(255),
    requester_phone VARCHAR(30),
    requester_relation VARCHAR(100),  -- 'parent', 'guardian', 'self', 'legal_representative'

    -- Subject (the student whose data is concerned)
    subject_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    subject_name VARCHAR(200),

    -- Request details
    request_type VARCHAR(40) NOT NULL CHECK (
        request_type IN ('access', 'rectification', 'erasure', 'portability', 'objection')
    ),
    status VARCHAR(30) NOT NULL DEFAULT 'submitted' CHECK (
        status IN ('submitted', 'under_review', 'approved', 'rejected', 'completed', 'cancelled')
    ),
    description TEXT,
    resolution_notes TEXT,

    -- Assignment and review
    assigned_to VARCHAR(64),
    reviewed_by VARCHAR(64),
    review_note TEXT,

    -- Timestamps
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Primary query path: list DSRs for a school filtered by status
CREATE INDEX IF NOT EXISTS idx_dsr_school_status_submitted
    ON data_subject_requests (school_id, status, submitted_at DESC);

-- Lookup by student
CREATE INDEX IF NOT EXISTS idx_dsr_subject_student
    ON data_subject_requests (subject_student_id)
    WHERE subject_student_id IS NOT NULL;

-- Lookup by request type
CREATE INDEX IF NOT EXISTS idx_dsr_school_type
    ON data_subject_requests (school_id, request_type);
