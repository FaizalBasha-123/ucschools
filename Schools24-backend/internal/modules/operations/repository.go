package operations

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/shared/database"
)

// Repository handles database operations for operations module
type Repository struct {
	db *database.PostgresDB
}

// NewRepository creates a new operations repository
func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

// GetEvents retrieves events with filters (tenant-scoped)
func (r *Repository) GetEvents(ctx context.Context, schoolID uuid.UUID, eventType string, startDate, endDate *time.Time, targetGrade *int, page, pageSize int) ([]Event, int, error) {
	query := `
		SELECT id, school_id, title, description, event_date, start_time, end_time,
		       type, location, target_grade, source_assessment_id, source_subject_id, created_at, updated_at
		FROM events
		WHERE school_id = $1
	`
	args := []interface{}{schoolID}
	argCount := 1

	// Filter by type if provided
	if eventType != "" {
		argCount++
		query += fmt.Sprintf(" AND type = $%d", argCount)
		args = append(args, eventType)
	}

	// Filter by date range if provided
	if startDate != nil {
		argCount++
		query += fmt.Sprintf(" AND event_date >= $%d", argCount)
		args = append(args, *startDate)
	}
	if endDate != nil {
		argCount++
		query += fmt.Sprintf(" AND event_date <= $%d", argCount)
		args = append(args, *endDate)
	}
	if targetGrade != nil {
		argCount++
		query += fmt.Sprintf(" AND (target_grade IS NULL OR target_grade = $%d)", argCount)
		args = append(args, *targetGrade)
	}

	// Count total matching records
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM (%s) AS total", query)
	var totalCount int
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count events: %w", err)
	}

	// Add ordering and pagination
	query += " ORDER BY event_date DESC, created_at DESC"
	if pageSize > 0 {
		offset := (page - 1) * pageSize
		argCount++
		query += fmt.Sprintf(" LIMIT $%d", argCount)
		args = append(args, pageSize)
		argCount++
		query += fmt.Sprintf(" OFFSET $%d", argCount)
		args = append(args, offset)
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to fetch events: %w", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		err := rows.Scan(
			&e.ID, &e.SchoolID, &e.Title, &e.Description, &e.EventDate,
			&e.StartTime, &e.EndTime, &e.Type, &e.Location,
			&e.TargetGrade, &e.SourceAssessmentID, &e.SourceSubjectID,
			&e.CreatedAt, &e.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan event: %w", err)
		}
		events = append(events, e)
	}

	if err = rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("row iteration error: %w", err)
	}

	return events, totalCount, nil
}

// GetEventByID retrieves a single event by ID (tenant-scoped)
func (r *Repository) GetEventByID(ctx context.Context, schoolID, eventID uuid.UUID) (*Event, error) {
	query := `
		SELECT id, school_id, title, description, event_date, start_time, end_time,
		       type, location, target_grade, source_assessment_id, source_subject_id, created_at, updated_at
		FROM events
		WHERE id = $1 AND school_id = $2
	`

	var e Event
	err := r.db.QueryRow(ctx, query, eventID, schoolID).Scan(
		&e.ID, &e.SchoolID, &e.Title, &e.Description, &e.EventDate,
		&e.StartTime, &e.EndTime, &e.Type, &e.Location,
		&e.TargetGrade, &e.SourceAssessmentID, &e.SourceSubjectID,
		&e.CreatedAt, &e.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("failed to fetch event: %w", err)
	}

	return &e, nil
}

// CreateEvent creates a new event
func (r *Repository) CreateEvent(ctx context.Context, schoolID uuid.UUID, title, description string, eventDate time.Time, startTime, endTime *time.Time, eventType, location string, targetGrade *int) (uuid.UUID, error) {
	query := `
		INSERT INTO events (school_id, title, description, event_date, start_time, end_time, type, location, target_grade)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`

	var eventID uuid.UUID
	err := r.db.QueryRow(ctx, query, schoolID, title, description, eventDate, startTime, endTime, eventType, location, targetGrade).Scan(&eventID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to create event: %w", err)
	}

	return eventID, nil
}

func (r *Repository) GetStudentClassGradeByUserID(ctx context.Context, userID uuid.UUID) (*int, error) {
	var grade int
	err := r.db.QueryRow(ctx, `
		SELECT c.grade
		FROM students s
		JOIN classes c ON c.id = s.class_id
		WHERE s.user_id = $1
		LIMIT 1
	`, userID).Scan(&grade)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get student grade: %w", err)
	}
	return &grade, nil
}

// UpdateEvent updates an existing event
func (r *Repository) UpdateEvent(ctx context.Context, schoolID, eventID uuid.UUID, updates map[string]interface{}) error {
	if len(updates) == 0 {
		return nil
	}

	query := "UPDATE events SET updated_at = CURRENT_TIMESTAMP"
	args := []interface{}{eventID, schoolID}
	argCount := 2

	for field, value := range updates {
		argCount++
		query += fmt.Sprintf(", %s = $%d", field, argCount)
		args = append(args, value)
	}

	query += " WHERE id = $1 AND school_id = $2"

	cmdTag, err := r.db.ExecResult(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update event: %w", err)
	}

	if cmdTag.RowsAffected() == 0 {
		return ErrEventNotFound
	}

	return nil
}

// DeleteEvent deletes an event
func (r *Repository) DeleteEvent(ctx context.Context, schoolID, eventID uuid.UUID) error {
	query := "DELETE FROM events WHERE id = $1 AND school_id = $2"

	cmdTag, err := r.db.ExecResult(ctx, query, eventID, schoolID)
	if err != nil {
		return fmt.Errorf("failed to delete event: %w", err)
	}

	if cmdTag.RowsAffected() == 0 {
		return ErrEventNotFound
	}

	return nil
}

// GetTeacherClassGradesByUserID returns distinct class grades assigned to a teacher
// via timetable slots or class-teacher assignment (tenant-scoped).
func (r *Repository) GetTeacherClassGradesByUserID(ctx context.Context, userID uuid.UUID) ([]int32, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT c.grade
		FROM timetables t
		JOIN teachers te ON te.user_id = $1 AND te.id = t.teacher_id
		JOIN classes c ON c.id = t.class_id
		UNION
		SELECT DISTINCT c.grade
		FROM classes c
		WHERE c.class_teacher_id = (
			SELECT id FROM teachers WHERE user_id = $1 LIMIT 1
		)
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get teacher grades: %w", err)
	}
	defer rows.Close()

	grades := make([]int32, 0, 8)
	for rows.Next() {
		var g int32
		if err := rows.Scan(&g); err != nil {
			return nil, fmt.Errorf("failed to scan teacher grade: %w", err)
		}
		grades = append(grades, g)
	}
	return grades, nil
}

// GetEventsForGrades retrieves events filtered to a set of grade levels.
// If grades is empty, returns all school events (no grade filter).
// tenant-scoped via school_id.
func (r *Repository) GetEventsForGrades(ctx context.Context, schoolID uuid.UUID, grades []int32, eventType string, startDate, endDate *time.Time, page, pageSize int) ([]Event, int, error) {
	query := `
		SELECT id, school_id, title, description, event_date, start_time, end_time,
		       type, location, target_grade, source_assessment_id, source_subject_id, created_at, updated_at
		FROM events
		WHERE school_id = $1
	`
	args := []interface{}{schoolID}
	argCount := 1

	if eventType != "" {
		argCount++
		query += fmt.Sprintf(" AND type = $%d", argCount)
		args = append(args, eventType)
	}
	if startDate != nil {
		argCount++
		query += fmt.Sprintf(" AND event_date >= $%d", argCount)
		args = append(args, *startDate)
	}
	if endDate != nil {
		argCount++
		query += fmt.Sprintf(" AND event_date <= $%d", argCount)
		args = append(args, *endDate)
	}
	if len(grades) > 0 {
		argCount++
		query += fmt.Sprintf(" AND (target_grade IS NULL OR target_grade = ANY($%d))", argCount)
		args = append(args, grades)
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM (%s) AS counted", query)
	var totalCount int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&totalCount); err != nil {
		return nil, 0, fmt.Errorf("failed to count events for grades: %w", err)
	}

	query += " ORDER BY event_date ASC, created_at DESC"
	if pageSize > 0 {
		offset := (page - 1) * pageSize
		argCount++
		query += fmt.Sprintf(" LIMIT $%d", argCount)
		args = append(args, pageSize)
		argCount++
		query += fmt.Sprintf(" OFFSET $%d", argCount)
		args = append(args, offset)
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to fetch events for grades: %w", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(
			&e.ID, &e.SchoolID, &e.Title, &e.Description, &e.EventDate,
			&e.StartTime, &e.EndTime, &e.Type, &e.Location,
			&e.TargetGrade, &e.SourceAssessmentID, &e.SourceSubjectID,
			&e.CreatedAt, &e.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("failed to scan event: %w", err)
		}
		events = append(events, e)
	}
	if err = rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("row iteration error: %w", err)
	}
	return events, totalCount, nil
}
