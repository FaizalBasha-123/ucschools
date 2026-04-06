package operations

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/cache"
	"github.com/schools24/backend/internal/shared/middleware"
)

// Handler handles HTTP requests for operations module
type Handler struct {
	service *Service
	cache   *cache.Cache
}

// NewHandler creates a new operations handler
func NewHandler(service *Service, cacheClient *cache.Cache) *Handler {
	return &Handler{service: service, cache: cacheClient}
}

func (h *Handler) requireAdminRole(c *gin.Context) bool {
	if c.GetString("role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": "admin role required"})
		return false
	}
	return true
}

func (h *Handler) requireSchoolID(c *gin.Context) (uuid.UUID, bool) {
	schoolIDStr := c.GetString("school_id")
	if schoolIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id required"})
		return uuid.Nil, false
	}

	schoolID, err := uuid.Parse(schoolIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
		return uuid.Nil, false
	}

	return schoolID, true
}

func (h *Handler) parseEventID(c *gin.Context) (uuid.UUID, bool) {
	eventIDStr := c.Param("id")
	eventID, err := uuid.Parse(eventIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid event id"})
		return uuid.Nil, false
	}

	return eventID, true
}

func parseDateParam(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}

	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return nil, err
	}

	return &parsed, nil
}

func (h *Handler) eventsCacheKey(schoolID uuid.UUID, eventType string, startDate, endDate *time.Time, targetGrade *int, page, pageSize int) string {
	start := ""
	end := ""
	grade := "all"
	if startDate != nil {
		start = startDate.Format("2006-01-02")
	}
	if endDate != nil {
		end = endDate.Format("2006-01-02")
	}
	if targetGrade != nil {
		grade = strconv.Itoa(*targetGrade)
	}
	return fmt.Sprintf("events:%s:%s:%s:%s:%s:%d:%d", schoolID.String(), eventType, start, end, grade, page, pageSize)
}

func (h *Handler) invalidateEventsCache(ctx *gin.Context, schoolID uuid.UUID) {
	if h.cache == nil {
		return
	}
	_ = h.cache.DeleteByPrefix(ctx.Request.Context(), fmt.Sprintf("events:%s:", schoolID.String()))
}

func (h *Handler) getEventsResponse(c *gin.Context, schoolID uuid.UUID, targetGrade *int) {
	// Parse query parameters
	eventType := c.Query("type")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))

	startDate, err := parseDateParam(c.Query("start_date"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date"})
		return
	}

	endDate, err := parseDateParam(c.Query("end_date"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date"})
		return
	}

	if h.cache != nil {
		cacheKey := h.eventsCacheKey(schoolID, eventType, startDate, endDate, targetGrade, page, pageSize)
		var cached ListEventsResponse
		if err := h.cache.FetchAndDecompress(c.Request.Context(), cacheKey, &cached); err == nil {
			c.JSON(http.StatusOK, cached)
			return
		}
	}

	response, err := h.service.GetEvents(c.Request.Context(), schoolID, eventType, startDate, endDate, targetGrade, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if h.cache != nil {
		cacheKey := h.eventsCacheKey(schoolID, eventType, startDate, endDate, targetGrade, page, pageSize)
		_ = h.cache.CompressAndStore(c.Request.Context(), cacheKey, response, 60*time.Second)
	}

	c.JSON(http.StatusOK, response)
}

// GetEvents returns list of events with filters
// GET /api/v1/admin/events
func (h *Handler) GetEvents(c *gin.Context) {
	if !h.requireAdminRole(c) {
		return
	}

	schoolID, ok := h.requireSchoolID(c)
	if !ok {
		return
	}

	h.getEventsResponse(c, schoolID, nil)
}

// GetStudentEvents returns list of events with filters for student view
// GET /api/v1/student/events
func (h *Handler) GetStudentEvents(c *gin.Context) {
	schoolID, ok := h.requireSchoolID(c)
	if !ok {
		return
	}
	var targetGrade *int
	userIDStr := middleware.GetUserID(c)
	if userIDStr != "" {
		if userID, err := uuid.Parse(userIDStr); err == nil {
			grade, gradeErr := h.service.repo.GetStudentClassGradeByUserID(c.Request.Context(), userID)
			if gradeErr == nil {
				targetGrade = grade
			}
		}
	}
	h.getEventsResponse(c, schoolID, targetGrade)
}

// GetTeacherEvents returns events for all class grades a teacher is assigned to.
// GET /api/v1/teacher/events
func (h *Handler) GetTeacherEvents(c *gin.Context) {
	schoolID, ok := h.requireSchoolID(c)
	if !ok {
		return
	}

	grades := []int32{}
	userIDStr := middleware.GetUserID(c)
	if userIDStr != "" {
		if userID, err := uuid.Parse(userIDStr); err == nil {
			if g, err := h.service.repo.GetTeacherClassGradesByUserID(c.Request.Context(), userID); err == nil {
				grades = g
			}
		}
	}

	eventType := c.Query("type")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "200"))

	startDate, err := parseDateParam(c.Query("start_date"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date"})
		return
	}
	endDate, err := parseDateParam(c.Query("end_date"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date"})
		return
	}

	response, err := h.service.GetEventsForGrades(c.Request.Context(), schoolID, grades, eventType, startDate, endDate, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, response)
}

// GetEventByID returns a single event
// GET /api/v1/admin/events/:id
func (h *Handler) GetEventByID(c *gin.Context) {
	if !h.requireAdminRole(c) {
		return
	}

	schoolID, ok := h.requireSchoolID(c)
	if !ok {
		return
	}

	eventID, ok := h.parseEventID(c)
	if !ok {
		return
	}

	event, err := h.service.GetEventByID(c.Request.Context(), schoolID, eventID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"event": event})
}

// CreateEvent creates a new event
// POST /api/v1/admin/events
func (h *Handler) CreateEvent(c *gin.Context) {
	if !h.requireAdminRole(c) {
		return
	}

	schoolID, ok := h.requireSchoolID(c)
	if !ok {
		return
	}

	var req CreateEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	eventID, err := h.service.CreateEvent(c.Request.Context(), schoolID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.invalidateEventsCache(c, schoolID)

	c.JSON(http.StatusCreated, gin.H{
		"message":  "event created successfully",
		"event_id": eventID,
	})
}

// UpdateEvent updates an existing event
// PUT /api/v1/admin/events/:id
func (h *Handler) UpdateEvent(c *gin.Context) {
	if !h.requireAdminRole(c) {
		return
	}

	schoolID, ok := h.requireSchoolID(c)
	if !ok {
		return
	}

	eventID, ok := h.parseEventID(c)
	if !ok {
		return
	}

	var req UpdateEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpdateEvent(c.Request.Context(), schoolID, eventID, req); err != nil {
		if errors.Is(err, ErrEventNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.invalidateEventsCache(c, schoolID)

	c.JSON(http.StatusOK, gin.H{"message": "event updated successfully"})
}

// DeleteEvent deletes an event
// DELETE /api/v1/admin/events/:id
func (h *Handler) DeleteEvent(c *gin.Context) {
	if !h.requireAdminRole(c) {
		return
	}

	schoolID, ok := h.requireSchoolID(c)
	if !ok {
		return
	}

	eventID, ok := h.parseEventID(c)
	if !ok {
		return
	}

	if err := h.service.DeleteEvent(c.Request.Context(), schoolID, eventID); err != nil {
		if errors.Is(err, ErrEventNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.invalidateEventsCache(c, schoolID)

	c.JSON(http.StatusOK, gin.H{"message": "event deleted successfully"})
}
