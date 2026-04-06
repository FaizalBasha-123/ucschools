package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/schools24/backend/internal/shared/admissionhub"
	"github.com/schools24/backend/internal/shared/middleware"
	"github.com/schools24/backend/internal/shared/validation"
)

// Handler handles HTTP requests for admin module
type Handler struct {
	service          *Service
	hub              *admissionhub.Hub
	jwtSecret        string
	sessionValidator func(context.Context, *middleware.Claims) error
	upgrader         websocket.Upgrader
}

const (
	adminDefaultPage     = 1
	adminDefaultPageSize = 20
	adminMaxPageSize     = 200
	adminDefaultLimit    = 100
	adminMaxLimit        = 200
)

func applySchoolScopeContext(c *gin.Context, schoolID uuid.UUID) context.Context {
	schemaName := fmt.Sprintf("school_%s", schoolID.String())
	safeSchema := "\"" + schemaName + "\""
	ctx := context.WithValue(c.Request.Context(), "tenant_schema", safeSchema)
	ctx = context.WithValue(ctx, "school_id", schoolID.String())
	c.Request = c.Request.WithContext(ctx)
	return ctx
}

func parseBoundedPagination(c *gin.Context) (int, int, error) {
	page := adminDefaultPage
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			return 0, 0, fmt.Errorf("page must be a positive integer")
		}
		page = parsed
	}

	pageSize := adminDefaultPageSize
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > adminMaxPageSize {
			return 0, 0, fmt.Errorf("page_size must be between 1 and %d", adminMaxPageSize)
		}
		pageSize = parsed
	}

	return page, pageSize, nil
}

func parseBoundedLimit(c *gin.Context) (int, error) {
	limit := adminDefaultLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > adminMaxLimit {
			return 0, fmt.Errorf("limit must be between 1 and %d", adminMaxLimit)
		}
		limit = parsed
	}
	return limit, nil
}

func requireSuperAdminSchoolScope(c *gin.Context) (*uuid.UUID, bool) {
	sid := c.Query("school_id")
	if sid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id query parameter required for super admin"})
		return nil, false
	}
	schoolID, err := uuid.Parse(sid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
		return nil, false
	}
	applySchoolScopeContext(c, schoolID)
	return &schoolID, true
}

func strictBindJSON(c *gin.Context, dest any) error {
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request body must contain a single JSON object")
	}
	return nil
}

func optionalStrictBindJSON(c *gin.Context, dest any) error {
	if c.Request.Body == nil {
		return nil
	}
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request body must contain a single JSON object")
	}
	return nil
}

func servePrivateFile(c *gin.Context, inline bool, contentType, fileName string, content []byte) {
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	disposition := "attachment"
	if inline {
		disposition = "inline"
	}
	safeName := strings.ReplaceAll(strings.TrimSpace(fileName), "\"", "")
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, safeName))
	c.Header("Content-Length", fmt.Sprintf("%d", len(content)))
	c.Header("Cache-Control", "private, no-store, max-age=0")
	c.Header("Pragma", "no-cache")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, content)
}

// NewHandler creates a new admin handler
func NewHandler(service *Service, hub *admissionhub.Hub, jwtSecret string, sessionValidator func(context.Context, *middleware.Claims) error) *Handler {
	return &Handler{
		service:          service,
		hub:              hub,
		jwtSecret:        jwtSecret,
		sessionValidator: sessionValidator,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

func (h *Handler) validateLiveToken(ctx context.Context, token string) (*middleware.Claims, error) {
	claims, err := middleware.ValidateToken(token, h.jwtSecret)
	if err != nil {
		return nil, err
	}
	if h.sessionValidator != nil {
		if err := h.sessionValidator(ctx, claims); err != nil {
			return nil, err
		}
	}
	return claims, nil
}

// GetAllStaff handles fetching all staff members
func (h *Handler) GetAllStaff(c *gin.Context) {
	// Determine School ID
	var schoolID *uuid.UUID
	userRole := middleware.GetRole(c)
	var err error

	if userRole == "super_admin" {
		sid := c.Query("school_id")
		if sid != "" {
			parsedID, parseErr := uuid.Parse(sid)
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
				return
			}
			schoolID = &parsedID
		}
	} else {
		sid := middleware.GetSchoolID(c)
		if sid == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "school_id missing from context"})
			return
		}
		parsedID, parseErr := uuid.Parse(sid)
		err = parseErr
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid school_id in token"})
			return
		}
		schoolID = &parsedID
	}

	search := c.Query("search")
	designation := c.Query("designation")
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	staff, total, err := h.service.GetAllStaff(c.Request.Context(), schoolID, search, designation, page, pageSize)
	if err != nil {
		log.Printf("[ERROR] Handler.GetAllStaff error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if staff == nil {
		staff = []Staff{}
	}

	c.JSON(http.StatusOK, gin.H{
		"staff":     staff,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// CreateStaff handles creating a new staff member
func (h *Handler) CreateStaff(c *gin.Context) {
	var req CreateStaffRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.CreateStaff(c.Request.Context(), req); err != nil {
		if errors.Is(err, ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Staff member created successfully"})
}

// UpdateStaff handles updating an existing staff member
func (h *Handler) UpdateStaff(c *gin.Context) {
	staffIDStr := c.Param("id")
	staffID, err := uuid.Parse(staffIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid staff ID"})
		return
	}

	var req UpdateStaffRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userRole := middleware.GetRole(c)
	var requesterSchoolID *uuid.UUID
	if userRole == "super_admin" {
		scopedID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		requesterSchoolID = scopedID
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if parsedID, parseErr := uuid.Parse(sid); parseErr == nil {
			requesterSchoolID = &parsedID
		}
	}

	if err := h.service.UpdateStaff(c.Request.Context(), staffID, req, requesterSchoolID, userRole); err != nil {
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Staff member updated successfully"})
}

// DeleteStaff handles deleting a staff member
func (h *Handler) DeleteStaff(c *gin.Context) {
	staffIDStr := c.Param("id")
	staffID, err := uuid.Parse(staffIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid staff ID"})
		return
	}

	// Get requester info
	reqRole := middleware.GetRole(c)
	var reqSchoolID *uuid.UUID
	if sid := middleware.GetSchoolID(c); sid != "" {
		if id, err := uuid.Parse(sid); err == nil {
			reqSchoolID = &id
		}
	}

	// For super admins without school_id in context, use query param
	if reqRole == "super_admin" && reqSchoolID == nil {
		schoolIDParam := c.Query("school_id")
		if schoolIDParam == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "school_id query parameter required for super admin"})
			return
		}
		schoolID, parseErr := uuid.Parse(schoolIDParam)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id parameter"})
			return
		}
		// Set tenant schema in context for the delete operation
		schemaName := fmt.Sprintf("school_%s", schoolID.String())
		safeSchema := "\"" + schemaName + "\""
		ctx := context.WithValue(c.Request.Context(), "tenant_schema", safeSchema)
		c.Request = c.Request.WithContext(ctx)
		reqSchoolID = &schoolID
	}

	if err := h.service.DeleteStaff(c.Request.Context(), staffID, "non-teaching", reqSchoolID, reqRole); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Staff member deleted successfully"})
}

// GetDashboard returns the admin dashboard
// GET /api/v1/admin/dashboard
func (h *Handler) GetDashboard(c *gin.Context) {
	// 1. Get School ID from token
	sid := middleware.GetSchoolID(c)
	if sid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id_missing_in_token"})
		return
	}

	schoolID, err := uuid.Parse(sid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}

	// 2. Fetch stats
	dashboard, err := h.service.GetDashboard(c.Request.Context(), schoolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, dashboard)
}

// GetUsers returns paginated list of users
// GET /api/v1/admin/users
func (h *Handler) GetUsers(c *gin.Context) {
	role := c.Query("role")
	search := c.Query("search")
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine School ID based on role
	var schoolID *uuid.UUID
	userRole := middleware.GetRole(c)

	if userRole == "super_admin" {
		if scopedID, ok := requireSuperAdminSchoolScope(c); ok {
			schoolID = scopedID
		} else {
			return
		}
	} else {
		// Regular admins/users are restricted to their own school
		if sid := middleware.GetSchoolID(c); sid != "" {
			if id, err := uuid.Parse(sid); err == nil {
				schoolID = &id
			}
		}
	}

	users, total, err := h.service.GetUsers(c.Request.Context(), role, search, schoolID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if users == nil {
		users = []UserListItem{}
	}

	c.JSON(http.StatusOK, gin.H{
		"users":     users,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetUserStats returns user counts by role
// GET /api/v1/admin/users/stats
func (h *Handler) GetUserStats(c *gin.Context) {
	ctx := c.Request.Context()
	if middleware.GetRole(c) == "super_admin" {
		schoolID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		ctx = context.WithValue(c.Request.Context(), "school_id", schoolID.String())
	}

	stats, err := h.service.GetUserStats(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// GetUser returns a single user
// GET /api/v1/admin/users/:id
func (h *Handler) GetUser(c *gin.Context) {
	requesterRole := middleware.GetRole(c)
	var requesterSchoolID *uuid.UUID
	if requesterRole == "super_admin" {
		scopedID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		requesterSchoolID = scopedID
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if parsedID, parseErr := uuid.Parse(sid); parseErr == nil {
			requesterSchoolID = &parsedID
		}
	}

	userIDStr := c.Param("id")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		log.Printf("[ERROR] Invalid user ID: %q", userIDStr)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	user, err := h.service.GetUserByID(c.Request.Context(), userID, requesterSchoolID, requesterRole)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

// CreateUser creates a new user
// POST /api/v1/admin/users
func (h *Handler) CreateUser(c *gin.Context) {
	var req CreateUserRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Trim whitespace — prevents copy-paste artifacts causing format validation failures
	req.Email = strings.TrimSpace(req.Email)
	req.FullName = strings.TrimSpace(req.FullName)
	req.Role = strings.TrimSpace(req.Role)

	// Validate password strength only when admin explicitly provides a password
	if req.Password != "" {
		if err := validation.ValidatePasswordStrength(req.Password); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "weak_password", "message": err.Error()})
			return
		}
	}

	// Validate email format after trimming
	atIdx := strings.Index(req.Email, "@")
	if req.Email == "" || atIdx <= 0 || atIdx == len(req.Email)-1 || !strings.Contains(req.Email[atIdx+1:], ".") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_email"})
		return
	}

	// Enforce School ID for non-super admins
	userRole := middleware.GetRole(c)
	if userRole == "super_admin" {
		schoolID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		req.SchoolID = schoolID.String()
		req.CreatedBy = ""
	} else {
		req.SchoolID = middleware.GetSchoolID(c)
		// created_by is a tenant users FK, so keep it only for tenant-scoped creator IDs.
		req.CreatedBy = middleware.GetUserID(c)
	}

	userID, err := h.service.CreateUser(c.Request.Context(), &req)
	if err != nil {
		if errors.Is(err, ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "User created successfully",
		"user_id": userID,
	})
}

// UpdateUser updates a user
// PUT /api/v1/admin/users/:id
func (h *Handler) UpdateUser(c *gin.Context) {
	userIDStr := c.Param("id")
	log.Printf("[DEBUG] UpdateUser request for ID: %s", userIDStr)
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		log.Printf("[ERROR] Invalid user ID: %q", userIDStr)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	var req UpdateUserRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Extract requester info
	role := middleware.GetRole(c)
	var schoolIDPtr *uuid.UUID
	if role == "super_admin" {
		scopedID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		schoolIDPtr = scopedID
	} else if sID := middleware.GetSchoolID(c); sID != "" {
		id, parseErr := uuid.Parse(sID)
		if parseErr == nil {
			schoolIDPtr = &id
		}
	}

	if err := h.service.UpdateUser(c.Request.Context(), userID, &req, schoolIDPtr, role); err != nil {
		if errors.Is(err, ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User updated successfully"})
}

// DeleteUser deletes a user
// DELETE /api/v1/admin/users/:id
func (h *Handler) DeleteUser(c *gin.Context) {
	userIDStr := c.Param("id")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		log.Printf("[ERROR] Invalid user ID in DeleteUser: %q", userIDStr)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	// Get requester info from context
	reqRole := middleware.GetRole(c)
	var reqSchoolID *uuid.UUID
	if reqRole == "super_admin" {
		scopedID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		reqSchoolID = scopedID
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if id, parseErr := uuid.Parse(sid); parseErr == nil {
			reqSchoolID = &id
		}
	}

	if err := h.service.DeleteUser(c.Request.Context(), userID, reqSchoolID, reqRole); err != nil {
		if errors.Is(err, ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
			return
		}
		if errors.Is(err, ErrLastAdmin) {
			c.JSON(http.StatusForbidden, gin.H{"error": "cannot_delete_last_admin"})
			return
		}
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User deleted successfully"})
}

// SuspendUser suspends a user account - prevents login, all data (materials, docs, quizzes) preserved
// PUT /api/v1/admin/users/:id/suspend
func (h *Handler) SuspendUser(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	var req SuspendUserRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	requesterIDStr := middleware.GetUserID(c)
	requesterID, err := uuid.Parse(requesterIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid requester ID"})
		return
	}

	reqRole := middleware.GetRole(c)
	var reqSchoolID *uuid.UUID
	if reqRole == "super_admin" {
		if scopedID, ok := requireSuperAdminSchoolScope(c); ok {
			reqSchoolID = scopedID
		}
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if id, parseErr := uuid.Parse(sid); parseErr == nil {
			reqSchoolID = &id
		}
	}

	if err := h.service.SuspendUser(c.Request.Context(), userID, requesterID, reqRole, reqSchoolID, req.Password); err != nil {
		switch {
		case errors.Is(err, ErrCannotSuspendSelf):
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot_suspend_self", "message": "You cannot suspend your own account"})
		case errors.Is(err, ErrInvalidPassword):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_password", "message": "Incorrect password"})
		case errors.Is(err, ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
		case errors.Is(err, ErrNotAuthorized):
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User suspended successfully"})
}

// UnsuspendUser lifts a suspension - restores login access
// PUT /api/v1/admin/users/:id/unsuspend
func (h *Handler) UnsuspendUser(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	var req SuspendUserRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	requesterIDStr := middleware.GetUserID(c)
	requesterID, err := uuid.Parse(requesterIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid requester ID"})
		return
	}

	reqRole := middleware.GetRole(c)
	var reqSchoolID *uuid.UUID
	if reqRole == "super_admin" {
		if scopedID, ok := requireSuperAdminSchoolScope(c); ok {
			reqSchoolID = scopedID
		}
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if id, parseErr := uuid.Parse(sid); parseErr == nil {
			reqSchoolID = &id
		}
	}

	if err := h.service.UnsuspendUser(c.Request.Context(), userID, requesterID, reqRole, reqSchoolID, req.Password); err != nil {
		switch {
		case errors.Is(err, ErrInvalidPassword):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_password", "message": "Incorrect password"})
		case errors.Is(err, ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
		case errors.Is(err, ErrNotAuthorized):
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User unsuspended successfully"})
}

// CreateStudent creates a student with profile
// POST /api/v1/admin/students
func (h *Handler) CreateStudent(c *gin.Context) {
	var req CreateStudentRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, err := h.service.CreateStudent(c.Request.Context(), &req)
	if err != nil {
		if errors.Is(err, ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Student created successfully",
		"user_id": userID,
	})
}

// CreateTeacher creates a teacher with profile
// POST /api/v1/admin/teachers
func (h *Handler) CreateTeacher(c *gin.Context) {
	var req CreateTeacherDetailRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine school ID
	var schoolID uuid.UUID
	userRole := middleware.GetRole(c)
	if userRole == "super_admin" {
		sid := c.Query("school_id")
		if sid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "school_id query parameter required for super admin"})
			return
		}
		id, err := uuid.Parse(sid)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
			return
		}
		schoolID = id
	} else {
		sid := middleware.GetSchoolID(c)
		if sid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "school_id missing in token"})
			return
		}
		id, err := uuid.Parse(sid)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id"})
			return
		}
		schoolID = id
	}

	userID, err := h.service.CreateTeacherDetail(c.Request.Context(), &req, schoolID)
	if err != nil {
		if errors.Is(err, ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Teacher created successfully",
		"user_id": userID,
	})
}

// GetTeacherByUserID returns a teacher's full profile by user_id (admin use)
// GET /api/v1/admin/teachers/by-user/:userID
func (h *Handler) GetTeacherByUserID(c *gin.Context) {
	userIDStr := c.Param("userID")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	requesterRole := middleware.GetRole(c)
	var requesterSchoolID *uuid.UUID
	if requesterRole == "super_admin" {
		scopedID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		requesterSchoolID = scopedID
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if parsedID, parseErr := uuid.Parse(sid); parseErr == nil {
			requesterSchoolID = &parsedID
		}
	}

	teacher, err := h.service.GetTeacherByUserID(c.Request.Context(), userID, requesterSchoolID, requesterRole)
	if err != nil {
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		// Return null gracefully
		c.JSON(http.StatusOK, gin.H{"teacher": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"teacher": teacher})
}

// GetTeachers returns paginated list of teachers
// GET /api/v1/admin/teachers
func (h *Handler) GetTeachers(c *gin.Context) {
	search := c.Query("search")
	status := c.Query("status")
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine School ID based on role
	var schoolID *uuid.UUID
	userRole := middleware.GetRole(c)
	if userRole == "super_admin" {
		if sid := c.Query("school_id"); sid != "" {
			if id, err := uuid.Parse(sid); err == nil {
				schoolID = &id
			}
		}
		if schoolID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "school_id query parameter required for super admin"})
			return
		}
	} else {
		if sid := middleware.GetSchoolID(c); sid != "" {
			if id, err := uuid.Parse(sid); err == nil {
				schoolID = &id
			}
		}
	}

	teachers, total, err := h.service.GetTeachers(c.Request.Context(), schoolID, search, status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if teachers == nil {
		teachers = []TeacherDetail{}
	}

	c.JSON(http.StatusOK, TeachersListResponse{
		Teachers: teachers,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// UpdateTeacherDetail updates a teacher profile
// PUT /api/v1/admin/teachers/:id
func (h *Handler) UpdateTeacherDetail(c *gin.Context) {
	teacherIDStr := c.Param("id")
	teacherID, err := uuid.Parse(teacherIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid teacher ID"})
		return
	}

	requesterRole := middleware.GetRole(c)
	var requesterSchoolID *uuid.UUID
	if requesterRole == "super_admin" {
		scopedID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		requesterSchoolID = scopedID
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if parsedID, parseErr := uuid.Parse(sid); parseErr == nil {
			requesterSchoolID = &parsedID
		}
	}

	var req UpdateTeacherDetailRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpdateTeacherDetail(c.Request.Context(), teacherID, &req, requesterSchoolID, requesterRole); err != nil {
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Teacher updated successfully"})
}

// DeleteTeacherDetail deletes a teacher profile
// DELETE /api/v1/admin/teachers/:id
func (h *Handler) DeleteTeacherDetail(c *gin.Context) {
	teacherIDStr := c.Param("id")
	teacherID, err := uuid.Parse(teacherIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid teacher ID"})
		return
	}

	requesterRole := middleware.GetRole(c)
	var requesterSchoolID *uuid.UUID
	if requesterRole == "super_admin" {
		scopedID, ok := requireSuperAdminSchoolScope(c)
		if !ok {
			return
		}
		requesterSchoolID = scopedID
	} else if sid := middleware.GetSchoolID(c); sid != "" {
		if parsedID, parseErr := uuid.Parse(sid); parseErr == nil {
			requesterSchoolID = &parsedID
		}
	}

	if err := h.service.DeleteTeacherDetail(c.Request.Context(), teacherID, requesterSchoolID, requesterRole); err != nil {
		if errors.Is(err, ErrNotAuthorized) {
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Teacher deleted successfully"})
}

// GetFeeStructures returns fee structures
// GET /api/v1/admin/fees/structures
func (h *Handler) GetFeeStructures(c *gin.Context) {
	academicYear := c.Query("academic_year")

	structures, err := h.service.GetFeeStructures(c.Request.Context(), academicYear)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"fee_structures": structures})
}

// CreateFeeStructure creates a fee structure
// POST /api/v1/admin/fees/structures
func (h *Handler) CreateFeeStructure(c *gin.Context) {
	var req CreateFeeStructureRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	structureID, err := h.service.CreateFeeStructure(c.Request.Context(), &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":      "Fee structure created successfully",
		"structure_id": structureID,
	})
}

// ListAssessments returns existing assessments for the school
// GET /api/v1/admin/assessments
func (h *Handler) ListAssessments(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	academicYear := c.Query("academic_year")
	items, err := h.service.ListAssessments(c.Request.Context(), schoolID, academicYear)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"assessments": items})
}

// CreateAssessment creates a new assessment
// POST /api/v1/admin/assessments
func (h *Handler) CreateAssessment(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req CreateAssessmentRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var createdBy *uuid.UUID
	if userIDStr := middleware.GetUserID(c); userIDStr != "" {
		if parsed, parseErr := uuid.Parse(userIDStr); parseErr == nil {
			createdBy = &parsed
		}
	}

	assessmentID, err := h.service.CreateAssessment(c.Request.Context(), schoolID, createdBy, &req)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"assessment_id": assessmentID})
}

// UpdateAssessment updates an assessment and its subject marks breakdown
// PUT /api/v1/admin/assessments/:id
func (h *Handler) UpdateAssessment(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	assessmentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assessment id"})
		return
	}

	var req UpdateAssessmentRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpdateAssessment(c.Request.Context(), schoolID, assessmentID, &req); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
			return
		}
		if errors.Is(err, ErrAssessmentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "assessment_not_found"})
			return
		}
		if errors.Is(err, ErrAssessmentLocked) {
			c.JSON(http.StatusConflict, gin.H{"error": "assessment_locked"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// DeleteAssessment deletes assessment and related data
// DELETE /api/v1/admin/assessments/:id
func (h *Handler) DeleteAssessment(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	assessmentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assessment id"})
		return
	}

	if err := h.service.DeleteAssessment(c.Request.Context(), schoolID, assessmentID); err != nil {
		if errors.Is(err, ErrAssessmentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "assessment_not_found"})
			return
		}
		if errors.Is(err, ErrAssessmentLocked) {
			c.JSON(http.StatusConflict, gin.H{"error": "assessment_locked"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetAssessmentExamTimetableOptions returns subjects and timetable entries for one class grade in an assessment
// GET /api/v1/admin/assessments/:id/exam-timetable?class_grade=5
func (h *Handler) GetAssessmentExamTimetableOptions(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	assessmentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assessment id"})
		return
	}

	classGrade, err := strconv.Atoi(strings.TrimSpace(c.Query("class_grade")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_grade"})
		return
	}

	className, subjects, entries, err := h.service.GetAssessmentExamTimetableOptions(c.Request.Context(), schoolID, assessmentID, classGrade)
	if err != nil {
		if errors.Is(err, ErrAssessmentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "assessment_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"class_name": className,
		"subjects":   subjects,
		"entries":    entries,
	})
}

// UpsertAssessmentExamTimetable saves exam timetable and syncs class-scoped exam events.
// PUT /api/v1/admin/assessments/:id/exam-timetable
func (h *Handler) UpsertAssessmentExamTimetable(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	assessmentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid assessment id"})
		return
	}

	var req AssessmentExamTimetableUpdateRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpsertAssessmentExamTimetable(c.Request.Context(), schoolID, assessmentID, &req); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
			return
		}
		if errors.Is(err, ErrAssessmentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "assessment_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "exam_timetable_updated"})
}

// ListFeeDemandPurposes returns all fee demand purposes
// GET /api/v1/admin/fees/purposes
func (h *Handler) ListFeeDemandPurposes(c *gin.Context) {
	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, err := h.service.ListFeeDemandPurposes(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"purposes": items})
}

// CreateFeeDemandPurpose creates a fee demand purpose
// POST /api/v1/admin/fees/purposes
func (h *Handler) CreateFeeDemandPurpose(c *gin.Context) {
	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req CreateFeeDemandPurposeRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := h.service.CreateFeeDemandPurpose(c.Request.Context(), req.Name)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"error": "fee_purpose_already_exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// UpdateFeeDemandPurpose updates a fee demand purpose
// PUT /api/v1/admin/fees/purposes/:id
func (h *Handler) UpdateFeeDemandPurpose(c *gin.Context) {
	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var req UpdateFeeDemandPurposeRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err = h.service.UpdateFeeDemandPurpose(c.Request.Context(), id, req.Name)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input"})
			return
		}
		if errors.Is(err, ErrFeePurposeNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "fee_purpose_not_found"})
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"error": "fee_purpose_already_exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// DeleteFeeDemandPurpose deletes a fee demand purpose
// DELETE /api/v1/admin/fees/purposes/:id
func (h *Handler) DeleteFeeDemandPurpose(c *gin.Context) {
	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if err := h.service.DeleteFeeDemandPurpose(c.Request.Context(), id); err != nil {
		if errors.Is(err, ErrFeePurposeNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "fee_purpose_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetFeeDemands returns fee demands for students
// GET /api/v1/admin/fees/demands
func (h *Handler) GetFeeDemands(c *gin.Context) {
	search := c.Query("search")
	status := c.DefaultQuery("status", "all")
	academicYear := c.Query("academic_year")
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	demands, total, err := h.service.GetFeeDemands(c.Request.Context(), schoolID, search, status, academicYear, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     demands,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// CreateFeeDemand creates a fee demand for a student
// POST /api/v1/admin/fees/demands
func (h *Handler) CreateFeeDemand(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req CreateFeeDemandRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var createdBy *uuid.UUID
	if userIDStr := middleware.GetUserID(c); userIDStr != "" {
		if userID, err := uuid.Parse(userIDStr); err == nil {
			createdBy = &userID
		}
	}

	demandID, err := h.service.CreateFeeDemand(c.Request.Context(), schoolID, &req, createdBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":   "Fee demand created successfully",
		"demand_id": demandID,
	})
}

// RecordPayment records a payment
// POST /api/v1/admin/payments
func (h *Handler) RecordPayment(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	collectorID, _ := uuid.Parse(userIDStr)

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req RecordPaymentRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	paymentID, receiptNumber, err := h.service.RecordPayment(c.Request.Context(), schoolID, collectorID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":        "Payment recorded successfully",
		"payment_id":     paymentID,
		"receipt_number": receiptNumber,
	})
}

// GetPayments returns recent payments
// GET /api/v1/admin/payments
func (h *Handler) GetPayments(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	payments, err := h.service.GetRecentPayments(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"payments": payments})
}

// GetFinanceChart returns period-grouped revenue data for the admin dashboard chart.
// GET /api/v1/admin/finance/chart?period=week|month|year
func (h *Handler) GetFinanceChart(c *gin.Context) {
	period := c.DefaultQuery("period", "month")
	result, err := h.service.GetRevenueChartData(c.Request.Context(), period)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// GetClassDistribution returns per-class-grade student counts.
// GET /api/v1/admin/reports/class-distribution
func (h *Handler) GetClassDistribution(c *gin.Context) {
	sid := middleware.GetSchoolID(c)
	if sid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id_missing_in_token"})
		return
	}
	schoolID, err := uuid.Parse(sid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_school_id"})
		return
	}
	result, err := h.service.GetClassStudentDistribution(c.Request.Context(), schoolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// GetAuditLogs returns audit logs
// GET /api/v1/admin/audit-logs
func (h *Handler) GetAuditLogs(c *gin.Context) {
	limit, err := parseBoundedLimit(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	logs, err := h.service.GetAuditLogs(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"audit_logs": logs})
}

// GetBusRoutes returns bus routes for a school
// GET /api/v1/admin/bus-routes
func (h *Handler) GetBusRoutes(c *gin.Context) {
	search := c.Query("search")
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	log.Printf("[DEBUG] GetBusRoutes - schoolID: %s, search: %s, page: %d", schoolID, search, page)

	routes, total, err := h.service.GetBusRoutes(c.Request.Context(), schoolID, search, page, pageSize)
	if err != nil {
		log.Printf("[ERROR] GetBusRoutes - error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if routes == nil {
		routes = []BusRoute{}
	}

	log.Printf("[DEBUG] GetBusRoutes - found %d routes, total %d", len(routes), total)
	c.JSON(http.StatusOK, gin.H{
		"routes":    routes,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetTimetableConfig returns timetable configuration for the tenant
// GET /api/v1/admin/timetable/config
func (h *Handler) GetTimetableConfig(c *gin.Context) {
	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	config, err := h.service.GetTimetableConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"config": config})
}

// GetClassSubjects returns subjects filtered by class grade
// GET /api/v1/admin/classes/:classId/subjects
func (h *Handler) GetClassSubjects(c *gin.Context) {
	classIDStr := c.Param("classId")
	classID, err := uuid.Parse(classIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class ID"})
		return
	}

	subjects, err := h.service.GetSubjectsByClass(c.Request.Context(), classID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"subjects": subjects})
}

// CreateSubject creates a new subject
// POST /api/v1/admin/subjects
func (h *Handler) CreateSubject(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{
		"error":   "subjects_are_centrally_managed",
		"message": "Create subjects from Super Admin catalog only.",
	})
}

// UpdateSubject updates an existing subject
// PUT /api/v1/admin/subjects/:id
func (h *Handler) UpdateSubject(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{
		"error":   "subjects_are_centrally_managed",
		"message": "Update subjects from Super Admin catalog only.",
	})
}

// DeleteSubject deletes a subject
// DELETE /api/v1/admin/subjects/:id
func (h *Handler) DeleteSubject(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{
		"error":   "subjects_are_centrally_managed",
		"message": "Delete subjects from Super Admin catalog only.",
	})
}

// GetInventoryItems returns inventory items for the school
// GET /api/v1/admin/inventory
func (h *Handler) GetInventoryItems(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	search := c.Query("search")
	category := c.Query("category")
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, total, err := h.service.GetInventoryItems(c.Request.Context(), schoolID, search, category, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []InventoryItem{}
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// CreateInventoryItem creates a new inventory item
// POST /api/v1/admin/inventory
func (h *Handler) CreateInventoryItem(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req struct {
		Name     string `json:"name" binding:"required"`
		Category string `json:"category" binding:"required"`
		Quantity int    `json:"quantity"`
		Unit     string `json:"unit"`
		MinStock int    `json:"min_stock"`
		Location string `json:"location"`
	}

	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item := &InventoryItem{
		Name:     strings.TrimSpace(req.Name),
		Category: strings.TrimSpace(req.Category),
		Quantity: req.Quantity,
		Unit:     strings.TrimSpace(req.Unit),
		MinStock: req.MinStock,
		Location: strings.TrimSpace(req.Location),
	}

	if err := h.service.CreateInventoryItem(c.Request.Context(), item, schoolID); err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid inventory item data"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"item": item})
}

// DeleteInventoryItem deletes an inventory item
// DELETE /api/v1/admin/inventory/:id
func (h *Handler) DeleteInventoryItem(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	itemIDStr := c.Param("id")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item ID"})
		return
	}

	if err := h.service.DeleteInventoryItem(c.Request.Context(), itemID, schoolID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// UpdateInventoryItem updates an existing inventory item
// PUT /api/v1/admin/inventory/:id
func (h *Handler) UpdateInventoryItem(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	itemIDStr := c.Param("id")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item ID"})
		return
	}

	var req struct {
		Name     string `json:"name" binding:"required"`
		Category string `json:"category" binding:"required"`
		Quantity int    `json:"quantity"`
		Unit     string `json:"unit"`
		MinStock int    `json:"min_stock"`
		Location string `json:"location"`
	}

	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item := &InventoryItem{
		Name:     strings.TrimSpace(req.Name),
		Category: strings.TrimSpace(req.Category),
		Quantity: req.Quantity,
		Unit:     strings.TrimSpace(req.Unit),
		MinStock: req.MinStock,
		Location: strings.TrimSpace(req.Location),
	}

	if err := h.service.UpdateInventoryItem(c.Request.Context(), itemID, item, schoolID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"item": item})
}

// UpdateTimetableConfig updates timetable configuration (admin only)
// PUT /api/v1/admin/timetable/config
func (h *Handler) UpdateTimetableConfig(c *gin.Context) {
	if middleware.GetRole(c) != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "only_admin_can_update_timetable_config"})
		return
	}

	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req UpdateTimetableConfigRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	config := &TimetableConfig{Days: req.Days, Periods: req.Periods}
	if err := h.service.UpdateTimetableConfig(c.Request.Context(), config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "timetable_config_updated"})
}

// GetClassTimetable returns timetable for a class
// GET /api/v1/admin/timetable/classes/:classId
func (h *Handler) GetClassTimetable(c *gin.Context) {
	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	classIDStr := c.Param("classId")
	classID, err := uuid.Parse(classIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
		return
	}

	academicYear := resolveAcademicYear(c)
	entries, err := h.service.GetClassTimetable(c.Request.Context(), classID, academicYear)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"timetable": entries})
}

// GetTeacherTimetable returns timetable for a teacher with conflicts
// GET /api/v1/admin/timetable/teachers/:teacherId
func (h *Handler) GetTeacherTimetable(c *gin.Context) {
	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	teacherIDStr := c.Param("teacherId")
	teacherID, err := uuid.Parse(teacherIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid teacher_id"})
		return
	}

	academicYear := resolveAcademicYear(c)
	entries, conflicts, err := h.service.GetTeacherTimetable(c.Request.Context(), teacherID, academicYear)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"timetable": entries, "conflicts": conflicts})
}

// UpsertTimetableSlot creates or updates a timetable slot (admin only)
// POST /api/v1/admin/timetable/slots
func (h *Handler) UpsertTimetableSlot(c *gin.Context) {
	if middleware.GetRole(c) != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "only_admin_can_update_timetable"})
		return
	}

	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req UpsertTimetableSlotRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	classID, err := uuid.Parse(req.ClassID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
		return
	}
	subjectID, err := uuid.Parse(req.SubjectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subject_id"})
		return
	}
	teacherID, err := uuid.Parse(req.TeacherID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid teacher_id"})
		return
	}

	entry := &TimetableEntry{
		ClassID:      classID,
		DayOfWeek:    req.DayOfWeek,
		PeriodNumber: req.PeriodNumber,
		SubjectID:    &subjectID,
		TeacherID:    &teacherID,
		StartTime:    req.StartTime,
		EndTime:      req.EndTime,
		RoomNumber:   req.RoomNumber,
		AcademicYear: req.AcademicYear,
	}

	if err := h.service.UpsertTimetableSlot(c.Request.Context(), entry); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "timetable_slot_saved"})
}

// DeleteTimetableSlot deletes a timetable slot (admin only)
// DELETE /api/v1/admin/timetable/slots
func (h *Handler) DeleteTimetableSlot(c *gin.Context) {
	if middleware.GetRole(c) != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "only_admin_can_update_timetable"})
		return
	}

	if _, err := resolveSchoolID(c); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	classIDStr := c.Query("class_id")
	dayStr := c.Query("day_of_week")
	periodStr := c.Query("period_number")
	academicYear := c.Query("academic_year")
	if classIDStr == "" || dayStr == "" || periodStr == "" || academicYear == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing required parameters"})
		return
	}

	classID, err := uuid.Parse(classIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid class_id"})
		return
	}
	dayOfWeek, err := strconv.Atoi(dayStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid day_of_week"})
		return
	}
	periodNumber, err := strconv.Atoi(periodStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid period_number"})
		return
	}

	if err := h.service.DeleteTimetableSlot(c.Request.Context(), classID, dayOfWeek, periodNumber, academicYear); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// CreateBusRoute creates a new bus route
// POST /api/v1/admin/bus-routes
func (h *Handler) CreateBusRoute(c *gin.Context) {
	var req CreateBusRouteRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	route, err := h.service.CreateBusRoute(c.Request.Context(), schoolID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"route": route})
}

// UpdateBusRoute updates a bus route
// PUT /api/v1/admin/bus-routes/:id
func (h *Handler) UpdateBusRoute(c *gin.Context) {
	routeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}

	var req UpdateBusRouteRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	route, err := h.service.UpdateBusRoute(c.Request.Context(), routeID, schoolID, req)
	if err != nil {
		if errors.Is(err, ErrBusRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "bus_route_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"route": route})
}

// DeleteBusRoute deletes a bus route
// DELETE /api/v1/admin/bus-routes/:id
func (h *Handler) DeleteBusRoute(c *gin.Context) {
	routeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.DeleteBusRoute(c.Request.Context(), routeID, schoolID); err != nil {
		if errors.Is(err, ErrBusRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "bus_route_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetBusRouteStops returns ordered map-grade stops for a route.
// GET /api/v1/admin/bus-routes/:id/stops
func (h *Handler) GetBusRouteStops(c *gin.Context) {
	routeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	stops, err := h.service.GetBusRouteStops(c.Request.Context(), routeID, schoolID)
	if err != nil {
		if errors.Is(err, ErrBusRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "bus_route_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"stops": stops})
}

// UpdateBusRouteStops replaces ordered map-grade stops for a route.
// PUT /api/v1/admin/bus-routes/:id/stops
func (h *Handler) UpdateBusRouteStops(c *gin.Context) {
	routeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}

	var req UpdateBusRouteStopsRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	stops, err := h.service.UpdateBusRouteStops(c.Request.Context(), routeID, schoolID, req.Stops)
	if err != nil {
		if errors.Is(err, ErrBusRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "bus_route_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"stops": stops})
}

// UpdateBusRouteShape stores encoded route shape metadata.
// PUT /api/v1/admin/bus-routes/:id/shape
func (h *Handler) UpdateBusRouteShape(c *gin.Context) {
	routeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}

	var req UpdateBusRouteShapeRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	shape, err := h.service.UpdateBusRouteShape(c.Request.Context(), routeID, schoolID, req)
	if err != nil {
		if errors.Is(err, ErrBusRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "bus_route_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"shape": shape})
}

// GetBusStopAssignments returns stop assignments for a route.
// GET /api/v1/admin/bus-routes/:id/stop-assignments
func (h *Handler) GetBusStopAssignments(c *gin.Context) {
	routeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, err := h.service.GetBusStopAssignments(c.Request.Context(), routeID, schoolID)
	if err != nil {
		if errors.Is(err, ErrBusRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "bus_route_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"assignments": items})
}

// UpdateBusStopAssignments replaces stop assignments for a route.
// PUT /api/v1/admin/bus-routes/:id/stop-assignments
func (h *Handler) UpdateBusStopAssignments(c *gin.Context) {
	routeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}

	var req UpdateBusStopAssignmentsRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, err := h.service.UpdateBusStopAssignments(c.Request.Context(), routeID, schoolID, req.Assignments)
	if err != nil {
		if errors.Is(err, ErrBusRouteNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "bus_route_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"assignments": items})
}

func resolveSchoolID(c *gin.Context) (uuid.UUID, error) {
	userRole := middleware.GetRole(c)
	if userRole == "super_admin" {
		sid := c.Query("school_id")
		if sid == "" {
			return uuid.Nil, fmt.Errorf("school_id query parameter required for super admin")
		}
		id, err := uuid.Parse(sid)
		if err != nil {
			return uuid.Nil, fmt.Errorf("invalid school_id")
		}
		return id, nil
	}

	sid := middleware.GetSchoolID(c)
	if sid == "" {
		return uuid.Nil, fmt.Errorf("school_id missing from context")
	}
	id, err := uuid.Parse(sid)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid school_id in token")
	}
	return id, nil
}

func resolveAcademicYear(c *gin.Context) string {
	if ay := c.Query("academic_year"); ay != "" {
		return ay
	}
	now := time.Now()
	year := now.Year()
	if int(now.Month()) < 4 {
		return fmt.Sprintf("%d-%d", year-1, year)
	}
	return fmt.Sprintf("%d-%d", year, year+1)
}

// --------------------------------------------------------------------------
// Admission HTTP Handlers
// --------------------------------------------------------------------------

// ListAdmissions handles GET /api/v1/admin/admissions
func (h *Handler) ListAdmissions(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	status := c.Query("status") // optional filter: pending|under_review|approved|rejected
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, total, err := h.service.ListAdmissionApplications(c.Request.Context(), schoolID, status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetAdmission handles GET /api/v1/admin/admissions/:id
func (h *Handler) GetAdmission(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	appID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}

	app, err := h.service.GetAdmissionApplication(c.Request.Context(), schoolID, appID)
	if err != nil {
		if err.Error() == "application_not_found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "application_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, app)
}

// ApproveAdmission handles PUT /api/v1/admin/admissions/:id/approve
func (h *Handler) ApproveAdmission(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	appID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}

	reviewerIDStr := middleware.GetUserID(c)
	reviewerID, err := uuid.Parse(reviewerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ApproveAdmissionRequest
	if err := optionalStrictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := context.WithValue(c.Request.Context(), "request_ip", c.ClientIP())
	ctx = context.WithValue(ctx, "request_user_agent", c.Request.UserAgent())

	if err := h.service.ApproveAdmission(ctx, schoolID, appID, reviewerID, &req); err != nil {
		switch err.Error() {
		case "application_not_found":
			c.JSON(http.StatusNotFound, gin.H{"error": "application_not_found"})
		case "application_already_actioned":
			c.JSON(http.StatusConflict, gin.H{"error": "application_already_actioned"})
		case "application_not_found_or_already_actioned":
			c.JSON(http.StatusConflict, gin.H{"error": "application_already_actioned"})
		default:
			if strings.Contains(strings.ToLower(err.Error()), "invalid input") || strings.Contains(strings.ToLower(err.Error()), "parental consent") {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			}
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "application_approved"})
}

// RejectAdmission handles PUT /api/v1/admin/admissions/:id/reject
func (h *Handler) RejectAdmission(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	appID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}

	reviewerIDStr := middleware.GetUserID(c)
	reviewerID, err := uuid.Parse(reviewerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req RejectAdmissionRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason is required"})
		return
	}

	if err := h.service.RejectAdmission(c.Request.Context(), schoolID, appID, reviewerID, req.Reason); err != nil {
		switch err.Error() {
		case "application_not_found_or_already_actioned":
			c.JSON(http.StatusConflict, gin.H{"error": "application_already_actioned"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "application_rejected"})
}

// ViewAdmissionDocument handles GET /api/v1/admin/admissions/:id/documents/:docId/view
func (h *Handler) ViewAdmissionDocument(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	appID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}

	docObjectID := strings.TrimSpace(c.Param("docId"))
	if docObjectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "docId is required"})
		return
	}

	fileName, mimeType, content, err := h.service.ViewAdmissionDocument(c.Request.Context(), schoolID, appID, docObjectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document_not_found"})
		return
	}

	servePrivateFile(c, true, mimeType, fileName, content)
}

// ListTeacherAppointments handles GET /api/v1/admin/teacher-appointments
func (h *Handler) ListTeacherAppointments(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	status := c.Query("status")
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, total, err := h.service.ListTeacherAppointmentApplications(c.Request.Context(), schoolID, status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetTeacherAppointment handles GET /api/v1/admin/teacher-appointments/:id
func (h *Handler) GetTeacherAppointment(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	appID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}

	app, docs, err := h.service.GetTeacherAppointmentApplication(c.Request.Context(), schoolID, appID)
	if err != nil {
		if err.Error() == "application_not_found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "application_not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"application": app,
		"documents":   docs,
	})
}

// ApproveTeacherAppointment handles PUT /api/v1/admin/teacher-appointments/:id/approve
func (h *Handler) ApproveTeacherAppointment(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	appID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}
	reviewerID, err := uuid.Parse(middleware.GetUserID(c))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req ApproveTeacherAppointmentRequest
	if err := optionalStrictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.service.ApproveTeacherAppointment(c.Request.Context(), schoolID, appID, reviewerID, &req); err != nil {
		switch {
		case strings.Contains(err.Error(), "duplicate key"), strings.Contains(strings.ToLower(err.Error()), "email"):
			c.JSON(http.StatusConflict, gin.H{"error": "email_already_exists"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "teacher_appointment_approved"})
}

// RejectTeacherAppointment handles PUT /api/v1/admin/teacher-appointments/:id/reject
func (h *Handler) RejectTeacherAppointment(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	appID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}
	reviewerID, err := uuid.Parse(middleware.GetUserID(c))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req RejectTeacherAppointmentRequest
	if err := optionalStrictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.service.RejectTeacherAppointment(c.Request.Context(), schoolID, appID, reviewerID, req.Reason); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "teacher_appointment_rejected"})
}

// ViewTeacherAppointmentDocument handles GET /api/v1/admin/teacher-appointments/:id/documents/:docId/view
func (h *Handler) ViewTeacherAppointmentDocument(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	appID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid application id"})
		return
	}
	docID := strings.TrimSpace(c.Param("docId"))
	if docID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "docId is required"})
		return
	}
	fileName, mimeType, content, err := h.service.ViewTeacherAppointmentDocument(c.Request.Context(), schoolID, appID, docID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "document_not_found"})
		return
	}
	servePrivateFile(c, true, mimeType, fileName, content)
}

// ListTeacherAppointmentDecisions handles GET /api/v1/admin/teacher-appointments/decisions
func (h *Handler) ListTeacherAppointmentDecisions(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, total, err := h.service.ListTeacherAppointmentDecisions(c.Request.Context(), schoolID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetAdmissionSettings handles GET /api/v1/admin/settings/admissions
func (h *Handler) GetAdmissionSettings(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Use background context for public.schools query (no tenant schema needed)
	resp, err := h.service.GetAdmissionSettings(context.Background(), schoolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// UpdateAdmissionSettings handles PUT /api/v1/admin/settings/admissions
func (h *Handler) UpdateAdmissionSettings(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req UpdateAdmissionSettingsRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if err := h.service.UpdateAdmissionSettings(context.Background(), schoolID, &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "settings_updated"})
}

// InitiateLearnerTransfer handles POST /api/v1/admin/transfers
func (h *Handler) InitiateLearnerTransfer(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	requesterIDStr := middleware.GetUserID(c)
	requesterID, err := uuid.Parse(requesterIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req InitiateLearnerTransferRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item, err := h.service.InitiateLearnerTransfer(c.Request.Context(), schoolID, requesterID, &req)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_transfer_request"})
		case errors.Is(err, ErrTransferConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "transfer_request_conflict"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"transfer": item})
}

// ListLearnerTransfers handles GET /api/v1/admin/transfers
func (h *Handler) ListLearnerTransfers(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	direction := strings.ToLower(strings.TrimSpace(c.Query("direction")))
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, total, err := h.service.ListLearnerTransfers(c.Request.Context(), schoolID, direction, status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// ListTransferDestinationSchools handles GET /api/v1/admin/transfers/destination-schools
func (h *Handler) ListTransferDestinationSchools(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	search := strings.TrimSpace(c.Query("search"))
	limit, err := parseBoundedLimit(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, err := h.service.ListTransferDestinationSchools(c.Request.Context(), schoolID, search, limit)
	if err != nil {
		if errors.Is(err, ErrTransferConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "transfer_request_conflict"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

// ReviewLearnerTransfer handles PUT /api/v1/admin/transfers/:id/review
func (h *Handler) ReviewLearnerTransfer(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transferID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transfer id"})
		return
	}

	reviewerIDStr := middleware.GetUserID(c)
	reviewerID, err := uuid.Parse(reviewerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ReviewLearnerTransferRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	reviewResult, err := h.service.ReviewLearnerTransfer(c.Request.Context(), schoolID, reviewerID, transferID, req.Action, req.ReviewNote, req.AutoGovSync)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_transfer_action"})
		case errors.Is(err, ErrTransferNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "transfer_request_not_found"})
		case errors.Is(err, ErrTransferConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "transfer_request_conflict"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "transfer_request_reviewed", "review": reviewResult})
}

// CompleteLearnerTransfer handles POST /api/v1/admin/transfers/:id/complete
func (h *Handler) CompleteLearnerTransfer(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transferID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transfer id"})
		return
	}

	reviewerIDStr := middleware.GetUserID(c)
	reviewerID, err := uuid.Parse(reviewerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req CompleteLearnerTransferRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	reviewResult, err := h.service.CompleteLearnerTransfer(c.Request.Context(), schoolID, reviewerID, transferID, req.ReviewNote, req.AutoGovSync)
	if err != nil {
		switch {
		case errors.Is(err, ErrTransferNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "transfer_request_not_found"})
		case errors.Is(err, ErrTransferConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "transfer_request_conflict"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "transfer_completed", "review": reviewResult})
}

// TriggerTransferGovSync handles POST /api/v1/admin/transfers/:id/gov-sync
func (h *Handler) TriggerTransferGovSync(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transferID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transfer id"})
		return
	}

	actorIDStr := middleware.GetUserID(c)
	actorID, err := uuid.Parse(actorIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	result, err := h.service.TriggerTransferGovSync(c.Request.Context(), schoolID, actorID, transferID)
	if err != nil {
		switch {
		case errors.Is(err, ErrTransferNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "transfer_request_not_found"})
		case errors.Is(err, ErrTransferConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "transfer_request_conflict"})
		case errors.Is(err, ErrNotAuthorized):
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "transfer_gov_sync_triggered", "sync": result})
}

// RetryTransferGovSync handles POST /api/v1/admin/transfers/:id/gov-sync/retry
func (h *Handler) RetryTransferGovSync(c *gin.Context) {
	schoolID, err := resolveSchoolID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transferID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid transfer id"})
		return
	}

	actorIDStr := middleware.GetUserID(c)
	actorID, err := uuid.Parse(actorIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	result, err := h.service.RetryTransferGovSync(c.Request.Context(), schoolID, actorID, transferID)
	if err != nil {
		switch {
		case errors.Is(err, ErrTransferNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "transfer_request_not_found"})
		case errors.Is(err, ErrTransferConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "transfer_request_conflict"})
		case errors.Is(err, ErrNotAuthorized):
			c.JSON(http.StatusForbidden, gin.H{"error": "not_authorized"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "transfer_gov_sync_retry_attempted", "sync": result})
}

// ScanLearnerReconciliations handles POST /api/v1/super-admin/reconciliations/scan
func (h *Handler) ScanLearnerReconciliations(c *gin.Context) {
	created, err := h.service.ScanLearnerReconciliationCases(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"created": created,
	})
}

// ListLearnerReconciliations handles GET /api/v1/super-admin/reconciliations
func (h *Handler) ListLearnerReconciliations(c *gin.Context) {
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	page, pageSize, err := parseBoundedPagination(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items, total, err := h.service.ListLearnerReconciliationCases(c.Request.Context(), status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// ReviewLearnerReconciliation handles PUT /api/v1/super-admin/reconciliations/:id/review
func (h *Handler) ReviewLearnerReconciliation(c *gin.Context) {
	caseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation id"})
		return
	}

	reviewerIDStr := middleware.GetUserID(c)
	reviewerID, err := uuid.Parse(reviewerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ReviewLearnerReconciliationRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err = h.service.ReviewLearnerReconciliationCase(c.Request.Context(), reviewerID, caseID, req.Action, req.SurvivorLearnerID, req.ReviewNote)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_reconciliation_action"})
		case errors.Is(err, ErrReconciliationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "reconciliation_case_not_found"})
		case errors.Is(err, ErrReconciliationConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "reconciliation_case_conflict"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "reconciliation_case_reviewed"})
}

// UnmergeLearnerReconciliation handles PUT /api/v1/super-admin/reconciliations/:id/unmerge
func (h *Handler) UnmergeLearnerReconciliation(c *gin.Context) {
	caseID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reconciliation id"})
		return
	}

	reviewerIDStr := middleware.GetUserID(c)
	reviewerID, err := uuid.Parse(reviewerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req UnmergeLearnerReconciliationRequest
	if err := strictBindJSON(c, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err = h.service.UnmergeLearnerReconciliationCase(c.Request.Context(), reviewerID, caseID, req.ReviewNote)
	if err != nil {
		switch {
		case errors.Is(err, ErrReconciliationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "reconciliation_case_not_found"})
		case errors.Is(err, ErrReconciliationConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "reconciliation_case_conflict"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "reconciliation_case_unmerged"})
}

// HandleAdmissionWS upgrades the connection to WebSocket and pushes real-time
// new-admission events to the connected admin client.
//
// Auth: JWT passed as ?token=... query param (browser WS cannot set custom headers).
//
// GET /api/v1/admin/admissions/ws?token=JWT
func (h *Handler) HandleAdmissionWS(c *gin.Context) {
	// ── 1. Authenticate via query-param token ────────────────────────────────
	tokenStr := strings.TrimSpace(c.Query("ticket"))
	isScopedTicket := tokenStr != ""
	if tokenStr == "" {
		tokenStr = strings.TrimSpace(c.Query("token"))
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}

	claims, err := h.validateLiveToken(c.Request.Context(), tokenStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}
	if isScopedTicket && claims.WSScope != "admissions" {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
		return
	}

	// Only admins (and super_admins) may subscribe.
	role := claims.Role
	if role != "admin" && role != "super_admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	// ── 2. Resolve school_id ─────────────────────────────────────────────────
	schoolIDStr := strings.TrimSpace(claims.SchoolID)
	if schoolIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "school_id missing from token"})
		return
	}
	schoolID, err := uuid.Parse(schoolIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid school_id in token"})
		return
	}

	// ── 3. Upgrade to WebSocket ──────────────────────────────────────────────
	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.Header("Connection", "Upgrade")
		c.Header("Upgrade", "websocket")
		c.JSON(http.StatusUpgradeRequired, gin.H{"error": "websocket_upgrade_required"})
		return
	}
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[admissionWS] upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// ── 4. Subscribe to hub ──────────────────────────────────────────────────
	client := h.hub.Subscribe(schoolID)
	defer h.hub.Unsubscribe(client)

	log.Printf("[admissionWS] admin user=%s subscribed school=%s (subscribers=%d)",
		claims.UserID, schoolID, h.hub.Subscribers(schoolID))

	// ── 5. Write-pump goroutine ──────────────────────────────────────────────
	done := make(chan struct{})
	go func() {
		defer close(done)
		for event := range client.Send {
			if err := conn.WriteJSON(event); err != nil {
				log.Printf("[admissionWS] write error: %v", err)
				return
			}
		}
	}()

	if h.sessionValidator != nil {
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					if err := h.sessionValidator(context.Background(), claims); err != nil {
						_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "session_revoked"), time.Now().Add(5*time.Second))
						_ = conn.Close()
						return
					}
					_ = conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
				}
			}
		}()
	}

	// ── 6. Read-pump (main goroutine) ────────────────────────────────────────
	// We only need ping/pong and disconnect detection here.
	conn.SetReadLimit(512)
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[admissionWS] unexpected close: %v", err)
			}
			break
		}
	}

	<-done
	log.Printf("[admissionWS] admin user=%s disconnected school=%s", claims.UserID, schoolID)
}
