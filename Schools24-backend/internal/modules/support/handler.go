package support

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/schools24/backend/internal/shared/middleware"
)

// Handler exposes HTTP endpoints for support tickets.
type Handler struct {
	service          *Service
	hub              *TicketHub
	jwtSecret        string
	sessionValidator func(context.Context, *middleware.Claims) error
	upgrader         websocket.Upgrader
}

func NewHandler(service *Service, jwtSecret string, sessionValidator func(context.Context, *middleware.Claims) error) *Handler {
	return &Handler{
		service:          service,
		hub:              NewTicketHub(),
		jwtSecret:        jwtSecret,
		sessionValidator: sessionValidator,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

func (h *Handler) validateLiveToken(ctx context.Context, token string) (*middleware.Claims, error) {
	claims, err := middleware.ValidateToken(token, h.jwtSecret)
	if err != nil {
		return nil, err
	}
	if h.sessionValidator != nil {
		if err := h.sessionValidator(ctx, claims); err != nil {
			return nil, err
		}
	}
	return claims, nil
}

// -----------------------------------------------------------------------------
// End-user endpoints (any authenticated role)
// -----------------------------------------------------------------------------

// CreateTicket — POST /support/tickets
func (h *Handler) CreateTicket(c *gin.Context) {
	var req CreateTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userIDStr := middleware.GetUserID(c)
	role := middleware.GetRole(c)

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
		return
	}

	// Resolve display info from DB (not from JWT, to avoid stale/spoofed data)
	name, email, schoolName, schoolID, err := h.service.LookupUserInfo(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not resolve user identity"})
		return
	}

	var snPtr *string
	if schoolName != "" {
		snPtr = &schoolName
	}

	ticket, err := h.service.CreateTicket(c.Request.Context(), req, userID, role, name, email, schoolID, snPtr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast(&TicketEvent{Type: "created", Ticket: ticket})
	c.JSON(http.StatusCreated, gin.H{"ticket": ticket})
}

// CreatePublicTicket — POST /public/support/tickets
func (h *Handler) CreatePublicTicket(c *gin.Context) {
	var req CreatePublicTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ticket, err := h.service.CreatePublicTicket(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast(&TicketEvent{Type: "created", Ticket: ticket})
	c.JSON(http.StatusCreated, gin.H{"ticket": ticket})
}

// GetMyTickets — GET /support/tickets/mine
func (h *Handler) GetMyTickets(c *gin.Context) {
	userIDStr := middleware.GetUserID(c)
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
		return
	}

	page := queryInt(c, "page", 1)
	pageSize := queryInt(c, "page_size", 20)

	resp, err := h.service.GetMyTickets(c.Request.Context(), userID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// -----------------------------------------------------------------------------
// Super admin endpoints
// -----------------------------------------------------------------------------

// ListTickets — GET /super-admin/support/tickets
func (h *Handler) ListTickets(c *gin.Context) {
	params := TicketListParams{
		Page:     queryInt(c, "page", 1),
		PageSize: queryInt(c, "page_size", 20),
		Status:   c.Query("status"),
		Category: c.Query("category"),
		Label:    c.Query("label"),
		Search:   c.Query("search"),
	}

	resp, err := h.service.ListTickets(c.Request.Context(), params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// GetTicketByID — GET /super-admin/support/tickets/:id
func (h *Handler) GetTicketByID(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ticket id"})
		return
	}

	ticket, err := h.service.GetTicketByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ticket not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}

// UpdateTicketStatus — PUT /super-admin/support/tickets/:id/status
func (h *Handler) UpdateTicketStatus(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ticket id"})
		return
	}

	var req UpdateTicketStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Identify the SA who is resolving
	resolverID, _ := uuid.Parse(middleware.GetUserID(c))
	resolverName, _, _, _, _ := h.service.LookupUserInfo(c.Request.Context(), resolverID, "super_admin")

	ticket, err := h.service.UpdateTicketStatus(c.Request.Context(), id, req, resolverName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast(&TicketEvent{Type: "updated", Ticket: ticket})
	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}

// DeleteTicket — DELETE /super-admin/support/tickets/:id
func (h *Handler) DeleteTicket(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ticket id"})
		return
	}
	if err := h.service.DeleteTicket(c.Request.Context(), id); err != nil {
		if err.Error() == "ticket not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "ticket not found"})
			return
		}
		if errors.Is(err, ErrDeleteRequiresClosedStatus) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast(&TicketEvent{Type: "deleted", ID: id.String()})
	c.JSON(http.StatusOK, gin.H{"message": "ticket deleted"})
}

// UnreadCount — GET /super-admin/support/tickets/unread-count
func (h *Handler) UnreadCount(c *gin.Context) {
	resp, err := h.service.UnreadCount(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

func queryInt(c *gin.Context, key string, defaultVal int) int {
	var v int
	if s := c.Query(key); s != "" {
		if _, err := fmt.Sscanf(s, "%d", &v); err == nil && v > 0 {
			return v
		}
	}
	return defaultVal
}

// -----------------------------------------------------------------------------
// WebSocket — real-time ticket events for super-admin dashboard
// -----------------------------------------------------------------------------

// HandleSupportWS upgrades a super-admin connection to WebSocket and streams
// TicketEvent messages whenever any ticket is created, updated, or deleted.
//
// Auth: JWT passed as ?token=... query param (browser WS cannot set headers).
//
// GET /api/v1/super-admin/support/ws?token=JWT
func (h *Handler) HandleSupportWS(c *gin.Context) {
	// ── 1. Authenticate via query-param token ─────────────────────────────────
	tokenStr := strings.TrimSpace(c.Query("ticket"))
	isScopedTicket := tokenStr != ""
	if tokenStr == "" {
		tokenStr = strings.TrimSpace(c.Query("token"))
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}

	claims, err := h.validateLiveToken(c.Request.Context(), tokenStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}
	if isScopedTicket && claims.WSScope != "support" {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
		return
	}
	if claims.Role != "super_admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: super_admin only"})
		return
	}

	// ── 2. Upgrade to WebSocket ───────────────────────────────────────────────
	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.Header("Connection", "Upgrade")
		c.Header("Upgrade", "websocket")
		c.JSON(http.StatusUpgradeRequired, gin.H{"error": "websocket_upgrade_required"})
		return
	}
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[supportWS] upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// ── 3. Subscribe to hub ───────────────────────────────────────────────────
	client := h.hub.subscribe()
	defer h.hub.unsubscribe(client)

	log.Printf("[supportWS] SA user=%s connected (total=%d)", claims.UserID, h.hub.Subscribers())

	// ── 4. Write-pump goroutine ───────────────────────────────────────────────
	done := make(chan struct{})
	go func() {
		defer close(done)
		for evt := range client.send {
			if err := conn.WriteJSON(evt); err != nil {
				log.Printf("[supportWS] write error: %v", err)
				return
			}
		}
	}()

	if h.sessionValidator != nil {
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					if err := h.sessionValidator(context.Background(), claims); err != nil {
						_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "session_revoked"), time.Now().Add(5*time.Second))
						_ = conn.Close()
						return
					}
					_ = conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
				}
			}
		}()
	}

	// ── 5. Read-pump (main goroutine) — keep-alive / detect disconnect ────────
	const pongWait = 60 * time.Second
	conn.SetReadLimit(512)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[supportWS] unexpected close for user=%s: %v", claims.UserID, err)
			}
			break
		}
	}

	// Signal write-pump to exit and wait for it.
	h.hub.unsubscribe(client)
	<-done
	log.Printf("[supportWS] SA user=%s disconnected", claims.UserID)
}
