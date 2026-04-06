package transport

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// Hub manages in-memory SSE subscriber channels per bus route.
//
// Design rationale: for a single Render instance the in-memory fan-out is both
// simpler and faster than Redis pub/sub. When the deployment eventually scales
// to multiple instances, replace Broadcast() with a Redis PUBLISH and add a
// per-route Redis subscriber goroutine here — the SSE handler stays unchanged.
type Hub struct {
	mu      sync.RWMutex
	routes  map[string]map[string]chan []byte // routeID → connID → channel
	counter uint64
}

// NewHub returns an initialized Hub ready to use.
func NewHub() *Hub {
	return &Hub{
		routes: make(map[string]map[string]chan []byte),
	}
}

// Subscribe registers a new SSE client for routeID.
//
// Returns:
//   - connID: unique identifier for this connection (for logging)
//   - ch:     read-only channel; each received []byte is a complete SSE data payload
//   - cancel: MUST be called when the connection closes (deferred by the handler)
//
// The channel is buffered (16 slots) so a slow client does not block the driver's
// WebSocket read loop. Overflow is handled in Broadcast by a non-blocking send.
func (h *Hub) Subscribe(routeID string) (connID string, ch <-chan []byte, cancel func()) {
	id := atomic.AddUint64(&h.counter, 1)
	connID = fmt.Sprintf("%s#%d", routeID, id)
	c := make(chan []byte, 16)

	h.mu.Lock()
	if h.routes[routeID] == nil {
		h.routes[routeID] = make(map[string]chan []byte)
	}
	h.routes[routeID][connID] = c
	h.mu.Unlock()

	cancel = func() {
		h.mu.Lock()
		if subs := h.routes[routeID]; subs != nil {
			delete(subs, connID)
			if len(subs) == 0 {
				delete(h.routes, routeID)
			}
		}
		h.mu.Unlock()
		// Drain buffered messages so any writer goroutine (Broadcast) is not blocked.
		for len(c) > 0 {
			<-c
		}
	}

	return connID, c, cancel
}

// Broadcast sends data to every active SSE subscriber watching routeID.
// Slow or lagging clients are skipped (non-blocking send) — they will miss
// at most one 5-second GPS tick, which is acceptable for a live-tracking UX.
func (h *Hub) Broadcast(routeID string, data []byte) {
	h.mu.RLock()
	subs := h.routes[routeID]
	h.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- data:
		default: // subscriber is lagging; skip this tick
		}
	}
}

// ActiveCount returns the number of SSE clients currently subscribed to routeID.
// Used for logging and future adaptive push-rate throttling.
func (h *Hub) ActiveCount(routeID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.routes[routeID])
}
