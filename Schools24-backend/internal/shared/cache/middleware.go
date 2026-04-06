package cache

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// CacheMiddlewareConfig configures the response-caching middleware.
type CacheMiddlewareConfig struct {
	// DefaultTTL is the fallback TTL for routes not in TTLRules.
	DefaultTTL time.Duration
	// TTLRules maps route substrings to TTL durations.
	// The first matching rule wins (checked in order).
	TTLRules []TTLRule
	// SkipPaths are path prefixes that should never be cached.
	SkipPaths []string
}

// TTLRule maps a URL pattern to a cache TTL.
type TTLRule struct {
	Contains string        // substring match against the request path
	TTL      time.Duration // cache duration for matching requests
}

// DefaultCacheMiddlewareConfig returns a production-ready config with intelligent TTL tiers.
// These TTLs balance freshness vs Neon DB load reduction.
func DefaultCacheMiddlewareConfig() CacheMiddlewareConfig {
	return CacheMiddlewareConfig{
		DefaultTTL: 15 * time.Second,
		TTLRules: []TTLRule{
			// Dashboards: aggregated stats, tolerate 60s staleness
			{Contains: "/dashboard", TTL: 60 * time.Second},
			// Timetables & config: rarely change, safe to cache longer
			{Contains: "/timetable", TTL: 5 * time.Minute},
			{Contains: "/fee-structures", TTL: 5 * time.Minute},
			{Contains: "/class-subjects", TTL: 5 * time.Minute},
			{Contains: "/inventory", TTL: 2 * time.Minute},
			// Lists: change on CRUD — moderate TTL, invalidated on writes
			{Contains: "/students-list", TTL: 30 * time.Second},
			{Contains: "/teachers", TTL: 30 * time.Second},
			{Contains: "/staff", TTL: 30 * time.Second},
			{Contains: "/users", TTL: 30 * time.Second},
			{Contains: "/schools", TTL: 30 * time.Second},
			// Events, attendance
			{Contains: "/events", TTL: 2 * time.Minute},
			{Contains: "/attendance", TTL: 30 * time.Second},
			// Grades and assessments
			{Contains: "/grades", TTL: 60 * time.Second},
			{Contains: "/assessments", TTL: 2 * time.Minute},
			// Chat, auth: never cache
		},
		SkipPaths: []string{
			"/auth/",
			"/chat/",
			"/super-admin/schools", // mutations happen here; caching is complex with create/delete
		},
	}
}

// ResponseCacheMiddleware returns a Gin middleware that:
//  1. Caches GET response bodies in Valkey/Redis with per-route TTLs
//  2. Auto-invalidates cache on write operations (POST/PUT/PATCH/DELETE)
//  3. Uses school_id + role + full URL as cache key for tenant isolation
//
// This is the main performance lever for reducing Neon DB load.
func ResponseCacheMiddleware(c *Cache, cfg CacheMiddlewareConfig) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		// Skip if cache is disabled (noop mode)
		if !c.IsEnabled() {
			ctx.Next()
			return
		}

		path := ctx.Request.URL.Path

		// Skip specific paths
		for _, skip := range cfg.SkipPaths {
			if strings.Contains(path, skip) {
				ctx.Next()
				return
			}
		}

		// --- Write operations: invalidate, then proceed ---
		if ctx.Request.Method != http.MethodGet {
			ctx.Next()

			// After successful write, invalidate related GET caches
			if ctx.Writer.Status() >= 200 && ctx.Writer.Status() < 300 {
				go invalidateRelatedCache(c, ctx, path)
			}
			return
		}

		// --- GET: try cache first ---
		cacheKey := buildCacheKey(ctx)

		// Check cache
		var cachedBody string
		var cachedContentType string

		// We store body and content-type together as "contentType\n\nbody"
		raw, err := c.Get(ctx.Request.Context(), cacheKey)
		if err == nil && raw != "" {
			parts := strings.SplitN(raw, "\n\n", 2)
			if len(parts) == 2 {
				cachedContentType = parts[0]
				cachedBody = parts[1]
			}
		}

		if cachedBody != "" {
			// Cache HIT — serve directly without touching DB
			ctx.Header("X-Cache", "HIT")
			ctx.Data(http.StatusOK, cachedContentType, []byte(cachedBody))
			ctx.Abort()
			return
		}

		// Cache MISS — execute handler and capture response
		ctx.Header("X-Cache", "MISS")

		// Capture the response body
		w := &responseCapture{
			ResponseWriter: ctx.Writer,
			body:           &bytes.Buffer{},
		}
		ctx.Writer = w

		ctx.Next()

		// Only cache successful JSON responses
		if ctx.Writer.Status() == http.StatusOK && w.body.Len() > 0 {
			ttl := resolveTTL(path, cfg)
			contentType := w.Header().Get("Content-Type")
			if contentType == "" {
				contentType = "application/json; charset=utf-8"
			}

			// Store as "contentType\n\nbody"
			payload := contentType + "\n\n" + w.body.String()

			// Fire-and-forget: don't block the response for cache write
			go func() {
				writeCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				if err := c.Set(writeCtx, cacheKey, payload, ttl); err != nil {
					if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
						return
					}
					log.Printf("WARN: cache write failed for %s: %v", cacheKey, err)
				}
			}()
		}
	}
}

// buildCacheKey creates a unique, tenant-isolated cache key.
// Format: cache:{school_id}:{role}:{path_hash}
// The hash includes full path + query string for pagination/filter uniqueness.
func buildCacheKey(c *gin.Context) string {
	schoolID, _ := c.Get("school_id")
	role, _ := c.Get("role")

	sid := fmt.Sprintf("%v", schoolID)
	r := fmt.Sprintf("%v", role)

	// Hash the full URL (path + query) to keep keys short but unique
	fullURL := c.Request.URL.RequestURI()
	h := sha256.Sum256([]byte(fullURL))
	urlHash := fmt.Sprintf("%x", h[:8]) // 16-char hex

	return fmt.Sprintf("cache:%s:%s:%s", sid, r, urlHash)
}

// resolveTTL finds the appropriate TTL for a given path.
func resolveTTL(path string, cfg CacheMiddlewareConfig) time.Duration {
	for _, rule := range cfg.TTLRules {
		if strings.Contains(path, rule.Contains) {
			return rule.TTL
		}
	}
	return cfg.DefaultTTL
}

// invalidateRelatedCache deletes cache entries related to a write path.
// Strategy: extract the resource name from the path and delete all cache entries
// for that school + resource combination.
func invalidateRelatedCache(c *Cache, ctx *gin.Context, writePath string) {
	schoolID, _ := ctx.Get("school_id")
	sid := fmt.Sprintf("%v", schoolID)

	// Extract resource segment from path (e.g., /api/v1/admin/students → students)
	segments := strings.Split(strings.Trim(writePath, "/"), "/")
	if len(segments) < 3 {
		return
	}

	// Invalidate all roles for this school — a write by admin affects student/teacher views too
	prefix := fmt.Sprintf("cache:%s:", sid)
	deleteCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.DeleteByPrefix(deleteCtx, prefix); err != nil {
		errText := strings.ToLower(err.Error())
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || strings.Contains(errText, "context canceled") || strings.Contains(errText, "context deadline exceeded") {
			return
		}
		log.Printf("WARN: cache invalidation failed for %s: %v", prefix, err)
	}
}

// responseCapture wraps gin.ResponseWriter to capture the response body.
type responseCapture struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w *responseCapture) Write(b []byte) (int, error) {
	w.body.Write(b) // capture
	return w.ResponseWriter.Write(b)
}

func (w *responseCapture) WriteString(s string) (int, error) {
	w.body.WriteString(s)
	return io.WriteString(w.ResponseWriter, s)
}
