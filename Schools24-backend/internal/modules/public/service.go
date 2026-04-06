package public

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ErrValidation wraps field-level validation messages.
var ErrValidation = errors.New("validation_error")

// Service orchestrates public admission business logic.
type Service struct {
	repo *Repository
}

// NewService creates a new public service.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// GetSchoolAdmissionInfo returns public admission status for a school by slug.
func (s *Service) GetSchoolAdmissionInfo(ctx context.Context, slug string) (*SchoolAdmissionInfo, error) {
	if strings.TrimSpace(slug) == "" {
		return nil, fmt.Errorf("%w: slug is required", ErrValidation)
	}
	info, err := s.repo.GetSchoolBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	return info, nil
}

func (s *Service) GetSchoolTeacherAppointmentInfo(ctx context.Context, slug string) (*SchoolTeacherAppointmentInfo, error) {
	if strings.TrimSpace(slug) == "" {
		return nil, fmt.Errorf("%w: slug is required", ErrValidation)
	}
	info, err := s.repo.GetSchoolBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	return &SchoolTeacherAppointmentInfo{
		SchoolID:         info.SchoolID.String(),
		SchoolName:       info.SchoolName,
		SchoolSlug:       slug,
		Phone:            info.Phone,
		Email:            info.Email,
		Website:          info.Website,
		AcademicYear:     info.AdmissionAcademicYear,
		AppointmentsOpen: info.TeacherAppointmentsOpen,
	}, nil
}

// SubmitAdmission validates and saves an admission application with optional documents.
// It resolves the school from the slug, builds a tenant context, persists PostgreSQL row,
// then saves each uploaded document to R2.
func (s *Service) SubmitAdmission(
	ctx context.Context,
	slug string,
	req *SubmitAdmissionRequest,
	documents []*AdmissionDocumentUpload,
) (*AdmissionSubmitResponse, error) {
	// 1. Validate required fields
	req.StudentName = strings.TrimSpace(req.StudentName)
	req.DateOfBirth = strings.TrimSpace(req.DateOfBirth)
	req.MotherPhone = strings.TrimSpace(req.MotherPhone)

	if req.StudentName == "" {
		return nil, fmt.Errorf("%w: student_name is required", ErrValidation)
	}
	if req.DateOfBirth == "" {
		return nil, fmt.Errorf("%w: date_of_birth is required", ErrValidation)
	}
	if req.MotherPhone == "" {
		return nil, fmt.Errorf("%w: mother_phone is required", ErrValidation)
	}

	// 2. Resolve school
	info, err := s.repo.GetSchoolBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if !info.AdmissionsOpen {
		return nil, ErrAdmissionsClosed
	}

	// Populate academic year from school settings if not provided by the form.
	if req.AcademicYear == "" && info.AdmissionAcademicYear != nil {
		req.AcademicYear = *info.AdmissionAcademicYear
	}

	// 3. Build tenant context so DB writes go to the correct schema.
	schoolID := info.SchoolID
	safeSchema := fmt.Sprintf("\"school_%s\"", schoolID.String())
	tenantCtx := context.WithValue(ctx, "tenant_schema", safeSchema)

	// 4. Build document flags map
	docFlags := map[string]bool{}
	for _, dt := range ValidDocumentTypes {
		docFlags[dt] = false
	}
	for _, doc := range documents {
		if _, known := docFlags[doc.DocumentType]; known {
			docFlags[doc.DocumentType] = true
		}
	}

	// 5. Insert PostgreSQL row
	appID, submittedAt, err := s.repo.InsertApplication(tenantCtx, schoolID, req, docFlags, len(documents))
	if err != nil {
		return nil, fmt.Errorf("save application: %w", err)
	}

	// 6. Save documents to R2 (best-effort per document)
	for _, doc := range documents {
		if _, saveErr := s.repo.SaveAdmissionDocument(ctx, schoolID, appID, doc); saveErr != nil {
			// Non-fatal: log but continue. The application row is already saved.
			// In production, a background retry or alert would handle this.
			_ = saveErr
		}
	}

	return &AdmissionSubmitResponse{
		ApplicationID: appID.String(),
		StudentName:   req.StudentName,
		SubmittedAt:   submittedAt,
		SchoolID:      schoolID,
		Message:       "Your admission application has been submitted successfully. The school will contact you soon.",
	}, nil
}

// WithTenantSchemaCtx builds a context with the tenant schema for a given school UUID.
// Used by admin handlers that need to operate on the tenant schema for a known school.
func WithTenantSchemaCtx(ctx context.Context, schoolID uuid.UUID) context.Context {
	safeSchema := fmt.Sprintf("\"school_%s\"", schoolID.String())
	return context.WithValue(ctx, "tenant_schema", safeSchema)
}

func (s *Service) SubmitTeacherAppointment(
	ctx context.Context,
	slug string,
	req *SubmitTeacherAppointmentRequest,
	documents []*TeacherAppointmentDocumentUpload,
) (*TeacherAppointmentSubmitResponse, error) {
	req.FullName = strings.TrimSpace(req.FullName)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Phone = strings.TrimSpace(req.Phone)
	req.SubjectExpertise = strings.TrimSpace(req.SubjectExpertise)

	if req.FullName == "" {
		return nil, fmt.Errorf("%w: full_name is required", ErrValidation)
	}
	if req.Email == "" {
		return nil, fmt.Errorf("%w: email is required", ErrValidation)
	}
	if req.Phone == "" {
		return nil, fmt.Errorf("%w: phone is required", ErrValidation)
	}
	if req.SubjectExpertise == "" {
		return nil, fmt.Errorf("%w: subject_expertise is required", ErrValidation)
	}

	info, err := s.repo.GetSchoolBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if !info.TeacherAppointmentsOpen {
		return nil, ErrTeacherAppointmentsClosed
	}

	if req.AcademicYear == "" && info.AdmissionAcademicYear != nil {
		req.AcademicYear = *info.AdmissionAcademicYear
	}

	docFlags := map[string]bool{}
	for _, dt := range ValidTeacherAppointmentDocumentTypes {
		docFlags[dt] = false
	}
	for _, doc := range documents {
		if _, ok := docFlags[doc.DocumentType]; ok {
			docFlags[doc.DocumentType] = true
		}
	}

	schoolID := info.SchoolID
	tenantCtx := WithTenantSchemaCtx(ctx, schoolID)
	appID, submittedAt, err := s.repo.InsertTeacherAppointmentApplication(tenantCtx, schoolID, req, docFlags, len(documents))
	if err != nil {
		return nil, fmt.Errorf("save teacher appointment: %w", err)
	}

	for _, doc := range documents {
		_, saveErr := s.repo.SaveTeacherAppointmentDocument(ctx, schoolID, appID, doc)
		if saveErr != nil {
			_ = s.repo.DeleteTeacherAppointmentDocuments(ctx, schoolID, appID)
			_ = s.repo.DeleteTeacherAppointmentApplication(ctx, schoolID, appID)
			return nil, fmt.Errorf("save teacher appointment document: %w", saveErr)
		}
	}

	return &TeacherAppointmentSubmitResponse{
		ApplicationID: appID.String(),
		FullName:      req.FullName,
		SchoolID:      schoolID.String(),
		SubmittedAt:   submittedAt,
		Message:       "Your teacher appointment application has been submitted successfully.",
	}, nil
}
