//go:build experimental_consent
// +build experimental_consent

package student

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Consent-related errors
var (
	ErrConsentNotRequired      = errors.New("parental consent not required for adults")
	ErrConsentAlreadyGiven     = errors.New("consent already given")
	ErrConsentNotFound         = errors.New("consent record not found")
	ErrWithdrawalNotAllowed    = errors.New("consent withdrawal not allowed")
	ErrWithdrawalRequestExists = errors.New("withdrawal request already pending")
	ErrWithdrawalNotFound      = errors.New("withdrawal request not found")
	ErrUnauthorized            = errors.New("unauthorized action")
)

// ConsentStatus represents student consent state
type ConsentStatus struct {
	Status           string     `json:"status"` // not_required, pending, active, withdrawal_requested, withdrawn
	IsMinor          bool       `json:"is_minor"`
	Age              int        `json:"age"`
	ConsentedAt      *time.Time `json:"consented_at,omitempty"`
	ConsentVersion   string     `json:"consent_version,omitempty"`
	HasActiveRequest bool       `json:"has_active_request"`
}

// ParentalConsent represents a consent record
type ParentalConsent struct {
	ID                     uuid.UUID  `json:"id" db:"id"`
	SchoolID               uuid.UUID  `json:"school_id" db:"school_id"`
	StudentID              *uuid.UUID `json:"student_id,omitempty" db:"student_id"`
	StudentUserID          *uuid.UUID `json:"student_user_id,omitempty" db:"student_user_id"`
	AdmissionApplicationID uuid.UUID  `json:"admission_application_id" db:"admission_application_id"`
	StudentDateOfBirth     time.Time  `json:"student_date_of_birth" db:"student_date_of_birth"`
	GuardianName           string     `json:"guardian_name" db:"guardian_name"`
	GuardianPhone          string     `json:"guardian_phone" db:"guardian_phone"`
	GuardianRelation       *string    `json:"guardian_relation,omitempty" db:"guardian_relation"`
	ConsentMethod          string     `json:"consent_method" db:"consent_method"` // otp, written, digital, in_person, other
	DeclarationAccepted    bool       `json:"declaration_accepted" db:"declaration_accepted"`
	ConsentReference       *string    `json:"consent_reference,omitempty" db:"consent_reference"`
	ConsentIP              *string    `json:"consent_ip,omitempty" db:"consent_ip"`
	ConsentUserAgent       *string    `json:"consent_user_agent,omitempty" db:"consent_user_agent"`
	PolicyVersion          string     `json:"policy_version" db:"policy_version"`
	Status                 string     `json:"status" db:"status"` // active, withdrawn
	ConsentedAt            time.Time  `json:"consented_at" db:"consented_at"`
	WithdrawnAt            *time.Time `json:"withdrawn_at,omitempty" db:"withdrawn_at"`
	WithdrawnBy            *string    `json:"withdrawn_by,omitempty" db:"withdrawn_by"`
	WithdrawalReason       *string    `json:"withdrawal_reason,omitempty" db:"withdrawal_reason"`
	WithdrawalMethod       *string    `json:"withdrawal_method,omitempty" db:"withdrawal_method"`
	CreatedAt              time.Time  `json:"created_at" db:"created_at"`
}

// ConsentWithdrawalRequest represents a withdrawal request
type ConsentWithdrawalRequest struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	SchoolID    uuid.UUID  `json:"school_id" db:"school_id"`
	StudentID   uuid.UUID  `json:"student_id" db:"student_id"`
	ConsentID   *uuid.UUID `json:"consent_id,omitempty" db:"consent_id"`
	RequestedAt time.Time  `json:"requested_at" db:"requested_at"`
	RequestedBy string     `json:"requested_by" db:"requested_by"` // 'parent'
	Reason      *string    `json:"reason,omitempty" db:"reason"`
	Status      string     `json:"status" db:"status"` // pending, approved, rejected, cancelled
	AdminNotes  *string    `json:"admin_notes,omitempty" db:"admin_notes"`
	ProcessedBy *uuid.UUID `json:"processed_by,omitempty" db:"processed_by"`
	ProcessedAt *time.Time `json:"processed_at,omitempty" db:"processed_at"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	StudentName     string `json:"student_name,omitempty"`
	AdmissionNumber string `json:"admission_number,omitempty"`
	ClassName       string `json:"class_name,omitempty"`
	ParentPhone     string `json:"parent_phone,omitempty"`
}

// ConsentAuditEvent represents an audit log entry
type ConsentAuditEvent struct {
	ID        uuid.UUID              `json:"id" db:"id"`
	SchoolID  uuid.UUID              `json:"school_id" db:"school_id"`
	ConsentID *uuid.UUID             `json:"consent_id,omitempty" db:"consent_id"`
	DsrID     *uuid.UUID             `json:"dsr_id,omitempty" db:"dsr_id"`
	EventType string                 `json:"event_type" db:"event_type"` // consent_granted, consent_withdrawn, etc.
	ActorID   *string                `json:"actor_id,omitempty" db:"actor_id"`
	ActorRole *string                `json:"actor_role,omitempty" db:"actor_role"`
	Metadata  map[string]interface{} `json:"metadata" db:"metadata"`
	CreatedAt time.Time              `json:"created_at" db:"created_at"`
}

// GetConsentStatus returns the consent status for a student
func (s *Service) GetConsentStatus(ctx context.Context, studentID uuid.UUID) (*ConsentStatus, error) {
	student, err := s.repo.GetByID(ctx, studentID)
	if err != nil {
		return nil, err
	}

	age := calculateAge(student.DateOfBirth)
	isMinor := age < 18

	status := &ConsentStatus{
		Status:  student.ConsentStatus,
		IsMinor: isMinor,
		Age:     age,
	}

	// Get active consent if exists
	if student.ConsentStatus == "active" {
		consent, err := s.repo.GetActiveConsentByStudentID(ctx, studentID)
		if err == nil && consent != nil {
			status.ConsentedAt = &consent.ConsentedAt
			status.ConsentVersion = consent.PolicyVersion
		}
	}

	// Check for pending withdrawal request
	hasRequest, err := s.repo.HasPendingWithdrawalRequest(ctx, studentID)
	if err == nil {
		status.HasActiveRequest = hasRequest
	}

	return status, nil
}

// AcceptConsent records parental consent via student login
func (s *Service) AcceptConsent(ctx context.Context, studentUserID uuid.UUID, ipAddress, userAgent string) (*ParentalConsent, error) {
	// Get student by user ID
	student, err := s.repo.GetByUserID(ctx, studentUserID)
	if err != nil {
		return nil, err
	}

	// Check if minor
	age := calculateAge(student.DateOfBirth)
	if age >= 18 {
		return nil, ErrConsentNotRequired
	}

	// Check if already consented
	if student.ConsentStatus == "active" {
		return nil, ErrConsentAlreadyGiven
	}

	// Create consent record
	consent := &ParentalConsent{
		ID:                  uuid.New(),
		SchoolID:            student.SchoolID,
		StudentID:           &student.ID,
		StudentUserID:       &student.UserID,
		StudentDateOfBirth:  student.DateOfBirth,
		GuardianName:        getGuardianName(student),
		GuardianPhone:       getGuardianPhone(student),
		ConsentMethod:       "digital", // Via student login
		DeclarationAccepted: true,
		ConsentIP:           &ipAddress,
		ConsentUserAgent:    &userAgent,
		PolicyVersion:       "2026-03-28", // Current version
		Status:              "active",
		ConsentedAt:         time.Now(),
	}

	// Save consent
	if err := s.repo.CreateConsent(ctx, consent); err != nil {
		return nil, fmt.Errorf("failed to create consent: %w", err)
	}

	// Update student consent status
	if err := s.repo.UpdateConsentStatus(ctx, student.ID, "active"); err != nil {
		return nil, fmt.Errorf("failed to update student status: %w", err)
	}

	// Log audit event
	s.repo.LogConsentAudit(ctx, ConsentAuditEvent{
		ID:        uuid.New(),
		SchoolID:  student.SchoolID,
		ConsentID: &consent.ID,
		EventType: "consent_granted",
		ActorID:   stringPtr(studentUserID.String()),
		ActorRole: stringPtr("student"),
		Metadata: map[string]interface{}{
			"method":           "digital",
			"ip_address":       ipAddress,
			"student_name":     student.FullName,
			"admission_number": student.AdmissionNumber,
		},
		CreatedAt: time.Now(),
	})

	return consent, nil
}

// RequestConsentWithdrawal creates a withdrawal request (parent via student login)
func (s *Service) RequestConsentWithdrawal(ctx context.Context, studentUserID uuid.UUID, reason *string) (*ConsentWithdrawalRequest, error) {
	// Get student
	student, err := s.repo.GetByUserID(ctx, studentUserID)
	if err != nil {
		return nil, err
	}

	// Check if consent is active
	if student.ConsentStatus != "active" {
		return nil, ErrWithdrawalNotAllowed
	}

	// Check for existing pending request
	hasRequest, err := s.repo.HasPendingWithdrawalRequest(ctx, student.ID)
	if err != nil {
		return nil, err
	}
	if hasRequest {
		return nil, ErrWithdrawalRequestExists
	}

	// Get active consent
	consent, err := s.repo.GetActiveConsentByStudentID(ctx, student.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get consent: %w", err)
	}

	// Create withdrawal request
	request := &ConsentWithdrawalRequest{
		ID:          uuid.New(),
		SchoolID:    student.SchoolID,
		StudentID:   student.ID,
		ConsentID:   &consent.ID,
		RequestedAt: time.Now(),
		RequestedBy: "parent",
		Reason:      reason,
		Status:      "pending",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.repo.CreateWithdrawalRequest(ctx, request); err != nil {
		return nil, fmt.Errorf("failed to create withdrawal request: %w", err)
	}

	// Update student status
	if err := s.repo.UpdateConsentStatus(ctx, student.ID, "withdrawal_requested"); err != nil {
		return nil, fmt.Errorf("failed to update student status: %w", err)
	}

	return request, nil
}

// Helper functions
func calculateAge(dob time.Time) int {
	now := time.Now()
	age := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		age--
	}
	return age
}

func getGuardianName(student *Student) string {
	if student.ParentName != nil {
		return *student.ParentName
	}
	return "Unknown"
}

func getGuardianPhone(student *Student) string {
	if student.ParentPhone != nil {
		return *student.ParentPhone
	}
	return ""
}

func stringPtr(s string) *string {
	return &s
}
