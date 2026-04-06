// Package natsclient provides a NATS JetStream connection used by transport
// and other real-time modules.
//
// Why NATS JetStream over Kafka (or Redis pub/sub)?
//   - NATS is a Go-native, sub-millisecond message bus; Kafka requires JVM + Zookeeper.
//   - JetStream adds durable, at-least-once delivery on top of NATS core without
//     the operational overhead of Kafka. Docker image is ~25 MB vs ~500 MB for Kafka.
//   - JetStream KV store replaces the Valkey "last position" key for GPS state.
//   - A JetStream "last-value" subject lets every new SSE subscriber immediately
//     get the latest GPS fix with no extra Valkey read — the message bus IS the cache.
//
// Subjects (all published as JetStream):
//
//	transport.gps.<schoolID>.<routeID>   — LocationEvent JSON, every ~5 s per route
//	transport.session.<schoolID>          — SessionEvent JSON on every start/stop
package natsclient

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	// GPS stream — retains the last 60 min of pings per subject.
	// Consumers get the very last message on subscribe (LastPerSubjectDeliverPolicy)
	// so a new SSE viewer immediately sees where the bus is.
	GPSStreamName      = "TRANSPORT_GPS"
	GPSSubjectPrefix   = "transport.gps."
	GPSSubjectWildcard = "transport.gps.>"

	// Session stream — retains exactly 1 message per school subject.
	// Drivers subscribe and immediately learn whether tracking is allowed.
	SessionStreamName      = "TRANSPORT_SESSION"
	SessionSubjectPrefix   = "transport.session."
	SessionSubjectWildcard = "transport.session.>"

	// MaxAge for GPS messages — 1 hour sliding window.
	gpsMaxAge = 1 * time.Hour
	// MaxAge for session messages — 8 hours (covers a school day).
	sessionMaxAge = 8 * time.Hour
)

// Client wraps a NATS connection and a JetStream context.
type Client struct {
	nc *nats.Conn
	js jetstream.JetStream
}

// New dials the NATS server at natsURL and provisions the required JetStream
// streams. Returns a disabled no-op Client if the URL is empty or the server
// is unreachable (so transport still works via the in-memory Hub fallback).
func New(natsURL string) (*Client, error) {
	if natsURL == "" {
		log.Println("natsclient: NATS_URL not set — NATS JetStream disabled, using in-memory Hub")
		return &Client{}, nil
	}

	nc, err := nats.Connect(natsURL,
		nats.Name("schools24-transport"),
		nats.MaxReconnects(-1),            // reconnect forever
		nats.ReconnectWait(2*time.Second), // wait 2s between attempts
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				log.Printf("natsclient: disconnected from NATS: %v", err)
			}
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("natsclient: reconnected to NATS at %s", nc.ConnectedUrl())
		}),
	)
	if err != nil {
		return &Client{}, fmt.Errorf("natsclient: connect failed: %w", err)
	}

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return &Client{}, fmt.Errorf("natsclient: jetstream init failed: %w", err)
	}

	c := &Client{nc: nc, js: js}
	if err := c.ensureStreams(context.Background()); err != nil {
		nc.Close()
		return &Client{}, fmt.Errorf("natsclient: stream setup failed: %w", err)
	}

	log.Printf("natsclient: connected to NATS at %s — GPS + Session streams ready", nc.ConnectedUrl())
	return c, nil
}

// IsEnabled returns true when a live NATS connection is available.
func (c *Client) IsEnabled() bool {
	return c != nil && c.nc != nil && c.nc.IsConnected()
}

// Close drains and closes the NATS connection gracefully.
func (c *Client) Close() {
	if c.nc != nil {
		_ = c.nc.Drain()
	}
}

// ensureStreams creates the GPS and Session JetStream streams if they don't exist.
// Stream configs use "update or create" semantics so server restarts are safe.
func (c *Client) ensureStreams(ctx context.Context) error {
	// ── GPS stream ────────────────────────────────────────────────────────────
	// SubjectsFilter is a slice in newer JetStream; adapt if nats.go version differs.
	gpsConfig := jetstream.StreamConfig{
		Name:       GPSStreamName,
		Subjects:   []string{GPSSubjectWildcard},
		Retention:  jetstream.LimitsPolicy,  // discard old when limits hit
		MaxAge:     gpsMaxAge,               // drop pings older than 1 h
		MaxMsgSize: 512,                     // a GPS ping is ~120 bytes
		MaxBytes:   64 * 1024 * 1024,        // 64 MB total across all routes
		Storage:    jetstream.MemoryStorage, // RAM — no need to survive restarts
		Discard:    jetstream.DiscardOld,
		// LastPerSubjectDeliverPolicy is set per-consumer, not on the stream.
	}
	if _, err := c.js.CreateOrUpdateStream(ctx, gpsConfig); err != nil {
		return fmt.Errorf("create GPS stream: %w", err)
	}

	// ── Session stream ─────────────────────────────────────────────────────────
	// MaxMsgsPerSubject = 1 means each school subject keeps only the latest event —
	// exactly a last-value cache. A new subscriber immediately gets the current state.
	sessionConfig := jetstream.StreamConfig{
		Name:              SessionStreamName,
		Subjects:          []string{SessionSubjectWildcard},
		Retention:         jetstream.LimitsPolicy,
		MaxAge:            sessionMaxAge,
		MaxMsgsPerSubject: 1,               // last-value cache per school
		MaxBytes:          4 * 1024 * 1024, // 4 MB; sessions are tiny JSON
		Storage:           jetstream.MemoryStorage,
		Discard:           jetstream.DiscardOld,
	}
	if _, err := c.js.CreateOrUpdateStream(ctx, sessionConfig); err != nil {
		return fmt.Errorf("create Session stream: %w", err)
	}
	return nil
}

// PublishGPS publishes a GPS LocationEvent to JetStream.
// Subject: transport.gps.<schoolID>.<routeID>
func (c *Client) PublishGPS(ctx context.Context, schoolID, routeID string, payload []byte) error {
	if !c.IsEnabled() {
		return nil
	}
	subject := GPSSubjectPrefix + schoolID + "." + routeID
	_, err := c.js.Publish(ctx, subject, payload)
	return err
}

// PublishSession publishes a session start/stop event to JetStream.
// Subject: transport.session.<schoolID>
func (c *Client) PublishSession(ctx context.Context, schoolID string, payload []byte) error {
	if !c.IsEnabled() {
		return nil
	}
	subject := SessionSubjectPrefix + schoolID
	_, err := c.js.Publish(ctx, subject, payload)
	return err
}

// SubscribeSession returns a channel of session events for one school.
// Messages are delivered in real time whenever tracking state changes.
func (c *Client) SubscribeSession(ctx context.Context, schoolID string) (<-chan []byte, func(), error) {
	if !c.IsEnabled() {
		return nil, func() {}, nil
	}
	subject := SessionSubjectPrefix + schoolID
	ch := make(chan []byte, 16)

	sub, err := c.nc.Subscribe(subject, func(msg *nats.Msg) {
		select {
		case ch <- msg.Data:
		default:
		}
	})
	if err != nil {
		return nil, func() {}, fmt.Errorf("NATS subscribe session: %w", err)
	}

	cancel := func() {
		_ = sub.Unsubscribe()
		close(ch)
	}
	return ch, cancel, nil
}

// SubscribeGPSRoute returns a channel that delivers every GPS ping for the
// given school+route in real time. Uses core NATS subscribe (sub-ms, zero-copy)
// because GPS pings are published via nc.Publish on the hot path.
// Call cancel() to unsubscribe when the SSE connection closes.
func (c *Client) SubscribeGPSRoute(ctx context.Context, schoolID, routeID string) (<-chan []byte, func(), error) {
	if !c.IsEnabled() {
		return nil, func() {}, nil
	}
	subject := GPSSubjectPrefix + schoolID + "." + routeID
	ch := make(chan []byte, 32)

	sub, err := c.nc.Subscribe(subject, func(msg *nats.Msg) {
		select {
		case ch <- msg.Data:
		default: // subscriber lagging — skip this tick (same policy as Hub)
		}
	})
	if err != nil {
		return nil, func() {}, fmt.Errorf("NATS subscribe GPS route: %w", err)
	}

	cancel := func() {
		_ = sub.Unsubscribe()
		close(ch)
	}
	return ch, cancel, nil
}

// GetLastGPSPosition returns the most recent GPS event for a route from JetStream,
// or nil if no message exists yet (bus offline).
func (c *Client) GetLastGPSPosition(ctx context.Context, schoolID, routeID string) ([]byte, error) {
	if !c.IsEnabled() {
		return nil, nil
	}
	subject := GPSSubjectPrefix + schoolID + "." + routeID
	stream, err := c.js.Stream(ctx, GPSStreamName)
	if err != nil {
		return nil, err
	}
	msg, err := stream.GetLastMsgForSubject(ctx, subject)
	if err != nil {
		return nil, err // not found is expected when bus hasn't pinged yet
	}
	return msg.Data, nil
}

// GetLastSessionState returns the latest session event for a school.
func (c *Client) GetLastSessionState(ctx context.Context, schoolID string) ([]byte, error) {
	if !c.IsEnabled() {
		return nil, nil
	}
	subject := SessionSubjectPrefix + schoolID
	stream, err := c.js.Stream(ctx, SessionStreamName)
	if err != nil {
		return nil, err
	}
	msg, err := stream.GetLastMsgForSubject(ctx, subject)
	if err != nil {
		return nil, err
	}
	return msg.Data, nil
}

// PublishGPSCore publishes a GPS event via core NATS (no JetStream persistence).
// Used when NATS is enabled but JetStream publish would add latency on the hot path.
// JetStream still receives the message because core subjects are mirrored into the stream.
func (c *Client) PublishGPSCore(schoolID, routeID string, payload []byte) {
	if !c.IsEnabled() {
		return
	}
	subject := GPSSubjectPrefix + schoolID + "." + routeID
	_ = c.nc.Publish(subject, payload) // fire-and-forget; err logged by driver WS recover
}
