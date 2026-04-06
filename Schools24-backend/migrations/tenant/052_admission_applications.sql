-- Migration 052: Admission applications table (per-tenant schema)
-- Each school gets its own admission_applications table in school_<id> schema

CREATE TABLE IF NOT EXISTS admission_applications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id         UUID NOT NULL,
    academic_year     VARCHAR(20),

    -- Student personal details
    student_name      VARCHAR(200) NOT NULL,
    date_of_birth     DATE NOT NULL,
    gender            VARCHAR(20),
    religion          VARCHAR(100),
    caste_category    VARCHAR(50),  -- general, obc, sc, st, etc.
    nationality       VARCHAR(100) DEFAULT 'Indian',
    mother_tongue     VARCHAR(100),
    blood_group       VARCHAR(10),
    aadhaar_number    VARCHAR(20),

    -- Applying for class
    applying_for_class VARCHAR(100),

    -- Previous school details
    previous_school_name    VARCHAR(300),
    previous_class          VARCHAR(100),
    previous_school_address TEXT,
    tc_number               VARCHAR(100),

    -- Parent/Guardian details
    father_name       VARCHAR(200),
    father_phone      VARCHAR(20),
    father_occupation VARCHAR(200),
    mother_name       VARCHAR(200),
    mother_phone      VARCHAR(20) NOT NULL,
    mother_occupation VARCHAR(200),
    guardian_name     VARCHAR(200),
    guardian_phone    VARCHAR(20),
    guardian_relation VARCHAR(100),

    -- Address
    address_line1     VARCHAR(300),
    address_line2     VARCHAR(300),
    city              VARCHAR(100),
    state             VARCHAR(100),
    pincode           VARCHAR(10),

    -- Documents are stored in object storage (R2) with metadata in admission_documents.
    -- link keys by school_id, application_id and document_type.
    has_birth_certificate     BOOLEAN NOT NULL DEFAULT false,
    has_aadhaar_card          BOOLEAN NOT NULL DEFAULT false,
    has_transfer_certificate  BOOLEAN NOT NULL DEFAULT false,
    has_caste_certificate     BOOLEAN NOT NULL DEFAULT false,
    has_income_certificate    BOOLEAN NOT NULL DEFAULT false,
    has_passport_photo        BOOLEAN NOT NULL DEFAULT false,
    document_count            INT NOT NULL DEFAULT 0,

    -- Status workflow
    status            VARCHAR(30) NOT NULL DEFAULT 'pending',
    -- pending | under_review | approved | rejected
    rejection_reason  TEXT,
    reviewed_by       UUID,  -- admin user_id who took action
    reviewed_at       TIMESTAMPTZ,

    -- Auto student creation on approval
    created_user_id   UUID,   -- references users.id after approval
    created_student_id UUID,  -- references students.id after approval

    -- Timestamps
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS admission_applications_school_status_idx
    ON admission_applications(school_id, status);

CREATE INDEX IF NOT EXISTS admission_applications_school_submitted_idx
    ON admission_applications(school_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS admission_applications_mother_phone_idx
    ON admission_applications(school_id, mother_phone);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_admission_applications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_admission_applications_updated_at ON admission_applications;
CREATE TRIGGER set_admission_applications_updated_at
    BEFORE UPDATE ON admission_applications
    FOR EACH ROW EXECUTE FUNCTION update_admission_applications_updated_at();
