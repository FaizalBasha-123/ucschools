-- 026_support_ticket_labels.sql
-- Add a `label` column to public.support_tickets that explicitly identifies
-- the portal / role of the ticket submitter for easy triage.
--
-- Label values:
--   landing      – submitted via the public landing page form (unauthenticated)
--   student      – submitted by a student user
--   teacher      – submitted by a teacher user
--   school_admin – submitted by a school admin or staff member
--   super_admin  – submitted by a super admin
--   other        – anything else (fallback)

ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS label VARCHAR(50);

-- Back-fill existing rows from user_type + source so no row is left NULL.
UPDATE public.support_tickets
SET label = CASE
    WHEN source = 'landing'              THEN 'landing'
    WHEN user_type = 'student'           THEN 'student'
    WHEN user_type = 'teacher'           THEN 'teacher'
    WHEN user_type IN ('admin', 'staff') THEN 'school_admin'
    WHEN user_type = 'super_admin'       THEN 'super_admin'
    ELSE 'other'
END
WHERE label IS NULL;

-- Set a non-null default for all future inserts.
ALTER TABLE public.support_tickets
    ALTER COLUMN label SET DEFAULT 'other';

-- Index to make label-based filtering fast.
CREATE INDEX IF NOT EXISTS idx_support_tickets_label
    ON public.support_tickets (label);
