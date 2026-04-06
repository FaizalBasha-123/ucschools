package public

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/objectstore"
)

func (r *Repository) InsertTeacherAppointmentApplication(
	ctx context.Context,
	schoolID uuid.UUID,
	req *SubmitTeacherAppointmentRequest,
	docFlags map[string]bool,
	docCount int,
) (uuid.UUID, time.Time, error) {
	var id uuid.UUID
	var submittedAt time.Time

	nullStr := func(s string) *string {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		return &s
	}
	nullInt := func(v int) *int {
		if v <= 0 {
			return nil
		}
		return &v
	}
	nullFloat := func(s string) *float64 {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		parsed, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return &parsed
	}
	nullDate := func(s string) *string {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		return &s
	}

	row := r.db.QueryRow(ctx, `
		INSERT INTO teacher_appointment_applications (
			school_id, academic_year,
			full_name, email, phone, date_of_birth, gender, address,
			highest_qualification, professional_degree, eligibility_test, subject_expertise,
			experience_years, current_school, expected_salary, notice_period_days, cover_letter,
			has_aadhaar_card, has_pan_card, has_voter_or_passport, has_marksheets_10_12,
			has_degree_certificates, has_bed_med_certificate, has_ctet_stet_result,
			has_relieving_letter, has_experience_certificate, has_salary_slips, has_epf_uan_number,
			has_police_verification, has_medical_fitness_cert, has_character_certificate, has_passport_photos,
			document_count, status
		) VALUES (
			$1, $2,
			$3, $4, $5, $6::date, $7, $8,
			$9, $10, $11, $12,
			$13, $14, $15, $16, $17,
			$18, $19, $20, $21,
			$22, $23, $24,
			$25, $26, $27, $28,
			$29, $30, $31, $32,
			$33, 'pending'
		)
		RETURNING id, submitted_at
	`,
		schoolID,
		nullStr(req.AcademicYear),
		strings.TrimSpace(req.FullName),
		strings.TrimSpace(strings.ToLower(req.Email)),
		strings.TrimSpace(req.Phone),
		nullDate(req.DateOfBirth),
		nullStr(req.Gender),
		nullStr(req.Address),
		nullStr(req.HighestQualification),
		nullStr(req.ProfessionalDegree),
		nullStr(req.EligibilityTest),
		nullStr(req.SubjectExpertise),
		nullInt(req.ExperienceYears),
		nullStr(req.CurrentSchool),
		nullFloat(req.ExpectedSalary),
		nullInt(req.NoticePeriodDays),
		nullStr(req.CoverLetter),
		docFlags["aadhaar_card"],
		docFlags["pan_card"],
		docFlags["voter_or_passport"],
		docFlags["marksheets_10_12"],
		docFlags["degree_certificates"],
		docFlags["bed_med_certificate"],
		docFlags["ctet_stet_result"],
		docFlags["relieving_letter"],
		docFlags["experience_certificate"],
		docFlags["salary_slips"],
		docFlags["epf_uan_number"],
		docFlags["police_verification"],
		docFlags["medical_fitness_cert"],
		docFlags["character_certificate"],
		docFlags["passport_photos"],
		docCount,
	)

	if err := row.Scan(&id, &submittedAt); err != nil {
		return uuid.Nil, time.Time{}, fmt.Errorf("insert teacher appointment: %w", err)
	}
	return id, submittedAt, nil
}

func (r *Repository) SaveTeacherAppointmentDocument(ctx context.Context, schoolID, applicationID uuid.UUID, doc *TeacherAppointmentDocumentUpload) (string, error) {
	if r.db == nil {
		return "", errors.New("database not configured")
	}
	sum := sha256.Sum256(doc.Content)
	hash := hex.EncodeToString(sum[:])

	storageKey, err := objectstore.PutTeacherAppointmentDocument(ctx, r.store, schoolID.String(), applicationID.String(), doc.DocumentType, doc.FileName, doc.Content)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(storageKey) == "" {
		return "", errors.New("r2 storage is required for teacher appointment documents")
	}

	var id string
	err = r.db.QueryRow(ctx, `
		INSERT INTO teacher_appointment_documents (
			school_id, application_id, document_type,
			file_name, file_size, mime_type, file_sha256,
			storage_key, uploaded_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		RETURNING id::text
	`, schoolID.String(), applicationID.String(), strings.TrimSpace(doc.DocumentType), doc.FileName, doc.FileSize, doc.MimeType, hash, storageKey).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("save teacher appointment document: %w", err)
	}
	return id, nil
}

func (r *Repository) DeleteTeacherAppointmentApplication(ctx context.Context, schoolID, appID uuid.UUID) error {
	if r.db == nil {
		return errors.New("database not configured")
	}
	if err := r.db.Exec(ctx, `
		DELETE FROM teacher_appointment_applications
		WHERE id = $1 AND school_id = $2
	`, appID, schoolID); err != nil {
		return fmt.Errorf("delete teacher appointment application: %w", err)
	}
	return nil
}

func (r *Repository) DeleteTeacherAppointmentDocuments(ctx context.Context, schoolID, appID uuid.UUID) error {
	if r.db == nil {
		return nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT storage_key
		FROM teacher_appointment_documents
		WHERE school_id = $1 AND application_id = $2
	`, schoolID.String(), appID.String())
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
	`, schoolID.String(), appID.String()); err != nil {
		return fmt.Errorf("delete teacher appointment documents: %w", err)
	}
	return nil
}
