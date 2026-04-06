-- Add soft delete columns to schools table
ALTER TABLE public.schools 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID DEFAULT NULL;

-- Add foreign key to super_admins
ALTER TABLE public.schools 
ADD CONSTRAINT fk_schools_deleted_by 
FOREIGN KEY (deleted_by) REFERENCES public.super_admins(id) ON DELETE SET NULL;

-- Create index for efficient querying of deleted schools
CREATE INDEX IF NOT EXISTS idx_schools_deleted_at ON public.schools(deleted_at) WHERE deleted_at IS NOT NULL;

-- Create index for active schools (not deleted)
CREATE INDEX IF NOT EXISTS idx_schools_active ON public.schools(deleted_at) WHERE deleted_at IS NULL;
