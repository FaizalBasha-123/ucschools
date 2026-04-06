package admin

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GetTimetableConfig returns timetable days and periods configuration
func (r *Repository) GetTimetableConfig(ctx context.Context) (*TimetableConfig, error) {
	daysQuery := `
        SELECT day_of_week, day_name, is_active
        FROM timetable_days
        ORDER BY day_of_week
    `

	dayRows, err := r.db.Query(ctx, daysQuery)
	if err != nil {
		return nil, err
	}
	defer dayRows.Close()

	var days []TimetableDayConfig
	for dayRows.Next() {
		var d TimetableDayConfig
		if err := dayRows.Scan(&d.DayOfWeek, &d.DayName, &d.IsActive); err != nil {
			return nil, err
		}
		days = append(days, d)
	}

	periodsQuery := `
        SELECT period_number, start_time::text, end_time::text, is_break, break_name
        FROM timetable_periods
        ORDER BY period_number
    `

	periodRows, err := r.db.Query(ctx, periodsQuery)
	if err != nil {
		return nil, err
	}
	defer periodRows.Close()

	var periods []TimetablePeriodConfig
	for periodRows.Next() {
		var p TimetablePeriodConfig
		var breakName *string
		if err := periodRows.Scan(&p.PeriodNumber, &p.StartTime, &p.EndTime, &p.IsBreak, &breakName); err != nil {
			return nil, err
		}
		p.BreakName = breakName
		periods = append(periods, p)
	}

	return &TimetableConfig{Days: days, Periods: periods}, nil
}

// UpdateTimetableConfig replaces timetable configuration (days and periods) and prunes invalid timetable entries
func (r *Repository) UpdateTimetableConfig(ctx context.Context, config *TimetableConfig) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if schema, ok := ctx.Value("tenant_schema").(string); ok && schema != "" {
		if _, err := tx.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", schema)); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, "DELETE FROM timetable_days"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "DELETE FROM timetable_periods"); err != nil {
		return err
	}

	for _, day := range config.Days {
		_, err := tx.Exec(ctx,
			`INSERT INTO timetable_days (day_of_week, day_name, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5)`,
			day.DayOfWeek, day.DayName, day.IsActive, time.Now(), time.Now(),
		)
		if err != nil {
			return err
		}
	}

	for _, period := range config.Periods {
		_, err := tx.Exec(ctx,
			`INSERT INTO timetable_periods (period_number, start_time, end_time, is_break, break_name, created_at, updated_at)
             VALUES ($1, $2::time, $3::time, $4, $5, $6, $7)`,
			period.PeriodNumber, period.StartTime, period.EndTime, period.IsBreak, period.BreakName, time.Now(), time.Now(),
		)
		if err != nil {
			return err
		}
	}

	// Sync timetable entry timings with updated periods
	for _, period := range config.Periods {
		if _, err := tx.Exec(ctx,
			`UPDATE timetables SET start_time = $1::time, end_time = $2::time, updated_at = $3
             WHERE period_number = $4`,
			period.StartTime, period.EndTime, time.Now(), period.PeriodNumber,
		); err != nil {
			return err
		}
	}

	activeDays := make([]int, 0)
	for _, day := range config.Days {
		if day.IsActive {
			activeDays = append(activeDays, day.DayOfWeek)
		}
	}

	periodNumbers := make([]int, 0)
	for _, period := range config.Periods {
		periodNumbers = append(periodNumbers, period.PeriodNumber)
	}

	if len(activeDays) == 0 || len(periodNumbers) == 0 {
		if _, err := tx.Exec(ctx, "DELETE FROM timetables"); err != nil {
			return err
		}
	} else {
		_, err := tx.Exec(ctx,
			`DELETE FROM timetables
             WHERE NOT (day_of_week = ANY($1)) OR NOT (period_number = ANY($2))`,
			activeDays, periodNumbers,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// GetClassTimetable returns timetable entries for a class.
// Academic year filtering is intentionally omitted: schools reuse one live
// timetable across years, so we always return the latest row per (day, period).
func (r *Repository) GetClassTimetable(ctx context.Context, classID uuid.UUID, academicYear string) ([]TimetableEntry, error) {
	// global_subject_id: resolve the stored tenant subject UUID back to the
	// global catalog UUID so the frontend dropdown (which uses global IDs) can
	// pre-fill the subject correctly when editing an existing slot.
	query := `
        SELECT DISTINCT ON (t.day_of_week, t.period_number)
               t.id, t.class_id, t.day_of_week, t.period_number, t.subject_id,
               gs_direct.id  AS global_subject_id_direct,
               gs_via.id     AS global_subject_id_via,
               t.teacher_id,
               t.start_time::text, t.end_time::text, t.room_number, t.academic_year,
               COALESCE(s.name, gs_direct.name, '') as subject_name,
               COALESCE(u.full_name, '') as teacher_name,
               COALESCE(c.name, '') as class_name
        FROM timetables t
        LEFT JOIN subjects s ON t.subject_id = s.id
        LEFT JOIN public.global_subjects gs_direct ON t.subject_id = gs_direct.id
        LEFT JOIN public.global_subjects gs_via ON (s.id IS NOT NULL AND LOWER(s.name) = LOWER(gs_via.name))
        LEFT JOIN teachers te ON t.teacher_id = te.id
        LEFT JOIN users u ON te.user_id = u.id
        LEFT JOIN classes c ON t.class_id = c.id
        WHERE t.class_id = $1
        ORDER BY t.day_of_week, t.period_number, t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
    `

	rows, err := r.db.Query(ctx, query, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]TimetableEntry, 0)
	for rows.Next() {
		var t TimetableEntry
		var gsDirect, gsVia *uuid.UUID
		if err := rows.Scan(
			&t.ID, &t.ClassID, &t.DayOfWeek, &t.PeriodNumber, &t.SubjectID,
			&gsDirect, &gsVia,
			&t.TeacherID,
			&t.StartTime, &t.EndTime, &t.RoomNumber, &t.AcademicYear,
			&t.SubjectName, &t.TeacherName, &t.ClassName,
		); err != nil {
			return nil, err
		}
		// Prefer direct match (subject_id is already a global UUID),
		// otherwise use the name-resolved global UUID.
		if gsDirect != nil {
			t.GlobalSubjectID = gsDirect
		} else if gsVia != nil {
			t.GlobalSubjectID = gsVia
		}
		entries = append(entries, t)
	}

	return entries, nil
}

// GetTeacherTimetable returns timetable entries for a teacher.
// See GetClassTimetable for the year-agnostic DISTINCT ON rationale.
func (r *Repository) GetTeacherTimetable(ctx context.Context, teacherID uuid.UUID, academicYear string) ([]TimetableEntry, error) {
	query := `
        SELECT DISTINCT ON (t.day_of_week, t.period_number)
               t.id, t.class_id, t.day_of_week, t.period_number, t.subject_id,
               gs_direct.id  AS global_subject_id_direct,
               gs_via.id     AS global_subject_id_via,
               t.teacher_id,
               t.start_time::text, t.end_time::text, t.room_number, t.academic_year,
               COALESCE(s.name, gs_direct.name, '') as subject_name,
               COALESCE(u.full_name, '') as teacher_name,
               COALESCE(c.name, '') as class_name
        FROM timetables t
        LEFT JOIN subjects s ON t.subject_id = s.id
        LEFT JOIN public.global_subjects gs_direct ON t.subject_id = gs_direct.id
        LEFT JOIN public.global_subjects gs_via ON (s.id IS NOT NULL AND LOWER(s.name) = LOWER(gs_via.name))
        LEFT JOIN teachers te ON t.teacher_id = te.id
        LEFT JOIN users u ON te.user_id = u.id
        LEFT JOIN classes c ON t.class_id = c.id
        WHERE t.teacher_id = $1
        ORDER BY t.day_of_week, t.period_number, t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
    `

	rows, err := r.db.Query(ctx, query, teacherID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]TimetableEntry, 0)
	for rows.Next() {
		var t TimetableEntry
		var gsDirect, gsVia *uuid.UUID
		if err := rows.Scan(
			&t.ID, &t.ClassID, &t.DayOfWeek, &t.PeriodNumber, &t.SubjectID,
			&gsDirect, &gsVia,
			&t.TeacherID,
			&t.StartTime, &t.EndTime, &t.RoomNumber, &t.AcademicYear,
			&t.SubjectName, &t.TeacherName, &t.ClassName,
		); err != nil {
			return nil, err
		}
		if gsDirect != nil {
			t.GlobalSubjectID = gsDirect
		} else if gsVia != nil {
			t.GlobalSubjectID = gsVia
		}
		entries = append(entries, t)
	}

	return entries, nil
}

// UpsertTimetableSlot creates or updates a timetable slot.
// The frontend sends a global catalog UUID as subject_id. We resolve it to the
// tenant subjects table UUID (matching by name) so the FK is satisfied and tenant
// data stays consistent regardless of which UUID was generated locally.
func (r *Repository) UpsertTimetableSlot(ctx context.Context, entry *TimetableEntry) error {
	if entry.SubjectID != nil {
		// 1. Resolve the global subject UUID → tenant subject UUID via name match.
		//    If the subject doesn't exist in the tenant yet, insert it with the global UUID.
		var resolvedID uuid.UUID
		resolveSQL := `
			WITH global AS (
				SELECT gs.id AS global_id, gs.name, gs.code
				FROM public.global_subjects gs
				WHERE gs.id = $1
			),
			school AS (
				SELECT c.school_id FROM classes c WHERE c.id = $2 LIMIT 1
			),
			existing_subject AS (
				SELECT s.id
				FROM subjects s, global g, school sc
				WHERE s.school_id = sc.school_id
				  AND LOWER(s.name) = LOWER(g.name)
				LIMIT 1
			),
			inserted AS (
				INSERT INTO subjects (id, school_id, name, code, description, grade_levels, credits, is_optional, created_at)
				SELECT g.global_id,
				       sc.school_id,
				       g.name,
				       CASE WHEN COALESCE(NULLIF(g.code, ''), '') = '' THEN UPPER(LEFT(g.name, 3)) ELSE g.code END,
				       NULL, NULL, 1, false, NOW()
				FROM global g, school sc
				WHERE NOT EXISTS (SELECT 1 FROM existing_subject)
				  AND g.global_id IS NOT NULL
				ON CONFLICT DO NOTHING
				RETURNING id
			)
			SELECT COALESCE(
				(SELECT id FROM existing_subject),
				(SELECT id FROM inserted),
				$1
			)
		`
		if err := r.db.QueryRow(ctx, resolveSQL, entry.SubjectID, entry.ClassID).Scan(&resolvedID); err == nil {
			entry.SubjectID = &resolvedID
		}
		// If the resolve fails we proceed with the original ID; the FK error below
		// will surface a clear message.
	}

	query := `
        INSERT INTO timetables (id, class_id, day_of_week, period_number, subject_id, teacher_id,
            start_time, end_time, room_number, academic_year, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10, $11, $12)
        ON CONFLICT (class_id, day_of_week, period_number)
        DO UPDATE SET subject_id = EXCLUDED.subject_id,
                      teacher_id = EXCLUDED.teacher_id,
                      start_time = EXCLUDED.start_time,
                      end_time = EXCLUDED.end_time,
                      room_number = EXCLUDED.room_number,
                      academic_year = EXCLUDED.academic_year,
                      updated_at = EXCLUDED.updated_at
    `

	now := time.Now()
	entry.ID = uuid.New()
	return r.db.Exec(ctx, query,
		entry.ID, entry.ClassID, entry.DayOfWeek, entry.PeriodNumber, entry.SubjectID, entry.TeacherID,
		entry.StartTime, entry.EndTime, entry.RoomNumber, entry.AcademicYear, now, now,
	)
}

// DeleteTimetableSlot deletes a timetable slot.
// The academic_year parameter is accepted for API compatibility but ignored —
// all rows for the given class/day/period are deleted regardless of year.
func (r *Repository) DeleteTimetableSlot(ctx context.Context, classID uuid.UUID, dayOfWeek, periodNumber int, academicYear string) error {
	query := `
        DELETE FROM timetables
        WHERE class_id = $1 AND day_of_week = $2 AND period_number = $3
    `
	_, err := r.db.ExecResult(ctx, query, classID, dayOfWeek, periodNumber)
	return err
}

func (r *Repository) ensureNoRowsErr(err error) error {
	if err == nil {
		return nil
	}
	if err == pgx.ErrNoRows {
		return nil
	}
	return err
}
