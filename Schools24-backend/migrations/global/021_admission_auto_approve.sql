-- Add auto-approve column to schools so admins can configure auto-approval of applications.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admission_auto_approve BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.schools.admission_auto_approve IS
  'When true, admission applications are automatically approved upon submission';
