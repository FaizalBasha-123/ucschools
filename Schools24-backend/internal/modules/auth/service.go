package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/shared/middleware"
	"golang.org/x/crypto/bcrypt"
)

// Service handles authentication business logic
type Service struct {
	repo   *Repository
	config *config.Config
}

// Common errors
var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrEmailExists        = errors.New("email already registered")
	ErrUserNotFound       = errors.New("user not found")
	ErrCannotDeleteSelf   = errors.New("cannot delete current super admin")
	ErrLastSuperAdmin     = errors.New("cannot delete last super admin")
	ErrPasswordRequired   = errors.New("password verification required")
	ErrInvalidPassword    = errors.New("incorrect password")
	ErrAccountSuspended   = errors.New("account has been suspended")
	ErrCannotSuspendSelf  = errors.New("cannot suspend your own account")
	ErrInvalidRefresh     = errors.New("invalid refresh session")
	ErrExpiredRefresh     = errors.New("refresh session expired")
)

// NewService creates a new auth service
func NewService(repo *Repository, cfg *config.Config) *Service {
	return &Service{
		repo:   repo,
		config: cfg,
	}
}

// Register creates a new user account
func (s *Service) Register(ctx context.Context, req *RegisterRequest) (*AuthResponse, error) {
	// Check if email exists
	exists, err := s.repo.EmailExists(ctx, req.Email)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrEmailExists
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	// Create user
	user := &User{
		Email:        req.Email,
		PasswordHash: string(hashedPassword),
		Role:         req.Role,
		FullName:     req.FullName,
	}
	if req.Phone != "" {
		user.Phone = &req.Phone
	}

	if err := s.repo.CreateUser(ctx, user); err != nil {
		return nil, err
	}

	// Generate tokens (registration uses default short session)
	return s.generateAuthResponse(user, false)
}

// Login authenticates a user and returns tokens
// Checks both super_admins (isolated) and users (school-scoped) tables
func (s *Service) Login(ctx context.Context, req *LoginRequest, meta *SessionMeta) (*AuthResponse, error) {
	// First, check if this is a super admin (separate table for security)
	superAdmin, err := s.repo.GetSuperAdminByEmail(ctx, req.Email)
	if err != nil {
		return nil, err
	}

	if superAdmin != nil {
		// Verify super admin password
		if err := bcrypt.CompareHashAndPassword([]byte(superAdmin.PasswordHash), []byte(req.Password)); err != nil {
			return nil, ErrInvalidCredentials
		}

		// Block suspended accounts
		if superAdmin.IsSuspended {
			return nil, ErrAccountSuspended
		}

		// Update last login for super admin
		_ = s.repo.UpdateSuperAdminLastLogin(ctx, superAdmin.ID)

		// Convert SuperAdmin to User format for token generation
		superAdminUser := &User{
			ID:                superAdmin.ID,
			Email:             superAdmin.Email,
			PasswordHash:      superAdmin.PasswordHash,
			Role:              RoleSuperAdmin,
			FullName:          superAdmin.FullName,
			Phone:             superAdmin.Phone,
			ProfilePictureURL: superAdmin.ProfilePictureURL,
			SchoolID:          nil, // Super admin has no school
			EmailVerified:     superAdmin.EmailVerified,
			LastLoginAt:       superAdmin.LastLoginAt,
			CreatedAt:         superAdmin.CreatedAt,
			UpdatedAt:         superAdmin.UpdatedAt,
		}

		// Generate tokens with remember me support
		return s.generateSessionAuthResponse(ctx, superAdminUser, req.RememberMe, meta, nil)
	}

	// Not a super admin, check regular users table (school-scoped)
	user, err := s.repo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrInvalidCredentials
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	// Block suspended accounts
	if user.IsSuspended {
		return nil, ErrAccountSuspended
	}

	// Update last login in tenant schema
	if user.SchoolID != nil {
		lastLoginAt, loginCount, err := s.repo.UpdateLastLoginInSchool(ctx, *user.SchoolID, user.ID)
		if err != nil {
			return nil, err
		}
		user.LastLoginAt = lastLoginAt
		user.LoginCount = loginCount
	}

	// Generate tokens with remember me support
	return s.generateSessionAuthResponse(ctx, user, req.RememberMe, meta, nil)
}

// GetMe returns the current user's profile
// Routes to appropriate table based on role
func (s *Service) GetMe(ctx context.Context, userID uuid.UUID, role string) (*User, error) {
	// Super admin stored in separate table
	if role == RoleSuperAdmin {
		superAdmin, err := s.repo.GetSuperAdminByID(ctx, userID)
		if err != nil {
			return nil, err
		}
		if superAdmin == nil {
			return nil, ErrUserNotFound
		}

		// Convert SuperAdmin to User for consistent response
		return &User{
			ID:                superAdmin.ID,
			Email:             superAdmin.Email,
			PasswordHash:      superAdmin.PasswordHash,
			Role:              RoleSuperAdmin,
			FullName:          superAdmin.FullName,
			Phone:             superAdmin.Phone,
			ProfilePictureURL: superAdmin.ProfilePictureURL,
			SchoolID:          nil,
			EmailVerified:     superAdmin.EmailVerified,
			LastLoginAt:       superAdmin.LastLoginAt,
			CreatedAt:         superAdmin.CreatedAt,
			UpdatedAt:         superAdmin.UpdatedAt,
		}, nil
	}

	// Regular users from users table
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}
	return user, nil
}

// UpdateProfile updates user profile
// Routes to appropriate table based on role
func (s *Service) UpdateProfile(ctx context.Context, userID uuid.UUID, role string, req *UpdateProfileRequest) (*User, error) {
	// Super admin stored in separate table
	if role == RoleSuperAdmin {
		superAdmin, err := s.repo.UpdateSuperAdminProfile(ctx, userID, req)
		if err != nil {
			return nil, err
		}

		// Convert SuperAdmin to User for consistent response
		return &User{
			ID:                superAdmin.ID,
			Email:             superAdmin.Email,
			PasswordHash:      superAdmin.PasswordHash,
			Role:              RoleSuperAdmin,
			FullName:          superAdmin.FullName,
			Phone:             superAdmin.Phone,
			ProfilePictureURL: superAdmin.ProfilePictureURL,
			SchoolID:          nil,
			EmailVerified:     superAdmin.EmailVerified,
			LastLoginAt:       superAdmin.LastLoginAt,
			CreatedAt:         superAdmin.CreatedAt,
			UpdatedAt:         superAdmin.UpdatedAt,
		}, nil
	}

	// Regular users from users table
	return s.repo.UpdateProfile(ctx, userID, req)
}

// CreateSuperAdmin creates a new super admin (global)
// Requires password verification from the current super admin for security
func (s *Service) CreateSuperAdmin(ctx context.Context, currentUserID uuid.UUID, currentPassword string, req *CreateSuperAdminRequest) (*SuperAdmin, error) {
	// 1. Verify current super admin's password
	if err := s.VerifySuperAdminPassword(ctx, currentUserID, currentPassword); err != nil {
		return nil, err
	}

	// 2. Check if email already exists
	exists, err := s.repo.EmailExists(ctx, req.Email)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrEmailExists
	}

	// 3. Hash password for new super admin
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	sa := &SuperAdmin{
		Email:             req.Email,
		PasswordHash:      string(hashedPassword),
		FullName:          req.FullName,
		Phone:             req.Phone,
		ProfilePictureURL: req.ProfilePictureURL,
	}

	// 4. Create the new super admin
	if err := s.repo.CreateSuperAdmin(ctx, sa); err != nil {
		return nil, err
	}

	return sa, nil
}

// ListSuperAdmins returns all super admins
func (s *Service) ListSuperAdmins(ctx context.Context) ([]SuperAdmin, error) {
	return s.repo.ListSuperAdmins(ctx)
}

// DeleteSuperAdmin removes a super admin by ID with safety checks
// Requires password verification from the current super admin
func (s *Service) DeleteSuperAdmin(ctx context.Context, currentUserID uuid.UUID, currentPassword string, targetID uuid.UUID) error {
	// 1. Verify current super admin's password
	if err := s.VerifySuperAdminPassword(ctx, currentUserID, currentPassword); err != nil {
		return err
	}

	// 2. Cannot delete self
	if currentUserID == targetID {
		return ErrCannotDeleteSelf
	}

	// 3. Must keep at least one super admin
	count, err := s.repo.CountSuperAdmins(ctx)
	if err != nil {
		return err
	}
	if count <= 1 {
		return ErrLastSuperAdmin
	}

	// 4. Delete the super admin
	return s.repo.DeleteSuperAdminByID(ctx, targetID)
}

// SuspendSuperAdmin suspends another super admin (prevents login, all content preserved)
// Requires password verification from the caller
func (s *Service) SuspendSuperAdmin(ctx context.Context, callerID uuid.UUID, callerPassword string, targetID uuid.UUID) error {
	if err := s.VerifySuperAdminPassword(ctx, callerID, callerPassword); err != nil {
		return err
	}
	if callerID == targetID {
		return ErrCannotSuspendSelf
	}
	return s.repo.SuspendSuperAdmin(ctx, targetID, callerID)
}

// UnsuspendSuperAdmin lifts a suspension from a super admin
// Requires password verification from the caller
func (s *Service) UnsuspendSuperAdmin(ctx context.Context, callerID uuid.UUID, callerPassword string, targetID uuid.UUID) error {
	if err := s.VerifySuperAdminPassword(ctx, callerID, callerPassword); err != nil {
		return err
	}
	return s.repo.UnsuspendSuperAdmin(ctx, targetID)
}

// ChangePassword updates user password after verifying current password
// Handles both super_admins and regular users
func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, role string, req *ChangePasswordRequest) error {
	var currentHash string
	var err error

	// Get current password hash based on role
	if role == RoleSuperAdmin {
		// Fetch from super_admins table
		superAdmin, err := s.repo.GetSuperAdminByID(ctx, userID)
		if err != nil {
			return ErrUserNotFound
		}
		if superAdmin == nil {
			return ErrUserNotFound
		}
		currentHash = superAdmin.PasswordHash
	} else {
		// Fetch from users table
		user, err := s.repo.GetUserByID(ctx, userID)
		if err != nil {
			return ErrUserNotFound
		}
		if user == nil {
			return ErrUserNotFound
		}
		currentHash = user.PasswordHash
	}

	// Verify current password
	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.CurrentPassword)); err != nil {
		return ErrInvalidCredentials
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	// Update password in appropriate table
	if role == RoleSuperAdmin {
		return s.repo.UpdateSuperAdminPassword(ctx, userID, string(hashedPassword))
	}
	return s.repo.UpdateUserPassword(ctx, userID, string(hashedPassword))
}

func (s *Service) Refresh(ctx context.Context, refreshToken string, meta *SessionMeta) (*AuthResponse, error) {
	if refreshToken == "" {
		return nil, ErrInvalidRefresh
	}

	session, err := s.repo.GetAuthSessionByRefreshToken(ctx, refreshToken)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrInvalidRefresh
	}
	if session.RevokedAt != nil {
		_ = s.repo.RevokeTokenFamily(ctx, session.TokenFamilyID)
		return nil, ErrInvalidRefresh
	}
	if time.Now().After(session.ExpiresAt) {
		_ = s.repo.RevokeAuthSession(ctx, session.ID)
		return nil, ErrExpiredRefresh
	}

	var user *User
	if session.Role == RoleSuperAdmin {
		superAdmin, err := s.repo.GetSuperAdminByID(ctx, session.UserID)
		if err != nil {
			return nil, err
		}
		if superAdmin == nil || superAdmin.IsSuspended {
			_ = s.repo.RevokeTokenFamily(ctx, session.TokenFamilyID)
			return nil, ErrInvalidRefresh
		}
		user = &User{
			ID:                superAdmin.ID,
			Email:             superAdmin.Email,
			PasswordHash:      superAdmin.PasswordHash,
			Role:              RoleSuperAdmin,
			FullName:          superAdmin.FullName,
			Phone:             superAdmin.Phone,
			ProfilePictureURL: superAdmin.ProfilePictureURL,
		}
	} else {
		user, err = s.repo.GetUserByID(ctx, session.UserID)
		if err != nil {
			return nil, err
		}
		if user == nil || user.IsSuspended {
			_ = s.repo.RevokeTokenFamily(ctx, session.TokenFamilyID)
			return nil, ErrInvalidRefresh
		}
	}

	if meta == nil {
		meta = &SessionMeta{}
	}
	if meta.DeviceID == "" && session.DeviceID != nil {
		meta.DeviceID = *session.DeviceID
	}
	if meta.DeviceName == "" && session.DeviceName != nil {
		meta.DeviceName = *session.DeviceName
	}
	if meta.UserAgent == "" && session.UserAgent != nil {
		meta.UserAgent = *session.UserAgent
	}
	if meta.ClientIP == "" && session.ClientIP != nil {
		meta.ClientIP = *session.ClientIP
	}

	return s.generateSessionAuthResponse(ctx, user, false, meta, session)
}

func (s *Service) ValidateAccessSession(ctx context.Context, claims *middleware.Claims) error {
	if claims == nil {
		return ErrInvalidRefresh
	}
	if claims.SessionID == "" {
		return fmt.Errorf("session-bound access token required")
	}

	sessionID, err := uuid.Parse(claims.SessionID)
	if err != nil {
		return fmt.Errorf("invalid session binding")
	}

	session, err := s.repo.GetAuthSessionByID(ctx, sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return ErrInvalidRefresh
	}
	if session.RevokedAt != nil {
		return ErrInvalidRefresh
	}
	if time.Now().After(session.ExpiresAt) {
		_ = s.repo.RevokeAuthSession(ctx, session.ID)
		return ErrExpiredRefresh
	}
	if session.UserID.String() != claims.UserID || session.Role != claims.Role {
		_ = s.repo.RevokeTokenFamily(ctx, session.TokenFamilyID)
		return fmt.Errorf("session claims mismatch")
	}
	if session.SchoolID != nil && session.SchoolID.String() != claims.SchoolID {
		_ = s.repo.RevokeTokenFamily(ctx, session.TokenFamilyID)
		return fmt.Errorf("session school mismatch")
	}

	_ = s.repo.TouchAuthSession(ctx, session.ID)
	return nil
}

// generateAuthResponse creates tokens and auth response
// rememberMe extends the token expiry to 30 days for persistent sessions
func (s *Service) generateAuthResponse(user *User, rememberMe bool) (*AuthResponse, error) {
	var expiryHours int
	if rememberMe {
		// 30 days = 720 hours for "Remember me" sessions
		expiryHours = 30 * 24 // 720 hours
	} else {
		// Default short session from config (typically 24 hours)
		expiryHours = s.config.JWT.ExpirationHours
	}
	expiry := time.Duration(expiryHours) * time.Hour

	var schoolID string
	if user.SchoolID != nil {
		schoolID = user.SchoolID.String()
	}

	claims := middleware.Claims{
		UserID:   user.ID.String(),
		Email:    user.Email,
		Role:     user.Role,
		SchoolID: schoolID,
	}

	accessToken, err := middleware.GenerateToken(s.config.JWT.Secret, claims, expiry)
	if err != nil {
		return nil, err
	}

	// Generate refresh token (longer expiry)
	refreshExpiry := time.Duration(s.config.JWT.RefreshExpirationDays) * 24 * time.Hour
	refreshToken, err := middleware.GenerateToken(s.config.JWT.Secret, claims, refreshExpiry)
	if err != nil {
		return nil, err
	}

	return &AuthResponse{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    expiryHours * 3600, // In seconds
	}, nil
}

func (s *Service) generateSessionAuthResponse(ctx context.Context, user *User, rememberMe bool, meta *SessionMeta, rotateFrom *AuthSession) (*AuthResponse, error) {
	refreshExpiry := time.Duration(s.config.JWT.RefreshExpirationDays) * 24 * time.Hour
	now := time.Now()
	session := &AuthSession{
		ID:               uuid.New(),
		UserID:           user.ID,
		SchoolID:         user.SchoolID,
		Role:             user.Role,
		TokenFamilyID:    uuid.New(),
		ExpiresAt:        now.Add(refreshExpiry),
		LastSeenAt:       now,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if rotateFrom != nil {
		session.TokenFamilyID = rotateFrom.TokenFamilyID
	}
	if meta != nil {
		if meta.DeviceID != "" {
			session.DeviceID = &meta.DeviceID
		}
		if meta.DeviceName != "" {
			session.DeviceName = &meta.DeviceName
		}
		if meta.UserAgent != "" {
			session.UserAgent = &meta.UserAgent
		}
		if meta.ClientIP != "" {
			session.ClientIP = &meta.ClientIP
		}
	}

	var expiryHours int
	if rememberMe {
		expiryHours = 30 * 24
	} else {
		expiryHours = s.config.JWT.ExpirationHours
	}
	accessExpiry := time.Duration(expiryHours) * time.Hour

	var schoolID string
	if user.SchoolID != nil {
		schoolID = user.SchoolID.String()
	}

	accessClaims := middleware.Claims{
		UserID:    user.ID.String(),
		Email:     user.Email,
		Role:      user.Role,
		SchoolID:  schoolID,
		SessionID: session.ID.String(),
	}
	accessToken, err := middleware.GenerateToken(s.config.JWT.Secret, accessClaims, accessExpiry)
	if err != nil {
		return nil, err
	}

	refreshClaims := middleware.Claims{
		UserID:    user.ID.String(),
		Email:     user.Email,
		Role:      user.Role,
		SchoolID:  schoolID,
		SessionID: session.ID.String(),
	}
	refreshToken, err := middleware.GenerateToken(s.config.JWT.Secret, refreshClaims, refreshExpiry)
	if err != nil {
		return nil, err
	}

	resp := &AuthResponse{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    expiryHours * 3600,
	}
	resp.SessionID = session.ID.String()
	session.RefreshTokenHash = hashRefreshToken(resp.RefreshToken)
	if rotateFrom != nil {
		if err := s.repo.RotateAuthSession(ctx, rotateFrom.ID, session); err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.CreateAuthSession(ctx, session); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

// VerifySuperAdminPassword verifies a super admin's password for sensitive operations
// This is used to confirm identity before destructive actions (delete school, create super admin, etc.)
func (s *Service) VerifySuperAdminPassword(ctx context.Context, superAdminID uuid.UUID, password string) error {
	if password == "" {
		return ErrPasswordRequired
	}

	// Fetch super admin from database
	superAdmin, err := s.repo.GetSuperAdminByID(ctx, superAdminID)
	if err != nil {
		return err
	}
	if superAdmin == nil {
		return ErrUserNotFound
	}

	// Verify password hash
	if err := bcrypt.CompareHashAndPassword([]byte(superAdmin.PasswordHash), []byte(password)); err != nil {
		return ErrInvalidPassword
	}

	return nil
}
