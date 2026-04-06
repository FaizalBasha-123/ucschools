package chat

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/schools24/backend/internal/shared/middleware"
)

// maxHistoryTurns is the number of user+assistant turn pairs kept per session.
const maxHistoryTurns = 10

type Handler struct {
	service          *Service
	jwtSecret        string
	sessionValidator func(context.Context, *middleware.Claims) error
	upgrader         websocket.Upgrader
}

// NewHandler creates the chat WebSocket handler.
// jwtSecret is used to validate ?token= query-param auth for WS connections
// (browser WebSocket API cannot set custom headers).
func NewHandler(service *Service, jwtSecret string, sessionValidator func(context.Context, *middleware.Claims) error) *Handler {
	return &Handler{
		service:          service,
		jwtSecret:        jwtSecret,
		sessionValidator: sessionValidator,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
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

// HandleWebSocket upgrades HTTP → WS and runs the per-connection chat loop.
// GET /api/v1/chat/ws?token=JWT
func (h *Handler) HandleWebSocket(c *gin.Context) {
	// ── 1. Authenticate via query-param or header token ───────────────────────
	tokenStr := strings.TrimSpace(c.Query("ticket"))
	isScopedTicket := tokenStr != ""
	if tokenStr == "" {
		tokenStr = strings.TrimSpace(c.Query("token"))
	}
	if tokenStr == "" {
		auth := c.GetHeader("Authorization")
		tokenStr = strings.TrimPrefix(auth, "Bearer ")
	}

	// Try to extract role + school_id from the token if we have a secret
	var (
		role, schoolID string
		claims         *middleware.Claims
		err            error
	)
	if tokenStr != "" && h.jwtSecret != "" {
		claims, err = h.validateLiveToken(c.Request.Context(), tokenStr)
		if err == nil {
			role = claims.Role
			schoolID = claims.SchoolID
			if isScopedTicket && claims.WSScope != "chat" {
				c.JSON(http.StatusForbidden, gin.H{"error": "invalid_ws_scope"})
				return
			}
		}
	}

	// Require at least a token to be present (or an already-set user_id via middleware)
	userID := middleware.GetUserID(c)
	if userID == "" && claims != nil {
		userID = claims.UserID
	}
	if userID == "" && tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// Hard-stop: admin/super_admin without a verified schoolID must never get a connection.
	// This prevents a tampered or expired token from silently stripping school context.
	if (role == "admin" || role == "super_admin") && schoolID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "school context missing from token — please log in again"})
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
		log.Printf("WS upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Per-connection conversation history (in-memory, ephemeral)
	var history []Message
	// Per-connection accumulated document context (base64-decoded text)
	var docContext strings.Builder

	// Per-connection WS rate limiting: 20 messages per minute max
	const wsMaxMsgsPerMin = 20
	msgCount := 0
	windowStart := time.Now()

	// No server-side welcome — the frontend renders its own animated greeting.

	for {
		var msg WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			break
		}

		switch msg.Type {

		case MsgTypeDoc:
			// Decode base64 file content and accumulate as document context
			if msg.FileData != "" {
				raw, decErr := base64.StdEncoding.DecodeString(msg.FileData)
				if decErr == nil {
					// Validate magic bytes to prevent MIME spoofing
					if magicErr := validateFileMagicBytes(raw, msg.MimeType); magicErr != nil {
						_ = conn.WriteJSON(WSMessage{Type: MsgTypeError, Content: "File rejected: " + magicErr.Error()})
						continue
					}
					docContext.WriteString("\n\n[Document: " + msg.Filename + "]\n")
					ct := strings.ToLower(msg.MimeType)
					if strings.Contains(ct, "text") || strings.Contains(ct, "markdown") || strings.Contains(ct, "csv") {
						docContext.Write(raw)
					} else {
						docContext.WriteString("[Binary file — content extraction not yet supported for " + msg.MimeType + "]")
					}
				}
			}

			query := strings.TrimSpace(msg.Content)
			if query == "" {
				query = "Please summarise what is in this document."
			}
			if h.sessionValidator != nil && claims != nil {
				if err := h.sessionValidator(c.Request.Context(), claims); err != nil {
					_ = conn.WriteJSON(WSMessage{Type: MsgTypeError, Content: "Session expired. Please reconnect."})
					return
				}
			}

			reply, data, err := h.service.GetResponse(c.Request.Context(), query, history, docContext.String(), role, schoolID)
			if err != nil {
				_ = conn.WriteJSON(WSMessage{Type: MsgTypeError, Content: "AI error: " + err.Error()})
				continue
			}
			if data != nil {
				_ = conn.WriteJSON(WSMessage{Type: MsgTypeData, DataPayload: data})
			}
			history = appendHistory(history, query, reply)
			_ = conn.WriteJSON(WSMessage{Type: MsgTypeBot, Content: reply})

		case MsgTypeUser:
			// Per-connection rate limit: reset window every minute
			if time.Since(windowStart) >= time.Minute {
				msgCount = 0
				windowStart = time.Now()
			}
			msgCount++
			if msgCount > wsMaxMsgsPerMin {
				_ = conn.WriteJSON(WSMessage{Type: MsgTypeError, Content: "Rate limit exceeded. Please wait before sending more messages."})
				continue
			}

			query := strings.TrimSpace(msg.Content)
			if query == "" {
				continue
			}
			if h.sessionValidator != nil && claims != nil {
				if err := h.sessionValidator(c.Request.Context(), claims); err != nil {
					_ = conn.WriteJSON(WSMessage{Type: MsgTypeError, Content: "Session expired. Please reconnect."})
					return
				}
			}

			reply, data, err := h.service.GetResponse(c.Request.Context(), query, history, docContext.String(), role, schoolID)
			if err != nil {
				_ = conn.WriteJSON(WSMessage{Type: MsgTypeError, Content: "AI error: " + err.Error()})
				continue
			}
			// Send structured data first (if a tool was called) so the frontend
			// can render the table/cards before the text summary arrives.
			if data != nil {
				_ = conn.WriteJSON(WSMessage{Type: MsgTypeData, DataPayload: data})
			}
			history = appendHistory(history, query, reply)
			_ = conn.WriteJSON(WSMessage{Type: MsgTypeBot, Content: reply})
		}
	}
}

// appendHistory adds a user+assistant pair and trims to maxHistoryTurns.
func appendHistory(history []Message, userText, assistantText string) []Message {
	history = append(history,
		Message{Role: "user", Content: userText},
		Message{Role: "assistant", Content: assistantText},
	)
	// Keep only the last N pairs (2 messages per turn)
	max := maxHistoryTurns * 2
	if len(history) > max {
		history = history[len(history)-max:]
	}
	return history
}

// validateFileMagicBytes checks that the raw file bytes match the declared MIME type,
// preventing clients from spoofing the Content-Type to bypass server-side checks.
func validateFileMagicBytes(raw []byte, mimeType string) error {
	if len(raw) < 4 {
		return nil // too small to validate; allow
	}

	ct := strings.ToLower(mimeType)

	switch {
	case strings.Contains(ct, "pdf"):
		if !bytes.HasPrefix(raw, []byte("%PDF")) {
			return fmt.Errorf("file does not appear to be a valid PDF")
		}
	case strings.Contains(ct, "wordprocessingml") ||
		strings.Contains(ct, "spreadsheetml") ||
		strings.Contains(ct, "presentationml") ||
		strings.Contains(ct, "openxmlformats"):
		// OOXML formats are ZIP-based
		if !bytes.HasPrefix(raw, []byte("PK\x03\x04")) {
			return fmt.Errorf("file does not appear to be a valid Office Open XML document")
		}
	case strings.Contains(ct, "msword"):
		// Legacy .doc: OLE2 compound document
		if !bytes.HasPrefix(raw, []byte("\xD0\xCF\x11\xE0")) && !bytes.HasPrefix(raw, []byte("PK\x03\x04")) {
			return fmt.Errorf("file does not appear to be a valid Word document")
		}
	// Plain text, CSV, Markdown — no magic bytes to check
	case strings.Contains(ct, "text"), strings.Contains(ct, "csv"), strings.Contains(ct, "markdown"):
		// allowed as-is
	}

	return nil
}
