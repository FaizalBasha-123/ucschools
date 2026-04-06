-- NDEAR Phase PR-02: Extend parental_consents for consent withdrawal lifecycle.
-- Adds soft-state withdrawal fields so consent records are retained for audit.
-- Non-destructive: only ADD COLUMN, no DROP or ALTER existing columns.

ALTER TABLE parental_consents
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_parental_consents_status'
          AND conrelid = 'parental_consents'::regclass
    ) THEN
        ALTER TABLE parental_consents
            ADD CONSTRAINT chk_parental_consents_status
            CHECK (status IN ('active', 'withdrawn'));
    END IF;
END $$;

ALTER TABLE parental_consents
    ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS withdrawn_by VARCHAR(64),
    ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT,
    ADD COLUMN IF NOT EXISTS withdrawal_method VARCHAR(40);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_parental_consents_withdrawal_method'
          AND conrelid = 'parental_consents'::regclass
    ) THEN
        ALTER TABLE parental_consents
            ADD CONSTRAINT chk_parental_consents_withdrawal_method
            CHECK (withdrawal_method IS NULL OR withdrawal_method IN ('otp', 'written', 'digital', 'in_person', 'other'));
    END IF;
END $$;

-- Index for listing active/withdrawn consents per school
CREATE INDEX IF NOT EXISTS idx_parental_consents_school_status_time
    ON parental_consents (school_id, status, consented_at DESC);
