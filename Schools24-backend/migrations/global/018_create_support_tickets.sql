-- Migration 018: Create support tickets table (global, public schema)
-- Support tickets are platform-level; super admins manage them centrally.
-- User identity is denormalized at creation time (name, email, role, school)
-- so tickets remain readable even if the originating user/school is deleted.

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number   BIGSERIAL    NOT NULL,

    -- Submitter snapshot (denormalized — never rely on joins to tenant schemas)
    user_id         UUID         NOT NULL,
    user_type       VARCHAR(50)  NOT NULL,  -- admin | teacher | student | staff | super_admin
    user_name       VARCHAR(255) NOT NULL,
    user_email      VARCHAR(255) NOT NULL,
    school_id       UUID,                   -- NULL for super_admin submissions
    school_name     VARCHAR(255),

    -- Ticket content
    subject         VARCHAR(500) NOT NULL,
    description     TEXT         NOT NULL,
    category        VARCHAR(100) NOT NULL DEFAULT 'general',
    -- Values: general | technical | billing | academic | other
    priority        VARCHAR(20)  NOT NULL DEFAULT 'medium',
    -- Values: low | medium | high | critical

    -- Resolution
    status          VARCHAR(50)  NOT NULL DEFAULT 'open',
    -- Values: open | in_progress | resolved | closed
    admin_notes     TEXT,
    resolved_by_name VARCHAR(255),
    resolved_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_ticket_number ON public.support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status         ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id        ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_school_id      ON public.support_tickets(school_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at     ON public.support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category       ON public.support_tickets(category);
