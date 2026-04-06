-- Align payments and student_fees nullability across tenants

DO $$
DECLARE
    tenant_uuid UUID;
BEGIN
    tenant_uuid := NULLIF(regexp_replace(current_schema(), '^school_', ''), '')::uuid;

    -- payments: school_id NOT NULL, payment_method nullable, student_id nullable (optional)
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'payments'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'payments'
              AND column_name = 'school_id'
        ) THEN
            EXECUTE 'UPDATE payments SET school_id = $1 WHERE school_id IS NULL' USING tenant_uuid;
            EXECUTE 'ALTER TABLE payments ALTER COLUMN school_id SET NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'payments'
              AND column_name = 'payment_method'
        ) THEN
            EXECUTE 'ALTER TABLE payments ALTER COLUMN payment_method DROP NOT NULL';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'payments'
              AND column_name = 'student_id'
        ) THEN
            EXECUTE 'ALTER TABLE payments ADD COLUMN student_id UUID';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'payments'
              AND column_name = 'student_id'
        ) THEN
            EXECUTE 'ALTER TABLE payments ALTER COLUMN student_id DROP NOT NULL';
        END IF;
    END IF;

    -- student_fees: school_id NOT NULL, others nullable
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'student_fees'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'student_fees'
              AND column_name = 'school_id'
        ) THEN
            EXECUTE 'UPDATE student_fees SET school_id = $1 WHERE school_id IS NULL' USING tenant_uuid;
            EXECUTE 'ALTER TABLE student_fees ALTER COLUMN school_id SET NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'student_fees'
              AND column_name = 'student_id'
        ) THEN
            EXECUTE 'ALTER TABLE student_fees ALTER COLUMN student_id DROP NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'student_fees'
              AND column_name = 'fee_item_id'
        ) THEN
            EXECUTE 'ALTER TABLE student_fees ALTER COLUMN fee_item_id DROP NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'student_fees'
              AND column_name = 'due_date'
        ) THEN
            EXECUTE 'ALTER TABLE student_fees ALTER COLUMN due_date DROP NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'student_fees'
              AND column_name = 'academic_year'
        ) THEN
            EXECUTE 'ALTER TABLE student_fees ALTER COLUMN academic_year DROP NOT NULL';
        END IF;
    END IF;
END $$;
