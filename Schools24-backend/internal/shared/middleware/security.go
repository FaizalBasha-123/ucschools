package middleware

import (
	"github.com/gin-gonic/gin"
)

// SecurityHeaders adds standard security headers to response
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Protect against XSS
		c.Header("X-XSS-Protection", "1; mode=block")

		// Prevent clickjacking
		c.Header("X-Frame-Options", "DENY")

		// Prevent MIME type sniffing
		c.Header("X-Content-Type-Options", "nosniff")

		// HSTS (Strict Transport Security) - 1 year
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

		// Referrer Policy
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")

		// Content Security Policy (API-safe strict baseline)
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'; frame-ancestors 'none';")

		// Permissions Policy
		c.Header("Permissions-Policy", "geolocation=(self), microphone=(), camera=()")

		c.Next()
	}
}
