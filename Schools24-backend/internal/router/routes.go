// DEPRECATED: This file is NOT used. All actual route registration has been moved to cmd/server/main.go.
// This file contains placeholder handlers that return "not yet implemented" and should be deleted
// once confirmed that no other code depends on it. See main.go for the real route definitions.
package router

import (
	"net/http"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/shared/cache"
	"github.com/schools24/backend/internal/shared/middleware"
)

// Dependencies holds shared dependencies for all modules
type Dependencies struct {
	Config *config.Config
	Cache  *cache.Cache
	// Database connections will be added here
	// Supabase *database.SupabaseClient
}

// RegisterRoutes registers all module routes
func RegisterRoutes(r *gin.Engine, deps *Dependencies) {
	// Health Check (public)
	r.GET("/health", func(c *gin.Context) {
		stats := deps.Cache.Stats()
		c.JSON(http.StatusOK, gin.H{
			"status":      "healthy",
			"service":     "schools24-backend",
			"version":     "1.0.0",
			"time":        time.Now().Unix(),
			"cache_hits":  stats.Hits,
			"cache_miss":  stats.Misses,
			"cache_items": deps.Cache.Len(),
			"goroutines":  runtime.NumGoroutine(),
		})
	})

	// Readiness Check (for container orchestration)
	r.GET("/ready", func(c *gin.Context) {
		// TODO: Check database connections
		c.JSON(http.StatusOK, gin.H{"ready": true})
	})

	// Public routes (no auth required)
	public := r.Group("/api/v1")
	{
		// Auth routes (public)
		auth := public.Group("/auth")
		{
			auth.POST("/login", placeholderHandler("auth.login"))
			auth.POST("/register", placeholderHandler("auth.register"))
			auth.POST("/forgot-password", placeholderHandler("auth.forgot_password"))
		}
	}

	// Protected routes (auth required)
	protected := r.Group("/api/v1")
	protected.Use(middleware.JWTAuth(middleware.DefaultJWTConfig(deps.Config.JWT.Secret)))
	{
		// Auth protected routes
		auth := protected.Group("/auth")
		{
			auth.POST("/logout", placeholderHandler("auth.logout"))
			auth.POST("/refresh", placeholderHandler("auth.refresh"))
			auth.GET("/me", placeholderHandler("auth.me"))
		}

		// Academic Module Routes
		academic := protected.Group("/academic")
		{
			academic.GET("/quizzes", placeholderHandler("academic.quizzes.list"))
			academic.POST("/quizzes", placeholderHandler("academic.quizzes.create"))
			academic.GET("/quizzes/:id", placeholderHandler("academic.quizzes.get"))
			academic.GET("/homework", placeholderHandler("academic.homework.list"))
			academic.POST("/homework", placeholderHandler("academic.homework.create"))
			academic.GET("/grades/:studentId", placeholderHandler("academic.grades.get"))
		}

		// Finance Module Routes
		finance := protected.Group("/finance")
		{
			finance.GET("/fees/:studentId", placeholderHandler("finance.fees.get"))
			finance.POST("/payments", placeholderHandler("finance.payments.create"))
			finance.GET("/payments/:id", placeholderHandler("finance.payments.get"))
		}

		// Notification Module Routes
		notification := protected.Group("/notifications")
		{
			notification.POST("/email", placeholderHandler("notification.email"))
			notification.POST("/sms", placeholderHandler("notification.sms"))
			notification.POST("/push", placeholderHandler("notification.push"))
		}

		// Operations Module Routes
		operations := protected.Group("/operations")
		{
			operations.GET("/bus-routes", placeholderHandler("operations.busroutes.list"))
			operations.GET("/inventory", placeholderHandler("operations.inventory.list"))
		}

		// Cache Test (for verification)
		protected.GET("/cache-test", func(c *gin.Context) {
			key := "test:backend:key"
			data := map[string]string{
				"message":   "Hello from Schools24 Backend!",
				"cached_at": time.Now().Format(time.RFC3339),
			}

			if err := deps.Cache.CompressAndStore(c.Request.Context(), key, data, 10*time.Minute); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Cache write failed"})
				return
			}

			var result map[string]string
			if err := deps.Cache.FetchAndDecompress(c.Request.Context(), key, &result); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Cache read failed"})
				return
			}

			stats := deps.Cache.Stats()
			c.JSON(http.StatusOK, gin.H{
				"original": data,
				"cached":   result,
				"source":   "in-memory-snappy-compressed",
				"stats": gin.H{
					"hits":   stats.Hits,
					"misses": stats.Misses,
					"items":  deps.Cache.Len(),
				},
			})
		})
	}
}

// placeholderHandler returns a placeholder response for unimplemented endpoints
func placeholderHandler(endpoint string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"endpoint": endpoint,
			"status":   "placeholder",
			"message":  "Endpoint not yet implemented",
		})
	}
}
