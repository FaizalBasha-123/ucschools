package admin

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/middleware"
)

// ---------------------------------------------------------------------------
// Consent Handlers
// ---------------------------------------------------------------------------

// GetConsentHistory handles GET /admin/consent/history
func (h *Handler) GetConsentHistory(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	status := strings.TrimSpace(c.DefaultQuery("status", "all"))
	if !isValidConsentStatusFilter(status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status filter"})
		return
	}
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	items, err := h.service.ListConsentHistory(c.Request.Context(), schoolID, status, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list consent history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

// WithdrawConsent handles POST /admin/consent/:id/withdraw
func (h *Handler) WithdrawConsent(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	consentID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid consent id"})
		return
	}

	var req WithdrawConsentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
		return
	}

	actorID := strings.TrimSpace(middleware.GetUserID(c))
	actorRole := strings.TrimSpace(middleware.GetRole(c))

	err = h.service.WithdrawConsent(c.Request.Context(), schoolID, consentID, actorID, actorRole, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrConsentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		case errors.Is(err, ErrConsentAlreadyWithdrawn):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		case errors.Is(err, ErrInvalidConsentMethod):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to withdraw consent"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "consent withdrawn successfully"})
}

// ---------------------------------------------------------------------------
// DSR Handlers
// ---------------------------------------------------------------------------

// CreateDSR handles POST /admin/dsr
func (h *Handler) CreateDSR(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	var req CreateDSRRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
		return
	}

	actorID := strings.TrimSpace(middleware.GetUserID(c))
	actorRole := strings.TrimSpace(middleware.GetRole(c))

	dsr, err := h.service.CreateDSR(c.Request.Context(), schoolID, actorID, actorRole, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidDSRType):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create data subject request"})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"dsr": dsr})
}

// ListDSRs handles GET /admin/dsr
func (h *Handler) ListDSRs(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	status := strings.TrimSpace(c.DefaultQuery("status", "all"))
	if !isValidDSRStatusFilter(status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status filter"})
		return
	}
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	items, err := h.service.ListDSRs(c.Request.Context(), schoolID, status, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list data subject requests"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

// GetDSR handles GET /admin/dsr/:id
func (h *Handler) GetDSR(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	dsrID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dsr id"})
		return
	}

	dsr, err := h.service.GetDSR(c.Request.Context(), schoolID, dsrID)
	if err != nil {
		if errors.Is(err, ErrDSRNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get data subject request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"dsr": dsr})
}

// UpdateDSRStatus handles PUT /admin/dsr/:id/status
func (h *Handler) UpdateDSRStatus(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	dsrID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dsr id"})
		return
	}

	var req UpdateDSRStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body", "details": err.Error()})
		return
	}

	actorID := strings.TrimSpace(middleware.GetUserID(c))
	actorRole := strings.TrimSpace(middleware.GetRole(c))

	err = h.service.UpdateDSRStatus(c.Request.Context(), schoolID, dsrID, actorID, actorRole, req)
	if err != nil {
		switch {
		case errors.Is(err, ErrDSRNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		case errors.Is(err, ErrInvalidDSRTransition):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update data subject request status"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "status updated successfully"})
}

// ---------------------------------------------------------------------------
// Audit Event Handlers
// ---------------------------------------------------------------------------

// GetConsentAuditEvents handles GET /admin/consent/audit
func (h *Handler) GetConsentAuditEvents(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school scope"})
		return
	}

	eventType := strings.TrimSpace(c.DefaultQuery("event_type", ""))
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	items, err := h.service.ListConsentAuditEvents(c.Request.Context(), schoolID, eventType, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list audit events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

func isValidConsentStatusFilter(status string) bool {
	switch strings.TrimSpace(status) {
	case "", "all", "active", "withdrawn":
		return true
	default:
		return false
	}
}

func isValidDSRStatusFilter(status string) bool {
	switch strings.TrimSpace(status) {
	case "", "all", "submitted", "under_review", "approved", "rejected", "completed", "cancelled":
		return true
	default:
		return false
	}
}


