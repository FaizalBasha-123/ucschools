package response

import (
	"errors"
	"time"
)

// ErrorCode defines semantic error types for client-side handling
type ErrorCode string

const (
	// Client Errors (4xx)
	ErrBadRequest         ErrorCode = "bad_request"
	ErrUnauthorized       ErrorCode = "unauthorized"
	ErrForbidden          ErrorCode = "forbidden"
	ErrNotFound           ErrorCode = "not_found"
	ErrConflict           ErrorCode = "conflict"
	ErrValidationFailed   ErrorCode = "validation_failed"
	ErrResourceExists     ErrorCode = "resource_exists"
	ErrInvalidCredentials ErrorCode = "invalid_credentials"
	ErrTokenExpired       ErrorCode = "token_expired"
	ErrPermissionDenied   ErrorCode = "permission_denied"
	ErrQuotaExceeded      ErrorCode = "quota_exceeded"

	// Server Errors (5xx)
	ErrInternalServer     ErrorCode = "internal_server_error"
	ErrServiceUnavailable ErrorCode = "service_unavailable"
	ErrDatabaseError      ErrorCode = "database_error"

	// Semantic Codes (App-level)
	ErrSchoolNotFound     ErrorCode = "school_not_found"
	ErrUserNotFound       ErrorCode = "user_not_found"
	ErrClassNotFound      ErrorCode = "class_not_found"
	ErrSubjectNotFound    ErrorCode = "subject_not_found"
	ErrDuplicateEmail     ErrorCode = "duplicate_email"
	ErrInvalidEmail       ErrorCode = "invalid_email"
	ErrWeakPassword       ErrorCode = "weak_password"
	ErrForeignKeyConflict ErrorCode = "foreign_key_conflict"
)

// FieldError describes a single field validation error
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

// ErrorResponse is the standardized error response format
// Used consistently across all API endpoints
type ErrorResponse struct {
	Code       ErrorCode    `json:"code"`
	Message    string       `json:"message"`
	StatusCode int          `json:"status_code"`
	RequestID  string       `json:"request_id,omitempty"`
	Timestamp  time.Time    `json:"timestamp"`
	Errors     []FieldError `json:"errors,omitempty"`
	Details    interface{}  `json:"details,omitempty"`
	Path       string       `json:"path,omitempty"`
}

// SuccessResponse is the standardized success response format
type SuccessResponse struct {
	Data       interface{} `json:"data,omitempty"`
	Message    string      `json:"message,omitempty"`
	StatusCode int         `json:"status_code"`
	RequestID  string      `json:"request_id,omitempty"`
	Timestamp  time.Time   `json:"timestamp"`
}

// PaginatedResponse wraps paginated data
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int64       `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int64       `json:"total_pages"`
	HasMore    bool        `json:"has_more"`
	RequestID  string      `json:"request_id,omitempty"`
	Timestamp  time.Time   `json:"timestamp"`
}

// AppError wraps semantic application errors with context
type AppError struct {
	Code       ErrorCode
	Message    string
	StatusCode int
	Errors     []FieldError
	Details    interface{}
	Cause      error
}

// Error implements the error interface
func (e *AppError) Error() string {
	return e.Message
}

// Unwrap returns the underlying cause
func (e *AppError) Unwrap() error {
	return e.Cause
}

// Is checks if target error matches
func (e *AppError) Is(target error) bool {
	var appErr *AppError
	return errors.As(target, &appErr) && appErr.Code == e.Code
}

// NewAppError creates a new application error
func NewAppError(code ErrorCode, message string, statusCode int) *AppError {
	return &AppError{
		Code:       code,
		Message:    message,
		StatusCode: statusCode,
	}
}

// WithDetails adds detailed error information
func (e *AppError) WithDetails(details interface{}) *AppError {
	e.Details = details
	return e
}

// WithFields adds field validation errors
func (e *AppError) WithFields(fields []FieldError) *AppError {
	e.Errors = fields
	return e
}

// WithCause wraps the underlying error
func (e *AppError) WithCause(cause error) *AppError {
	e.Cause = cause
	return e
}

// Helper constructors for common errors

func BadRequest(message string) *AppError {
	return NewAppError(ErrBadRequest, message, 400)
}

func Unauthorized(message string) *AppError {
	return NewAppError(ErrUnauthorized, message, 401)
}

func Forbidden(message string) *AppError {
	return NewAppError(ErrForbidden, message, 403)
}

func NotFound(resource string) *AppError {
	return NewAppError(ErrNotFound, "Resource not found: "+resource, 404)
}

func Conflict(message string) *AppError {
	return NewAppError(ErrConflict, message, 409)
}

func ValidationFailed(message string, fields []FieldError) *AppError {
	return NewAppError(ErrValidationFailed, message, 422).WithFields(fields)
}

func InternalError(message string) *AppError {
	return NewAppError(ErrInternalServer, message, 500)
}

func DuplicateEmail() *AppError {
	return NewAppError(ErrDuplicateEmail, "Email already exists", 409)
}

func InvalidEmail() *AppError {
	return NewAppError(ErrInvalidEmail, "Invalid email format", 422).
		WithFields([]FieldError{{Field: "email", Message: "must be a valid email"}})
}

func SchoolNotFound() *AppError {
	return NewAppError(ErrSchoolNotFound, "School not found", 404)
}
