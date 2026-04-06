-- Migration 060: Bus location history table for 7-day rolling GPS log.
--
-- Why this table exists:
--   Live position is stored purely in Valkey (bus:location:{route_id}) with a 35s TTL.
--   Valkey holds no history. This table provides the 7-day rolling log for dispute
--   resolution ("did the bus come?") without blowing up storage.
--
-- Storage profile (50 buses, 5 active hours/day):
--   ~3,600 rows/bus/day × 50 buses = 180,000 rows/day
--   With 30-second batching (one write per 30s per bus, not per ping):
--   ~50 × (5*3600/30) = 30,000 rows/day → ~2.1M rows at steady state (7 days)
--   At ~120 bytes/row = ~250 MB max per school. Cleanup job keeps it bounded.
--
-- Cleanup: DELETE WHERE recorded_at < NOW() - INTERVAL '7 days' runs nightly (see main.go).

CREATE TABLE IF NOT EXISTS bus_location_history (
    id          UUID             NOT NULL DEFAULT gen_random_uuid(),
    route_id    UUID             NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
    school_id   UUID             NOT NULL,
    lat         DOUBLE PRECISION NOT NULL, -- WGS-84 decimal degrees
    lng         DOUBLE PRECISION NOT NULL, -- WGS-84 decimal degrees
    speed       REAL             NOT NULL DEFAULT 0, -- km/h
    heading     REAL             NOT NULL DEFAULT 0, -- degrees 0-360
    recorded_at TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
);

-- Index for time-range queries per route (e.g. "show bus path today")
CREATE INDEX IF NOT EXISTS bus_location_history_route_time_idx
    ON bus_location_history (route_id, recorded_at DESC);

-- Index for school-level cleanup and analytics
CREATE INDEX IF NOT EXISTS bus_location_history_school_time_idx
    ON bus_location_history (school_id, recorded_at DESC);
