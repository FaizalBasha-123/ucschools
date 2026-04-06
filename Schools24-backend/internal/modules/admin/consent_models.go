package admin

import (
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Consent History
// ---------------------------------------------------------------------------

// ParentalConsentRecord represents a consent entry for listing/detail views.
type ParentalConsentRecord struct {
	ID                     uuid.UUID  `json:"id"`
	SchoolID               uuid.UUID  `json:"school_id"`
	AdmissionApplicationID uuid.UUID  `json:"admission_application_id"`
	StudentUserID          *uuid.UUID `json:"student_user_id,omitempty"`

	StudentDateOfBirth string `json:"student_date_of_birth"`
	GuardianName       string `json:"guardian_name"`
	GuardianPhone      string `json:"guardian_phone"`
	GuardianRelation   string `json:"guardian_relation,omitempty"`

	ConsentMethod      string `json:"consent_method"`
	DeclarationAcceptd bool   `json:"declaration_accepted"`
	ConsentReference   string `json:"consent_reference,omitempty"`
	PolicyVersion      string `json:"policy_version"`

	Status           string     `json:"status"` // active | withdrawn
	ConsentedAt      time.Time  `json:"consented_at"`
	WithdrawnAt      *time.Time `json:"withdrawn_at,omitempty"`
	WithdrawnBy      *string    `json:"withdrawn_by,omitempty"`
	WithdrawalReason *string    `json:"withdrawal_reason,omitempty"`
	WithdrawalMethod *string    `json:"withdrawal_method,omitempty"`

	CreatedAt time.Time `json:"created_at"`
}

// WithdrawConsentRequest is the request body for POST /admin/consent/:id/withdraw.
type WithdrawConsentRequest struct {
	Reason string `json:"reason" binding:"required"`
	Method string `json:"method" binding:"required"` // otp | written | digital | in_person | other
}

// ---------------------------------------------------------------------------
// Data Subject Requests (DSR)
// ---------------------------------------------------------------------------

// DataSubjectRequest represents a DSR ticket.
type DataSubjectRequest struct {
	ID       uuid.UUID `json:"id"`
	SchoolID uuid.UUID `json:"school_id"`

	RequesterName     string  `json:"requester_name"`
	RequesterEmail    *string `json:"requester_email,omitempty"`
	RequesterPhone    *string `json:"requester_phone,omitempty"`
	RequesterRelation *string `json:"requester_relation,omitempty"`

	SubjectStudentID *uuid.UUID `json:"subject_student_id,omitempty"`
	SubjectName      *string    `json:"subject_name,omitempty"`

	RequestType     string  `json:"request_type"` // access | rectification | erasure | portability | objection
	Status          string  `json:"status"`       // submitted | under_review | approved | rejected | completed | cancelled
	Description     *string `json:"description,omitempty"`
	ResolutionNotes *string `json:"resolution_notes,omitempty"`

	AssignedTo *string `json:"assigned_to,omitempty"`
	ReviewedBy *string `json:"reviewed_by,omitempty"`
	ReviewNote *string `json:"review_note,omitempty"`

	SubmittedAt *time.Time `json:"submitted_at,omitempty"`
	ReviewedAt  *time.Time `json:"reviewed_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// CreateDSRRequest is the request body for POST /admin/dsr.
type CreateDSRRequest struct {
	RequesterName     string  `json:"requester_name" binding:"required"`
	RequesterEmail    *string `json:"requester_email,omitempty"`
	RequesterPhone    *string `json:"requester_phone,omitempty"`
	RequesterRelation *string `json:"requester_relation,omitempty"`
	SubjectStudentID  *string `json:"subject_student_id,omitempty"`
	SubjectName       *string `json:"subject_name,omitempty"`
	RequestType       string  `json:"request_type" binding:"required"`
	Description       *string `json:"description,omitempty"`
}

// UpdateDSRStatusRequest is the request body for PUT /admin/dsr/:id/status.
type UpdateDSRStatusRequest struct {
	Status          string  `json:"status" binding:"required"` // under_review | approved | rejected | completed | cancelled
	ResolutionNotes *string `json:"resolution_notes,omitempty"`
	ReviewNote      *string `json:"review_note,omitempty"`
}

// ---------------------------------------------------------------------------
// Consent Audit Events
// ---------------------------------------------------------------------------

// ConsentAuditEvent represents an immutable audit log entry.
type ConsentAuditEvent struct {
	ID        uuid.UUID      `json:"id"`
	SchoolID  uuid.UUID      `json:"school_id"`
	ConsentID *uuid.UUID     `json:"consent_id,omitempty"`
	DSRID     *uuid.UUID     `json:"dsr_id,omitempty"`
	EventType string         `json:"event_type"`
	ActorID   *string        `json:"actor_id,omitempty"`
	ActorRole *string        `json:"actor_role,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}
