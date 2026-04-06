package interop

import "time"

type ExternalSystem string

type Operation string

type JobStatus string

const (
	SystemDIKSHA     ExternalSystem = "diksha"
	SystemDigiLocker ExternalSystem = "digilocker"
	SystemABC        ExternalSystem = "abc"

	OperationLearnerProfileSync   Operation = "learner_profile_sync"
	OperationLearningProgressSync Operation = "learning_progress_sync"
	OperationTransferEventSync    Operation = "transfer_event_sync"
	OperationDocumentMetadataSync Operation = "document_metadata_sync"
	OperationAPAARVerify          Operation = "apaar_verify"

	JobStatusPending   JobStatus = "pending"
	JobStatusRunning   JobStatus = "running"
	JobStatusSucceeded JobStatus = "succeeded"
	JobStatusFailed    JobStatus = "failed"
)

type CreateJobRequest struct {
	System         ExternalSystem `json:"system"`
	Operation      Operation      `json:"operation"`
	DryRun         bool           `json:"dry_run"`
	Payload        map[string]any `json:"payload"`
	IdempotencyKey string         `json:"-"` // populated from X-Idempotency-Key header
}

type InteropJob struct {
	ID             string         `json:"id"`
	System         ExternalSystem `json:"system"`
	Operation      Operation      `json:"operation"`
	Status         JobStatus      `json:"status"`
	DryRun         bool           `json:"dry_run"`
	Payload        map[string]any `json:"payload"`
	RequestedBy    string         `json:"requested_by"`
	RequestedRole  string         `json:"requested_role"`
	SchoolID       string         `json:"school_id,omitempty"`
	IdempotencyKey string         `json:"idempotency_key,omitempty"`
	AttemptCount   int            `json:"attempt_count"`
	MaxAttempts    int            `json:"max_attempts"`
	LastError      string         `json:"last_error,omitempty"`
	ResponseCode   int            `json:"response_code,omitempty"`
	ResponseBody   string         `json:"response_body,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	StartedAt      *time.Time     `json:"started_at,omitempty"`
	CompletedAt    *time.Time     `json:"completed_at,omitempty"`
}

type ReadinessReport struct {
	Enabled         bool            `json:"enabled"`
	DryRunAvailable bool            `json:"dry_run_available"`
	RequiredMissing []string        `json:"required_missing"`
	Systems         map[string]bool `json:"systems"`
	SafetyChecks    map[string]bool `json:"safety_checks"`
	RecommendedNext []string        `json:"recommended_next"`
}

type ProviderResult struct {
	StatusCode int
	Body       string
}

type ListJobsFilter struct {
	Status JobStatus
	System ExternalSystem
}

type SweeperStats struct {
	RunsTotal         uint64 `json:"runs_total"`
	LockMissTotal     uint64 `json:"lock_miss_total"`
	RetriesTotal      uint64 `json:"retries_total"`
	ErrorsTotal       uint64 `json:"errors_total"`
	RetrySweepEnabled bool   `json:"retry_sweep_enabled"`
}
