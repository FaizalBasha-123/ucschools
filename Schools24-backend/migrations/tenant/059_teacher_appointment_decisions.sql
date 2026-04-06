-- Migration 059: Decision trail for teacher appointment applications (per-tenant schema)

CREATE TABLE IF NOT EXISTS teacher_appointment_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    application_id UUID NOT NULL,
    applicant_name VARCHAR(200) NOT NULL,
    applicant_email VARCHAR(255) NOT NULL,
    applicant_phone VARCHAR(20),
    subject_expertise VARCHAR(255),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_teacher_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teacher_appointment_decisions_school_created_idx
    ON teacher_appointment_decisions (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS teacher_appointment_decisions_school_decision_idx
    ON teacher_appointment_decisions (school_id, decision, created_at DESC);
