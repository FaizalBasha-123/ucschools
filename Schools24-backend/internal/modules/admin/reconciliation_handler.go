package admin

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Identity Verification Handlers
// ---------------------------------------------------------------------------

// VerifyLearnerIdentity handles POST /admin/learners/:id/verify.
// Triggers federated identity verification (APAAR/ABC) for a student.
func (h *Handler) VerifyLearnerIdentity(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	studentID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student id"})
		return
	}

	var req VerifyLearnerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
		return
	}

	result, err := h.service.VerifyLearnerIdentity(c.Request.Context(), schoolID, studentID, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrStudentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify learner identity"})
		}
		return
	}

	statusCode := http.StatusOK
	if req.DryRun {
		statusCode = http.StatusOK
	}
	c.JSON(statusCode, gin.H{"result": result})
}

// GetStudentFederatedIdentity handles GET /admin/learners/:id/identity.
func (h *Handler) GetStudentFederatedIdentity(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	studentID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid student id"})
		return
	}

	identity, err := h.service.GetStudentFederatedIdentity(c.Request.Context(), schoolID, studentID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "student not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"identity": identity})
}

// ListUnverifiedStudents handles GET /admin/learners/unverified.
func (h *Handler) ListUnverifiedStudents(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	items, err := h.service.ListUnverifiedStudents(c.Request.Context(), schoolID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list unverified students"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

// GetReconciliationSummary handles GET /admin/reconciliations/summary.
func (h *Handler) GetReconciliationSummary(c *gin.Context) {
	summary, err := h.service.GetReconciliationSummary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get reconciliation summary"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"summary": summary})
}

// ---------------------------------------------------------------------------
// Service Methods (Verification + Summary)
// ---------------------------------------------------------------------------

var ErrStudentNotFound = errors.New("student not found")

// VerifyLearnerIdentity triggers verification for a student's federated IDs.
func (s *Service) VerifyLearnerIdentity(ctx context.Context, schoolID, studentID uuid.UUID, req VerifyLearnerRequest) (*VerificationResult, error) {
	student, err := s.repo.GetStudentFederatedIdentity(ctx, schoolID, studentID)
	if err != nil {
		return nil, ErrStudentNotFound
	}

	result := &VerificationResult{
		StudentID:   studentID,
		APAARStatus: "skipped",
		ABCStatus:   "skipped",
	}

	verifyAPAAR := req.VerificationType == "apaar" || req.VerificationType == "both"
	verifyABC := req.VerificationType == "abc" || req.VerificationType == "both"

	// APAAR verification
	if verifyAPAAR && student.APAARID != nil && strings.TrimSpace(*student.APAARID) != "" {
		result.APAARStatus = "pending_external_verification"
	} else if verifyAPAAR {
		result.APAARStatus = "not_found"
	}

	// ABC verification
	if verifyABC && student.ABCID != nil && strings.TrimSpace(*student.ABCID) != "" {
		result.ABCStatus = "pending_external_verification"
	} else if verifyABC {
		result.ABCStatus = "not_found"
	}

	// Determine overall status
	switch {
	case result.APAARStatus == "pending_external_verification" || result.ABCStatus == "pending_external_verification":
		result.VerificationStatus = "pending_external_verification"
		result.Message = "Official APAAR/ABC verification is not enabled yet. Existing IDs were kept for later verification."
	case result.APAARStatus == "not_found" && result.ABCStatus == "not_found":
		result.VerificationStatus = "failed"
		result.Message = "No federated IDs found for verification"
	default:
		result.VerificationStatus = "unverified"
		result.Message = "Official federated verification is pending configuration"
	}

	// Persist verification results (skip if dry run)
	if !req.DryRun {
		_ = s.repo.UpdateIdentityVerificationStatus(ctx, studentID, result.VerificationStatus, result.APAARVerifiedAt, result.ABCVerifiedAt)

		// Create audit event
		_ = s.repo.CreateConsentAuditEvent(ctx, schoolID, nil, nil, "identity_verification_deferred", "", "", map[string]any{
			"student_id":   studentID.String(),
			"apaar_status": result.APAARStatus,
			"abc_status":   result.ABCStatus,
			"overall":      result.VerificationStatus,
		})
	}

	return result, nil
}

func (s *Service) GetStudentFederatedIdentity(ctx context.Context, schoolID, studentID uuid.UUID) (*StudentFederatedIdentity, error) {
	return s.repo.GetStudentFederatedIdentity(ctx, schoolID, studentID)
}

func (s *Service) ListUnverifiedStudents(ctx context.Context, schoolID uuid.UUID, limit int) ([]StudentFederatedIdentity, error) {
	return s.repo.ListUnverifiedStudents(ctx, schoolID, limit)
}

func (s *Service) GetReconciliationSummary(ctx context.Context) (*ReconciliationSummary, error) {
	return s.repo.GetReconciliationSummary(ctx)
}
