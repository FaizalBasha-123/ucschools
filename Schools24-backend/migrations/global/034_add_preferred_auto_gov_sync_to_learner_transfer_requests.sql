ALTER TABLE public.learner_transfer_requests
    ADD COLUMN IF NOT EXISTS preferred_auto_gov_sync BOOLEAN NOT NULL DEFAULT TRUE;
