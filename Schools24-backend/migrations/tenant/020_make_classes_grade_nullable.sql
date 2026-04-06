-- Remove the numeric grade requirement from classes entirely.
-- Grade is now an optional hint for ordering; class name is the real identifier.
-- Custom catalog classes (e.g. "Commerce", "Science Stream") have no numeric grade.

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_grade_check;
ALTER TABLE classes ALTER COLUMN grade DROP NOT NULL;
ALTER TABLE classes ALTER COLUMN grade SET DEFAULT NULL;
