-- Performance indexes for hot-path queries

-- Fees
CREATE INDEX IF NOT EXISTS idx_fee_items_fee_structure_id
ON fee_items (fee_structure_id);

CREATE INDEX IF NOT EXISTS idx_student_fees_school_created_at
ON student_fees (school_id, created_at DESC);

-- Payments
CREATE INDEX IF NOT EXISTS idx_payments_student_fee_date
ON payments (student_fee_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_school_date
ON payments (school_id, payment_date DESC);

-- Timetables
CREATE INDEX IF NOT EXISTS idx_timetables_class_year_dow_period
ON timetables (class_id, academic_year, day_of_week, period_number);

CREATE INDEX IF NOT EXISTS idx_timetables_teacher_year_dow_period
ON timetables (teacher_id, academic_year, day_of_week, period_number);

-- Audit logs (fast recent activity)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
ON audit_logs (created_at DESC);

-- Transport
CREATE INDEX IF NOT EXISTS idx_bus_routes_school_id
ON bus_routes (school_id);

CREATE INDEX IF NOT EXISTS idx_bus_stops_route_id
ON bus_stops (route_id);
