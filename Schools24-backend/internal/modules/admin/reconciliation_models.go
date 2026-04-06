package admin

import (
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Federated Identity Verification
// ---------------------------------------------------------------------------

// VerifyLearnerRequest is the request body for POST /admin/learners/:id/verify.
type VerifyLearnerRequest struct {
	VerificationType string `json:"verification_type" binding:"required"` // apaar | abc | both
	DryRun           bool   `json:"dry_run"`
}

// VerificationResult captures the outcome of a federated identity check.
type VerificationResult struct {
	StudentID              uuid.UUID  `json:"student_id"`
	APAARStatus            string     `json:"apaar_status,omitempty"`       // pending_external_verification | not_found | error | skipped
	ABCStatus              string     `json:"abc_status,omitempty"`         // pending_external_verification | not_found | error | skipped
	VerificationStatus     string     `json:"identity_verification_status"` // pending_external_verification | failed | unverified
	APAARVerifiedAt        *time.Time `json:"apaar_verified_at,omitempty"`
	ABCVerifiedAt          *time.Time `json:"abc_verified_at,omitempty"`
	ReconciliationRequired bool       `json:"reconciliation_required"`
	Message                string     `json:"message"`
}

// StudentFederatedIdentity represents a student's federated ID fields.
type StudentFederatedIdentity struct {
	ID                         uuid.UUID  `json:"id"`
	SchoolID                   uuid.UUID  `json:"school_id"`
	FullName                   string     `json:"full_name"`
	APAARID                    *string    `json:"apaar_id,omitempty"`
	ABCID                      *string    `json:"abc_id,omitempty"`
	APAARVerifiedAt            *time.Time `json:"apaar_verified_at,omitempty"`
	ABCVerifiedAt              *time.Time `json:"abc_verified_at,omitempty"`
	IdentityVerificationStatus string     `json:"identity_verification_status"`
}

// ---------------------------------------------------------------------------
// Reconciliation Hardening
// ---------------------------------------------------------------------------

// ReconciliationSummary is a compact summary for the compliance console.
type ReconciliationSummary struct {
	Total     int `json:"total"`
	Pending   int `json:"pending"`
	Merged    int `json:"merged"`
	Dismissed int `json:"dismissed"`
	Unmerged  int `json:"unmerged"`
}
