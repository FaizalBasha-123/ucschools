-- 062_transport_tracking_schedule_multi_day_constraints.sql
-- Purpose:
-- 1) Prepare transport schedule data for multi-day creation from UI.
-- 2) Prevent duplicate recurring windows for the same day/time/label.
-- 3) Keep lookup/index paths efficient for active-window checks.

-- Remove duplicate rows while keeping the earliest created row per unique slot.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY school_id, day_of_week, label, start_time, end_time
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM transport_tracking_schedules
)
DELETE FROM transport_tracking_schedules t
USING ranked r
WHERE t.id = r.id
  AND r.rn > 1;

-- Ensure one recurring slot per school/day/label/time range.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_tracking_schedules_slot
    ON transport_tracking_schedules (school_id, day_of_week, label, start_time, end_time);

-- Speed up active schedule resolution in GetActiveTrackingSchedule.
CREATE INDEX IF NOT EXISTS idx_transport_tracking_schedules_active_lookup
    ON transport_tracking_schedules (school_id, day_of_week, is_active, start_time, end_time);
