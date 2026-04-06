-- Bus Route Stop Engine (tenant-scoped)
-- Adds map-grade stop storage, route shape metadata, stop assignments,
-- and trip sessions for realtime stop-arrival workflows.

CREATE TABLE IF NOT EXISTS bus_route_stops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    route_id UUID NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
    sequence INT NOT NULL,
    stop_name VARCHAR(255) NOT NULL,
    address TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    radius_meters INT NOT NULL DEFAULT 80,
    place_id VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_bus_route_stops_sequence_positive CHECK (sequence > 0),
    CONSTRAINT chk_bus_route_stops_radius CHECK (radius_meters BETWEEN 30 AND 300),
    CONSTRAINT chk_bus_route_stops_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT chk_bus_route_stops_lng CHECK (lng BETWEEN -180 AND 180),
    CONSTRAINT uq_bus_route_stops_route_sequence UNIQUE (route_id, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bus_route_stops_route_place_unique
    ON bus_route_stops (school_id, route_id, place_id)
    WHERE place_id IS NOT NULL AND BTRIM(place_id) <> '';

CREATE INDEX IF NOT EXISTS idx_bus_route_stops_school_route
    ON bus_route_stops (school_id, route_id);

CREATE INDEX IF NOT EXISTS idx_bus_route_stops_route_sequence
    ON bus_route_stops (route_id, sequence);

CREATE TABLE IF NOT EXISTS bus_route_shapes (
    route_id UUID PRIMARY KEY REFERENCES bus_routes(id) ON DELETE CASCADE,
    school_id UUID NOT NULL,
    polyline TEXT NOT NULL,
    distance_m INT,
    duration_est INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bus_route_shapes_school_route
    ON bus_route_shapes (school_id, route_id);

CREATE TABLE IF NOT EXISTS bus_stop_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
    stop_id UUID NOT NULL REFERENCES bus_route_stops(id) ON DELETE CASCADE,
    pickup_or_drop VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_bus_stop_assignments_kind CHECK (
        pickup_or_drop IS NULL OR pickup_or_drop IN ('pickup', 'drop', 'both')
    ),
    CONSTRAINT uq_bus_stop_assignments UNIQUE (student_id, route_id, stop_id, pickup_or_drop)
);

CREATE INDEX IF NOT EXISTS idx_bus_stop_assignments_school_stop
    ON bus_stop_assignments (school_id, stop_id);

CREATE INDEX IF NOT EXISTS idx_bus_stop_assignments_school_route
    ON bus_stop_assignments (school_id, route_id);

CREATE TABLE IF NOT EXISTS bus_trip_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    route_id UUID NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
    driver_id UUID,
    activation_id VARCHAR(255),
    started_at BIGINT NOT NULL,
    ended_at BIGINT,
    current_stop_sequence INT NOT NULL DEFAULT 0,
    last_notified_stop_sequence INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bus_trip_sessions_school_route_started
    ON bus_trip_sessions (school_id, route_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_bus_trip_sessions_school_active
    ON bus_trip_sessions (school_id, ended_at)
    WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bus_trip_sessions_activation
    ON bus_trip_sessions (school_id, activation_id)
    WHERE activation_id IS NOT NULL AND BTRIM(activation_id) <> '';

CREATE TABLE IF NOT EXISTS bus_trip_stop_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    session_id UUID NOT NULL REFERENCES bus_trip_sessions(id) ON DELETE CASCADE,
    stop_id UUID NOT NULL REFERENCES bus_route_stops(id) ON DELETE CASCADE,
    sequence INT NOT NULL,
    reached_at BIGINT NOT NULL,
    notified_at BIGINT,
    ping_count_inside_radius INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_bus_trip_stop_events_session_sequence UNIQUE (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_bus_trip_stop_events_session_sequence
    ON bus_trip_stop_events (session_id, sequence);
