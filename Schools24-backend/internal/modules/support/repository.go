package support

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/database"
)

// Repository handles all DB operations for support_tickets (always in public schema).
type Repository struct {
	db *database.PostgresDB
}

func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

// inferLabel derives the display label from the user_type and source fields.
func inferLabel(userType, source string) string {
	if source == "landing" {
		return "landing"
	}
	switch userType {
	case "student":
		return "student"
	case "teacher":
		return "teacher"
	case "admin", "staff":
		return "school_admin"
	case "super_admin":
		return "super_admin"
	default:
		return "other"
	}
}

// CreateTicket inserts a new ticket and returns it with generated fields populated.
func (r *Repository) CreateTicket(ctx context.Context, req CreateTicketRequest, userID uuid.UUID, userType, userName, userEmail string, schoolID *uuid.UUID, schoolName *string) (*Ticket, error) {
	label := inferLabel(userType, "dashboard")
	row := r.db.Pool.QueryRow(ctx, `
		INSERT INTO public.support_tickets
		    (user_id, user_type, user_name, user_email, school_id, school_name,
		     subject, description, category, priority, source, label)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dashboard',$11)
		RETURNING id, ticket_number, user_id, user_type, user_name, user_email,
		          school_id, school_name, source, label, subject, description, category, priority,
		          status, admin_notes, resolved_by_name, resolved_at, created_at, updated_at
	`, userID, userType, userName, userEmail, schoolID, schoolName,
		req.Subject, req.Description, req.Category, req.Priority, label)

	return scanTicket(row)
}

func (r *Repository) CreatePublicTicket(ctx context.Context, req CreatePublicTicketRequest) (*Ticket, error) {
	var schoolName *string
	if strings.TrimSpace(req.Organization) != "" {
		org := strings.TrimSpace(req.Organization)
		schoolName = &org
	}

	row := r.db.Pool.QueryRow(ctx, `
		INSERT INTO public.support_tickets
		    (user_id, user_type, user_name, user_email, school_id, school_name,
		     subject, description, category, priority, source, label)
		VALUES (NULL, 'public', $1, $2, NULL, $3, $4, $5, $6, $7, 'landing', 'landing')
		RETURNING id, ticket_number, user_id, user_type, user_name, user_email,
		          school_id, school_name, source, label, subject, description, category, priority,
		          status, admin_notes, resolved_by_name, resolved_at, created_at, updated_at
	`, strings.TrimSpace(req.Name), strings.TrimSpace(req.Email), schoolName,
		strings.TrimSpace(req.Subject), strings.TrimSpace(req.Description), req.Category, req.Priority)

	return scanTicket(row)
}

// GetMyTickets returns all tickets submitted by a specific user (paginated).
func (r *Repository) GetMyTickets(ctx context.Context, userID uuid.UUID, page, pageSize int) ([]Ticket, int, error) {
	offset := (page - 1) * pageSize

	var total int
	if err := r.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.support_tickets WHERE user_id = $1`, userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Pool.Query(ctx, `
		SELECT id, ticket_number, user_id, user_type, user_name, user_email,
		       school_id, school_name, source, label, subject, description, category, priority,
		       status, admin_notes, resolved_by_name, resolved_at, created_at, updated_at
		FROM public.support_tickets
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	tickets := []Ticket{}
	for rows.Next() {
		t, err := scanTicketRow(rows)
		if err != nil {
			return nil, 0, err
		}
		tickets = append(tickets, *t)
	}
	return tickets, total, rows.Err()
}

// ListTickets returns all tickets with optional filters and search (super admin).
func (r *Repository) ListTickets(ctx context.Context, params TicketListParams) ([]Ticket, int, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}

	// Build dynamic WHERE clause
	where := []string{"1=1"}
	args := []any{}
	argIdx := 1

	if params.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, params.Status)
		argIdx++
	}
	if params.Category != "" {
		where = append(where, fmt.Sprintf("category = $%d", argIdx))
		args = append(args, params.Category)
		argIdx++
	}
	if params.Label != "" {
		where = append(where, fmt.Sprintf("label = $%d", argIdx))
		args = append(args, params.Label)
		argIdx++
	}
	if params.Search != "" {
		search := "%" + strings.ToLower(params.Search) + "%"
		where = append(where, fmt.Sprintf(
			"(LOWER(subject) LIKE $%d OR LOWER(user_name) LIKE $%d OR LOWER(user_email) LIKE $%d OR LOWER(school_name) LIKE $%d)",
			argIdx, argIdx+1, argIdx+2, argIdx+3,
		))
		args = append(args, search, search, search, search)
		argIdx += 4
	}

	whereSQL := strings.Join(where, " AND ")

	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM public.support_tickets WHERE %s", whereSQL)
	if err := r.db.Pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (params.Page - 1) * params.PageSize
	queryArgs := append(args, params.PageSize, offset)
	listSQL := fmt.Sprintf(`
		SELECT id, ticket_number, user_id, user_type, user_name, user_email,
		       school_id, school_name, source, label, subject, description, category, priority,
		       status, admin_notes, resolved_by_name, resolved_at, created_at, updated_at
		FROM public.support_tickets
		WHERE %s
		ORDER BY
		    CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
		    created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereSQL, argIdx, argIdx+1)

	rows, err := r.db.Pool.Query(ctx, listSQL, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	tickets := []Ticket{}
	for rows.Next() {
		t, err := scanTicketRow(rows)
		if err != nil {
			return nil, 0, err
		}
		tickets = append(tickets, *t)
	}
	return tickets, total, rows.Err()
}

// GetTicketByID retrieves a single ticket by its UUID.
func (r *Repository) GetTicketByID(ctx context.Context, id uuid.UUID) (*Ticket, error) {
	row := r.db.Pool.QueryRow(ctx, `
		SELECT id, ticket_number, user_id, user_type, user_name, user_email,
		       school_id, school_name, source, label, subject, description, category, priority,
		       status, admin_notes, resolved_by_name, resolved_at, created_at, updated_at
		FROM public.support_tickets
		WHERE id = $1
	`, id)
	return scanTicket(row)
}

// UpdateTicketStatus allows a super admin to set status + notes.
func (r *Repository) UpdateTicketStatus(ctx context.Context, id uuid.UUID, req UpdateTicketStatusRequest, resolvedByName string) (*Ticket, error) {
	var resolvedAt *time.Time
	if req.Status == "resolved" || req.Status == "closed" {
		now := time.Now()
		resolvedAt = &now
	}

	row := r.db.Pool.QueryRow(ctx, `
		UPDATE public.support_tickets
		SET status = $2,
		    admin_notes = $3,
		    resolved_by_name = CASE WHEN $2 IN ('resolved','closed') THEN $4 ELSE NULL END,
		    resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN $5 ELSE NULL END,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING id, ticket_number, user_id, user_type, user_name, user_email,
		          school_id, school_name, source, label, subject, description, category, priority,
		          status, admin_notes, resolved_by_name, resolved_at, created_at, updated_at
	`, id, req.Status, req.AdminNotes, resolvedByName, resolvedAt)

	return scanTicket(row)
}

// DeleteTicket permanently removes a ticket (super admin only).
func (r *Repository) DeleteTicket(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM public.support_tickets WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ticket not found")
	}
	return nil
}

// LookupUserInfo fetches user display info from the appropriate table.
// For super_admin the public schema is queried. For all other roles the
// tenant schema (injected via ctx by TenantMiddleware) is used.
func (r *Repository) LookupUserInfo(ctx context.Context, userID uuid.UUID, role string) (name, email, schoolName string, schoolID *uuid.UUID, err error) {
	if role == "super_admin" {
		err = r.db.Pool.QueryRow(ctx,
			`SELECT full_name, email FROM public.super_admins WHERE id = $1`, userID,
		).Scan(&name, &email)
		return // schoolID and schoolName stay nil/empty for super admin
	}

	// For tenant users, use the tenant-aware QueryRow (sets search_path via ctx).
	var dbSchoolID uuid.UUID
	var dbSchoolName *string
	err = r.db.QueryRow(ctx, `
		SELECT u.full_name, u.email, u.school_id, s.name
		FROM users u
		LEFT JOIN public.schools s ON s.id = u.school_id
		WHERE u.id = $1
	`, userID).Scan(&name, &email, &dbSchoolID, &dbSchoolName)
	if err != nil {
		return
	}
	schoolID = &dbSchoolID
	if dbSchoolName != nil {
		schoolName = *dbSchoolName
	}
	return
}

// UnreadCount returns the number of open tickets (for the SA notification badge).
func (r *Repository) UnreadCount(ctx context.Context) (int, error) {
	var count int
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM public.support_tickets WHERE status = 'open'
	`).Scan(&count)
	return count, err
}

// -----------------------------------------------------------------------------
// Scan helpers
// -----------------------------------------------------------------------------

type scanner interface {
	Scan(dest ...any) error
}

func scanTicket(row scanner) (*Ticket, error) {
	t := &Ticket{}
	err := row.Scan(
		&t.ID, &t.TicketNumber, &t.UserID, &t.UserType, &t.UserName, &t.UserEmail,
		&t.SchoolID, &t.SchoolName, &t.Source, &t.Label, &t.Subject, &t.Description, &t.Category, &t.Priority,
		&t.Status, &t.AdminNotes, &t.ResolvedByName, &t.ResolvedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return t, nil
}

func scanTicketRow(rows interface{ Scan(...any) error }) (*Ticket, error) {
	return scanTicket(rows)
}
