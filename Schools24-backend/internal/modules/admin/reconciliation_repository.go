package admin

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Identity Verification Repository
// ---------------------------------------------------------------------------

// GetStudentFederatedIdentity fetches a student's federated ID fields.
func (r *Repository) GetStudentFederatedIdentity(ctx context.Context, schoolID, studentID uuid.UUID) (*StudentFederatedIdentity, error) {
	var s StudentFederatedIdentity
	err := r.db.QueryRow(ctx, `
		SELECT
			id, school_id,
			COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''),
			apaar_id, abc_id,
			apaar_verified_at, abc_verified_at,
			COALESCE(identity_verification_status, 'unverified')
		FROM students
		WHERE id = $1 AND school_id = $2
	`, studentID, schoolID).Scan(
		&s.ID, &s.SchoolID,
		&s.FullName,
		&s.APAARID, &s.ABCID,
		&s.APAARVerifiedAt, &s.ABCVerifiedAt,
		&s.IdentityVerificationStatus,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// UpdateIdentityVerificationStatus updates a student's verification status and timestamps.
func (r *Repository) UpdateIdentityVerificationStatus(ctx context.Context, studentID uuid.UUID, status string, apaarVerifiedAt, abcVerifiedAt *time.Time) error {
	return r.db.Exec(ctx, `
		UPDATE students
		SET
			identity_verification_status = $2,
			apaar_verified_at = $3,
			abc_verified_at = $4
		WHERE id = $1
	`, studentID, strings.TrimSpace(status), apaarVerifiedAt, abcVerifiedAt)
}

// ListUnverifiedStudents lists students with federated IDs that haven't been verified.
func (r *Repository) ListUnverifiedStudents(ctx context.Context, schoolID uuid.UUID, limit int) ([]StudentFederatedIdentity, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.Query(ctx, `
		SELECT
			id, school_id,
			COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''),
			apaar_id, abc_id,
			apaar_verified_at, abc_verified_at,
			COALESCE(identity_verification_status, 'unverified')
		FROM students
		WHERE school_id = $1
		  AND (apaar_id IS NOT NULL OR abc_id IS NOT NULL)
		  AND COALESCE(identity_verification_status, 'unverified') <> 'verified'
		ORDER BY created_at DESC
		LIMIT $2
	`, schoolID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]StudentFederatedIdentity, 0, limit)
	for rows.Next() {
		var s StudentFederatedIdentity
		if err := rows.Scan(
			&s.ID, &s.SchoolID,
			&s.FullName,
			&s.APAARID, &s.ABCID,
			&s.APAARVerifiedAt, &s.ABCVerifiedAt,
			&s.IdentityVerificationStatus,
		); err != nil {
			return nil, err
		}
		items = append(items, s)
	}
	return items, rows.Err()
}

// GetReconciliationSummary returns counts of reconciliation cases by status.
func (r *Repository) GetReconciliationSummary(ctx context.Context) (*ReconciliationSummary, error) {
	var s ReconciliationSummary
	err := r.db.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status = 'pending'),
			COUNT(*) FILTER (WHERE status = 'merged'),
			COUNT(*) FILTER (WHERE status = 'dismissed'),
			COUNT(*) FILTER (WHERE status = 'unmerged')
		FROM public.learner_reconciliation_cases
	`).Scan(
		&s.Total, &s.Pending, &s.Merged, &s.Dismissed, &s.Unmerged,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
