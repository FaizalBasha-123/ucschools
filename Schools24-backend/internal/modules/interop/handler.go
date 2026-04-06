package interop

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/middleware"
)

type Handler struct {
	service interopService
}

type interopService interface {
	Readiness() ReadinessReport
	SweeperStats() SweeperStats
	CreateJobWithMeta(ctx context.Context, req CreateJobRequest, requestedBy, requestedRole, schoolID string) (*InteropJob, bool, error)
	ListJobs(ctx context.Context, limit int, filter ListJobsFilter) ([]InteropJob, error)
	GetJob(ctx context.Context, jobID string) (*InteropJob, error)
	RetryJob(ctx context.Context, jobID string) (*InteropJob, error)
}

func NewHandler(service interopService) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetReadiness(c *gin.Context) {
	c.JSON(http.StatusOK, h.service.Readiness())
}

func (h *Handler) GetSweeperStats(c *gin.Context) {
	c.JSON(http.StatusOK, h.service.SweeperStats())
}

func (h *Handler) CreateJob(c *gin.Context) {
	ctx, schoolID, ok := resolveSchoolScopeContext(c)
	if !ok {
		return
	}

	var req CreateJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, "invalid request body", err.Error()))
		return
	}

	// Extract idempotency key from header
	req.IdempotencyKey = strings.TrimSpace(c.GetHeader("X-Idempotency-Key"))

	requestedBy := strings.TrimSpace(middleware.GetUserID(c))
	requestedRole := strings.TrimSpace(middleware.GetRole(c))
	job, idempotencyHit, err := h.service.CreateJobWithMeta(ctx, req, requestedBy, requestedRole, schoolID)
	if err != nil {
		switch {
		case errors.Is(err, ErrInteropDisabled):
			c.JSON(http.StatusPreconditionFailed, ErrorResponse(ErrCodeDisabled, err.Error(), "Set INTEROP_ENABLED=true or use dry_run=true"))
		case errors.Is(err, ErrInvalidSystem), errors.Is(err, ErrInvalidOperation), errors.Is(err, ErrValidationFailed):
			c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, err.Error(), nil))
		default:
			c.JSON(http.StatusInternalServerError, ErrorResponse(ErrCodeInternalError, "failed to create interop job", nil))
		}
		return
	}

	c.Header("X-Idempotency-Hit", strconv.FormatBool(idempotencyHit))
	if req.IdempotencyKey != "" {
		c.Header("X-Idempotency-Key", req.IdempotencyKey)
	}

	statusCode := http.StatusCreated
	if req.DryRun || idempotencyHit {
		statusCode = http.StatusOK
	}
	c.JSON(statusCode, gin.H{"job": job, "idempotency_hit": idempotencyHit})
}

func (h *Handler) ListJobs(c *gin.Context) {
	ctx, _, ok := resolveSchoolScopeContext(c)
	if !ok {
		return
	}

	limit := 25
	status := strings.TrimSpace(c.Query("status"))
	system := strings.TrimSpace(c.Query("system"))
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 || parsed > 200 {
			c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, "limit must be between 1 and 200", nil))
			return
		}
		limit = parsed
	}

	if status != "" && status != "all" {
		switch JobStatus(status) {
		case JobStatusPending, JobStatusRunning, JobStatusSucceeded, JobStatusFailed:
		default:
			c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, "invalid status filter", nil))
			return
		}
	}
	if system != "" && system != "all" {
		switch ExternalSystem(system) {
		case SystemDIKSHA, SystemDigiLocker, SystemABC:
		default:
			c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, "invalid system filter", nil))
			return
		}
	}

	jobs, err := h.service.ListJobs(ctx, limit, ListJobsFilter{
		Status: JobStatus(status),
		System: ExternalSystem(system),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse(ErrCodeInternalError, "failed to list interop jobs", nil))
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": jobs, "count": len(jobs)})
}

func (h *Handler) GetJob(c *gin.Context) {
	ctx, _, ok := resolveSchoolScopeContext(c)
	if !ok {
		return
	}

	jobID := strings.TrimSpace(c.Param("id"))
	if jobID == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, "job id is required", nil))
		return
	}
	job, err := h.service.GetJob(ctx, jobID)
	if err != nil {
		if errors.Is(err, ErrJobNotFound) {
			c.JSON(http.StatusNotFound, ErrorResponse(ErrCodeJobNotFound, err.Error(), nil))
			return
		}
		c.JSON(http.StatusInternalServerError, ErrorResponse(ErrCodeInternalError, "failed to fetch interop job", nil))
		return
	}
	c.JSON(http.StatusOK, gin.H{"job": job})
}

func (h *Handler) RetryJob(c *gin.Context) {
	ctx, _, ok := resolveSchoolScopeContext(c)
	if !ok {
		return
	}

	jobID := strings.TrimSpace(c.Param("id"))
	if jobID == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, "job id is required", nil))
		return
	}

	job, err := h.service.RetryJob(ctx, jobID)
	if err != nil {
		switch {
		case errors.Is(err, ErrInteropDisabled):
			c.JSON(http.StatusPreconditionFailed, ErrorResponse(ErrCodeDisabled, err.Error(), "Set INTEROP_ENABLED=true before retrying live jobs"))
		case errors.Is(err, ErrValidationFailed):
			c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeValidationFailed, err.Error(), nil))
		case errors.Is(err, ErrJobNotFound):
			c.JSON(http.StatusNotFound, ErrorResponse(ErrCodeJobNotFound, err.Error(), nil))
		default:
			c.JSON(http.StatusInternalServerError, ErrorResponse(ErrCodeInternalError, "failed to retry interop job", nil))
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"job": job, "message": "retry attempted"})
}

func resolveSchoolScopeContext(c *gin.Context) (context.Context, string, bool) {
	role := strings.TrimSpace(middleware.GetRole(c))
	schoolID := strings.TrimSpace(middleware.GetSchoolID(c))

	if role == "super_admin" && schoolID == "" {
		schoolID = strings.TrimSpace(c.Query("school_id"))
		if schoolID == "" {
			c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeInvalidScope, "school_id query parameter required for super admin", nil))
			return nil, "", false
		}
	}

	parsed, err := uuid.Parse(schoolID)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse(ErrCodeInvalidScope, "invalid school_id", nil))
		return nil, "", false
	}

	// Ensure tenant-scoped queries always resolve to the selected school schema.
	schemaName := fmt.Sprintf("school_%s", parsed.String())
	safeSchema := "\"" + schemaName + "\""

	ctx := context.WithValue(c.Request.Context(), "tenant_schema", safeSchema)
	ctx = context.WithValue(ctx, "school_id", parsed.String())
	c.Request = c.Request.WithContext(ctx)
	c.Set("school_id", parsed.String())
	c.Set("tenant_schema", safeSchema)

	return ctx, parsed.String(), true
}
