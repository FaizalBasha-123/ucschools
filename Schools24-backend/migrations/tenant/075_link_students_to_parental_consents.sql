-- Migration: Link students directly to parental_consents
-- Issue: parental_consents is currently only linked via admission_applications
-- Solution: Add student_id FK and consent_status to students table

-- Step 1: Add student_id reference to parental_consents (for direct linking)
ALTER TABLE parental_consents
    ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_parental_consents_student_id
    ON parental_consents (student_id)
    WHERE student_id IS NOT NULL;

-- Step 2: Add consent tracking columns to students table
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS consent_status VARCHAR(30) DEFAULT 'not_required' CHECK (
        consent_status IN ('not_required', 'pending', 'active', 'withdrawal_requested', 'withdrawn')
    ),
    ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS is_minor BOOLEAN;

CREATE OR REPLACE FUNCTION set_student_is_minor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.is_minor := (NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > CURRENT_DATE - INTERVAL '18 years');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_set_is_minor ON students;
CREATE TRIGGER trg_students_set_is_minor
BEFORE INSERT OR UPDATE OF date_of_birth ON students
FOR EACH ROW
EXECUTE FUNCTION set_student_is_minor();

-- Step 3: Create consent_withdrawal_requests table (parent requests via student login)
CREATE TABLE IF NOT EXISTS consent_withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    consent_id UUID REFERENCES parental_consents(id) ON DELETE SET NULL,
    
    -- Request details
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    requested_by VARCHAR(100) NOT NULL DEFAULT 'parent', -- 'parent' via student login
    reason TEXT,
    
    -- Admin processing
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected', 'cancelled')
    ),
    admin_notes TEXT,
    processed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    processed_at TIMESTAMP,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_school_status
    ON consent_withdrawal_requests (school_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_student
    ON consent_withdrawal_requests (student_id);

-- Step 4: Backfill consent_status for existing students
-- Minors without consent → 'pending'
-- Minors with consent → 'active'
-- Adults → 'not_required'
UPDATE students
SET consent_status = CASE
    WHEN date_of_birth > CURRENT_DATE - INTERVAL '18 years' THEN
        CASE
            WHEN EXISTS (
                SELECT 1 FROM parental_consents pc
                WHERE pc.student_user_id = students.user_id
                  AND pc.status = 'active'
            ) THEN 'active'
            ELSE 'pending'
        END
    ELSE 'not_required'
END
WHERE consent_status IS NULL OR consent_status = 'not_required';

UPDATE students
SET is_minor = (date_of_birth IS NOT NULL AND date_of_birth > CURRENT_DATE - INTERVAL '18 years')
WHERE is_minor IS DISTINCT FROM (date_of_birth IS NOT NULL AND date_of_birth > CURRENT_DATE - INTERVAL '18 years');

-- Step 5: Backfill student_id in parental_consents from student_user_id
UPDATE parental_consents pc
SET student_id = s.id
FROM students s
WHERE pc.student_user_id = s.user_id
  AND pc.student_id IS NULL;

COMMENT ON COLUMN students.consent_status IS 
  'DPDPA consent tracking: not_required (adult 18+), pending (minor without consent), active (consented), withdrawal_requested (parent requested), withdrawn (admin approved)';

COMMENT ON COLUMN students.is_minor IS 
    'Auto-maintained by trigger: TRUE if under 18 years old based on date_of_birth';

COMMENT ON TABLE consent_withdrawal_requests IS
  'DPDPA withdrawal workflow: Parent requests via student login → Admin verifies with parent → Approve/Reject';
