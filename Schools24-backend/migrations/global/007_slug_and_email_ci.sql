-- Slug + email case-insensitive uniqueness hardening
-- This migration aligns DB constraints with backend usage (LOWER(email) lookups) and school slug routing.

-- 1) Schools.slug
ALTER TABLE public.schools
    ADD COLUMN IF NOT EXISTS slug TEXT;

-- Backfill slug for existing rows
UPDATE public.schools
SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE (slug IS NULL OR slug = '');

-- Enforce uniqueness for slug (index name chosen to be stable across environments)
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_slug_unique
ON public.schools (slug);

-- Keep slug in sync with name (if name changes, slug changes)
CREATE OR REPLACE FUNCTION public.set_school_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.name IS NULL OR NEW.name = '' THEN
        RETURN NEW;
    END IF;

    NEW.slug := lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := trim(both '-' from NEW.slug);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_school_slug ON public.schools;
CREATE TRIGGER trg_set_school_slug
BEFORE INSERT OR UPDATE OF name
ON public.schools
FOR EACH ROW
EXECUTE FUNCTION public.set_school_slug();


-- 2) Case-insensitive email uniqueness + indexing
-- Prevent duplicates that differ only by case.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.users
        GROUP BY lower(email)
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot apply case-insensitive unique index: public.users contains duplicate emails differing only by case.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.super_admins
        GROUP BY lower(email)
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot apply case-insensitive unique index: public.super_admins contains duplicate emails differing only by case.';
    END IF;
END $$;

-- Unique functional indexes support auth queries using LOWER(email)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique
ON public.users (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admins_email_lower_unique
ON public.super_admins (lower(email));
