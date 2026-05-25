package events

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/schools24/backend/internal/shared/middleware"
)

type Handler struct {
	service          *Service
	jwtSecret        string
	sessionValidator func(context.Context, *middleware.Claims) error
	upgrader         websocket.Upgrader
}

func NewHandler(service *Service, jwtSecret string, sessionValidator func(context.Context, *middleware.Claims) error) *Handler {
	return &Handler{
		service:          service,
		jwtSecret:        jwtSecret,
		sessionValidator: sessionValidator,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// HandleWebSocket upgrades the HTTP connection to WebSocket and streams events.
// GET /api/v1/events/ws
func (h *Handler) HandleWebSocket(c *gin.Context) {
	// Authenticate
	claims, err := h.validateToken(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	schoolID := claims.SchoolID
	if schoolID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "school context missing"})
		return
	}

	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.Header("Connection", "Upgrade")
		c.Header("Upgrade", "websocket")
		c.JSON(http.StatusUpgradeRequired, gin.H{"error": "websocket_upgrade_required"})
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("events: WS upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	ch, cancel := h.service.Subscribe(c.Request.Context(), schoolID)
	defer cancel()

	if ch == nil {
		_ = conn.WriteJSON(map[string]string{"error": "realtime features unavailable"})
		return
	}

	// We need to keep a read loop so the connection handles close correctly
	clientGone := make(chan struct{})
	go func() {
		defer close(clientGone)
		for {
			if _, _, readErr := conn.ReadMessage(); readErr != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-clientGone:
			return
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			// Session validation removed from keep-alive to prevent DB hammering.
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
				return
			}
		}
	}
}

func (h *Handler) validateToken(c *gin.Context) (*middleware.Claims, error) {
	tokenStr := c.Query("ticket")
	if tokenStr == "" {
		tokenStr = c.Query("token")
	}
	if tokenStr == "" {
		auth := c.GetHeader("Authorization")
		if len(auth) > 7 {
			tokenStr = auth[7:]
		}
	}

	claims, err := middleware.ValidateToken(tokenStr, h.jwtSecret)
	if err != nil {
		return nil, err
	}
	if h.sessionValidator != nil {
		if err := h.sessionValidator(c.Request.Context(), claims); err != nil {
			return nil, err
		}
	}
	return claims, nil
}
