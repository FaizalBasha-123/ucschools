CREATE TABLE IF NOT EXISTS public.demo_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number BIGSERIAL UNIQUE,
    school_name TEXT NOT NULL,
    school_code TEXT,
    address TEXT,
    contact_email TEXT,
    admins_public JSONB NOT NULL DEFAULT '[]'::jsonb,
    admins_secret BYTEA NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'trashed')),
    accepted_school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES public.super_admins(id) ON DELETE SET NULL,
    trashed_at TIMESTAMPTZ,
    trashed_by UUID REFERENCES public.super_admins(id) ON DELETE SET NULL,
    delete_after TIMESTAMPTZ,
    source_ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_status_created_at
    ON public.demo_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at
    ON public.demo_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_demo_requests_delete_after
    ON public.demo_requests (delete_after)
    WHERE status = 'trashed';

CREATE INDEX IF NOT EXISTS idx_demo_requests_school_code_active
    ON public.demo_requests (UPPER(school_code))
    WHERE school_code IS NOT NULL AND status <> 'trashed';

CREATE INDEX IF NOT EXISTS idx_demo_requests_contact_email_active
    ON public.demo_requests (LOWER(contact_email))
    WHERE contact_email IS NOT NULL AND status <> 'trashed';
