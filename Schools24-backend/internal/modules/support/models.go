package support

import (
	"time"

	"github.com/google/uuid"
)

// -----------------------------------------------------------------------------
// Domain model
// -----------------------------------------------------------------------------

// Ticket is the canonical representation of a support ticket stored in public.support_tickets.
type Ticket struct {
	ID             uuid.UUID  `json:"id"`
	TicketNumber   int64      `json:"ticket_number"`
	UserID         *uuid.UUID `json:"user_id,omitempty"`
	UserType       string     `json:"user_type"` // admin | teacher | student | staff | super_admin | public
	UserName       string     `json:"user_name"`
	UserEmail      string     `json:"user_email"`
	SchoolID       *uuid.UUID `json:"school_id,omitempty"`
	SchoolName     *string    `json:"school_name,omitempty"`
	Source         string     `json:"source"`
	Label          string     `json:"label"` // landing | student | teacher | school_admin | super_admin | other
	Subject        string     `json:"subject"`
	Description    string     `json:"description"`
	Category       string     `json:"category"` // general | technical | billing | academic | other
	Priority       string     `json:"priority"` // low | medium | high | critical
	Status         string     `json:"status"`   // open | in_progress | resolved | closed
	AdminNotes     *string    `json:"admin_notes,omitempty"`
	ResolvedByName *string    `json:"resolved_by_name,omitempty"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// -----------------------------------------------------------------------------
// Request / Response DTOs
// -----------------------------------------------------------------------------

// CreateTicketRequest is submitted by any authenticated user.
type CreateTicketRequest struct {
	Subject     string `json:"subject"     binding:"required,min=5,max=500"`
	Description string `json:"description" binding:"required,min=10"`
	Category    string `json:"category"    binding:"required,oneof=general technical billing academic other"`
	Priority    string `json:"priority"    binding:"required,oneof=low medium high critical"`
}

// CreatePublicTicketRequest is submitted from the public landing/help-center flow.
type CreatePublicTicketRequest struct {
	Name         string `json:"name"         binding:"required,min=2,max=255"`
	Email        string `json:"email"        binding:"required,email,max=255"`
	Organization string `json:"organization" binding:"max=255"`
	Subject      string `json:"subject"      binding:"required,min=5,max=500"`
	Description  string `json:"description"  binding:"required,min=10"`
	Category     string `json:"category"     binding:"required,oneof=general technical billing academic other"`
	Priority     string `json:"priority"     binding:"required,oneof=low medium high critical"`
}

// UpdateTicketStatusRequest is sent by super admin to update status / add notes.
type UpdateTicketStatusRequest struct {
	Status     string  `json:"status"      binding:"required,oneof=open in_progress resolved closed"`
	AdminNotes *string `json:"admin_notes"`
}

// TicketListParams carries query parameters for the SA listing endpoint.
type TicketListParams struct {
	Page     int    `form:"page"`
	PageSize int    `form:"page_size"`
	Status   string `form:"status"`   // "" = all
	Category string `form:"category"` // "" = all
	Label    string `form:"label"`    // "" = all; landing | student | teacher | school_admin | super_admin
	Search   string `form:"search"`   // searches subject + user_name + user_email
}

// TicketListResponse is the paginated response from the SA list endpoint.
type TicketListResponse struct {
	Tickets    []Ticket `json:"tickets"`
	Total      int      `json:"total"`
	Page       int      `json:"page"`
	PageSize   int      `json:"page_size"`
	TotalPages int      `json:"total_pages"`
}

// UnreadCountResponse returns the number of "open" tickets for the SA badge.
type UnreadCountResponse struct {
	Count int `json:"count"`
}

// TicketEvent is broadcast to all connected SA WebSocket clients whenever a
// ticket is created, updated (status/notes changed), or deleted.
//
// type values: "created" | "updated" | "deleted"
// For "deleted", only ID is present; Ticket is nil.
type TicketEvent struct {
	Type   string  `json:"type"`
	Ticket *Ticket `json:"ticket,omitempty"`
	ID     string  `json:"id,omitempty"` // populated for "deleted"
}
