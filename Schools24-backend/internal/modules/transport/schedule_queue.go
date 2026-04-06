package transport

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	trackingScheduleQueueKey         = "tracking:schedule:queue"
	trackingScheduleQueueIndexPrefix = "tracking:schedule:index:"
	trackingScheduleQueueWindowDays  = 8
	trackingScheduleQueueIndexTTL    = 10 * 24 * time.Hour
	trackingScheduleQueueWorkerBatch = 256
)

func trackingScheduleIndexKey(schoolID uuid.UUID, scheduleID string) string {
	return fmt.Sprintf("%s%s:%s", trackingScheduleQueueIndexPrefix, schoolID.String(), scheduleID)
}

func trackingScheduleSchoolIndexPrefix(schoolID uuid.UUID) string {
	return fmt.Sprintf("%s%s:", trackingScheduleQueueIndexPrefix, schoolID.String())
}

func trackingScheduleQueueMember(schoolID uuid.UUID, scheduleID string, startsAt int64) string {
	return fmt.Sprintf("%s|%s|%d", schoolID.String(), scheduleID, startsAt)
}

func parseTrackingScheduleQueueMember(member string) (uuid.UUID, string, int64, error) {
	parts := strings.Split(member, "|")
	if len(parts) != 3 {
		return uuid.Nil, "", 0, fmt.Errorf("invalid queue member format")
	}
	schoolID, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, "", 0, fmt.Errorf("invalid school id: %w", err)
	}
	startsAt, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		return uuid.Nil, "", 0, fmt.Errorf("invalid starts_at: %w", err)
	}
	return schoolID, parts[1], startsAt, nil
}

func upcomingScheduleStartTimes(schedule TrackingSchedule, now time.Time, days int) []time.Time {
	if !schedule.IsActive || days <= 0 {
		return nil
	}

	nowIST := now.In(IST)
	starts := make([]time.Time, 0, days)

	for dayOffset := 0; dayOffset <= days; dayOffset++ {
		candidateDate := nowIST.AddDate(0, 0, dayOffset)
		if int(candidateDate.Weekday()) != schedule.DayOfWeek {
			continue
		}
		start, _, err := scheduleWindowBounds(schedule, candidateDate)
		if err != nil {
			continue
		}
		if !start.After(nowIST) {
			continue
		}
		starts = append(starts, start)
	}

	return starts
}

// RemoveTrackingScheduleFromQueue deletes all queued trigger events for one schedule.
func (h *Handler) RemoveTrackingScheduleFromQueue(ctx context.Context, schoolID uuid.UUID, scheduleID string) {
	if h.cache == nil || !h.cache.IsEnabled() || strings.TrimSpace(scheduleID) == "" {
		return
	}
	indexKey := trackingScheduleIndexKey(schoolID, scheduleID)
	members, err := h.cache.SMembers(ctx, indexKey)
	if err == nil && len(members) > 0 {
		_, _ = h.cache.ZRem(ctx, trackingScheduleQueueKey, members...)
	}
	_ = h.cache.Delete(ctx, indexKey)
}

// UpsertTrackingScheduleInQueue refreshes queued trigger events for one schedule.
func (h *Handler) UpsertTrackingScheduleInQueue(ctx context.Context, schoolID uuid.UUID, schedule *TrackingSchedule) {
	if h.cache == nil || !h.cache.IsEnabled() || schedule == nil {
		return
	}

	h.RemoveTrackingScheduleFromQueue(ctx, schoolID, schedule.ID)
	if !schedule.IsActive {
		return
	}

	now := time.Now()
	starts := upcomingScheduleStartTimes(*schedule, now, trackingScheduleQueueWindowDays)
	if len(starts) == 0 {
		return
	}

	indexKey := trackingScheduleIndexKey(schoolID, schedule.ID)
	members := make([]string, 0, len(starts))
	for _, start := range starts {
		member := trackingScheduleQueueMember(schoolID, schedule.ID, start.UnixMilli())
		if err := h.cache.ZAdd(ctx, trackingScheduleQueueKey, float64(start.UnixMilli()), member); err != nil {
			log.Printf("transport queue: zadd failed for school=%s schedule=%s: %v", schoolID, schedule.ID, err)
			continue
		}
		members = append(members, member)
	}
	if len(members) > 0 {
		_ = h.cache.SAdd(ctx, indexKey, members...)
		_ = h.cache.Expire(ctx, indexKey, trackingScheduleQueueIndexTTL)
	}
}

// RebuildTrackingScheduleQueueForSchool rebuilds one school's rolling trigger queue from DB schedules.
func (h *Handler) RebuildTrackingScheduleQueueForSchool(ctx context.Context, schoolID uuid.UUID) error {
	if h.cache == nil || !h.cache.IsEnabled() {
		return nil
	}

	indexKeys, err := h.cache.ListKeysByPrefix(ctx, trackingScheduleSchoolIndexPrefix(schoolID))
	if err != nil {
		return fmt.Errorf("list school schedule index keys: %w", err)
	}
	for _, key := range indexKeys {
		members, mErr := h.cache.SMembers(ctx, key)
		if mErr == nil && len(members) > 0 {
			_, _ = h.cache.ZRem(ctx, trackingScheduleQueueKey, members...)
		}
		_ = h.cache.Delete(ctx, key)
	}

	schedules, err := h.repo.ListTrackingSchedules(tenantCtx(ctx, schoolID), schoolID)
	if err != nil {
		return fmt.Errorf("list schedules for rebuild: %w", err)
	}
	for i := range schedules {
		s := schedules[i]
		h.UpsertTrackingScheduleInQueue(ctx, schoolID, &s)
	}
	return nil
}

// ProcessDueTrackingScheduleQueue processes queued schedule events due at or before now.
func (h *Handler) ProcessDueTrackingScheduleQueue(ctx context.Context, now time.Time, maxBatch int64) (int, error) {
	if h.cache == nil || !h.cache.IsEnabled() {
		return 0, nil
	}
	if maxBatch <= 0 {
		maxBatch = trackingScheduleQueueWorkerBatch
	}

	dueMembers, err := h.cache.ZPopByScore(ctx, trackingScheduleQueueKey, now.UnixMilli(), maxBatch)
	if err != nil {
		return 0, fmt.Errorf("pop due queue members: %w", err)
	}
	if len(dueMembers) == 0 {
		return 0, nil
	}

	processed := 0
	for _, member := range dueMembers {
		schoolID, scheduleID, _, parseErr := parseTrackingScheduleQueueMember(member)
		if parseErr != nil {
			continue
		}

		// Force a fresh status read at due-time boundary to avoid stale cache misses.
		triggerCtx := context.WithValue(ctx, "force_refresh_tracking_status", true)
		h.ProcessScheduledStartNotifications(triggerCtx, schoolID, now)
		h.FlushStaleRouteHistoryBuffers(ctx, schoolID)

		indexKey := trackingScheduleIndexKey(schoolID, scheduleID)
		_ = h.cache.SRem(ctx, indexKey, member)
		processed++
	}

	return processed, nil
}
