-- Ensure tenant schemas use consistent constraints for audit_logs and fee_structures
-- This aligns nullability across tenants without changing table structures.

DO $$
DECLARE
    tenant_uuid UUID;
    has_fee_items BOOLEAN;
BEGIN
    tenant_uuid := NULLIF(regexp_replace(current_schema(), '^school_', ''), '')::uuid;

    -- audit_logs: school_id NOT NULL, entity_type nullable
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'audit_logs'
          AND column_name = 'school_id'
    ) THEN
        EXECUTE 'UPDATE audit_logs SET school_id = $1 WHERE school_id IS NULL' USING tenant_uuid;
        EXECUTE 'ALTER TABLE audit_logs ALTER COLUMN school_id SET NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'audit_logs'
          AND column_name = 'entity_type'
    ) THEN
        EXECUTE 'ALTER TABLE audit_logs ALTER COLUMN entity_type DROP NOT NULL';
    END IF;

    -- fee_structures: school_id/fee_type/amount NOT NULL, name/academic_year nullable
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'fee_structures'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'fee_structures'
              AND column_name = 'school_id'
        ) THEN
            EXECUTE 'UPDATE fee_structures SET school_id = $1 WHERE school_id IS NULL' USING tenant_uuid;
            EXECUTE 'ALTER TABLE fee_structures ALTER COLUMN school_id SET NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'fee_structures'
              AND column_name = 'fee_type'
        ) THEN
            EXECUTE 'UPDATE fee_structures SET fee_type = COALESCE(fee_type, name, ''tuition'') WHERE fee_type IS NULL';
            EXECUTE 'ALTER TABLE fee_structures ALTER COLUMN fee_type SET NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'fee_structures'
              AND column_name = 'name'
        ) THEN
            EXECUTE 'UPDATE fee_structures SET name = COALESCE(name, fee_type, ''Tuition Fee'') WHERE name IS NULL';
            EXECUTE 'ALTER TABLE fee_structures ALTER COLUMN name DROP NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'fee_structures'
              AND column_name = 'academic_year'
        ) THEN
            EXECUTE 'ALTER TABLE fee_structures ALTER COLUMN academic_year DROP NOT NULL';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'fee_structures'
              AND column_name = 'amount'
        ) THEN
            has_fee_items := EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = current_schema()
                  AND table_name = 'fee_items'
            );
            IF has_fee_items THEN
                EXECUTE 'UPDATE fee_structures fs SET amount = COALESCE((SELECT SUM(fi.amount) FROM fee_items fi WHERE fi.fee_structure_id = fs.id), 0) WHERE fs.amount IS NULL';
            ELSE
                EXECUTE 'UPDATE fee_structures SET amount = 0 WHERE amount IS NULL';
            END IF;
            EXECUTE 'ALTER TABLE fee_structures ALTER COLUMN amount SET NOT NULL';
        END IF;
    END IF;
END $$;
