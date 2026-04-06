-- Fee demand purposes are tenant-isolated (per-school schema)
CREATE TABLE IF NOT EXISTS fee_demand_purposes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_demand_purposes_name_lower
    ON fee_demand_purposes (LOWER(name));

ALTER TABLE IF EXISTS student_fees
    ADD COLUMN IF NOT EXISTS purpose_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = current_schema()
          AND table_name = 'student_fees'
          AND constraint_name = 'fk_student_fees_purpose_id'
    ) THEN
        ALTER TABLE student_fees
            ADD CONSTRAINT fk_student_fees_purpose_id
            FOREIGN KEY (purpose_id)
            REFERENCES fee_demand_purposes(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_fees_purpose_id
    ON student_fees (purpose_id);

INSERT INTO fee_demand_purposes (name)
SELECT seed.name
FROM (VALUES
    ('Tuition Fee'),
    ('School Fee'),
    ('Van Fee')
) AS seed(name)
WHERE NOT EXISTS (
    SELECT 1
    FROM fee_demand_purposes fdp
    WHERE LOWER(fdp.name) = LOWER(seed.name)
);
