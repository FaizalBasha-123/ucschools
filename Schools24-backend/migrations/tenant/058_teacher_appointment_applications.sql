-- Migration 058: Teacher appointment applications table (per-tenant schema)

CREATE TABLE IF NOT EXISTS teacher_appointment_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    academic_year VARCHAR(20),

    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    address TEXT,

    highest_qualification VARCHAR(255),
    professional_degree VARCHAR(255),
    eligibility_test VARCHAR(255),
    subject_expertise VARCHAR(255),
    experience_years INT DEFAULT 0,
    current_school VARCHAR(255),
    expected_salary NUMERIC(12,2),
    notice_period_days INT,
    cover_letter TEXT,

    has_aadhaar_card BOOLEAN NOT NULL DEFAULT false,
    has_pan_card BOOLEAN NOT NULL DEFAULT false,
    has_voter_or_passport BOOLEAN NOT NULL DEFAULT false,
    has_marksheets_10_12 BOOLEAN NOT NULL DEFAULT false,
    has_degree_certificates BOOLEAN NOT NULL DEFAULT false,
    has_bed_med_certificate BOOLEAN NOT NULL DEFAULT false,
    has_ctet_stet_result BOOLEAN NOT NULL DEFAULT false,
    has_relieving_letter BOOLEAN NOT NULL DEFAULT false,
    has_experience_certificate BOOLEAN NOT NULL DEFAULT false,
    has_salary_slips BOOLEAN NOT NULL DEFAULT false,
    has_epf_uan_number BOOLEAN NOT NULL DEFAULT false,
    has_police_verification BOOLEAN NOT NULL DEFAULT false,
    has_medical_fitness_cert BOOLEAN NOT NULL DEFAULT false,
    has_character_certificate BOOLEAN NOT NULL DEFAULT false,
    has_passport_photos BOOLEAN NOT NULL DEFAULT false,
    document_count INT NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_teacher_user_id UUID,
    rejection_reason TEXT,

    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teacher_appointments_school_status_idx
    ON teacher_appointment_applications (school_id, status);

CREATE INDEX IF NOT EXISTS teacher_appointments_school_submitted_idx
    ON teacher_appointment_applications (school_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS teacher_appointments_school_email_idx
    ON teacher_appointment_applications (school_id, email);

CREATE OR REPLACE FUNCTION update_teacher_appointment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_teacher_appointment_updated_at ON teacher_appointment_applications;
CREATE TRIGGER set_teacher_appointment_updated_at
    BEFORE UPDATE ON teacher_appointment_applications
    FOR EACH ROW EXECUTE FUNCTION update_teacher_appointment_updated_at();

