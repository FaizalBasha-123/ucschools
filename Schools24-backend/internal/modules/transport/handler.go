package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/schools24/backend/internal/shared/cache"
	"github.com/schools24/backend/internal/shared/middleware"
	"github.com/schools24/backend/internal/shared/natsclient"
)

const (
	// busLocationTTL is the Valkey key expiry for the live bus position.
	// Set to 35s: covers one missed 5-second ping before the key expires.
	busLocationTTL = 35 * time.Second

	// historyInterval is how often the last GPS fix is written to the DB.
	// Not every ping (5s) — only once per 30s into Valkey buffer.
	historyInterval = 30 * time.Second

	// routeHistoryBufferTTL keeps buffered records alive long enough to survive
	// temporary disconnects and be flushed later with minimal DB writes.
	routeHistoryBufferTTL = 8 * time.Hour

	// routeHistoryBufferMaxSamples caps in-cache memory per route.
	routeHistoryBufferMaxSamples = 2048

	// wsReadTimeout: max time to wait for the next message from the driver.
	// If no ping arrives within 15s (3 missed 5-second pings), the connection
	// is considered stale and closed.
	wsReadTimeout = 15 * time.Second

	// sseSendTimeout is added defensively; actual backpressure is handled
	// by the buffered channel in Hub.
	sseSendTimeout = 5 * time.Second
)

const routeHistoryBufferKeyPrefix = "bus:history_buffer:"

// istLoc is loaded once at startup for converting UTC timestamps to IST calendar dates.
var istLoc *time.Location

var (
	localScheduleNotifyMu   sync.Mutex
	localScheduleNotifySeen = map[string]int64{}
)

func init() {
	var err error
	istLoc, err = time.LoadLocation("Asia/Kolkata")
	if err != nil {
		istLoc = time.FixedZone("IST", 5*60*60+30*60) // UTC+05:30 fallback
	}
}

func claimLocalScheduleNotificationOnce(key string, ttl time.Duration, now time.Time) bool {
	if strings.TrimSpace(key) == "" {
		return false
	}
	expiresAt := now.Add(ttl).UnixMilli()
	nowMs := now.UnixMilli()

	localScheduleNotifyMu.Lock()
	defer localScheduleNotifyMu.Unlock()

	for k, exp := range localScheduleNotifySeen {
		if exp <= nowMs {
			delete(localScheduleNotifySeen, k)
		}
	}

	if exp, ok := localScheduleNotifySeen[key]; ok && exp > nowMs {
		return false
	}
	localScheduleNotifySeen[key] = expiresAt
	return true
}

// ── Stop-arrival engine ───────────────────────────────────────────────────────

// haversineMeters returns the great-circle distance in metres between two WGS84
// coordinate pairs. Using the haversine formula; accurate to ≈0.5% at city scale.
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6_371_000 // Earth radius in metres
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	dφ := (lat2 - lat1) * math.Pi / 180
	dλ := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dφ/2)*math.Sin(dφ/2) +
		math.Cos(φ1)*math.Cos(φ2)*math.Sin(dλ/2)*math.Sin(dλ/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// tripArrivalState holds per-WebSocket-connection state for the stop-arrival engine.
// It is NOT shared across goroutines; only the single ping-loop goroutine reads/writes it.
type tripArrivalState struct {
	session         *BusTripSession  // last-loaded active trip session (nil = needs reload)
	nextStop        *ActiveRouteStop // next expected stop to arrive at (nil = needs reload)
	pingsInsideStop int              // consecutive pings inside nextStop.RadiusMeters
	lastSessionLoad time.Time        // when session was last loaded from DB
}

// sessionRefreshInterval is how long we cache the trip session before re-reading from DB.
// Short enough to pick up sequence advances; long enough not to spam the DB.
const sessionRefreshInterval = 15 * time.Second

// minPingsForArrival is the number of consecutive pings inside a stop's radius
// required before we declare an arrival. Prevents single GPS jitter events.
const minPingsForArrival = 2

// processStopArrival is called on every valid GPS ping inside the DriverWebSocket loop.
// It checks whether the bus has arrived at the next expected route stop and, if so,
// records the event, advances the trip session, and notifies assigned students.
//
// All errors are logged as warnings — this must NEVER interrupt the GPS broadcast loop.
func (h *Handler) processStopArrival(ctx context.Context, schoolID, routeID uuid.UUID, lat, lng float64, state *tripArrivalState) {
	// ── Refresh session from DB when stale or missing ─────────────────────────
	if state.session == nil || time.Since(state.lastSessionLoad) > sessionRefreshInterval {
		sess, err := h.repo.GetActiveTripSession(tenantCtx(ctx, schoolID), schoolID, routeID)
		if err != nil {
			log.Printf("transport: stop-arrival: load session (route=%s): %v", routeID, err)
			return
		}
		state.session = sess
		state.lastSessionLoad = time.Now()
		state.nextStop = nil // force reload of next stop after session refresh
	}
	if state.session == nil {
		// No active trip session — route hasn't been activated yet.
		return
	}

	// ── Refresh next stop when stale or missing ───────────────────────────────
	if state.nextStop == nil {
		stop, err := h.repo.GetNextBusRouteStop(tenantCtx(ctx, schoolID), schoolID, routeID, state.session.CurrentStopSequence)
		if err != nil {
			log.Printf("transport: stop-arrival: load next stop (route=%s seq=%d): %v", routeID, state.session.CurrentStopSequence, err)
			return
		}
		state.nextStop = stop
		state.pingsInsideStop = 0
	}
	if state.nextStop == nil {
		// All stops reached or no stops configured.
		return
	}

	// ── Check whether the bus is inside the stop's arrival radius ────────────
	dist := haversineMeters(lat, lng, state.nextStop.Lat, state.nextStop.Lng)
	if dist > float64(state.nextStop.RadiusMeters) {
		state.pingsInsideStop = 0
		return
	}
	state.pingsInsideStop++
	if state.pingsInsideStop < minPingsForArrival {
		return
	}

	// ── Arrival confirmed — record and notify ─────────────────────────────────
	stopID := state.nextStop.ID
	seq := state.nextStop.Sequence
	reachedAt := time.Now().UnixMilli()

	if err := h.repo.RecordStopArrival(tenantCtx(ctx, schoolID), schoolID, state.session.ID, stopID, seq, reachedAt); err != nil {
		log.Printf("transport: stop-arrival: record arrival (route=%s stop=%s seq=%d): %v", routeID, stopID, seq, err)
		// Don't return — still attempt notification if record fails idempotently.
	}

	// Notify students assigned to this stop.
	stopUUID, uErr := uuid.Parse(stopID)
	if uErr == nil && h.notify != nil {
		tokens, tErr := h.repo.GetStopAssignedPushTokens(tenantCtx(ctx, schoolID), schoolID, stopUUID)
		if tErr != nil {
			log.Printf("transport: stop-arrival: get tokens (stop=%s): %v", stopID, tErr)
		} else if len(tokens) > 0 {
			title := "Bus arriving at your stop"
			body := fmt.Sprintf("Bus is approaching %s. Please get ready.", state.nextStop.StopName)
			if err := h.notify(ctx, tokens, title, body, map[string]string{
				"type":     "stop_arrival",
				"stop_id":  stopID,
				"route_id": routeID.String(),
				"sequence": fmt.Sprintf("%d", seq),
			}); err != nil {
				log.Printf("transport: stop-arrival: notify (stop=%s): %v", stopID, err)
			}
		}
	}

	// Reset state so next iteration loads the new next stop.
	state.pingsInsideStop = 0
	state.nextStop = nil
	state.session = nil // force reload to get updated CurrentStopSequence
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  512,
	WriteBufferSize: 256,
	// Allow connections from the Schools24 domains and local dev.
	// Native apps send no Origin header — that case is allowed explicitly.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // native app — no browser Origin
		}
		return strings.HasSuffix(origin, ".schools24.in") ||
			strings.HasPrefix(origin, "http://localhost") ||
			strings.HasPrefix(origin, "http://127.0.0.1")
	},
}

// Handler wires together the transport repository, in-memory hub, Valkey cache,
// and NATS JetStream for low-latency GPS fan-out and session events.
type Handler struct {
	repo             *Repository
	hub              *Hub
	cache            *cache.Cache
	nats             *natsclient.Client
	jwtSecret        string
	sessionValidator func(context.Context, *middleware.Claims) error
	notify           func(context.Context, []string, string, string, map[string]string) error
}

// NewHandler constructs the transport Handler.
// Pass natsClient from main.go (may be disabled no-op when NATS_URL is unset).
func NewHandler(repo *Repository, hub *Hub, c *cache.Cache, natsClient *natsclient.Client, jwtSecret string, sessionValidator func(context.Context, *middleware.Claims) error, notify func(context.Context, []string, string, string, map[string]string) error) *Handler {
	return &Handler{repo: repo, hub: hub, cache: c, nats: natsClient, jwtSecret: jwtSecret, sessionValidator: sessionValidator, notify: notify}
}

func (h *Handler) notifyBusStudentsTrackingLive(ctx context.Context, schoolID uuid.UUID, reason string) {
	if h.notify == nil {
		return
	}
	tokens, err := h.repo.GetBusStudentPushTokens(tenantCtx(ctx, schoolID), schoolID)
	if err != nil {
		log.Printf("transport: failed to load bus-student push tokens for school %s: %v", schoolID, err)
		return
	}
	if len(tokens) == 0 {
		return
	}
	title := "Bus tracking is now live"
	body := "Tap to view your assigned school bus in real time."
	if strings.TrimSpace(reason) != "" {
		body = reason
	}
	extra := map[string]string{
		"kind":     "transport_live",
		"deeplink": "/student/bus-route",
	}
	if err := h.notify(ctx, tokens, title, body, extra); err != nil {
		log.Printf("transport: failed to send tracking-live push for school %s: %v", schoolID, err)
	}
}

func (h *Handler) notifyAssignedDriversTrackingState(ctx context.Context, schoolID uuid.UUID, status SessionStatus, enabled bool) {
	if h.notify == nil {
		return
	}
	tokens, err := h.repo.GetAssignedDriverPushTokens(tenantCtx(ctx, schoolID), schoolID)
	if err != nil {
		log.Printf("transport: failed to load driver push tokens for school %s: %v", schoolID, err)
		return
	}
	if len(tokens) == 0 {
		return
	}

	title := "Bus tracking update"
	body := "Open the driver tracking screen."
	extra := map[string]string{
		"deeplink": "/driver/tracking",
	}
	if enabled {
		title = "Start bus tracking"
		extra["kind"] = "transport_driver_start"
		extra["activation_id"] = status.ActivationID
		if status.TrackingSource == "scheduled" && status.ActiveSchedule != nil {
			body = fmt.Sprintf("%s is live now. Open the app to start sending GPS from this device.", strings.TrimSpace(status.ActiveSchedule.Label))
			extra["source"] = "scheduled"
		} else {
			body = "School admin started bus tracking. Open the app to start sending GPS from this device."
			extra["source"] = "manual"
		}
	} else {
		title = "Stop bus tracking"
		body = "Tracking has been stopped for now. This device should stop sending GPS."
		extra["kind"] = "transport_driver_stop"
	}

	if err := h.notify(ctx, tokens, title, body, extra); err != nil {
		log.Printf("transport: failed to send driver tracking push for school %s: %v", schoolID, err)
	}
}

func (h *Handler) notifyScheduledStartOnce(ctx context.Context, schoolID uuid.UUID, schedule *TrackingSchedule, now time.Time) {
	if schedule == nil {
		return
	}
	key := fmt.Sprintf("tracking:notify:schedule:%s:%s:%s", schoolID.String(), schedule.ID, now.In(IST).Format("20060102"))
	endClock, err := parseClock(schedule.EndTime)
	if err != nil {
		log.Printf("transport: invalid schedule end time for notification (%s): %v", schedule.ID, err)
		return
	}
	nowIST := now.In(IST)
	endAt := time.Date(nowIST.Year(), nowIST.Month(), nowIST.Day(), endClock.Hour(), endClock.Minute(), endClock.Second(), 0, IST)
	ttl := time.Until(endAt.Add(5 * time.Minute))
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}

	if h.cache != nil && h.cache.IsEnabled() {
		claimed, claimErr := h.cache.SetIfNotExists(ctx, key, "sent", ttl)
		if claimErr != nil {
			log.Printf("transport: schedule notification dedupe claim failed for school %s: %v", schoolID, claimErr)
			return
		}
		if !claimed {
			return
		}
	} else {
		if !claimLocalScheduleNotificationOnce(key, ttl, now) {
			return
		}
	}

	reason := fmt.Sprintf("%s is now live. Tap to view your assigned bus in real time.", strings.TrimSpace(schedule.Label))
	status := GetSessionStatus(tenantCtx(ctx, schoolID), h.cache, h.repo, schoolID)
	h.notifyAssignedDriversTrackingState(ctx, schoolID, status, true)
	h.notifyBusStudentsTrackingLive(ctx, schoolID, reason)
}

func routeHistoryBufferKey(schoolID, routeID uuid.UUID) string {
	return fmt.Sprintf("%s%s:%s", routeHistoryBufferKeyPrefix, schoolID.String(), routeID.String())
}

func routeHistoryBufferPrefixForSchool(schoolID uuid.UUID) string {
	return fmt.Sprintf("%s%s:", routeHistoryBufferKeyPrefix, schoolID.String())
}

func routeIDFromHistoryBufferKey(key string) (uuid.UUID, error) {
	idx := strings.LastIndex(key, ":")
	if idx < 0 || idx == len(key)-1 {
		return uuid.Nil, fmt.Errorf("invalid history buffer key")
	}
	return uuid.Parse(key[idx+1:])
}

func (h *Handler) appendRouteHistorySample(ctx context.Context, schoolID, routeID uuid.UUID, sample LocationEvent) error {
	if h.cache == nil || !h.cache.IsEnabled() {
		return h.repo.InsertLocationHistory(tenantCtx(ctx, schoolID), schoolID, routeID, sample.Lat, sample.Lng, sample.Speed, sample.Heading)
	}

	key := routeHistoryBufferKey(schoolID, routeID)
	buffer := make([]LocationEvent, 0, 64)
	if err := h.cache.GetJSON(ctx, key, &buffer); err != nil {
		buffer = make([]LocationEvent, 0, 64)
	}

	buffer = append(buffer, sample)
	if len(buffer) > routeHistoryBufferMaxSamples {
		buffer = buffer[len(buffer)-routeHistoryBufferMaxSamples:]
	}

	if err := h.cache.SetJSON(ctx, key, buffer, routeHistoryBufferTTL); err != nil {
		if dbErr := h.repo.InsertLocationHistory(tenantCtx(ctx, schoolID), schoolID, routeID, sample.Lat, sample.Lng, sample.Speed, sample.Heading); dbErr != nil {
			return fmt.Errorf("cache history buffer write failed: %w (fallback db write failed: %v)", err, dbErr)
		}
		return nil
	}
	return nil
}

func (h *Handler) flushRouteHistoryBuffer(ctx context.Context, schoolID, routeID uuid.UUID) error {
	if h.cache == nil || !h.cache.IsEnabled() {
		return nil
	}

	key := routeHistoryBufferKey(schoolID, routeID)
	buffer := make([]LocationEvent, 0, 64)
	if err := h.cache.GetJSON(ctx, key, &buffer); err != nil {
		return nil
	}
	if len(buffer) == 0 {
		_ = h.cache.Delete(ctx, key)
		return nil
	}

	if err := h.repo.InsertLocationHistoryBatch(tenantCtx(ctx, schoolID), schoolID, routeID, buffer); err != nil {
		return err
	}
	if err := h.cache.Delete(ctx, key); err != nil {
		return fmt.Errorf("cache history buffer cleanup failed: %w", err)
	}
	return nil
}

func (h *Handler) flushSchoolHistoryBuffers(ctx context.Context, schoolID uuid.UUID) error {
	if h.cache == nil || !h.cache.IsEnabled() {
		return nil
	}

	keys, err := h.cache.ListKeysByPrefix(ctx, routeHistoryBufferPrefixForSchool(schoolID))
	if err != nil {
		return err
	}

	for _, key := range keys {
		routeID, parseErr := routeIDFromHistoryBufferKey(key)
		if parseErr != nil {
			continue
		}
		if flushErr := h.flushRouteHistoryBuffer(ctx, schoolID, routeID); flushErr != nil {
			log.Printf("transport: flush school buffer failed (school=%s route=%s): %v", schoolID, routeID, flushErr)
		}
	}
	return nil
}

// FlushStaleRouteHistoryBuffers flushes route buffers whose live key is absent,
// indicating the driver stream is offline and DB persistence can happen now.
func (h *Handler) FlushStaleRouteHistoryBuffers(ctx context.Context, schoolID uuid.UUID) {
	if h.cache == nil || !h.cache.IsEnabled() {
		return
	}
	keys, err := h.cache.ListKeysByPrefix(ctx, routeHistoryBufferPrefixForSchool(schoolID))
	if err != nil {
		log.Printf("transport: stale-buffer scan failed for school %s: %v", schoolID, err)
		return
	}
	for _, key := range keys {
		routeID, parseErr := routeIDFromHistoryBufferKey(key)
		if parseErr != nil {
			continue
		}
		if _, getErr := h.cache.Get(ctx, busLocationKeyPrefix+routeID.String()); getErr == nil {
			continue
		}
		if flushErr := h.flushRouteHistoryBuffer(ctx, schoolID, routeID); flushErr != nil {
			log.Printf("transport: stale-buffer flush failed (school=%s route=%s): %v", schoolID, routeID, flushErr)
		}
	}
}

func (h *Handler) ProcessScheduledStartNotifications(ctx context.Context, schoolID uuid.UUID, now time.Time) {
	tCtx := tenantCtx(ctx, schoolID)
	tCtx = context.WithValue(tCtx, "skip_manual_db_fallback", true)
	status := GetSessionStatus(tCtx, h.cache, h.repo, schoolID)
	if status.ManualActive || !status.ScheduledActive || status.ActiveSchedule == nil {
		return
	}
	h.notifyScheduledStartOnce(ctx, schoolID, status.ActiveSchedule, now)
}

// validateToken extracts and validates the JWT/ticket from the HTTP request.
// Checks a short-lived ?ticket= first, then Authorization: Bearer <token>, then legacy ?token=.
func (h *Handler) validateToken(r *http.Request) (*middleware.Claims, error) {
	validate := func(token string) (*middleware.Claims, error) {
		claims, err := middleware.ValidateToken(token, h.jwtSecret)
		if err != nil {
			return nil, err
		}
		if h.sessionValidator != nil {
			if err := h.sessionValidator(r.Context(), claims); err != nil {
				return nil, err
			}
		}
		return claims, nil
	}
	if ticket := strings.TrimSpace(r.URL.Query().Get("ticket")); ticket != "" {
		return validate(ticket)
	}
	if raw := r.Header.Get("Authorization"); raw != "" {
		parts := strings.SplitN(raw, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
			return validate(parts[1])
		}
	}
	if token := r.URL.Query().Get("token"); token != "" {
		return validate(token)
	}
	return nil, fmt.Errorf("no JWT provided (Authorization header or ?token= required)")
}

// tenantCtx attaches the school's tenant schema to a context so PostgresDB
// applies the right search_path — same logic as middleware.TenantMiddleware.
func tenantCtx(parent context.Context, schoolID uuid.UUID) context.Context {
	schema := fmt.Sprintf(`"school_%s"`, schoolID.String())
	return context.WithValue(parent, "tenant_schema", schema)
}

func (h *Handler) buildFleetLiveStatus(ctx context.Context, schoolID uuid.UUID) (FleetLiveStatus, error) {
	status := GetSessionStatus(tenantCtx(ctx, schoolID), h.cache, h.repo, schoolID)
	routes, err := h.repo.ListRoutesForLiveStatus(tenantCtx(ctx, schoolID), schoolID)
	if err != nil {
		return FleetLiveStatus{}, err
	}

	nowMs := time.Now().UnixMilli()
	onlineCount := 0
	for i := range routes {
		raw, getErr := h.cache.Get(ctx, busLocationKeyPrefix+routes[i].RouteID)
		if getErr != nil || strings.TrimSpace(raw) == "" {
			continue
		}
		var ev LocationEvent
		if err := json.Unmarshal([]byte(raw), &ev); err != nil {
			continue
		}
		last := ev.UpdatedAt
		routes[i].LastPingAt = &last
		lat := ev.Lat
		lng := ev.Lng
		speed := ev.Speed
		heading := ev.Heading
		routes[i].Lat = &lat
		routes[i].Lng = &lng
		routes[i].Speed = &speed
		routes[i].Heading = &heading
		isOnline := nowMs-last <= int64(busLocationTTL/time.Millisecond)
		routes[i].Online = isOnline
		routes[i].GPSInUse = isOnline
		if isOnline {
			onlineCount++
		}
	}

	return FleetLiveStatus{
		UpdatedAt:       nowMs,
		TrackingAllowed: status.TrackingAllowed,
		ManualActive:    status.ManualActive,
		ScheduledActive: status.ScheduledActive,
		ActiveSchedule:  status.ActiveSchedule,
		TotalRoutes:     len(routes),
		OnlineRoutes:    onlineCount,
		Routes:          routes,
	}, nil
}

// AdminLiveStatusWebSocket streams realtime route online/offline state for the
// admin Bus Tracking page (green/gray status lights + active GPS devices list).
//
// URL: GET /api/v1/transport/admin-live/ws?ticket=<short-lived ws ticket>
// Scope: transport_read
// Role: admin or super_admin
func (h *Handler) AdminLiveStatusWebSocket(c *gin.Context) {
	claims, err := h.validateToken(c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": err.Error()})
		return
	}
	if claims.WSScope != "" && claims.WSScope != "transport_read" {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
		return
	}
	if claims.Role != "admin" && claims.Role != "super_admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	schoolID, err := uuid.Parse(claims.SchoolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}

	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.Header("Connection", "Upgrade")
		c.Header("Upgrade", "websocket")
		c.JSON(http.StatusUpgradeRequired, gin.H{"error": "websocket_upgrade_required"})
		return
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("transport: admin live-status WS upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Read loop to consume control frames and detect remote close quickly.
	go func() {
		for {
			if _, _, readErr := conn.ReadMessage(); readErr != nil {
				_ = conn.Close()
				return
			}
		}
	}()

	send := func() error {
		if h.sessionValidator != nil {
			if err := h.sessionValidator(context.Background(), claims); err != nil {
				return err
			}
		}
		payload, err := h.buildFleetLiveStatus(context.Background(), schoolID)
		if err != nil {
			return err
		}
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(payload)
	}

	if err := send(); err != nil {
		log.Printf("transport: admin live-status initial send failed: %v", err)
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if err := send(); err != nil {
			log.Printf("transport: admin live-status stream closed: %v", err)
			return
		}
	}
}

// DriverWebSocket handles the WebSocket GPS feed from an active driver.
//
// URL:  GET /api/v1/transport/driver/ws
// Auth: staff role — Authorization: Bearer <jwt>  OR  short-lived ?ticket=<jwt>  OR  legacy ?token=<jwt>
//
// Protocol (driver → server):
//
//	{"lat": 12.971598, "lng": 77.594562, "speed": 45.2, "heading": 270.0}
//
// Protocol (server → driver):
//
//	{"status": "ack"}               — every accepted ping
//	{"error": "invalid_coordinates"} — bad ping, connection remains open
//	{"error": "outside_tracking_window"} — window ended, connection will close
//
// The driver should send a ping every 5 seconds. If the server receives nothing
// for 15 seconds (wsReadTimeout), it closes the connection.
func (h *Handler) DriverWebSocket(c *gin.Context) {
	// ── 1. Authenticate ──────────────────────────────────────────────────────
	claims, err := h.validateToken(c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": err.Error()})
		return
	}
	if claims.WSScope != "" && claims.WSScope != "driver_tracking" {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
		return
	}
	if claims.Role != "staff" {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "only staff (driver) accounts can broadcast GPS",
		})
		return
	}

	userID, err := uuid.Parse(claims.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	schoolID, err := uuid.Parse(claims.SchoolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}

	// ── 2. Enforce tracking window (school schedule OR admin manual override) ────
	status := GetSessionStatus(tenantCtx(c.Request.Context(), schoolID), h.cache, h.repo, schoolID)
	if !status.TrackingAllowed {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "outside_tracking_window",
			"message": "GPS broadcasting is only permitted during the school-configured schedule or when an admin has manually activated tracking",
		})
		return
	}

	// ── 3. Resolve assigned route from DB ─────────────────────────────────────
	dbCtx := tenantCtx(c.Request.Context(), schoolID)
	routeID, err := h.repo.GetAssignedRouteID(dbCtx, userID, schoolID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "no_route_assigned",
			"message": "this staff account is not assigned as a driver on any bus route",
		})
		return
	}
	routeKey := busLocationKeyPrefix + routeID.String()

	// ── 4. Upgrade to WebSocket ───────────────────────────────────────────────
	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.Header("Connection", "Upgrade")
		c.Header("Upgrade", "websocket")
		c.JSON(http.StatusUpgradeRequired, gin.H{"error": "websocket_upgrade_required"})
		return
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		// Upgrade writes an HTTP error response on failure; just log it.
		log.Printf("transport: WS upgrade failed (driver %s, route %s): %v", userID, routeID, err)
		return
	}
	defer func() {
		conn.Close()
		if err := h.flushRouteHistoryBuffer(context.Background(), schoolID, routeID); err != nil {
			log.Printf("transport: history flush error on disconnect (route %s): %v", routeID, err)
		}
		// Delete last-known position so clients immediately see the bus as offline.
		_ = h.cache.Delete(context.Background(), routeKey)
		log.Printf("transport: driver %s disconnected from route %s", userID, routeID)
	}()

	log.Printf("transport: driver %s connected to route %s", userID, routeID)

	var lastBufferedAt time.Time
	arrivalState := &tripArrivalState{} // per-connection stop-arrival tracking state

	// ── 6. Main WebSocket read loop ───────────────────────────────────────────
	conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	})

	ack := []byte(`{"status":"ack"}`)

	for {
		if h.sessionValidator != nil {
			if err := h.sessionValidator(context.Background(), claims); err != nil {
				_ = conn.WriteControl(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "session_revoked"),
					time.Now().Add(2*time.Second),
				)
				break
			}
		}

		// Re-check tracking permission on every ping.
		status := GetSessionStatus(tenantCtx(context.Background(), schoolID), h.cache, h.repo, schoolID)
		if !status.TrackingAllowed {
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "outside_tracking_window"),
				time.Now().Add(2*time.Second),
			)
			break
		}

		_, msg, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("transport: unexpected WS close (route %s): %v", routeID, err)
			}
			break
		}
		conn.SetReadDeadline(time.Now().Add(wsReadTimeout))

		var ping LocationPing
		if err := json.Unmarshal(msg, &ping); err != nil {
			_ = conn.WriteJSON(gin.H{"error": "invalid_payload", "message": "expected JSON LocationPing"})
			continue
		}

		// Coordinate bounds validation — prevents garbage from polluting the map.
		if ping.Lat < -90 || ping.Lat > 90 || ping.Lng < -180 || ping.Lng > 180 {
			_ = conn.WriteJSON(gin.H{"error": "invalid_coordinates"})
			continue
		}
		// Junk speed/heading guard
		if ping.Speed < 0 {
			ping.Speed = 0
		}
		if ping.Heading < 0 {
			ping.Heading = 0
		} else if ping.Heading > 360 {
			ping.Heading = float32(int(ping.Heading) % 360)
		}

		event := LocationEvent{
			RouteID:   routeID.String(),
			Lat:       ping.Lat,
			Lng:       ping.Lng,
			Speed:     ping.Speed,
			Heading:   ping.Heading,
			UpdatedAt: time.Now().UnixMilli(),
		}
		payload, _ := json.Marshal(event)

		// ── Publish GPS event ─────────────────────────────────────────────────
		// Primary path: NATS JetStream (sub-millisecond, fan-out to SSE consumers
		// and JetStream last-value cache for new subscribers).
		// Fallback: Valkey last-position key (used when NATS is unavailable).
		if h.nats.IsEnabled() {
			h.nats.PublishGPSCore(schoolID.String(), routeID.String(), payload)
		} else {
			// Valkey fallback — keeps last position alive for SSE cold-connect.
			_ = h.cache.Set(context.Background(), routeKey, string(payload), busLocationTTL)
		}

		// In-memory Hub fan-out (zero-allocation for same-process SSE clients).
		// Still used as safety net when NATS is unavailable.
		h.hub.Broadcast(routeID.String(), payload)

		if lastBufferedAt.IsZero() || time.Since(lastBufferedAt) >= historyInterval {
			if err := h.appendRouteHistorySample(context.Background(), schoolID, routeID, event); err != nil {
				log.Printf("transport: history buffer append error (route %s): %v", routeID, err)
			}
			lastBufferedAt = time.Now()
		}

		// ── Stop-arrival engine ───────────────────────────────────────────────
		// Runs synchronously but is guarded internally; never breaks the ping loop.
		h.processStopArrival(context.Background(), schoolID, routeID, ping.Lat, ping.Lng, arrivalState)

		_ = conn.WriteMessage(websocket.TextMessage, ack)
	}
}

// TrackRoute streams live bus location to a parent/student via Server-Sent Events.
//
// URL:  GET /api/v1/transport/track/:routeID
// Auth: student, admin, or super_admin role — Authorization: Bearer <jwt>  OR  short-lived ?ticket=<jwt>  OR  legacy ?token=<jwt>
//
// Access control:
//   - student:     only their own assigned bus route (students.bus_route_id)
//   - admin:       any route within their school
//   - super_admin: any route within the school in their JWT claims
//
// SSE event types:
//
//	event: location   data: <LocationEvent JSON>  — emitted on each driver ping
//	event: connected  data: {"route_id":"...","status":"offline"}  — no driver active
//	: keepalive                                    — comment line every 25s to prevent proxy timeout
//
// The client-side should handle absence of location events for >35 seconds as
// "bus offline" (Valkey TTL expired = driver disconnected).
func (h *Handler) TrackRoute(c *gin.Context) {
	// ── 1. Authenticate ──────────────────────────────────────────────────────
	claims, err := h.validateToken(c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": err.Error()})
		return
	}
	if claims.WSScope != "" && claims.WSScope != "transport_read" {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
		return
	}

	userID, _ := uuid.Parse(claims.UserID)
	schoolID, err := uuid.Parse(claims.SchoolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}

	routeID, err := uuid.Parse(c.Param("routeID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_route_id", "message": "routeID must be a valid UUID"})
		return
	}

	dbCtx := tenantCtx(c.Request.Context(), schoolID)

	// ── 2. Role-based authorisation ──────────────────────────────────────────
	switch claims.Role {
	case "student":
		assignedRoute, err := h.repo.GetStudentRouteID(dbCtx, userID, schoolID)
		if err != nil || assignedRoute != routeID {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "you are not assigned to this bus route",
			})
			return
		}
	case "admin", "super_admin":
		ok, err := h.repo.BusRouteExists(dbCtx, routeID, schoolID)
		if err != nil || !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "route_not_found"})
			return
		}
	default:
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "only students and admins can track bus routes",
		})
		return
	}

	// ── 3. Subscribe to live GPS events ──────────────────────────────────────
	// Primary path: NATS JetStream core-subscribe — every GPS ping is published on
	// the same subject, so this is a true push subscription with sub-ms delivery.
	// Fallback: in-memory Hub (used when NATS is unavailable).
	var eventCh <-chan []byte
	var cancelSub func()
	if h.nats.IsEnabled() {
		natsCh, natsCancel, err := h.nats.SubscribeGPSRoute(c.Request.Context(), schoolID.String(), routeID.String())
		if err != nil {
			log.Printf("transport: NATS subscribe failed, falling back to Hub (route %s): %v", routeID, err)
			_, hubCh, hubCancel := h.hub.Subscribe(routeID.String())
			eventCh = hubCh
			cancelSub = hubCancel
		} else {
			eventCh = natsCh
			cancelSub = natsCancel
		}
	} else {
		_, hubCh, hubCancel := h.hub.Subscribe(routeID.String())
		eventCh = hubCh
		cancelSub = hubCancel
	}
	defer cancelSub()

	connID := fmt.Sprintf("%s#nats", routeID.String())
	log.Printf("transport: SSE client %s subscribed to route %s (role: %s, nats: %v)",
		connID, routeID, claims.Role, h.nats.IsEnabled())
	defer log.Printf("transport: SSE client %s left route %s", connID, routeID)

	// ── 4. Set SSE response headers ───────────────────────────────────────────
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache, no-store")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // prevents Nginx from buffering SSE chunks

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming_not_supported"})
		return
	}

	// ── 5. Send last-known position immediately on connect ──────────────────
	// Resolves in this priority: NATS JetStream last-value → Valkey → offline.
	routeKey := busLocationKeyPrefix + routeID.String()
	var sentInitial bool
	if h.nats.IsEnabled() {
		if lastPos, err := h.nats.GetLastGPSPosition(c.Request.Context(), schoolID.String(), routeID.String()); err == nil && len(lastPos) > 0 {
			fmt.Fprintf(c.Writer, "event: location\ndata: %s\n\n", lastPos)
			sentInitial = true
		}
	}
	if !sentInitial {
		if lastPos, err := h.cache.Get(context.Background(), routeKey); err == nil {
			fmt.Fprintf(c.Writer, "event: location\ndata: %s\n\n", lastPos)
		} else {
			fmt.Fprintf(c.Writer, "event: connected\ndata: {\"route_id\":%q,\"status\":\"offline\"}\n\n",
				routeID.String())
		}
	}
	flusher.Flush()

	// ── 6. Stream loop ────────────────────────────────────────────────────────
	clientGone := c.Request.Context().Done()
	keepalive := time.NewTicker(25 * time.Second) // < typical 30s proxy idle timeout
	defer keepalive.Stop()

	for {
		select {
		case <-clientGone:
			// Browser/app closed the connection.
			return

		case data, ok := <-eventCh:
			if !ok {
				return
			}
			fmt.Fprintf(c.Writer, "event: location\ndata: %s\n\n", data)
			flusher.Flush()

		case <-keepalive.C:
			if h.sessionValidator != nil {
				if err := h.sessionValidator(context.Background(), claims); err != nil {
					return
				}
			}
			// SSE comment lines are ignored by EventSource but keep the TCP connection alive.
			fmt.Fprintf(c.Writer, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// GetRoutesActivity returns 7-day GPS tracking statistics for every bus route in
// the admin's school. This endpoint sits inside the protected admin route group so
// TenantMiddleware has already set tenant_schema on c.Request.Context() before this
// handler runs — no need to call tenantCtx() manually.
//
// During a live tracking session, GPS samples are buffered in Valkey and not yet
// written to bus_location_history. mergeActivityFromRedisBuffer folds those
// in-flight samples in so the admin always sees real-time counts.
//
// URL:  GET /api/v1/admin/transport/routes-activity
// Auth: admin or super_admin (enforced by RequireRole middleware on the admin group)
// Response: {"routes": [RouteActivity]}
func (h *Handler) GetRoutesActivity(c *gin.Context) {
	activities, err := h.repo.GetAllRoutesActivity(c.Request.Context())
	if err != nil {
		log.Printf("transport: GetRoutesActivity error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch activity data"})
		return
	}

	// Merge any GPS samples still buffered in Valkey (not yet flushed to DB)
	// so the admin sees live counts during an active session.
	if h.cache != nil && h.cache.IsEnabled() {
		schoolIDVal, _ := c.Get("school_id")
		if schoolID, parseErr := uuid.Parse(fmt.Sprintf("%v", schoolIDVal)); parseErr == nil {
			h.mergeActivityFromRedisBuffer(c.Request.Context(), schoolID, activities)
		}
	}

	c.JSON(http.StatusOK, gin.H{"routes": activities})
}

// mergeActivityFromRedisBuffer folds GPS samples that are still in the Valkey
// history buffer (written every 30 s but not yet flushed to DB on disconnect)
// into the pre-computed DB activity rows.  This gives the admin real-time record
// counts and speed stats while a session is live.
func (h *Handler) mergeActivityFromRedisBuffer(ctx context.Context, schoolID uuid.UUID, activities []RouteActivity) {
	// Build a fast lookup: routeID string → slice index
	idxMap := make(map[string]int, len(activities))
	for i, a := range activities {
		idxMap[a.RouteID] = i
	}

	keys, err := h.cache.ListKeysByPrefix(ctx, routeHistoryBufferPrefixForSchool(schoolID))
	if err != nil || len(keys) == 0 {
		return
	}

	for _, key := range keys {
		routeID, err := routeIDFromHistoryBufferKey(key)
		if err != nil {
			continue
		}

		var buffer []LocationEvent
		if err := h.cache.GetJSON(ctx, key, &buffer); err != nil || len(buffer) == 0 {
			continue
		}

		idx, ok := idxMap[routeID.String()]
		if !ok {
			continue
		}
		route := &activities[idx]

		// Aggregation struct for per-day breakdown
		type dayAgg struct {
			records   int
			speedSum  float64
			maxSpeed  float32
			firstPing int64 // 0 = unset
			lastPing  int64
		}

		// Seed daily map from DB data already in the route
		dayMap := make(map[string]*dayAgg, len(route.Daily)+2)
		for _, d := range route.Daily {
			agg := &dayAgg{
				records:  d.Records,
				speedSum: float64(d.AvgSpeed) * float64(d.Records),
				maxSpeed: d.MaxSpeed,
			}
			if d.FirstPing != nil {
				agg.firstPing = *d.FirstPing
			}
			if d.LastPing != nil {
				agg.lastPing = *d.LastPing
			}
			dayMap[d.Day] = agg
		}

		var bufSpeedSum float64
		var bufMaxSpeed float32
		var bufLastSeen int64

		for _, ev := range buffer {
			bufSpeedSum += float64(ev.Speed)
			if ev.Speed > bufMaxSpeed {
				bufMaxSpeed = ev.Speed
			}
			if ev.UpdatedAt > bufLastSeen {
				bufLastSeen = ev.UpdatedAt
			}
			// Convert Unix ms to IST calendar date string
			day := time.UnixMilli(ev.UpdatedAt).In(istLoc).Format("2006-01-02")
			agg, exists := dayMap[day]
			if !exists {
				agg = &dayAgg{}
				dayMap[day] = agg
			}
			agg.records++
			agg.speedSum += float64(ev.Speed)
			if ev.Speed > agg.maxSpeed {
				agg.maxSpeed = ev.Speed
			}
			if agg.firstPing == 0 || ev.UpdatedAt < agg.firstPing {
				agg.firstPing = ev.UpdatedAt
			}
			if ev.UpdatedAt > agg.lastPing {
				agg.lastPing = ev.UpdatedAt
			}
		}

		// Update route-level summary
		bufCount := len(buffer)
		oldCount := route.TotalRecords
		newCount := oldCount + bufCount
		if newCount > 0 {
			route.AvgSpeed = float32(
				(float64(route.AvgSpeed)*float64(oldCount) + bufSpeedSum) / float64(newCount),
			)
		}
		if bufMaxSpeed > route.MaxSpeed {
			route.MaxSpeed = bufMaxSpeed
		}
		route.TotalRecords = newCount
		if route.LastSeen == nil || bufLastSeen > *route.LastSeen {
			route.LastSeen = &bufLastSeen
		}

		// Rebuild daily slice from merged map
		newDaily := make([]RouteActivityDay, 0, len(dayMap))
		for day, agg := range dayMap {
			d := RouteActivityDay{
				Day:      day,
				Records:  agg.records,
				MaxSpeed: agg.maxSpeed,
			}
			if agg.records > 0 {
				d.AvgSpeed = float32(agg.speedSum / float64(agg.records))
			}
			if agg.firstPing > 0 {
				fp := agg.firstPing
				d.FirstPing = &fp
			}
			if agg.lastPing > 0 {
				lp := agg.lastPing
				d.LastPing = &lp
			}
			newDaily = append(newDaily, d)
		}
		// Sort latest day first — matches the original DB query ORDER.
		sort.Slice(newDaily, func(i, j int) bool { return newDaily[i].Day > newDaily[j].Day })
		route.Daily = newDaily

		// Recount active days (days with ≥1 record)
		activeDays := 0
		for _, d := range route.Daily {
			if d.Records > 0 {
				activeDays++
			}
		}
		route.ActiveDays = activeDays
	}
}

// SetTrackingSession allows an admin to manually start or stop GPS tracking for
// their school, overriding the normal IST time-window restriction.
//
// URL:  POST /api/v1/admin/transport/tracking-session
// Auth: admin or super_admin
// Body: {"active": true, "duration_minutes": 120}   (duration only matters when active=true)
//
//	{"active": false}                             — stops the manual session
//
// Response: SessionStatus
func (h *Handler) SetTrackingSession(c *gin.Context) {
	schoolIDStr, _ := c.Get("school_id")
	userIDStr, _ := c.Get("user_id")
	emailStr, _ := c.Get("email")
	schoolID, err := uuid.Parse(fmt.Sprintf("%v", schoolIDStr))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}

	var body struct {
		Active          bool `json:"active"`
		DurationMinutes int  `json:"duration_minutes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	key := trackingSessionKeyPrefix + schoolID.String()
	ctx := c.Request.Context()
	forceCtx := context.WithValue(tenantCtx(ctx, schoolID), "force_refresh_tracking_status", true)
	currentStatus := GetSessionStatus(forceCtx, h.cache, h.repo, schoolID)

	if !body.Active {
		activationIDToClose := currentStatus.ActivationID
		_ = h.cache.Delete(ctx, key)
		InvalidateSessionStatusCache(ctx, h.cache, schoolID)
		// Also stop in DB (authoritative source of truth).
		_ = h.repo.StopManualSession(tenantCtx(ctx, schoolID), schoolID, fmt.Sprintf("%v", userIDStr))
		if err := h.repo.StopTripSessionsForSchool(tenantCtx(ctx, schoolID), schoolID, activationIDToClose, time.Now().UnixMilli()); err != nil {
			log.Printf("transport: WARNING failed to close bus_trip_sessions for school %s: %v", schoolID, err)
		}
		if currentStatus.ScheduledActive && currentStatus.TrackingSource == "scheduled" && currentStatus.ActivationEnd != nil && currentStatus.ActivationID != "" {
			suppression := TrackingScheduleSuppression{
				ActivationID:   currentStatus.ActivationID,
				SuppressedByID: fmt.Sprintf("%v", userIDStr),
				SuppressedBy:   fmt.Sprintf("%v", emailStr),
				SuppressedAt:   time.Now().UnixMilli(),
				ExpiresAt:      *currentStatus.ActivationEnd,
			}
			ttl := time.Until(time.UnixMilli(suppression.ExpiresAt).Add(5 * time.Minute))
			if ttl <= 0 {
				ttl = 15 * time.Minute
			}
			if err := h.cache.SetJSON(ctx, trackingScheduleSuppressionKey(schoolID), suppression, ttl); err != nil {
				log.Printf("transport: failed to store schedule suppression for school %s: %v", schoolID, err)
			}
		}
		InvalidateSessionStatusCache(ctx, h.cache, schoolID)
		if err := h.flushSchoolHistoryBuffers(ctx, schoolID); err != nil {
			log.Printf("transport: school history flush failed on manual stop (%s): %v", schoolID, err)
		}
		freshStatus := GetSessionStatus(forceCtx, h.cache, h.repo, schoolID)
		h.notifyAssignedDriversTrackingState(ctx, schoolID, freshStatus, false)
		// Publish session event so drivers subscribed via NATS get the stop immediately.
		if h.nats.IsEnabled() {
			if evtBytes, err := json.Marshal(map[string]interface{}{"tracking_allowed": false, "school_id": schoolID.String()}); err == nil {
				_ = h.nats.PublishSession(ctx, schoolID.String(), evtBytes)
			}
		}
		log.Printf("transport: admin %v stopped manual tracking session for school %s", userIDStr, schoolID)
		c.JSON(http.StatusOK, freshStatus)
		return
	}

	if body.DurationMinutes <= 0 {
		body.DurationMinutes = 120
	}
	dur := time.Duration(body.DurationMinutes) * time.Minute
	if dur > MaxSessionDuration {
		dur = MaxSessionDuration
	}

	now := time.Now()
	sess := TrackingSession{
		StartedByID:   fmt.Sprintf("%v", userIDStr),
		StartedByName: fmt.Sprintf("%v", emailStr),
		StartedAt:     now.UnixMilli(),
		ExpiresAt:     now.Add(dur).UnixMilli(),
	}
	raw, _ := json.Marshal(sess)
	if err := h.cache.Set(ctx, key, string(raw), dur); err != nil {
		log.Printf("transport: WARNING cache unavailable for manual session, relying on DB: %v", err)
	}
	InvalidateSessionStatusCache(ctx, h.cache, schoolID)
	// Always persist to DB — authoritative source for when cache is noop/evicted.
	if err := h.repo.UpsertManualSession(tenantCtx(ctx, schoolID), schoolID, sess); err != nil {
		log.Printf("transport: WARNING failed to persist manual session to DB for school %s: %v", schoolID, err)
	}
	InvalidateSessionStatusCache(ctx, h.cache, schoolID)
	_ = h.cache.Delete(ctx, trackingScheduleSuppressionKey(schoolID))
	InvalidateSessionStatusCache(ctx, h.cache, schoolID)
	log.Printf("transport: admin %v started manual tracking session for school %s (%d min)", userIDStr, schoolID, body.DurationMinutes)
	status := GetSessionStatus(forceCtx, h.cache, h.repo, schoolID)
	if err := h.repo.StartTripSessionsForSchool(tenantCtx(ctx, schoolID), schoolID, status.ActivationID, now.UnixMilli()); err != nil {
		log.Printf("transport: WARNING failed to create bus_trip_sessions for school %s: %v", schoolID, err)
	}
	h.notifyAssignedDriversTrackingState(ctx, schoolID, status, true)
	h.notifyBusStudentsTrackingLive(ctx, schoolID, "Bus tracking is now live. Tap to view your assigned bus in real time.")
	// Publish session event so drivers subscribed via NATS learn immediately.
	if h.nats.IsEnabled() {
		if evtBytes, err := json.Marshal(map[string]interface{}{"tracking_allowed": true, "school_id": schoolID.String(), "activation_id": status.ActivationID}); err == nil {
			_ = h.nats.PublishSession(ctx, schoolID.String(), evtBytes)
		}
	}
	c.JSON(http.StatusOK, status)
}

// GetAdminTrackingSession returns the current session status for admin clients.
//
// URL:  GET /api/v1/admin/transport/tracking-session
// Auth: admin or super_admin
func (h *Handler) GetAdminTrackingSession(c *gin.Context) {
	schoolIDStr, _ := c.Get("school_id")
	schoolID, err := uuid.Parse(fmt.Sprintf("%v", schoolIDStr))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	c.JSON(http.StatusOK, GetSessionStatus(tenantCtx(c.Request.Context(), schoolID), h.cache, h.repo, schoolID))
}

// GetDriverSessionStatus returns the current tracking-allowed status for staff (driver) clients.
// Drivers poll this before starting GPS so they know whether the admin has authorised them.
//
// URL:  GET /api/v1/transport/session-status
// Auth: staff, student, admin, or super_admin (bearer/cookie or legacy ?token=)
func (h *Handler) GetDriverSessionStatus(c *gin.Context) {
	claims, err := h.validateToken(c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": err.Error()})
		return
	}
	schoolID, err := uuid.Parse(claims.SchoolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	c.JSON(http.StatusOK, GetSessionStatus(tenantCtx(c.Request.Context(), schoolID), h.cache, h.repo, schoolID))
}

func sessionStatusFingerprint(s SessionStatus) string {
	activeScheduleID := ""
	if s.ActiveSchedule != nil {
		activeScheduleID = s.ActiveSchedule.ID
	}
	activationStart := int64(0)
	if s.ActivationStart != nil {
		activationStart = *s.ActivationStart
	}
	activationEnd := int64(0)
	if s.ActivationEnd != nil {
		activationEnd = *s.ActivationEnd
	}
	nextWindowStart := int64(0)
	if s.NextWindow != nil {
		nextWindowStart = s.NextWindow.StartsAt
	}
	return fmt.Sprintf("%t|%t|%t|%s|%s|%d|%d|%d|%s|%d",
		s.TrackingAllowed,
		s.ManualActive,
		s.ScheduledActive,
		s.TrackingSource,
		s.ActivationID,
		activationStart,
		activationEnd,
		nextWindowStart,
		activeScheduleID,
		time.Now().In(IST).Weekday(),
	)
}

// DriverSessionWebSocket streams session-status updates to driver apps so they
// do not need frequent polling to learn start/stop transitions.
//
// URL: GET /api/v1/transport/driver-session/ws
// Auth: staff role with driver_tracking ws scope.
func (h *Handler) DriverSessionWebSocket(c *gin.Context) {
	claims, err := h.validateToken(c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": err.Error()})
		return
	}
	if claims.WSScope != "" && claims.WSScope != "driver_tracking" {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
		return
	}
	if claims.Role != "staff" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	schoolID, err := uuid.Parse(claims.SchoolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}

	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.Header("Connection", "Upgrade")
		c.Header("Upgrade", "websocket")
		c.JSON(http.StatusUpgradeRequired, gin.H{"error": "websocket_upgrade_required"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("transport: driver session WS upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for {
			if _, _, readErr := conn.ReadMessage(); readErr != nil {
				return
			}
		}
	}()

	lastFingerprint := ""
	sendStatus := func(force bool) error {
		if h.sessionValidator != nil {
			if err := h.sessionValidator(context.Background(), claims); err != nil {
				return err
			}
		}

		status := GetSessionStatus(tenantCtx(context.Background(), schoolID), h.cache, h.repo, schoolID)
		fingerprint := sessionStatusFingerprint(status)
		if !force && fingerprint == lastFingerprint {
			return nil
		}

		lastFingerprint = fingerprint
		payload := map[string]interface{}{
			"type":       "session_status",
			"updated_at": time.Now().UnixMilli(),
			"status":     status,
		}
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(payload)
	}

	if err := sendStatus(true); err != nil {
		return
	}

	var natsCh <-chan []byte
	cancelSub := func() {}
	if h.nats.IsEnabled() {
		ch, cancel, subErr := h.nats.SubscribeSession(c.Request.Context(), schoolID.String())
		if subErr != nil {
			log.Printf("transport: driver session NATS subscribe failed for school %s: %v", schoolID, subErr)
		} else {
			natsCh = ch
			cancelSub = cancel
		}
	}
	defer cancelSub()

	// Periodic refresh catches schedule boundaries even if no explicit event was published.
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-closed:
			return
		case <-natsCh:
			if err := sendStatus(false); err != nil {
				return
			}
		case <-ticker.C:
			if err := sendStatus(false); err != nil {
				return
			}
		}
	}
}

// GetDriverSchedules returns all active recurring tracking schedules for the driver's school.
// Accessible by any authenticated user (staff/driver/student) so drivers can see upcoming windows.
//
// URL:  GET /api/v1/transport/schedules
// Auth: bearer/cookie or legacy ?token=
func (h *Handler) GetDriverSchedules(c *gin.Context) {
	claims, err := h.validateToken(c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": err.Error()})
		return
	}
	schoolID, err := uuid.Parse(claims.SchoolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	items, err := h.repo.ListTrackingSchedules(tenantCtx(c.Request.Context(), schoolID), schoolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Only expose active schedules to non-admin consumers.
	active := make([]TrackingSchedule, 0, len(items))
	for _, s := range items {
		if s.IsActive {
			active = append(active, s)
		}
	}
	c.JSON(http.StatusOK, gin.H{"schedules": active})
}

// ListTrackingSchedules returns all recurring schedule events for the school.
func (h *Handler) ListTrackingSchedules(c *gin.Context) {
	schoolIDStr, _ := c.Get("school_id")
	schoolID, err := uuid.Parse(fmt.Sprintf("%v", schoolIDStr))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	items, err := h.repo.ListTrackingSchedules(c.Request.Context(), schoolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"schedules": items})
}

func (h *Handler) CreateTrackingSchedule(c *gin.Context) {
	schoolIDStr, _ := c.Get("school_id")
	schoolID, err := uuid.Parse(fmt.Sprintf("%v", schoolIDStr))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	var body TrackingScheduleCreateRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	normalizeDays := func(req TrackingScheduleCreateRequest) ([]int, error) {
		if req.EveryDay {
			return []int{0, 1, 2, 3, 4, 5, 6}, nil
		}

		source := req.DayOfWeeks
		if len(source) == 0 && req.DayOfWeek != nil {
			source = []int{*req.DayOfWeek}
		}
		if len(source) == 0 {
			return nil, fmt.Errorf("at least one day is required")
		}

		seen := make(map[int]struct{}, 7)
		days := make([]int, 0, len(source))
		for _, d := range source {
			if d < 0 || d > 6 {
				return nil, fmt.Errorf("day_of_week must be between 0 and 6")
			}
			if _, ok := seen[d]; ok {
				continue
			}
			seen[d] = struct{}{}
			days = append(days, d)
		}
		if len(days) == 0 {
			return nil, fmt.Errorf("at least one valid day is required")
		}
		return days, nil
	}

	days, err := normalizeDays(body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	created := make([]*TrackingSchedule, 0, len(days))
	for _, d := range days {
		item, createErr := h.repo.CreateTrackingSchedule(c.Request.Context(), schoolID, TrackingScheduleUpsertRequest{
			DayOfWeek: d,
			Label:     body.Label,
			StartTime: body.StartTime,
			EndTime:   body.EndTime,
			IsActive:  body.IsActive,
		})
		if createErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": createErr.Error()})
			return
		}
		h.UpsertTrackingScheduleInQueue(c.Request.Context(), schoolID, item)
		created = append(created, item)
	}
	InvalidateSessionStatusCache(c.Request.Context(), h.cache, schoolID)

	resp := gin.H{"schedules": created}
	if len(created) == 1 {
		// Backward compatibility for older clients that expect "schedule".
		resp["schedule"] = created[0]
	}
	c.JSON(http.StatusCreated, resp)
}

func (h *Handler) UpdateTrackingSchedule(c *gin.Context) {
	schoolIDStr, _ := c.Get("school_id")
	schoolID, err := uuid.Parse(fmt.Sprintf("%v", schoolIDStr))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	scheduleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_schedule_id"})
		return
	}
	var body TrackingScheduleUpsertRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.repo.UpdateTrackingSchedule(c.Request.Context(), schoolID, scheduleID, body)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "no rows") {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	h.UpsertTrackingScheduleInQueue(c.Request.Context(), schoolID, item)
	InvalidateSessionStatusCache(c.Request.Context(), h.cache, schoolID)
	c.JSON(http.StatusOK, gin.H{"schedule": item})
}

func (h *Handler) DeleteTrackingSchedule(c *gin.Context) {
	schoolIDStr, _ := c.Get("school_id")
	schoolID, err := uuid.Parse(fmt.Sprintf("%v", schoolIDStr))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	scheduleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_schedule_id"})
		return
	}
	if err := h.repo.DeleteTrackingSchedule(c.Request.Context(), schoolID, scheduleID); err != nil {
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	h.RemoveTrackingScheduleFromQueue(c.Request.Context(), schoolID, scheduleID.String())
	InvalidateSessionStatusCache(c.Request.Context(), h.cache, schoolID)
	c.JSON(http.StatusOK, gin.H{"message": "tracking schedule deleted"})
}
