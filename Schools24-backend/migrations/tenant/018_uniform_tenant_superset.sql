-- Uniform tenant schema migration (superset columns)
-- Adds missing columns so all tenant schemas share a consistent superset.

-- Assessments: legacy columns
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS date DATE;

-- Audit logs: legacy columns
ALTER TABLE IF EXISTS audit_logs ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE IF EXISTS audit_logs ADD COLUMN IF NOT EXISTS changes JSONB;

-- Fee structures: legacy columns
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS class_id UUID;
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS fee_type VARCHAR(50);
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2);
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS frequency VARCHAR(20);

-- Student fees: legacy columns
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS fee_structure_id UUID;

-- Payments: legacy columns
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS school_id UUID;
