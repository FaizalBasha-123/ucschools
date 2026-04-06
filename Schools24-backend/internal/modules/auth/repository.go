package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/shared/database"
)

// Repository handles database operations for auth
type Repository struct {
	db *database.PostgresDB
}

// NewRepository creates a new auth repository
func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

// CreateUser creates a new user in the database
func (r *Repository) CreateUser(ctx context.Context, user *User) error {
	query := `
		INSERT INTO users (id, email, password_hash, role, full_name, phone, school_id, email_verified, created_by, created_at, updated_at)
		VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at, updated_at
	`

	now := time.Now()
	user.ID = uuid.New()
	// user.IsActive = true // Removed as per instruction
	user.EmailVerified = false
	user.CreatedAt = now
	user.UpdatedAt = now

	err := r.db.QueryRow(ctx, query,
		user.ID,
		user.Email,
		user.PasswordHash,
		user.Role,
		user.FullName,
		user.Phone,
		user.SchoolID,
		// user.IsActive, // Removed as per instruction
		user.EmailVerified,
		user.CreatedBy,
		user.CreatedAt,
		user.UpdatedAt,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

// CreateSuperAdmin creates a new super admin in the database
func (r *Repository) CreateSuperAdmin(ctx context.Context, sa *SuperAdmin) error {
	query := `
		INSERT INTO super_admins (
			id, email, password_hash, full_name, phone, profile_picture_url,
			email_verified, created_at, updated_at
		)
		VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at
	`

	now := time.Now()
	sa.ID = uuid.New()
	sa.EmailVerified = true
	sa.CreatedAt = now
	sa.UpdatedAt = now

	err := r.db.QueryRow(ctx, query,
		sa.ID,
		sa.Email,
		sa.PasswordHash,
		sa.FullName,
		sa.Phone,
		sa.ProfilePictureURL,
		sa.EmailVerified,
		sa.CreatedAt,
		sa.UpdatedAt,
	).Scan(&sa.ID, &sa.CreatedAt, &sa.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create super admin: %w", err)
	}

	return nil
}

// GetSuperAdminByEmail retrieves a super admin by email (separate table)
func (r *Repository) GetSuperAdminByEmail(ctx context.Context, email string) (*SuperAdmin, error) {
	query := `
		SELECT id, email, password_hash, full_name, phone, profile_picture_url,
		       email_verified, is_suspended, suspended_at, last_login_at, created_at, updated_at
		FROM super_admins
		WHERE LOWER(email) = LOWER($1)
	`

	var sa SuperAdmin
	err := r.db.QueryRow(ctx, query, strings.ToLower(email)).Scan(
		&sa.ID,
		&sa.Email,
		&sa.PasswordHash,
		&sa.FullName,
		&sa.Phone,
		&sa.ProfilePictureURL,
		&sa.EmailVerified,
		&sa.IsSuspended,
		&sa.SuspendedAt,
		&sa.LastLoginAt,
		&sa.CreatedAt,
		&sa.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get super admin by email: %w", err)
	}

	return &sa, nil
}

// ListSuperAdmins returns all super admins
func (r *Repository) ListSuperAdmins(ctx context.Context) ([]SuperAdmin, error) {
	query := `
		SELECT id, email, password_hash, full_name, phone, profile_picture_url,
		       email_verified, is_suspended, suspended_at, last_login_at, created_at, updated_at
		FROM super_admins
		ORDER BY created_at DESC
	`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list super admins: %w", err)
	}
	defer rows.Close()

	var items []SuperAdmin
	for rows.Next() {
		var sa SuperAdmin
		if err := rows.Scan(
			&sa.ID,
			&sa.Email,
			&sa.PasswordHash,
			&sa.FullName,
			&sa.Phone,
			&sa.ProfilePictureURL,
			&sa.EmailVerified,
			&sa.IsSuspended,
			&sa.SuspendedAt,
			&sa.LastLoginAt,
			&sa.CreatedAt,
			&sa.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan super admin: %w", err)
		}
		items = append(items, sa)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate super admins: %w", err)
	}

	return items, nil
}

// DeleteSuperAdminByID removes a super admin by ID
func (r *Repository) DeleteSuperAdminByID(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM super_admins WHERE id = $1`
	return r.db.Exec(ctx, query, id)
}

// SuspendSuperAdmin suspends a super admin (prevents login, preserves all content)
func (r *Repository) SuspendSuperAdmin(ctx context.Context, targetID, suspendedBy uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE super_admins
		SET is_suspended = TRUE, suspended_at = NOW(), suspended_by = $2, updated_at = NOW()
		WHERE id = $1
	`, targetID, suspendedBy)
}

// UnsuspendSuperAdmin lifts the suspension from a super admin
func (r *Repository) UnsuspendSuperAdmin(ctx context.Context, targetID uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE super_admins
		SET is_suspended = FALSE, suspended_at = NULL, suspended_by = NULL, updated_at = NOW()
		WHERE id = $1
	`, targetID)
}

// CountSuperAdmins returns the number of super admins
func (r *Repository) CountSuperAdmins(ctx context.Context) (int, error) {
	query := `SELECT COUNT(1) FROM super_admins`
	var count int
	if err := r.db.QueryRow(ctx, query).Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to count super admins: %w", err)
	}
	return count, nil
}

// GetUserByEmail retrieves a user by email (school-scoped users only)
func (r *Repository) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	schoolIDs, err := r.listActiveSchoolIDs(ctx)
	if err != nil {
		return nil, err
	}

	for _, schoolID := range schoolIDs {
		schema := fmt.Sprintf("\"school_%s\"", schoolID)
		query := fmt.Sprintf(`
			SELECT u.id, u.email, u.password_hash, u.role, u.full_name, u.phone, u.profile_picture_url,
			       u.school_id, s.name as school_name, u.email_verified, u.is_suspended, u.suspended_at,
			       u.last_login_at, u.login_count, u.created_by, u.created_at, u.updated_at
			FROM %s.users u
			LEFT JOIN schools s ON u.school_id = s.id
			WHERE LOWER(u.email) = LOWER($1)
			LIMIT 1
		`, schema)

		var u User
		err := r.db.QueryRow(ctx, query, strings.ToLower(email)).Scan(
			&u.ID,
			&u.Email,
			&u.PasswordHash,
			&u.Role,
			&u.FullName,
			&u.Phone,
			&u.ProfilePictureURL,
			&u.SchoolID,
			&u.SchoolName,
			&u.EmailVerified,
			&u.IsSuspended,
			&u.SuspendedAt,
			&u.LastLoginAt,
			&u.LoginCount,
			&u.CreatedBy,
			&u.CreatedAt,
			&u.UpdatedAt,
		)
		if err == nil {
			// Ensure school_id is populated: if the DB column was NULL but the
			// user was found in tenant schema school_<X>, use X as fallback.
			// This covers students or staff created before school_id was
			// reliably set in CreateStudentWithProfile / CreateUser.
			if u.SchoolID == nil {
				id := schoolID
				u.SchoolID = &id
			}
			return &u, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("failed to get user by email from tenant schema %s: %w", schema, err)
		}
	}

	return nil, nil
}

// GetSuperAdminByID retrieves a super admin by ID (separate table)
func (r *Repository) GetSuperAdminByID(ctx context.Context, id uuid.UUID) (*SuperAdmin, error) {
	query := `
		SELECT id, email, password_hash, full_name, phone, profile_picture_url,
		       email_verified, is_suspended, suspended_at, last_login_at, created_at, updated_at
		FROM super_admins
		WHERE id = $1
	`

	var sa SuperAdmin
	err := r.db.QueryRow(ctx, query, id).Scan(
		&sa.ID,
		&sa.Email,
		&sa.PasswordHash,
		&sa.FullName,
		&sa.Phone,
		&sa.ProfilePictureURL,
		&sa.EmailVerified,
		&sa.IsSuspended,
		&sa.SuspendedAt,
		&sa.LastLoginAt,
		&sa.CreatedAt,
		&sa.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get super admin by ID: %w", err)
	}

	return &sa, nil
}

// GetUserByID retrieves a user by ID (school-scoped users only)
func (r *Repository) GetUserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	schoolIDs, err := r.listActiveSchoolIDs(ctx)
	if err != nil {
		return nil, err
	}

	for _, schoolID := range schoolIDs {
		schema := fmt.Sprintf("\"school_%s\"", schoolID)
		query := fmt.Sprintf(`
			SELECT u.id, u.email, u.password_hash, u.role, u.full_name, u.phone, u.profile_picture_url,
			       u.school_id, s.name as school_name, u.email_verified, u.is_suspended, u.suspended_at,
			       u.last_login_at, u.login_count, u.created_by, u.created_at, u.updated_at
			FROM %s.users u
			LEFT JOIN schools s ON u.school_id = s.id
			WHERE u.id = $1
			LIMIT 1
		`, schema)

		var user User
		err := r.db.QueryRow(ctx, query, id).Scan(
			&user.ID,
			&user.Email,
			&user.PasswordHash,
			&user.Role,
			&user.FullName,
			&user.Phone,
			&user.ProfilePictureURL,
			&user.SchoolID,
			&user.SchoolName,
			&user.EmailVerified,
			&user.IsSuspended,
			&user.SuspendedAt,
			&user.LastLoginAt,
			&user.LoginCount,
			&user.CreatedBy,
			&user.CreatedAt,
			&user.UpdatedAt,
		)
		if err == nil {
			if user.SchoolID == nil {
				id := schoolID
				user.SchoolID = &id
			}
			return &user, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("failed to get user by ID from tenant schema %s: %w", schema, err)
		}
	}

	return nil, nil
}

// UpdateLastLogin updates the last login timestamp for users
func (r *Repository) UpdateLastLogin(ctx context.Context, userID uuid.UUID) error {
	query := `UPDATE users SET last_login_at = $1, updated_at = $1, login_count = login_count + 1 WHERE id = $2`
	return r.db.Exec(ctx, query, time.Now(), userID)
}

// UpdateLastLoginInSchool updates last login in a specific tenant schema and returns
// the authoritative values persisted for this successful login.
func (r *Repository) UpdateLastLoginInSchool(ctx context.Context, schoolID uuid.UUID, userID uuid.UUID) (*time.Time, int, error) {
	schema := fmt.Sprintf("\"school_%s\"", schoolID)
	now := time.Now()
	query := fmt.Sprintf(`
		UPDATE %s.users
		SET last_login_at = $1, updated_at = $1, login_count = login_count + 1
		WHERE id = $2
		RETURNING last_login_at, login_count
	`, schema)

	var lastLoginAt time.Time
	var loginCount int
	if err := r.db.QueryRow(ctx, query, now, userID).Scan(&lastLoginAt, &loginCount); err != nil {
		return nil, 0, err
	}

	return &lastLoginAt, loginCount, nil
}

// UpdateSuperAdminLastLogin updates the last login timestamp for super_admins
func (r *Repository) UpdateSuperAdminLastLogin(ctx context.Context, superAdminID uuid.UUID) error {
	query := `UPDATE super_admins SET last_login_at = $1, updated_at = $1 WHERE id = $2`
	return r.db.Exec(ctx, query, time.Now(), superAdminID)
}

// UpdateSuperAdminProfile updates super admin profile (separate table)
func (r *Repository) UpdateSuperAdminProfile(ctx context.Context, superAdminID uuid.UUID, req *UpdateProfileRequest) (*SuperAdmin, error) {
	query := `
		UPDATE super_admins 
		SET full_name = COALESCE($1, full_name),
		    phone = COALESCE($2, phone),
		    profile_picture_url = COALESCE($3, profile_picture_url),
		    updated_at = $4
		WHERE id = $5
		RETURNING id, email, password_hash, full_name, phone, profile_picture_url,
		          email_verified, last_login_at, created_at, updated_at
	`

	var sa SuperAdmin
	err := r.db.QueryRow(ctx, query,
		req.FullName,
		req.Phone,
		req.ProfilePictureURL,
		time.Now(),
		superAdminID,
	).Scan(
		&sa.ID,
		&sa.Email,
		&sa.PasswordHash,
		&sa.FullName,
		&sa.Phone,
		&sa.ProfilePictureURL,
		&sa.EmailVerified,
		&sa.LastLoginAt,
		&sa.CreatedAt,
		&sa.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to update super admin profile: %w", err)
	}

	return &sa, nil
}

// UpdateProfile updates user profile fields (school-scoped users only)
func (r *Repository) UpdateProfile(ctx context.Context, userID uuid.UUID, req *UpdateProfileRequest) (*User, error) {
	query := `
		WITH updated_user AS (
			UPDATE users 
			SET full_name = COALESCE($1, full_name),
				phone = COALESCE($2, phone),
				profile_picture_url = COALESCE($3, profile_picture_url),
				updated_at = $4
			WHERE id = $5
			RETURNING id, email, password_hash, role, full_name, phone, profile_picture_url, 
					  school_id, email_verified, last_login_at, created_at, updated_at
		)
		SELECT u.id, u.email, u.password_hash, u.role, u.full_name, u.phone, u.profile_picture_url, 
		       u.school_id, s.name as school_name, u.email_verified, u.last_login_at, u.created_at, u.updated_at
		FROM updated_user u
		LEFT JOIN schools s ON u.school_id = s.id
	`

	var user User
	err := r.db.QueryRow(ctx, query,
		req.FullName,
		req.Phone,
		req.ProfilePictureURL,
		time.Now(),
		userID,
	).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.Role,
		&user.FullName,
		&user.Phone,
		&user.ProfilePictureURL,
		&user.SchoolID,
		&user.SchoolName,
		&user.EmailVerified,
		&user.LastLoginAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to update profile: %w", err)
	}

	return &user, nil
}

// UpdateSuperAdminPassword updates password for super_admins table
func (r *Repository) UpdateSuperAdminPassword(ctx context.Context, superAdminID uuid.UUID, hashedPassword string) error {
	query := `UPDATE super_admins SET password_hash = $1, updated_at = $2 WHERE id = $3`
	return r.db.Exec(ctx, query, hashedPassword, time.Now(), superAdminID)
}

// UpdateUserPassword updates password for users table (school-scoped users)
func (r *Repository) UpdateUserPassword(ctx context.Context, userID uuid.UUID, hashedPassword string) error {
	query := `UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3`
	return r.db.Exec(ctx, query, hashedPassword, time.Now(), userID)
}

// EmailExists checks if an email already exists in users OR super_admins
func (r *Repository) EmailExists(ctx context.Context, email string) (bool, error) {
	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM super_admins WHERE LOWER(email) = LOWER($1))`, email).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return true, nil
	}

	schoolIDs, err := r.listActiveSchoolIDs(ctx)
	if err != nil {
		return false, err
	}

	for _, schoolID := range schoolIDs {
		schema := fmt.Sprintf("\"school_%s\"", schoolID)
		query := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s.users WHERE LOWER(email) = LOWER($1))`, schema)
		if err := r.db.QueryRow(ctx, query, email).Scan(&exists); err != nil {
			return false, err
		}
		if exists {
			return true, nil
		}
	}

	return false, nil
}

func (r *Repository) listActiveSchoolIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `SELECT id FROM schools WHERE deleted_at IS NULL ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("failed to list schools: %w", err)
	}
	defer rows.Close()

	ids := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan school id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate schools: %w", err)
	}

	return ids, nil
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r *Repository) CreateAuthSession(ctx context.Context, session *AuthSession) error {
	query := `
		INSERT INTO auth_sessions (
			id, user_id, school_id, role, token_family_id, refresh_token_hash,
			device_id, device_name, user_agent, client_ip, expires_at,
			last_seen_at, revoked_at, replaced_by_session_id, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11,
			$12, $13, $14, $15, $16
		)
	`
	return r.db.Exec(ctx, query,
		session.ID,
		session.UserID,
		session.SchoolID,
		session.Role,
		session.TokenFamilyID,
		session.RefreshTokenHash,
		session.DeviceID,
		session.DeviceName,
		session.UserAgent,
		session.ClientIP,
		session.ExpiresAt,
		session.LastSeenAt,
		session.RevokedAt,
		session.ReplacedBy,
		session.CreatedAt,
		session.UpdatedAt,
	)
}

func (r *Repository) GetAuthSessionByRefreshToken(ctx context.Context, refreshToken string) (*AuthSession, error) {
	query := `
		SELECT id, user_id, school_id, role, token_family_id, refresh_token_hash,
		       device_id, device_name, user_agent, client_ip, expires_at,
		       last_seen_at, revoked_at, replaced_by_session_id, created_at, updated_at
		FROM auth_sessions
		WHERE refresh_token_hash = $1
		LIMIT 1
	`

	var session AuthSession
	err := r.db.QueryRow(ctx, query, hashRefreshToken(refreshToken)).Scan(
		&session.ID,
		&session.UserID,
		&session.SchoolID,
		&session.Role,
		&session.TokenFamilyID,
		&session.RefreshTokenHash,
		&session.DeviceID,
		&session.DeviceName,
		&session.UserAgent,
		&session.ClientIP,
		&session.ExpiresAt,
		&session.LastSeenAt,
		&session.RevokedAt,
		&session.ReplacedBy,
		&session.CreatedAt,
		&session.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get auth session: %w", err)
	}
	return &session, nil
}

func (r *Repository) GetAuthSessionByID(ctx context.Context, sessionID uuid.UUID) (*AuthSession, error) {
	query := `
		SELECT id, user_id, school_id, role, token_family_id, refresh_token_hash,
		       device_id, device_name, user_agent, client_ip, expires_at,
		       last_seen_at, revoked_at, replaced_by_session_id, created_at, updated_at
		FROM auth_sessions
		WHERE id = $1
		LIMIT 1
	`

	var session AuthSession
	err := r.db.QueryRow(ctx, query, sessionID).Scan(
		&session.ID,
		&session.UserID,
		&session.SchoolID,
		&session.Role,
		&session.TokenFamilyID,
		&session.RefreshTokenHash,
		&session.DeviceID,
		&session.DeviceName,
		&session.UserAgent,
		&session.ClientIP,
		&session.ExpiresAt,
		&session.LastSeenAt,
		&session.RevokedAt,
		&session.ReplacedBy,
		&session.CreatedAt,
		&session.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get auth session by id: %w", err)
	}
	return &session, nil
}

func (r *Repository) RotateAuthSession(ctx context.Context, currentSessionID uuid.UUID, newSession *AuthSession) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin auth session rotation: %w", err)
	}
	defer tx.Rollback(ctx)

	now := time.Now()
	if _, err := tx.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = $2, replaced_by_session_id = $3, updated_at = $2
		WHERE id = $1
	`, currentSessionID, now, newSession.ID); err != nil {
		return fmt.Errorf("failed to revoke current auth session: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_sessions (
			id, user_id, school_id, role, token_family_id, refresh_token_hash,
			device_id, device_name, user_agent, client_ip, expires_at,
			last_seen_at, revoked_at, replaced_by_session_id, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11,
			$12, $13, $14, $15, $16
		)
	`,
		newSession.ID,
		newSession.UserID,
		newSession.SchoolID,
		newSession.Role,
		newSession.TokenFamilyID,
		newSession.RefreshTokenHash,
		newSession.DeviceID,
		newSession.DeviceName,
		newSession.UserAgent,
		newSession.ClientIP,
		newSession.ExpiresAt,
		newSession.LastSeenAt,
		newSession.RevokedAt,
		newSession.ReplacedBy,
		newSession.CreatedAt,
		newSession.UpdatedAt,
	); err != nil {
		return fmt.Errorf("failed to create rotated auth session: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit auth session rotation: %w", err)
	}

	return nil
}

func (r *Repository) RevokeAuthSession(ctx context.Context, sessionID uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND revoked_at IS NULL
	`, sessionID)
}

func (r *Repository) RevokeTokenFamily(ctx context.Context, familyID uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = NOW(), updated_at = NOW()
		WHERE token_family_id = $1 AND revoked_at IS NULL
	`, familyID)
}

func (r *Repository) TouchAuthSession(ctx context.Context, sessionID uuid.UUID) error {
	return r.db.Exec(ctx, `
		UPDATE auth_sessions
		SET last_seen_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, sessionID)
}

func (r *Repository) UpsertPushDeviceToken(ctx context.Context, device *PushDeviceToken) error {
	query := `
		INSERT INTO push_device_tokens (
			id, user_id, school_id, role, platform, token,
			device_id, device_name, app_version, last_seen_at, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10, $11, $12
		)
		ON CONFLICT (token) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			school_id = EXCLUDED.school_id,
			role = EXCLUDED.role,
			platform = EXCLUDED.platform,
			device_id = EXCLUDED.device_id,
			device_name = EXCLUDED.device_name,
			app_version = EXCLUDED.app_version,
			last_seen_at = EXCLUDED.last_seen_at,
			updated_at = EXCLUDED.updated_at
	`
	return r.db.Exec(ctx, query,
		device.ID,
		device.UserID,
		device.SchoolID,
		device.Role,
		device.Platform,
		device.Token,
		device.DeviceID,
		device.DeviceName,
		device.AppVersion,
		device.LastSeenAt,
		device.CreatedAt,
		device.UpdatedAt,
	)
}

func (r *Repository) DeletePushDeviceToken(ctx context.Context, userID uuid.UUID, token string, deviceID string) error {
	query := `DELETE FROM push_device_tokens WHERE user_id = $1`
	args := []any{userID}
	if strings.TrimSpace(token) != "" {
		query += ` AND token = $2`
		args = append(args, strings.TrimSpace(token))
	} else if strings.TrimSpace(deviceID) != "" {
		query += ` AND device_id = $2`
		args = append(args, strings.TrimSpace(deviceID))
	}
	if len(args) == 1 {
		query += ` AND 1=0`
	}
	return r.db.Exec(ctx, query, args...)
}

func (r *Repository) ListPushDeviceTokensByUser(ctx context.Context, userID uuid.UUID) ([]PushDeviceToken, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, user_id, school_id, role, platform, token,
		       device_id, device_name, app_version, last_seen_at, created_at, updated_at
		FROM push_device_tokens
		WHERE user_id = $1
		ORDER BY last_seen_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list push device tokens: %w", err)
	}
	defer rows.Close()

	items := make([]PushDeviceToken, 0)
	for rows.Next() {
		var item PushDeviceToken
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.SchoolID,
			&item.Role,
			&item.Platform,
			&item.Token,
			&item.DeviceID,
			&item.DeviceName,
			&item.AppVersion,
			&item.LastSeenAt,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan push device token: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate push device tokens: %w", err)
	}
	return items, nil
}
