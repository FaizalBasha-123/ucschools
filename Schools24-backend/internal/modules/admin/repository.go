package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/shared/database"
	"github.com/schools24/backend/internal/shared/objectstore"
	"golang.org/x/crypto/bcrypt"
)

// Repository handles database operations for admin module
type Repository struct {
	db    *database.PostgresDB
	store objectstore.Store
}

// NewRepository creates a new admin repository
func NewRepository(db *database.PostgresDB, store objectstore.Store) *Repository {
	return &Repository{db: db, store: store}
}

func normalizeTeacherSubjects(fallback []string) []string {
	normalized := make([]string, 0, len(fallback))
	seen := map[string]struct{}{}
	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		normalized = append(normalized, trimmed)
	}

	for _, subject := range fallback {
		add(subject)
	}

	return normalized
}

func mapTeacherSubjectValues(values []string, globalSubjectNameByID map[string]string) (names []string, subjectIDs []string) {
	nameSeen := map[string]struct{}{}
	idSeen := map[string]struct{}{}
	addName := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		key := strings.ToLower(trimmed)
		if _, exists := nameSeen[key]; exists {
			return
		}
		nameSeen[key] = struct{}{}
		names = append(names, trimmed)
	}
	addID := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		key := strings.ToLower(trimmed)
		if _, exists := idSeen[key]; exists {
			return
		}
		idSeen[key] = struct{}{}
		subjectIDs = append(subjectIDs, trimmed)
	}

	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		normalizedKey := strings.ToLower(trimmed)
		if _, err := uuid.Parse(trimmed); err == nil {
			addID(trimmed)
			if mappedName, exists := globalSubjectNameByID[normalizedKey]; exists {
				addName(mappedName)
				continue
			}
		}
		addName(trimmed)
	}

	return names, subjectIDs
}

// EmailExistsAnyTenant checks whether an email already exists in any tenant users table
// or in global super_admins. Comparison is case-insensitive.
func (r *Repository) EmailExistsAnyTenant(ctx context.Context, email string) (bool, error) {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		return false, nil
	}

	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM super_admins WHERE LOWER(email) = LOWER($1))`, normalizedEmail).Scan(&exists); err != nil {
		return false, fmt.Errorf("failed to check super admin email uniqueness: %w", err)
	}
	if exists {
		return true, nil
	}

	rows, err := r.db.Query(ctx, `SELECT id FROM schools WHERE deleted_at IS NULL`)
	if err != nil {
		return false, fmt.Errorf("failed to list schools for email uniqueness check: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var schoolID uuid.UUID
		if err := rows.Scan(&schoolID); err != nil {
			return false, fmt.Errorf("failed to scan school id for email uniqueness check: %w", err)
		}

		schemaName := fmt.Sprintf("\"school_%s\"", schoolID)
		query := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s.users WHERE LOWER(email) = LOWER($1))`, schemaName)
		if err := r.db.QueryRow(ctx, query, normalizedEmail).Scan(&exists); err != nil {
			return false, fmt.Errorf("failed to check tenant email uniqueness in %s: %w", schemaName, err)
		}
		if exists {
			return true, nil
		}
	}

	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("failed while iterating schools for email uniqueness check: %w", err)
	}

	return false, nil
}

// GetAllStaff retrieves all staff members with filters (optional school scope)
func (r *Repository) GetAllStaff(ctx context.Context, schoolID *uuid.UUID, search string, designation string, limit, offset int) ([]Staff, int, error) {
	var staffList []Staff
	var args []interface{}
	argNum := 1

	whereClause := "WHERE 1=1"
	if schoolID != nil {
		whereClause += " AND s.school_id = $" + strconv.Itoa(argNum)
		args = append(args, *schoolID)
		argNum++
	}

	if search != "" {
		whereClause += fmt.Sprintf(" AND (u.full_name ILIKE $%d OR u.email ILIKE $%d OR s.employee_id ILIKE $%d)", argNum, argNum+1, argNum+2)
		args = append(args, "%"+search+"%", "%"+search+"%", "%"+search+"%")
		argNum += 3
	}

	if designation != "" {
		whereClause += fmt.Sprintf(" AND s.designation ILIKE $%d", argNum)
		args = append(args, "%"+designation+"%")
		argNum++
	}

	// Get total count - uses tenant schema's users table via search_path
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*) 
		FROM non_teaching_staff s
		JOIN users u ON s.user_id = u.id
		%s
	`, whereClause)
	var total int
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count staff: %w", err)
	}

	// Fetch Non-Teaching Staff - uses tenant schema's users table via search_path
	queryStaff := fmt.Sprintf(`
		SELECT s.id, u.id, u.full_name, u.email, u.phone, u.profile_picture_url, 
		       s.employee_id, s.designation, s.qualification, 
		       s.experience_years, s.salary, s.hire_date, s.school_id,
		       COALESCE(u.is_suspended, false)
		FROM non_teaching_staff s
		JOIN users u ON s.user_id = u.id
		%s
		ORDER BY u.full_name ASC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)

	args = append(args, limit, offset)

	// args = append(args, limit, offset) <-- Remove duplicate
	// fmt.Printf <-- Remove

	rows, err := r.db.Query(ctx, queryStaff, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to fetch non-teaching staff: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var s Staff
		var phone, avatar *string
		var hireDate sql.NullTime
		var salary sql.NullFloat64
		err := rows.Scan(
			&s.ID, &s.UserID, &s.Name, &s.Email, &phone, &avatar,
			&s.EmployeeID, &s.Designation, &s.Qualification,
			&s.ExperienceYears, &salary, &hireDate, &s.SchoolID,
			&s.IsSuspended,
		)
		if err != nil {
			fmt.Printf("ERROR scanning staff row: %v\n", err)
			continue
		}
		s.Phone = phone
		s.Avatar = avatar
		s.StaffType = "non-teaching"
		if salary.Valid {
			s.Salary = salary.Float64
		}
		if hireDate.Valid {
			s.JoinDate = hireDate.Time.Format("2006-01-02")
		}
		staffList = append(staffList, s)
	}

	return staffList, total, nil
}

// CreateStaff creates a new staff member (User + Teacher/Staff entry)
func (r *Repository) CreateStaff(ctx context.Context, schoolID uuid.UUID, req CreateStaffRequest) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	exists, err := r.EmailExistsAnyTenant(ctx, req.Email)
	if err != nil {
		return err
	}
	if exists {
		return ErrEmailExists
	}

	// 1. Create User
	userID := uuid.New()
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)

	userRole := "staff"

	// Insert User
	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, role, full_name, phone, school_id, email_verified, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
	`, userID, req.Email, string(hashedPassword), userRole, req.FullName, req.Phone, schoolID, true, time.Now())

	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	// 2. Insert into Non-Teaching Staff table
	hireDate := time.Now()

	_, err = tx.Exec(ctx, `
			INSERT INTO non_teaching_staff (school_id, user_id, employee_id, designation, qualification, experience_years, salary, hire_date)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, schoolID, userID, req.EmployeeID, req.Designation, req.Qualification, req.ExperienceYears, req.Salary, hireDate)

	if err != nil {
		return fmt.Errorf("failed to create staff details: %w", err)
	}

	return tx.Commit(ctx)
}

// UpdateStaff updates a staff member (User + Teacher/Staff entry)
func (r *Repository) UpdateStaff(ctx context.Context, staffID uuid.UUID, req UpdateStaffRequest) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// All admin staff are non-teaching
	var userID uuid.UUID
	table := "non_teaching_staff"

	// Verify existence and get User ID
	query := fmt.Sprintf("SELECT user_id FROM %s WHERE id = $1", table)
	err = tx.QueryRow(ctx, query, staffID).Scan(&userID)
	if err != nil {
		return fmt.Errorf("staff member not found: %w", err)
	}

	// 1. Update User Details - uses tenant schema's users table via search_path
	userQuery := `
		UPDATE users 
		SET full_name = COALESCE(NULLIF($2, ''), full_name),
		    phone = COALESCE(NULLIF($3, ''), phone),
		    profile_picture_url = COALESCE(NULLIF($4, ''), profile_picture_url),
		    updated_at = NOW()
		WHERE id = $1
	`
	// Note: Email update disallowed for simplicity/safety in this context, or add if needed
	_, err = tx.Exec(ctx, userQuery, userID, req.FullName, req.Phone, req.Avatar)
	if err != nil {
		return fmt.Errorf("failed to update user details: %w", err)
	}

	// 2. Update Staff Details
	staffQuery := `
			UPDATE non_teaching_staff
			SET designation = COALESCE(NULLIF($2, ''), designation),
			    qualification = COALESCE(NULLIF($3, ''), qualification),
			    experience_years = COALESCE($4, experience_years),
			    salary = COALESCE($5, salary),
			    updated_at = NOW()
			WHERE id = $1
		`
	_, err = tx.Exec(ctx, staffQuery, staffID, req.Designation, req.Qualification, req.ExperienceYears, req.Salary)

	if err != nil {
		return fmt.Errorf("failed to update staff details: %w", err)
	}

	return tx.Commit(ctx)
}

// GetStaffSchoolID retrieves the school_id for a staff member from the public schema
func (r *Repository) GetStaffSchoolID(ctx context.Context, staffID uuid.UUID, staffType string) (uuid.UUID, error) {
	var schoolID uuid.UUID
	// All admin staff are stored in non_teaching_staff
	query := "SELECT school_id FROM non_teaching_staff WHERE id = $1"
	err := r.db.QueryRow(ctx, query, staffID).Scan(&schoolID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to get staff school_id: %w", err)
	}
	return schoolID, nil
}

func (r *Repository) GetTeacherSchoolID(ctx context.Context, teacherID uuid.UUID) (uuid.UUID, error) {
	var schoolID uuid.UUID
	if err := r.db.QueryRow(ctx, `SELECT school_id FROM teachers WHERE id = $1`, teacherID).Scan(&schoolID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to get teacher school_id: %w", err)
	}
	return schoolID, nil
}

func (r *Repository) GetTeacherSchoolIDByUserID(ctx context.Context, userID uuid.UUID) (uuid.UUID, error) {
	var schoolID uuid.UUID
	if err := r.db.QueryRow(ctx, `SELECT school_id FROM teachers WHERE user_id = $1`, userID).Scan(&schoolID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to get teacher school_id by user_id: %w", err)
	}
	return schoolID, nil
}

// GetDashboardStats retrieves admin dashboard statistics for a specific school
func (r *Repository) GetDashboardStats(ctx context.Context, schoolID uuid.UUID) (*AdminDashboard, error) {
	dashboard := &AdminDashboard{}

	// Total users by role in this school
	query := `
		SELECT 
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE role = 'admin' OR role = 'super_admin') as admins,
			COUNT(*) FILTER (WHERE role = 'student') as students,
			COUNT(*) FILTER (WHERE role = 'teacher') as teachers
		FROM users WHERE school_id = $1
	`
	err := r.db.QueryRow(ctx, query, schoolID).Scan(&dashboard.TotalUsers, &dashboard.TotalAdmins, &dashboard.TotalStudents, &dashboard.TotalTeachers)
	if err != nil {
		return nil, err
	}

	// Total classes for this school
	query = `SELECT COUNT(id) FROM classes WHERE school_id = $1`
	err = r.db.QueryRow(ctx, query, schoolID).Scan(&dashboard.TotalClasses)
	if err != nil {
		dashboard.TotalClasses = 0
	}

	// Fee stats for this school
	dashboard.FeeCollection = &FeeStats{}
	query = `
		SELECT 
			COALESCE(SUM(amount), 0) as total_due,
			COALESCE(SUM(paid_amount), 0) as total_collected,
			COALESCE(SUM(amount - paid_amount - waiver_amount) FILTER (WHERE status = 'pending'), 0) as pending,
			COALESCE(SUM(amount - paid_amount - waiver_amount) FILTER (WHERE status = 'overdue'), 0) as overdue
		FROM student_fees WHERE student_id IN (SELECT id FROM students WHERE school_id = $1)
	`
	err = r.db.QueryRow(ctx, query, schoolID).Scan(
		&dashboard.FeeCollection.TotalDue,
		&dashboard.FeeCollection.TotalCollected,
		&dashboard.FeeCollection.TotalPending,
		&dashboard.FeeCollection.TotalOverdue,
	)
	if err != nil {
		dashboard.FeeCollection = nil
	} else if dashboard.FeeCollection.TotalDue > 0 {
		dashboard.FeeCollection.CollectionRate = (dashboard.FeeCollection.TotalCollected / dashboard.FeeCollection.TotalDue) * 100
	}

	// Upcoming events
	dashboard.UpcomingEvents, _ = r.GetEvents(ctx, schoolID, 4)

	// Inventory alerts (low stock)
	dashboard.InventoryAlerts, _ = r.GetLowStockItems(ctx, schoolID, 5)

	// Recent activity
	dashboard.RecentActivity, _ = r.GetRecentAuditLogs(ctx, 10)

	return dashboard, nil
}

// GetAllUsers retrieves all users with filters
func (r *Repository) GetAllUsers(ctx context.Context, role, search string, schoolID *uuid.UUID, limit, offset int) ([]UserListItem, int, error) {
	var args []interface{}
	argNum := 1

	whereClause := "WHERE u.role NOT IN ('super_admin', 'staff')"

	if schoolID != nil {
		// Include users whose school_id matches OR is NULL.
		// The tenant search_path already isolates this query to school_<id>.users,
		// so NULL school_id rows are still valid tenants (created before the
		// school_id back-fill or via older code paths).
		whereClause += fmt.Sprintf(" AND (u.school_id = $%d OR u.school_id IS NULL)", argNum)
		args = append(args, *schoolID)
		argNum++
	}
	// Filter by role only if it's a valid role (not "all" or empty)
	if role != "" && role != "all" {
		whereClause += fmt.Sprintf(" AND u.role = $%d", argNum)
		args = append(args, role)
		argNum++
	}
	if search != "" {
		whereClause += fmt.Sprintf(" AND (u.email ILIKE $%d OR u.full_name ILIKE $%d)", argNum, argNum+1)
		args = append(args, "%"+search+"%", "%"+search+"%")
		argNum += 2
	}

	// Get total count
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM users u %s`, whereClause)
	var total int
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Get users
	query := fmt.Sprintf(`
		SELECT u.id, u.email, u.full_name, u.role, u.phone, u.created_at, u.created_by,
		       creator.full_name as created_by_name,
		       u.last_login_at,
		       COALESCE(u.profile_picture_url, '') as avatar,
		       ''::text as department,
		       u.school_id,
		       COALESCE(t.rating, 0.0) as rating,
		       COALESCE(c.name, '') as class_name,
		       COALESCE(s.roll_number, '') as roll_number,
		       COALESCE(s.parent_name, '') as parent_name,
		       COALESCE(s.parent_phone, '') as parent_phone,
		       COALESCE(t.salary, 0.0) as salary,
		       COALESCE(u.is_suspended, false) as is_suspended,
		       u.suspended_at
		FROM users u
		LEFT JOIN users creator ON u.created_by = creator.id
		LEFT JOIN LATERAL (
			SELECT rating, salary
			FROM teachers
			WHERE user_id = u.id
			ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
			LIMIT 1
		) t ON true
		LEFT JOIN students s ON s.user_id = u.id
		LEFT JOIN classes c ON c.id = s.class_id
		%s
		ORDER BY u.full_name ASC, u.id ASC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []UserListItem
	for rows.Next() {
		var u UserListItem
		err := rows.Scan(&u.ID, &u.Email, &u.FullName, &u.Role, &u.Phone, &u.CreatedAt, &u.CreatedBy, &u.CreatedByName, &u.LastLogin, &u.Avatar, &u.Department, &u.SchoolID, &u.Rating, &u.ClassName, &u.RollNumber, &u.ParentName, &u.ParentPhone, &u.Salary, &u.IsSuspended, &u.SuspendedAt)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, u)
	}

	return users, total, nil
}

// GetUserStats retrieves count of users by role (excludes super_admin)
func (r *Repository) GetUserStats(ctx context.Context, schoolID *uuid.UUID) (*UserSummary, error) {
	summary := &UserSummary{}
	// Exclude super_admin
	whereClause := "WHERE role != 'super_admin'"
	var args []interface{}

	if schoolID != nil {
		// Same NULL-safe logic as GetAllUsers — tenant search_path already isolates
		// the query; NULL school_id rows are still valid tenant users.
		whereClause += " AND (school_id = $1 OR school_id IS NULL)"
		args = append(args, *schoolID)
	}

	query := fmt.Sprintf(`
		SELECT 
			COUNT(*) as total,
			COUNT(*) FILTER (WHERE role = 'admin') as admins,
			COUNT(*) FILTER (WHERE role = 'teacher') as teachers,
			COUNT(*) FILTER (WHERE role = 'student') as students,
			COUNT(*) FILTER (WHERE role = 'staff') as staff
		FROM users 
		%s
	`, whereClause)

	err := r.db.QueryRow(ctx, query, args...).Scan(&summary.Total, &summary.Admins, &summary.Teachers, &summary.Students, &summary.Staff)
	if err != nil {
		return nil, err
	}

	return summary, nil
}

// GetUserByID retrieves a user by ID
func (r *Repository) GetUserByID(ctx context.Context, userID uuid.UUID) (*UserListItem, error) {
	query := `
		SELECT u.id, u.email, u.full_name, u.role, u.phone, u.created_at, u.last_login_at,
		       COALESCE(u.profile_picture_url, '') as avatar,
		       ''::text as department,
		       u.school_id, u.is_suspended, u.suspended_at,
		       COALESCE(c.name, '') as class_name,
		       COALESCE(s.roll_number, '') as roll_number,
		       COALESCE(s.parent_name, '') as parent_name,
		       COALESCE(s.parent_phone, '') as parent_phone
		FROM users u
		LEFT JOIN students s ON s.user_id = u.id
		LEFT JOIN classes c ON c.id = s.class_id
		WHERE u.id = $1
	`
	var u UserListItem
	err := r.db.QueryRow(ctx, query, userID).Scan(&u.ID, &u.Email, &u.FullName, &u.Role, &u.Phone, &u.CreatedAt, &u.LastLogin, &u.Avatar, &u.Department, &u.SchoolID, &u.IsSuspended, &u.SuspendedAt, &u.ClassName, &u.RollNumber, &u.ParentName, &u.ParentPhone)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

// GetUserPasswordHash returns only the bcrypt hash for password verification
func (r *Repository) GetUserPasswordHash(ctx context.Context, userID uuid.UUID) (string, error) {
	var hash string
	if err := r.db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return "", err
	}
	return hash, nil
}

// SuspendUser suspends a tenant user (prevents login, all content preserved)
func (r *Repository) SuspendUser(ctx context.Context, targetID, suspendedBy uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE users
		SET is_suspended = TRUE, suspended_at = NOW(), suspended_by = $2, updated_at = NOW()
		WHERE id = $1
	`, targetID, suspendedBy)
}

// UnsuspendUser lifts the suspension from a tenant user
func (r *Repository) UnsuspendUser(ctx context.Context, targetID uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE users
		SET is_suspended = FALSE, suspended_at = NULL, suspended_by = NULL, updated_at = NOW()
		WHERE id = $1
	`, targetID)
}

// CreateUser creates a new user
func (r *Repository) CreateUser(ctx context.Context, req *CreateUserRequest) (uuid.UUID, error) {
	exists, err := r.EmailExistsAnyTenant(ctx, req.Email)
	if err != nil {
		return uuid.Nil, err
	}
	if exists {
		return uuid.Nil, ErrEmailExists
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return uuid.Nil, err
	}

	var schoolID *uuid.UUID
	if req.SchoolID != "" {
		id, err := uuid.Parse(req.SchoolID)
		if err == nil {
			schoolID = &id
		}
	}

	var createdBy *uuid.UUID
	if req.CreatedBy != "" {
		id, err := uuid.Parse(req.CreatedBy)
		if err == nil {
			createdBy = &id
		}
	}

	query := `
		INSERT INTO users (email, password_hash, full_name, role, phone, school_id, created_by)
		VALUES (LOWER($1), $2, $3, $4, $5, $6, $7)
		RETURNING id
	`

	var id uuid.UUID
	err = r.db.QueryRow(ctx, query, req.Email, string(hashedPassword), req.FullName, req.Role, req.Phone, schoolID, createdBy).Scan(&id)
	return id, err
}

// UpdateUser updates a user
func (r *Repository) UpdateUser(ctx context.Context, userID uuid.UUID, req *UpdateUserRequest) error {
	var passwordHash *string
	if req.Password != "" {
		hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		hs := string(hashed)
		passwordHash = &hs
	}

	query := `
		UPDATE users SET
			email = COALESCE(NULLIF(LOWER($2), ''), email),
			full_name = COALESCE(NULLIF($3, ''), full_name),
			role = COALESCE(NULLIF($4, ''), role),
			phone = COALESCE(NULLIF($5, ''), phone),
			password_hash = COALESCE($6, password_hash),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`
	return r.db.Exec(ctx, query, userID, req.Email, req.FullName, req.Role, req.Phone, passwordHash)
}

// DeleteUser hard deletes a user
func (r *Repository) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	query := `DELETE FROM users WHERE id = $1`
	return r.db.Exec(ctx, query, userID)
}

// DeleteStaff deletes a staff member (User + Profile)
func (r *Repository) DeleteStaff(ctx context.Context, staffID uuid.UUID, staffType string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// All admin staff are non-teaching
	var userID uuid.UUID
	err = tx.QueryRow(ctx, "SELECT user_id FROM non_teaching_staff WHERE id = $1", staffID).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("staff member not found")
		}
		return err
	}

	// Delete User (Cascades to Staff table) - uses tenant schema's users table via search_path
	if _, err := tx.Exec(ctx, "DELETE FROM users WHERE id = $1", userID); err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}

	return tx.Commit(ctx)
}

// CountAdminsBySchool counts admins in a school
func (r *Repository) CountAdminsBySchool(ctx context.Context, schoolID uuid.UUID) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM users WHERE school_id = $1 AND role = 'admin'`
	err := r.db.QueryRow(ctx, query, schoolID).Scan(&count)
	return count, err
}

// CreateStudentWithProfile creates a user and student profile
func (r *Repository) CreateStudentWithProfile(ctx context.Context, req *CreateStudentRequest) (uuid.UUID, error) {
	// Extract school_id from the request context so the user record is properly
	// scoped. Without this, users.school_id would be NULL, causing JWT to carry
	// an empty school_id claim and RequireActiveUser to reject every request.
	var schoolIDStr string
	if sid, ok := ctx.Value("school_id").(string); ok && sid != "" {
		schoolIDStr = sid
	}

	// Create user first
	userReq := &CreateUserRequest{
		Email:    strings.ToLower(req.Email),
		Password: req.Password,
		FullName: req.FullName,
		Role:     "student",
		Phone:    req.Phone,
		SchoolID: schoolIDStr,
	}
	userID, err := r.CreateUser(ctx, userReq)
	if err != nil {
		return uuid.Nil, err
	}

	// Create student profile
	var classIDPtr *uuid.UUID
	if req.ClassID != "" {
		if cid, parseErr := uuid.Parse(req.ClassID); parseErr == nil {
			classIDPtr = &cid
		}
	}

	var dob *time.Time
	if req.DateOfBirth != "" {
		t, _ := time.Parse("2006-01-02", req.DateOfBirth)
		dob = &t
	}

	// Resolve school_id for this tenant (already in ctx from TenantMiddleware)
	var schoolUUID *uuid.UUID
	if sid, ok := ctx.Value("school_id").(string); ok && sid != "" {
		if parsed, parseErr := uuid.Parse(sid); parseErr == nil {
			schoolUUID = &parsed
		}
	}

	// Auto-generate admission number if not provided
	admissionNumber := req.AdmissionNumber
	if admissionNumber == "" {
		admissionNumber = "ADM-" + strings.ToUpper(userID.String()[:8])
	}

	// Default gender
	gender := req.Gender
	if gender == "" {
		gender = "other"
	}

	// Default academic year
	academicYear := req.AcademicYear
	if academicYear == "" {
		y := time.Now().Year()
		academicYear = fmt.Sprintf("%d-%d", y, y+1)
	}

	section := req.Section
	if section == "" {
		section = "A"
	}

	query := `
		INSERT INTO students
			(school_id, user_id, admission_number, roll_number, class_id, section,
			 date_of_birth, gender, parent_name, parent_phone, parent_email, address,
			 admission_date, academic_year)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING id
	`
	var studentID uuid.UUID
	err = r.db.QueryRow(ctx, query,
		schoolUUID, userID, admissionNumber, req.RollNumber, classIDPtr, section,
		dob, gender, req.ParentName, req.ParentPhone, req.ParentEmail, req.Address,
		time.Now(), academicYear,
	).Scan(&studentID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to create student profile: %w", err)
	}

	return userID, nil
}

// CreateTeacherWithProfile creates a user and teacher profile
func (r *Repository) CreateTeacherWithProfile(ctx context.Context, req *CreateTeacherRequest) (uuid.UUID, error) {
	// Create user first
	userReq := &CreateUserRequest{
		Email:     strings.ToLower(req.Email),
		Password:  req.Password,
		FullName:  req.FullName,
		Role:      "teacher",
		Phone:     req.Phone,
		SchoolID:  req.SchoolID,
		CreatedBy: req.CreatedBy,
	}
	userID, err := r.CreateUser(ctx, userReq)
	if err != nil {
		return uuid.Nil, err
	}

	// Create teacher profile
	query := `
		INSERT INTO teachers (school_id, user_id, employee_id, designation, qualifications, subjects_taught)
		VALUES ((SELECT school_id FROM users WHERE id = $1), $1, $2, $3, $4, $5)
		RETURNING id
	`
	var teacherID uuid.UUID
	normalizedSubjects := normalizeTeacherSubjects(req.SubjectsTaught)
	err = r.db.QueryRow(ctx, query, userID, req.EmployeeID, req.Designation, req.Qualifications, normalizedSubjects).Scan(&teacherID)
	if err != nil {
		return uuid.Nil, err
	}

	return userID, nil
}

// GetTeachers retrieves paginated teacher details (tenant-scoped via search_path)
func (r *Repository) GetTeachers(ctx context.Context, schoolID *uuid.UUID, search, status string, limit, offset int) ([]TeacherDetail, int, error) {
	var teachers []TeacherDetail
	var args []interface{}
	argNum := 1
	globalSubjectNameByID := map[string]string{}

	subjectRows, err := r.db.Query(ctx, `SELECT id::text, name FROM public.global_subjects`)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to load global subjects: %w", err)
	}
	for subjectRows.Next() {
		var id string
		var name string
		if scanErr := subjectRows.Scan(&id, &name); scanErr != nil {
			subjectRows.Close()
			return nil, 0, fmt.Errorf("failed to scan global subject: %w", scanErr)
		}
		globalSubjectNameByID[strings.ToLower(strings.TrimSpace(id))] = strings.TrimSpace(name)
	}
	if rowsErr := subjectRows.Err(); rowsErr != nil {
		subjectRows.Close()
		return nil, 0, fmt.Errorf("failed to iterate global subjects: %w", rowsErr)
	}
	subjectRows.Close()

	whereClause := "WHERE u.role = 'teacher'"
	// Note: No t.school_id filter — the DB search_path (set by TenantMiddleware) already
	// scopes all tables to the tenant schema. Filtering by t.school_id is redundant and
	// breaks for rows where it is NULL (e.g. teachers created via user management before
	// the bug was fixed). Base from users so teachers without profile rows also appear.
	if search != "" {
		whereClause += fmt.Sprintf(" AND (u.full_name ILIKE $%d OR u.email ILIKE $%d OR t.employee_id ILIKE $%d)", argNum, argNum+1, argNum+2)
		args = append(args, "%"+search+"%", "%"+search+"%", "%"+search+"%")
		argNum += 3
	}
	if status != "" && status != "all" {
		whereClause += " AND t.status = $" + strconv.Itoa(argNum)
		args = append(args, status)
		argNum++
	}

	countQuery := fmt.Sprintf(`
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		LEFT JOIN teachers t ON t.user_id = u.id
		LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id
		LEFT JOIN classes c ON ta.class_id = c.id
		%s
	`, whereClause)
	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count teachers: %w", err)
	}

	query := fmt.Sprintf(`
		SELECT
			COALESCE(t.id, u.id)                             AS id,
			u.id                                             AS user_id,
			u.full_name, u.email, u.phone, u.profile_picture_url,
			COALESCE(t.employee_id, 'N/A')                   AS employee_id,
			''::text                                          AS department,
			t.designation, t.qualifications,
			COALESCE(t.subjects_taught, '{}'::text[]),
			t.experience_years, t.hire_date, t.salary, t.rating, t.status,
			COALESCE(array_remove(array_agg(DISTINCT c.name), NULL), '{}') AS classes
		FROM users u
		LEFT JOIN teachers t ON t.user_id = u.id
		LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id
		LEFT JOIN classes c ON ta.class_id = c.id
		%s
		GROUP BY COALESCE(t.id, u.id), u.id, u.full_name, u.email, u.phone, u.profile_picture_url,
		         t.employee_id, t.designation, t.qualifications, t.subjects_taught,
		         t.experience_years, t.hire_date, t.salary, t.rating, t.status
		ORDER BY u.full_name ASC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to fetch teachers: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var t TeacherDetail
		var phone, avatar *string
		var designation *string
		var qualifications []string
		var subjectValues []string
		var experience *int
		var hireDate *time.Time
		var salary *float64
		var rating *float64
		var status *string
		var classes []string
		if err := rows.Scan(
			&t.ID, &t.UserID, &t.Name, &t.Email, &phone, &avatar,
			&t.EmployeeID, &t.Department, &designation, &qualifications, &subjectValues,
			&experience, &hireDate, &salary, &rating, &status, &classes,
		); err != nil {
			return nil, 0, fmt.Errorf("failed to scan teacher: %w", err)
		}
		t.Phone = phone
		t.Avatar = avatar
		t.Designation = designation
		t.Qualifications = qualifications
		t.SubjectsTaught, t.SubjectIDs = mapTeacherSubjectValues(subjectValues, globalSubjectNameByID)
		t.Classes = classes
		t.Experience = experience
		t.JoinDate = hireDate
		t.Salary = salary
		t.Rating = rating
		t.Status = status
		teachers = append(teachers, t)
	}

	return teachers, total, nil
}

// GetTeacherByUserID retrieves a single teacher detail by user_id (tenant-scoped)
func (r *Repository) GetTeacherByUserID(ctx context.Context, userID uuid.UUID) (*TeacherDetail, error) {
	globalSubjectNameByID := map[string]string{}
	subjectRows, err := r.db.Query(ctx, `SELECT id::text, name FROM public.global_subjects`)
	if err == nil {
		for subjectRows.Next() {
			var id, name string
			if scanErr := subjectRows.Scan(&id, &name); scanErr == nil {
				globalSubjectNameByID[strings.ToLower(strings.TrimSpace(id))] = strings.TrimSpace(name)
			}
		}
		subjectRows.Close()
	}

	query := `
		SELECT
			COALESCE(t.id, u.id)                             AS id,
			u.id                                             AS user_id,
			u.full_name, u.email, u.phone, u.profile_picture_url,
			COALESCE(t.employee_id, 'N/A')                   AS employee_id,
			''::text                                          AS department,
			t.designation, t.qualifications,
			COALESCE(t.subjects_taught, '{}'::text[]),
			t.experience_years, t.hire_date, t.salary, t.rating, t.status,
			COALESCE(array_remove(array_agg(DISTINCT c.name), NULL), '{}') AS classes
		FROM users u
		LEFT JOIN teachers t ON t.user_id = u.id
		LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id
		LEFT JOIN classes c ON ta.class_id = c.id
		WHERE u.role = 'teacher' AND u.id = $1
		GROUP BY COALESCE(t.id, u.id), u.id, u.full_name, u.email, u.phone, u.profile_picture_url,
		         t.employee_id, t.designation, t.qualifications, t.subjects_taught,
		         t.experience_years, t.hire_date, t.salary, t.rating, t.status
	`

	var td TeacherDetail
	var phone, avatar *string
	var designation *string
	var qualifications []string
	var subjectValues []string
	var experience *int
	var hireDate *time.Time
	var salary *float64
	var rating *float64
	var status *string
	var classes []string

	err = r.db.QueryRow(ctx, query, userID).Scan(
		&td.ID, &td.UserID, &td.Name, &td.Email, &phone, &avatar,
		&td.EmployeeID, &td.Department, &designation, &qualifications, &subjectValues,
		&experience, &hireDate, &salary, &rating, &status, &classes,
	)
	if err != nil {
		return nil, fmt.Errorf("teacher not found: %w", err)
	}
	td.Phone = phone
	td.Avatar = avatar
	td.Designation = designation
	td.Qualifications = qualifications
	td.SubjectsTaught, td.SubjectIDs = mapTeacherSubjectValues(subjectValues, globalSubjectNameByID)
	td.Classes = classes
	td.Experience = experience
	td.JoinDate = hireDate
	td.Salary = salary
	td.Rating = rating
	td.Status = status
	return &td, nil
}

// CreateTeacherDetail creates a user + teacher profile (tenant scoped)
func (r *Repository) CreateTeacherDetail(ctx context.Context, req *CreateTeacherDetailRequest, schoolID uuid.UUID) (uuid.UUID, error) {
	// Create user in tenant users table
	userReq := &CreateUserRequest{
		Email:    strings.ToLower(req.Email),
		Password: req.Password,
		FullName: req.FullName,
		Role:     "teacher",
		Phone:    req.Phone,
		SchoolID: schoolID.String(),
	}
	userID, err := r.CreateUser(ctx, userReq)
	if err != nil {
		return uuid.Nil, err
	}

	// Ensure tenant users table has the user (for tenant-scoped joins)
	_ = r.db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, role, full_name, phone, school_id, email_verified, is_active, created_at, updated_at)
		SELECT id, email, password_hash, role, full_name, phone, school_id, email_verified, is_active, created_at, updated_at
		FROM users
		WHERE id = $1
		ON CONFLICT (id) DO UPDATE SET
			full_name = EXCLUDED.full_name,
			phone = EXCLUDED.phone,
			updated_at = EXCLUDED.updated_at
	`, userID)

	var hireDate *time.Time
	if req.HireDate != "" {
		if t, err := time.Parse("2006-01-02", req.HireDate); err == nil {
			hireDate = &t
		}
	}

	status := req.Status
	if status == "" {
		status = "active"
	}

	query := `
		INSERT INTO teachers (school_id, user_id, employee_id, designation, qualifications, subjects_taught,
			experience_years, hire_date, salary, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	normalizedSubjects := normalizeTeacherSubjects(req.SubjectsTaught)
	err = r.db.Exec(ctx, query,
		schoolID, userID, req.EmployeeID, req.Designation, req.Qualifications, normalizedSubjects,
		req.Experience, hireDate, req.Salary, status,
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to create teacher details: %w", err)
	}

	return userID, nil
}

// UpdateTeacherDetail updates a teacher profile (tenant scoped)
func (r *Repository) UpdateTeacherDetail(ctx context.Context, teacherID uuid.UUID, req *UpdateTeacherDetailRequest) error {
	// Get user_id
	var userID uuid.UUID
	if err := r.db.QueryRow(ctx, "SELECT user_id FROM teachers WHERE id = $1", teacherID).Scan(&userID); err != nil {
		return fmt.Errorf("teacher not found: %w", err)
	}

	// Update user
	userQuery := `
		UPDATE users
		SET full_name = COALESCE(NULLIF($2, ''), full_name),
		    phone = COALESCE(NULLIF($3, ''), phone),
		    profile_picture_url = COALESCE(NULLIF($4, ''), profile_picture_url),
		    updated_at = NOW()
		WHERE id = $1
	`
	if err := r.db.Exec(ctx, userQuery, userID, req.FullName, req.Phone, req.Avatar); err != nil {
		return fmt.Errorf("failed to update user details: %w", err)
	}

	var hireDate *time.Time
	if req.HireDate != "" {
		if t, err := time.Parse("2006-01-02", req.HireDate); err == nil {
			hireDate = &t
		}
	}

	normalizedSubjects := normalizeTeacherSubjects(req.SubjectsTaught)
	teacherQuery := `
		UPDATE teachers
		SET employee_id = COALESCE(NULLIF($2, ''), employee_id),
		    designation = COALESCE(NULLIF($3, ''), designation),
		    qualifications = COALESCE($4, qualifications),
		    subjects_taught = COALESCE($5, subjects_taught),
		    experience_years = COALESCE(NULLIF($6, 0), experience_years),
		    hire_date = COALESCE($7, hire_date),
		    salary = COALESCE(NULLIF($8, 0), salary),
		    status = COALESCE(NULLIF($9, ''), status),
		    updated_at = NOW()
		WHERE id = $1
	`
	if err := r.db.Exec(ctx, teacherQuery, teacherID, req.EmployeeID, req.Designation, req.Qualifications,
		normalizedSubjects, req.Experience, hireDate, req.Salary, req.Status); err != nil {
		return fmt.Errorf("failed to update teacher details: %w", err)
	}

	return nil
}

// DeleteTeacherDetail deletes a teacher profile and user (tenant scoped)
func (r *Repository) DeleteTeacherDetail(ctx context.Context, teacherID uuid.UUID) error {
	// Get user_id
	var userID uuid.UUID
	if err := r.db.QueryRow(ctx, "SELECT user_id FROM teachers WHERE id = $1", teacherID).Scan(&userID); err != nil {
		return fmt.Errorf("teacher not found: %w", err)
	}

	if err := r.db.Exec(ctx, "DELETE FROM teachers WHERE id = $1", teacherID); err != nil {
		return fmt.Errorf("failed to delete teacher details: %w", err)
	}

	if err := r.db.Exec(ctx, "DELETE FROM users WHERE id = $1", userID); err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}

	return nil
}

// GetFeeStructures retrieves all fee structures
func (r *Repository) GetFeeStructures(ctx context.Context, academicYear string) ([]FeeStructure, error) {
	query := `
		SELECT id, name, description, applicable_grades, academic_year, created_at, updated_at
		FROM fee_structures
		WHERE ($1 = '' OR academic_year = $1)
		ORDER BY created_at DESC
	`

	rows, err := r.db.Query(ctx, query, academicYear)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var structures []FeeStructure
	for rows.Next() {
		var fs FeeStructure
		err := rows.Scan(&fs.ID, &fs.Name, &fs.Description, &fs.ApplicableGrades, &fs.AcademicYear, &fs.CreatedAt, &fs.UpdatedAt)
		if err != nil {
			return nil, err
		}
		structures = append(structures, fs)
	}

	return structures, nil
}

// CreateFeeStructure creates a fee structure with items
func (r *Repository) CreateFeeStructure(ctx context.Context, req *CreateFeeStructureRequest) (uuid.UUID, error) {
	// Create fee structure
	query := `
		INSERT INTO fee_structures (name, description, applicable_grades, academic_year)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`
	var structureID uuid.UUID
	err := r.db.QueryRow(ctx, query, req.Name, req.Description, req.ApplicableGrades, req.AcademicYear).Scan(&structureID)
	if err != nil {
		return uuid.Nil, err
	}

	// Create fee items
	for _, item := range req.Items {
		frequency := item.Frequency
		if frequency == "" {
			frequency = "monthly"
		}
		dueDay := item.DueDay
		if dueDay == 0 {
			dueDay = 10
		}

		itemQuery := `
			INSERT INTO fee_items (fee_structure_id, name, amount, frequency, is_optional, due_day)
			VALUES ($1, $2, $3, $4, $5, $6)
		`
		if err := r.db.Exec(ctx, itemQuery, structureID, item.Name, item.Amount, frequency, item.IsOptional, dueDay); err != nil {
			return uuid.Nil, err
		}
	}

	return structureID, nil
}

// GetFeeDemands retrieves fee demands with payment summary
func (r *Repository) GetFeeDemands(ctx context.Context, schoolID uuid.UUID, search string, status string, academicYear string, limit int, offset int) ([]FeeDemand, int, error) {
	args := []interface{}{schoolID}
	argNum := 2
	whereClause := "WHERE sf.school_id = $1"

	if search != "" {
		whereClause += fmt.Sprintf(" AND (u.full_name ILIKE $%d OR s.admission_number ILIKE $%d OR COALESCE(fdp.name, sf.purpose, '') ILIKE $%d)", argNum, argNum, argNum)
		args = append(args, "%"+search+"%")
		argNum++
	}
	if strings.TrimSpace(academicYear) != "" {
		normalizedAcademicYear := strings.TrimSpace(academicYear)
		if normalizedAcademicYear == r.resolveConfiguredAcademicYear(ctx, schoolID) {
			// Backward compatibility: legacy rows may have empty academic_year, treat them as current year.
			whereClause += fmt.Sprintf(" AND (sf.academic_year = $%d OR sf.academic_year IS NULL OR sf.academic_year = '')", argNum)
		} else {
			whereClause += fmt.Sprintf(" AND sf.academic_year = $%d", argNum)
		}
		args = append(args, academicYear)
		argNum++
	}

	statusClause := ""
	if status != "" && status != "all" {
		statusClause = fmt.Sprintf(` AND (
			CASE
				WHEN COALESCE(sf.paid_amount, 0) >= sf.amount - COALESCE(sf.waiver_amount, 0) THEN 'paid'
				WHEN COALESCE(sf.paid_amount, 0) > 0 THEN 'partial'
				WHEN sf.due_date IS NOT NULL AND sf.due_date < CURRENT_DATE THEN 'overdue'
				ELSE 'pending'
			END
		) = $%d`, argNum)
		args = append(args, status)
		argNum++
	}

	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM student_fees sf
		JOIN students s ON s.id = sf.student_id
		JOIN users u ON u.id = s.user_id
		LEFT JOIN fee_demand_purposes fdp ON fdp.id = sf.purpose_id
		%s%s
	`, whereClause, statusClause)

	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count fee demands: %w", err)
	}

	query := fmt.Sprintf(`
		SELECT sf.id, sf.student_id, u.full_name, s.admission_number,
		       COALESCE(c.name, '') as class_name,
		       COALESCE(sf.academic_year, '') as academic_year,
		       sf.purpose_id,
		       COALESCE(fdp.name, sf.purpose, '') as purpose,
		       sf.amount, COALESCE(sf.paid_amount, 0) as paid_amount,
		       sf.due_date,
		       (SELECT MAX(p.payment_date) FROM payments p WHERE p.student_fee_id = sf.id) as last_payment_date,
		       CASE
		           WHEN COALESCE(sf.paid_amount, 0) >= sf.amount - COALESCE(sf.waiver_amount, 0) THEN 'paid'
		           WHEN COALESCE(sf.paid_amount, 0) > 0 THEN 'partial'
		           WHEN sf.due_date IS NOT NULL AND sf.due_date < CURRENT_DATE THEN 'overdue'
		           ELSE 'pending'
		       END as status,
		       sf.created_at, sf.updated_at
		FROM student_fees sf
		JOIN students s ON s.id = sf.student_id
		JOIN users u ON u.id = s.user_id
		LEFT JOIN classes c ON c.id = s.class_id
		LEFT JOIN fee_demand_purposes fdp ON fdp.id = sf.purpose_id
		%s%s
		ORDER BY sf.created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, statusClause, argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get fee demands: %w", err)
	}
	defer rows.Close()

	var demands []FeeDemand
	for rows.Next() {
		var d FeeDemand
		err := rows.Scan(
			&d.ID, &d.StudentID, &d.StudentName, &d.AdmissionNumber,
			&d.ClassName, &d.AcademicYear, &d.PurposeID, &d.Purpose, &d.Amount, &d.PaidAmount,
			&d.DueDate, &d.LastPaymentDate, &d.Status, &d.CreatedAt, &d.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		demands = append(demands, d)
	}

	return demands, total, nil
}

func currentAcademicYear() string {
	now := time.Now()
	year := now.Year()
	if now.Month() < time.April {
		return fmt.Sprintf("%d-%d", year-1, year)
	}
	return fmt.Sprintf("%d-%d", year, year+1)
}

func (r *Repository) resolveConfiguredAcademicYear(ctx context.Context, schoolID uuid.UUID) string {
	var academicYear string
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(g.value, '')
		FROM schools s
		LEFT JOIN public.settings_global g
		  ON g.key = 'global_academic_year'
		WHERE s.id = $1
		LIMIT 1
	`, schoolID).Scan(&academicYear)
	if err == nil {
		trimmed := strings.TrimSpace(academicYear)
		if trimmed != "" {
			return trimmed
		}
	}

	return currentAcademicYear()
}

// CreateFeeDemand creates a fee demand for a student
func (r *Repository) CreateFeeDemand(ctx context.Context, schoolID uuid.UUID, req *CreateFeeDemandRequest, createdBy *uuid.UUID) (uuid.UUID, error) {
	studentID, err := uuid.Parse(req.StudentID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid student_id")
	}

	var purposeID *uuid.UUID
	purposeName := strings.TrimSpace(req.Purpose)
	if req.PurposeID != "" {
		parsedPurposeID, parseErr := uuid.Parse(req.PurposeID)
		if parseErr != nil {
			return uuid.Nil, fmt.Errorf("invalid purpose_id")
		}
		var resolvedName string
		if err := r.db.QueryRow(ctx, `SELECT name FROM fee_demand_purposes WHERE id = $1`, parsedPurposeID).Scan(&resolvedName); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return uuid.Nil, fmt.Errorf("fee demand purpose not found")
			}
			return uuid.Nil, fmt.Errorf("failed to resolve fee demand purpose: %w", err)
		}
		purposeID = &parsedPurposeID
		purposeName = resolvedName
	}

	if purposeName == "" {
		return uuid.Nil, fmt.Errorf("purpose is required")
	}

	var dueDate *time.Time
	if req.DueDate != "" {
		if t, err := time.Parse("2006-01-02", req.DueDate); err == nil {
			dueDate = &t
		}
	}

	query := `
		INSERT INTO student_fees (school_id, student_id, amount, paid_amount, status, due_date, purpose_id, purpose, academic_year, created_by, updated_by)
		VALUES ($1, $2, $3, 0, 'pending', $4, $5, $6, $7, $8, $9)
		RETURNING id
	`

	var demandID uuid.UUID
	err = r.db.QueryRow(ctx, query, schoolID, studentID, req.Amount, dueDate, purposeID, purposeName, req.AcademicYear, createdBy, createdBy).Scan(&demandID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to create fee demand: %w", err)
	}

	return demandID, nil
}

func (r *Repository) ListFeeDemandPurposes(ctx context.Context) ([]FeeDemandPurpose, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, name, created_at, updated_at
		FROM fee_demand_purposes
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list fee demand purposes: %w", err)
	}
	defer rows.Close()

	items := make([]FeeDemandPurpose, 0)
	for rows.Next() {
		var item FeeDemandPurpose
		if scanErr := rows.Scan(&item.ID, &item.Name, &item.CreatedAt, &item.UpdatedAt); scanErr != nil {
			return nil, fmt.Errorf("failed to scan fee demand purpose: %w", scanErr)
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) CreateFeeDemandPurpose(ctx context.Context, name string) (uuid.UUID, error) {
	query := `
		INSERT INTO fee_demand_purposes (name)
		VALUES ($1)
		RETURNING id
	`
	var id uuid.UUID
	if err := r.db.QueryRow(ctx, query, name).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("failed to create fee demand purpose: %w", err)
	}
	return id, nil
}

func (r *Repository) UpdateFeeDemandPurpose(ctx context.Context, id uuid.UUID, name string) error {
	result, err := r.db.ExecResult(ctx, `
		UPDATE fee_demand_purposes
		SET name = $2, updated_at = NOW()
		WHERE id = $1
	`, id, name)
	if err != nil {
		return fmt.Errorf("failed to update fee demand purpose: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrFeePurposeNotFound
	}
	return nil
}

func (r *Repository) DeleteFeeDemandPurpose(ctx context.Context, id uuid.UUID) error {
	result, err := r.db.ExecResult(ctx, `DELETE FROM fee_demand_purposes WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete fee demand purpose: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrFeePurposeNotFound
	}
	return nil
}

func (r *Repository) ListAssessments(ctx context.Context, schoolID uuid.UUID, academicYear string) ([]Assessment, error) {
	// Build id→name lookup for class labels; also keep grade for backward compat rendering.
	classNameByID := map[uuid.UUID]string{}
	classGradeByID := map[uuid.UUID]*int{}
	classRows, classErr := r.db.Query(ctx, `
		SELECT id, name, grade
		FROM classes
		WHERE school_id = $1
	`, schoolID)
	if classErr == nil {
		defer classRows.Close()
		for classRows.Next() {
			var cid uuid.UUID
			var cname string
			var cgrade *int
			if scanErr := classRows.Scan(&cid, &cname, &cgrade); scanErr != nil {
				continue
			}
			classNameByID[cid] = strings.TrimSpace(cname)
			classGradeByID[cid] = cgrade
		}
	}
	_ = classGradeByID // kept for future use

	rows, err := r.db.Query(ctx, `
		SELECT
			a.id,
			a.school_id,
			COALESCE(a.class_grades, '{}'::INT[]),
			COALESCE(a.class_ids, '{}'::UUID[]),
			a.name,
			COALESCE(NULLIF(a.assessment_type, ''), NULLIF(a.type, ''), 'Assessment') AS assessment_type,
			COALESCE(a.scheduled_date, a.date) AS scheduled_date,
			a.academic_year,
			COALESCE(a.max_marks, 0) AS total_marks,
			a.created_by,
			a.created_at,
			a.updated_at
		FROM assessments a
		WHERE a.school_id = $1
		  AND ($2 = '' OR a.academic_year = $2)
		ORDER BY COALESCE(a.scheduled_date, a.date) DESC NULLS LAST, a.created_at DESC
	`, schoolID, strings.TrimSpace(academicYear))
	if err != nil {
		return nil, fmt.Errorf("failed to list assessments: %w", err)
	}
	defer rows.Close()

	assessments := make([]Assessment, 0, 32)
	assessmentIDs := make([]uuid.UUID, 0, 32)
	for rows.Next() {
		var item Assessment
		var classGrades []int32
		var classIDs []uuid.UUID
		if err := rows.Scan(
			&item.ID,
			&item.SchoolID,
			&classGrades,
			&classIDs,
			&item.Name,
			&item.AssessmentType,
			&item.ScheduledDate,
			&item.AcademicYear,
			&item.TotalMarks,
			&item.CreatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan assessment: %w", err)
		}

		item.ClassGrades = make([]int, 0, len(classGrades))
		for _, grade := range classGrades {
			item.ClassGrades = append(item.ClassGrades, int(grade))
		}
		// Populate ClassIDs and derive labels from the class UUID → name lookup.
		classIDStrs := make([]string, 0, len(classIDs))
		labels := make([]string, 0, len(classIDs))
		seenNames := map[string]struct{}{}
		for _, cid := range classIDs {
			classIDStrs = append(classIDStrs, cid.String())
			name := classNameByID[cid]
			if name == "" {
				name = cid.String()
			}
			if _, seen := seenNames[name]; !seen {
				labels = append(labels, name)
				seenNames[name] = struct{}{}
			}
		}
		item.ClassIDs = classIDStrs
		item.ClassLabels = labels
		item.ClassName = strings.Join(labels, ", ")
		assessments = append(assessments, item)
		assessmentIDs = append(assessmentIDs, item.ID)
	}
	if len(assessmentIDs) == 0 {
		return assessments, nil
	}

	subjectRows, err := r.db.Query(ctx, `
		SELECT asm.id, asm.assessment_id, asm.subject_id, COALESCE(s.name, ''), COALESCE(asm.subject_label, ''), asm.max_marks
		FROM assessment_subject_marks asm
		LEFT JOIN subjects s ON s.id = asm.subject_id
		WHERE asm.assessment_id = ANY($1)
		ORDER BY asm.created_at ASC, asm.id ASC
	`, assessmentIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to list assessment subject marks: %w", err)
	}
	defer subjectRows.Close()

	byAssessment := make(map[uuid.UUID][]AssessmentSubjectMark, len(assessmentIDs))
	for subjectRows.Next() {
		var mark AssessmentSubjectMark
		if err := subjectRows.Scan(
			&mark.ID,
			&mark.AssessmentID,
			&mark.SubjectID,
			&mark.SubjectName,
			&mark.SubjectLabel,
			&mark.MaxMarks,
		); err != nil {
			return nil, fmt.Errorf("failed to scan assessment subject mark: %w", err)
		}
		byAssessment[mark.AssessmentID] = append(byAssessment[mark.AssessmentID], mark)
	}

	subjectMarkIDs := make([]uuid.UUID, 0, 64)
	for assessmentID := range byAssessment {
		items := byAssessment[assessmentID]
		for i := range items {
			subjectMarkIDs = append(subjectMarkIDs, items[i].ID)
		}
		byAssessment[assessmentID] = items
	}

	if len(subjectMarkIDs) > 0 {
		breakdownRows, breakdownErr := r.db.Query(ctx, `
			SELECT id, assessment_subject_mark_id, title, marks
			FROM assessment_mark_breakdowns
			WHERE assessment_subject_mark_id = ANY($1)
			ORDER BY created_at ASC, id ASC
		`, subjectMarkIDs)
		if breakdownErr != nil {
			return nil, fmt.Errorf("failed to list assessment mark breakdowns: %w", breakdownErr)
		}
		defer breakdownRows.Close()

		breakdownBySubjectMark := map[uuid.UUID][]AssessmentMarkBreakdown{}
		for breakdownRows.Next() {
			var breakdown AssessmentMarkBreakdown
			if err := breakdownRows.Scan(
				&breakdown.ID,
				&breakdown.AssessmentSubjectMarkID,
				&breakdown.Title,
				&breakdown.Marks,
			); err != nil {
				return nil, fmt.Errorf("failed to scan assessment mark breakdown: %w", err)
			}
			breakdownBySubjectMark[breakdown.AssessmentSubjectMarkID] = append(
				breakdownBySubjectMark[breakdown.AssessmentSubjectMarkID],
				breakdown,
			)
		}

		for i := range assessments {
			for j := range byAssessment[assessments[i].ID] {
				subjectMarkID := byAssessment[assessments[i].ID][j].ID
				byAssessment[assessments[i].ID][j].Breakdowns = breakdownBySubjectMark[subjectMarkID]
			}
		}
	}

	for i := range assessments {
		assessments[i].SubjectMarks = byAssessment[assessments[i].ID]
	}
	return assessments, nil
}

func (r *Repository) CreateAssessment(ctx context.Context, schoolID uuid.UUID, createdBy *uuid.UUID, req *CreateAssessmentRequest) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	// Parse class UUIDs sent by the frontend.
	classUUIDs := make([]uuid.UUID, 0, len(req.ClassIDs))
	for _, idStr := range req.ClassIDs {
		parsed, parseErr := uuid.Parse(strings.TrimSpace(idStr))
		if parseErr != nil {
			return uuid.Nil, ErrInvalidInput
		}
		classUUIDs = append(classUUIDs, parsed)
	}
	if len(classUUIDs) == 0 {
		return uuid.Nil, ErrInvalidInput
	}
	// Derive class_grades from class UUID lookup for exam-timetable backward compat.
	gradeSet := map[int]struct{}{}
	gradeRows, gradeErr := r.db.Query(ctx, `SELECT grade FROM classes WHERE id = ANY($1) AND school_id = $2`, classUUIDs, schoolID)
	if gradeErr == nil {
		defer gradeRows.Close()
		for gradeRows.Next() {
			var g *int
			if scanErr := gradeRows.Scan(&g); scanErr == nil && g != nil {
				gradeSet[*g] = struct{}{}
			}
		}
	}
	classGradesSlice := make([]int, 0, len(gradeSet))
	for g := range gradeSet {
		classGradesSlice = append(classGradesSlice, g)
	}
	classGrades := sanitizeAssessmentClassGrades(classGradesSlice)
	// classGrades may be empty for fully custom classes with no numeric grade — that is fine.

	var scheduledDate *time.Time
	if trimmed := strings.TrimSpace(req.ScheduledDate); trimmed != "" {
		parsedDate, parseErr := time.Parse("2006-01-02", trimmed)
		if parseErr != nil {
			return uuid.Nil, ErrInvalidInput
		}
		scheduledDate = &parsedDate
	}

	totalMarks := 0.0
	for _, item := range req.SubjectMarks {
		totalMarks += item.TotalMarks
		var breakdownSum float64
		for _, breakdown := range item.Breakdowns {
			breakdownSum += breakdown.Marks
		}
		if breakdownSum > item.TotalMarks {
			return uuid.Nil, ErrInvalidInput
		}
	}

	var assessmentID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO assessments (
			school_id, class_id, class_grades, class_ids, name, assessment_type, type, max_marks, scheduled_date, date,
			academic_year, description, created_by, created_at, updated_at
		)
		VALUES ($1, NULL, $2, $3, $4, $5, $5, $6, $7, $7, $8, NULL, $9, NOW(), NOW())
		RETURNING id
	`, schoolID, classGrades, classUUIDs, strings.TrimSpace(req.Name), strings.TrimSpace(req.AssessmentType), totalMarks, scheduledDate, strings.TrimSpace(req.AcademicYear), createdBy).Scan(&assessmentID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to create assessment: %w", err)
	}

	for index, mark := range req.SubjectMarks {
		subjectLabel := fmt.Sprintf("Subject %d", index+1)
		var subjectMarkID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO assessment_subject_marks (assessment_id, subject_id, subject_label, max_marks, created_at, updated_at)
			VALUES ($1, NULL, $2, $3, NOW(), NOW())
			RETURNING id
		`, assessmentID, subjectLabel, mark.TotalMarks).Scan(&subjectMarkID); err != nil {
			return uuid.Nil, fmt.Errorf("failed to create assessment subject mark: %w", err)
		}
		for _, breakdown := range mark.Breakdowns {
			if _, err := tx.Exec(ctx, `
				INSERT INTO assessment_mark_breakdowns (assessment_subject_mark_id, title, marks, created_at, updated_at)
				VALUES ($1, $2, $3, NOW(), NOW())
			`, subjectMarkID, strings.TrimSpace(breakdown.Title), breakdown.Marks); err != nil {
				return uuid.Nil, fmt.Errorf("failed to create assessment mark breakdown: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return assessmentID, nil
}

func (r *Repository) UpdateAssessment(ctx context.Context, schoolID uuid.UUID, assessmentID uuid.UUID, req *UpdateAssessmentRequest) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Parse class UUIDs sent by the frontend.
	classUUIDs := make([]uuid.UUID, 0, len(req.ClassIDs))
	for _, idStr := range req.ClassIDs {
		parsed, parseErr := uuid.Parse(strings.TrimSpace(idStr))
		if parseErr != nil {
			return ErrInvalidInput
		}
		classUUIDs = append(classUUIDs, parsed)
	}
	if len(classUUIDs) == 0 {
		return ErrInvalidInput
	}
	// Derive class_grades from class UUID lookup for exam-timetable backward compat.
	gradeSet := map[int]struct{}{}
	gradeRows, gradeErr := r.db.Query(ctx, `SELECT grade FROM classes WHERE id = ANY($1) AND school_id = $2`, classUUIDs, schoolID)
	if gradeErr == nil {
		defer gradeRows.Close()
		for gradeRows.Next() {
			var g *int
			if scanErr := gradeRows.Scan(&g); scanErr == nil && g != nil {
				gradeSet[*g] = struct{}{}
			}
		}
	}
	classGradesSlice := make([]int, 0, len(gradeSet))
	for g := range gradeSet {
		classGradesSlice = append(classGradesSlice, g)
	}
	classGrades := sanitizeAssessmentClassGrades(classGradesSlice)
	// classGrades may be empty for fully custom classes with no numeric grade — that is fine.

	var scheduledDate *time.Time
	if trimmed := strings.TrimSpace(req.ScheduledDate); trimmed != "" {
		parsedDate, parseErr := time.Parse("2006-01-02", trimmed)
		if parseErr != nil {
			return ErrInvalidInput
		}
		scheduledDate = &parsedDate
	}

	totalMarks := 0.0
	for _, item := range req.SubjectMarks {
		totalMarks += item.TotalMarks
		var breakdownSum float64
		for _, breakdown := range item.Breakdowns {
			breakdownSum += breakdown.Marks
		}
		if breakdownSum > item.TotalMarks {
			return ErrInvalidInput
		}
	}

	tag, err := tx.Exec(ctx, `
		UPDATE assessments
		SET class_id = NULL,
		    class_grades = $3,
		    class_ids = $4,
		    name = $5,
		    assessment_type = $6,
		    type = $6,
		    max_marks = $7,
		    scheduled_date = $8,
		    date = $8,
		    academic_year = $9,
		    description = NULL,
		    updated_at = NOW()
		WHERE id = $1 AND school_id = $2
	`, assessmentID, schoolID, classGrades, classUUIDs, strings.TrimSpace(req.Name), strings.TrimSpace(req.AssessmentType), totalMarks, scheduledDate, strings.TrimSpace(req.AcademicYear))
	if err != nil {
		return fmt.Errorf("failed to update assessment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrAssessmentNotFound
	}

	if _, err := tx.Exec(ctx, `DELETE FROM assessment_subject_marks WHERE assessment_id = $1`, assessmentID); err != nil {
		return fmt.Errorf("failed to clear assessment subject marks: %w", err)
	}

	for index, mark := range req.SubjectMarks {
		subjectLabel := fmt.Sprintf("Subject %d", index+1)
		var subjectMarkID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO assessment_subject_marks (assessment_id, subject_id, subject_label, max_marks, created_at, updated_at)
			VALUES ($1, NULL, $2, $3, NOW(), NOW())
			RETURNING id
		`, assessmentID, subjectLabel, mark.TotalMarks).Scan(&subjectMarkID); err != nil {
			return fmt.Errorf("failed to update assessment subject mark: %w", err)
		}
		for _, breakdown := range mark.Breakdowns {
			if _, err := tx.Exec(ctx, `
				INSERT INTO assessment_mark_breakdowns (assessment_subject_mark_id, title, marks, created_at, updated_at)
				VALUES ($1, $2, $3, NOW(), NOW())
			`, subjectMarkID, strings.TrimSpace(breakdown.Title), breakdown.Marks); err != nil {
				return fmt.Errorf("failed to update assessment mark breakdown: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (r *Repository) AssessmentHasDependentReportData(ctx context.Context, schoolID, assessmentID uuid.UUID) (bool, error) {
	var hasAssessment bool
	var hasGrades bool
	if err := r.db.QueryRow(ctx, `
		SELECT
			EXISTS (
				SELECT 1
				FROM assessments
				WHERE id = $1 AND school_id = $2
			) AS has_assessment,
			EXISTS (
				SELECT 1
				FROM student_grades
				WHERE assessment_id = $1
			) AS has_grades
	`, assessmentID, schoolID).Scan(&hasAssessment, &hasGrades); err != nil {
		return false, fmt.Errorf("failed to inspect assessment dependencies: %w", err)
	}
	if !hasAssessment {
		return false, ErrAssessmentNotFound
	}
	return hasGrades, nil
}

func (r *Repository) DeleteAssessment(ctx context.Context, schoolID uuid.UUID, assessmentID uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM assessment_subject_marks WHERE assessment_id = $1`, assessmentID); err != nil {
		return fmt.Errorf("failed to delete assessment subject marks: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM assessment_exam_timetable
		WHERE school_id = $1 AND assessment_id = $2
	`, schoolID, assessmentID); err != nil {
		return fmt.Errorf("failed to delete assessment exam timetable rows: %w", err)
	}

	deleteTag, err := tx.Exec(ctx, `DELETE FROM assessments WHERE id = $1 AND school_id = $2`, assessmentID, schoolID)
	if err != nil {
		return fmt.Errorf("failed to delete assessment: %w", err)
	}
	if deleteTag.RowsAffected() == 0 {
		return ErrAssessmentNotFound
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM events
		WHERE school_id = $1
		  AND type = 'exam'
		  AND source_assessment_id = $2
	`, schoolID, assessmentID); err != nil {
		return fmt.Errorf("failed to delete assessment exam events: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (r *Repository) GetAssessmentExamTimetableOptions(ctx context.Context, schoolID, assessmentID uuid.UUID, classGrade int) (string, []ExamTimetableSubjectOption, error) {
	var assessmentName string
	if err := r.db.QueryRow(ctx, `
		SELECT name
		FROM assessments
		WHERE id = $1
		  AND school_id = $2
		  AND $3 = ANY(COALESCE(class_grades, '{}'::INT[]))
	`, assessmentID, schoolID, classGrade).Scan(&assessmentName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, ErrAssessmentNotFound
		}
		return "", nil, fmt.Errorf("failed to validate assessment class grade: %w", err)
	}

	var classID uuid.UUID
	var className string
	if err := r.db.QueryRow(ctx, `
		SELECT
			c.id,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name
		FROM classes c
		WHERE c.school_id = $1
		  AND c.grade = $2
		ORDER BY c.section NULLS FIRST, c.name
		LIMIT 1
	`, schoolID, classGrade).Scan(&classID, &className); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return assessmentName, nil, nil
		}
		return "", nil, fmt.Errorf("failed to resolve class for grade: %w", err)
	}

	subjects, err := r.GetSubjectsByClassID(ctx, classID)
	if err != nil {
		return "", nil, err
	}

	options := make([]ExamTimetableSubjectOption, 0, len(subjects))
	for _, subject := range subjects {
		options = append(options, ExamTimetableSubjectOption{
			ClassID:   classID,
			SubjectID: subject.ID,
			Name:      subject.Name,
			Code:      subject.Code,
		})
	}
	return className, options, nil
}

func (r *Repository) ListAssessmentExamTimetable(ctx context.Context, schoolID, assessmentID uuid.UUID, classGrade int) ([]AssessmentExamTimetableItem, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			aet.id,
			aet.subject_id,
			COALESCE(s.name, '') AS subject_name,
			aet.exam_date
		FROM assessment_exam_timetable aet
		LEFT JOIN subjects s ON s.id = aet.subject_id
		WHERE aet.school_id = $1
		  AND aet.assessment_id = $2
		  AND aet.class_grade = $3
		ORDER BY s.name ASC, aet.exam_date ASC
	`, schoolID, assessmentID, classGrade)
	if err != nil {
		return nil, fmt.Errorf("failed to list assessment exam timetable: %w", err)
	}
	defer rows.Close()

	items := make([]AssessmentExamTimetableItem, 0, 32)
	for rows.Next() {
		var item AssessmentExamTimetableItem
		var examDate time.Time
		if err := rows.Scan(&item.ID, &item.SubjectID, &item.Subject, &examDate); err != nil {
			return nil, fmt.Errorf("failed to scan assessment exam timetable: %w", err)
		}
		item.ExamDate = examDate.Format("2006-01-02")
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) UpsertAssessmentExamTimetable(ctx context.Context, schoolID, assessmentID uuid.UUID, classGrade int, entries []AssessmentExamTimetableEntry) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var assessmentName string
	if err := tx.QueryRow(ctx, `
		SELECT name
		FROM assessments
		WHERE id = $1
		  AND school_id = $2
		  AND $3 = ANY(COALESCE(class_grades, '{}'::INT[]))
	`, assessmentID, schoolID, classGrade).Scan(&assessmentName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAssessmentNotFound
		}
		return fmt.Errorf("failed to validate assessment for timetable upsert: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM assessment_exam_timetable
		WHERE school_id = $1
		  AND assessment_id = $2
		  AND class_grade = $3
	`, schoolID, assessmentID, classGrade); err != nil {
		return fmt.Errorf("failed to clear previous assessment exam timetable: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM events
		WHERE school_id = $1
		  AND type = 'exam'
		  AND source_assessment_id = $2
		  AND source_subject_id IS NULL
		  AND target_grade = $3
	`, schoolID, assessmentID, classGrade); err != nil {
		return fmt.Errorf("failed to clear fallback assessment event for class grade: %w", err)
	}

	keptSubjectIDs := make([]uuid.UUID, 0, len(entries))
	for _, entry := range entries {
		examDate, parseErr := time.Parse("2006-01-02", strings.TrimSpace(entry.ExamDate))
		if parseErr != nil {
			return ErrInvalidInput
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO assessment_exam_timetable (school_id, assessment_id, class_grade, subject_id, exam_date, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		`, schoolID, assessmentID, classGrade, entry.SubjectID, examDate); err != nil {
			return fmt.Errorf("failed to insert assessment exam timetable row: %w", err)
		}
		keptSubjectIDs = append(keptSubjectIDs, entry.SubjectID)

		var subjectName string
		_ = tx.QueryRow(ctx, `SELECT COALESCE(name, '') FROM subjects WHERE id = $1`, entry.SubjectID).Scan(&subjectName)
		title := strings.TrimSpace(assessmentName)
		if strings.TrimSpace(subjectName) != "" {
			title = fmt.Sprintf("%s - %s", strings.TrimSpace(assessmentName), strings.TrimSpace(subjectName))
		}

		var existingEventID uuid.UUID
		findErr := tx.QueryRow(ctx, `
			SELECT id
			FROM events
			WHERE school_id = $1
			  AND type = 'exam'
			  AND source_assessment_id = $2
			  AND source_subject_id = $3
			  AND target_grade = $4
			LIMIT 1
		`, schoolID, assessmentID, entry.SubjectID, classGrade).Scan(&existingEventID)

		if findErr != nil && !errors.Is(findErr, pgx.ErrNoRows) {
			return fmt.Errorf("failed to query existing exam event: %w", findErr)
		}

		if errors.Is(findErr, pgx.ErrNoRows) {
			if _, err := tx.Exec(ctx, `
				INSERT INTO events (
					school_id, title, description, event_date, start_time, end_time, type, location, target_grade, source_assessment_id, source_subject_id, created_at, updated_at
				)
				VALUES ($1, $2, $3, $4, NULL, NULL, 'exam', NULL, $5, $6, $7, NOW(), NOW())
			`, schoolID, title, fmt.Sprintf("Exam for Class %d", classGrade), examDate, classGrade, assessmentID, entry.SubjectID); err != nil {
				return fmt.Errorf("failed to create exam event: %w", err)
			}
		} else {
			if _, err := tx.Exec(ctx, `
				UPDATE events
				SET title = $1,
				    description = $2,
				    event_date = $3,
				    target_grade = $4,
				    updated_at = NOW()
				WHERE id = $5
			`, title, fmt.Sprintf("Exam for Class %d", classGrade), examDate, classGrade, existingEventID); err != nil {
				return fmt.Errorf("failed to update exam event: %w", err)
			}
		}
	}

	if len(keptSubjectIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			DELETE FROM events
			WHERE school_id = $1
			  AND type = 'exam'
			  AND source_assessment_id = $2
			  AND target_grade = $3
			  AND source_subject_id <> ALL($4::uuid[])
		`, schoolID, assessmentID, classGrade, keptSubjectIDs); err != nil {
			return fmt.Errorf("failed to delete stale exam events: %w", err)
		}
	} else {
		if _, err := tx.Exec(ctx, `
			DELETE FROM events
			WHERE school_id = $1
			  AND type = 'exam'
			  AND source_assessment_id = $2
			  AND target_grade = $3
		`, schoolID, assessmentID, classGrade); err != nil {
			return fmt.Errorf("failed to delete exam events: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func sanitizeAssessmentClassGrades(input []int) []int {
	if len(input) == 0 {
		return nil
	}
	seen := map[int]struct{}{}
	grades := make([]int, 0, len(input))
	for _, grade := range input {
		if _, exists := seen[grade]; exists {
			continue
		}
		seen[grade] = struct{}{}
		grades = append(grades, grade)
	}
	sort.Ints(grades)
	return grades
}

func formatAssessmentClassLabel(grade int) string {
	switch grade {
	case -1:
		return "LKG"
	case 0:
		return "UKG"
	default:
		return fmt.Sprintf("Class %d", grade)
	}
}

// RecordPayment records a payment
func (r *Repository) RecordPayment(ctx context.Context, schoolID uuid.UUID, collectorID uuid.UUID, req *RecordPaymentRequest) (uuid.UUID, string, error) {
	studentID, _ := uuid.Parse(req.StudentID)
	var studentFeeID *uuid.UUID
	if req.StudentFeeID != "" {
		id, _ := uuid.Parse(req.StudentFeeID)
		studentFeeID = &id
	}

	// Generate receipt number (use UUID segment to avoid collisions)
	receiptNumber := fmt.Sprintf("RCP-%s-%s", time.Now().Format("20060102"), uuid.New().String()[:8])

	query := `
		INSERT INTO payments (school_id, student_id, student_fee_id, amount, payment_method, transaction_id, receipt_number, status, notes, collected_by, purpose)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id
	`

	var paymentID uuid.UUID
	status := "completed"
	err := r.db.QueryRow(ctx, query,
		schoolID, studentID, studentFeeID, req.Amount, req.PaymentMethod, req.TransactionID,
		receiptNumber, status, req.Notes, collectorID, req.Purpose,
	).Scan(&paymentID)
	if err != nil {
		return uuid.Nil, "", err
	}

	// Update student_fee if provided
	if studentFeeID != nil {
		updateQuery := `
			UPDATE student_fees 
			SET paid_amount = paid_amount + $2,
			    status = CASE 
			        WHEN paid_amount + $2 >= amount - waiver_amount THEN 'paid'
			        WHEN paid_amount + $2 > 0 THEN 'partial'
			        ELSE status
			    END,
			    updated_at = CURRENT_TIMESTAMP,
			    updated_by = $3
			WHERE id = $1
		`
		r.db.Exec(ctx, updateQuery, studentFeeID, req.Amount, collectorID)
	}

	return paymentID, receiptNumber, nil
}

// GetRecentPayments retrieves recent payments
func (r *Repository) GetRecentPayments(ctx context.Context, limit int) ([]Payment, error) {
	query := `
		SELECT p.id, p.student_id, p.student_fee_id, p.amount, p.payment_method,
		       p.transaction_id, p.receipt_number, p.payment_date, p.status, p.notes,
		       p.collected_by, p.created_at,
		       u.full_name as student_name,
		       COALESCE(c.full_name, '') as collector_name
		FROM payments p
		JOIN students s ON p.student_id = s.id
		JOIN users u ON s.user_id = u.id
		LEFT JOIN users c ON p.collected_by = c.id
		ORDER BY p.payment_date DESC
		LIMIT $1
	`

	rows, err := r.db.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var payments []Payment
	for rows.Next() {
		var p Payment
		err := rows.Scan(
			&p.ID, &p.StudentID, &p.StudentFeeID, &p.Amount, &p.PaymentMethod,
			&p.TransactionID, &p.ReceiptNumber, &p.PaymentDate, &p.Status, &p.Notes,
			&p.CollectedBy, &p.CreatedAt,
			&p.StudentName, &p.CollectorName,
		)
		if err != nil {
			return nil, err
		}
		payments = append(payments, p)
	}

	return payments, nil
}

// GetRevenueChartData returns collected payment totals grouped by the given period.
// period: "week" → last 7 days by day, "month" → current month by day, "year" → current year by month.
func (r *Repository) GetRevenueChartData(ctx context.Context, period string) ([]RevenueChartPoint, error) {
	var query string
	switch period {
	case "week":
		query = `
			SELECT TO_CHAR(DATE(payment_date AT TIME ZONE 'UTC'), 'Dy') AS label,
			       COALESCE(SUM(amount), 0) AS revenue
			FROM payments
			WHERE payment_date >= NOW() - INTERVAL '7 days'
			  AND status = 'completed'
			GROUP BY DATE(payment_date AT TIME ZONE 'UTC'),
			         TO_CHAR(DATE(payment_date AT TIME ZONE 'UTC'), 'Dy')
			ORDER BY DATE(payment_date AT TIME ZONE 'UTC')
		`
	case "quarter":
		// Last 3 full months (not necessarily Jan–Mar) grouped by month.
		query = `
			SELECT TO_CHAR(DATE_TRUNC('month', payment_date AT TIME ZONE 'UTC'), 'Mon YYYY') AS label,
			       COALESCE(SUM(amount), 0) AS revenue
			FROM payments
			WHERE payment_date >= NOW() - INTERVAL '3 months'
			  AND status = 'completed'
			GROUP BY DATE_TRUNC('month', payment_date AT TIME ZONE 'UTC')
			ORDER BY DATE_TRUNC('month', payment_date AT TIME ZONE 'UTC')
		`
	case "year":
		query = `
			SELECT TO_CHAR(DATE_TRUNC('month', payment_date AT TIME ZONE 'UTC'), 'Mon YYYY') AS label,
			       COALESCE(SUM(amount), 0) AS revenue
			FROM payments
			WHERE payment_date >= DATE_TRUNC('year', NOW())
			  AND status = 'completed'
			GROUP BY DATE_TRUNC('month', payment_date AT TIME ZONE 'UTC')
			ORDER BY DATE_TRUNC('month', payment_date AT TIME ZONE 'UTC')
		`
	default: // month
		query = `
			SELECT TO_CHAR(DATE(payment_date AT TIME ZONE 'UTC'), 'DD Mon') AS label,
			       COALESCE(SUM(amount), 0) AS revenue
			FROM payments
			WHERE payment_date >= DATE_TRUNC('month', NOW())
			  AND status = 'completed'
			GROUP BY DATE(payment_date AT TIME ZONE 'UTC'),
			         TO_CHAR(DATE(payment_date AT TIME ZONE 'UTC'), 'DD Mon')
			ORDER BY DATE(payment_date AT TIME ZONE 'UTC')
		`
	}

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var points []RevenueChartPoint
	for rows.Next() {
		var p RevenueChartPoint
		if err := rows.Scan(&p.Label, &p.Revenue); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	if points == nil {
		points = []RevenueChartPoint{}
	}
	return points, nil
}

// GetClassStudentDistribution returns per-class-grade student counts for the school.
func (r *Repository) GetClassStudentDistribution(ctx context.Context, schoolID uuid.UUID) ([]ClassDistributionItem, error) {
	query := `
		SELECT
			COALESCE(c.grade, 0) AS grade,
			COALESCE(c.name, '') AS class_name,
			COUNT(s.id) AS student_count
		FROM classes c
		LEFT JOIN students s ON s.class_id = c.id AND s.school_id = $1
		WHERE c.school_id = $1
		GROUP BY c.grade, c.name
		ORDER BY c.grade ASC
	`
	rows, err := r.db.Query(ctx, query, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ClassDistributionItem
	for rows.Next() {
		var grade int
		var className string
		var count int
		if err := rows.Scan(&grade, &className, &count); err != nil {
			return nil, err
		}
		label := className
		if label == "" {
			switch grade {
			case -1:
				label = "LKG"
			case 0:
				label = "UKG"
			default:
				label = fmt.Sprintf("Class %d", grade)
			}
		}
		items = append(items, ClassDistributionItem{Name: label, Grade: grade, StudentCount: count})
	}
	if items == nil {
		items = []ClassDistributionItem{}
	}
	return items, nil
}

// LogAudit creates an audit log entry
func (r *Repository) LogAudit(ctx context.Context, userID *uuid.UUID, action, entityType string, entityID *uuid.UUID, oldValues, newValues interface{}, ipAddress, userAgent string) error {
	query := `
		INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	return r.db.Exec(ctx, query, userID, action, entityType, entityID, oldValues, newValues, ipAddress, userAgent)
}

// GetRecentAuditLogs retrieves recent audit logs
func (r *Repository) GetRecentAuditLogs(ctx context.Context, limit int) ([]AuditLog, error) {
	query := `
		SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.ip_address, a.user_agent, a.created_at,
		       COALESCE(u.full_name, 'System') as user_name
		FROM audit_logs a
		LEFT JOIN users u ON a.user_id = u.id
		ORDER BY a.created_at DESC
		LIMIT $1
	`

	rows, err := r.db.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var l AuditLog
		err := rows.Scan(&l.ID, &l.UserID, &l.Action, &l.EntityType, &l.EntityID, &l.IPAddress, &l.UserAgent, &l.CreatedAt, &l.UserName)
		if err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}

	return logs, nil
}

// GetEvents retrieves upcoming events for a school
func (r *Repository) GetEvents(ctx context.Context, schoolID uuid.UUID, limit int) ([]Event, error) {
	query := `
		SELECT id, school_id, title, description, event_date, start_time, end_time, type, location, created_at, updated_at
		FROM events 
		WHERE school_id = $1 AND event_date >= CURRENT_DATE
		ORDER BY event_date ASC
		LIMIT $2
	`
	rows, err := r.db.Query(ctx, query, schoolID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		err := rows.Scan(&e.ID, &e.SchoolID, &e.Title, &e.Description, &e.EventDate, &e.StartTime, &e.EndTime, &e.Type, &e.Location, &e.CreatedAt, &e.UpdatedAt)
		if err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

// GetLowStockItems retrieves inventory items with low stock
func (r *Repository) GetLowStockItems(ctx context.Context, schoolID uuid.UUID, limit int) ([]InventoryItem, error) {
	query := `
		SELECT id, school_id, name, category, quantity, unit, min_stock, location, status, last_updated, created_at, updated_at
		FROM inventory_items 
		WHERE school_id = $1 AND quantity <= min_stock
		ORDER BY quantity ASC
		LIMIT $2
	`
	rows, err := r.db.Query(ctx, query, schoolID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []InventoryItem
	for rows.Next() {
		var item InventoryItem
		err := rows.Scan(&item.ID, &item.SchoolID, &item.Name, &item.Category, &item.Quantity, &item.Unit, &item.MinStock, &item.Location, &item.Status, &item.LastUpdated, &item.CreatedAt, &item.UpdatedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// GetInventoryItems retrieves inventory items with optional search/category filters
// Tenant-isolated: relies on search_path set by TenantMiddleware
// Defense-in-depth: also validates school_id match
func (r *Repository) GetInventoryItems(ctx context.Context, schoolID uuid.UUID, search string, category string, limit int, offset int) ([]InventoryItem, int, error) {
	args := []interface{}{schoolID}
	argNum := 2
	whereClause := "WHERE school_id = $1"

	if search != "" {
		whereClause += fmt.Sprintf(" AND (name ILIKE $%d OR category ILIKE $%d)", argNum, argNum)
		args = append(args, "%"+search+"%")
		argNum++
	}

	if category != "" && category != "all" {
		whereClause += fmt.Sprintf(" AND category = $%d", argNum)
		args = append(args, category)
		argNum++
	}

	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM inventory_items
		%s
	`, whereClause)
	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count inventory items: %w", err)
	}

	query := fmt.Sprintf(`
		SELECT id, school_id, name, category, quantity, unit, min_stock, location, status,
		       COALESCE(last_updated, updated_at, created_at) AS last_updated,
		       created_at, updated_at
		FROM inventory_items
		%s
		ORDER BY name ASC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get inventory items: %w", err)
	}
	defer rows.Close()

	var items []InventoryItem
	for rows.Next() {
		var item InventoryItem
		err := rows.Scan(
			&item.ID, &item.SchoolID, &item.Name, &item.Category, &item.Quantity,
			&item.Unit, &item.MinStock, &item.Location, &item.Status,
			&item.LastUpdated, &item.CreatedAt, &item.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	return items, total, nil
}

// CreateInventoryItem creates a new inventory item in the tenant schema
// Tenant-isolated: INSERT happens in the schema set by search_path
func (r *Repository) CreateInventoryItem(ctx context.Context, item *InventoryItem, schoolID uuid.UUID) error {
	query := `
		INSERT INTO inventory_items (
			id, school_id, name, category, quantity, unit, min_stock, location, status,
			last_updated, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id
	`

	item.ID = uuid.New()
	item.SchoolID = schoolID
	item.CreatedAt = time.Now()
	item.UpdatedAt = item.CreatedAt
	item.LastUpdated = item.CreatedAt

	return r.db.QueryRow(ctx, query,
		item.ID, item.SchoolID, item.Name, item.Category, item.Quantity,
		item.Unit, item.MinStock, item.Location, item.Status,
		item.LastUpdated, item.CreatedAt, item.UpdatedAt,
	).Scan(&item.ID)
}

// DeleteInventoryItem deletes an inventory item from the tenant schema
// Tenant-isolated: DELETE only affects rows in current search_path schema
func (r *Repository) DeleteInventoryItem(ctx context.Context, itemID uuid.UUID, schoolID uuid.UUID) error {
	query := `
		DELETE FROM inventory_items
		WHERE id = $1 AND school_id = $2
	`

	tag, err := r.db.ExecResult(ctx, query, itemID, schoolID)
	if err != nil {
		return fmt.Errorf("failed to delete inventory item: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return fmt.Errorf("inventory item not found or unauthorized")
	}

	return nil
}

// UpdateInventoryItem updates an existing inventory item in the tenant schema
// Tenant-isolated: UPDATE only affects rows in current search_path schema
func (r *Repository) UpdateInventoryItem(ctx context.Context, itemID uuid.UUID, item *InventoryItem, schoolID uuid.UUID) error {
	query := `
		UPDATE inventory_items
		SET name = $1, category = $2, quantity = $3, unit = $4, 
		    min_stock = $5, location = $6, status = $7, 
		    last_updated = $8, updated_at = $9
		WHERE id = $10 AND school_id = $11
	`

	item.LastUpdated = time.Now()
	item.UpdatedAt = item.LastUpdated

	tag, err := r.db.ExecResult(ctx, query,
		item.Name, item.Category, item.Quantity, item.Unit,
		item.MinStock, item.Location, item.Status,
		item.LastUpdated, item.UpdatedAt, itemID, schoolID,
	)
	if err != nil {
		return fmt.Errorf("failed to update inventory item: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return fmt.Errorf("inventory item not found or unauthorized")
	}

	return nil
}

// GetSubjectsByClassID retrieves subjects filtered by class grade
// Tenant-isolated: relies on search_path set by TenantMiddleware
// Defense-in-depth: also validates school_id match between classes and subjects
func (r *Repository) GetSubjectsByClassID(ctx context.Context, classID uuid.UUID) ([]Subject, error) {
	// Keep tenant subjects synchronized with centralized catalog mapping for the class.
	// This preserves timetable FK behavior (tenant subject IDs) while enforcing global subject policy.
	syncQuery := `
		INSERT INTO subjects (id, school_id, name, code, description, grade_levels, credits, is_optional, created_at)
		SELECT
			gen_random_uuid(),
			c.school_id,
			gs.name,
			CASE
				WHEN COALESCE(NULLIF(gs.code, ''), '') = '' THEN UPPER(LEFT(gs.name, 3))
				ELSE gs.code
			END,
			NULL,
			NULL,
			1,
			false,
			NOW()
		FROM classes c
		JOIN public.global_classes gc ON (
			(c.grade = -1 AND LOWER(gc.name) = 'lkg')
			OR (c.grade = 0 AND LOWER(gc.name) = 'ukg')
			OR (c.grade > 0 AND LOWER(gc.name) = LOWER('Class ' || c.grade::text))
		)
		JOIN public.global_class_subjects gcs ON gcs.class_id = gc.id
		JOIN public.global_subjects gs ON gs.id = gcs.subject_id
		LEFT JOIN subjects s
			ON s.school_id = c.school_id
		   AND LOWER(s.name) = LOWER(gs.name)
		WHERE c.id = $1
		  AND s.id IS NULL
		ON CONFLICT (school_id, code) DO NOTHING
	`
	if err := r.db.Exec(ctx, syncQuery, classID); err != nil {
		return nil, fmt.Errorf("failed to sync class subjects from global catalog: %w", err)
	}

	query := `
		SELECT s.id, s.name, s.code, s.description, s.grade_levels, s.credits, s.is_optional, s.created_at, gs.id
		FROM classes c
		JOIN public.global_classes gc ON (
			(c.grade = -1 AND LOWER(gc.name) = 'lkg')
			OR (c.grade = 0 AND LOWER(gc.name) = 'ukg')
			OR (c.grade > 0 AND LOWER(gc.name) = LOWER('Class ' || c.grade::text))
		)
		JOIN public.global_class_subjects gcs ON gcs.class_id = gc.id
		JOIN public.global_subjects gs ON gs.id = gcs.subject_id
		JOIN subjects s
			ON s.school_id = c.school_id
		   AND LOWER(s.name) = LOWER(gs.name)
		WHERE c.id = $1
		ORDER BY gs.name
	`

	rows, err := r.db.Query(ctx, query, classID)
	if err != nil {
		return nil, fmt.Errorf("failed to get subjects by class: %w", err)
	}
	defer rows.Close()

	var subjects []Subject
	for rows.Next() {
		var s Subject
		err := rows.Scan(&s.ID, &s.Name, &s.Code, &s.Description, &s.GradeLevels, &s.Credits, &s.IsOptional, &s.CreatedAt, &s.GlobalSubjectID)
		if err != nil {
			return nil, err
		}
		subjects = append(subjects, s)
	}

	return subjects, nil
}

// CreateSubject creates a new subject in the tenant schema
// Tenant-isolated: INSERT happens in the schema set by search_path
func (r *Repository) CreateSubject(ctx context.Context, subject *Subject, schoolID uuid.UUID) error {
	query := `
		INSERT INTO subjects (id, school_id, name, code, description, grade_levels, credits, is_optional, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`

	subject.ID = uuid.New()
	subject.CreatedAt = time.Now()

	return r.db.QueryRow(ctx, query,
		subject.ID, schoolID, subject.Name, subject.Code, subject.Description,
		subject.GradeLevels, subject.Credits, subject.IsOptional, subject.CreatedAt,
	).Scan(&subject.ID)
}

// UpdateSubject updates an existing subject in the tenant schema
// Tenant-isolated: UPDATE only affects rows in current search_path schema
func (r *Repository) UpdateSubject(ctx context.Context, subjectID uuid.UUID, subject *Subject, schoolID uuid.UUID) error {
	query := `
		UPDATE subjects 
		SET name = $1, code = $2, description = $3, grade_levels = $4, 
		    credits = $5, is_optional = $6
		WHERE id = $7 AND school_id = $8
	`

	tag, err := r.db.ExecResult(ctx, query,
		subject.Name, subject.Code, subject.Description, subject.GradeLevels,
		subject.Credits, subject.IsOptional, subjectID, schoolID,
	)
	if err != nil {
		return fmt.Errorf("failed to update subject: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return fmt.Errorf("subject not found or unauthorized")
	}

	return nil
}

// DeleteSubject deletes a subject from the tenant schema
// Tenant-isolated: DELETE only affects rows in current search_path schema
func (r *Repository) DeleteSubject(ctx context.Context, subjectID uuid.UUID, schoolID uuid.UUID) error {
	query := `
		DELETE FROM subjects 
		WHERE id = $1 AND school_id = $2
	`

	tag, err := r.db.ExecResult(ctx, query, subjectID, schoolID)
	if err != nil {
		return fmt.Errorf("failed to delete subject: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return fmt.Errorf("subject not found or unauthorized")
	}

	return nil
}

// GetWeeklyAttendanceSummary returns per-day present/absent totals across all
// classes for the school between weekStart and weekEnd (inclusive).
// "present" counts both 'present' and 'late'; "absent" counts 'absent' only.
func (r *Repository) GetWeeklyAttendanceSummary(ctx context.Context, schoolID uuid.UUID, weekStart, weekEnd time.Time) ([]WeeklyAttendanceDayItem, error) {
	query := `
SELECT
	to_char(a.date, 'Dy') AS day_label,
	COUNT(*) FILTER (WHERE a.status IN ('present', 'late')) AS present_count,
	COUNT(*) FILTER (WHERE a.status = 'absent') AS absent_count
FROM attendance a
JOIN students s ON s.id = a.student_id
WHERE s.school_id = $1
  AND a.date >= $2
  AND a.date <= $3
GROUP BY a.date
ORDER BY a.date ASC
`
	rows, err := r.db.Query(ctx, query, schoolID, weekStart, weekEnd)
	if err != nil {
		return nil, fmt.Errorf("GetWeeklyAttendanceSummary: %w", err)
	}
	defer rows.Close()

	items := make([]WeeklyAttendanceDayItem, 0, 7)
	for rows.Next() {
		var item WeeklyAttendanceDayItem
		if err := rows.Scan(&item.Day, &item.Present, &item.Absent); err != nil {
			return nil, fmt.Errorf("GetWeeklyAttendanceSummary scan: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetWeeklyAttendanceSummary rows: %w", err)
	}
	return items, nil
}

// --------------------------------------------------------------------------
// Admission Repository Methods
// --------------------------------------------------------------------------

// ListAdmissionApplications returns paginated admission applications for a school.
// ctx must have "tenant_schema" injected.
func (r *Repository) ListAdmissionApplications(ctx context.Context, schoolID uuid.UUID, status string, page, pageSize int) ([]AdmissionListItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	where := "WHERE school_id = $1"
	args := []interface{}{schoolID}
	paramIdx := 2

	if status != "" {
		where += fmt.Sprintf(" AND status = $%d", paramIdx)
		args = append(args, status)
		paramIdx++
	}

	countRow := r.db.QueryRow(ctx,
		fmt.Sprintf("SELECT COUNT(*) FROM admission_applications %s", where),
		args...,
	)
	var total int
	if err := countRow.Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("ListAdmissions count: %w", err)
	}

	args = append(args, pageSize, offset)
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT id, student_name, date_of_birth::text, mother_phone,
		       applying_for_class, document_count, status, academic_year, submitted_at
		FROM admission_applications
		%s
		ORDER BY submitted_at ASC
		LIMIT $%d OFFSET $%d
	`, where, paramIdx, paramIdx+1), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("ListAdmissions query: %w", err)
	}
	defer rows.Close()

	items := make([]AdmissionListItem, 0, pageSize)
	for rows.Next() {
		var item AdmissionListItem
		if err := rows.Scan(
			&item.ID, &item.StudentName, &item.DateOfBirth, &item.MotherPhone,
			&item.ApplyingForClass, &item.DocumentCount, &item.Status,
			&item.AcademicYear, &item.SubmittedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("ListAdmissions scan: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("ListAdmissions rows: %w", err)
	}
	return items, total, nil
}

// GetAdmissionApplication returns full detail for a single application.
// ctx must have "tenant_schema" injected.
func (r *Repository) GetAdmissionApplication(ctx context.Context, schoolID, appID uuid.UUID) (*AdmissionApplication, error) {
	row := r.db.QueryRow(ctx, `
		SELECT
			id, school_id, academic_year,
			student_name, date_of_birth::text, gender, religion, caste_category,
			nationality, mother_tongue, blood_group, aadhaar_number, applying_for_class,
			previous_school_name, previous_class, previous_school_address, tc_number,
			father_name, father_phone, father_occupation,
			mother_name, mother_phone, mother_occupation,
			guardian_name, guardian_phone, guardian_relation,
			address_line1, address_line2, city, state, pincode,
			has_birth_certificate, has_aadhaar_card, has_transfer_certificate,
			has_caste_certificate, has_income_certificate, has_passport_photo,
			document_count, status, rejection_reason, reviewed_by, reviewed_at,
			created_user_id, created_student_id,
			submitted_at, updated_at, email
		FROM admission_applications
		WHERE id = $1 AND school_id = $2
		LIMIT 1
	`, appID, schoolID)

	var a AdmissionApplication
	err := row.Scan(
		&a.ID, &a.SchoolID, &a.AcademicYear,
		&a.StudentName, &a.DateOfBirth, &a.Gender, &a.Religion, &a.CasteCategory,
		&a.Nationality, &a.MotherTongue, &a.BloodGroup, &a.AadhaarNumber, &a.ApplyingForClass,
		&a.PreviousSchoolName, &a.PreviousClass, &a.PreviousSchoolAddress, &a.TCNumber,
		&a.FatherName, &a.FatherPhone, &a.FatherOccupation,
		&a.MotherName, &a.MotherPhone, &a.MotherOccupation,
		&a.GuardianName, &a.GuardianPhone, &a.GuardianRelation,
		&a.AddressLine1, &a.AddressLine2, &a.City, &a.State, &a.Pincode,
		&a.HasBirthCertificate, &a.HasAadhaarCard, &a.HasTransferCertificate,
		&a.HasCasteCertificate, &a.HasIncomeCertificate, &a.HasPassportPhoto,
		&a.DocumentCount, &a.Status, &a.RejectionReason, &a.ReviewedBy, &a.ReviewedAt,
		&a.CreatedUserID, &a.CreatedStudentID,
		&a.SubmittedAt, &a.UpdatedAt, &a.Email,
	)
	if err != nil {
		if isAdminNoRows(err) {
			return nil, errors.New("application_not_found")
		}
		return nil, fmt.Errorf("GetAdmissionApplication: %w", err)
	}
	return &a, nil
}

// RejectAdmission marks an application as rejected.
// ctx must have "tenant_schema" injected.
func (r *Repository) RejectAdmission(ctx context.Context, schoolID, appID, reviewedBy uuid.UUID, reason string) error {
	now := time.Now()
	err := r.db.Exec(ctx, `
		UPDATE admission_applications
		SET status = 'rejected',
		    rejection_reason = $1,
		    reviewed_by = $2,
		    reviewed_at = $3,
		    updated_at = $3
		WHERE id = $4 AND school_id = $5
		  AND status NOT IN ('approved', 'rejected')
	`, reason, reviewedBy, now, appID, schoolID)
	if err != nil {
		return fmt.Errorf("RejectAdmission: %w", err)
	}
	return nil
}

// ApproveAdmission marks an application as approved and records the created user/student IDs.
// ctx must have "tenant_schema" injected.
func (r *Repository) ApproveAdmission(ctx context.Context, schoolID, appID, reviewedBy, createdUserID, createdStudentID uuid.UUID) error {
	now := time.Now()
	err := r.db.Exec(ctx, `
		UPDATE admission_applications
		SET status = 'approved',
		    reviewed_by = $1,
		    reviewed_at = $2,
		    created_user_id = $3,
		    created_student_id = $4,
		    updated_at = $2
		WHERE id = $5 AND school_id = $6
		  AND status NOT IN ('approved', 'rejected')
	`, reviewedBy, now, createdUserID, createdStudentID, appID, schoolID)
	if err != nil {
		return fmt.Errorf("ApproveAdmission: %w", err)
	}
	return nil
}

// GetAdmissionSettings returns the admission toggle, auto-approve flag, school identity, and global academic year.
func (r *Repository) GetAdmissionSettings(ctx context.Context, schoolID uuid.UUID) (*AdmissionSettingsResponse, error) {
	row := r.db.QueryRow(ctx, `
		SELECT s.admissions_open,
		       COALESCE(s.admission_auto_approve, false) AS auto_approve,
		       COALESCE(s.teacher_appointments_open, true) AS teacher_appointments_open,
		       COALESCE(s.slug, '') AS slug,
		       COALESCE(s.name, '') AS name,
		       COALESCE(g.value, '') AS global_academic_year
		FROM public.schools s
		LEFT JOIN public.global_settings g ON g.key = 'current_academic_year'
		WHERE s.id = $1 AND s.deleted_at IS NULL
		LIMIT 1
	`, schoolID)
	resp := &AdmissionSettingsResponse{}
	if err := row.Scan(&resp.AdmissionsOpen, &resp.AutoApprove, &resp.TeacherAppointmentsOpen, &resp.SchoolSlug, &resp.SchoolName, &resp.GlobalAcademicYear); err != nil {
		return nil, fmt.Errorf("GetAdmissionSettings: %w", err)
	}
	return resp, nil
}

// UpdateAdmissionSettings updates the admission open flag, auto-approve setting, and teacher appointments toggle.
func (r *Repository) UpdateAdmissionSettings(ctx context.Context, schoolID uuid.UUID, open bool, autoApprove bool, teacherAppointmentsOpen bool) error {
	if err := r.db.Exec(ctx, `
		UPDATE public.schools
		SET admissions_open = $1, admission_auto_approve = $2, teacher_appointments_open = $3
		WHERE id = $4
	`, open, autoApprove, teacherAppointmentsOpen, schoolID); err != nil {
		return fmt.Errorf("UpdateAdmissionSettings: %w", err)
	}
	return nil
}

// GetAdmissionDocument retrieves a document from R2 for admin viewing.
func (r *Repository) GetAdmissionDocument(ctx context.Context, schoolID, applicationID, docObjectID string) (string, string, []byte, error) {
	if r.db == nil {
		return "", "", nil, errors.New("database not configured")
	}
	var raw struct {
		FileName   string
		MimeType   string
		StorageKey string
	}
	if err := r.db.QueryRow(ctx, `
		SELECT file_name, mime_type, storage_key
		FROM admission_documents
		WHERE id::text = $1 AND school_id = $2 AND application_id = $3
		LIMIT 1
	`, strings.TrimSpace(docObjectID), schoolID, applicationID).Scan(&raw.FileName, &raw.MimeType, &raw.StorageKey); err != nil {
		return "", "", nil, fmt.Errorf("GetAdmissionDocument: %w", err)
	}
	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return "", "", nil, fmt.Errorf("GetAdmissionDocument content: %w", err)
	}
	return raw.FileName, raw.MimeType, content, nil
}

// DeleteAdmissionDocuments removes all document metadata rows for an application.
func (r *Repository) DeleteAdmissionDocuments(ctx context.Context, schoolID, applicationID string) error {
	if r.db == nil {
		return nil
	}
	return r.db.Exec(ctx, `
		DELETE FROM admission_documents
		WHERE school_id = $1 AND application_id = $2
	`, schoolID, applicationID)
}

// isAdminNoRows checks if the error indicates no rows were found.
func isAdminNoRows(err error) bool {
	return err != nil && strings.Contains(err.Error(), "no rows")
}

func normalizeOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeRequired(value string) string {
	return strings.TrimSpace(value)
}

// UpsertParentalConsentForAdmission persists a verifiable guardian consent record
// for a minor admission. If an entry already exists for the same application,
// it is updated with the latest verified details.
func (r *Repository) UpsertParentalConsentForAdmission(
	ctx context.Context,
	schoolID, appID uuid.UUID,
	dob time.Time,
	guardianName, guardianPhone, guardianRelation, consentMethod string,
	declarationAccepted bool,
	consentReference, consentIP, consentUserAgent *string,
) error {
	if !declarationAccepted {
		return fmt.Errorf("parental consent declaration is required")
	}

	guardianName = normalizeRequired(guardianName)
	guardianPhone = normalizeRequired(guardianPhone)
	guardianRelation = normalizeRequired(guardianRelation)
	consentMethod = strings.ToLower(normalizeRequired(consentMethod))
	if consentMethod == "" {
		consentMethod = "other"
	}

	if guardianName == "" || guardianPhone == "" {
		return fmt.Errorf("guardian name and phone are required")
	}

	if consentMethod != "otp" && consentMethod != "written" && consentMethod != "digital" && consentMethod != "in_person" && consentMethod != "other" {
		return fmt.Errorf("invalid consent method")
	}

	err := r.db.Exec(ctx, `
		INSERT INTO parental_consents (
			school_id, admission_application_id, student_date_of_birth,
			guardian_name, guardian_phone, guardian_relation,
			consent_method, declaration_accepted, consent_reference,
			consent_ip, consent_user_agent, policy_version, consented_at
		) VALUES (
			$1, $2, $3,
			$4, $5, $6,
			$7, $8, $9,
			$10, $11, $12, NOW()
		)
		ON CONFLICT (school_id, admission_application_id)
		DO UPDATE SET
			student_date_of_birth = EXCLUDED.student_date_of_birth,
			guardian_name = EXCLUDED.guardian_name,
			guardian_phone = EXCLUDED.guardian_phone,
			guardian_relation = EXCLUDED.guardian_relation,
			consent_method = EXCLUDED.consent_method,
			declaration_accepted = EXCLUDED.declaration_accepted,
			consent_reference = EXCLUDED.consent_reference,
			consent_ip = EXCLUDED.consent_ip,
			consent_user_agent = EXCLUDED.consent_user_agent,
			policy_version = EXCLUDED.policy_version,
			consented_at = NOW()
	`,
		schoolID,
		appID,
		dob,
		guardianName,
		guardianPhone,
		normalizeOptional(&guardianRelation),
		consentMethod,
		declarationAccepted,
		normalizeOptional(consentReference),
		normalizeOptional(consentIP),
		normalizeOptional(consentUserAgent),
		"2026-03-17",
	)
	if err != nil {
		return fmt.Errorf("upsert parental consent: %w", err)
	}

	return nil
}

// HasParentalConsentForAdmission reports whether a valid parental consent exists
// for the admission application in this school.
func (r *Repository) HasParentalConsentForAdmission(ctx context.Context, schoolID, appID uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM parental_consents
			WHERE school_id = $1
			  AND admission_application_id = $2
			  AND declaration_accepted = TRUE
		)
	`, schoolID, appID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check parental consent: %w", err)
	}
	return exists, nil
}

// CreateStudentFromAdmission creates a user + student row from an approved admission application
// inside a transaction. Returns createdUserID and createdStudentID.
// ctx must have "tenant_schema" AND "school_id" set.
func (r *Repository) CreateStudentFromAdmission(ctx context.Context, schoolID uuid.UUID, app *AdmissionApplication, username, hashedPassword string, createdBy uuid.UUID, req *ApproveAdmissionRequest) (uuid.UUID, uuid.UUID, error) {
	// Inject school_id into context so CreateUser can read it.
	ctx = context.WithValue(ctx, "school_id", schoolID.String())

	// Build email: use admission email if present, otherwise generate a unique placeholder.
	email := ""
	if app.Email != nil && strings.TrimSpace(*app.Email) != "" {
		email = strings.TrimSpace(*app.Email)
	} else {
		email = strings.ToLower(username) + "@" + schoolID.String()[:8] + ".admission.local"
	}

	userReq := &CreateUserRequest{
		Email:    email,
		Password: hashedPassword, // already hashed
		FullName: app.StudentName,
		Role:     "student",
		Phone:    app.MotherPhone,
		SchoolID: schoolID.String(),
	}

	// CreateUser calls bcrypt internally — pass a sentinel to skip double-hashing.
	// We directly INSERT to avoid re-hashing. Use a raw insert.
	userID := uuid.New()
	err := r.db.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, full_name, role, phone, school_id, is_active, created_by)
		VALUES ($1, $2, $3, $4, 'student', $5, $6, true, $7)
	`, userID, userReq.Email, hashedPassword, userReq.FullName, userReq.Phone, schoolID, createdBy)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("create user for admission: %w", err)
	}

	// Parse DOB
	var dob *time.Time
	if app.DateOfBirth != "" {
		t, parseErr := time.Parse("2006-01-02", app.DateOfBirth)
		if parseErr == nil {
			dob = &t
		}
	}

	// Resolve class_id
	var classIDPtr *uuid.UUID
	if req != nil && req.ClassID != nil && *req.ClassID != "" {
		if cid, parseErr := uuid.Parse(*req.ClassID); parseErr == nil {
			classIDPtr = &cid
		}
	}

	admissionNumber := "ADM-" + strings.ToUpper(userID.String()[:8])

	gender := ""
	if app.Gender != nil {
		gender = *app.Gender
	}
	if gender == "" {
		gender = "other"
	}

	academicYear := ""
	if app.AcademicYear != nil {
		academicYear = *app.AcademicYear
	}
	if academicYear == "" {
		y := time.Now().Year()
		academicYear = fmt.Sprintf("%d-%d", y, y+1)
	}

	parentName := ""
	if app.MotherName != nil {
		parentName = *app.MotherName
	}

	var studentID uuid.UUID
	err = r.db.QueryRow(ctx, `
		INSERT INTO students
			(school_id, user_id, admission_number, class_id, section,
			 date_of_birth, gender, parent_name, parent_phone,
			 admission_date, academic_year)
		VALUES ($1, $2, $3, $4, 'A', $5, $6, $7, $8, $9, $10)
		RETURNING id
	`,
		schoolID, userID, admissionNumber, classIDPtr,
		dob, gender, parentName, app.MotherPhone,
		time.Now(), academicYear,
	).Scan(&studentID)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("create student for admission: %w", err)
	}

	return userID, studentID, nil
}

func (r *Repository) GetLearnerIDForStudent(ctx context.Context, schoolID, studentID uuid.UUID) (uuid.UUID, error) {
	var learnerID *uuid.UUID
	if err := r.db.QueryRow(ctx, `
		SELECT learner_id
		FROM students
		WHERE id = $1 AND school_id = $2
	`, studentID, schoolID).Scan(&learnerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, nil
		}
		return uuid.Nil, err
	}
	if learnerID == nil {
		return uuid.Nil, nil
	}
	return *learnerID, nil
}

func (r *Repository) ListTransferDestinationSchools(ctx context.Context, sourceSchoolID uuid.UUID, search string, limit int) ([]TransferDestinationSchoolOption, error) {
	if limit < 1 {
		limit = 20
	}

	sourceEligible, err := r.IsTransferSourceEligible(ctx, sourceSchoolID)
	if err != nil {
		return nil, err
	}
	if !sourceEligible {
		return nil, fmt.Errorf("source school not eligible")
	}

	rows, err := r.db.Query(ctx, `
		SELECT id, name, code
		FROM public.schools
		WHERE id <> $1
		  AND deleted_at IS NULL
		  AND is_active = TRUE
		  AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR code ILIKE '%' || $2 || '%')
		ORDER BY name ASC
		LIMIT $3
	`, sourceSchoolID, strings.TrimSpace(search), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]TransferDestinationSchoolOption, 0, limit)
	for rows.Next() {
		var item TransferDestinationSchoolOption
		if err := rows.Scan(&item.ID, &item.Name, &item.Code); err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}

func (r *Repository) IsTransferSourceEligible(ctx context.Context, sourceSchoolID uuid.UUID) (bool, error) {
	var eligible bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM public.schools src
			WHERE src.id = $1
			  AND src.deleted_at IS NULL
			  AND src.is_active = TRUE
		)
	`, sourceSchoolID).Scan(&eligible)
	if err != nil {
		return false, err
	}
	return eligible, nil
}

func (r *Repository) IsTransferDestinationEligible(ctx context.Context, sourceSchoolID, destinationSchoolID uuid.UUID) (bool, error) {
	var eligible bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM public.schools dst
			WHERE dst.id = $2
			  AND dst.id <> $1
			  AND dst.deleted_at IS NULL
			  AND dst.is_active = TRUE
		)
	`, sourceSchoolID, destinationSchoolID).Scan(&eligible)
	if err != nil {
		return false, err
	}
	return eligible, nil
}

func (r *Repository) CreateLearnerTransferRequest(ctx context.Context, learnerID, sourceSchoolID, destinationSchoolID, sourceStudentID, requestedBy uuid.UUID, reason, evidenceRef *string, preferredAutoGovSync bool) (*LearnerTransferListItem, error) {
	item := &LearnerTransferListItem{}
	transferID := uuid.New()

	sourceEligible, err := r.IsTransferSourceEligible(ctx, sourceSchoolID)
	if err != nil {
		return nil, err
	}
	if !sourceEligible {
		return nil, fmt.Errorf("source school not eligible")
	}

	destinationEligible, err := r.IsTransferDestinationEligible(ctx, sourceSchoolID, destinationSchoolID)
	if err != nil {
		return nil, err
	}
	if !destinationEligible {
		return nil, fmt.Errorf("destination school not eligible")
	}

	var sourceActive bool
	if err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM public.learner_enrollments
			WHERE learner_id = $1
			  AND school_id = $2
			  AND status = 'active'
		)
	`, learnerID, sourceSchoolID).Scan(&sourceActive); err != nil {
		return nil, err
	}
	if !sourceActive {
		return nil, fmt.Errorf("source enrollment not active")
	}

	var destinationActive bool
	if err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM public.learner_enrollments
			WHERE learner_id = $1
			  AND school_id = $2
			  AND status = 'active'
		)
	`, learnerID, destinationSchoolID).Scan(&destinationActive); err != nil {
		return nil, err
	}
	if destinationActive {
		return nil, fmt.Errorf("destination enrollment already active")
	}

	err = r.db.QueryRow(ctx, `
		INSERT INTO public.learner_transfer_requests (
			id, learner_id, source_school_id, destination_school_id, source_student_id,
			status, reason, evidence_ref, preferred_auto_gov_sync, requested_by, requested_at, created_at, updated_at
		)
		VALUES (
			$1, $2, $3, $4, $5,
			'pending', NULLIF(TRIM($6), ''), NULLIF(TRIM($7), ''), $8, $9, NOW(), NOW(), NOW()
		)
		RETURNING id, learner_id, source_school_id, destination_school_id, source_student_id,
			status, reason, evidence_ref, requested_by, reviewed_by, requested_at, reviewed_at, created_at, updated_at, preferred_auto_gov_sync
	`, transferID, learnerID, sourceSchoolID, destinationSchoolID, sourceStudentID, trimmedOrEmpty(reason), trimmedOrEmpty(evidenceRef), preferredAutoGovSync, requestedBy).Scan(
		&item.ID, &item.LearnerID, &item.SourceSchoolID, &item.DestinationSchoolID, &item.SourceStudentID,
		&item.Status, &item.Reason, &item.EvidenceRef, &item.RequestedBy, &item.ReviewedBy, &item.RequestedAt, &item.ReviewedAt, &item.CreatedAt, &item.UpdatedAt, &item.PreferredAutoGovSync,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "idx_learner_transfer_pending_unique") {
			return nil, fmt.Errorf("duplicate pending transfer")
		}
		return nil, err
	}

	return item, nil
}

func (r *Repository) ListLearnerTransferRequests(ctx context.Context, schoolID uuid.UUID, direction, status string, page, pageSize int) ([]LearnerTransferListItem, int, error) {
	offset := (page - 1) * pageSize
	args := []interface{}{}
	conditions := []string{"1=1"}
	argNum := 1

	if direction == "incoming" {
		conditions = append(conditions, fmt.Sprintf("ltr.destination_school_id = $%d", argNum))
		args = append(args, schoolID)
		argNum++
	} else if direction == "outgoing" {
		conditions = append(conditions, fmt.Sprintf("ltr.source_school_id = $%d", argNum))
		args = append(args, schoolID)
		argNum++
	} else {
		conditions = append(conditions, fmt.Sprintf("(ltr.source_school_id = $%d OR ltr.destination_school_id = $%d)", argNum, argNum))
		args = append(args, schoolID)
		argNum++
	}

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("ltr.status = $%d", argNum))
		args = append(args, status)
		argNum++
	}

	whereClause := strings.Join(conditions, " AND ")

	var total int
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM public.learner_transfer_requests ltr
		WHERE %s
	`, whereClause)
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT
			ltr.id, ltr.learner_id, ltr.source_school_id, ltr.destination_school_id, ltr.source_student_id,
			ltr.status, ltr.reason, ltr.evidence_ref, ltr.review_note, ltr.preferred_auto_gov_sync,
			ltr.requested_by, ltr.reviewed_by, ltr.requested_at, ltr.reviewed_at, ltr.created_at, ltr.updated_at,
			l.full_name, src.name, dst.name,
			gj.id::text, gj.status, gj.dry_run, gj.last_error, gj.updated_at
		FROM public.learner_transfer_requests ltr
		LEFT JOIN public.learners l ON l.id = ltr.learner_id
		LEFT JOIN public.schools src ON src.id = ltr.source_school_id
		LEFT JOIN public.schools dst ON dst.id = ltr.destination_school_id
		LEFT JOIN LATERAL (
			SELECT id, status, dry_run, last_error, updated_at
			FROM interop_jobs j
			WHERE j.operation = 'transfer_event_sync'
			  AND j.payload->>'transfer_request_id' = ltr.id::text
			ORDER BY j.created_at DESC
			LIMIT 1
		) gj ON TRUE
		WHERE %s
		ORDER BY ltr.requested_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)
	args = append(args, pageSize, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]LearnerTransferListItem, 0, pageSize)
	for rows.Next() {
		var item LearnerTransferListItem
		var govSyncDryRun *bool
		if err := rows.Scan(
			&item.ID, &item.LearnerID, &item.SourceSchoolID, &item.DestinationSchoolID, &item.SourceStudentID,
			&item.Status, &item.Reason, &item.EvidenceRef, &item.ReviewNote, &item.PreferredAutoGovSync,
			&item.RequestedBy, &item.ReviewedBy, &item.RequestedAt, &item.ReviewedAt, &item.CreatedAt, &item.UpdatedAt,
			&item.LearnerName, &item.SourceSchoolName, &item.DestinationSchoolName,
			&item.GovSyncJobID, &item.GovSyncStatus, &govSyncDryRun, &item.GovSyncLastError, &item.GovSyncUpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		if govSyncDryRun != nil {
			mode := "live"
			if *govSyncDryRun {
				mode = "dry_run"
			}
			item.GovSyncMode = &mode
		}
		if item.GovSyncLastError != nil && strings.TrimSpace(*item.GovSyncLastError) == "" {
			item.GovSyncLastError = nil
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

func (r *Repository) GetTransferGovSyncSnapshot(ctx context.Context, transferID, schoolID uuid.UUID) (*TransferGovSyncSnapshot, error) {
	item := &TransferGovSyncSnapshot{}
	var govSyncDryRun *bool

	err := r.db.QueryRow(ctx, `
		SELECT
			ltr.id,
			ltr.status,
			ltr.destination_school_id,
			gj.id::text,
			gj.status,
			gj.dry_run,
			gj.last_error,
			gj.updated_at
		FROM public.learner_transfer_requests ltr
		LEFT JOIN LATERAL (
			SELECT id, status, dry_run, last_error, updated_at
			FROM interop_jobs j
			WHERE j.operation = 'transfer_event_sync'
			  AND j.payload->>'transfer_request_id' = ltr.id::text
			ORDER BY j.created_at DESC
			LIMIT 1
		) gj ON TRUE
		WHERE ltr.id = $1
		  AND (ltr.source_school_id = $2 OR ltr.destination_school_id = $2)
	`, transferID, schoolID).Scan(
		&item.TransferID,
		&item.TransferStatus,
		&item.DestinationSchoolID,
		&item.GovSyncJobID,
		&item.GovSyncStatus,
		&govSyncDryRun,
		&item.GovSyncLastError,
		&item.GovSyncUpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("transfer request not found")
		}
		return nil, err
	}

	if govSyncDryRun != nil {
		mode := "live"
		if *govSyncDryRun {
			mode = "dry_run"
		}
		item.GovSyncMode = &mode
	}
	if item.GovSyncLastError != nil && strings.TrimSpace(*item.GovSyncLastError) == "" {
		item.GovSyncLastError = nil
	}

	return item, nil
}

func (r *Repository) ReviewLearnerTransferRequest(ctx context.Context, schoolID, reviewerID, transferID uuid.UUID, action string, reviewNote *string) (bool, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var learnerID uuid.UUID
	var sourceSchoolID uuid.UUID
	var destinationSchoolID uuid.UUID
	var status string
	var preferredAutoGovSync bool

	err = tx.QueryRow(ctx, `
		SELECT learner_id, source_school_id, destination_school_id, status, preferred_auto_gov_sync
		FROM public.learner_transfer_requests
		WHERE id = $1
		FOR UPDATE
	`, transferID).Scan(&learnerID, &sourceSchoolID, &destinationSchoolID, &status, &preferredAutoGovSync)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, fmt.Errorf("transfer request not found")
		}
		return false, err
	}

	if destinationSchoolID != schoolID {
		return false, fmt.Errorf("transfer request not found")
	}
	if status != "pending" {
		return false, fmt.Errorf("transfer request already reviewed")
	}

	normalizedStatus := "rejected"
	if action == "approve" {
		normalizedStatus = "approved"
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.learner_transfer_requests
		SET status = $2,
			review_note = NULLIF(TRIM($3), ''),
			reviewed_by = $4,
			reviewed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, transferID, normalizedStatus, trimmedOrEmpty(reviewNote), reviewerID); err != nil {
		return false, err
	}

	if normalizedStatus == "approved" {
		evidenceRef := "transfer_request:" + transferID.String()
		sourceUpdateResult, err := tx.Exec(ctx, `
			UPDATE public.learner_enrollments
			SET status = 'transferred_out',
				exited_at = NOW(),
				evidence_ref = $3,
				updated_at = NOW()
			WHERE learner_id = $1
			  AND school_id = $2
			  AND status = 'active'
		`, learnerID, sourceSchoolID, evidenceRef)
		if err != nil {
			return false, err
		}
		if sourceUpdateResult.RowsAffected() == 0 {
			return false, fmt.Errorf("source enrollment not active")
		}

		if _, err := tx.Exec(ctx, `
			WITH existing AS (
				UPDATE public.learner_enrollments
				SET status = 'active', exited_at = NULL, updated_at = NOW(), source = 'transfer_approved', evidence_ref = $3
				WHERE learner_id = $1 AND school_id = $2
				RETURNING id
			)
			INSERT INTO public.learner_enrollments (
				id, learner_id, school_id, status, joined_at, source, evidence_ref, created_at, updated_at
			)
			SELECT gen_random_uuid(), $1, $2, 'active', NOW(), 'transfer_approved', $3, NOW(), NOW()
			WHERE NOT EXISTS (SELECT 1 FROM existing)
		`, learnerID, destinationSchoolID, evidenceRef); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}

	return preferredAutoGovSync, nil
}

func (r *Repository) GetTransferInteropContext(ctx context.Context, transferID, destinationSchoolID uuid.UUID) (*TransferInteropContext, error) {
	item := &TransferInteropContext{}
	err := r.db.QueryRow(ctx, `
		SELECT
			ltr.id,
			ltr.learner_id,
			src.code,
			dst.code,
			ltr.evidence_ref,
			COALESCE(ltr.reviewed_at, ltr.requested_at)
		FROM public.learner_transfer_requests ltr
		JOIN public.schools src ON src.id = ltr.source_school_id
		JOIN public.schools dst ON dst.id = ltr.destination_school_id
		WHERE ltr.id = $1
		  AND ltr.destination_school_id = $2
		  AND ltr.status = 'approved'
	`, transferID, destinationSchoolID).Scan(
		&item.TransferID,
		&item.LearnerID,
		&item.SourceSchoolCode,
		&item.DestinationSchoolCode,
		&item.EvidenceRef,
		&item.TransferDate,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("transfer request not found")
		}
		return nil, err
	}

	return item, nil
}

func (r *Repository) ScanLearnerReconciliationCases(ctx context.Context) (int, error) {
	result, err := r.db.ExecResult(ctx, `
		INSERT INTO public.learner_reconciliation_cases (
			id,
			pair_key,
			primary_learner_id,
			candidate_learner_id,
			status,
			created_at,
			updated_at
		)
		SELECT
			gen_random_uuid(),
			CASE
				WHEN l1.id::text < l2.id::text THEN l1.id::text || ':' || l2.id::text
				ELSE l2.id::text || ':' || l1.id::text
			END AS pair_key,
			CASE WHEN l1.id::text < l2.id::text THEN l1.id ELSE l2.id END AS primary_learner_id,
			CASE WHEN l1.id::text < l2.id::text THEN l2.id ELSE l1.id END AS candidate_learner_id,
			'pending',
			NOW(),
			NOW()
		FROM public.learners l1
		JOIN public.learners l2 ON l1.id <> l2.id
		WHERE l1.id::text < l2.id::text
		  AND COALESCE(l1.merge_status, 'active') = 'active'
		  AND COALESCE(l2.merge_status, 'active') = 'active'
		  AND TRIM(COALESCE(l1.full_name, '')) <> ''
		  AND TRIM(COALESCE(l2.full_name, '')) <> ''
		  AND l1.date_of_birth IS NOT NULL
		  AND l2.date_of_birth IS NOT NULL
		  AND LOWER(TRIM(l1.full_name)) = LOWER(TRIM(l2.full_name))
		  AND l1.date_of_birth = l2.date_of_birth
		ON CONFLICT (pair_key) DO NOTHING
	`)
	if err != nil {
		return 0, err
	}

	return int(result.RowsAffected()), nil
}

func (r *Repository) ListLearnerReconciliationCases(ctx context.Context, status string, page, pageSize int) ([]LearnerReconciliationCaseItem, int, error) {
	offset := (page - 1) * pageSize
	whereClause := "1=1"
	args := make([]interface{}, 0, 3)

	if status != "" {
		whereClause = "lrc.status = $1"
		args = append(args, status)
	}

	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM public.learner_reconciliation_cases lrc
		WHERE %s
	`, whereClause)

	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	argNum := len(args) + 1
	query := fmt.Sprintf(`
		SELECT
			lrc.id,
			lrc.pair_key,
			lrc.primary_learner_id,
			lrc.candidate_learner_id,
			lrc.status,
			lrc.resolution,
			lrc.review_note,
			lrc.merged_from_learner_id,
			lrc.merged_into_learner_id,
			lrc.reviewed_by,
			lrc.reviewed_at,
			lrc.created_at,
			lrc.updated_at,
			pl.full_name,
			cl.full_name,
			pl.apaar_id,
			cl.apaar_id,
			pl.abc_id,
			cl.abc_id,
			TO_CHAR(pl.date_of_birth, 'YYYY-MM-DD') AS primary_dob,
			TO_CHAR(cl.date_of_birth, 'YYYY-MM-DD') AS candidate_dob
		FROM public.learner_reconciliation_cases lrc
		JOIN public.learners pl ON pl.id = lrc.primary_learner_id
		JOIN public.learners cl ON cl.id = lrc.candidate_learner_id
		WHERE %s
		ORDER BY lrc.created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)

	args = append(args, pageSize, offset)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]LearnerReconciliationCaseItem, 0, pageSize)
	for rows.Next() {
		var item LearnerReconciliationCaseItem
		if err := rows.Scan(
			&item.ID,
			&item.PairKey,
			&item.PrimaryLearnerID,
			&item.CandidateLearnerID,
			&item.Status,
			&item.Resolution,
			&item.ReviewNote,
			&item.MergedFromLearnerID,
			&item.MergedIntoLearnerID,
			&item.ReviewedBy,
			&item.ReviewedAt,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.PrimaryLearnerName,
			&item.CandidateLearnerName,
			&item.PrimaryApaarID,
			&item.CandidateApaarID,
			&item.PrimaryAbcID,
			&item.CandidateAbcID,
			&item.PrimaryDateOfBirth,
			&item.CandidateDateOfBirth,
		); err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

func (r *Repository) ReviewLearnerReconciliationCase(ctx context.Context, reviewerID, caseID uuid.UUID, action string, survivorLearnerID *uuid.UUID, reviewNote *string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	var primaryLearnerID uuid.UUID
	var candidateLearnerID uuid.UUID

	err = tx.QueryRow(ctx, `
		SELECT status, primary_learner_id, candidate_learner_id
		FROM public.learner_reconciliation_cases
		WHERE id = $1
		FOR UPDATE
	`, caseID).Scan(&status, &primaryLearnerID, &candidateLearnerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("reconciliation case not found")
		}
		return err
	}

	if status != "pending" {
		return fmt.Errorf("reconciliation case already reviewed")
	}

	if action == "dismiss" {
		if _, err := tx.Exec(ctx, `
			UPDATE public.learner_reconciliation_cases
			SET status = 'dismissed',
				resolution = 'dismissed',
				review_note = NULLIF(TRIM($2), ''),
				reviewed_by = $3,
				reviewed_at = NOW(),
				updated_at = NOW()
			WHERE id = $1
		`, caseID, trimmedOrEmpty(reviewNote), reviewerID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	survivorID := primaryLearnerID
	if survivorLearnerID != nil {
		survivorID = *survivorLearnerID
	}

	if survivorID != primaryLearnerID && survivorID != candidateLearnerID {
		return fmt.Errorf("invalid survivor learner id")
	}

	mergedFromID := candidateLearnerID
	if survivorID == candidateLearnerID {
		mergedFromID = primaryLearnerID
	}

	cmd, err := tx.Exec(ctx, `
		UPDATE public.learners
		SET merge_status = 'merged',
			merged_into_learner_id = $2,
			updated_at = NOW()
		WHERE id = $1
		  AND COALESCE(merge_status, 'active') = 'active'
	`, mergedFromID, survivorID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return fmt.Errorf("candidate learner already merged")
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO public.learner_merge_history (
			id,
			reconciliation_case_id,
			source_learner_id,
			target_learner_id,
			merged_by,
			merge_note,
			merged_at,
			created_at,
			updated_at
		)
		VALUES (
			gen_random_uuid(),
			$1,
			$2,
			$3,
			$4,
			NULLIF(TRIM($5), ''),
			NOW(),
			NOW(),
			NOW()
		)
	`, caseID, mergedFromID, survivorID, reviewerID, trimmedOrEmpty(reviewNote)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.learner_reconciliation_cases
		SET status = 'resolved',
			resolution = 'merged',
			review_note = NULLIF(TRIM($2), ''),
			merged_from_learner_id = $3,
			merged_into_learner_id = $4,
			reviewed_by = $5,
			reviewed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, caseID, trimmedOrEmpty(reviewNote), mergedFromID, survivorID, reviewerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (r *Repository) UnmergeLearnerReconciliationCase(ctx context.Context, reviewerID, caseID uuid.UUID, reviewNote *string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var resolution *string
	err = tx.QueryRow(ctx, `
		SELECT resolution
		FROM public.learner_reconciliation_cases
		WHERE id = $1
		FOR UPDATE
	`, caseID).Scan(&resolution)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("reconciliation case not found")
		}
		return err
	}

	if resolution == nil || *resolution != "merged" {
		return fmt.Errorf("reconciliation case is not merged")
	}

	var historyID uuid.UUID
	var sourceLearnerID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id, source_learner_id
		FROM public.learner_merge_history
		WHERE reconciliation_case_id = $1
		  AND unmerged_at IS NULL
		ORDER BY merged_at DESC
		LIMIT 1
		FOR UPDATE
	`, caseID).Scan(&historyID, &sourceLearnerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("merge history not found")
		}
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.learners
		SET merge_status = 'active',
			merged_into_learner_id = NULL,
			updated_at = NOW()
		WHERE id = $1
	`, sourceLearnerID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.learner_merge_history
		SET unmerged_by = $2,
			unmerge_note = NULLIF(TRIM($3), ''),
			unmerged_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, historyID, reviewerID, trimmedOrEmpty(reviewNote)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.learner_reconciliation_cases
		SET resolution = 'unmerged',
			review_note = NULLIF(TRIM($2), ''),
			reviewed_by = $3,
			reviewed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, caseID, trimmedOrEmpty(reviewNote), reviewerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
