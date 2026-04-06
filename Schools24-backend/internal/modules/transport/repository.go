package transport

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/shared/database"
)

// Repository handles all transport-related DB queries.
// Every method requires a context that already has "tenant_schema" set so the
// PostgresDB wrapper applies the correct search_path.
type Repository struct {
	db *database.PostgresDB
}

// NewRepository returns a Repository backed by the given PostgresDB.
func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

func parseClock(value string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, fmt.Errorf("time is required")
	}
	layouts := []string{"15:04:05", "15:04"}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time format")
}

func timeOnly(value time.Time) string {
	return value.Format("15:04:05")
}

func (r *Repository) ListTrackingSchedules(ctx context.Context, schoolID uuid.UUID) ([]TrackingSchedule, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			id,
			school_id,
			day_of_week,
			label,
			start_time,
			end_time,
			is_active,
			EXTRACT(EPOCH FROM created_at)::bigint * 1000,
			EXTRACT(EPOCH FROM updated_at)::bigint * 1000
		FROM transport_tracking_schedules
		WHERE school_id = $1
		ORDER BY day_of_week ASC, start_time ASC, end_time ASC, created_at ASC
	`, schoolID)
	if err != nil {
		return nil, fmt.Errorf("list tracking schedules: %w", err)
	}
	defer rows.Close()

	items := make([]TrackingSchedule, 0, 16)
	for rows.Next() {
		var item TrackingSchedule
		if err := rows.Scan(
			&item.ID,
			&item.SchoolID,
			&item.DayOfWeek,
			&item.Label,
			&item.StartTime,
			&item.EndTime,
			&item.IsActive,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tracking schedule: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tracking schedules: %w", err)
	}
	return items, nil
}

func (r *Repository) CreateTrackingSchedule(ctx context.Context, schoolID uuid.UUID, req TrackingScheduleUpsertRequest) (*TrackingSchedule, error) {
	startTime, err := parseClock(req.StartTime)
	if err != nil {
		return nil, err
	}
	endTime, err := parseClock(req.EndTime)
	if err != nil {
		return nil, err
	}
	if !endTime.After(startTime) {
		return nil, fmt.Errorf("end time must be after start time")
	}

	var item TrackingSchedule
	err = r.db.QueryRow(ctx, `
		INSERT INTO transport_tracking_schedules (
			school_id,
			day_of_week,
			label,
			start_time,
			end_time,
			is_active
		) VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING
			id,
			school_id,
			day_of_week,
			label,
			start_time,
			end_time,
			is_active,
			EXTRACT(EPOCH FROM created_at)::bigint * 1000,
			EXTRACT(EPOCH FROM updated_at)::bigint * 1000
	`, schoolID, req.DayOfWeek, strings.TrimSpace(req.Label), timeOnly(startTime), timeOnly(endTime), req.IsActive).Scan(
		&item.ID,
		&item.SchoolID,
		&item.DayOfWeek,
		&item.Label,
		&item.StartTime,
		&item.EndTime,
		&item.IsActive,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create tracking schedule: %w", err)
	}
	return &item, nil
}

func (r *Repository) UpdateTrackingSchedule(ctx context.Context, schoolID, scheduleID uuid.UUID, req TrackingScheduleUpsertRequest) (*TrackingSchedule, error) {
	startTime, err := parseClock(req.StartTime)
	if err != nil {
		return nil, err
	}
	endTime, err := parseClock(req.EndTime)
	if err != nil {
		return nil, err
	}
	if !endTime.After(startTime) {
		return nil, fmt.Errorf("end time must be after start time")
	}

	var item TrackingSchedule
	err = r.db.QueryRow(ctx, `
		UPDATE transport_tracking_schedules
		SET
			day_of_week = $3,
			label = $4,
			start_time = $5,
			end_time = $6,
			is_active = $7,
			updated_at = NOW()
		WHERE id = $1 AND school_id = $2
		RETURNING
			id,
			school_id,
			day_of_week,
			label,
			start_time,
			end_time,
			is_active,
			EXTRACT(EPOCH FROM created_at)::bigint * 1000,
			EXTRACT(EPOCH FROM updated_at)::bigint * 1000
	`, scheduleID, schoolID, req.DayOfWeek, strings.TrimSpace(req.Label), timeOnly(startTime), timeOnly(endTime), req.IsActive).Scan(
		&item.ID,
		&item.SchoolID,
		&item.DayOfWeek,
		&item.Label,
		&item.StartTime,
		&item.EndTime,
		&item.IsActive,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update tracking schedule: %w", err)
	}
	return &item, nil
}

func (r *Repository) DeleteTrackingSchedule(ctx context.Context, schoolID, scheduleID uuid.UUID) error {
	var exists bool
	if err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM transport_tracking_schedules
			WHERE id = $1 AND school_id = $2
		)
	`, scheduleID, schoolID).Scan(&exists); err != nil {
		return fmt.Errorf("delete tracking schedule: %w", err)
	}
	if !exists {
		return fmt.Errorf("tracking schedule not found")
	}
	if err := r.db.Exec(ctx, `
		DELETE FROM transport_tracking_schedules
		WHERE id = $1 AND school_id = $2
	`, scheduleID, schoolID); err != nil {
		return fmt.Errorf("delete tracking schedule: %w", err)
	}
	return nil
}

func (r *Repository) GetActiveTrackingSchedule(ctx context.Context, schoolID uuid.UUID, now time.Time) (*TrackingSchedule, error) {
	weekday := int(now.In(IST).Weekday())
	currentTime := now.In(IST).Format("15:04:05")

	var item TrackingSchedule
	err := r.db.QueryRow(ctx, `
		SELECT
			id,
			school_id,
			day_of_week,
			label,
			start_time,
			end_time,
			is_active,
			EXTRACT(EPOCH FROM created_at)::bigint * 1000,
			EXTRACT(EPOCH FROM updated_at)::bigint * 1000
		FROM transport_tracking_schedules
		WHERE school_id = $1
		  AND is_active = TRUE
		  AND day_of_week = $2
		  AND start_time <= $3::time
		  AND end_time > $3::time
		ORDER BY start_time ASC, end_time ASC
		LIMIT 1
	`, schoolID, weekday, currentTime).Scan(
		&item.ID,
		&item.SchoolID,
		&item.DayOfWeek,
		&item.Label,
		&item.StartTime,
		&item.EndTime,
		&item.IsActive,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// GetAssignedRouteID returns the bus_routes.id assigned to the staff member
// identified by userID (from JWT claims).
//
// Drivers are non_teaching_staff members whose ID is stored in
// bus_routes.driver_staff_id. A single staff member may only drive one bus.
func (r *Repository) GetAssignedRouteID(ctx context.Context, userID, schoolID uuid.UUID) (uuid.UUID, error) {
	const q = `
		SELECT br.id
		FROM bus_routes br
		JOIN non_teaching_staff s ON br.driver_staff_id = s.id
		WHERE s.user_id = $1
		  AND br.school_id = $2
		LIMIT 1
	`
	var routeID uuid.UUID
	if err := r.db.QueryRow(ctx, q, userID, schoolID).Scan(&routeID); err != nil {
		return uuid.Nil, fmt.Errorf("no bus route assigned to this driver: %w", err)
	}
	return routeID, nil
}

// GetStudentRouteID returns the bus_route_id assigned on the student's profile.
// Used to verify that a student is only allowed to track their own bus.
func (r *Repository) GetStudentRouteID(ctx context.Context, userID, schoolID uuid.UUID) (uuid.UUID, error) {
	const q = `
		SELECT s.bus_route_id
		FROM students s
		JOIN users u ON s.user_id = u.id
		WHERE u.id        = $1
		  AND s.school_id = $2
		  AND s.bus_route_id IS NOT NULL
		LIMIT 1
	`
	var routeID uuid.UUID
	if err := r.db.QueryRow(ctx, q, userID, schoolID).Scan(&routeID); err != nil {
		return uuid.Nil, fmt.Errorf("student has no bus route assigned: %w", err)
	}
	return routeID, nil
}

// GetBusStudentPushTokens returns push tokens for students assigned to school bus transport.
// Tokens are stored globally in public.push_device_tokens while the student profile lives
// in the tenant schema, so the query explicitly targets the public table.
func (r *Repository) GetBusStudentPushTokens(ctx context.Context, schoolID uuid.UUID) ([]string, error) {
	const q = `
		SELECT DISTINCT p.token
		FROM students s
		JOIN public.push_device_tokens p ON p.user_id = s.user_id
		WHERE s.school_id = $1
		  AND s.transport_mode = 'school_bus'
		  AND s.bus_route_id IS NOT NULL
		  AND p.school_id = $1
		  AND p.role = 'student'
		  AND COALESCE(NULLIF(BTRIM(p.token), ''), '') <> ''
	`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, fmt.Errorf("load bus student push tokens: %w", err)
	}
	defer rows.Close()

	tokens := make([]string, 0)
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, fmt.Errorf("scan bus student push token: %w", err)
		}
		tokens = append(tokens, token)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate bus student push tokens: %w", err)
	}
	return tokens, nil
}

// GetAssignedDriverPushTokens returns push tokens for staff members assigned as drivers
// to bus routes in the given school. This targets logged-in APK devices, not phone numbers.
func (r *Repository) GetAssignedDriverPushTokens(ctx context.Context, schoolID uuid.UUID) ([]string, error) {
	const q = `
		SELECT DISTINCT p.token
		FROM bus_routes br
		JOIN non_teaching_staff nts ON br.driver_staff_id = nts.id
		JOIN public.push_device_tokens p ON p.user_id = nts.user_id
		WHERE br.school_id = $1
		  AND br.driver_staff_id IS NOT NULL
		  AND p.school_id = $1
		  AND p.role = 'staff'
		  AND COALESCE(NULLIF(BTRIM(p.token), ''), '') <> ''
	`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, fmt.Errorf("load driver push tokens: %w", err)
	}
	defer rows.Close()

	tokens := make([]string, 0)
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, fmt.Errorf("scan driver push token: %w", err)
		}
		tokens = append(tokens, token)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate driver push tokens: %w", err)
	}
	return tokens, nil
}

// BusRouteExists confirms that a route belongs to the given school.
// Used when admins request a stream for any route in their school.
func (r *Repository) BusRouteExists(ctx context.Context, routeID, schoolID uuid.UUID) (bool, error) {
	const q = `SELECT EXISTS(SELECT 1 FROM bus_routes WHERE id = $1 AND school_id = $2)`
	var ok bool
	if err := r.db.QueryRow(ctx, q, routeID, schoolID).Scan(&ok); err != nil {
		return false, fmt.Errorf("bus route verification failed: %w", err)
	}
	return ok, nil
}

// InsertLocationHistory writes a single GPS record for the 7-day rolling log.
// Called every 30 seconds per active driver (not on every 5-second ping) to
// keep write volume within the numbers discussed in architecture planning.
func (r *Repository) InsertLocationHistory(ctx context.Context, schoolID, routeID uuid.UUID, lat, lng float64, speed, heading float32) error {
	const q = `
		INSERT INTO bus_location_history (route_id, school_id, lat, lng, speed, heading)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	if err := r.db.Exec(ctx, q, routeID, schoolID, lat, lng, speed, heading); err != nil {
		return fmt.Errorf("insert location history: %w", err)
	}
	return nil
}

// InsertLocationHistoryBatch writes buffered GPS records in one DB statement.
// Used when active tracking runs with Valkey buffering and flushes on stop/disconnect.
func (r *Repository) InsertLocationHistoryBatch(ctx context.Context, schoolID, routeID uuid.UUID, samples []LocationEvent) error {
	if len(samples) == 0 {
		return nil
	}

	lats := make([]float64, 0, len(samples))
	lngs := make([]float64, 0, len(samples))
	speeds := make([]float32, 0, len(samples))
	headings := make([]float32, 0, len(samples))
	recordedAt := make([]time.Time, 0, len(samples))

	for _, s := range samples {
		lats = append(lats, s.Lat)
		lngs = append(lngs, s.Lng)
		speeds = append(speeds, s.Speed)
		headings = append(headings, s.Heading)
		recordedAt = append(recordedAt, time.UnixMilli(s.UpdatedAt).UTC())
	}

	const q = `
		INSERT INTO bus_location_history (route_id, school_id, lat, lng, speed, heading, recorded_at)
		SELECT
			$1,
			$2,
			UNNEST($3::double precision[]),
			UNNEST($4::double precision[]),
			UNNEST($5::real[]),
			UNNEST($6::real[]),
			UNNEST($7::timestamptz[])
	`
	if err := r.db.Exec(ctx, q, routeID, schoolID, lats, lngs, speeds, headings, recordedAt); err != nil {
		return fmt.Errorf("insert location history batch: %w", err)
	}
	return nil
}

// DeleteOldLocationHistory removes records older than 7 days.
// ctx MUST have tenant_schema set. Called once per school per night from main.go.
func (r *Repository) DeleteOldLocationHistory(ctx context.Context) error {
	const q = `DELETE FROM bus_location_history WHERE recorded_at < NOW() - INTERVAL '7 days'`
	if err := r.db.Exec(ctx, q); err != nil {
		return fmt.Errorf("delete old location history: %w", err)
	}
	return nil
}

// GetAllRoutesActivity returns 7-day GPS tracking statistics for every bus route in
// the current tenant schema. Two queries are executed:
//  1. One summary query: total records, active days, avg/max speed, last seen — per route.
//  2. One daily-breakdown query: records per IST calendar day — merged in Go.
//
// ctx MUST have tenant_schema set (done automatically when called from a protected handler).
func (r *Repository) GetAllRoutesActivity(ctx context.Context) ([]RouteActivity, error) {
	// ── 1. Per-route summary over the last 7 days ─────────────────────────────
	const summaryQ = `
		SELECT
			br.id::text,
			br.route_number,
			br.vehicle_number,
			COALESCE(u.full_name, '') AS driver_name,
			COUNT(blh.id)::int                                                      AS total_records,
			COUNT(DISTINCT DATE(blh.recorded_at AT TIME ZONE 'Asia/Kolkata'))::int  AS active_days,
			COALESCE(AVG(blh.speed), 0)::real                                       AS avg_speed,
			COALESCE(MAX(blh.speed), 0)::real                                       AS max_speed,
			MAX(blh.recorded_at)                                                    AS last_seen
		FROM bus_routes br
		LEFT JOIN non_teaching_staff nts ON br.driver_staff_id = nts.id
		LEFT JOIN users u                ON nts.user_id = u.id
		LEFT JOIN bus_location_history blh
			ON  blh.route_id = br.id
			AND blh.recorded_at >= NOW() - INTERVAL '7 days'
		GROUP BY br.id, br.route_number, br.vehicle_number, u.full_name
		ORDER BY br.route_number
	`
	rows, err := r.db.Query(ctx, summaryQ)
	if err != nil {
		return nil, fmt.Errorf("GetAllRoutesActivity summary: %w", err)
	}
	defer rows.Close()

	activities := make([]RouteActivity, 0)
	idxMap := make(map[string]int) // route_id → index in activities slice

	for rows.Next() {
		var a RouteActivity
		var lastSeen *time.Time
		if err := rows.Scan(
			&a.RouteID, &a.RouteNumber, &a.VehicleNumber, &a.DriverName,
			&a.TotalRecords, &a.ActiveDays, &a.AvgSpeed, &a.MaxSpeed, &lastSeen,
		); err != nil {
			return nil, fmt.Errorf("GetAllRoutesActivity summary scan: %w", err)
		}
		if lastSeen != nil {
			ms := lastSeen.UnixMilli()
			a.LastSeen = &ms
		}
		a.Daily = []RouteActivityDay{}
		idxMap[a.RouteID] = len(activities)
		activities = append(activities, a)
	}
	rows.Close()

	if len(activities) == 0 {
		return activities, nil
	}

	// ── 2. Daily breakdown — one scan of all history rows, grouped in DB ──────
	// TO_CHAR produces "YYYY-MM-DD" in IST so the admin sees local dates.
	const dailyQ = `
		SELECT
			route_id::text,
			TO_CHAR(recorded_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
			COUNT(*)::int                                                   AS records,
			COALESCE(AVG(speed), 0)::real                                   AS avg_speed,
			COALESCE(MAX(speed), 0)::real                                   AS max_speed,
			MIN(recorded_at)                                                AS first_ping,
			MAX(recorded_at)                                                AS last_ping
		FROM bus_location_history
		WHERE recorded_at >= NOW() - INTERVAL '7 days'
		GROUP BY route_id, TO_CHAR(recorded_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
		ORDER BY route_id, day DESC
	`
	drows, err := r.db.Query(ctx, dailyQ)
	if err != nil {
		// Non-fatal: return the summary data even if daily breakdown fails.
		return activities, nil
	}
	defer drows.Close()

	for drows.Next() {
		var routeID string
		var d RouteActivityDay
		var firstPing, lastPing time.Time
		if err := drows.Scan(&routeID, &d.Day, &d.Records, &d.AvgSpeed, &d.MaxSpeed, &firstPing, &lastPing); err != nil {
			continue
		}
		fp := firstPing.UnixMilli()
		lp := lastPing.UnixMilli()
		d.FirstPing = &fp
		d.LastPing = &lp
		if idx, ok := idxMap[routeID]; ok {
			activities[idx].Daily = append(activities[idx].Daily, d)
		}
	}

	return activities, nil
}

// UpsertManualSession stops any prior active session and persists a new one to DB.
// This is the primary persistence path so tracking survives Valkey restarts.
func (r *Repository) UpsertManualSession(ctx context.Context, schoolID uuid.UUID, sess TrackingSession) error {
	now := time.Now().UnixMilli()
	// expire any still-active sessions first
	if err := r.db.Exec(ctx, `
		UPDATE transport_manual_sessions
		SET stopped_at = $1
		WHERE school_id = $2 AND stopped_at IS NULL AND expires_at > $1
	`, now, schoolID); err != nil {
		return fmt.Errorf("stop prior manual session: %w", err)
	}
	if err := r.db.Exec(ctx, `
		INSERT INTO transport_manual_sessions
			(school_id, started_by_id, started_by_name, started_at, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, schoolID, sess.StartedByID, sess.StartedByName, sess.StartedAt, sess.ExpiresAt); err != nil {
		return fmt.Errorf("insert manual session: %w", err)
	}
	return nil
}

// GetActiveManualSession returns the current active manual tracking session, or nil.
func (r *Repository) GetActiveManualSession(ctx context.Context, schoolID uuid.UUID) (*TrackingSession, error) {
	now := time.Now().UnixMilli()
	var sess TrackingSession
	err := r.db.QueryRow(ctx, `
		SELECT started_by_id, started_by_name, started_at, expires_at
		FROM transport_manual_sessions
		WHERE school_id = $1
		  AND stopped_at IS NULL
		  AND expires_at > $2
		ORDER BY started_at DESC
		LIMIT 1
	`, schoolID, now).Scan(&sess.StartedByID, &sess.StartedByName, &sess.StartedAt, &sess.ExpiresAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get active manual session: %w", err)
	}
	return &sess, nil
}

// StopManualSession marks all active manual sessions for a school as stopped.
func (r *Repository) StopManualSession(ctx context.Context, schoolID uuid.UUID, stoppedByID string) error {
	now := time.Now().UnixMilli()
	if err := r.db.Exec(ctx, `
		UPDATE transport_manual_sessions
		SET stopped_at = $1, stopped_by_id = $2
		WHERE school_id = $3 AND stopped_at IS NULL AND expires_at > $1
	`, now, stoppedByID, schoolID); err != nil {
		return fmt.Errorf("stop manual session: %w", err)
	}
	return nil
}

// StartTripSessionsForSchool opens one trip session per driver-assigned route.
// activationID links route sessions to the school-level tracking activation.
func (r *Repository) StartTripSessionsForSchool(ctx context.Context, schoolID uuid.UUID, activationID string, startedAt int64) error {
	if err := r.db.Exec(ctx, `
		INSERT INTO bus_trip_sessions (
			school_id, route_id, driver_id, activation_id, started_at, current_stop_sequence, last_notified_stop_sequence, created_at, updated_at
		)
		SELECT
			$1,
			br.id,
			nts.user_id,
			$2,
			$3,
			0,
			0,
			NOW(),
			NOW()
		FROM bus_routes br
		LEFT JOIN non_teaching_staff nts ON nts.id = br.driver_staff_id
		WHERE br.school_id = $1
		  AND br.driver_staff_id IS NOT NULL
	`, schoolID, strings.TrimSpace(activationID), startedAt); err != nil {
		return fmt.Errorf("start trip sessions: %w", err)
	}
	return nil
}

// StopTripSessionsForSchool closes active trip sessions in the school.
// If activationID is provided, only sessions for that activation are closed.
func (r *Repository) StopTripSessionsForSchool(ctx context.Context, schoolID uuid.UUID, activationID string, endedAt int64) error {
	trimmedActivation := strings.TrimSpace(activationID)
	if trimmedActivation == "" {
		if err := r.db.Exec(ctx, `
			UPDATE bus_trip_sessions
			SET ended_at = $2,
				updated_at = NOW()
			WHERE school_id = $1
			  AND ended_at IS NULL
		`, schoolID, endedAt); err != nil {
			return fmt.Errorf("stop trip sessions: %w", err)
		}
		return nil
	}

	if err := r.db.Exec(ctx, `
		UPDATE bus_trip_sessions
		SET ended_at = $3,
			updated_at = NOW()
		WHERE school_id = $1
		  AND activation_id = $2
		  AND ended_at IS NULL
	`, schoolID, trimmedActivation, endedAt); err != nil {
		return fmt.Errorf("stop trip sessions by activation: %w", err)
	}
	return nil
}

// GetActiveTripSession returns the currently-open trip session for a given route,
// or nil if none is active. Used by the stop-arrival engine in the WebSocket loop.
func (r *Repository) GetActiveTripSession(ctx context.Context, schoolID, routeID uuid.UUID) (*BusTripSession, error) {
	const q = `
		SELECT id::text, school_id::text, route_id::text,
		       COALESCE(driver_id::text, ''), COALESCE(activation_id, ''),
		       started_at, current_stop_sequence, last_notified_stop_sequence
		FROM bus_trip_sessions
		WHERE school_id = $1
		  AND route_id  = $2
		  AND ended_at IS NULL
		ORDER BY started_at DESC
		LIMIT 1
	`
	row := r.db.QueryRow(ctx, q, schoolID, routeID)
	var s BusTripSession
	err := row.Scan(
		&s.ID, &s.SchoolID, &s.RouteID,
		&s.DriverID, &s.ActivationID,
		&s.StartedAt, &s.CurrentStopSequence, &s.LastNotifiedStopSequence,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get active trip session: %w", err)
	}
	return &s, nil
}

// GetNextBusRouteStop returns the next unvisited stop for a route.
// Pass currentSequence = session.CurrentStopSequence; this returns the stop
// with sequence = currentSequence + 1, or nil if the route has no more stops.
func (r *Repository) GetNextBusRouteStop(ctx context.Context, schoolID, routeID uuid.UUID, currentSequence int) (*ActiveRouteStop, error) {
	const q = `
		SELECT id::text, sequence, stop_name,
		       lat::float8, lng::float8, radius_meters
		FROM bus_route_stops
		WHERE school_id = $1
		  AND route_id  = $2
		  AND sequence  = $3
		LIMIT 1
	`
	row := r.db.QueryRow(ctx, q, schoolID, routeID, currentSequence+1)
	var s ActiveRouteStop
	err := row.Scan(&s.ID, &s.Sequence, &s.StopName, &s.Lat, &s.Lng, &s.RadiusMeters)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get next bus route stop: %w", err)
	}
	return &s, nil
}

// RecordStopArrival atomically:
//  1. Upserts a bus_trip_stop_events row for the reached stop.
//  2. Advances current_stop_sequence in bus_trip_sessions.
//
// The UPSERT ensures idempotency if two rapid, concurrent pings both satisfy
// the arrival condition before the DB write completes.
func (r *Repository) RecordStopArrival(ctx context.Context, schoolID uuid.UUID, sessionID, stopID string, sequence int, reachedAt int64) error {
	const evQ = `
		INSERT INTO bus_trip_stop_events
			(school_id, session_id, stop_id, sequence, reached_at, ping_count_inside_radius)
		VALUES ($1, $2, $3, $4, $5, 1)
		ON CONFLICT (session_id, sequence) DO UPDATE
		   SET ping_count_inside_radius = bus_trip_stop_events.ping_count_inside_radius + 1
	`
	if err := r.db.Exec(ctx, evQ, schoolID, sessionID, stopID, sequence, reachedAt); err != nil {
		return fmt.Errorf("record stop event: %w", err)
	}
	const sessQ = `
		UPDATE bus_trip_sessions
		SET current_stop_sequence      = GREATEST(current_stop_sequence, $3),
		    last_notified_stop_sequence = GREATEST(last_notified_stop_sequence, $3),
		    updated_at                  = NOW()
		WHERE id = $1
		  AND school_id = $2
		  AND ended_at IS NULL
	`
	if err := r.db.Exec(ctx, sessQ, sessionID, schoolID, sequence); err != nil {
		return fmt.Errorf("advance trip session sequence: %w", err)
	}
	return nil
}

// GetStopAssignedPushTokens returns FCM/APNS push tokens for students
// that have a bus_stop_assignment for the given stop (pickup or drop).
// Tokens live in public.push_device_tokens (global table).
func (r *Repository) GetStopAssignedPushTokens(ctx context.Context, schoolID, stopID uuid.UUID) ([]string, error) {
	const q = `
		SELECT DISTINCT p.token
		FROM bus_stop_assignments bsa
		JOIN students              s ON s.id = bsa.student_id AND s.school_id = $1
		JOIN public.push_device_tokens p ON p.user_id = s.user_id AND p.school_id = $1
		WHERE bsa.school_id = $1
		  AND bsa.stop_id   = $2
		  AND COALESCE(NULLIF(BTRIM(p.token), ''), '') <> ''
	`
	rows, err := r.db.Query(ctx, q, schoolID, stopID)
	if err != nil {
		return nil, fmt.Errorf("get stop assigned push tokens: %w", err)
	}
	defer rows.Close()
	var tokens []string
	for rows.Next() {
		var tok string
		if err := rows.Scan(&tok); err != nil {
			return nil, fmt.Errorf("scan stop push token: %w", err)
		}
		tokens = append(tokens, tok)
	}
	return tokens, rows.Err()
}

// ListRoutesForLiveStatus returns all routes in a school with driver metadata.
// Live/online fields are resolved in handler from Valkey cache.
func (r *Repository) ListRoutesForLiveStatus(ctx context.Context, schoolID uuid.UUID) ([]RouteLiveStatus, error) {
	const q = `
		SELECT
			br.id::text,
			br.route_number,
			br.vehicle_number,
			COALESCE(u.full_name, '') AS driver_name
		FROM bus_routes br
		LEFT JOIN non_teaching_staff nts ON br.driver_staff_id = nts.id
		LEFT JOIN users u ON nts.user_id = u.id
		WHERE br.school_id = $1
		ORDER BY br.route_number ASC
	`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, fmt.Errorf("list routes for live status: %w", err)
	}
	defer rows.Close()

	routes := make([]RouteLiveStatus, 0)
	for rows.Next() {
		var item RouteLiveStatus
		if err := rows.Scan(&item.RouteID, &item.RouteNumber, &item.VehicleNumber, &item.DriverName); err != nil {
			return nil, fmt.Errorf("scan route for live status: %w", err)
		}
		routes = append(routes, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate routes for live status: %w", err)
	}
	return routes, nil
}
