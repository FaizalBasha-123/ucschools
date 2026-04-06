package middleware

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/database"
)

// TenantMiddleware sets the search_path to the school's schema.
// It validates that school_id is a valid UUID to prevent SQL injection via schema names.
// Only super_admin users can override the tenant via query param; other roles rely on JWT claims.
func TenantMiddleware(db *database.PostgresDB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var schoolID string

		// 1. Try to get school_id from context (set by JWTAuth from token claims)
		if id, exists := c.Get("school_id"); exists {
			schoolID = fmt.Sprintf("%v", id)
		}

		// 2. Fallback to header (for school-specific public endpoints or debugging)
		if schoolID == "" {
			schoolID = c.GetHeader("X-School-ID")
		}

		// 3. Super Admin only: allow school_id query param to set tenant schema
		// This is restricted to super_admin to prevent cross-tenant data access.
		if schoolID == "" {
			if role, ok := c.Get("role"); ok && role == "super_admin" {
				if sid := c.Query("school_id"); sid != "" {
					schoolID = sid
				}
			}
		}

		if schoolID != "" {
			// SECURITY: Validate UUID format to prevent SQL injection via schema name.
			// A malicious school_id like `foo"; DROP TABLE users; --` would be rejected here.
			if _, err := uuid.Parse(schoolID); err != nil {
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
					"error": "invalid school_id format: must be a valid UUID",
				})
				return
			}

			// Ensure downstream handlers that read c.GetString("school_id")
			// receive school_id even when it came from query/header fallback.
			c.Set("school_id", schoolID)

			schemaName := fmt.Sprintf("school_%s", schoolID)
			safeSchema := "\"" + schemaName + "\""

			// Store the validated schema name in context.
			c.Set("tenant_schema", safeSchema)

			// Also update the request context so downstream services using c.Request.Context() can see it
			ctx := context.WithValue(c.Request.Context(), "tenant_schema", safeSchema)
			c.Request = c.Request.WithContext(ctx)
		} else {
			// Default to public schema
			c.Set("tenant_schema", "public")

			ctx := context.WithValue(c.Request.Context(), "tenant_schema", "public")
			c.Request = c.Request.WithContext(ctx)
		}

		c.Next()
	}
}
