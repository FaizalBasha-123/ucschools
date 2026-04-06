package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/objectstore"
)

func (r *Repository) CreateTeacherAppointmentDecision(
	ctx context.Context,
	schoolID uuid.UUID,
	app *TeacherAppointmentApplication,
	decision string,
	reason *string,
	reviewerID *uuid.UUID,
	createdTeacherUserID *uuid.UUID,
) error {
	if err := r.db.Exec(ctx, `
		INSERT INTO teacher_appointment_decisions (
			school_id, application_id, applicant_name, applicant_email, applicant_phone,
			subject_expertise, decision, reason, reviewed_by, reviewed_at, created_teacher_user_id
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, NOW(), $10
		)
	`,
		schoolID,
		app.ID,
		app.FullName,
		app.Email,
		nullIfEmpty(app.Phone),
		app.SubjectExpertise,
		decision,
		reason,
		reviewerID,
		createdTeacherUserID,
	); err != nil {
		return fmt.Errorf("create teacher appointment decision: %w", err)
	}
	return nil
}

func nullIfEmpty(s string) *string {
	v := strings.TrimSpace(s)
	if v == "" {
		return nil
	}
	return &v
}

func (r *Repository) ListTeacherAppointmentApplications(ctx context.Context, schoolID uuid.UUID, status string, page, pageSize int) ([]TeacherAppointmentListItem, int, error) {
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
	if status != "" && status != "all" {
		where += fmt.Sprintf(" AND status = $%d", paramIdx)
		args = append(args, status)
		paramIdx++
	}

	var total int
	if err := r.db.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM teacher_appointment_applications %s", where), args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("list teacher appointments count: %w", err)
	}

	args = append(args, pageSize, offset)
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT id, full_name, email, phone, subject_expertise, experience_years, document_count, status, academic_year, submitted_at
		FROM teacher_appointment_applications
		%s
		ORDER BY submitted_at DESC
		LIMIT $%d OFFSET $%d
	`, where, paramIdx, paramIdx+1), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list teacher appointments query: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherAppointmentListItem, 0, pageSize)
	for rows.Next() {
		var item TeacherAppointmentListItem
		if err := rows.Scan(
			&item.ID, &item.FullName, &item.Email, &item.Phone, &item.SubjectExpertise, &item.ExperienceYears,
			&item.DocumentCount, &item.Status, &item.AcademicYear, &item.SubmittedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("list teacher appointments scan: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list teacher appointments rows: %w", err)
	}
	return items, total, nil
}

func (r *Repository) GetTeacherAppointmentApplication(ctx context.Context, schoolID, appID uuid.UUID) (*TeacherAppointmentApplication, error) {
	row := r.db.QueryRow(ctx, `
		SELECT
			id, school_id, academic_year, full_name, email, phone, date_of_birth::text, gender, address,
			highest_qualification, professional_degree, eligibility_test, subject_expertise,
			experience_years, current_school, expected_salary, notice_period_days, cover_letter,
			has_aadhaar_card, has_pan_card, has_voter_or_passport, has_marksheets_10_12,
			has_degree_certificates, has_bed_med_certificate, has_ctet_stet_result, has_relieving_letter,
			has_experience_certificate, has_salary_slips, has_epf_uan_number, has_police_verification,
			has_medical_fitness_cert, has_character_certificate, has_passport_photos,
			document_count, status, reviewed_by, reviewed_at, rejection_reason, created_teacher_user_id,
			submitted_at, updated_at
		FROM teacher_appointment_applications
		WHERE id = $1 AND school_id = $2
		LIMIT 1
	`, appID, schoolID)

	var app TeacherAppointmentApplication
	if err := row.Scan(
		&app.ID, &app.SchoolID, &app.AcademicYear, &app.FullName, &app.Email, &app.Phone, &app.DateOfBirth, &app.Gender, &app.Address,
		&app.HighestQualification, &app.ProfessionalDegree, &app.EligibilityTest, &app.SubjectExpertise,
		&app.ExperienceYears, &app.CurrentSchool, &app.ExpectedSalary, &app.NoticePeriodDays, &app.CoverLetter,
		&app.HasAadhaarCard, &app.HasPanCard, &app.HasVoterOrPassport, &app.HasMarksheets1012,
		&app.HasDegreeCertificates, &app.HasBedMedCertificate, &app.HasCtetStetResult, &app.HasRelievingLetter,
		&app.HasExperienceCert, &app.HasSalarySlips, &app.HasEpfUanNumber, &app.HasPoliceVerification,
		&app.HasMedicalFitnessCert, &app.HasCharacterCert, &app.HasPassportPhotos,
		&app.DocumentCount, &app.Status, &app.ReviewedBy, &app.ReviewedAt, &app.RejectionReason, &app.CreatedTeacherUserID,
		&app.SubmittedAt, &app.UpdatedAt,
	); err != nil {
		if isAdminNoRows(err) {
			return nil, errors.New("application_not_found")
		}
		return nil, fmt.Errorf("get teacher appointment: %w", err)
	}
	return &app, nil
}

func (r *Repository) RejectTeacherAppointmentApplication(ctx context.Context, schoolID, appID, reviewerID uuid.UUID, reason *string) error {
	now := time.Now()
	if err := r.db.Exec(ctx, `
		UPDATE teacher_appointment_applications
		SET status = 'rejected',
		    reviewed_by = $1,
		    reviewed_at = $2,
		    rejection_reason = $3,
		    updated_at = $2
		WHERE id = $4 AND school_id = $5
	`, reviewerID, now, reason, appID, schoolID); err != nil {
		return fmt.Errorf("reject teacher appointment: %w", err)
	}
	return nil
}

func (r *Repository) ApproveTeacherAppointmentApplication(ctx context.Context, schoolID, appID, reviewerID, createdTeacherUserID uuid.UUID) error {
	now := time.Now()
	if err := r.db.Exec(ctx, `
		UPDATE teacher_appointment_applications
		SET status = 'approved',
		    reviewed_by = $1,
		    reviewed_at = $2,
		    created_teacher_user_id = $3,
		    updated_at = $2
		WHERE id = $4 AND school_id = $5
	`, reviewerID, now, createdTeacherUserID, appID, schoolID); err != nil {
		return fmt.Errorf("approve teacher appointment: %w", err)
	}
	return nil
}

func (r *Repository) DeleteTeacherAppointmentApplication(ctx context.Context, schoolID, appID uuid.UUID) error {
	if err := r.db.Exec(ctx, `
		DELETE FROM teacher_appointment_applications
		WHERE id = $1 AND school_id = $2
	`, appID, schoolID); err != nil {
		return fmt.Errorf("delete teacher appointment: %w", err)
	}
	return nil
}

func (r *Repository) ListTeacherAppointmentDocuments(ctx context.Context, schoolID, appID string) ([]TeacherAppointmentDocumentMeta, error) {
	if r.db == nil {
		return []TeacherAppointmentDocumentMeta{}, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT id::text, document_type, file_name, file_size, mime_type, uploaded_at
		FROM teacher_appointment_documents
		WHERE school_id = $1 AND application_id = $2
		ORDER BY uploaded_at DESC
	`, schoolID, appID)
	if err != nil {
		return nil, fmt.Errorf("list teacher appointment documents: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherAppointmentDocumentMeta, 0)
	for rows.Next() {
		var raw TeacherAppointmentDocumentMeta
		if err := rows.Scan(&raw.ID, &raw.DocumentType, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.UploadedAt); err != nil {
			return nil, fmt.Errorf("scan teacher appointment document meta: %w", err)
		}
		items = append(items, TeacherAppointmentDocumentMeta{
			ID:           raw.ID,
			DocumentType: raw.DocumentType,
			FileName:     raw.FileName,
			FileSize:     raw.FileSize,
			MimeType:     raw.MimeType,
			UploadedAt:   raw.UploadedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate teacher appointment documents: %w", err)
	}
	return items, nil
}

func (r *Repository) GetTeacherAppointmentDocument(ctx context.Context, schoolID, appID, docID string) (string, string, []byte, error) {
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
		FROM teacher_appointment_documents
		WHERE id::text = $1 AND school_id = $2 AND application_id = $3
		LIMIT 1
	`, strings.TrimSpace(docID), schoolID, appID).Scan(&raw.FileName, &raw.MimeType, &raw.StorageKey); err != nil {
		return "", "", nil, fmt.Errorf("get teacher appointment document: %w", err)
	}
	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return "", "", nil, fmt.Errorf("get teacher appointment document content: %w", err)
	}
	return raw.FileName, raw.MimeType, content, nil
}

func (r *Repository) DeleteTeacherAppointmentDocuments(ctx context.Context, schoolID, appID string) error {
	if r.db == nil {
		return nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT storage_key
		FROM teacher_appointment_documents
		WHERE school_id = $1 AND application_id = $2
	`, schoolID, appID)
	if err != nil {
		return fmt.Errorf("delete teacher appointment documents: %w", err)
	}
	defer rows.Close()

	var storageKeys []string
	for rows.Next() {
		var storageKey string
		if err := rows.Scan(&storageKey); err != nil {
			return fmt.Errorf("delete teacher appointment documents: %w", err)
		}
		if strings.TrimSpace(storageKey) != "" {
			storageKeys = append(storageKeys, storageKey)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("delete teacher appointment documents: %w", err)
	}
	for _, storageKey := range storageKeys {
		if err := objectstore.DeleteDocumentWithFallback(ctx, r.store, storageKey); err != nil {
			return fmt.Errorf("delete teacher appointment r2 object: %w", err)
		}
	}
	if err := r.db.Exec(ctx, `
		DELETE FROM teacher_appointment_documents
		WHERE school_id = $1 AND application_id = $2
	`, schoolID, appID); err != nil {
		return fmt.Errorf("delete teacher appointment documents: %w", err)
	}
	return nil
}

func (r *Repository) ListTeacherAppointmentDecisions(ctx context.Context, schoolID uuid.UUID, page, pageSize int) ([]TeacherAppointmentDecisionItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	var total int
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM teacher_appointment_decisions WHERE school_id = $1
	`, schoolID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("list teacher appointment decisions count: %w", err)
	}

	rows, err := r.db.Query(ctx, `
		SELECT id, application_id, applicant_name, applicant_email, applicant_phone, subject_expertise,
		       decision, reason, reviewed_by, reviewed_at, created_teacher_user_id, created_at
		FROM teacher_appointment_decisions
		WHERE school_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, schoolID, pageSize, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list teacher appointment decisions query: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherAppointmentDecisionItem, 0, pageSize)
	for rows.Next() {
		var item TeacherAppointmentDecisionItem
		if err := rows.Scan(
			&item.ID,
			&item.ApplicationID,
			&item.ApplicantName,
			&item.ApplicantEmail,
			&item.ApplicantPhone,
			&item.SubjectExpertise,
			&item.Decision,
			&item.Reason,
			&item.ReviewedBy,
			&item.ReviewedAt,
			&item.CreatedTeacherUserID,
			&item.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("list teacher appointment decisions scan: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list teacher appointment decisions rows: %w", err)
	}
	return items, total, nil
}
