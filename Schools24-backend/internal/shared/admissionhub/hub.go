package admissionhub

// hub.go — School-scoped pub/sub hub for real-time admission notifications.
//
// Design:
//  - One room per school_id (UUID key).
//  - Each connected WS admin client owns a buffered send channel.
//  - Broadcast delivers an event to every subscriber in the school room.
//  - subscribe / Unsubscribe are safe to call from any goroutine.
//  - Shared between the public module (broadcast on new submission) and
//    the admin module (WebSocket endpoint that receives events).

import (
	"sync"

	"github.com/google/uuid"
)

const bufSize = 64

// Event is the JSON payload pushed to WS subscribers.
type Event struct {
	Type     string `json:"type"` // "new_admission"
	SchoolID string `json:"school_id"`
}

// Client represents a single WebSocket subscriber for a school room.
type Client struct {
	SchoolID uuid.UUID
	Send     chan *Event
}

// Hub is a thread-safe school-scoped pub/sub hub.
type Hub struct {
	mu    sync.RWMutex
	rooms map[uuid.UUID]map[*Client]struct{}
}

// New creates an initialised, ready-to-use Hub.
func New() *Hub {
	return &Hub{
		rooms: make(map[uuid.UUID]map[*Client]struct{}),
	}
}

// Subscribe registers a new client for schoolID and returns the client.
// The caller must call Unsubscribe when done.
func (h *Hub) Subscribe(schoolID uuid.UUID) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()

	c := &Client{
		SchoolID: schoolID,
		Send:     make(chan *Event, bufSize),
	}
	if h.rooms[schoolID] == nil {
		h.rooms[schoolID] = make(map[*Client]struct{})
	}
	h.rooms[schoolID][c] = struct{}{}
	return c
}

// Unsubscribe removes the client from its room and closes its send channel.
func (h *Hub) Unsubscribe(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[c.SchoolID]
	if room == nil {
		return
	}
	close(c.Send)
	delete(room, c)
	if len(room) == 0 {
		delete(h.rooms, c.SchoolID)
	}
}

// Broadcast sends event to every subscriber in schoolID's room (non-blocking).
// Messages are dropped for slow clients whose buffer is full.
func (h *Hub) Broadcast(schoolID uuid.UUID, event *Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for c := range h.rooms[schoolID] {
		select {
		case c.Send <- event:
		default:
			// buffer full — drop rather than block
		}
	}
}

// Subscribers returns the number of active connections for a school.
func (h *Hub) Subscribers(schoolID uuid.UUID) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[schoolID])
}
