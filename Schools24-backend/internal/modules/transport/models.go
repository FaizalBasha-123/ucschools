package transport

import "time"

// LocationPing is the JSON message the driver sends over WebSocket every ~5 seconds.
// All coordinate values use IEEE-754 float64 for WGS-84 decimal degree precision.
type LocationPing struct {
	Lat     float64 `json:"lat"`               // decimal degrees, WGS-84 (-90 to 90)
	Lng     float64 `json:"lng"`               // decimal degrees, WGS-84 (-180 to 180)
	Speed   float32 `json:"speed,omitempty"`   // km/h, optional
	Heading float32 `json:"heading,omitempty"` // degrees 0-360, optional
}

// LocationEvent is the payload stored in Valkey and streamed via SSE to watching clients.
// It is also the unit written to bus_location_history (batched every 30 seconds).
type LocationEvent struct {
	RouteID   string  `json:"route_id"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Speed     float32 `json:"speed"`
	Heading   float32 `json:"heading"`
	UpdatedAt int64   `json:"updated_at"` // Unix milliseconds
}

// Valkey key prefix for the latest bus position.
// Full key: busLocationKeyPrefix + routeID (UUID string)
// TTL: 35 seconds — slightly longer than the 5-second ping interval so a
// single missed ping doesn't incorrectly show as "offline".
const busLocationKeyPrefix = "bus:location:"

// trackingSessionKeyPrefix + schoolID → JSON(TrackingSession)
// Set by admin; TTL = ExpiresAt - now (vanishes automatically).
const trackingSessionKeyPrefix = "tracking:session:"

// trackingScheduleSuppressionKeyPrefix + schoolID -> JSON(TrackingScheduleSuppression)
// Used when an admin stops tracking during an active scheduled window.
const trackingScheduleSuppressionKeyPrefix = "tracking:schedule:suppressed:"

// MaxSessionDuration caps how long an admin can authorise in one click.
const MaxSessionDuration = 6 * time.Hour

// TrackingSession is stored in Valkey to let admins manually override the
// IST time-window restriction and allow drivers to broadcast GPS on demand.
type TrackingSession struct {
	StartedByID   string `json:"started_by_id"`   // admin user UUID
	StartedByName string `json:"started_by_name"` // display name for UI
	StartedAt     int64  `json:"started_at"`      // Unix ms
	ExpiresAt     int64  `json:"expires_at"`      // Unix ms
}

// TrackingScheduleSuppression temporarily disables a currently active schedule window.
// This lets admins stop tracking even if the session was activated by schedule.
type TrackingScheduleSuppression struct {
	ActivationID   string `json:"activation_id"`
	SuppressedByID string `json:"suppressed_by_id"`
	SuppressedBy   string `json:"suppressed_by"`
	SuppressedAt   int64  `json:"suppressed_at"`
	ExpiresAt      int64  `json:"expires_at"`
}

// TrackingSchedule defines a recurring school-specific tracking window in IST.
// Stored in the tenant schema, so schedule events are isolated per school.
type TrackingSchedule struct {
	ID        string `json:"id"`
	SchoolID  string `json:"school_id"`
	DayOfWeek int    `json:"day_of_week"` // 0=Sunday ... 6=Saturday (Go time.Weekday)
	Label     string `json:"label"`
	StartTime string `json:"start_time"` // HH:MM:SS
	EndTime   string `json:"end_time"`   // HH:MM:SS
	IsActive  bool   `json:"is_active"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

type TrackingScheduleUpsertRequest struct {
	DayOfWeek int    `json:"day_of_week" binding:"min=0,max=6"`
	Label     string `json:"label" binding:"required,min=2,max=120"`
	StartTime string `json:"start_time" binding:"required"`
	EndTime   string `json:"end_time" binding:"required"`
	IsActive  bool   `json:"is_active"`
}

// TrackingScheduleCreateRequest supports both legacy single-day creation and
// new multi-day creation from the admin UI.
//
// Accepted payload shapes:
//  1. Legacy: {"day_of_week": 1, ...}
//  2. Multi-day: {"day_of_weeks": [1,2,3], ...}
//  3. Everyday toggle: {"every_day": true, ...}
type TrackingScheduleCreateRequest struct {
	DayOfWeek  *int   `json:"day_of_week,omitempty"`
	DayOfWeeks []int  `json:"day_of_weeks,omitempty"`
	EveryDay   bool   `json:"every_day,omitempty"`
	Label      string `json:"label" binding:"required,min=2,max=120"`
	StartTime  string `json:"start_time" binding:"required"`
	EndTime    string `json:"end_time" binding:"required"`
	IsActive   bool   `json:"is_active"`
}

// SessionStatus is the public response for both admin and driver clients.
type SessionStatus struct {
	ManualActive     bool                    `json:"manual_active"`
	Session          *TrackingSession        `json:"session,omitempty"`
	TimeWindowActive bool                    `json:"time_window_active"`
	TrackingAllowed  bool                    `json:"tracking_allowed"` // manual OR scheduled window
	ScheduledActive  bool                    `json:"scheduled_active"`
	ActiveSchedule   *TrackingSchedule       `json:"active_schedule,omitempty"`
	TrackingSource   string                  `json:"tracking_source,omitempty"`
	ActivationID     string                  `json:"activation_id,omitempty"`
	ActivationStart  *int64                  `json:"activation_start,omitempty"`
	ActivationEnd    *int64                  `json:"activation_end,omitempty"`
	NextWindow       *UpcomingTrackingWindow `json:"next_window,omitempty"`
}

// UpcomingTrackingWindow tells the UI what the next scheduled tracking window is.
type UpcomingTrackingWindow struct {
	Schedule          *TrackingSchedule `json:"schedule,omitempty"`
	StartsAt          int64             `json:"starts_at"`
	EndsAt            int64             `json:"ends_at"`
	MinutesUntilStart int               `json:"minutes_until_start"`
}

// BusTripSession tracks a school route trip lifecycle tied to a tracking activation.
// started_at / ended_at use Unix milliseconds for consistency with existing session fields.
type BusTripSession struct {
	ID                       string `json:"id"`
	SchoolID                 string `json:"school_id"`
	RouteID                  string `json:"route_id"`
	DriverID                 string `json:"driver_id,omitempty"`
	ActivationID             string `json:"activation_id,omitempty"`
	StartedAt                int64  `json:"started_at"`
	EndedAt                  *int64 `json:"ended_at,omitempty"`
	CurrentStopSequence      int    `json:"current_stop_sequence"`
	LastNotifiedStopSequence int    `json:"last_notified_stop_sequence"`
}

// RouteActivityDay holds GPS activity statistics for a single calendar day (IST).
type RouteActivityDay struct {
	Day       string  `json:"day"`        // "YYYY-MM-DD" in IST local date
	Records   int     `json:"records"`    // number of 30-second history writes
	AvgSpeed  float32 `json:"avg_speed"`  // km/h average for the day
	MaxSpeed  float32 `json:"max_speed"`  // km/h maximum for the day
	FirstPing *int64  `json:"first_ping"` // Unix ms — earliest record of the day, nil if no data
	LastPing  *int64  `json:"last_ping"`  // Unix ms — latest record of the day, nil if no data
}

// ActiveRouteStop is a minimal projection of bus_route_stops used during the
// stop-arrival check in the driver WebSocket ping loop.
type ActiveRouteStop struct {
	ID           string  `db:"id"`
	Sequence     int     `db:"sequence"`
	StopName     string  `db:"stop_name"`
	Lat          float64 `db:"lat"`
	Lng          float64 `db:"lng"`
	RadiusMeters int     `db:"radius_meters"`
}

// RouteActivity is the 7-day tracking summary for one bus route.
// Returned by GET /api/v1/admin/transport/routes-activity.
type RouteActivity struct {
	RouteID       string             `json:"route_id"`
	RouteNumber   string             `json:"route_number"`
	VehicleNumber string             `json:"vehicle_number"`
	DriverName    string             `json:"driver_name"`
	TotalRecords  int                `json:"total_records"`
	ActiveDays    int                `json:"active_days"` // distinct IST calendar days with ≥1 record
	AvgSpeed      float32            `json:"avg_speed"`   // km/h, 0 if never tracked
	MaxSpeed      float32            `json:"max_speed"`   // km/h, 0 if never tracked
	LastSeen      *int64             `json:"last_seen"`   // Unix ms, nil if never tracked
	Daily         []RouteActivityDay `json:"daily"`       // latest day first, at most 7 entries
}

// RouteLiveStatus represents current GPS stream state for one driver route.
type RouteLiveStatus struct {
	RouteID       string   `json:"route_id"`
	RouteNumber   string   `json:"route_number"`
	VehicleNumber string   `json:"vehicle_number"`
	DriverName    string   `json:"driver_name"`
	Online        bool     `json:"online"`
	GPSInUse      bool     `json:"gps_in_use"`
	LastPingAt    *int64   `json:"last_ping_at"`
	Lat           *float64 `json:"lat,omitempty"`
	Lng           *float64 `json:"lng,omitempty"`
	Speed         *float32 `json:"speed,omitempty"`
	Heading       *float32 `json:"heading,omitempty"`
}

// FleetLiveStatus is streamed to admin clients for realtime status lights.
type FleetLiveStatus struct {
	UpdatedAt       int64             `json:"updated_at"`
	TrackingAllowed bool              `json:"tracking_allowed"`
	ManualActive    bool              `json:"manual_active"`
	ScheduledActive bool              `json:"scheduled_active"`
	ActiveSchedule  *TrackingSchedule `json:"active_schedule,omitempty"`
	TotalRoutes     int               `json:"total_routes"`
	OnlineRoutes    int               `json:"online_routes"`
	Routes          []RouteLiveStatus `json:"routes"`
}
