-- Add demand/payment fields for student fee management

-- Student fee demands (student_fees)
ALTER TABLE IF EXISTS student_fees
    ADD COLUMN IF NOT EXISTS purpose TEXT,
    ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
    ADD COLUMN IF NOT EXISTS created_by UUID,
    ADD COLUMN IF NOT EXISTS updated_by UUID,
    ADD COLUMN IF NOT EXISTS waiver_amount DECIMAL(10, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS waiver_reason TEXT;

-- Payments metadata for fee collections
ALTER TABLE IF EXISTS payments
    ADD COLUMN IF NOT EXISTS student_id UUID,
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
    ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS collected_by UUID,
    ADD COLUMN IF NOT EXISTS purpose TEXT;

-- Helpful indexes for reporting and lookups
CREATE INDEX IF NOT EXISTS idx_student_fees_school_id ON student_fees(school_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_student_id ON student_fees(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_status ON student_fees(status);
CREATE INDEX IF NOT EXISTS idx_payments_student_fee_id ON payments(student_fee_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);
