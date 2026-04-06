package interop

import "fmt"

// InteropError is a structured error with a machine-readable code.
type InteropError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func (e *InteropError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// Error codes for interop API governance.
const (
	ErrCodeDisabled          = "INTEROP_DISABLED"
	ErrCodeInvalidSystem     = "INVALID_SYSTEM"
	ErrCodeInvalidOperation  = "INVALID_OPERATION"
	ErrCodeValidationFailed  = "VALIDATION_FAILED"
	ErrCodeJobNotFound       = "JOB_NOT_FOUND"
	ErrCodeIdempotencyHit    = "IDEMPOTENCY_HIT"
	ErrCodeInvalidScope      = "INVALID_SCOPE"
	ErrCodeInternalError     = "INTERNAL_ERROR"
)

// NewInteropError creates a structured error for API responses.
func NewInteropError(code, message string, details any) *InteropError {
	return &InteropError{
		Code:    code,
		Message: message,
		Details: details,
	}
}

// ErrorResponse creates a gin.H-compatible error response body.
func ErrorResponse(code, message string, details any) map[string]any {
	resp := map[string]any{
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	}
	if details != nil {
		resp["error"].(map[string]any)["details"] = details
	}
	return resp
}
