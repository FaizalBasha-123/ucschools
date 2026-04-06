package middleware

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	CSRFCookieName = "School24_csrf"
	CSRFHeaderName = "X-CSRF-Token"
)

type CSRFConfig struct {
	AllowedOrigins []string
}

func GenerateCSRFToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func CSRFProtect(cfg CSRFConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := ValidateCSRFFromRequest(c, cfg); err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "invalid_csrf_request",
				"message": err.Error(),
			})
			return
		}
		c.Next()
	}
}

func ValidateCSRFFromRequest(c *gin.Context, cfg CSRFConfig) error {
	if isSafeMethod(c.Request.Method) {
		return nil
	}

	if strings.TrimSpace(c.GetHeader("Authorization")) != "" {
		return nil
	}

	sessionCookie, err := c.Cookie("School24_api_token")
	if err != nil || strings.TrimSpace(sessionCookie) == "" {
		return nil
	}

	allowed := normalizeOrigins(cfg.AllowedOrigins)
	if err := validateOriginHeaders(c, allowed); err != nil {
		return err
	}

	cookieToken, err := c.Cookie(CSRFCookieName)
	if err != nil || strings.TrimSpace(cookieToken) == "" {
		return errors.New("missing CSRF session token")
	}

	headerToken := strings.TrimSpace(c.GetHeader(CSRFHeaderName))
	if headerToken == "" || headerToken != cookieToken {
		return errors.New("invalid CSRF token")
	}

	return nil
}

func isSafeMethod(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return true
	default:
		return false
	}
}

func normalizeOrigins(origins []string) []string {
	out := make([]string, 0, len(origins))
	seen := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		trimmed := strings.TrimSpace(origin)
		if trimmed == "" {
			continue
		}
		parsed, err := url.Parse(trimmed)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			continue
		}
		key := parsed.Scheme + "://" + parsed.Host
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func validateOriginHeaders(c *gin.Context, allowedOrigins []string) error {
	origin := strings.TrimSpace(c.GetHeader("Origin"))
	if origin != "" {
		if isAllowedOrigin(origin, allowedOrigins) {
			return nil
		}
		return errors.New("request origin not allowed")
	}

	referer := strings.TrimSpace(c.GetHeader("Referer"))
	if referer != "" {
		parsed, err := url.Parse(referer)
		if err == nil && parsed.Scheme != "" && parsed.Host != "" {
			if isAllowedOrigin(parsed.Scheme+"://"+parsed.Host, allowedOrigins) {
				return nil
			}
		}
		return errors.New("request referer not allowed")
	}

	return nil
}

func isAllowedOrigin(origin string, allowedOrigins []string) bool {
	normalized := strings.TrimSpace(origin)
	for _, allowed := range allowedOrigins {
		if normalized == allowed {
			return true
		}
	}
	return false
}
