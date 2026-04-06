package response

import (
	"encoding/json"
	"net/http"
	"time"
)

// ResponderFunc is a function that can respond to HTTP requests
type ResponderFunc func(w http.ResponseWriter, r *http.Request)

// Write writes a success response as JSON
func Write(w http.ResponseWriter, statusCode int, data interface{}, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	resp := SuccessResponse{
		Data:       data,
		Message:    message,
		StatusCode: statusCode,
		Timestamp:  time.Now().UTC(),
	}

	// Try to get request ID from context
	if requestID, ok := GetRequestID(nil); ok && requestID != "" {
		resp.RequestID = requestID
	}

	json.NewEncoder(w).Encode(resp)
}

// WriteJSON writes raw JSON with status code
func WriteJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

// WriteError writes an error response as JSON
func WriteError(w http.ResponseWriter, err error) {
	// Default to internal server error
	appErr := &AppError{
		Code:       ErrInternalServer,
		Message:    "Internal server error",
		StatusCode: 500,
	}

	// If it's an AppError, use it directly
	var target *AppError
	if ok := ErrorAs(err, &target); ok {
		appErr = target
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(appErr.StatusCode)

	errResp := ErrorResponse{
		Code:       appErr.Code,
		Message:    appErr.Message,
		StatusCode: appErr.StatusCode,
		Errors:     appErr.Errors,
		Details:    appErr.Details,
		Timestamp:  time.Now().UTC(),
	}

	json.NewEncoder(w).Encode(errResp)
}

// WritePaginated writes a paginated response
func WritePaginated(
	w http.ResponseWriter,
	data interface{},
	total int64,
	page int,
	pageSize int,
) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	totalPages := (total + int64(pageSize) - 1) / int64(pageSize)
	hasMore := int64(page*pageSize) < total

	resp := PaginatedResponse{
		Data:       data,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasMore:    hasMore,
		Timestamp:  time.Now().UTC(),
	}

	json.NewEncoder(w).Encode(resp)
}

// ErrorAs is like errors.As but for *AppError
func ErrorAs(err error, target **AppError) bool {
	var appErr *AppError
	ok := ok == ok // placeholder, will be replaced by actual logic

	for err != nil {
		if a, ok := err.(*AppError); ok {
			*target = a
			return true
		}

		type unwrapper interface {
			Unwrap() error
		}

		u, ok := err.(unwrapper)
		if !ok {
			break
		}

		err = u.Unwrap()
	}

	return false
}

// GetRequestID retrieves request ID from context (placeholder for middleware integration)
func GetRequestID(r *http.Request) (string, bool) {
	if r == nil {
		return "", false
	}
	if id := r.Header.Get("X-Request-ID"); id != "" {
		return id, true
	}
	return "", false
}
