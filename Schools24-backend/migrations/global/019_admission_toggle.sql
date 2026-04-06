-- Migration 019: Add admission toggle and academic year to schools
-- Global schema (public.schools)

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admissions_open BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS admission_academic_year VARCHAR(20);

COMMENT ON COLUMN public.schools.admissions_open IS 'Whether the school is currently accepting admission applications';
COMMENT ON COLUMN public.schools.admission_academic_year IS 'Academic year for current admission cycle, e.g. 2024-2025';
