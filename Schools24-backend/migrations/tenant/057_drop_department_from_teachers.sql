-- Migration 057: Drop department column from teachers table.
-- The department field has been removed from all teacher workflows;
-- subjects_taught is now the sole source of teacher-subject assignment.
ALTER TABLE teachers DROP COLUMN IF EXISTS department;
