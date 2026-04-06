package teacher

// hub.go — Concurrent pub/sub hub for teacher class-group WebSocket messages.
//
// Design:
//  - One room per class_id (UUID key).
//  - Each connected WS client owns a buffered send-channel.
//  - Broadcast delivers a message to every subscriber in a room.
//  - subscribe / unsubscribe are safe to call from any goroutine.
//  - A back-pressured channel (size msgBufferSize) prevents a slow client
//    from blocking the broadcasting goroutine; messages are dropped if full.

import (
	"sync"

	"github.com/google/uuid"
)

const msgBufferSize = 32

// wsClient represents a single WebSocket connection subscribed to one class room.
type wsClient struct {
	classID uuid.UUID
	send    chan *ClassGroupMessage
}

// MessageHub is a thread-safe pub/sub hub keyed by class UUID.
type MessageHub struct {
	mu    sync.RWMutex
	rooms map[uuid.UUID]map[*wsClient]struct{}
}

// NewMessageHub creates an initialised, ready-to-use hub.
func NewMessageHub() *MessageHub {
	return &MessageHub{
		rooms: make(map[uuid.UUID]map[*wsClient]struct{}),
	}
}

// subscribe registers a new client for classID and returns the client.
// The caller is responsible for calling unsubscribe when done.
func (h *MessageHub) subscribe(classID uuid.UUID) *wsClient {
	h.mu.Lock()
	defer h.mu.Unlock()

	c := &wsClient{
		classID: classID,
		send:    make(chan *ClassGroupMessage, msgBufferSize),
	}
	if h.rooms[classID] == nil {
		h.rooms[classID] = make(map[*wsClient]struct{})
	}
	h.rooms[classID][c] = struct{}{}
	return c
}

// unsubscribe removes a client from its room and closes its send-channel.
// Safe to call multiple times (idempotent).
func (h *MessageHub) unsubscribe(c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[c.classID]
	if !ok {
		return
	}
	if _, exists := room[c]; !exists {
		return
	}
	delete(room, c)
	if len(room) == 0 {
		delete(h.rooms, c.classID)
	}
	close(c.send)
}

// Broadcast sends msg to every client subscribed to classID.
// Slow consumers are silently dropped (non-blocking send).
func (h *MessageHub) Broadcast(classID uuid.UUID, msg *ClassGroupMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for c := range h.rooms[classID] {
		select {
		case c.send <- msg:
		default:
			// client is too slow — drop rather than block
		}
	}
}

// Subscribers returns the number of active subscribers for a class room.
// Useful for metrics / logging.
func (h *MessageHub) Subscribers(classID uuid.UUID) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[classID])
}
