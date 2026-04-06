-- Timetable days configuration
CREATE TABLE IF NOT EXISTS timetable_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    day_name VARCHAR(20) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_timetable_days_active ON timetable_days(is_active);

-- Timetable periods configuration
CREATE TABLE IF NOT EXISTS timetable_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_number INT NOT NULL CHECK (period_number >= 1 AND period_number <= 10),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_break BOOLEAN NOT NULL DEFAULT FALSE,
    break_name VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period_number)
);

CREATE INDEX IF NOT EXISTS idx_timetable_periods_break ON timetable_periods(is_break);

-- Seed default timetable days (Mon-Sat)
INSERT INTO timetable_days (day_of_week, day_name, is_active)
VALUES
    (1, 'Monday', TRUE),
    (2, 'Tuesday', TRUE),
    (3, 'Wednesday', TRUE),
    (4, 'Thursday', TRUE),
    (5, 'Friday', TRUE),
    (6, 'Saturday', TRUE)
ON CONFLICT (day_of_week) DO NOTHING;

-- Seed default timetable periods (6 periods + lunch break)
INSERT INTO timetable_periods (period_number, start_time, end_time, is_break, break_name)
VALUES
    (1, '08:00', '08:45', FALSE, NULL),
    (2, '08:45', '09:30', FALSE, NULL),
    (3, '09:45', '10:30', FALSE, NULL),
    (4, '10:30', '11:15', FALSE, NULL),
    (5, '11:30', '12:15', FALSE, NULL),
    (6, '12:15', '13:00', TRUE, 'LUNCH BREAK')
ON CONFLICT (period_number) DO NOTHING;
