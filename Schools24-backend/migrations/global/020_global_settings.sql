-- 020_global_settings.sql
-- Stores platform-wide settings managed by super admin.
-- current_academic_year is the single source of truth for academic year across all schools.

CREATE TABLE IF NOT EXISTS public.global_settings (
    key        VARCHAR(100) PRIMARY KEY,
    value      TEXT         NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed default current academic year
INSERT INTO public.global_settings (key, value)
VALUES ('current_academic_year', '2025-2026')
ON CONFLICT (key) DO NOTHING;
