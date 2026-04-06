-- Bus routes driver linking and cleanup
ALTER TABLE IF EXISTS bus_routes
    ADD COLUMN IF NOT EXISTS driver_staff_id UUID,
    ADD COLUMN IF NOT EXISTS current_students INT DEFAULT 0;

ALTER TABLE IF EXISTS bus_routes
    DROP COLUMN IF EXISTS status;

CREATE INDEX IF NOT EXISTS idx_bus_routes_driver_staff_id ON bus_routes(driver_staff_id);
