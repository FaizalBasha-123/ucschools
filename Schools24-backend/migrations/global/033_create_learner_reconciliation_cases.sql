-- Reconciliation queue and merge/unmerge audit for canonical learners.

ALTER TABLE public.learners
    ADD COLUMN IF NOT EXISTS merge_status VARCHAR(16) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS merged_into_learner_id UUID REFERENCES public.learners(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_learners_merge_status'
          AND conrelid = 'public.learners'::regclass
    ) THEN
        ALTER TABLE public.learners
            ADD CONSTRAINT chk_learners_merge_status
            CHECK (merge_status IN ('active', 'merged'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_learners_merged_into_learner_id
    ON public.learners (merged_into_learner_id)
    WHERE merged_into_learner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.learner_reconciliation_cases (
    id UUID PRIMARY KEY,
    pair_key VARCHAR(80) NOT NULL,
    primary_learner_id UUID NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
    candidate_learner_id UUID NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    resolution VARCHAR(32),
    review_note TEXT,
    merged_from_learner_id UUID REFERENCES public.learners(id) ON DELETE SET NULL,
    merged_into_learner_id UUID REFERENCES public.learners(id) ON DELETE SET NULL,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_learner_reconciliation_status CHECK (status IN ('pending', 'resolved', 'dismissed')),
    CONSTRAINT chk_learner_reconciliation_resolution CHECK (resolution IS NULL OR resolution IN ('merged', 'dismissed', 'unmerged')),
    CONSTRAINT chk_learner_reconciliation_pair_diff CHECK (primary_learner_id <> candidate_learner_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_reconciliation_cases_pair_key
    ON public.learner_reconciliation_cases (pair_key);

CREATE INDEX IF NOT EXISTS idx_learner_reconciliation_cases_status
    ON public.learner_reconciliation_cases (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learner_reconciliation_cases_primary_learner_id
    ON public.learner_reconciliation_cases (primary_learner_id);

CREATE INDEX IF NOT EXISTS idx_learner_reconciliation_cases_candidate_learner_id
    ON public.learner_reconciliation_cases (candidate_learner_id);

CREATE TABLE IF NOT EXISTS public.learner_merge_history (
    id UUID PRIMARY KEY,
    reconciliation_case_id UUID NOT NULL REFERENCES public.learner_reconciliation_cases(id) ON DELETE CASCADE,
    source_learner_id UUID NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
    target_learner_id UUID NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
    merged_by UUID NOT NULL,
    merge_note TEXT,
    merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unmerged_by UUID,
    unmerge_note TEXT,
    unmerged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_learner_merge_source_target_diff CHECK (source_learner_id <> target_learner_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_merge_history_active_case
    ON public.learner_merge_history (reconciliation_case_id)
    WHERE unmerged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_learner_merge_history_source
    ON public.learner_merge_history (source_learner_id, merged_at DESC);

CREATE INDEX IF NOT EXISTS idx_learner_merge_history_target
    ON public.learner_merge_history (target_learner_id, merged_at DESC);
