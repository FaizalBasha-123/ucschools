-- NDEAR Phase PR-04: Track federated identity verification state per student.
-- This enables auditing which IDs have been verified vs self-reported.

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS apaar_verified_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS abc_verified_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS identity_verification_status VARCHAR(30) DEFAULT 'unverified';

-- Partial index for finding unverified students efficiently
CREATE INDEX IF NOT EXISTS idx_students_verification_status
    ON students (identity_verification_status)
    WHERE identity_verification_status <> 'verified';
