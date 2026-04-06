package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORSConfig holds CORS configuration
type CORSConfig struct {
	AllowOrigins     []string
	AllowMethods     []string
	AllowHeaders     []string
	ExposeHeaders    []string
	AllowCredentials bool
	MaxAge           int // Preflight cache in seconds
}

// DefaultCORSConfig returns default CORS config
func DefaultCORSConfig() CORSConfig {
	return CORSConfig{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With"},
		ExposeHeaders:    []string{"Content-Length", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           86400, // 24 hours
	}
}

// CORS creates CORS middleware
func CORS(cfg CORSConfig) gin.HandlerFunc {
	allowMethods := strings.Join(cfg.AllowMethods, ", ")
	allowHeaders := strings.Join(cfg.AllowHeaders, ", ")
	exposeHeaders := strings.Join(cfg.ExposeHeaders, ", ")
	hasWildcardOrigin := false
	for _, o := range cfg.AllowOrigins {
		if o == "*" {
			hasWildcardOrigin = true
			break
		}
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Check if origin is allowed
		allowed := false
		for _, o := range cfg.AllowOrigins {
			if o == "*" || o == origin {
				allowed = true
				break
			}
		}

		if allowed && origin != "" {
			if hasWildcardOrigin && !cfg.AllowCredentials {
				c.Header("Access-Control-Allow-Origin", "*")
			} else {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
			}

			c.Header("Access-Control-Allow-Methods", allowMethods)
			c.Header("Access-Control-Allow-Headers", allowHeaders)
			c.Header("Access-Control-Expose-Headers", exposeHeaders)

			if cfg.AllowCredentials {
				c.Header("Access-Control-Allow-Credentials", "true")
			}

			// Handle preflight requests
			if c.Request.Method == http.MethodOptions {
				c.AbortWithStatus(http.StatusNoContent)
				return
			}
		}

		c.Next()
	}
}

// CORSFromEnv creates CORS middleware from environment string
// Format: "http://localhost:3000,http://localhost:5173"
func CORSFromEnv(originsEnv, methodsEnv, headersEnv string) gin.HandlerFunc {
	cfg := DefaultCORSConfig()

	if originsEnv != "" {
		cfg.AllowOrigins = strings.Split(originsEnv, ",")
		for i := range cfg.AllowOrigins {
			cfg.AllowOrigins[i] = strings.TrimSpace(cfg.AllowOrigins[i])
		}
		hasWildcard := false
		for _, origin := range cfg.AllowOrigins {
			if origin == "*" {
				hasWildcard = true
				break
			}
		}
		cfg.AllowCredentials = !hasWildcard
	}

	if methodsEnv != "" {
		cfg.AllowMethods = strings.Split(methodsEnv, ",")
		for i := range cfg.AllowMethods {
			cfg.AllowMethods[i] = strings.TrimSpace(cfg.AllowMethods[i])
		}
	}

	if headersEnv != "" {
		cfg.AllowHeaders = strings.Split(headersEnv, ",")
		for i := range cfg.AllowHeaders {
			cfg.AllowHeaders[i] = strings.TrimSpace(cfg.AllowHeaders[i])
		}
	}

	return CORS(cfg)
}
