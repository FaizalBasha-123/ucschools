package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	maxLoginAttempts = 10
	lockoutDuration  = 15 * time.Minute
)

type attemptRecord struct {
	count    int
	lockedAt time.Time
	lastSeen time.Time
}

// LoginGuard tracks per-IP login failures and enforces temporary lockouts.
type LoginGuard struct {
	mu      sync.Mutex
	records map[string]*attemptRecord
}

var defaultLoginGuard = &LoginGuard{
	records: make(map[string]*attemptRecord),
}

// GetLoginGuard returns the singleton guard instance.
func GetLoginGuard() *LoginGuard {
	return defaultLoginGuard
}

// IsLocked returns (true, remainingLockout) if the IP is currently locked out.
func (g *LoginGuard) IsLocked(ip string) (bool, time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()

	rec, ok := g.records[ip]
	if !ok || rec.count < maxLoginAttempts {
		return false, 0
	}

	elapsed := time.Since(rec.lockedAt)
	if elapsed < lockoutDuration {
		return true, lockoutDuration - elapsed
	}

	// Lockout expired — reset the record
	delete(g.records, ip)
	return false, 0
}

// RecordFailure increments the failure count for an IP.
func (g *LoginGuard) RecordFailure(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	rec, ok := g.records[ip]
	if !ok {
		rec = &attemptRecord{}
		g.records[ip] = rec
	}

	rec.count++
	rec.lastSeen = time.Now()

	if rec.count == maxLoginAttempts {
		rec.lockedAt = time.Now()
	}
}

// RecordSuccess clears any failure record for an IP on successful login.
func (g *LoginGuard) RecordSuccess(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.records, ip)
}

// LoginRateLimitMiddleware returns a Gin middleware that blocks locked-out IPs
// before the login handler runs.
func LoginRateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		locked, remaining := defaultLoginGuard.IsLocked(ip)
		if locked {
			mins := int(remaining.Minutes()) + 1
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":               "too_many_attempts",
				"message":             "Too many failed login attempts. Please try again in a few minutes.",
				"retry_after_minutes": mins,
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
