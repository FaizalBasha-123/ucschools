-- DPDPA/NDEAR baseline: verifiable parental consent records for minors.
-- Stored in each tenant schema because admissions are school-scoped.

CREATE TABLE IF NOT EXISTS parental_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    admission_application_id UUID NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
    student_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    student_date_of_birth DATE NOT NULL,
    guardian_name VARCHAR(200) NOT NULL,
    guardian_phone VARCHAR(20) NOT NULL,
    guardian_relation VARCHAR(100),

    consent_method VARCHAR(40) NOT NULL CHECK (
        consent_method IN ('otp', 'written', 'digital', 'in_person', 'other')
    ),
    declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    consent_reference VARCHAR(255),

    consent_ip VARCHAR(64),
    consent_user_agent TEXT,
    policy_version VARCHAR(30) NOT NULL DEFAULT '2026-03-17',
    consented_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (school_id, admission_application_id)
);

CREATE INDEX IF NOT EXISTS idx_parental_consents_school_time
    ON parental_consents (school_id, consented_at DESC);

CREATE INDEX IF NOT EXISTS idx_parental_consents_admission
    ON parental_consents (admission_application_id);
