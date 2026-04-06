package auth

import (
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/middleware"
	"github.com/schools24/backend/internal/shared/validation"
)

// Handler handles HTTP requests for auth
type Handler struct {
	service *Service
}

// NewHandler creates a new auth handler
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Register handles user registration
// POST /api/v1/auth/register
func (h *Handler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	if err := validation.ValidatePasswordStrength(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "weak_password",
			"message": err.Error(),
		})
		return
	}

	resp, err := h.service.Register(c.Request.Context(), &req)
	if err != nil {
		if errors.Is(err, ErrEmailExists) {
			c.JSON(http.StatusConflict, gin.H{
				"error":   "email_exists",
				"message": "This email is already registered",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "registration_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, resp)
}

// Login handles user login
// POST /api/v1/auth/login
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	meta := sessionMetaFromRequest(c, req.DeviceID, req.DeviceName)
	resp, err := h.service.Login(c.Request.Context(), &req, meta)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			middleware.GetLoginGuard().RecordFailure(c.ClientIP())
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_credentials",
				"message": "Invalid email or password",
			})
			return
		}
		if errors.Is(err, ErrAccountSuspended) {
			middleware.GetLoginGuard().RecordFailure(c.ClientIP())
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "account_suspended",
				"message": "Your account has been suspended. Please contact your administrator.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "login_failed",
			"message": err.Error(),
		})
		return
	}

	middleware.GetLoginGuard().RecordSuccess(c.ClientIP())
	h.setSessionCookies(c, resp)
	c.JSON(http.StatusOK, resp)
}

// Refresh rotates the current refresh session and issues a fresh access/refresh pair.
// POST /api/v1/auth/refresh
func (h *Handler) Refresh(c *gin.Context) {
	if err := middleware.ValidateCSRFFromRequest(c, middleware.CSRFConfig{
		AllowedOrigins: []string{
			h.service.config.App.DashURL,
			h.service.config.App.FormsURL,
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:1000",
			"http://127.0.0.1:1000",
		},
	}); err != nil {
		log.Printf("[auth][refresh] csrf_failed host=%s ip=%s origin=%s referer=%s reason=%v", c.Request.Host, c.ClientIP(), c.GetHeader("Origin"), c.GetHeader("Referer"), err)
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "invalid_csrf_request",
			"message": err.Error(),
		})
		return
	}

	var req RefreshRequest
	_ = c.ShouldBindJSON(&req)

	refreshToken := strings.TrimSpace(req.RefreshToken)
	if refreshToken == "" {
		if cookieValue, err := c.Cookie("School24_api_refresh"); err == nil {
			refreshToken = strings.TrimSpace(cookieValue)
		}
	}
	if refreshToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "missing_refresh_token",
			"message": "Refresh token is required",
		})
		log.Printf("[auth][refresh] missing_refresh_token host=%s ip=%s has_access_cookie=%t has_refresh_cookie=%t", c.Request.Host, c.ClientIP(), cookiePresent(c, "School24_api_token"), cookiePresent(c, "School24_api_refresh"))
		return
	}

	meta := sessionMetaFromRequest(c, req.DeviceID, req.DeviceName)
	resp, err := h.service.Refresh(c.Request.Context(), refreshToken, meta)
	if err != nil {
		if errors.Is(err, ErrInvalidRefresh) || errors.Is(err, ErrExpiredRefresh) {
			h.clearSessionCookies(c)
			log.Printf("[auth][refresh] invalid_refresh host=%s ip=%s reason=%v", c.Request.Host, c.ClientIP(), err)
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_refresh",
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "refresh_failed",
			"message": err.Error(),
		})
		return
	}

	h.setSessionCookies(c, resp)
	log.Printf("[auth][refresh] success host=%s ip=%s user_id=%s role=%s", c.Request.Host, c.ClientIP(), resp.User.ID.String(), resp.User.Role)
	c.JSON(http.StatusOK, resp)
}

func cookiePresent(c *gin.Context, name string) bool {
	v, err := c.Cookie(name)
	return err == nil && strings.TrimSpace(v) != ""
}

// GetCSRFToken returns the current CSRF token for the authenticated web session.
// GET /api/v1/auth/csrf
func (h *Handler) GetCSRFToken(c *gin.Context) {
	if token, err := c.Cookie(middleware.CSRFCookieName); err == nil && strings.TrimSpace(token) != "" {
		c.JSON(http.StatusOK, gin.H{"csrf_token": token})
		return
	}

	token, err := middleware.GenerateCSRFToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "csrf_generation_failed",
			"message": err.Error(),
		})
		return
	}

	h.setCSRFCookie(c, token, h.service.config.JWT.RefreshExpirationDays*24*60*60)
	c.JSON(http.StatusOK, gin.H{"csrf_token": token})
}

// GetMe returns the current user's profile
// GET /api/v1/auth/me
func (h *Handler) GetMe(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "User not authenticated",
		})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_user_id",
			"message": "Invalid user ID format",
		})
		return
	}

	// Get role from JWT to determine which table to query
	role := middleware.GetRole(c)

	user, err := h.service.GetMe(c.Request.Context(), userID, role)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "user_not_found",
				"message": "User not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "fetch_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

// UpdateProfile updates the current user's profile
// PUT /api/v1/auth/me
func (h *Handler) UpdateProfile(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "User not authenticated",
		})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_user_id",
			"message": "Invalid user ID format",
		})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	// Get role from JWT to determine which table to update
	role := middleware.GetRole(c)

	user, err := h.service.UpdateProfile(c.Request.Context(), userID, role, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "update_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

// ListSuperAdmins returns all super admins
// GET /api/v1/super-admins
func (h *Handler) ListSuperAdmins(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "super admin access required",
		})
		return
	}

	items, err := h.service.ListSuperAdmins(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "list_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"super_admins": items})
}

// CreateSuperAdmin creates a new super admin
// POST /api/v1/super-admins
// Requires current super admin password verification
func (h *Handler) CreateSuperAdmin(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "super admin access required",
		})
		return
	}

	type CreateSuperAdminWithPasswordRequest struct {
		CreateSuperAdminRequest
		CurrentPassword string `json:"current_password" binding:"required"`
	}

	var req CreateSuperAdminWithPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	// Get current super admin ID
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	currentUserID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	sa, err := h.service.CreateSuperAdmin(c.Request.Context(), currentUserID, req.CurrentPassword, &req.CreateSuperAdminRequest)
	if err != nil {
		if err == ErrEmailExists {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "email_exists",
				"message": "email already registered",
			})
			return
		}
		if err == ErrInvalidPassword || err == ErrPasswordRequired {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_password",
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "create_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"super_admin": sa})
}

// DeleteSuperAdmin removes a super admin by ID
// DELETE /api/v1/super-admins/:id
// Requires current super admin password verification
func (h *Handler) DeleteSuperAdmin(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "super admin access required",
		})
		return
	}

	type DeleteSuperAdminRequest struct {
		Password string `json:"password" binding:"required"`
	}

	var req DeleteSuperAdminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "User not authenticated",
		})
		return
	}

	currentUserID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_user_id",
			"message": "Invalid user ID format",
		})
		return
	}

	targetIDStr := c.Param("id")
	targetID, err := uuid.Parse(targetIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_target_id",
			"message": "Invalid target ID format",
		})
		return
	}

	if err := h.service.DeleteSuperAdmin(c.Request.Context(), currentUserID, req.Password, targetID); err != nil {
		if err == ErrCannotDeleteSelf {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "cannot_delete_self",
				"message": "You cannot delete your own account",
			})
			return
		}
		if err == ErrLastSuperAdmin {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "last_super_admin",
				"message": "At least one super admin must remain",
			})
			return
		}
		if err == ErrInvalidPassword || err == ErrPasswordRequired {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_password",
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "delete_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Super admin removed"})
}

// ChangePassword updates the current user's password
// POST /api/v1/auth/change-password
func (h *Handler) ChangePassword(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "User not authenticated",
		})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid_user_id",
			"message": "Invalid user ID format",
		})
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	// Validate new password strength
	if len(req.NewPassword) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "weak_password",
			"message": "New password must be at least 8 characters",
		})
		return
	}

	// Get role from JWT to determine which table to update
	role := middleware.GetRole(c)

	if err := h.service.ChangePassword(c.Request.Context(), userID, role, &req); err != nil {
		if err == ErrInvalidCredentials {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_password",
				"message": "Current password is incorrect",
			})
			return
		}
		if err == ErrUserNotFound {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "user_not_found",
				"message": "User account not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "password_change_failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Password changed successfully",
	})
}

// Logout handles user logout (client-side token removal)
// POST /api/v1/auth/logout
func (h *Handler) Logout(c *gin.Context) {
	if err := middleware.ValidateCSRFFromRequest(c, middleware.CSRFConfig{
		AllowedOrigins: []string{
			h.service.config.App.DashURL,
			h.service.config.App.FormsURL,
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:1000",
			"http://127.0.0.1:1000",
		},
	}); err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "invalid_csrf_request",
			"message": err.Error(),
		})
		return
	}

	if sessionID := c.GetString("session_id"); sessionID != "" {
		if parsed, err := uuid.Parse(sessionID); err == nil {
			_ = h.service.repo.RevokeAuthSession(c.Request.Context(), parsed)
		}
	}

	if refreshToken, err := c.Cookie("School24_api_refresh"); err == nil && strings.TrimSpace(refreshToken) != "" {
		if session, lookupErr := h.service.repo.GetAuthSessionByRefreshToken(c.Request.Context(), refreshToken); lookupErr == nil && session != nil {
			_ = h.service.repo.RevokeAuthSession(c.Request.Context(), session.ID)
		}
	}

	h.clearSessionCookies(c)
	c.JSON(http.StatusOK, gin.H{
		"message": "Logged out successfully",
	})
}

// CreateWSTicket issues a short-lived, scope-limited WebSocket ticket so the frontend
// does not need to expose the primary access token in the WS URL.
// GET /api/v1/auth/ws-ticket?scope=support|teacher_messages|admissions|chat|driver_tracking|transport_read[&class_id=UUID]
func (h *Handler) CreateWSTicket(c *gin.Context) {
	userID := middleware.GetUserID(c)
	role := middleware.GetRole(c)
	schoolID := middleware.GetSchoolID(c)
	email := c.GetString("email")
	sessionID := middleware.GetSessionID(c)

	scope := strings.TrimSpace(c.Query("scope"))
	classID := strings.TrimSpace(c.Query("class_id"))
	if scope == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scope_required"})
		return
	}

	switch scope {
	case "support":
		if role != RoleSuperAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
	case "teacher_messages":
		if role != RoleTeacher && role != RoleAdmin && role != RoleSuperAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		if classID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "class_id_required"})
			return
		}
	case "admissions":
		if role != RoleAdmin && role != RoleSuperAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
	case "chat":
		if userID == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
	case "driver_tracking":
		if role != RoleStaff {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
	case "transport_read":
		if role != RoleStudent && role != RoleAdmin && role != RoleSuperAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_scope"})
		return
	}

	expiresIn := 120 * time.Second
	ticket, err := middleware.GenerateToken(h.service.config.JWT.Secret, middleware.Claims{
		UserID:    userID,
		Email:     email,
		Role:      role,
		SchoolID:  schoolID,
		SessionID: sessionID,
		WSScope:   scope,
		ClassID:   classID,
	}, expiresIn)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ticket_generation_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ticket":     ticket,
		"expires_in": int(expiresIn.Seconds()),
		"scope":      scope,
		"class_id":   classID,
	})
}

func (h *Handler) setSessionCookies(c *gin.Context, resp *AuthResponse) {
	if resp == nil || resp.AccessToken == "" {
		return
	}

	maxAge := resp.ExpiresIn
	if maxAge <= 0 {
		maxAge = 24 * 60 * 60
	}

	secure := true
	sameSite := http.SameSiteNoneMode
	if h.service.config.App.Env == "development" {
		secure = false
		sameSite = http.SameSiteLaxMode
	}

	domain := resolveCookieDomain(c, h.service.config.App.CookieDomain)
	accessCookie := &http.Cookie{
		Name:     "School24_api_token",
		Value:    resp.AccessToken,
		Path:     "/",
		Domain:   domain,
		MaxAge:   maxAge,
		Expires:  time.Now().Add(time.Duration(maxAge) * time.Second),
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
	}

	c.SetSameSite(sameSite)
	http.SetCookie(c.Writer, accessCookie)

	if csrfToken, err := middleware.GenerateCSRFToken(); err == nil {
		h.setCSRFCookie(c, csrfToken, maxAge)
	}

	if resp.RefreshToken != "" {
		refreshMaxAge := h.service.config.JWT.RefreshExpirationDays * 24 * 60 * 60
		refreshCookie := &http.Cookie{
			Name:     "School24_api_refresh",
			Value:    resp.RefreshToken,
			Path:     "/",
			Domain:   domain,
			MaxAge:   refreshMaxAge,
			Expires:  time.Now().Add(time.Duration(refreshMaxAge) * time.Second),
			HttpOnly: true,
			Secure:   secure,
			SameSite: sameSite,
		}
		http.SetCookie(c.Writer, refreshCookie)
	}
}

func (h *Handler) clearSessionCookies(c *gin.Context) {
	secure := true
	sameSite := http.SameSiteNoneMode
	if h.service.config.App.Env == "development" {
		secure = false
		sameSite = http.SameSiteLaxMode
	}

	domain := resolveCookieDomain(c, h.service.config.App.CookieDomain)
	c.SetSameSite(sameSite)
	for _, name := range []string{"School24_api_token", "School24_api_refresh", middleware.CSRFCookieName} {
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			Domain:   domain,
			MaxAge:   -1,
			Expires:  time.Unix(0, 0),
			HttpOnly: true,
			Secure:   secure,
			SameSite: sameSite,
		})
	}
}

func (h *Handler) setCSRFCookie(c *gin.Context, token string, maxAge int) {
	if strings.TrimSpace(token) == "" {
		return
	}

	secure := true
	sameSite := http.SameSiteNoneMode
	if h.service.config.App.Env == "development" {
		secure = false
		sameSite = http.SameSiteLaxMode
	}

	if maxAge <= 0 {
		maxAge = h.service.config.JWT.RefreshExpirationDays * 24 * 60 * 60
	}

	domain := resolveCookieDomain(c, h.service.config.App.CookieDomain)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     middleware.CSRFCookieName,
		Value:    token,
		Path:     "/",
		Domain:   domain,
		MaxAge:   maxAge,
		Expires:  time.Now().Add(time.Duration(maxAge) * time.Second),
		HttpOnly: false,
		Secure:   secure,
		SameSite: sameSite,
	})
}

// resolveCookieDomain ensures we never emit an invalid Domain attribute.
// If APP_COOKIE_DOMAIN doesn't match the current request host, fall back to
// host-only cookies so browser accepts auth/refresh cookies.
func resolveCookieDomain(c *gin.Context, configured string) string {
	configured = strings.TrimSpace(strings.ToLower(strings.TrimPrefix(configured, ".")))
	if configured == "" {
		return ""
	}

	host := strings.TrimSpace(strings.ToLower(c.Request.Host))
	if host == "" {
		return ""
	}

	if h, _, err := net.SplitHostPort(host); err == nil {
		host = strings.ToLower(strings.TrimSpace(h))
	}

	if host == configured || strings.HasSuffix(host, "."+configured) {
		return configured
	}

	return ""
}

func sessionMetaFromRequest(c *gin.Context, deviceID, deviceName string) *SessionMeta {
	return &SessionMeta{
		DeviceID:   strings.TrimSpace(deviceID),
		DeviceName: strings.TrimSpace(deviceName),
		UserAgent:  strings.TrimSpace(c.Request.UserAgent()),
		ClientIP:   strings.TrimSpace(c.ClientIP()),
	}
}

// RegisterPushToken binds a native device token to the authenticated user.
// POST /api/v1/auth/push-tokens
func (h *Handler) RegisterPushToken(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}

	var req RegisterPushTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "validation_error", "message": err.Error()})
		return
	}

	role := middleware.GetRole(c)
	var schoolID *uuid.UUID
	if rawSchoolID := strings.TrimSpace(middleware.GetSchoolID(c)); rawSchoolID != "" {
		if parsed, err := uuid.Parse(rawSchoolID); err == nil {
			schoolID = &parsed
		}
	}

	if err := h.service.RegisterPushToken(c.Request.Context(), userID, schoolID, role, &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "push_token_register_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "push token registered"})
}

// DeletePushToken removes the current device token mapping for the authenticated user.
// DELETE /api/v1/auth/push-tokens
func (h *Handler) DeletePushToken(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}

	var req DeletePushTokenRequest
	_ = c.ShouldBindJSON(&req)
	if req.Token == "" {
		req.Token = strings.TrimSpace(c.Query("token"))
	}
	if req.DeviceID == "" {
		req.DeviceID = strings.TrimSpace(c.Query("device_id"))
	}

	if strings.TrimSpace(req.Token) == "" && strings.TrimSpace(req.DeviceID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token_or_device_id_required"})
		return
	}

	if err := h.service.DeletePushToken(c.Request.Context(), userID, &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "push_token_delete_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "push token deleted"})
}

// SendTestPush sends a test notification to the authenticated user's registered devices.
// POST /api/v1/auth/push-tokens/test
func (h *Handler) SendTestPush(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}

	var req SendTestPushRequest
	_ = c.ShouldBindJSON(&req)

	if err := h.service.SendTestPush(c.Request.Context(), userID, &req); err != nil {
		if err.Error() == "no_registered_devices" || err.Error() == "fcm_server_key_not_configured" {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "push_test_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "test notification sent"})
}

// SuspendSuperAdmin suspends another super admin - prevents login, all content preserved
// PUT /api/v1/super-admins/:id/suspend
func (h *Handler) SuspendSuperAdmin(c *gin.Context) {
	if middleware.GetRole(c) != RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "super admin access required"})
		return
	}

	var req SuspendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	callerIDStr := middleware.GetUserID(c)
	callerID, err := uuid.Parse(callerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid caller ID"})
		return
	}

	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid target ID"})
		return
	}

	if err := h.service.SuspendSuperAdmin(c.Request.Context(), callerID, req.Password, targetID); err != nil {
		switch err {
		case ErrCannotSuspendSelf:
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot_suspend_self", "message": "You cannot suspend your own account"})
		case ErrInvalidPassword, ErrPasswordRequired:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_password", "message": "Incorrect password"})
		case ErrUserNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Super admin not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "suspend_failed", "message": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Super admin suspended successfully"})
}

// UnsuspendSuperAdmin lifts the suspension from a super admin
// PUT /api/v1/super-admins/:id/unsuspend
func (h *Handler) UnsuspendSuperAdmin(c *gin.Context) {
	if middleware.GetRole(c) != RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "super admin access required"})
		return
	}

	var req SuspendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password required"})
		return
	}

	callerIDStr := middleware.GetUserID(c)
	callerID, err := uuid.Parse(callerIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid caller ID"})
		return
	}

	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid target ID"})
		return
	}

	if err := h.service.UnsuspendSuperAdmin(c.Request.Context(), callerID, req.Password, targetID); err != nil {
		switch err {
		case ErrInvalidPassword, ErrPasswordRequired:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_password", "message": "Incorrect password"})
		case ErrUserNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Super admin not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "unsuspend_failed", "message": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Super admin unsuspended successfully"})
}
