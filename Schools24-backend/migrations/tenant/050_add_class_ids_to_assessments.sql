-- Migration 050: add class_ids UUID[] to assessments
-- Replaces the numeric class_grades INT[] approach with direct class UUID references.
-- class_grades is preserved for exam-timetable backward compatibility.

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS class_ids UUID[] DEFAULT '{}';
