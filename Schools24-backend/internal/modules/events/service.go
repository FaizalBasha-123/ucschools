package events

import (
	"context"
	"fmt"
	"log"

	"github.com/schools24/backend/internal/shared/cache"
)

type Event struct {
	Type     string      `json:"type"`
	TenantID string      `json:"tenant_id,omitempty"`
	Payload  interface{} `json:"payload,omitempty"`
}

type Service struct {
	cache *cache.Cache
}

func NewService(c *cache.Cache) *Service {
	return &Service{cache: c}
}

// Publish broadcasts an event to the specific tenant's Redis channel.
func (s *Service) Publish(ctx context.Context, tenantID, eventType string, payload interface{}) error {
	if s.cache == nil || !s.cache.IsEnabled() {
		return nil
	}
	evt := Event{
		Type:     eventType,
		TenantID: tenantID,
		Payload:  payload,
	}
	channel := fmt.Sprintf("tenant:%s:events", tenantID)
	err := s.cache.Publish(ctx, channel, evt)
	if err != nil {
		log.Printf("events: failed to publish %s for %s: %v", eventType, tenantID, err)
	}
	return err
}

// Subscribe returns a channel that receives JSON-encoded event strings and a cancel function.
func (s *Service) Subscribe(ctx context.Context, tenantID string) (<-chan string, func()) {
	if s.cache == nil || !s.cache.IsEnabled() {
		return nil, func() {}
	}
	
	channel := fmt.Sprintf("tenant:%s:events", tenantID)
	pubsub := s.cache.Subscribe(ctx, channel)
	if pubsub == nil {
		return nil, func() {}
	}

	ch := pubsub.Channel()
	out := make(chan string, 100)
	
	go func() {
		for msg := range ch {
			out <- msg.Payload
		}
	}()
	
	return out, func() { 
		pubsub.Close() 
	}
}
