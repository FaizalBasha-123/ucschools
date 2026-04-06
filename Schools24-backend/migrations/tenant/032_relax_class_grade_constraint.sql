-- Allow foundational classes like LKG/UKG and future higher classes beyond 12.
-- Mapping used by app:
--   LKG -> -1
--   UKG -> 0
--   Class N -> N

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'classes'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%grade%'
    LOOP
        EXECUTE format('ALTER TABLE classes DROP CONSTRAINT IF EXISTS %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE classes
    ADD CONSTRAINT classes_grade_check CHECK (grade >= -1);

