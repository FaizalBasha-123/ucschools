-- Keep a single live timetable per class/day/period regardless of academic year.
-- Existing duplicate yearly rows are collapsed down to one row, preferring the
-- current global academic year when present, otherwise the most recently updated row.

DO $$
DECLARE
    current_year TEXT;
BEGIN
    SELECT value INTO current_year
    FROM public.global_settings
    WHERE key = 'current_academic_year'
    LIMIT 1;

    WITH ranked AS (
        SELECT
            ctid,
            ROW_NUMBER() OVER (
                PARTITION BY class_id, day_of_week, period_number
                ORDER BY
                    CASE WHEN academic_year = current_year THEN 0 ELSE 1 END,
                    updated_at DESC NULLS LAST,
                    created_at DESC NULLS LAST,
                    academic_year DESC NULLS LAST,
                    id DESC
            ) AS rn
        FROM timetables
    )
    DELETE FROM timetables t
    USING ranked r
    WHERE t.ctid = r.ctid
      AND r.rn > 1;

    IF current_year IS NOT NULL AND current_year <> '' THEN
        UPDATE timetables
        SET academic_year = current_year,
            updated_at = CURRENT_TIMESTAMP
        WHERE academic_year IS DISTINCT FROM current_year;
    END IF;

    ALTER TABLE timetables
        DROP CONSTRAINT IF EXISTS timetables_class_id_day_of_week_period_number_academic_year_key;

    ALTER TABLE timetables
        DROP CONSTRAINT IF EXISTS timetables_class_id_day_of_week_period_number_key;

    ALTER TABLE timetables
        ADD CONSTRAINT timetables_class_id_day_of_week_period_number_key
        UNIQUE (class_id, day_of_week, period_number);

    DROP INDEX IF EXISTS idx_timetables_class_year_dow_period;
    DROP INDEX IF EXISTS idx_timetables_teacher_year_dow_period;

    CREATE INDEX IF NOT EXISTS idx_timetables_class_dow_period
        ON timetables (class_id, day_of_week, period_number);

    CREATE INDEX IF NOT EXISTS idx_timetables_teacher_dow_period
        ON timetables (teacher_id, day_of_week, period_number);
END $$;
