-- Link tenant students to canonical public.learners identity records.

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS learner_id UUID REFERENCES public.learners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_learner_id ON students (learner_id);

-- Backfill learner records for students who already have federated IDs.
INSERT INTO public.learners (id, full_name, date_of_birth, apaar_id, abc_id, created_at, updated_at)
SELECT
    gen_random_uuid() AS id,
    u.full_name,
    s.date_of_birth,
    NULLIF(TRIM(s.apaar_id), '') AS apaar_id,
    NULLIF(TRIM(s.abc_id), '') AS abc_id,
    NOW(),
    NOW()
FROM students s
LEFT JOIN users u ON u.id = s.user_id
WHERE (NULLIF(TRIM(s.apaar_id), '') IS NOT NULL OR NULLIF(TRIM(s.abc_id), '') IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1
      FROM public.learners l
      WHERE (
            NULLIF(TRIM(s.apaar_id), '') IS NOT NULL
        AND UPPER(COALESCE(l.apaar_id, '')) = UPPER(NULLIF(TRIM(s.apaar_id), ''))
      )
      OR (
            NULLIF(TRIM(s.abc_id), '') IS NOT NULL
        AND UPPER(COALESCE(l.abc_id, '')) = UPPER(NULLIF(TRIM(s.abc_id), ''))
      )
  );

UPDATE students s
SET learner_id = l.id
FROM public.learners l
WHERE s.learner_id IS NULL
  AND (
        (NULLIF(TRIM(s.apaar_id), '') IS NOT NULL AND UPPER(COALESCE(l.apaar_id, '')) = UPPER(NULLIF(TRIM(s.apaar_id), '')))
     OR (NULLIF(TRIM(s.abc_id), '') IS NOT NULL AND UPPER(COALESCE(l.abc_id, '')) = UPPER(NULLIF(TRIM(s.abc_id), '')))
  );

INSERT INTO public.learner_enrollments (
    id,
    learner_id,
    school_id,
    status,
    joined_at,
    source,
    created_at,
    updated_at
)
SELECT DISTINCT
    gen_random_uuid(),
    s.learner_id,
    s.school_id,
    'active',
    COALESCE(s.admission_date, NOW()),
    'migration_backfill',
    NOW(),
    NOW()
FROM students s
WHERE s.learner_id IS NOT NULL
  AND s.school_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.learner_enrollments le
      WHERE le.learner_id = s.learner_id
        AND le.school_id = s.school_id
        AND le.status = 'active'
  );
