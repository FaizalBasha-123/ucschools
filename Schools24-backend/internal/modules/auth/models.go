package auth

import (
	"time"

	"github.com/google/uuid"
)

// SuperAdmin represents a global administrator (isolated from school users)
type SuperAdmin struct {
	ID                uuid.UUID  `json:"id" db:"id"`
	Email             string     `json:"email" db:"email"`
	PasswordHash      string     `json:"-" db:"password_hash"`
	FullName          string     `json:"full_name" db:"full_name"`
	Phone             *string    `json:"phone,omitempty" db:"phone"`
	ProfilePictureURL *string    `json:"profile_picture_url,omitempty" db:"profile_picture_url"`
	EmailVerified     bool       `json:"email_verified" db:"email_verified"`
	IsSuspended       bool       `json:"is_suspended" db:"is_suspended"`
	SuspendedAt       *time.Time `json:"suspended_at,omitempty" db:"suspended_at"`
	LastLoginAt       *time.Time `json:"last_login_at,omitempty" db:"last_login_at"`
	CreatedAt         time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at" db:"updated_at"`
}

// User represents a user in the system
type User struct {
	ID                uuid.UUID  `json:"id" db:"id"`
	Email             string     `json:"email" db:"email"`
	PasswordHash      string     `json:"-" db:"password_hash"`
	Role              string     `json:"role" db:"role"`
	FullName          string     `json:"full_name" db:"full_name"`
	Phone             *string    `json:"phone,omitempty" db:"phone"`
	ProfilePictureURL *string    `json:"profile_picture_url,omitempty" db:"profile_picture_url"`
	SchoolID          *uuid.UUID `json:"school_id,omitempty" db:"school_id"`
	SchoolName        *string    `json:"school_name,omitempty" db:"school_name"` // Added from JOIN
	EmailVerified     bool       `json:"email_verified" db:"email_verified"`
	IsSuspended       bool       `json:"is_suspended" db:"is_suspended"`
	SuspendedAt       *time.Time `json:"suspended_at,omitempty" db:"suspended_at"`
	LastLoginAt       *time.Time `json:"last_login_at,omitempty" db:"last_login_at"`
	LoginCount        int        `json:"login_count" db:"login_count"`
	CreatedBy         *uuid.UUID `json:"created_by,omitempty" db:"created_by"`
	CreatedAt         time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at" db:"updated_at"`
}

// UserRole constants
const (
	RoleSuperAdmin = "super_admin"
	RoleAdmin      = "admin"
	RoleTeacher    = "teacher"
	RoleStudent    = "student"
	RoleStaff      = "staff"
	RoleParent     = "parent"
)

// LoginRequest represents login credentials
type LoginRequest struct {
	Email      string `json:"email" binding:"required,email"`
	Password   string `json:"password" binding:"required,min=8"`
	RememberMe bool   `json:"remember_me"` // Extends session to 30 days
	DeviceID   string `json:"device_id,omitempty"`
	DeviceName string `json:"device_name,omitempty"`
}

// RegisterRequest represents registration data
type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	FullName string `json:"full_name" binding:"required,min=2"`
	Role     string `json:"role" binding:"required,oneof=admin teacher student staff parent"`
	Phone    string `json:"phone,omitempty"`
}

// AuthResponse represents successful auth response
type AuthResponse struct {
	User         *User  `json:"user"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int    `json:"expires_in"`
	SessionID    string `json:"session_id,omitempty"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token,omitempty"`
	DeviceID     string `json:"device_id,omitempty"`
	DeviceName   string `json:"device_name,omitempty"`
}

type SessionMeta struct {
	DeviceID   string
	DeviceName string
	UserAgent  string
	ClientIP   string
}

type AuthSession struct {
	ID               uuid.UUID  `json:"id" db:"id"`
	UserID           uuid.UUID  `json:"user_id" db:"user_id"`
	SchoolID         *uuid.UUID `json:"school_id,omitempty" db:"school_id"`
	Role             string     `json:"role" db:"role"`
	TokenFamilyID    uuid.UUID  `json:"token_family_id" db:"token_family_id"`
	RefreshTokenHash string     `json:"-" db:"refresh_token_hash"`
	DeviceID         *string    `json:"device_id,omitempty" db:"device_id"`
	DeviceName       *string    `json:"device_name,omitempty" db:"device_name"`
	UserAgent        *string    `json:"user_agent,omitempty" db:"user_agent"`
	ClientIP         *string    `json:"client_ip,omitempty" db:"client_ip"`
	ExpiresAt        time.Time  `json:"expires_at" db:"expires_at"`
	LastSeenAt       time.Time  `json:"last_seen_at" db:"last_seen_at"`
	RevokedAt        *time.Time `json:"revoked_at,omitempty" db:"revoked_at"`
	ReplacedBy       *uuid.UUID `json:"replaced_by_session_id,omitempty" db:"replaced_by_session_id"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at" db:"updated_at"`
}

type PushDeviceToken struct {
	ID         uuid.UUID  `json:"id" db:"id"`
	UserID     uuid.UUID  `json:"user_id" db:"user_id"`
	SchoolID   *uuid.UUID `json:"school_id,omitempty" db:"school_id"`
	Role       string     `json:"role" db:"role"`
	Platform   string     `json:"platform" db:"platform"`
	Token      string     `json:"token" db:"token"`
	DeviceID   *string    `json:"device_id,omitempty" db:"device_id"`
	DeviceName *string    `json:"device_name,omitempty" db:"device_name"`
	AppVersion *string    `json:"app_version,omitempty" db:"app_version"`
	LastSeenAt time.Time  `json:"last_seen_at" db:"last_seen_at"`
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at" db:"updated_at"`
}

type RegisterPushTokenRequest struct {
	Token      string `json:"token" binding:"required"`
	Platform   string `json:"platform" binding:"required,oneof=android ios tv web"`
	DeviceID   string `json:"device_id,omitempty"`
	DeviceName string `json:"device_name,omitempty"`
	AppVersion string `json:"app_version,omitempty"`
}

type DeletePushTokenRequest struct {
	Token    string `json:"token,omitempty"`
	DeviceID string `json:"device_id,omitempty"`
}

type SendTestPushRequest struct {
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
}

// PasswordResetRequest represents password reset request
type PasswordResetRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// UpdateProfileRequest represents profile update
type UpdateProfileRequest struct {
	FullName          *string `json:"full_name,omitempty"`
	Phone             *string `json:"phone,omitempty"`
	ProfilePictureURL *string `json:"profile_picture_url,omitempty"`
}

// ChangePasswordRequest represents password change request
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required,min=8"`
	NewPassword     string `json:"new_password" binding:"required,min=8"`
}

// CreateSuperAdminRequest represents super admin creation request
type CreateSuperAdminRequest struct {
	Email             string  `json:"email" binding:"required,email"`
	Password          string  `json:"password" binding:"required,min=8"`
	FullName          string  `json:"full_name" binding:"required,min=2"`
	Phone             *string `json:"phone,omitempty"`
	ProfilePictureURL *string `json:"profile_picture_url,omitempty"`
}

// SuspendRequest carries the caller's password for verification before suspending/unsuspending
type SuspendRequest struct {
	Password string `json:"password" binding:"required"`
}
