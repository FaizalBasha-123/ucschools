package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Consent + DSR Errors
// ---------------------------------------------------------------------------

var (
	ErrConsentNotFound      = errors.New("consent record not found")
	ErrConsentAlreadyWithdrawn = errors.New("consent is already withdrawn")
	ErrDSRNotFound          = errors.New("data subject request not found")
	ErrInvalidDSRTransition = errors.New("invalid DSR status transition")
	ErrInvalidConsentMethod = errors.New("invalid consent/withdrawal method")
	ErrInvalidDSRType       = errors.New("invalid DSR request type")
)

// ---------------------------------------------------------------------------
// Consent Service Methods
// ---------------------------------------------------------------------------

// ListConsentHistory returns consent records for the school in the caller's scope.
func (s *Service) ListConsentHistory(ctx context.Context, schoolID uuid.UUID, status string, limit int) ([]ParentalConsentRecord, error) {
	if status != "" && status != "all" {
		switch status {
		case "active", "withdrawn":
		default:
			return nil, fmt.Errorf("invalid status filter: %s", status)
		}
	}
	if status == "all" {
		status = ""
	}
	return s.repo.ListConsentHistory(ctx, schoolID, status, limit)
}

// WithdrawConsent withdraws an active consent and creates an audit event.
func (s *Service) WithdrawConsent(ctx context.Context, schoolID, consentID uuid.UUID, actorID, actorRole string, req WithdrawConsentRequest) error {
	if err := validateConsentMethod(req.Method); err != nil {
		return err
	}

	consent, err := s.repo.GetConsentByID(ctx, schoolID, consentID)
	if err != nil {
		return ErrConsentNotFound
	}
	if consent.Status == "withdrawn" {
		return ErrConsentAlreadyWithdrawn
	}

	if err := s.repo.WithdrawConsent(ctx, schoolID, consentID, actorID, req.Reason, req.Method); err != nil {
		return err
	}

	// Create immutable audit event
	_ = s.repo.CreateConsentAuditEvent(ctx, schoolID, &consentID, nil, "consent_withdrawn", actorID, actorRole, map[string]any{
		"reason": req.Reason,
		"method": req.Method,
	})

	return nil
}

// ---------------------------------------------------------------------------
// DSR Service Methods
// ---------------------------------------------------------------------------

// CreateDSR creates a new data subject request and logs an audit event.
func (s *Service) CreateDSR(ctx context.Context, schoolID uuid.UUID, actorID, actorRole string, req CreateDSRRequest) (*DataSubjectRequest, error) {
	if err := validateDSRType(req.RequestType); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.RequesterName) == "" {
		return nil, fmt.Errorf("requester_name is required")
	}

	dsr, err := s.repo.CreateDSR(ctx, schoolID, req)
	if err != nil {
		return nil, err
	}

	// Audit event
	_ = s.repo.CreateConsentAuditEvent(ctx, schoolID, nil, &dsr.ID, "dsr_submitted", actorID, actorRole, map[string]any{
		"request_type": req.RequestType,
	})

	return dsr, nil
}

// ListDSRs returns DSR tickets for a school.
func (s *Service) ListDSRs(ctx context.Context, schoolID uuid.UUID, status string, limit int) ([]DataSubjectRequest, error) {
	if status == "all" {
		status = ""
	}
	return s.repo.ListDSRs(ctx, schoolID, status, limit)
}

// GetDSR returns a single DSR by ID.
func (s *Service) GetDSR(ctx context.Context, schoolID, dsrID uuid.UUID) (*DataSubjectRequest, error) {
	dsr, err := s.repo.GetDSR(ctx, schoolID, dsrID)
	if err != nil {
		return nil, ErrDSRNotFound
	}
	return dsr, nil
}

// UpdateDSRStatus transitions a DSR to a new status with validation.
func (s *Service) UpdateDSRStatus(ctx context.Context, schoolID, dsrID uuid.UUID, actorID, actorRole string, req UpdateDSRStatusRequest) error {
	if err := validateDSRStatusTransition(req.Status); err != nil {
		return err
	}

	dsr, err := s.repo.GetDSR(ctx, schoolID, dsrID)
	if err != nil {
		return ErrDSRNotFound
	}

	// Validate state machine transitions
	if !isValidDSRTransition(dsr.Status, req.Status) {
		return fmt.Errorf("%w: cannot transition from %s to %s", ErrInvalidDSRTransition, dsr.Status, req.Status)
	}

	if err := s.repo.UpdateDSRStatus(ctx, schoolID, dsrID, req.Status, actorID, req.ResolutionNotes, req.ReviewNote); err != nil {
		return err
	}

	// Map status to audit event type
	eventType := "dsr_" + req.Status
	_ = s.repo.CreateConsentAuditEvent(ctx, schoolID, nil, &dsrID, eventType, actorID, actorRole, map[string]any{
		"old_status": dsr.Status,
		"new_status": req.Status,
	})

	return nil
}

// ListConsentAuditEvents returns audit events for a school.
func (s *Service) ListConsentAuditEvents(ctx context.Context, schoolID uuid.UUID, eventType string, limit int) ([]ConsentAuditEvent, error) {
	return s.repo.ListConsentAuditEvents(ctx, schoolID, eventType, limit)
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

func validateConsentMethod(method string) error {
	switch strings.TrimSpace(method) {
	case "otp", "written", "digital", "in_person", "other":
		return nil
	default:
		return ErrInvalidConsentMethod
	}
}

func validateDSRType(requestType string) error {
	switch strings.TrimSpace(requestType) {
	case "access", "rectification", "erasure", "portability", "objection":
		return nil
	default:
		return ErrInvalidDSRType
	}
}

func validateDSRStatusTransition(status string) error {
	switch strings.TrimSpace(status) {
	case "under_review", "approved", "rejected", "completed", "cancelled":
		return nil
	default:
		return ErrInvalidDSRTransition
	}
}

// isValidDSRTransition enforces the DSR state machine.
func isValidDSRTransition(from, to string) bool {
	allowed := map[string][]string{
		"submitted":    {"under_review", "cancelled"},
		"under_review": {"approved", "rejected", "cancelled"},
		"approved":     {"completed", "cancelled"},
		"rejected":     {},
		"completed":    {},
		"cancelled":    {},
	}

	for _, v := range allowed[from] {
		if v == to {
			return true
		}
	}
	return false
}
