-- Canonical learner identity registry in global schema for cross-school portability.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.learners (
    id UUID PRIMARY KEY,
    full_name VARCHAR(255),
    date_of_birth DATE,
    apaar_id VARCHAR(64),
    abc_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_apaar_id_unique
    ON public.learners (UPPER(apaar_id))
    WHERE apaar_id IS NOT NULL AND TRIM(apaar_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_abc_id_unique
    ON public.learners (UPPER(abc_id))
    WHERE abc_id IS NOT NULL AND TRIM(abc_id) <> '';

CREATE TABLE IF NOT EXISTS public.learner_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id UUID NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exited_at TIMESTAMPTZ,
    source VARCHAR(64) NOT NULL DEFAULT 'schools24',
    evidence_ref VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_learner_enrollment_status CHECK (status IN ('active', 'transferred_out', 'completed', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_enrollments_active_unique
    ON public.learner_enrollments (learner_id, school_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_learner_enrollments_school_id
    ON public.learner_enrollments (school_id);
