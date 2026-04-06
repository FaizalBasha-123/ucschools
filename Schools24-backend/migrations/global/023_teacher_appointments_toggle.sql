-- Migration 023: Add teacher appointments open toggle to schools
-- Global schema (public.schools)

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS teacher_appointments_open BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.schools.teacher_appointments_open IS 'Whether the school is currently accepting teacher appointment applications';
