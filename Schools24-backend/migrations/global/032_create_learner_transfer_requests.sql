-- Transfer workflow between schools for canonical learners.

CREATE TABLE IF NOT EXISTS public.learner_transfer_requests (
    id UUID PRIMARY KEY,
    learner_id UUID NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
    source_school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    destination_school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    source_student_id UUID,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    reason TEXT,
    evidence_ref VARCHAR(255),
    review_note TEXT,
    requested_by UUID NOT NULL,
    reviewed_by UUID,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_learner_transfer_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT chk_learner_transfer_schools CHECK (source_school_id <> destination_school_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_transfer_requests_learner_id
    ON public.learner_transfer_requests (learner_id);

CREATE INDEX IF NOT EXISTS idx_learner_transfer_requests_source_school_id
    ON public.learner_transfer_requests (source_school_id);

CREATE INDEX IF NOT EXISTS idx_learner_transfer_requests_destination_school_id
    ON public.learner_transfer_requests (destination_school_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_transfer_pending_unique
    ON public.learner_transfer_requests (learner_id, source_school_id, destination_school_id)
    WHERE status = 'pending';
