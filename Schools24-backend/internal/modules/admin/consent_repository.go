package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Consent Repository
// ---------------------------------------------------------------------------

// ListConsentHistory lists parental consent records for a school.
func (r *Repository) ListConsentHistory(ctx context.Context, schoolID uuid.UUID, status string, limit int) ([]ParentalConsentRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	statusFilter := strings.TrimSpace(status)

	rows, err := r.db.Query(ctx, `
		SELECT
			id, school_id, admission_application_id, student_user_id,
			COALESCE(TO_CHAR(student_date_of_birth, 'YYYY-MM-DD'), ''),
			guardian_name, guardian_phone, COALESCE(guardian_relation, ''),
			consent_method, declaration_accepted,
			COALESCE(consent_reference, ''), COALESCE(policy_version, ''),
			COALESCE(status, 'active'), consented_at,
			withdrawn_at, withdrawn_by, withdrawal_reason, withdrawal_method,
			created_at
		FROM parental_consents
		WHERE school_id = $1
		  AND ($3 = '' OR status = $3)
		ORDER BY consented_at DESC
		LIMIT $2
	`, schoolID, limit, statusFilter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ParentalConsentRecord, 0, limit)
	for rows.Next() {
		var c ParentalConsentRecord
		if err := rows.Scan(
			&c.ID, &c.SchoolID, &c.AdmissionApplicationID, &c.StudentUserID,
			&c.StudentDateOfBirth,
			&c.GuardianName, &c.GuardianPhone, &c.GuardianRelation,
			&c.ConsentMethod, &c.DeclarationAcceptd,
			&c.ConsentReference, &c.PolicyVersion,
			&c.Status, &c.ConsentedAt,
			&c.WithdrawnAt, &c.WithdrawnBy, &c.WithdrawalReason, &c.WithdrawalMethod,
			&c.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

// GetConsentByID fetches a single consent record by ID within a school scope.
func (r *Repository) GetConsentByID(ctx context.Context, schoolID, consentID uuid.UUID) (*ParentalConsentRecord, error) {
	var c ParentalConsentRecord
	err := r.db.QueryRow(ctx, `
		SELECT
			id, school_id, admission_application_id, student_user_id,
			COALESCE(TO_CHAR(student_date_of_birth, 'YYYY-MM-DD'), ''),
			guardian_name, guardian_phone, COALESCE(guardian_relation, ''),
			consent_method, declaration_accepted,
			COALESCE(consent_reference, ''), COALESCE(policy_version, ''),
			COALESCE(status, 'active'), consented_at,
			withdrawn_at, withdrawn_by, withdrawal_reason, withdrawal_method,
			created_at
		FROM parental_consents
		WHERE id = $1 AND school_id = $2
	`, consentID, schoolID).Scan(
		&c.ID, &c.SchoolID, &c.AdmissionApplicationID, &c.StudentUserID,
		&c.StudentDateOfBirth,
		&c.GuardianName, &c.GuardianPhone, &c.GuardianRelation,
		&c.ConsentMethod, &c.DeclarationAcceptd,
		&c.ConsentReference, &c.PolicyVersion,
		&c.Status, &c.ConsentedAt,
		&c.WithdrawnAt, &c.WithdrawnBy, &c.WithdrawalReason, &c.WithdrawalMethod,
		&c.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// WithdrawConsent marks a consent record as withdrawn.
func (r *Repository) WithdrawConsent(ctx context.Context, schoolID, consentID uuid.UUID, withdrawnBy, reason, method string) error {
	return r.db.Exec(ctx, `
		UPDATE parental_consents
		SET
			status = 'withdrawn',
			withdrawn_at = NOW(),
			withdrawn_by = NULLIF(TRIM($3), ''),
			withdrawal_reason = NULLIF(TRIM($4), ''),
			withdrawal_method = NULLIF(TRIM($5), '')
		WHERE id = $1 AND school_id = $2 AND status = 'active'
	`, consentID, schoolID, withdrawnBy, reason, method)
}

// ---------------------------------------------------------------------------
// Data Subject Request Repository
// ---------------------------------------------------------------------------

// CreateDSR inserts a new data subject request.
func (r *Repository) CreateDSR(ctx context.Context, schoolID uuid.UUID, req CreateDSRRequest) (*DataSubjectRequest, error) {
	var studentID *uuid.UUID
	if req.SubjectStudentID != nil && strings.TrimSpace(*req.SubjectStudentID) != "" {
		parsed, err := uuid.Parse(strings.TrimSpace(*req.SubjectStudentID))
		if err != nil {
			return nil, fmt.Errorf("invalid subject_student_id: %w", err)
		}
		studentID = &parsed
	}

	item := &DataSubjectRequest{}
	err := r.db.QueryRow(ctx, `
		INSERT INTO data_subject_requests (
			school_id, requester_name, requester_email, requester_phone, requester_relation,
			subject_student_id, subject_name, request_type, description,
			status, submitted_at, created_at, updated_at
		)
		VALUES (
			$1, $2, NULLIF(TRIM($3), ''), NULLIF(TRIM($4), ''), NULLIF(TRIM($5), ''),
			$6, NULLIF(TRIM($7), ''), $8, NULLIF(TRIM($9), ''),
			'submitted', NOW(), NOW(), NOW()
		)
		RETURNING
			id, school_id,
			requester_name, requester_email, requester_phone, requester_relation,
			subject_student_id, subject_name,
			request_type, status, description, resolution_notes,
			assigned_to, reviewed_by, review_note,
			submitted_at, reviewed_at, completed_at,
			created_at, updated_at
	`, schoolID,
		strings.TrimSpace(req.RequesterName),
		derefString(req.RequesterEmail),
		derefString(req.RequesterPhone),
		derefString(req.RequesterRelation),
		studentID,
		derefString(req.SubjectName),
		strings.TrimSpace(req.RequestType),
		derefString(req.Description),
	).Scan(
		&item.ID, &item.SchoolID,
		&item.RequesterName, &item.RequesterEmail, &item.RequesterPhone, &item.RequesterRelation,
		&item.SubjectStudentID, &item.SubjectName,
		&item.RequestType, &item.Status, &item.Description, &item.ResolutionNotes,
		&item.AssignedTo, &item.ReviewedBy, &item.ReviewNote,
		&item.SubmittedAt, &item.ReviewedAt, &item.CompletedAt,
		&item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return item, nil
}

// ListDSRs lists data subject requests for a school.
func (r *Repository) ListDSRs(ctx context.Context, schoolID uuid.UUID, status string, limit int) ([]DataSubjectRequest, error) {
	if limit <= 0 {
		limit = 50
	}
	statusFilter := strings.TrimSpace(status)

	rows, err := r.db.Query(ctx, `
		SELECT
			id, school_id,
			requester_name, requester_email, requester_phone, requester_relation,
			subject_student_id, subject_name,
			request_type, status, description, resolution_notes,
			assigned_to, reviewed_by, review_note,
			submitted_at, reviewed_at, completed_at,
			created_at, updated_at
		FROM data_subject_requests
		WHERE school_id = $1
		  AND ($3 = '' OR status = $3)
		ORDER BY submitted_at DESC
		LIMIT $2
	`, schoolID, limit, statusFilter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]DataSubjectRequest, 0, limit)
	for rows.Next() {
		var d DataSubjectRequest
		if err := rows.Scan(
			&d.ID, &d.SchoolID,
			&d.RequesterName, &d.RequesterEmail, &d.RequesterPhone, &d.RequesterRelation,
			&d.SubjectStudentID, &d.SubjectName,
			&d.RequestType, &d.Status, &d.Description, &d.ResolutionNotes,
			&d.AssignedTo, &d.ReviewedBy, &d.ReviewNote,
			&d.SubmittedAt, &d.ReviewedAt, &d.CompletedAt,
			&d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	return items, rows.Err()
}

// GetDSR fetches a single DSR by ID within school scope.
func (r *Repository) GetDSR(ctx context.Context, schoolID, dsrID uuid.UUID) (*DataSubjectRequest, error) {
	var d DataSubjectRequest
	err := r.db.QueryRow(ctx, `
		SELECT
			id, school_id,
			requester_name, requester_email, requester_phone, requester_relation,
			subject_student_id, subject_name,
			request_type, status, description, resolution_notes,
			assigned_to, reviewed_by, review_note,
			submitted_at, reviewed_at, completed_at,
			created_at, updated_at
		FROM data_subject_requests
		WHERE id = $1 AND school_id = $2
	`, dsrID, schoolID).Scan(
		&d.ID, &d.SchoolID,
		&d.RequesterName, &d.RequesterEmail, &d.RequesterPhone, &d.RequesterRelation,
		&d.SubjectStudentID, &d.SubjectName,
		&d.RequestType, &d.Status, &d.Description, &d.ResolutionNotes,
		&d.AssignedTo, &d.ReviewedBy, &d.ReviewNote,
		&d.SubmittedAt, &d.ReviewedAt, &d.CompletedAt,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// UpdateDSRStatus transitions a DSR to a new status.
func (r *Repository) UpdateDSRStatus(ctx context.Context, schoolID, dsrID uuid.UUID, newStatus, reviewedBy string, resolutionNotes, reviewNote *string) error {
	now := time.Now()

	var reviewedAt *time.Time
	var completedAt *time.Time
	switch newStatus {
	case "under_review", "approved", "rejected":
		reviewedAt = &now
	case "completed":
		reviewedAt = &now
		completedAt = &now
	}

	return r.db.Exec(ctx, `
		UPDATE data_subject_requests
		SET
			status = $3,
			reviewed_by = COALESCE(NULLIF(TRIM($4), ''), reviewed_by),
			resolution_notes = COALESCE(NULLIF(TRIM($5), ''), resolution_notes),
			review_note = COALESCE(NULLIF(TRIM($6), ''), review_note),
			reviewed_at = COALESCE($7, reviewed_at),
			completed_at = COALESCE($8, completed_at),
			updated_at = NOW()
		WHERE id = $1 AND school_id = $2
	`, dsrID, schoolID, newStatus, reviewedBy,
		derefString(resolutionNotes), derefString(reviewNote),
		reviewedAt, completedAt,
	)
}

// ---------------------------------------------------------------------------
// Consent Audit Events Repository
// ---------------------------------------------------------------------------

// CreateAuditEvent inserts an immutable audit event.
func (r *Repository) CreateConsentAuditEvent(ctx context.Context, schoolID uuid.UUID, consentID, dsrID *uuid.UUID, eventType, actorID, actorRole string, metadata map[string]any) error {
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		metadataJSON = []byte("{}")
	}

	return r.db.Exec(ctx, `
		INSERT INTO consent_audit_events (
			school_id, consent_id, dsr_id, event_type, actor_id, actor_role, metadata, created_at
		)
		VALUES ($1, $2, $3, $4, NULLIF(TRIM($5), ''), NULLIF(TRIM($6), ''), $7::jsonb, NOW())
	`, schoolID, consentID, dsrID, eventType, actorID, actorRole, string(metadataJSON))
}

// ListConsentAuditEvents returns audit events for a school.
func (r *Repository) ListConsentAuditEvents(ctx context.Context, schoolID uuid.UUID, eventType string, limit int) ([]ConsentAuditEvent, error) {
	if limit <= 0 {
		limit = 50
	}
	eventTypeFilter := strings.TrimSpace(eventType)

	rows, err := r.db.Query(ctx, `
		SELECT
			id, school_id, consent_id, dsr_id,
			event_type, actor_id, actor_role, metadata,
			created_at
		FROM consent_audit_events
		WHERE school_id = $1
		  AND ($3 = '' OR event_type = $3)
		ORDER BY created_at DESC
		LIMIT $2
	`, schoolID, limit, eventTypeFilter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ConsentAuditEvent, 0, limit)
	for rows.Next() {
		var e ConsentAuditEvent
		var metadataJSON []byte
		if err := rows.Scan(
			&e.ID, &e.SchoolID, &e.ConsentID, &e.DSRID,
			&e.EventType, &e.ActorID, &e.ActorRole, &metadataJSON,
			&e.CreatedAt,
		); err != nil {
			return nil, err
		}
		if metadataJSON != nil {
			_ = json.Unmarshal(metadataJSON, &e.Metadata)
		}
		items = append(items, e)
	}
	return items, rows.Err()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
