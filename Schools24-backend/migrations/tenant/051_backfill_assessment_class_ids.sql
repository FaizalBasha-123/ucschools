-- Migration 051: backfill class_ids from class_grades for existing assessments
--
-- Context: Migration 050 added class_ids UUID[] DEFAULT '{}' to assessments.
-- Existing rows therefore have class_ids = '{}' (empty) and are invisible to all
-- queries that now filter by class_ids.
--
-- This migration populates class_ids by joining each assessment's class_grades
-- INT[] against the classes table within the same tenant schema.
--
-- Reasoning for what is included / excluded:
--   - Only rows where class_ids is still empty are touched (safe to re-run).
--   - Only assessments that have at least one class_grade are backfilled;
--     assessments with no class_grades are legacy malformed data — leave them.
--   - Classes with grade IS NULL (custom catalog classes added after Phase 3
--     refactor) are correctly excluded: the old grade-based UI never allowed
--     selecting them, so no existing assessment ever targeted them via grade.
--     Backfilling them would incorrectly broaden scope.

UPDATE assessments a
SET class_ids = COALESCE((
    SELECT array_agg(c.id ORDER BY c.name, c.section)
    FROM classes c
    WHERE c.school_id = a.school_id
      AND c.grade IS NOT NULL
      AND c.grade = ANY(COALESCE(a.class_grades, '{}'::INT[]))
), '{}')
WHERE (a.class_ids IS NULL OR array_length(a.class_ids, 1) IS NULL)
  AND array_length(COALESCE(a.class_grades, '{}'::INT[]), 1) IS NOT NULL;
