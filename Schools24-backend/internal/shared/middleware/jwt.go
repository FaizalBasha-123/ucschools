package middleware

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JWTConfig holds JWT middleware configuration
type JWTConfig struct {
	Secret           string
	TokenLookup      string // comma-separated: "header:Authorization,cookie:School24_api_token,query:token"
	TokenHeadName    string // "Bearer"
	SkipPaths        []string
	SessionValidator func(ctx context.Context, claims *Claims) error
}

// DefaultJWTConfig returns default JWT config
func DefaultJWTConfig(secret string) JWTConfig {
	return JWTConfig{
		Secret:        secret,
		TokenLookup:   "header:Authorization,cookie:School24_api_token,cookie:School24_token,query:token",
		TokenHeadName: "Bearer",
		SkipPaths:     []string{"/health", "/ready", "/api/v1/auth/login", "/api/v1/auth/register"},
	}
}

// Claims represents JWT claims
type Claims struct {
	UserID    string   `json:"user_id"`
	Email     string   `json:"email"`
	Role      string   `json:"role"`
	SchoolID  string   `json:"school_id"`
	Roles     []string `json:"roles"`
	SessionID string   `json:"session_id,omitempty"`
	WSScope   string   `json:"ws_scope,omitempty"`
	ClassID   string   `json:"class_id,omitempty"`
	jwt.RegisteredClaims
}

// JWTAuth creates a JWT authentication middleware
func JWTAuth(cfg JWTConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check if path should be skipped
		path := c.Request.URL.Path
		for _, skipPath := range cfg.SkipPaths {
			if strings.HasPrefix(path, skipPath) {
				c.Next()
				return
			}
		}

		// Extract token
		token, err := extractToken(c, cfg)
		if err != nil {
			log.Printf("[auth][jwt] unauthorized path=%s method=%s host=%s ip=%s reason=%v", c.Request.URL.Path, c.Request.Method, c.Request.Host, c.ClientIP(), err)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": err.Error(),
			})
			return
		}

		// Parse and validate token
		claims, err := parseToken(token, cfg.Secret)
		if err != nil {
			log.Printf("[auth][jwt] invalid_token path=%s method=%s host=%s ip=%s reason=%v", c.Request.URL.Path, c.Request.Method, c.Request.Host, c.ClientIP(), err)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_token",
				"message": err.Error(),
			})
			return
		}

		if cfg.SessionValidator != nil {
			if err := cfg.SessionValidator(c.Request.Context(), claims); err != nil {
				log.Printf("[auth][jwt] invalid_session path=%s method=%s host=%s ip=%s user_id=%s role=%s session_id=%s reason=%v", c.Request.URL.Path, c.Request.Method, c.Request.Host, c.ClientIP(), claims.UserID, claims.Role, claims.SessionID, err)
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error":   "invalid_session",
					"message": err.Error(),
				})
				return
			}
		}

		// Set claims in context for Gin handlers
		c.Set("user_id", claims.UserID)
		c.Set("email", claims.Email)
		c.Set("role", claims.Role)
		c.Set("school_id", claims.SchoolID)
		c.Set("roles", claims.Roles)
		c.Set("claims", claims)
		c.Set("session_id", claims.SessionID)

		// Also inject into standard context for services
		reqCtx := c.Request.Context()
		reqCtx = context.WithValue(reqCtx, "user_id", claims.UserID)
		reqCtx = context.WithValue(reqCtx, "email", claims.Email)
		reqCtx = context.WithValue(reqCtx, "role", claims.Role)
		reqCtx = context.WithValue(reqCtx, "school_id", claims.SchoolID)
		reqCtx = context.WithValue(reqCtx, "roles", claims.Roles)
		reqCtx = context.WithValue(reqCtx, "session_id", claims.SessionID)
		c.Request = c.Request.WithContext(reqCtx)

		c.Next()
	}
}

// extractToken extracts JWT from request
func extractToken(c *gin.Context, cfg JWTConfig) (string, error) {
	lookups := strings.Split(cfg.TokenLookup, ",")
	for _, lookup := range lookups {
		parts := strings.Split(strings.TrimSpace(lookup), ":")
		if len(parts) != 2 {
			return "", errors.New("invalid token lookup config")
		}

		switch parts[0] {
		case "header":
			auth := c.GetHeader(parts[1])
			if auth == "" {
				continue
			}

			if cfg.TokenHeadName != "" {
				prefix := cfg.TokenHeadName + " "
				if !strings.HasPrefix(auth, prefix) {
					continue
				}
				return strings.TrimPrefix(auth, prefix), nil
			}
			return auth, nil

		case "query":
			token := c.Query(parts[1])
			if token == "" {
				continue
			}
			return token, nil

		case "cookie":
			token, err := c.Cookie(parts[1])
			if err != nil || strings.TrimSpace(token) == "" {
				continue
			}
			return token, nil

		default:
			return "", errors.New("unsupported token lookup method")
		}
	}

	return "", errors.New("missing authentication token")
}

// parseToken parses and validates JWT token
func parseToken(tokenString, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}

	return claims, nil
}

// ValidateToken parses and validates a raw JWT string, returning the claims.
//
// This is exported for use by WebSocket and SSE handlers that are registered
// outside the JWTAuth middleware group and must validate the token themselves
// (e.g. transport driver WebSocket, chat WebSocket).
func ValidateToken(tokenString, secret string) (*Claims, error) {
	return parseToken(tokenString, secret)
}

// GenerateToken generates a new JWT token (utility for auth module)
func GenerateToken(secret string, claims Claims, expiry time.Duration) (string, error) {
	claims.RegisteredClaims = jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		NotBefore: jwt.NewNumericDate(time.Now()),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GetUserID extracts user ID from Gin context
func GetUserID(c *gin.Context) string {
	if id, exists := c.Get("user_id"); exists {
		return id.(string)
	}
	return ""
}

// GetSchoolID extracts school ID from Gin context
func GetSchoolID(c *gin.Context) string {
	if id, exists := c.Get("school_id"); exists {
		return id.(string)
	}
	return ""
}

// GetRole extracts role from Gin context
func GetRole(c *gin.Context) string {
	if role, exists := c.Get("role"); exists {
		return role.(string)
	}
	return ""
}

func GetSessionID(c *gin.Context) string {
	if id, exists := c.Get("session_id"); exists {
		return id.(string)
	}
	return ""
}

// RequireRole creates middleware that requires specific roles
func RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userRole := GetRole(c)
		for _, role := range roles {
			if userRole == role {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error":   "forbidden",
			"message": "Insufficient permissions",
		})
	}
}
