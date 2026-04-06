-- Add suspension support to super_admins table
-- A suspended super_admin cannot login but all owned content (quizzes, materials, docs) is preserved.

ALTER TABLE public.super_admins
    ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS suspended_by UUID DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_super_admins_suspended ON public.super_admins(is_suspended) WHERE is_suspended = TRUE;

COMMENT ON COLUMN public.super_admins.is_suspended IS 'When TRUE the super admin cannot login. All content is preserved.';
COMMENT ON COLUMN public.super_admins.suspended_by IS 'UUID of the super_admin who issued the suspension.';
