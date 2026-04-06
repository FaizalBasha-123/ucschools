package operations

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/config"
)

// Service handles business logic for operations module
type Service struct {
	repo *Repository
	cfg  *config.Config
}

// NewService creates a new operations service
func NewService(repo *Repository, cfg *config.Config) *Service {
	return &Service{
		repo: repo,
		cfg:  cfg,
	}
}

// GetEvents retrieves events with filters
func (s *Service) GetEvents(ctx context.Context, schoolID uuid.UUID, eventType string, startDate, endDate *time.Time, targetGrade *int, page, pageSize int) (*ListEventsResponse, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}

	events, totalCount, err := s.repo.GetEvents(ctx, schoolID, eventType, startDate, endDate, targetGrade, page, pageSize)
	if err != nil {
		return nil, err
	}

	if events == nil {
		events = []Event{}
	}

	return &ListEventsResponse{
		Events:     events,
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
	}, nil
}

// GetEventByID retrieves a single event
func (s *Service) GetEventByID(ctx context.Context, schoolID, eventID uuid.UUID) (*Event, error) {
	return s.repo.GetEventByID(ctx, schoolID, eventID)
}

// CreateEvent creates a new event
func (s *Service) CreateEvent(ctx context.Context, schoolID uuid.UUID, req CreateEventRequest) (uuid.UUID, error) {
	// Parse event date
	eventDate, err := time.Parse("2006-01-02", req.EventDate)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid event_date format: %w", err)
	}

	// Parse times if provided
	var startTime, endTime *time.Time
	if req.StartTime != "" {
		t, err := time.Parse("15:04", req.StartTime)
		if err != nil {
			return uuid.Nil, fmt.Errorf("invalid start_time format: %w", err)
		}
		startTime = &t
	}
	if req.EndTime != "" {
		t, err := time.Parse("15:04", req.EndTime)
		if err != nil {
			return uuid.Nil, fmt.Errorf("invalid end_time format: %w", err)
		}
		endTime = &t
	}

	description := req.Description
	location := req.Location

	return s.repo.CreateEvent(ctx, schoolID, req.Title, description, eventDate, startTime, endTime, req.Type, location, req.TargetGrade)
}

// UpdateEvent updates an existing event
func (s *Service) UpdateEvent(ctx context.Context, schoolID, eventID uuid.UUID, req UpdateEventRequest) error {
	updates := make(map[string]interface{})

	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.EventDate != nil {
		eventDate, err := time.Parse("2006-01-02", *req.EventDate)
		if err != nil {
			return fmt.Errorf("invalid event_date format: %w", err)
		}
		updates["event_date"] = eventDate
	}
	if req.StartTime != nil {
		if *req.StartTime == "" {
			updates["start_time"] = nil
		} else {
			t, err := time.Parse("15:04", *req.StartTime)
			if err != nil {
				return fmt.Errorf("invalid start_time format: %w", err)
			}
			updates["start_time"] = t
		}
	}
	if req.EndTime != nil {
		if *req.EndTime == "" {
			updates["end_time"] = nil
		} else {
			t, err := time.Parse("15:04", *req.EndTime)
			if err != nil {
				return fmt.Errorf("invalid end_time format: %w", err)
			}
			updates["end_time"] = t
		}
	}
	if req.Type != nil {
		updates["type"] = *req.Type
	}
	if req.Location != nil {
		updates["location"] = *req.Location
	}

	return s.repo.UpdateEvent(ctx, schoolID, eventID, updates)
}

// DeleteEvent deletes an event
func (s *Service) DeleteEvent(ctx context.Context, schoolID, eventID uuid.UUID) error {
	return s.repo.DeleteEvent(ctx, schoolID, eventID)
}

// GetEventsForGrades returns events scoped to a set of class-grade levels.
func (s *Service) GetEventsForGrades(ctx context.Context, schoolID uuid.UUID, grades []int32, eventType string, startDate, endDate *time.Time, page, pageSize int) (*ListEventsResponse, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 500 {
		pageSize = 500
	}

	events, totalCount, err := s.repo.GetEventsForGrades(ctx, schoolID, grades, eventType, startDate, endDate, page, pageSize)
	if err != nil {
		return nil, err
	}
	if events == nil {
		events = []Event{}
	}
	return &ListEventsResponse{
		Events:     events,
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
	}, nil
}
