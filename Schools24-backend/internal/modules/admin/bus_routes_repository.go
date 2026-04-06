package admin

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (r *Repository) getDriverInfo(ctx context.Context, staffID uuid.UUID, schoolID uuid.UUID) (string, string, error) {
	query := `
		SELECT u.full_name, COALESCE(u.phone, '')
		FROM non_teaching_staff s
		JOIN users u ON s.user_id = u.id
		WHERE s.id = $1 AND s.school_id = $2
	`
	var name, phone string
	if err := r.db.QueryRow(ctx, query, staffID, schoolID).Scan(&name, &phone); err != nil {
		return "", "", fmt.Errorf("driver staff not found: %w", err)
	}
	return name, phone, nil
}

func (r *Repository) ListBusRoutes(ctx context.Context, schoolID uuid.UUID, search string, page, pageSize int) ([]BusRoute, int, error) {
	offset := (page - 1) * pageSize
	args := []interface{}{schoolID}
	where := "WHERE br.school_id = $1"
	if search != "" {
		where += " AND (br.route_number ILIKE $2 OR br.vehicle_number ILIKE $2 OR COALESCE(u.full_name, br.driver_name) ILIKE $2)"
		args = append(args, "%"+search+"%")
	}

	// Count Total
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM bus_routes br
		LEFT JOIN non_teaching_staff s ON br.driver_staff_id = s.id
		LEFT JOIN users u ON s.user_id = u.id
		%s
	`, where)

	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count bus routes: %w", err)
	}

	// Fetch Routes with Occupancy and Sort
	// Priority: Capacity Exceeded (Occupancy > Capacity) -> Top
	// Then: Alphabetical by Route Number
	query := fmt.Sprintf(`
		SELECT br.id, br.school_id, COALESCE(br.route_number, '') as route_number, br.driver_staff_id,
			   COALESCE(u.full_name, br.driver_name, '') as driver_name,
			   COALESCE(u.phone, br.driver_phone, '') as driver_phone,
			   COALESCE(br.vehicle_number, '') as vehicle_number, br.capacity,
			   (SELECT COUNT(*) FROM students st WHERE st.bus_route_id = br.id) as current_students
		FROM bus_routes br
		LEFT JOIN non_teaching_staff s ON br.driver_staff_id = s.id
		LEFT JOIN users u ON s.user_id = u.id
		%s
		ORDER BY 
			CASE WHEN (SELECT COUNT(*) FROM students st WHERE st.bus_route_id = br.id) > br.capacity THEN 0 ELSE 1 END ASC,
			br.route_number ASC
		LIMIT $%d OFFSET $%d
	`, where, len(args)+1, len(args)+2)

	args = append(args, pageSize, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list bus routes: %w", err)
	}
	defer rows.Close()

	var routes []BusRoute
	var routeIDs []uuid.UUID
	for rows.Next() {
		var route BusRoute
		if err := rows.Scan(
			&route.ID,
			&route.SchoolID,
			&route.RouteNumber,
			&route.DriverStaffID,
			&route.DriverName,
			&route.DriverPhone,
			&route.VehicleNumber,
			&route.Capacity,
			&route.CurrentStudents,
		); err != nil {
			return nil, 0, err
		}
		routes = append(routes, route)
		routeIDs = append(routeIDs, route.ID)
	}

	if len(routeIDs) == 0 {
		return routes, total, nil
	}

	stops, err := r.getStopsForRoutes(ctx, routeIDs, "")
	if err != nil {
		return nil, 0, err
	}

	for i := range routes {
		routes[i].Stops = stops[routes[i].ID]
	}

	return routes, total, nil
}

func (r *Repository) getStopsForRoutes(ctx context.Context, routeIDs []uuid.UUID, schema string) (map[uuid.UUID][]BusStop, error) {
	stopsTable := "bus_stops"
	if schema != "" {
		stopsTable = fmt.Sprintf("%s.bus_stops", schema)
	}

	query := fmt.Sprintf(`
		SELECT id, route_id, name,
			   COALESCE(to_char(arrival_time, 'HH12:MI AM'), '') as time,
			   stop_order
		FROM %s
		WHERE route_id = ANY($1)
		ORDER BY route_id, stop_order
	`, stopsTable)

	rows, err := r.db.Query(ctx, query, routeIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch bus stops: %w", err)
	}
	defer rows.Close()

	stopsByRoute := map[uuid.UUID][]BusStop{}
	for rows.Next() {
		var stop BusStop
		if err := rows.Scan(&stop.ID, &stop.RouteID, &stop.Name, &stop.Time, &stop.StopOrder); err != nil {
			return nil, err
		}
		stopsByRoute[stop.RouteID] = append(stopsByRoute[stop.RouteID], stop)
	}
	return stopsByRoute, nil
}

func (r *Repository) CreateBusRoute(ctx context.Context, schoolID uuid.UUID, req CreateBusRouteRequest) (*BusRoute, error) {
	driverID, err := uuid.Parse(req.DriverStaffID)
	if err != nil {
		return nil, fmt.Errorf("invalid driver_staff_id")
	}

	driverName, driverPhone, err := r.getDriverInfo(ctx, driverID, schoolID)
	if err != nil {
		return nil, err
	}

	routeID := uuid.New()
	now := time.Now()

	insert := `
		INSERT INTO bus_routes (
			id, school_id, route_number, driver_staff_id, driver_name, driver_phone,
			vehicle_number, capacity, current_students, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`
	_, err = r.db.ExecResult(ctx, insert,
		routeID,
		schoolID,
		req.RouteNumber,
		driverID,
		driverName,
		driverPhone,
		req.VehicleNumber,
		req.Capacity,
		0,
		now,
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create bus route: %w", err)
	}

	if err := r.replaceStops(ctx, routeID, req.Stops); err != nil {
		return nil, err
	}

	return r.GetBusRoute(ctx, routeID, schoolID)
}

func (r *Repository) UpdateBusRoute(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID, req UpdateBusRouteRequest) (*BusRoute, error) {
	driverID, err := uuid.Parse(req.DriverStaffID)
	if err != nil {
		return nil, fmt.Errorf("invalid driver_staff_id")
	}

	driverName, driverPhone, err := r.getDriverInfo(ctx, driverID, schoolID)
	if err != nil {
		return nil, err
	}

	update := `
		UPDATE bus_routes
		SET route_number = $3,
			driver_staff_id = $4,
			driver_name = $5,
			driver_phone = $6,
			vehicle_number = $7,
			capacity = $8,
			updated_at = $9
		WHERE id = $1 AND school_id = $2
	`
	result, err := r.db.ExecResult(ctx, update,
		routeID,
		schoolID,
		req.RouteNumber,
		driverID,
		driverName,
		driverPhone,
		req.VehicleNumber,
		req.Capacity,
		time.Now(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update bus route: %w", err)
	}
	if result.RowsAffected() == 0 {
		return nil, ErrBusRouteNotFound
	}

	if err := r.replaceStops(ctx, routeID, req.Stops); err != nil {
		return nil, err
	}

	return r.GetBusRoute(ctx, routeID, schoolID)
}

func (r *Repository) DeleteBusRoute(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID) error {
	result, err := r.db.ExecResult(ctx, "DELETE FROM bus_routes WHERE id = $1 AND school_id = $2", routeID, schoolID)
	if err != nil {
		return fmt.Errorf("failed to delete bus route: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrBusRouteNotFound
	}
	return nil
}

func (r *Repository) GetBusRoute(ctx context.Context, routeID uuid.UUID, schoolID uuid.UUID) (*BusRoute, error) {
	query := `
		SELECT br.id, br.school_id, COALESCE(br.route_number, '') as route_number, br.driver_staff_id,
		       COALESCE(u.full_name, br.driver_name, '') as driver_name,
		       COALESCE(u.phone, br.driver_phone, '') as driver_phone,
		       COALESCE(br.vehicle_number, '') as vehicle_number, br.capacity, COALESCE(br.current_students, 0)
		FROM bus_routes br
		LEFT JOIN non_teaching_staff s ON br.driver_staff_id = s.id
		LEFT JOIN users u ON s.user_id = u.id
		WHERE br.id = $1 AND br.school_id = $2
	`

	var route BusRoute
	if err := r.db.QueryRow(ctx, query, routeID, schoolID).Scan(
		&route.ID,
		&route.SchoolID,
		&route.RouteNumber,
		&route.DriverStaffID,
		&route.DriverName,
		&route.DriverPhone,
		&route.VehicleNumber,
		&route.Capacity,
		&route.CurrentStudents,
	); err != nil {
		return nil, err
	}

	stops, err := r.getStopsForRoutes(ctx, []uuid.UUID{routeID}, "")
	if err != nil {
		return nil, err
	}
	route.Stops = stops[routeID]
	return &route, nil
}

func (r *Repository) replaceStops(ctx context.Context, routeID uuid.UUID, stops []BusStopInput) error {
	err := r.db.Exec(ctx, "DELETE FROM bus_stops WHERE route_id = $1", routeID)
	if err != nil {
		return fmt.Errorf("failed to clear bus stops: %w", err)
	}

	if len(stops) == 0 {
		return nil
	}

	insert := `
		INSERT INTO bus_stops (id, route_id, name, arrival_time, stop_order)
		VALUES ($1, $2, $3, NULLIF($4, '')::time, $5)
	`
	for i, stop := range stops {
		err := r.db.Exec(ctx, insert, uuid.New(), routeID, stop.Name, stop.Time, i+1)
		if err != nil {
			return fmt.Errorf("failed to insert bus stop: %w", err)
		}
	}
	return nil
}

func (r *Repository) ListBusRouteStops(ctx context.Context, routeID, schoolID uuid.UUID) ([]BusRouteStop, error) {
	const query = `
		SELECT id, school_id, route_id, sequence, stop_name, address, lat, lng, radius_meters, place_id, notes
		FROM bus_route_stops
		WHERE route_id = $1 AND school_id = $2
		ORDER BY sequence ASC
	`
	rows, err := r.db.Query(ctx, query, routeID, schoolID)
	if err != nil {
		return nil, fmt.Errorf("list bus route stops: %w", err)
	}
	defer rows.Close()

	items := make([]BusRouteStop, 0, 16)
	for rows.Next() {
		var item BusRouteStop
		if err := rows.Scan(
			&item.ID,
			&item.SchoolID,
			&item.RouteID,
			&item.Sequence,
			&item.StopName,
			&item.Address,
			&item.Lat,
			&item.Lng,
			&item.RadiusMeters,
			&item.PlaceID,
			&item.Notes,
		); err != nil {
			return nil, fmt.Errorf("scan bus route stop: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate bus route stops: %w", err)
	}
	return items, nil
}

func normalizeStopOptional(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizedRadiusMeters(value int) int {
	if value == 0 {
		return 80
	}
	if value < 30 {
		return 30
	}
	if value > 300 {
		return 300
	}
	return value
}

func (r *Repository) ReplaceBusRouteStops(ctx context.Context, routeID, schoolID uuid.UUID, stops []BusRouteStopInput) ([]BusRouteStop, error) {
	if len(stops) == 0 {
		return nil, fmt.Errorf("at least one stop is required")
	}

	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bus_routes WHERE id = $1 AND school_id = $2)`, routeID, schoolID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("validate route: %w", err)
	}
	if !exists {
		return nil, ErrBusRouteNotFound
	}

	if err := r.db.Exec(ctx, `DELETE FROM bus_route_stops WHERE route_id = $1 AND school_id = $2`, routeID, schoolID); err != nil {
		return nil, fmt.Errorf("clear route stops: %w", err)
	}

	insert := `
		INSERT INTO bus_route_stops (
			id, school_id, route_id, sequence, stop_name, address, lat, lng, radius_meters, place_id, notes, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
	`
	for i, stop := range stops {
		sequence := stop.Sequence
		if sequence <= 0 {
			sequence = i + 1
		}
		if err := r.db.Exec(
			ctx,
			insert,
			uuid.New(),
			schoolID,
			routeID,
			sequence,
			strings.TrimSpace(stop.StopName),
			normalizeStopOptional(stop.Address),
			stop.Lat,
			stop.Lng,
			normalizedRadiusMeters(stop.RadiusMeters),
			normalizeStopOptional(stop.PlaceID),
			normalizeStopOptional(stop.Notes),
		); err != nil {
			return nil, fmt.Errorf("insert route stop: %w", err)
		}
	}

	return r.ListBusRouteStops(ctx, routeID, schoolID)
}

func (r *Repository) UpsertBusRouteShape(ctx context.Context, routeID, schoolID uuid.UUID, req UpdateBusRouteShapeRequest) (*BusRouteShape, error) {
	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bus_routes WHERE id = $1 AND school_id = $2)`, routeID, schoolID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("validate route: %w", err)
	}
	if !exists {
		return nil, ErrBusRouteNotFound
	}

	err := r.db.Exec(ctx, `
		INSERT INTO bus_route_shapes (route_id, school_id, polyline, distance_m, duration_est, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		ON CONFLICT (route_id)
		DO UPDATE SET
			school_id = EXCLUDED.school_id,
			polyline = EXCLUDED.polyline,
			distance_m = EXCLUDED.distance_m,
			duration_est = EXCLUDED.duration_est,
			updated_at = NOW()
	`, routeID, schoolID, strings.TrimSpace(req.Polyline), req.DistanceM, req.DurationEst)
	if err != nil {
		return nil, fmt.Errorf("upsert route shape: %w", err)
	}

	shape := &BusRouteShape{RouteID: routeID, SchoolID: schoolID, Polyline: strings.TrimSpace(req.Polyline), DistanceM: req.DistanceM, DurationEst: req.DurationEst}
	return shape, nil
}

func normalizePickupOrDrop(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	switch trimmed {
	case "pickup", "drop", "both":
		return trimmed
	default:
		return "both"
	}
}

func (r *Repository) ListBusStopAssignments(ctx context.Context, routeID, schoolID uuid.UUID) ([]BusStopAssignment, error) {
	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bus_routes WHERE id = $1 AND school_id = $2)`, routeID, schoolID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("validate route: %w", err)
	}
	if !exists {
		return nil, ErrBusRouteNotFound
	}

	const query = `
		SELECT
			bsa.id,
			bsa.school_id,
			bsa.student_id,
			bsa.route_id,
			bsa.stop_id,
			bsa.pickup_or_drop,
			COALESCE(u.full_name, '') AS student_name,
			COALESCE(brs.stop_name, '') AS stop_name,
			COALESCE(brs.sequence, 0) AS sequence
		FROM bus_stop_assignments bsa
		JOIN students st ON st.id = bsa.student_id AND st.school_id = bsa.school_id
		JOIN users u ON u.id = st.user_id
		LEFT JOIN bus_route_stops brs ON brs.id = bsa.stop_id AND brs.school_id = bsa.school_id
		WHERE bsa.route_id = $1
		  AND bsa.school_id = $2
		ORDER BY brs.sequence ASC, u.full_name ASC
	`
	rows, err := r.db.Query(ctx, query, routeID, schoolID)
	if err != nil {
		return nil, fmt.Errorf("list bus stop assignments: %w", err)
	}
	defer rows.Close()

	items := make([]BusStopAssignment, 0, 32)
	for rows.Next() {
		var item BusStopAssignment
		if err := rows.Scan(
			&item.ID,
			&item.SchoolID,
			&item.StudentID,
			&item.RouteID,
			&item.StopID,
			&item.PickupOrDrop,
			&item.StudentName,
			&item.StopName,
			&item.Sequence,
		); err != nil {
			return nil, fmt.Errorf("scan bus stop assignment: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate bus stop assignments: %w", err)
	}
	return items, nil
}

func (r *Repository) ReplaceBusStopAssignments(ctx context.Context, routeID, schoolID uuid.UUID, items []BusStopAssignmentInput) ([]BusStopAssignment, error) {
	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bus_routes WHERE id = $1 AND school_id = $2)`, routeID, schoolID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("validate route: %w", err)
	}
	if !exists {
		return nil, ErrBusRouteNotFound
	}

	if err := r.db.Exec(ctx, `DELETE FROM bus_stop_assignments WHERE route_id = $1 AND school_id = $2`, routeID, schoolID); err != nil {
		return nil, fmt.Errorf("clear stop assignments: %w", err)
	}

	insert := `
		INSERT INTO bus_stop_assignments (
			id, school_id, student_id, route_id, stop_id, pickup_or_drop, created_at, updated_at
		)
		SELECT $1, $2, $3, $4, $5, $6, NOW(), NOW()
		WHERE EXISTS (
			SELECT 1 FROM students st
			WHERE st.id = $3 AND st.school_id = $2
		)
		AND EXISTS (
			SELECT 1 FROM bus_route_stops brs
			WHERE brs.id = $5 AND brs.route_id = $4 AND brs.school_id = $2
		)
	`

	for _, item := range items {
		studentID, err := uuid.Parse(strings.TrimSpace(item.StudentID))
		if err != nil {
			return nil, fmt.Errorf("invalid student_id: %s", item.StudentID)
		}
		stopID, err := uuid.Parse(strings.TrimSpace(item.StopID))
		if err != nil {
			return nil, fmt.Errorf("invalid stop_id: %s", item.StopID)
		}

		res, err := r.db.ExecResult(
			ctx,
			insert,
			uuid.New(),
			schoolID,
			studentID,
			routeID,
			stopID,
			normalizePickupOrDrop(item.PickupOrDrop),
		)
		if err != nil {
			return nil, fmt.Errorf("insert stop assignment: %w", err)
		}
		if res.RowsAffected() == 0 {
			return nil, fmt.Errorf("assignment student or stop invalid for this school/route")
		}
	}

	return r.ListBusStopAssignments(ctx, routeID, schoolID)
}
