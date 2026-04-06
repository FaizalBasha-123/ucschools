-- Add bus transport columns to students table
-- bus_route_id and transport_mode are referenced in application queries
-- but were never added via migration, causing 500 errors on /admin/students-list
-- and /admin/bus-routes for all newly provisioned school schemas.

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS bus_route_id UUID REFERENCES bus_routes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(50) DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_students_bus_route_id ON students(bus_route_id);
