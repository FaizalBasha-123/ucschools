-- Migration 025: allow public/landing support tickets

ALTER TABLE public.support_tickets
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'dashboard';

UPDATE public.support_tickets
SET source = 'dashboard'
WHERE source IS NULL OR source = '';

CREATE INDEX IF NOT EXISTS idx_support_tickets_source ON public.support_tickets(source);
