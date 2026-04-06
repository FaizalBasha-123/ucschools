package demo

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreatePublicRequest(c *gin.Context) {
	var req CreatePublicDemoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	demoRequest, err := h.service.CreatePublicRequest(c.Request.Context(), req, c.ClientIP())
	if err != nil {
		switch {
		case errorsIsEmailExists(err):
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
		case strings.Contains(err.Error(), "invalid school code"):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case strings.Contains(err.Error(), "school code already exists"):
			c.JSON(http.StatusConflict, gin.H{"error": "school_code_already_exists"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"request": demoRequest})
}

func (h *Handler) ListRequests(c *gin.Context) {
	params := DemoRequestListParams{
		Page:     queryInt(c, "page", 1),
		PageSize: queryInt(c, "page_size", 20),
		Search:   strings.TrimSpace(c.Query("search")),
		Status:   strings.TrimSpace(c.Query("status")),
		Year:     queryInt(c, "year", 0),
		Month:    queryInt(c, "month", 0),
	}

	resp, err := h.service.ListRequests(c.Request.Context(), params)
	if err != nil {
		if err == ErrInvalidStatus {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) GetStats(c *gin.Context) {
	resp, err := h.service.GetStats(c.Request.Context(), queryInt(c, "year", 0), queryInt(c, "month", 0))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) AcceptRequest(c *gin.Context) {
	var req PasswordVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	requestID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}
	superAdminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	parsedSuperAdminID, err := uuid.Parse(superAdminID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	demoRequest, err := h.service.AcceptRequest(c.Request.Context(), requestID, parsedSuperAdminID, req.Password)
	if err != nil {
		switch {
		case err.Error() == "incorrect password" || err.Error() == "password verification required":
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		case err == ErrRequestNotPending:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case strings.Contains(err.Error(), "email already exists"):
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
		case strings.Contains(err.Error(), "school code already exists"):
			c.JSON(http.StatusConflict, gin.H{"error": "school_code_already_exists"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"request": demoRequest})
}

func (h *Handler) TrashRequest(c *gin.Context) {
	var req PasswordVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	requestID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}
	superAdminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	parsedSuperAdminID, err := uuid.Parse(superAdminID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	demoRequest, err := h.service.TrashRequest(c.Request.Context(), requestID, parsedSuperAdminID, req.Password)
	if err != nil {
		switch {
		case err.Error() == "incorrect password" || err.Error() == "password verification required":
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		case err == ErrRequestNotPending:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"request": demoRequest})
}

func queryInt(c *gin.Context, key string, fallback int) int {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func errorsIsEmailExists(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "email already exists")
}
