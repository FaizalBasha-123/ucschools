package support

// hub.go — Simple broadcast hub for super-admin support-ticket WebSocket clients.
//
// Unlike the teacher hub (which has per-class rooms), all SA connections receive
// the same events, so there is no room partitioning — just a flat set of clients.
//
//  - subscribe  → register a new client, returns *ticketClient
//  - unsubscribe → remove the client and close its send-channel (idempotent)
//  - Broadcast  → non-blocking fan-out to every current subscriber

import "sync"

const ticketMsgBufSize = 32

// ticketClient represents one connected SA WebSocket consumer.
type ticketClient struct {
	send chan *TicketEvent
}

// TicketHub is a thread-safe broadcast hub for TicketEvent messages.
type TicketHub struct {
	mu      sync.RWMutex
	clients map[*ticketClient]struct{}
}

// NewTicketHub returns an initialised, ready-to-use hub.
func NewTicketHub() *TicketHub {
	return &TicketHub{
		clients: make(map[*ticketClient]struct{}),
	}
}

// subscribe registers a new client and returns it.
// The caller must call unsubscribe after the WS connection closes.
func (h *TicketHub) subscribe() *ticketClient {
	c := &ticketClient{send: make(chan *TicketEvent, ticketMsgBufSize)}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	return c
}

// unsubscribe removes the client and closes its send-channel.
// Safe to call multiple times (idempotent).
func (h *TicketHub) unsubscribe(c *ticketClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c]; !ok {
		return
	}
	delete(h.clients, c)
	close(c.send)
}

// Broadcast delivers evt to every subscriber.
// Slow consumers are silently dropped (non-blocking send).
func (h *TicketHub) Broadcast(evt *TicketEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- evt:
		default:
			// client too slow — drop rather than block
		}
	}
}

// Subscribers returns the current number of connected clients.
func (h *TicketHub) Subscribers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
