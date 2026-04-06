package support

import (
	"context"
	"errors"
	"math"

	"github.com/google/uuid"
)

var ErrDeleteRequiresClosedStatus = errors.New("only closed tickets can be deleted")
var ErrInvalidTicketTransition = errors.New("invalid ticket status transition")

// Service encapsulates business logic for support tickets.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) LookupUserInfo(ctx context.Context, userID uuid.UUID, role string) (name, email, schoolName string, schoolID *uuid.UUID, err error) {
	return s.repo.LookupUserInfo(ctx, userID, role)
}

func (s *Service) CreateTicket(ctx context.Context, req CreateTicketRequest, userID uuid.UUID, userType, userName, userEmail string, schoolID *uuid.UUID, schoolName *string) (*Ticket, error) {
	return s.repo.CreateTicket(ctx, req, userID, userType, userName, userEmail, schoolID, schoolName)
}

func (s *Service) CreatePublicTicket(ctx context.Context, req CreatePublicTicketRequest) (*Ticket, error) {
	return s.repo.CreatePublicTicket(ctx, req)
}

func (s *Service) GetMyTickets(ctx context.Context, userID uuid.UUID, page, pageSize int) (*TicketListResponse, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}
	tickets, total, err := s.repo.GetMyTickets(ctx, userID, page, pageSize)
	if err != nil {
		return nil, err
	}
	totalPages := int(math.Ceil(float64(total) / float64(pageSize)))
	return &TicketListResponse{
		Tickets:    tickets,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func (s *Service) ListTickets(ctx context.Context, params TicketListParams) (*TicketListResponse, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}
	tickets, total, err := s.repo.ListTickets(ctx, params)
	if err != nil {
		return nil, err
	}
	totalPages := int(math.Ceil(float64(total) / float64(params.PageSize)))
	return &TicketListResponse{
		Tickets:    tickets,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
		TotalPages: totalPages,
	}, nil
}

func (s *Service) GetTicketByID(ctx context.Context, id uuid.UUID) (*Ticket, error) {
	return s.repo.GetTicketByID(ctx, id)
}

func (s *Service) UpdateTicketStatus(ctx context.Context, id uuid.UUID, req UpdateTicketStatusRequest, resolvedByName string) (*Ticket, error) {
	current, err := s.repo.GetTicketByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, errors.New("ticket not found")
	}
	if !isAllowedTicketTransition(current.Status, req.Status) {
		return nil, ErrInvalidTicketTransition
	}
	return s.repo.UpdateTicketStatus(ctx, id, req, resolvedByName)
}

func (s *Service) DeleteTicket(ctx context.Context, id uuid.UUID) error {
	ticket, err := s.repo.GetTicketByID(ctx, id)
	if err != nil {
		return err
	}
	if ticket.Status != "closed" {
		return ErrDeleteRequiresClosedStatus
	}
	return s.repo.DeleteTicket(ctx, id)
}

func (s *Service) UnreadCount(ctx context.Context) (*UnreadCountResponse, error) {
	count, err := s.repo.UnreadCount(ctx)
	if err != nil {
		return nil, err
	}
	return &UnreadCountResponse{Count: count}, nil
}

func isAllowedTicketTransition(from, to string) bool {
	if from == "" || to == "" {
		return false
	}
	if from == to {
		return true
	}

	allowed := map[string]map[string]bool{
		"open": {
			"in_progress": true,
			"resolved":    true,
			"closed":      true,
		},
		"in_progress": {
			"open":     true,
			"resolved": true,
			"closed":   true,
		},
		"resolved": {
			"in_progress": true,
			"closed":      true,
		},
		"closed": {
			"in_progress": true,
		},
	}

	return allowed[from][to]
}
