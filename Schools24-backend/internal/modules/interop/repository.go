package interop

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/database"
)

type Repository struct {
	db *database.PostgresDB
}

func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateJob(ctx context.Context, req CreateJobRequest, requestedBy, requestedRole string, schoolID uuid.UUID, maxAttempts int) (*InteropJob, error) {
	payloadJSON, err := json.Marshal(req.Payload)
	if err != nil {
		return nil, err
	}

	item := &InteropJob{}
	err = r.db.QueryRow(ctx, `
		INSERT INTO interop_jobs (
			school_id, system, operation, status, dry_run, payload,
			requested_by, requested_role, attempt_count, max_attempts,
			idempotency_key, created_at, updated_at
		)
		VALUES ($1, $2, $3, 'pending', $4, $5::jsonb, NULLIF(TRIM($6), ''), $7, 0, $8, NULLIF(TRIM($9), ''), NOW(), NOW())
		RETURNING
			id::text, school_id::text, system, operation, status, dry_run, payload,
			COALESCE(requested_by, ''), requested_role,
			COALESCE(idempotency_key, ''),
			attempt_count, max_attempts,
			COALESCE(last_error, ''), response_code, COALESCE(response_body, ''),
			created_at, updated_at, started_at, completed_at
	`, schoolID, string(req.System), string(req.Operation), req.DryRun, string(payloadJSON), strings.TrimSpace(requestedBy), strings.TrimSpace(requestedRole), maxAttempts, req.IdempotencyKey).Scan(
		&item.ID, &item.SchoolID, &item.System, &item.Operation, &item.Status, &item.DryRun,
		&payloadJSON,
		&item.RequestedBy, &item.RequestedRole,
		&item.IdempotencyKey,
		&item.AttemptCount, &item.MaxAttempts,
		&item.LastError, &item.ResponseCode, &item.ResponseBody,
		&item.CreatedAt, &item.UpdatedAt, &item.StartedAt, &item.CompletedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(payloadJSON, &item.Payload); err != nil {
		return nil, err
	}
	return item, nil
}

// FindJobByIdempotencyKey looks up an existing job by school + idempotency key.
func (r *Repository) FindJobByIdempotencyKey(ctx context.Context, schoolID uuid.UUID, key string) (*InteropJob, error) {
	item := &InteropJob{}
	var payloadJSON []byte
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text, school_id::text, system, operation, status, dry_run, payload,
			COALESCE(requested_by, ''), requested_role,
			COALESCE(idempotency_key, ''),
			attempt_count, max_attempts,
			COALESCE(last_error, ''), response_code, COALESCE(response_body, ''),
			created_at, updated_at, started_at, completed_at
		FROM interop_jobs
		WHERE school_id = $1 AND idempotency_key = $2
		LIMIT 1
	`, schoolID, strings.TrimSpace(key)).Scan(
		&item.ID, &item.SchoolID, &item.System, &item.Operation, &item.Status, &item.DryRun,
		&payloadJSON,
		&item.RequestedBy, &item.RequestedRole,
		&item.IdempotencyKey,
		&item.AttemptCount, &item.MaxAttempts,
		&item.LastError, &item.ResponseCode, &item.ResponseBody,
		&item.CreatedAt, &item.UpdatedAt, &item.StartedAt, &item.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	if payloadJSON != nil {
		_ = json.Unmarshal(payloadJSON, &item.Payload)
	}
	return item, nil
}

func (r *Repository) MarkRunning(ctx context.Context, jobID uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE interop_jobs
		SET status = 'running', started_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, jobID)
}

func (r *Repository) MarkAttempt(ctx context.Context, jobID uuid.UUID, attempt int) error {
	return r.db.Exec(ctx, `
		UPDATE interop_jobs
		SET attempt_count = $2, updated_at = NOW()
		WHERE id = $1
	`, jobID, attempt)
}

func (r *Repository) MarkSuccess(ctx context.Context, jobID uuid.UUID, attempt, responseCode int, responseBody string) error {
	return r.db.Exec(ctx, `
		UPDATE interop_jobs
		SET
			status = 'succeeded',
			attempt_count = $2,
			response_code = $3,
			response_body = NULLIF($4, ''),
			last_error = NULL,
			completed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, jobID, attempt, responseCode, responseBody)
}

func (r *Repository) ResolveDLQForJob(ctx context.Context, jobID uuid.UUID, note string) error {
	return r.db.Exec(ctx, `
		UPDATE interop_dead_letter_queue
		SET
			status = 'resolved',
			resolution_notes = NULLIF($2, ''),
			resolved_at = NOW(),
			updated_at = NOW()
		WHERE job_id = $1
	`, jobID, strings.TrimSpace(note))
}

func (r *Repository) MarkFailedAttempt(ctx context.Context, jobID uuid.UUID, attempt, responseCode int, responseBody, errMsg string) error {
	return r.db.Exec(ctx, `
		UPDATE interop_jobs
		SET
			attempt_count = $2,
			response_code = $3,
			response_body = NULLIF($4, ''),
			last_error = NULLIF($5, ''),
			updated_at = NOW()
		WHERE id = $1
	`, jobID, attempt, responseCode, responseBody, errMsg)
}

func (r *Repository) MarkFailedFinal(ctx context.Context, jobID uuid.UUID, schoolID uuid.UUID, system ExternalSystem, operation Operation, payload map[string]any, attempt, responseCode int, responseBody, errMsg string) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	if err := r.db.Exec(ctx, `
		UPDATE interop_jobs
		SET
			status = 'failed',
			attempt_count = $2,
			response_code = $3,
			response_body = NULLIF($4, ''),
			last_error = NULLIF($5, ''),
			completed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, jobID, attempt, responseCode, responseBody, errMsg); err != nil {
		return err
	}

	return r.db.Exec(ctx, `
		INSERT INTO interop_dead_letter_queue (
			school_id, job_id, system, operation, payload,
			attempt_count, error_message, response_code, response_body,
			status, created_at, updated_at
		)
		VALUES (
			$1, $2, $3, $4, $5::jsonb,
			$6, NULLIF($7, ''), $8, NULLIF($9, ''),
			'pending', NOW(), NOW()
		)
		ON CONFLICT (job_id)
		DO UPDATE SET
			attempt_count = EXCLUDED.attempt_count,
			error_message = EXCLUDED.error_message,
			response_code = EXCLUDED.response_code,
			response_body = EXCLUDED.response_body,
			updated_at = NOW()
	`, schoolID, jobID, string(system), string(operation), string(payloadJSON), attempt, errMsg, responseCode, responseBody)
}

func (r *Repository) GetJob(ctx context.Context, jobID uuid.UUID) (*InteropJob, error) {
	payloadJSON := []byte("{}")
	item := &InteropJob{}
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text, school_id::text, system, operation, status, dry_run, payload,
			COALESCE(requested_by, ''), requested_role,
			attempt_count, max_attempts,
			COALESCE(last_error, ''), response_code, COALESCE(response_body, ''),
			created_at, updated_at, started_at, completed_at
		FROM interop_jobs
		WHERE id = $1
	`, jobID).Scan(
		&item.ID, &item.SchoolID, &item.System, &item.Operation, &item.Status, &item.DryRun,
		&payloadJSON,
		&item.RequestedBy, &item.RequestedRole,
		&item.AttemptCount, &item.MaxAttempts,
		&item.LastError, &item.ResponseCode, &item.ResponseBody,
		&item.CreatedAt, &item.UpdatedAt, &item.StartedAt, &item.CompletedAt,
	)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(payloadJSON, &item.Payload); err != nil {
		return nil, err
	}
	return item, nil
}

func (r *Repository) ListJobs(ctx context.Context, limit int, filter ListJobsFilter) ([]InteropJob, error) {
	if limit <= 0 {
		limit = 25
	}
	status := strings.TrimSpace(string(filter.Status))
	system := strings.TrimSpace(string(filter.System))
	if status == "all" {
		status = ""
	}
	if system == "all" {
		system = ""
	}

	rows, err := r.db.Query(ctx, `
		SELECT
			id::text, school_id::text, system, operation, status, dry_run, payload,
			COALESCE(requested_by, ''), requested_role,
			attempt_count, max_attempts,
			COALESCE(last_error, ''), response_code, COALESCE(response_body, ''),
			created_at, updated_at, started_at, completed_at
		FROM interop_jobs
		WHERE ($2 = '' OR status = $2)
		  AND ($3 = '' OR system = $3)
		ORDER BY created_at DESC
		LIMIT $1
	`, limit, status, system)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]InteropJob, 0, limit)
	for rows.Next() {
		payloadJSON := []byte("{}")
		var item InteropJob
		if err := rows.Scan(
			&item.ID, &item.SchoolID, &item.System, &item.Operation, &item.Status, &item.DryRun,
			&payloadJSON,
			&item.RequestedBy, &item.RequestedRole,
			&item.AttemptCount, &item.MaxAttempts,
			&item.LastError, &item.ResponseCode, &item.ResponseBody,
			&item.CreatedAt, &item.UpdatedAt, &item.StartedAt, &item.CompletedAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payloadJSON, &item.Payload); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repository) ResetForRetry(ctx context.Context, jobID uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE interop_jobs
		SET
			status = 'pending',
			attempt_count = 0,
			last_error = NULL,
			response_code = NULL,
			response_body = NULL,
			started_at = NULL,
			completed_at = NULL,
			updated_at = NOW()
		WHERE id = $1
	`, jobID)
}

func (r *Repository) ListRetryCandidates(ctx context.Context, schoolID uuid.UUID, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 5
	}

	rows, err := r.db.Query(ctx, `
		SELECT j.id::text
		FROM interop_dead_letter_queue d
		JOIN interop_jobs j ON j.id = d.job_id
		WHERE d.school_id = $1
		  AND j.school_id = $1
		  AND d.status = 'pending'
		  AND j.status = 'failed'
		  AND j.dry_run = false
		ORDER BY d.updated_at ASC, d.created_at ASC
		LIMIT $2
	`, schoolID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]string, 0, limit)
	for rows.Next() {
		var jobID string
		if err := rows.Scan(&jobID); err != nil {
			return nil, err
		}
		items = append(items, jobID)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repository) AcquireSchoolSweepLock(ctx context.Context, schoolID uuid.UUID) (func(), bool, error) {
	conn, err := r.db.Pool.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}

	var acquired bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext($1)::bigint)`, schoolID.String()).Scan(&acquired); err != nil {
		conn.Release()
		return nil, false, err
	}

	if !acquired {
		conn.Release()
		return nil, false, nil
	}

	unlock := func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		var unlocked bool
		_ = conn.QueryRow(unlockCtx, `SELECT pg_advisory_unlock(hashtext($1)::bigint)`, schoolID.String()).Scan(&unlocked)
		conn.Release()
	}

	return unlock, true, nil
}

func parseJobID(jobID string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(jobID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid job id")
	}
	return id, nil
}
