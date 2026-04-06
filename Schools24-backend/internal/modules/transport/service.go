package transport

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/cache"
)

// IST is the Indian Standard Time location, loaded once at startup.
// If the timezone data is unavailable, falls back to a fixed UTC+5:30 offset.
var IST *time.Location

const (
	trackingStatusCacheKeyPrefix = "tracking:status:"
	trackingStatusMinCacheTTL    = 5 * time.Second
	trackingStatusMaxCacheTTL    = 6 * time.Hour
	trackingStatusDefaultTTL     = 30 * time.Minute
)

func init() {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		// Fallback: UTC+5:30 fixed offset — correct for IST (no DST)
		loc = time.FixedZone("IST", 5*60*60+30*60)
	}
	IST = loc
}

func trackingScheduleSuppressionKey(schoolID uuid.UUID) string {
	return trackingScheduleSuppressionKeyPrefix + schoolID.String()
}

func trackingStatusCacheKey(schoolID uuid.UUID) string {
	return trackingStatusCacheKeyPrefix + schoolID.String()
}

// InvalidateSessionStatusCache clears the short-lived derived tracking status cache.
// Call this on manual start/stop and schedule CRUD to avoid stale status responses.
func InvalidateSessionStatusCache(ctx context.Context, c *cache.Cache, schoolID uuid.UUID) {
	if c == nil || !c.IsEnabled() {
		return
	}
	_ = c.Delete(ctx, trackingStatusCacheKey(schoolID))
}

func scheduledActivationID(scheduleID string, start time.Time) string {
	return "scheduled:" + scheduleID + ":" + start.In(IST).Format("20060102")
}

func scheduleWindowBounds(schedule TrackingSchedule, baseDate time.Time) (time.Time, time.Time, error) {
	startClock, err := parseClock(schedule.StartTime)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	endClock, err := parseClock(schedule.EndTime)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	base := baseDate.In(IST)
	start := time.Date(base.Year(), base.Month(), base.Day(), startClock.Hour(), startClock.Minute(), startClock.Second(), 0, IST)
	end := time.Date(base.Year(), base.Month(), base.Day(), endClock.Hour(), endClock.Minute(), endClock.Second(), 0, IST)
	return start, end, nil
}

func loadScheduleSuppression(ctx context.Context, c *cache.Cache, schoolID uuid.UUID) *TrackingScheduleSuppression {
	if c == nil || !c.IsEnabled() {
		return nil
	}
	var suppression TrackingScheduleSuppression
	if err := c.GetJSON(ctx, trackingScheduleSuppressionKey(schoolID), &suppression); err != nil {
		return nil
	}
	if suppression.ExpiresAt <= time.Now().UnixMilli() {
		return nil
	}
	return &suppression
}

func resolveScheduleWindows(now time.Time, schedules []TrackingSchedule, suppression *TrackingScheduleSuppression) (*TrackingSchedule, *time.Time, *time.Time, *UpcomingTrackingWindow) {
	nowIST := now.In(IST)
	var active *TrackingSchedule
	var activeStart *time.Time
	var activeEnd *time.Time
	var nextWindow *UpcomingTrackingWindow

	for _, schedule := range schedules {
		if !schedule.IsActive {
			continue
		}

		for dayOffset := 0; dayOffset <= 7; dayOffset++ {
			candidateDate := nowIST.AddDate(0, 0, dayOffset)
			if int(candidateDate.Weekday()) != schedule.DayOfWeek {
				continue
			}
			start, end, err := scheduleWindowBounds(schedule, candidateDate)
			if err != nil || !end.After(start) {
				break
			}
			if !end.After(nowIST) {
				continue
			}

			activationID := scheduledActivationID(schedule.ID, start)
			suppressed := suppression != nil && suppression.ActivationID == activationID && suppression.ExpiresAt > now.UnixMilli()

			if !suppressed && !start.After(nowIST) && end.After(nowIST) {
				if activeStart == nil || start.Before(*activeStart) {
					s := schedule
					startCopy := start
					endCopy := end
					active = &s
					activeStart = &startCopy
					activeEnd = &endCopy
				}
				break
			}

			if start.After(nowIST) {
				minutes := int(start.Sub(nowIST).Minutes())
				if start.Sub(nowIST)%time.Minute != 0 {
					minutes++
				}
				if minutes < 0 {
					minutes = 0
				}
				if nextWindow == nil || start.UnixMilli() < nextWindow.StartsAt {
					s := schedule
					nextWindow = &UpcomingTrackingWindow{
						Schedule:          &s,
						StartsAt:          start.UnixMilli(),
						EndsAt:            end.UnixMilli(),
						MinutesUntilStart: minutes,
					}
				}
				break
			}
		}
	}

	return active, activeStart, activeEnd, nextWindow
}

func trackingStatusCacheTTL(now time.Time, status SessionStatus) time.Duration {
	ttl := trackingStatusDefaultTTL
	nearestTransition := time.Time{}

	if status.Session != nil {
		expiresAt := time.UnixMilli(status.Session.ExpiresAt)
		if expiresAt.After(now) {
			nearestTransition = expiresAt
		}
	}

	if status.ActivationEnd != nil {
		endAt := time.UnixMilli(*status.ActivationEnd)
		if endAt.After(now) && (nearestTransition.IsZero() || endAt.Before(nearestTransition)) {
			nearestTransition = endAt
		}
	}

	if status.NextWindow != nil {
		startAt := time.UnixMilli(status.NextWindow.StartsAt)
		if startAt.After(now) && (nearestTransition.IsZero() || startAt.Before(nearestTransition)) {
			nearestTransition = startAt
		}
	}

	if !nearestTransition.IsZero() {
		ttl = nearestTransition.Sub(now) + time.Second
	}

	if ttl < trackingStatusMinCacheTTL {
		return trackingStatusMinCacheTTL
	}
	if ttl > trackingStatusMaxCacheTTL {
		return trackingStatusMaxCacheTTL
	}
	return ttl
}

// GetSessionStatus returns the combined tracking-allowed status for a school.
// Priority: manual admin session > tenant-configured schedule events.
//
// Session resolution order (most reliable first):
//  1. Valkey cache — fast path when Redis is available.
//  2. DB table transport_manual_sessions — authoritative fallback so tracking
//     works even when Valkey is unavailable (noop cache, restart, etc.).
func GetSessionStatus(ctx context.Context, c *cache.Cache, repo *Repository, schoolID uuid.UUID) SessionStatus {
	now := time.Now()
	forceRefresh, _ := ctx.Value("force_refresh_tracking_status").(bool)
	if c != nil && c.IsEnabled() && !forceRefresh {
		var cached SessionStatus
		if err := c.GetJSON(ctx, trackingStatusCacheKey(schoolID), &cached); err == nil {
			return cached
		}
	}

	var sess *TrackingSession
	skipManualDBFallback, _ := ctx.Value("skip_manual_db_fallback").(bool)
	key := trackingSessionKeyPrefix + schoolID.String()
	if c != nil {
		if raw, err := c.Get(ctx, key); err == nil && raw != "" {
			var s TrackingSession
			if err2 := json.Unmarshal([]byte(raw), &s); err2 == nil {
				if now.UnixMilli() < s.ExpiresAt {
					sess = &s
				}
			}
		}
	}
	// DB fallback: if cache missed (noop or key expired/evicted) try the DB.
	if sess == nil && repo != nil && !skipManualDBFallback {
		if dbSess, err := repo.GetActiveManualSession(ctx, schoolID); err == nil && dbSess != nil {
			sess = dbSess
			// Re-warm cache so subsequent calls don't always hit the DB.
			if c != nil && c.IsEnabled() {
				ttl := time.Duration(dbSess.ExpiresAt-now.UnixMilli()) * time.Millisecond
				if ttl > 0 {
					if raw, err := json.Marshal(dbSess); err == nil {
						_ = c.Set(ctx, key, string(raw), ttl)
					}
				}
			}
		}
	}

	var activeSchedule *TrackingSchedule
	var activeStart *time.Time
	var activeEnd *time.Time
	var nextWindow *UpcomingTrackingWindow
	if repo != nil {
		schedules, err := repo.ListTrackingSchedules(ctx, schoolID)
		if err == nil {
			suppression := loadScheduleSuppression(ctx, c, schoolID)
			activeSchedule, activeStart, activeEnd, nextWindow = resolveScheduleWindows(now, schedules, suppression)
		}
	}
	window := activeSchedule != nil
	status := SessionStatus{
		ManualActive:     sess != nil,
		Session:          sess,
		TimeWindowActive: window,
		TrackingAllowed:  sess != nil || window,
		ScheduledActive:  window,
		ActiveSchedule:   activeSchedule,
		NextWindow:       nextWindow,
	}

	if sess != nil {
		status.TrackingSource = "manual"
		status.ActivationID = "manual:"
		status.ActivationID += time.UnixMilli(sess.StartedAt).UTC().Format(time.RFC3339Nano)
		start := sess.StartedAt
		end := sess.ExpiresAt
		status.ActivationStart = &start
		status.ActivationEnd = &end
		if c != nil && c.IsEnabled() {
			_ = c.SetJSON(ctx, trackingStatusCacheKey(schoolID), status, trackingStatusCacheTTL(now, status))
		}
		return status
	}

	if activeSchedule != nil && activeStart != nil && activeEnd != nil {
		status.TrackingSource = "scheduled"
		status.ActivationID = scheduledActivationID(activeSchedule.ID, *activeStart)
		start := activeStart.UnixMilli()
		end := activeEnd.UnixMilli()
		status.ActivationStart = &start
		status.ActivationEnd = &end
	}

	if c != nil && c.IsEnabled() {
		_ = c.SetJSON(ctx, trackingStatusCacheKey(schoolID), status, trackingStatusCacheTTL(now, status))
	}

	return status
}
