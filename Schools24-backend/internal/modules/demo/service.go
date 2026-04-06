package demo

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/modules/auth"
	"github.com/schools24/backend/internal/modules/school"
)

var (
	ErrInvalidStatus     = errors.New("invalid demo request status")
	ErrRequestNotFound   = errors.New("demo request not found")
	ErrRequestNotPending = errors.New("demo request is not pending")
	errSchoolCodeExists  = errors.New("school code already exists")
	udiseCodeRegex       = regexp.MustCompile(`^UDISE[0-9]{6,14}$`)
	internalCodeRegex    = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_-]{0,29}$`)
)

type Service struct {
	repo          *Repository
	authRepo      *auth.Repository
	authService   *auth.Service
	schoolService *school.Service
	secret        string
}

func NewService(repo *Repository, authRepo *auth.Repository, authService *auth.Service, schoolService *school.Service, secret string) *Service {
	return &Service{repo: repo, authRepo: authRepo, authService: authService, schoolService: schoolService, secret: secret}
}

func (s *Service) CreatePublicRequest(ctx context.Context, req CreatePublicDemoRequest, sourceIP string) (*DemoRequest, error) {
	normalized := req.CreateSchoolRequest
	normalized.Name = strings.TrimSpace(normalized.Name)
	normalized.Code = strings.TrimSpace(strings.ToUpper(normalized.Code))
	normalized.Address = strings.TrimSpace(normalized.Address)
	normalized.ContactEmail = strings.TrimSpace(strings.ToLower(normalized.ContactEmail))

	if normalized.Name == "" {
		return nil, fmt.Errorf("school name is required")
	}
	if len(normalized.Admins) == 0 {
		return nil, fmt.Errorf("at least one admin is required")
	}
	if err := validateSchoolCode(normalized.Code); err != nil {
		return nil, err
	}
	if exists, err := s.repo.SchoolCodeExists(ctx, normalized.Code); err != nil {
		return nil, err
	} else if exists {
		return nil, errSchoolCodeExists
	}

	seenEmails := make(map[string]struct{}, len(normalized.Admins))
	for i := range normalized.Admins {
		normalized.Admins[i].Name = strings.TrimSpace(normalized.Admins[i].Name)
		normalized.Admins[i].Email = strings.ToLower(strings.TrimSpace(normalized.Admins[i].Email))
		email := normalized.Admins[i].Email
		if email == "" {
			return nil, fmt.Errorf("admin email is required")
		}
		if _, exists := seenEmails[email]; exists {
			return nil, auth.ErrEmailExists
		}
		seenEmails[email] = struct{}{}
		exists, err := s.authRepo.EmailExists(ctx, email)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, auth.ErrEmailExists
		}
	}

	secretPayload, err := encryptAdmins(s.secret, normalized.Admins)
	if err != nil {
		return nil, err
	}

	return s.repo.CreatePublicRequest(ctx, normalized, makeAdminViews(normalized.Admins), secretPayload, sourceIP)
}

func (s *Service) ListRequests(ctx context.Context, params DemoRequestListParams) (*DemoRequestListResponse, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 100 {
		params.PageSize = 20
	}
	if params.Month < 0 || params.Month > 12 {
		params.Month = 0
	}
	if params.Status != "" && params.Status != "pending" && params.Status != "accepted" && params.Status != "trashed" {
		return nil, ErrInvalidStatus
	}

	requests, total, years, err := s.repo.ListRequests(ctx, params)
	if err != nil {
		return nil, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(params.PageSize)))
	return &DemoRequestListResponse{
		Requests:       requests,
		Total:          total,
		Page:           params.Page,
		PageSize:       params.PageSize,
		TotalPages:     totalPages,
		AvailableYears: years,
	}, nil
}

func (s *Service) GetStats(ctx context.Context, year, month int) (*DemoRequestStatsResponse, error) {
	return s.repo.GetStats(ctx, year, month)
}

func (s *Service) AcceptRequest(ctx context.Context, requestID, superAdminID uuid.UUID, password string) (*DemoRequest, error) {
	record, err := s.repo.GetRequestRecordByID(ctx, requestID)
	if err != nil {
		return nil, err
	}
	if record.Status != "pending" {
		return nil, ErrRequestNotPending
	}

	admins, err := decryptAdmins(s.secret, record.AdminsSecret)
	if err != nil {
		return nil, err
	}

	createdSchool, err := s.schoolService.CreateSchoolWithAdmin(ctx, superAdminID, password, &school.CreateSchoolRequest{
		Name:         record.SchoolName,
		Code:         derefString(record.SchoolCode),
		Address:      derefString(record.Address),
		ContactEmail: derefString(record.ContactEmail),
		Admins:       admins,
	})
	if err != nil {
		return nil, err
	}

	return s.repo.MarkAccepted(ctx, requestID, superAdminID, createdSchool.ID)
}

func (s *Service) TrashRequest(ctx context.Context, requestID, superAdminID uuid.UUID, password string) (*DemoRequest, error) {
	if err := s.authService.VerifySuperAdminPassword(ctx, superAdminID, password); err != nil {
		return nil, err
	}
	record, err := s.repo.GetRequestRecordByID(ctx, requestID)
	if err != nil {
		return nil, err
	}
	if record.Status != "pending" {
		return nil, ErrRequestNotPending
	}
	return s.repo.MarkTrashed(ctx, requestID, superAdminID)
}

func (s *Service) CleanupOldTrashedRequests(ctx context.Context) error {
	return s.repo.DeleteExpiredTrashed(ctx)
}

func validateSchoolCode(code string) error {
	if code == "" {
		return nil
	}
	if strings.HasPrefix(code, "UDISE") {
		if !udiseCodeRegex.MatchString(code) {
			return fmt.Errorf("invalid school code: UDISE codes must be in format UDISE followed by 6-14 digits")
		}
		return nil
	}
	if !internalCodeRegex.MatchString(code) {
		return fmt.Errorf("invalid school code: internal code must be 1-30 chars using A-Z, 0-9, underscore, or hyphen")
	}
	return nil
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
