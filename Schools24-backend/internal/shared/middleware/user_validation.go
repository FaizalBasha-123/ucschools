package middleware

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/shared/database"
)

// RequireActiveUser ensures the token maps to a real active account in the database.
// This prevents access with stale or forged tokens for users that no longer exist or are inactive.
func RequireActiveUser(db *database.PostgresDB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		role := GetRole(c)
		if userID == "" || role == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "missing identity in token",
			})
			return
		}

		ctx := c.Request.Context()

		if role == "super_admin" {
			var exists bool
			if err := db.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM public.super_admins WHERE id = $1)", userID).Scan(&exists); err != nil || !exists {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error":   "unauthorized",
					"message": "super admin account not found",
				})
				return
			}
			c.Next()
			return
		}

		var dbRole string
		var isActive bool
		var dbSchoolID string
		tokenSchoolID := GetSchoolID(c)
		if tokenSchoolID == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "school scope missing in token",
			})
			return
		}
		if _, err := uuid.Parse(tokenSchoolID); err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "invalid school scope in token",
			})
			return
		}

		// Validate non-super-admin users against tenant users table.
		tenantSchema := fmt.Sprintf("\"school_%s\"", tokenSchoolID)
		tenantCtx := context.WithValue(ctx, "tenant_schema", tenantSchema)

		err := db.QueryRow(tenantCtx, "SELECT role, is_active, COALESCE(school_id::text, '') FROM users WHERE id = $1", userID).Scan(&dbRole, &isActive, &dbSchoolID)
		if err != nil {
			if err == pgx.ErrNoRows {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error":   "unauthorized",
					"message": "user account not found",
				})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error":   "user_validation_failed",
				"message": "failed to validate user account",
			})
			return
		}

		if !isActive {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "user account is inactive",
			})
			return
		}

		if dbRole != role {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "role mismatch",
			})
			return
		}

		// If the DB school_id is empty (NULL — legacy data created before
		// CreateStudentWithProfile populated the column), the user still
		// belongs to this tenant because they were found in its schema.
		// Back-fill the column so future requests pass the exact-match check.
		if dbSchoolID == "" {
			// Use tenant-aware wrapper so the UPDATE lands in the correct schema (not public)
			_ = db.Exec(tenantCtx,
				"UPDATE users SET school_id = $1, updated_at = NOW() WHERE id = $2 AND school_id IS NULL",
				tokenSchoolID, userID,
			)
			dbSchoolID = tokenSchoolID
		}

		if tokenSchoolID == "" || dbSchoolID != tokenSchoolID {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": "school scope mismatch",
			})
			return
		}

		c.Next()
	}
}
