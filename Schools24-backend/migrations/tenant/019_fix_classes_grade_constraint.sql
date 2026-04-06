-- Fix classes grade check constraint to support pre-primary grades:
--   -2 = Nursery, -1 = LKG, 0 = UKG, 1-12 = Class 1-12
-- Previously: CHECK (grade >= 1 AND grade <= 12) blocked LKG/UKG/Nursery inserts.

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_grade_check;
ALTER TABLE classes ADD CONSTRAINT classes_grade_check CHECK (grade >= -2 AND grade <= 12);
