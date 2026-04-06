package interop

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/shared/database"
)

var (
	ErrInteropDisabled  = errors.New("interop is disabled")
	ErrInvalidSystem    = errors.New("invalid interop system")
	ErrInvalidOperation = errors.New("invalid interop operation")
	ErrValidationFailed = errors.New("interop payload validation failed")
	ErrJobNotFound      = errors.New("interop job not found")
)

type Service struct {
	cfg    config.InteropConfig
	client *Client
	signer *Signer
	repo   *Repository

	sweepRunsTotal     atomic.Uint64
	sweepLockMissTotal atomic.Uint64
	sweepRetriesTotal  atomic.Uint64
	sweepErrorsTotal   atomic.Uint64
}

func NewService(cfg *config.Config, db *database.PostgresDB) *Service {
	signer := NewSigner(strings.TrimSpace(cfg.Interop.SigningSecret))
	return &Service{
		cfg:    cfg.Interop,
		client: NewClient(cfg.Interop, signer),
		signer: signer,
		repo:   NewRepository(db),
	}
}

func (s *Service) Readiness() ReadinessReport {
	missing := make([]string, 0)
	if strings.TrimSpace(s.cfg.ClientID) == "" {
		missing = append(missing, "INTEROP_CLIENT_ID")
	}
	if strings.TrimSpace(s.cfg.SigningSecret) == "" {
		missing = append(missing, "INTEROP_SIGNING_SECRET")
	}
	if strings.TrimSpace(s.cfg.DIKSHAEndpoint) == "" {
		missing = append(missing, "INTEROP_DIKSHA_ENDPOINT")
	}
	if strings.TrimSpace(s.cfg.DigiLockerEndpoint) == "" {
		missing = append(missing, "INTEROP_DIGILOCKER_ENDPOINT")
	}
	if strings.TrimSpace(s.cfg.ABCEndpoint) == "" {
		missing = append(missing, "INTEROP_ABC_ENDPOINT")
	}

	recommended := []string{
		"Register as issuer/requester partner via DigiLocker onboarding.",
		"Obtain API Setu production credentials and map to INTEROP_* env variables.",
		"Execute dry-run validation first, then enable live mode by setting INTEROP_ENABLED=true.",
	}

	return ReadinessReport{
		Enabled:         s.cfg.Enabled,
		DryRunAvailable: true,
		RequiredMissing: missing,
		Systems: map[string]bool{
			"diksha":     strings.TrimSpace(s.cfg.DIKSHAEndpoint) != "",
			"digilocker": strings.TrimSpace(s.cfg.DigiLockerEndpoint) != "",
			"abc":        strings.TrimSpace(s.cfg.ABCEndpoint) != "",
		},
		SafetyChecks: map[string]bool{
			"minor_consent_guard": true,
			"hmac_signing":        s.signer != nil && s.signer.Enabled(),
			"retry_policy":        s.cfg.MaxRetries > 0,
			"dlq_retry_sweeper":   s.cfg.RetrySweepEnabled,
			"payload_validation":  true,
		},
		RecommendedNext: recommended,
	}
}

func (s *Service) CreateJob(ctx context.Context, req CreateJobRequest, requestedBy, requestedRole, schoolID string) (*InteropJob, error) {
	job, _, err := s.CreateJobWithMeta(ctx, req, requestedBy, requestedRole, schoolID)
	if err != nil {
		return nil, err
	}
	return job, nil
}

// CreateJobWithMeta returns job + idempotency hit marker for API handlers.
func (s *Service) CreateJobWithMeta(ctx context.Context, req CreateJobRequest, requestedBy, requestedRole, schoolID string) (*InteropJob, bool, error) {
	if err := validateRequest(req); err != nil {
		return nil, false, err
	}
	if err := validateLegalGuards(req.Payload); err != nil {
		return nil, false, err
	}
	if !req.DryRun && !s.cfg.Enabled {
		return nil, false, ErrInteropDisabled
	}
	parsedSchoolID, err := uuid.Parse(strings.TrimSpace(schoolID))
	if err != nil {
		return nil, false, fmt.Errorf("%w: school_id is required", ErrValidationFailed)
	}

	maxRetries := s.cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	// Idempotency check: if key provided, return cached job if it exists
	if req.IdempotencyKey != "" {
		existing, err := s.repo.FindJobByIdempotencyKey(ctx, parsedSchoolID, req.IdempotencyKey)
		if err == nil && existing != nil {
			return existing, true, nil
		}
		// If not found (err != nil), proceed to create
	}

	job, err := s.repo.CreateJob(ctx, req, requestedBy, requestedRole, parsedSchoolID, maxRetries)
	if err != nil {
		if req.IdempotencyKey != "" && isIdempotencyUniqueViolation(err) {
			existing, lookupErr := s.repo.FindJobByIdempotencyKey(ctx, parsedSchoolID, req.IdempotencyKey)
			if lookupErr == nil && existing != nil {
				return existing, true, nil
			}
		}
		return nil, false, err
	}

	if req.DryRun {
		jobUUID, _ := parseJobID(job.ID)
		if err := s.repo.MarkRunning(ctx, jobUUID); err != nil {
			return nil, false, err
		}
		if err := s.repo.MarkSuccess(ctx, jobUUID, 1, http.StatusOK, `{"status":"validated","mode":"dry_run"}`); err != nil {
			return nil, false, err
		}
		finalJob, fetchErr := s.repo.GetJob(ctx, jobUUID)
		return finalJob, false, fetchErr
	}

	jobUUID, err := parseJobID(job.ID)
	if err != nil {
		return nil, false, err
	}
	s.executeJob(ctx, parsedSchoolID, jobUUID, job)
	finalJob, fetchErr := s.repo.GetJob(ctx, jobUUID)
	return finalJob, false, fetchErr
}

func (s *Service) executeJob(ctx context.Context, schoolID uuid.UUID, jobUUID uuid.UUID, job *InteropJob) {
	if err := s.repo.MarkRunning(ctx, jobUUID); err != nil {
		return
	}

	for attempt := 1; attempt <= job.MaxAttempts; attempt++ {
		if err := s.repo.MarkAttempt(ctx, jobUUID, attempt); err != nil {
			continue
		}

		result, err := s.client.Post(ctx, job.System, job.Operation, job.Payload)
		if err == nil {
			_ = s.repo.MarkSuccess(ctx, jobUUID, attempt, result.StatusCode, truncateLargeText(result.Body, 64*1024))
			_ = s.repo.ResolveDLQForJob(ctx, jobUUID, "resolved by successful retry")
			return
		}

		_ = s.repo.MarkFailedAttempt(ctx, jobUUID, attempt, result.StatusCode, truncateLargeText(result.Body, 64*1024), truncateLargeText(err.Error(), 4*1024))

		if attempt == job.MaxAttempts {
			break
		}
		time.Sleep(backoffDuration(attempt))
	}

	_ = s.repo.MarkFailedFinal(
		ctx,
		jobUUID,
		schoolID,
		job.System,
		job.Operation,
		job.Payload,
		job.MaxAttempts,
		0,
		"",
		"all retry attempts exhausted",
	)
}

func backoffDuration(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 2 * time.Second
	case 2:
		return 5 * time.Second
	case 3:
		return 10 * time.Second
	default:
		return 30 * time.Second
	}
}

func (s *Service) ListJobs(ctx context.Context, limit int, filter ListJobsFilter) ([]InteropJob, error) {
	if limit <= 0 {
		limit = 25
	}
	return s.repo.ListJobs(ctx, limit, filter)
}

func (s *Service) GetJob(ctx context.Context, jobID string) (*InteropJob, error) {
	parsed, err := parseJobID(jobID)
	if err != nil {
		return nil, ErrJobNotFound
	}
	item, err := s.repo.GetJob(ctx, parsed)
	if err != nil {
		return nil, ErrJobNotFound
	}
	return item, nil
}

func (s *Service) RetryJob(ctx context.Context, jobID string) (*InteropJob, error) {
	if !s.cfg.Enabled {
		return nil, ErrInteropDisabled
	}

	parsed, err := parseJobID(jobID)
	if err != nil {
		return nil, ErrJobNotFound
	}
	return s.retryJobByID(ctx, parsed, nil)
}

func (s *Service) SweepPendingRetries(ctx context.Context, schoolID string, limit int) (int, error) {
	if !s.cfg.Enabled || !s.cfg.RetrySweepEnabled {
		return 0, nil
	}
	s.sweepRunsTotal.Add(1)
	if limit <= 0 {
		limit = 5
	}

	schoolUUID, err := uuid.Parse(strings.TrimSpace(schoolID))
	if err != nil {
		return 0, fmt.Errorf("%w: invalid school id", ErrValidationFailed)
	}

	unlock, acquired, err := s.repo.AcquireSchoolSweepLock(ctx, schoolUUID)
	if err != nil {
		s.sweepErrorsTotal.Add(1)
		return 0, err
	}
	if !acquired {
		s.sweepLockMissTotal.Add(1)
		return 0, nil
	}
	defer unlock()

	jobIDs, err := s.repo.ListRetryCandidates(ctx, schoolUUID, limit)
	if err != nil {
		s.sweepErrorsTotal.Add(1)
		return 0, err
	}

	processed := 0
	for _, jobID := range jobIDs {
		if ctx.Err() != nil {
			break
		}
		parsedJobID, parseErr := parseJobID(jobID)
		if parseErr != nil {
			s.sweepErrorsTotal.Add(1)
			continue
		}
		if _, retryErr := s.retryJobByID(ctx, parsedJobID, &schoolUUID); retryErr != nil {
			s.sweepErrorsTotal.Add(1)
			continue
		}
		processed++
	}
	s.sweepRetriesTotal.Add(uint64(processed))

	return processed, nil
}

func (s *Service) SweeperStats() SweeperStats {
	return SweeperStats{
		RunsTotal:         s.sweepRunsTotal.Load(),
		LockMissTotal:     s.sweepLockMissTotal.Load(),
		RetriesTotal:      s.sweepRetriesTotal.Load(),
		ErrorsTotal:       s.sweepErrorsTotal.Load(),
		RetrySweepEnabled: s.cfg.RetrySweepEnabled,
	}
}

func (s *Service) retryJobByID(ctx context.Context, jobID uuid.UUID, expectedSchoolID *uuid.UUID) (*InteropJob, error) {
	if !s.cfg.Enabled {
		return nil, ErrInteropDisabled
	}

	job, err := s.repo.GetJob(ctx, jobID)
	if err != nil {
		return nil, ErrJobNotFound
	}

	if job.DryRun {
		return nil, fmt.Errorf("%w: dry_run jobs cannot be retried in live mode", ErrValidationFailed)
	}
	if job.Status != JobStatusFailed {
		return nil, fmt.Errorf("%w: only failed jobs can be retried", ErrValidationFailed)
	}

	schoolID, err := uuid.Parse(strings.TrimSpace(job.SchoolID))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid school scope on job", ErrValidationFailed)
	}
	if expectedSchoolID != nil && schoolID != *expectedSchoolID {
		return nil, ErrJobNotFound
	}

	if err := s.repo.ResetForRetry(ctx, jobID); err != nil {
		return nil, err
	}
	s.executeJob(ctx, schoolID, jobID, job)
	return s.repo.GetJob(ctx, jobID)
}

func truncateLargeText(text string, maxLen int) string {
	if maxLen <= 0 || len(text) <= maxLen {
		return text
	}
	return text[:maxLen]
}

func isIdempotencyUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	if pgErr.Code != "23505" {
		return false
	}
	constraint := strings.TrimSpace(pgErr.ConstraintName)
	return constraint == "idx_interop_jobs_idempotency_key"
}

func validateRequest(req CreateJobRequest) error {
	switch req.System {
	case SystemDIKSHA, SystemDigiLocker, SystemABC:
	default:
		return ErrInvalidSystem
	}

	valid := map[ExternalSystem]map[Operation]bool{
		SystemDIKSHA: {
			OperationLearnerProfileSync:   true,
			OperationLearningProgressSync: true,
			OperationTransferEventSync:    true,
		},
		SystemDigiLocker: {
			OperationDocumentMetadataSync: true,
		},
		SystemABC: {
			OperationAPAARVerify: true,
		},
	}

	if !valid[req.System][req.Operation] {
		return ErrInvalidOperation
	}
	if len(req.Payload) == 0 {
		return fmt.Errorf("%w: payload is required", ErrValidationFailed)
	}

	required := map[Operation][]string{
		OperationLearnerProfileSync:   {"learner_id", "full_name", "date_of_birth", "school_udise_code", "enrollment_status", "consent_reference"},
		OperationLearningProgressSync: {"learner_id", "academic_year", "class", "subjects", "consent_reference"},
		OperationTransferEventSync:    {"learner_id", "source_school_udise", "destination_school_udise", "transfer_date", "consent_reference"},
		OperationDocumentMetadataSync: {"learner_id", "document_uri", "document_type", "issuer_udise_code", "consent_reference"},
		OperationAPAARVerify:          {"apaar_id", "full_name", "date_of_birth", "consent_reference"},
	}
	for _, field := range required[req.Operation] {
		if strings.TrimSpace(fmt.Sprintf("%v", req.Payload[field])) == "" {
			return fmt.Errorf("%w: missing field %q", ErrValidationFailed, field)
		}
	}
	return nil
}

func validateLegalGuards(payload map[string]any) error {
	isMinor := strings.EqualFold(fmt.Sprintf("%v", payload["is_minor"]), "true")
	if !isMinor {
		return nil
	}
	guardianConsent := strings.TrimSpace(fmt.Sprintf("%v", payload["guardian_consent_reference"]))
	consentMethod := strings.TrimSpace(fmt.Sprintf("%v", payload["consent_method"]))
	if guardianConsent == "" {
		return fmt.Errorf("%w: guardian_consent_reference is mandatory for minors", ErrValidationFailed)
	}
	if consentMethod == "" {
		return fmt.Errorf("%w: consent_method is mandatory for minors", ErrValidationFailed)
	}
	return nil
}
