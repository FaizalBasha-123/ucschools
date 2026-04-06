package middleware

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// RequestIDKey is the context key for request IDs
type RequestIDKey struct{}

// RequestIDMiddleware adds unique request IDs to all requests for tracing
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if request already has an ID (from client)
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			// Generate new request ID
			requestID = uuid.New().String()
		}

		// Add to context
		ctx := context.WithValue(r.Context(), RequestIDKey{}, requestID)

		// Add to response header
		w.Header().Set("X-Request-ID", requestID)

		// Log request start
		log.Printf("[%s] %s %s", requestID, r.Method, r.URL.Path)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RecoveryMiddleware prevents panics from crashing the server
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				requestID := GetRequestID(r.Context())
				log.Printf("[%s] PANIC: %v", requestID, err)

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)

				// Write generic error response without stack trace
				w.Write([]byte(`{"code":"internal_server_error","message":"Internal server error","request_id":"` + requestID + `"}`))
			}
		}()

		next.ServeHTTP(w, r)
	})
}

// TimingMiddleware tracks request duration
type TimingResponseWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (w *TimingResponseWriter) WriteHeader(statusCode int) {
	if !w.written {
		w.statusCode = statusCode
		w.written = true
		w.ResponseWriter.WriteHeader(statusCode)
	}
}

func (w *TimingResponseWriter) Write(b []byte) (int, error) {
	if !w.written {
		w.statusCode = http.StatusOK
		w.written = true
	}
	return w.ResponseWriter.Write(b)
}

func TimingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := GetRequestID(r.Context())

		tw := &TimingResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(tw, r)

		duration := time.Since(start)
		log.Printf("[%s] %s %s - %d %s", requestID, r.Method, r.URL.Path, tw.statusCode, duration)
	})
}

// GetRequestID retrieves the request ID from context
func GetRequestID(ctx context.Context) string {
	requestID, ok := ctx.Value(RequestIDKey{}).(string)
	if !ok {
		return "unknown"
	}
	return requestID
}
