package demo

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/modules/school"
	"github.com/schools24/backend/internal/shared/database"
)

type Repository struct {
	db *database.PostgresDB
}

func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreatePublicRequest(ctx context.Context, req school.CreateSchoolRequest, adminViews []DemoRequestAdminView, adminsSecret []byte, sourceIP string) (*DemoRequest, error) {
	adminsJSON, err := marshalAdminViews(adminViews)
	if err != nil {
		return nil, err
	}

	row := r.db.Pool.QueryRow(ctx, `
        INSERT INTO public.demo_requests (
            school_name, school_code, address, contact_email,
            admins_public, admins_secret, source_ip
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, request_number, school_name, school_code, address, contact_email,
                  admins_public, status, accepted_school_id,
                  accepted_at, NULL::TEXT AS accepted_by_name, trashed_at, NULL::TEXT AS trashed_by_name,
                  delete_after, source_ip, created_at, updated_at, NULL::TEXT AS accepted_school_name
    `,
		strings.TrimSpace(req.Name), nullIfBlank(req.Code), nullIfBlank(req.Address), nullIfBlank(req.ContactEmail),
		adminsJSON, adminsSecret, nullIfBlank(sourceIP),
	)

	return scanDemoRequest(row)
}

func (r *Repository) GetRequestRecordByID(ctx context.Context, id uuid.UUID) (*createDemoRequestRecord, error) {
	row := r.db.Pool.QueryRow(ctx, `
        SELECT dr.id, dr.request_number, dr.school_name, dr.school_code, dr.address, dr.contact_email,
               dr.admins_public, dr.status, dr.accepted_school_id,
               dr.accepted_at, sa.full_name AS accepted_by_name,
               dr.trashed_at, st.full_name AS trashed_by_name,
               dr.delete_after, dr.source_ip, dr.created_at, dr.updated_at, dr.admins_secret,
               s.name AS accepted_school_name
        FROM public.demo_requests dr
        LEFT JOIN public.super_admins sa ON dr.accepted_by = sa.id
        LEFT JOIN public.super_admins st ON dr.trashed_by = st.id
        LEFT JOIN public.schools s ON dr.accepted_school_id = s.id
        WHERE dr.id = $1
    `, id)

	return scanDemoRequestRecord(row)
}

func (r *Repository) ListRequests(ctx context.Context, params DemoRequestListParams) ([]DemoRequest, int, []int, error) {
	where := []string{"1=1"}
	args := []any{}
	idx := 1

	if params.Status != "" {
		where = append(where, fmt.Sprintf("dr.status = $%d", idx))
		args = append(args, params.Status)
		idx++
	}
	if params.Year > 0 {
		where = append(where, fmt.Sprintf("EXTRACT(YEAR FROM dr.created_at) = $%d", idx))
		args = append(args, params.Year)
		idx++
	}
	if params.Month > 0 {
		where = append(where, fmt.Sprintf("EXTRACT(MONTH FROM dr.created_at) = $%d", idx))
		args = append(args, params.Month)
		idx++
	}
	if search := strings.TrimSpace(strings.ToLower(params.Search)); search != "" {
		pattern := "%" + search + "%"
		where = append(where, fmt.Sprintf("(LOWER(dr.school_name) LIKE $%d OR LOWER(COALESCE(dr.contact_email,'')) LIKE $%d OR LOWER(COALESCE(dr.school_code,'')) LIKE $%d)", idx, idx+1, idx+2))
		args = append(args, pattern, pattern, pattern)
		idx += 3
	}

	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := r.db.Pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM public.demo_requests dr WHERE %s`, whereSQL), args...).Scan(&total); err != nil {
		return nil, 0, nil, err
	}

	years, err := r.ListAvailableYears(ctx)
	if err != nil {
		return nil, 0, nil, err
	}

	offset := (params.Page - 1) * params.PageSize
	queryArgs := append(append([]any{}, args...), params.PageSize, offset)
	rows, err := r.db.Pool.Query(ctx, fmt.Sprintf(`
        SELECT dr.id, dr.request_number, dr.school_name, dr.school_code, dr.address, dr.contact_email,
               dr.admins_public, dr.status, dr.accepted_school_id,
               dr.accepted_at, sa.full_name AS accepted_by_name,
               dr.trashed_at, st.full_name AS trashed_by_name,
               dr.delete_after, dr.source_ip, dr.created_at, dr.updated_at,
               s.name AS accepted_school_name
        FROM public.demo_requests dr
        LEFT JOIN public.super_admins sa ON dr.accepted_by = sa.id
        LEFT JOIN public.super_admins st ON dr.trashed_by = st.id
        LEFT JOIN public.schools s ON dr.accepted_school_id = s.id
        WHERE %s
        ORDER BY dr.created_at DESC
        LIMIT $%d OFFSET $%d
    `, whereSQL, idx, idx+1), queryArgs...)
	if err != nil {
		return nil, 0, nil, err
	}
	defer rows.Close()

	requests := make([]DemoRequest, 0)
	for rows.Next() {
		req, err := scanDemoRequestRow(rows)
		if err != nil {
			return nil, 0, nil, err
		}
		requests = append(requests, *req)
	}
	return requests, total, years, rows.Err()
}

func (r *Repository) ListAvailableYears(ctx context.Context) ([]int, error) {
	rows, err := r.db.Pool.Query(ctx, `
        SELECT DISTINCT EXTRACT(YEAR FROM created_at)::INT AS year
        FROM public.demo_requests
        ORDER BY year DESC
    `)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	years := make([]int, 0)
	for rows.Next() {
		var year int
		if err := rows.Scan(&year); err != nil {
			return nil, err
		}
		years = append(years, year)
	}
	return years, rows.Err()
}

func (r *Repository) GetStats(ctx context.Context, year, month int) (*DemoRequestStatsResponse, error) {
	if year <= 0 {
		if err := r.db.Pool.QueryRow(ctx, `SELECT COALESCE(MAX(EXTRACT(YEAR FROM created_at)::INT), EXTRACT(YEAR FROM NOW())::INT) FROM public.demo_requests`).Scan(&year); err != nil {
			return nil, err
		}
	}
	if month < 1 || month > 12 {
		if err := r.db.Pool.QueryRow(ctx, `SELECT EXTRACT(MONTH FROM NOW())::INT`).Scan(&month); err != nil {
			return nil, err
		}
	}

	years, err := r.ListAvailableYears(ctx)
	if err != nil {
		return nil, err
	}

	resp := &DemoRequestStatsResponse{Year: year, Month: month, AvailableYears: years, Months: make([]DemoRequestStatsMonth, 12)}
	for i := 1; i <= 12; i++ {
		resp.Months[i-1] = DemoRequestStatsMonth{Month: i}
	}

	rows, err := r.db.Pool.Query(ctx, `
        SELECT EXTRACT(MONTH FROM created_at)::INT AS month_num, COUNT(*)
        FROM public.demo_requests
        WHERE EXTRACT(YEAR FROM created_at) = $1
        GROUP BY month_num
        ORDER BY month_num
    `, year)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var monthNum int
		var total int
		if err := rows.Scan(&monthNum, &total); err != nil {
			return nil, err
		}
		if monthNum >= 1 && monthNum <= 12 {
			resp.Months[monthNum-1].Total = total
		}
	}

	if err := r.db.Pool.QueryRow(ctx, `
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'accepted') AS accepted,
            COUNT(*) FILTER (WHERE status = 'trashed') AS trashed
        FROM public.demo_requests
        WHERE EXTRACT(YEAR FROM created_at) = $1
          AND EXTRACT(MONTH FROM created_at) = $2
    `, year, month).Scan(&resp.Total, &resp.Pending, &resp.Accepted, &resp.Trashed); err != nil {
		return nil, err
	}

	return resp, nil
}

func (r *Repository) MarkAccepted(ctx context.Context, id, superAdminID, schoolID uuid.UUID) (*DemoRequest, error) {
	row := r.db.Pool.QueryRow(ctx, `
        UPDATE public.demo_requests
        SET status = 'accepted',
            accepted_school_id = $2,
            accepted_at = NOW(),
            accepted_by = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, request_number, school_name, school_code, address, contact_email,
                  admins_public, status, accepted_school_id,
                  accepted_at,
                  (SELECT full_name FROM public.super_admins WHERE id = $3) AS accepted_by_name,
                  trashed_at, NULL::TEXT AS trashed_by_name,
                  delete_after, source_ip, created_at, updated_at,
                  (SELECT name FROM public.schools WHERE id = $2) AS accepted_school_name
    `, id, schoolID, superAdminID)
	return scanDemoRequest(row)
}

func (r *Repository) MarkTrashed(ctx context.Context, id, superAdminID uuid.UUID) (*DemoRequest, error) {
	row := r.db.Pool.QueryRow(ctx, `
        UPDATE public.demo_requests
        SET status = 'trashed',
            trashed_at = NOW(),
            trashed_by = $2,
            delete_after = NOW() + INTERVAL '30 days',
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, request_number, school_name, school_code, address, contact_email,
                  admins_public, status, accepted_school_id,
                  accepted_at, NULL::TEXT AS accepted_by_name,
                  trashed_at,
                  (SELECT full_name FROM public.super_admins WHERE id = $2) AS trashed_by_name,
                  delete_after, source_ip, created_at, updated_at,
                  (SELECT name FROM public.schools WHERE id = accepted_school_id) AS accepted_school_name
    `, id, superAdminID)
	return scanDemoRequest(row)
}

func (r *Repository) DeleteExpiredTrashed(ctx context.Context) error {
	_, err := r.db.Pool.Exec(ctx, `
        DELETE FROM public.demo_requests
        WHERE status = 'trashed'
          AND delete_after IS NOT NULL
          AND delete_after <= NOW()
    `)
	return err
}

func (r *Repository) SchoolCodeExists(ctx context.Context, code string) (bool, error) {
	if strings.TrimSpace(code) == "" {
		return false, nil
	}
	var exists bool
	if err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.schools WHERE UPPER(code) = UPPER($1) AND deleted_at IS NULL)`, code).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return true, nil
	}
	if err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.demo_requests WHERE UPPER(school_code) = UPPER($1) AND status = 'pending')`, code).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func scanDemoRequest(row pgx.Row) (*DemoRequest, error) {
	var adminsRaw []byte
	req := &DemoRequest{}
	err := row.Scan(
		&req.ID,
		&req.RequestNumber,
		&req.SchoolName,
		&req.SchoolCode,
		&req.Address,
		&req.ContactEmail,
		&adminsRaw,
		&req.Status,
		&req.AcceptedSchoolID,
		&req.AcceptedAt,
		&req.AcceptedByName,
		&req.TrashedAt,
		&req.TrashedByName,
		&req.DeleteAfter,
		&req.SourceIP,
		&req.CreatedAt,
		&req.UpdatedAt,
		&req.AcceptedSchoolName,
	)
	if err != nil {
		return nil, err
	}
	admins, err := unmarshalAdminViews(adminsRaw)
	if err != nil {
		return nil, err
	}
	req.Admins = admins
	return req, nil
}

func scanDemoRequestRow(rows pgx.Rows) (*DemoRequest, error) {
	var adminsRaw []byte
	req := &DemoRequest{}
	err := rows.Scan(
		&req.ID,
		&req.RequestNumber,
		&req.SchoolName,
		&req.SchoolCode,
		&req.Address,
		&req.ContactEmail,
		&adminsRaw,
		&req.Status,
		&req.AcceptedSchoolID,
		&req.AcceptedAt,
		&req.AcceptedByName,
		&req.TrashedAt,
		&req.TrashedByName,
		&req.DeleteAfter,
		&req.SourceIP,
		&req.CreatedAt,
		&req.UpdatedAt,
		&req.AcceptedSchoolName,
	)
	if err != nil {
		return nil, err
	}
	admins, err := unmarshalAdminViews(adminsRaw)
	if err != nil {
		return nil, err
	}
	req.Admins = admins
	return req, nil
}

func scanDemoRequestRecord(row pgx.Row) (*createDemoRequestRecord, error) {
	var adminsRaw []byte
	req := &createDemoRequestRecord{}
	err := row.Scan(
		&req.ID,
		&req.RequestNumber,
		&req.SchoolName,
		&req.SchoolCode,
		&req.Address,
		&req.ContactEmail,
		&adminsRaw,
		&req.Status,
		&req.AcceptedSchoolID,
		&req.AcceptedAt,
		&req.AcceptedByName,
		&req.TrashedAt,
		&req.TrashedByName,
		&req.DeleteAfter,
		&req.SourceIP,
		&req.CreatedAt,
		&req.UpdatedAt,
		&req.AdminsSecret,
		&req.AcceptedSchoolName,
	)
	if err != nil {
		return nil, err
	}
	admins, err := unmarshalAdminViews(adminsRaw)
	if err != nil {
		return nil, err
	}
	req.Admins = admins
	return req, nil
}

func nullIfBlank(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
