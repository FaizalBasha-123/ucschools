package interop

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type fakeInteropService struct {
	job            *InteropJob
	idempotencyHit bool
	createErr      error
}

func (f *fakeInteropService) Readiness() ReadinessReport {
	return ReadinessReport{}
}

func (f *fakeInteropService) SweeperStats() SweeperStats {
	return SweeperStats{}
}

func (f *fakeInteropService) CreateJobWithMeta(ctx context.Context, req CreateJobRequest, requestedBy, requestedRole, schoolID string) (*InteropJob, bool, error) {
	return f.job, f.idempotencyHit, f.createErr
}

func (f *fakeInteropService) ListJobs(ctx context.Context, limit int, filter ListJobsFilter) ([]InteropJob, error) {
	return nil, nil
}

func (f *fakeInteropService) GetJob(ctx context.Context, jobID string) (*InteropJob, error) {
	return nil, nil
}

func (f *fakeInteropService) RetryJob(ctx context.Context, jobID string) (*InteropJob, error) {
	return nil, nil
}

func TestCreateJob_IdempotencyHitResponseMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)

	now := time.Now().UTC()
	fakeSvc := &fakeInteropService{
		job: &InteropJob{
			ID:            "6b133f78-e964-4f15-9b1f-6f1f2cc9d662",
			System:        SystemDIKSHA,
			Operation:     OperationTransferEventSync,
			Status:        JobStatusSucceeded,
			CreatedAt:     now,
			UpdatedAt:     now,
			RequestedBy:   "user-1",
			RequestedRole: "admin",
		},
		idempotencyHit: true,
	}

	h := NewHandler(fakeSvc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	body := []byte(`{"system":"diksha","operation":"transfer_event_sync","dry_run":false,"payload":{"learner_id":"L-1","source_school_udise":"UDISE123456","destination_school_udise":"UDISE654321","transfer_date":"2026-03-18","consent_reference":"consent-1"}}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/interop/jobs", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set("X-Idempotency-Key", "idem-123")
	c.Set("role", "admin")
	c.Set("school_id", "11111111-1111-1111-1111-111111111111")
	c.Set("user_id", "user-1")

	h.CreateJob(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, w.Code)
	}
	if got := w.Header().Get("X-Idempotency-Hit"); got != "true" {
		t.Fatalf("expected X-Idempotency-Hit=true, got %q", got)
	}
	if got := w.Header().Get("X-Idempotency-Key"); got != "idem-123" {
		t.Fatalf("expected X-Idempotency-Key echo, got %q", got)
	}

	var resp struct {
		IdempotencyHit bool        `json:"idempotency_hit"`
		Job            *InteropJob `json:"job"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode json response: %v", err)
	}
	if !resp.IdempotencyHit {
		t.Fatalf("expected idempotency_hit=true in response body")
	}
	if resp.Job == nil || resp.Job.ID == "" {
		t.Fatalf("expected job in response body")
	}
}

func TestCreateJob_NewJobResponseMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)

	now := time.Now().UTC()
	fakeSvc := &fakeInteropService{
		job: &InteropJob{
			ID:            "f981dbe0-4bb8-4f78-b1da-90525c77d8f0",
			System:        SystemDIKSHA,
			Operation:     OperationTransferEventSync,
			Status:        JobStatusPending,
			CreatedAt:     now,
			UpdatedAt:     now,
			RequestedBy:   "user-1",
			RequestedRole: "admin",
		},
		idempotencyHit: false,
	}

	h := NewHandler(fakeSvc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	body := []byte(`{"system":"diksha","operation":"transfer_event_sync","dry_run":false,"payload":{"learner_id":"L-1","source_school_udise":"UDISE123456","destination_school_udise":"UDISE654321","transfer_date":"2026-03-18","consent_reference":"consent-1"}}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/interop/jobs", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set("X-Idempotency-Key", "idem-456")
	c.Set("role", "admin")
	c.Set("school_id", "11111111-1111-1111-1111-111111111111")
	c.Set("user_id", "user-1")

	h.CreateJob(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, w.Code)
	}
	if got := w.Header().Get("X-Idempotency-Hit"); got != "false" {
		t.Fatalf("expected X-Idempotency-Hit=false, got %q", got)
	}

	var resp struct {
		IdempotencyHit bool        `json:"idempotency_hit"`
		Job            *InteropJob `json:"job"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode json response: %v", err)
	}
	if resp.IdempotencyHit {
		t.Fatalf("expected idempotency_hit=false in response body")
	}
	if resp.Job == nil || resp.Job.ID == "" {
		t.Fatalf("expected job in response body")
	}
}
