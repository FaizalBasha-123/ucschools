-- NDEAR federated identity baseline for student records.
-- Adds optional identifiers so rollout can be gradual without breaking existing data.

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS apaar_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS abc_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_apaar_id_unique
    ON students (apaar_id)
    WHERE apaar_id IS NOT NULL AND TRIM(apaar_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_abc_id_unique
    ON students (abc_id)
    WHERE abc_id IS NOT NULL AND TRIM(abc_id) <> '';
