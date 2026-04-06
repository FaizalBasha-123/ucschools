CREATE TABLE IF NOT EXISTS transport_tracking_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    label VARCHAR(120) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_transport_tracking_schedules_school_day
    ON transport_tracking_schedules (school_id, day_of_week, start_time);

CREATE INDEX IF NOT EXISTS idx_transport_tracking_schedules_active_day
    ON transport_tracking_schedules (is_active, day_of_week, start_time);
