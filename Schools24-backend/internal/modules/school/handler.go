package school

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// ParseUUID parses a string to UUID
func ParseUUID(s string) (uuid.UUID, error) {
	return uuid.Parse(s)
}

// CreateSchool handles POST /api/v1/super-admin/schools
// Requires password verification
func (h *Handler) CreateSchool(c *gin.Context) {
	type CreateSchoolWithPasswordRequest struct {
		CreateSchoolRequest
		Password string `json:"password" binding:"required"`
	}

	var req CreateSchoolWithPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get super admin ID from JWT claims
	superAdminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	uuid, err := uuid.Parse(superAdminID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	school, err := h.service.CreateSchoolWithAdmin(c.Request.Context(), uuid, req.Password, &req.CreateSchoolRequest)
	if err != nil {
		if err.Error() == "incorrect password" || err.Error() == "password verification required" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
			return
		}
		if errors.Is(err, ErrInvalidSchoolCode) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, ErrSchoolCodeExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "school_code_already_exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, school)
}

// GetSchools handles GET /api/v1/super-admin/schools
// Supports ?page=1&page_size=50 (max 100)
func (h *Handler) GetSchools(c *gin.Context) {
	page := int64(1)
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		p, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || p < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
			return
		}
		page = p
	}
	pageSize := int64(50)
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		ps, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || ps < 1 || ps > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size must be between 1 and 100"})
			return
		}
		pageSize = ps
	}

	schools, total, err := h.service.GetSchoolsPaged(c.Request.Context(), page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	hasMore := page*pageSize < total
	nextPage := int64(0)
	if hasMore {
		nextPage = page + 1
	}
	c.JSON(http.StatusOK, gin.H{
		"schools":   schools,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
		"has_more":  hasMore,
		"next_page": nextPage,
	})
}

// GetSchool handles GET /api/v1/super-admin/schools/:id
func (h *Handler) GetSchool(c *gin.Context) {
	idOrSlug := c.Param("id")
	schoolResponse, err := h.service.GetSchool(c.Request.Context(), idOrSlug)
	if err != nil {
		// Differentiate between Not Found and other errors
		if strings.Contains(err.Error(), "no rows") {
			c.JSON(http.StatusNotFound, gin.H{"error": "school_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, schoolResponse)
}

// UpdateSchool handles PUT /api/v1/super-admin/schools/:id
func (h *Handler) UpdateSchool(c *gin.Context) {
	idParam := c.Param("id")
	schoolID, err := ParseUUID(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school ID"})
		return
	}

	type UpdateSchoolRequest struct {
		Name         string `json:"name" binding:"required"`
		Code         string `json:"code"`
		Address      string `json:"address"`
		ContactEmail string `json:"contact_email"`
	}

	var req UpdateSchoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updated, err := h.service.UpdateSchool(c.Request.Context(), schoolID, req.Name, req.Code, req.Address, req.ContactEmail)
	if err != nil {
		if errors.Is(err, ErrInvalidSchoolCode) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, ErrSchoolCodeExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "school_code_already_exists"})
			return
		}
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "no rows") {
			c.JSON(http.StatusNotFound, gin.H{"error": "school not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// DeleteSchool handles DELETE /api/v1/super-admin/schools/:id (soft delete)
// Requires password verification
func (h *Handler) DeleteSchool(c *gin.Context) {
	var req PasswordVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	idParam := c.Param("id")
	schoolID, err := ParseUUID(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school ID"})
		return
	}

	// Get super admin ID from JWT claims
	superAdminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	uuid, err := uuid.Parse(superAdminID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	if err := h.service.SoftDeleteSchool(c.Request.Context(), schoolID, uuid, req.Password); err != nil {
		if err.Error() == "incorrect password" || err.Error() == "password verification required" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "school not found"})
			return
		}
		if strings.Contains(err.Error(), "already deleted") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "school moved to trash"})
}

// RestoreSchool handles POST /api/v1/super-admin/schools/:id/restore
// Requires password verification
func (h *Handler) RestoreSchool(c *gin.Context) {
	var req PasswordVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	idParam := c.Param("id")
	schoolID, err := ParseUUID(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school ID"})
		return
	}

	// Get super admin ID from JWT claims
	superAdminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	uuid, err := uuid.Parse(superAdminID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	if err := h.service.RestoreSchool(c.Request.Context(), schoolID, uuid, req.Password); err != nil {
		if err.Error() == "incorrect password" || err.Error() == "password verification required" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "trash") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if strings.Contains(err.Error(), "24 hours") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "school restored successfully"})
}

// GetDeletedSchools handles GET /api/v1/super-admin/schools/trash
// Returns all soft-deleted schools
func (h *Handler) GetDeletedSchools(c *gin.Context) {
	schools, err := h.service.GetDeletedSchools(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"schools": schools})
}

// ListGlobalClasses handles GET /api/v1/super-admin/catalog/classes
func (h *Handler) ListGlobalClasses(c *gin.Context) {
	classes, err := h.service.ListGlobalClasses(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"classes": classes})
}

// CreateGlobalClass handles POST /api/v1/super-admin/catalog/classes
func (h *Handler) CreateGlobalClass(c *gin.Context) {
	var req UpsertGlobalClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.CreateGlobalClass(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"class": item})
}

// UpdateGlobalClass handles PUT /api/v1/super-admin/catalog/classes/:id
func (h *Handler) UpdateGlobalClass(c *gin.Context) {
	classID, err := ParseUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class id"})
		return
	}

	var req UpsertGlobalClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item, err := h.service.UpdateGlobalClass(c.Request.Context(), classID, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"class": item})
}

// ReorderGlobalClasses handles PUT /api/v1/super-admin/catalog/classes/reorder
func (h *Handler) ReorderGlobalClasses(c *gin.Context) {
	var req ReorderGlobalClassesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.service.ReorderGlobalClasses(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "classes reordered"})
}

// DeleteGlobalClass handles DELETE /api/v1/super-admin/catalog/classes/:id
func (h *Handler) DeleteGlobalClass(c *gin.Context) {
	classID, err := ParseUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class id"})
		return
	}
	if err := h.service.DeleteGlobalClass(c.Request.Context(), classID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "class deleted"})
}

// ListGlobalSubjects handles GET /api/v1/super-admin/catalog/subjects
func (h *Handler) ListGlobalSubjects(c *gin.Context) {
	subjects, err := h.service.ListGlobalSubjects(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subjects": subjects})
}

// CreateGlobalSubject handles POST /api/v1/super-admin/catalog/subjects
func (h *Handler) CreateGlobalSubject(c *gin.Context) {
	var req UpsertGlobalSubjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.service.CreateGlobalSubject(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"subject": item})
}

// UpdateGlobalSubject handles PUT /api/v1/super-admin/catalog/subjects/:id
func (h *Handler) UpdateGlobalSubject(c *gin.Context) {
	subjectID, err := ParseUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subject id"})
		return
	}

	var req UpsertGlobalSubjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item, err := h.service.UpdateGlobalSubject(c.Request.Context(), subjectID, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"subject": item})
}

// DeleteGlobalSubject handles DELETE /api/v1/super-admin/catalog/subjects/:id
func (h *Handler) DeleteGlobalSubject(c *gin.Context) {
	subjectID, err := ParseUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subject id"})
		return
	}
	if err := h.service.DeleteGlobalSubject(c.Request.Context(), subjectID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "subject deleted"})
}

// ReplaceGlobalClassSubjects handles PUT /api/v1/super-admin/catalog/classes/:id/subjects
func (h *Handler) ReplaceGlobalClassSubjects(c *gin.Context) {
	classID, err := ParseUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class id"})
		return
	}

	var req AssignSubjectsToClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.ReplaceGlobalClassSubjects(c.Request.Context(), classID, req.SubjectIDs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "class subjects updated"})
}

// ListGlobalCatalogAssignments handles GET /api/v1/super-admin/catalog/assignments
func (h *Handler) ListGlobalCatalogAssignments(c *gin.Context) {
	assignments, err := h.service.ListGlobalCatalogAssignments(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"assignments": assignments})
}

// GetMonthlyNewUsers handles GET /api/v1/super-admin/analytics/monthly-users?year=YYYY
func (h *Handler) GetMonthlyNewUsers(c *gin.Context) {
	year := time.Now().Year()
	if y, err := strconv.Atoi(c.Query("year")); err == nil && y >= 2020 && y <= year+1 {
		year = y
	}
	resp, err := h.service.GetMonthlyNewUsers(c.Request.Context(), year)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// GetGlobalSettings handles GET /api/v1/super-admin/settings/global
func (h *Handler) GetGlobalSettings(c *gin.Context) {
	settings, err := h.service.GetGlobalSettings(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
}

// UpdateGlobalSettings handles PUT /api/v1/super-admin/settings/global
func (h *Handler) UpdateGlobalSettings(c *gin.Context) {
	var req struct {
		CurrentAcademicYear string `json:"current_academic_year" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "current_academic_year is required"})
		return
	}
	if err := h.service.SetCurrentAcademicYear(c.Request.Context(), req.CurrentAcademicYear); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "global_settings_updated", "current_academic_year": req.CurrentAcademicYear})
}

// GetDatabaseSchema handles POST /api/v1/super-admin/schema
func (h *Handler) GetDatabaseSchema(c *gin.Context) {
	var req struct {
		Password   string `json:"password" binding:"required"`
		SchemaName string `json:"schema_name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	superAdminID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	uuid, err := uuid.Parse(superAdminID.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	schema, err := h.service.GetDatabaseSchema(c.Request.Context(), uuid, req.Password, req.SchemaName)
	if err != nil {
		if err.Error() == "incorrect password" || err.Error() == "password verification required" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, schema)
}

// GetStorageOverview handles GET /api/v1/super-admin/storage/overview
func (h *Handler) GetStorageOverview(c *gin.Context) {
	resp, err := h.service.GetStorageOverview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}
