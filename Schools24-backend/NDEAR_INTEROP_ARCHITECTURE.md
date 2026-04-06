# NDEAR Government Interop Architecture (Task 2)

## Document Control

- Owner: Schools24 Platform Engineering
- Security Review Owner: Schools24 Security & Compliance
- Legal Review Owner: Schools24 Legal + DPO
- Version: 1.1 (March 18, 2026)
- Scope: Option A implementation now; Option B onboarding playbook included

## Related Architecture Decision Records

- [ADR-001: Interop Boundaries](docs/adr/001-interop-boundaries.md) — Service ownership, route wiring, tenant isolation
- [ADR-002: Consent Lifecycle](docs/adr/002-consent-lifecycle.md) — Current consent schema, gap analysis for withdrawal/DSR
- [ADR-003: Cookie Truth Model](docs/adr/003-cookie-truth-model.md) — App vs landing cookie consent mismatch and resolution
- [API Current State Snapshot](docs/api/current-state.md) — All endpoints as of 2026-03-18
- [NDEAR Delta Checklist](docs/api/ndear-delta-checklist.md) — Change tracking for compliance PRs

## Executive Summary

This document defines the architecture for Schools24's integration with India's National Digital Education Architecture (NDEAR) ecosystem, specifically:

1. **DIKSHA (Digital Infrastructure for Knowledge Sharing)**: Learner profile sync, learning progress export
2. **DigiLocker**: Document metadata sync (certificates, transcripts, learning records)
3. **APAAR Registry**: Learner enrollment state synchronization

**Status**: Architecture + Option A foundation implementation complete | **Effort**: 4-6 weeks for full production interop | **Risk**: Medium (external API dependencies)

## Trust Boundary and Evidence Levels

This section clarifies what is authoritative vs what is implementation-assumption so we remain honest and legally safe.

### Authoritative (verified from public sources)

- DigiLocker partner model (Issuer/Requester onboarding) is official and active.
- API Setu directory exposes ABC/APAAR API collections and OAS references.
- DigiLocker legal framework emphasizes consent, metadata handling, and Indian data residency obligations.
- ABC/APAAR ecosystem positioning confirms learner identity portability and institutional onboarding requirements.

Reference links:

- https://www.digilocker.gov.in/web/partners/introductions
- https://www.digilocker.gov.in/web/about/tos
- https://www.digilocker.gov.in/web/about/digilocker-policy
- https://directory.apisetu.gov.in/api-collection/abc
- https://apisetu.gov.in/sop
- https://www.abc.gov.in/faq.php

### Assumptions (must be validated during onboarding)

- Exact endpoint paths, request/response fields, signature headers, and error codes used in this document can differ per partner integration profile.
- Production credentials, cert pinning requirements, and environment-specific SLAs are issued during government onboarding and cannot be inferred fully from public pages.
- Some fields in example payloads are best-practice placeholders that must be reconciled against final OAS contracts.

### Engineering Rule

No production interop call should be enabled without:

1. Signed OAS contract capture in repository
2. DPA/legal approval record
3. End-to-end staging validation with official sandbox
4. Dry-run parity checks in Schools24

## Option A and Option B

### Option A (Implemented Now)

Purpose: Build production-safe interop foundation even before government credentials.

Delivered:

- Config-driven interop module (`INTEROP_ENABLED`, endpoints, signing secret, retries)
- Admin and super-admin readiness endpoints
- Job orchestration endpoints with strict field validation
- Minor consent legal guard in payload validation path
- Dry-run mode to validate payloads without external transmission
- Signed request machinery and retry/backoff behavior
- Tenant DLQ persistence with filtered list/retry APIs
- Background DLQ retry sweeper with capped per-school batches
- Per-school advisory lock in sweeper to prevent duplicate retries across instances
- Plug-and-play transfer flow: approving a transfer can auto-enqueue `transfer_event_sync` from the admin transfer UI
- Auto-sync is configurable at approval time (`auto_gov_sync`) and returns operator-friendly sync status/warnings
- One-click transfer completion endpoint for school admins (`POST /admin/transfers/:id/complete`) to approve + trigger sync in one step
- Transfer-page interop control endpoints (`POST /admin/transfers/:id/gov-sync`, `POST /admin/transfers/:id/gov-sync/retry`)
- Tenant DB index optimization for transfer lookup from interop payload (`payload->>'transfer_request_id'`)

Outcomes:

- Zero dependency on gov credentials for engineering progress
- No fake success paths; live mode is blocked unless explicitly enabled
- Safe rollout: dry-run first, then controlled production switch

### Option B (What and How)

Purpose: Complete official government onboarding and move Option A from ready-state to live-state.

Process:

1. Register Schools24 as partner (Issuer/Requester as required)
2. Complete organization KYC and legal agreements (DPA/Terms)
3. Receive official sandbox credentials + OAS contract set
4. Map official field-level schemas into Schools24 validators
5. Execute sandbox conformance suite (positive + negative + retry scenarios)
6. Get production credentials and approved cutover window
7. Gradual production rollout with live observability and rollback guard

Artifacts required from Option B:

- Signed partner agreements
- Environment credential inventory (sandbox/prod)
- Official error catalog and rate-limit policy
- Compliance sign-off checklist (legal, security, operations)

---

## 1. Architecture Overview

## 1A. Enterprise Field Registry (Minimum Viable Contract)

This registry defines the minimum fields Schools24 will enforce before any outbound call.

### Cross-System Mandatory Fields

- `learner_id` (or `apaar_id` for APAAR verification)
- `full_name`
- `date_of_birth`
- `school_udise_code` or equivalent issuer UDISE
- `consent_reference`
- `source_system` (`schools24`)
- `event_timestamp` (RFC3339 UTC)

### Minor-Specific Mandatory Fields (Legal Guard)

If learner is under 18:

- `is_minor=true`
- `guardian_consent_reference`
- `consent_method` (`otp|written|digital|in_person|other`)

### Data Minimization Rule

Schools24 must not send non-required attributes (for example, full home address or unrelated health data) unless explicitly required by approved OAS contract and legal sign-off.

### Contract Evolution Rule

Every new field addition must include:

1. Purpose annotation
2. Legal basis annotation
3. Retention period annotation
4. Backward compatibility annotation

## 1B. Storage Strategy (Tenant Isolation + Low DB Compute)

Chosen approach:

- `interop_jobs` and `interop_dead_letter_queue` are tenant-schema tables.
- Routing is enforced via tenant search_path and explicit school scope for super admin.

Why this suits Schools24 best:

1. Student data remains school-isolated by default.
2. Per-tenant tables keep active working sets small, reducing scan cost.
3. Job listing queries are index-backed and sorted by `created_at DESC` with bounded limits.
4. No payload GIN indexes are created by default to avoid write amplification.

Compute guardrails:

- Always paginate and cap list endpoints.
- Keep response bodies truncated in logs.
- Use narrow compound indexes only for status/system recency.
- Avoid JSON-field filtering in hot paths.
- Sweep retries with bounded `batch_size` and interval controls.
- Apply small jitter between schools to smooth outbound API bursts.
- Use advisory lock per school during sweep to avoid multi-instance duplicate work.

### 1.1 Integration Points

```
Schools24 ← → DIKSHA Registry
  ↓             (Learner profiles)
  ├─→ DigiLocker Metadata
  │     (Document references)
  └─→ APAAR Verification
        (Learner status)
```

### 1.2 Data Flow (Learner Transfer Example)

```
User Action              Schools24 Backend      Government Systems
─────────────────        ──────────────────     ──────────────────

Student Transfer
Request Created    →     1. Create local
                         transfer record
                         
                    →    2. Query APAAR
                         for learner status
                         
                    →    3. Submit to DIKSHA:
                         - Learner ID
                         - Learning progress
                         - School transfer
                         
Transfer Approved  →     4. Push to DigiLocker:
                         - Learning metrics
                         - Certificate refs
                         
                    →    5. Update APAAR
                         enrollment state
                         
                    ←    6. Receive confirmation
                         tokens from gov systems
                         
Status: Synced     ←     7. Local record updated
                         with gov references
```

### 1.3 Service Boundaries

**Interop Module** (new service):
- Responsible for signed outbound requests to government APIs
- Handles inbound verification requests from government
- Manages retry logic, exponential backoff, dead-letter queue
- Audits all government interactions with timestamps + hashes

**Related Modules** (existing):
- **Admin Module**: Initiates transfers/reconciliations (calls interop)
- **Student Module**: Reads learner status from interop cache
- **School Module**: Provides school/UDISE codes for gov requests

**No changes to**:
- Auth module
- Chat/messaging modules
- Learning modules (homework, quizzes)

---

## 2. DIKSHA Integration (Learner Sync)

### 2.1 DIKSHA APIs Used

#### A. Learner Profile Registration
```
POST /api/v1/learner/create
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "learner_id": "APAAR-123456789012",      // Unique, immutable
  "full_name": "Raj Kumar Singh",
  "date_of_birth": "2010-05-15",
  "gender": "M",
  "mobile": "+919876543210",
  "email": "raj.kumar@school.edu.in",
  "school_udise_code": "UDISE030301234",   // UDISE+ format
  "enrollment_status": "active",            // active|transferred|completed|inactive
  "enrollment_date": "2020-06-01",
  "source_system": "schools24",
  "consent_verified": true,
  "consent_method": "otp",                  // otp|digital|written|in_person
  "consent_reference": "ref_20260318_001"   // For audit trail
}

Response:
{
  "status": "success",
  "learner_registry_id": "diksha_lr_abc123",
  "created_at": "2026-03-18T10:30:00Z",
  "confirmation_token": "token_xyz789"
}
```

#### B. Learning Progress Sync
```
POST /api/v1/learner/{learner_id}/learning-progress
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "learner_id": "APAAR-123456789012",
  "academic_year": "2025-2026",
  "class": "10",
  "section": "A",
  "subjects": [
    {
      "subject_name": "Mathematics",
      "subject_code": "MTH1001",
      "enrollment_date": "2025-06-01",
      "attendance_percent": 85.5,
      "assessments": [
        {
          "assessment_type": "unit_test",
          "assessment_date": "2026-01-15",
          "score": 42,
          "max_score": 50,
          "subject_code": "MTH1001"
        }
      ],
      "status": "active"
    }
  ],
  "last_updated": "2026-03-18T10:30:00Z"
}

Response:
{
  "status": "success",
  "sync_id": "sync_20260318_001",
  "records_processed": 1,
  "confirmation_token": "token_lgk456"
}
```

#### C. Learner Transfer Notification
```
POST /api/v1/learner/{learner_id}/transfer
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "learner_id": "APAAR-123456789012",
  "source_school_udise": "UDISE030301234",
  "destination_school_udise": "UDISE030302345",
  "transfer_date": "2026-03-31",
  "reason": "Student Change of School",
  "evidence_reference": "transfer_auth_abc123"
}

Response:
{
  "status": "success",
  "transfer_id": "tfr_20260318_001",
  "effective_from": "2026-04-01",
  "confirmation_token": "token_xyz789"
}
```

### 2.2 Learner Profile Sync Schedule

**Synchronization Frequency:**
- **Real-time** (on-change): Transfer events, enrollment status changes
- **Daily (02:00 UTC)**: Learning progress batch sync
- **Weekly**: Full learner profile verification
- **Monthly**: Reconciliation with DIKSHA registry (drift detection)

**Batching Strategy:**
```typescript
// Sync learning progress for 100 learners per batch
// With 5-minute delays between batches (load balancing)

async function syncLearningProgressBatch(learnerIds: string[]) {
  for (const batch of chunk(learnerIds, 100)) {
    await Promise.all(
      batch.map(id => diksha.syncLearnerProgress(id))
    )
    await delay(5 * 60 * 1000) // 5-minute backoff
  }
}
```

---

## 3. DigiLocker Integration (Document Metadata)

### 3.1 DigiLocker APIs Used

#### A. Document Registration
```
POST /api/v1/document/register
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "document_id": "schools24_cer_20260318_001",  // Schools24 unique ID
  "learner_id": "APAAR-123456789012",
  "document_type": "learning_record",            // learning_record|certificate|transcript
  "document_name": "Annual Report 2025-26",
  "issued_date": "2026-03-18",
  "issuing_institution": "XYZ Public School",
  "issuing_institution_code": "UDISE030301234",
  "metadata": {
    "class": "10",
    "section": "A",
    "academic_year": "2025-2026",
    "total_subjects": 6,
    "total_assessments": 24,
    "overall_attendance": 87.5
  },
  "document_url": "https://schools24.in/api/v1/documents/{doc_id}/download",
  "valid_from": "2026-03-18",
  "valid_until": "2027-03-17",
  "document_hash": "sha256_abc123xyz789",       // For verification
  "consent_reference": "ref_20260318_001"
}

Response:
{
  "status": "success",
  "digilocker_id": "dl_cert_abc123",
  "registered_at": "2026-03-18T10:35:00Z",
  "confirmation_token": "token_dlk789"
}
```

#### B. Document Update
```
PUT /api/v1/document/{digilocker_id}
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "metadata": {
    "class": "10",
    "section": "A",
    "academic_year": "2025-2026",
    "total_subjects": 6,
    "latest_assessment_score": 78,                // Updated
    "overall_attendance": 88.2                    // Updated
  },
  "document_hash": "sha256_updated123"            // New hash after update
}

Response:
{
  "status": "success",
  "updated_at": "2026-03-18T11:00:00Z"
}
```

#### C. Batch Document Sync
```
POST /api/v1/document/batch-register
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "documents": [
    { /* doc 1 */ },
    { /* doc 2 */ },
    ...
  ],
  "batch_id": "batch_20260318_morning"
}

Response:
{
  "status": "success",
  "total_requested": 50,
  "successful": 48,
  "failed": 2,
  "failures": [
    {
      "document_id": "schools24_cer_20260318_041",
      "error": "Invalid UDISE code",
      "error_code": "INVALID_INSTITUTION"
    }
  ]
}
```

### 3.2 Document Sync Strategy

**When to Sync:**
- **Immediate**: New certificate issued, transcript generated
- **Daily**: Updated learning progress metadata
- **Weekly**: Attendance/assessment changes rolled up

**Document Types Synced:**
- Learning analytics (attendance, assessments, progress)
- Annual reports / report cards
- Certificates (completion, merit, participation)
- Transcripts (cumulative GPA, achievement)
- Teacher recommendations (if applicable)

---

## 4. APAAR Verification Integration

### 4.1 APAAR Status Check

#### A. Learner Verification
```
GET /api/v1/apaar/learner/{apaar_id}/verify
Authorization: Bearer <jwt> + Signature: <signed_hash>

Response:
{
  "apaar_id": "APAAR-123456789012",
  "registered": true,
  "registration_date": "2025-06-01",
  "current_school": {
    "udise_code": "UDISE030301234",
    "school_name": "XYZ Public School",
    "state": "Maharashtra"
  },
  "enrollment_status": "active",               // active|transferred_out|completed|inactive
  "class": "10",
  "verified_at": "2026-03-18T10:30:00Z",
  "verification_token": "token_apaar123"
}
```

#### B. Duplicate Detection (Pre-Enrollment)
```
POST /api/v1/apaar/check-duplicates
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "full_name": "Raj Kumar Singh",
  "date_of_birth": "2010-05-15",
  "mobile": "+919876543210"
}

Response:
{
  "status": "success",
  "duplicates_found": false,
  "potential_matches": [],
  "safe_to_enroll": true
}
```

#### C. Learner Transfer Event
```
POST /api/v1/apaar/learner/{apaar_id}/enroll
Authorization: Bearer <jwt> + Signature: <signed_hash>

Request:
{
  "learner_id": "APAAR-123456789012",
  "school_udise": "UDISE030302345",
  "enrollment_date": "2026-04-01",
  "from_school_udise": "UDISE030301234",
  "enrollment_evidence": "reference_abc123"
}

Response:
{
  "status": "success",
  "enrolled_at": "2026-04-01T00:00:00Z"
}
```

---

## 5. Signed Request Protocol

### 5.1 Request Signature Scheme

**Algorithm**: HMAC-SHA256 (industry standard)

```
Signature = HMAC-SHA256(
  signing_key,
  request_body + timestamp + nonce
)

Request Headers:
├─ Authorization: Bearer {jwt_token}
├─ X-Timestamp: 2026-03-18T10:30:00Z       (RFC3339)
├─ X-Signature: {hmac_sha256_hex}
├─ X-Nonce: {random_string_32_chars}       (prevent replay)
└─ X-Request-ID: {schools24_request_id}    (correlate with logs)
```

**Key Management:**
- **Signing Key**: Schools24's private key (stored in secrets manager)
- **Verification Key**: Public key registered with government systems
- **Key Rotation**: Every 90 days (overlap period: 30 days)
- **Backup Keys**: 2 active keys at any time during rotation

### 5.2 Go Implementation

```go
// internal/modules/interop/security/signature.go

type SignatureVerifier struct {
    signingKey []byte
    publicKey  *rsa.PublicKey
}

func (sv *SignatureVerifier) SignRequest(
    ctx context.Context,
    body []byte,
    timestamp time.Time,
    nonce string,
) (string, error) {
    payload := fmt.Sprintf("%s|%s|%s", 
        string(body), 
        timestamp.Format(time.RFC3339), 
        nonce)
    
    signature := hmac.New(sha256.New, sv.signingKey)
    signature.Write([]byte(payload))
    
    return hex.EncodeToString(signature.Sum(nil)), nil
}

func (sv *SignatureVerifier) VerifyInboundRequest(
    ctx context.Context,
    body []byte,
    signature string,
    timestamp time.Time,
    nonce string,
) error {
    if time.Since(timestamp) > 5*time.Minute {
        return errors.New("request expired")
    }
    
    if sv.isNonceReplayed(ctx, nonce) {
        return errors.New("nonce replay detected")
    }
    
    expected, _ := sv.SignRequest(ctx, body, timestamp, nonce)
    
    if !hmac.Equal([]byte(signature), []byte(expected)) {
        return errors.New("signature mismatch")
    }
    
    return nil
}
```

---

## 6. Error Handling & Retry Strategy

### 6.1 Retry Logic

```
Attempt 1: Immediate
Attempt 2: Wait 2 seconds
Attempt 3: Wait 5 seconds
Attempt 4+: Wait 10-30 seconds (bounded backoff)

Max Retries: controlled by `INTEROP_MAX_RETRIES` (default 3)
If exhausted: move to tenant DLQ (`interop_dead_letter_queue`)
Background recovery: periodic sweeper retries pending DLQ jobs in small batches
```

Sweeper controls (implemented):

- `INTEROP_RETRY_SWEEP_ENABLED` (default: true)
- `INTEROP_RETRY_SWEEP_INTERVAL_SECONDS` (default: 120)
- `INTEROP_RETRY_SWEEP_BATCH_SIZE` (default: 5 per school per run)
- `INTEROP_RETRY_SWEEP_TIMEOUT_SECONDS` (default: 20 per school)

Operational visibility (implemented):

- `GET /api/v1/admin/interop/sweeper/stats`
- `GET /api/v1/super-admin/interop/sweeper/stats`
- Counters: runs, lock misses, retries processed, errors

**Idempotency:**
- Every request gets a unique `X-Request-ID`
- Government APIs must be idempotent (safe to retry same request)
- Schools24 stores request_id + response in `interop_requests` table
- If retry with same request_id, return cached response (no double-processing)

### 6.2 Dead Letter Queue (DLQ)

When all retries fail:

```sql
-- Table: interop_dead_letter_queue
CREATE TABLE interop_dead_letter_queue (
  id UUID PRIMARY KEY,
  school_id UUID NOT NULL,
  request_type VARCHAR(50),        -- sync_progress, register_doc, transfer_event
  external_system VARCHAR(50),     -- diksha|digilocker|apaar
  request_payload JSONB,
  response_attempt JSONB,
  error_message TEXT,
  error_code VARCHAR(50),
  attempts INT,
  first_attempt_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  created_at TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution_notes TEXT,
  status VARCHAR(20)               -- pending|manual_review|resolved|abandoned
);

-- Alert: Send notification to interop admin when DLQ entry created
-- Retention: Keep for 7 days, then archive to audit logs
```

**Recovery Process:**
1. Manual review: Interop admin checks failed request
2. Fix root cause (e.g., invalid UDISE code, learner mismatch)
3. Manually retry or delete (if non-critical)
4. Logged for audit trail

### 6.3 Status Code Handling

```go
// internal/modules/interop/client/diksha.go

func handleDIKSHAResponse(statusCode int, body []byte) error {
    switch statusCode {
    case 200, 201: 
        return nil  // Success
    
    case 400: 
        return &RetryableError{msg: "bad request"}  // Retry
    
    case 401, 403: 
        return &FatalError{msg: "auth failure"}     // Don't retry
    
    case 429: 
        return &RateLimitError{msg: "rate limited"} // Exponential backoff
    
    case 500, 502, 503: 
        return &RetryableError{msg: "server error"}  // Retry
    
    case 504: 
        return &RetryableError{msg: "timeout"}      // Retry with longer delay
    
    default: 
        return &RetryableError{msg: "unknown error"}
    }
}
```

---

## 7. Data Models (Backend Schema)

### 7.1 Interop Configuration

```sql
-- Global schema
CREATE TABLE interop_configs (
    id UUID PRIMARY KEY,
    school_id UUID NOT NULL REFERENCES public.schools(id),
    diksha_enabled BOOLEAN DEFAULT false,
    digilocker_enabled BOOLEAN DEFAULT false,
    apaar_enabled BOOLEAN DEFAULT true,
    api_endpoint_diksha VARCHAR(500),          -- Staging vs Production
    api_endpoint_digilocker VARCHAR(500),
    api_endpoint_apaar VARCHAR(500),
    signing_key_id VARCHAR(50),                -- Current active key
    webhook_url_diksha VARCHAR(500),           -- For inbound events
    webhook_url_digilocker VARCHAR(500),
    last_synced_at TIMESTAMP,
    enabled_at TIMESTAMP,
    disabled_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_interop_configs_school_id ON interop_configs(school_id);
```

### 7.2 Sync Status & Audit Trail

```sql
-- Tenant schema (school_<school_id>)
CREATE TABLE interop_sync_logs (
    id UUID PRIMARY KEY,
    school_id UUID NOT NULL,
    learner_id UUID NOT NULL REFERENCES learners(id),
    sync_type VARCHAR(50),                     -- profile|progress|transfer|document
    external_system VARCHAR(50),               -- diksha|digilocker|apaar
    request_id VARCHAR(100) UNIQUE,            -- For idempotency
    request_payload JSONB,
    response_status INT,
    response_payload JSONB,
    external_learner_id VARCHAR(50),          -- APAAR ID from gov
    external_reference_id VARCHAR(100),       -- DigiLocker doc ID, etc.
    error_code VARCHAR(50),
    error_message TEXT,
    retry_count INT DEFAULT 0,
    next_retry_at TIMESTAMP,
    sync_completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_interop_sync_school_learner ON interop_sync_logs(school_id, learner_id);
CREATE INDEX idx_interop_sync_external_system ON interop_sync_logs(external_system);
CREATE INDEX idx_interop_sync_status ON interop_sync_logs(response_status);
```

### 7.3 Learner-Government Mapping

```sql
-- Tenant schema
CREATE TABLE learner_govt_references (
    id UUID PRIMARY KEY,
    school_id UUID NOT NULL,
    learner_id UUID NOT NULL REFERENCES learners(id),
    diksha_learner_registry_id VARCHAR(100),
    digilocker_registered BOOLEAN DEFAULT false,
    last_diksha_sync TIMESTAMP,
    last_digilocker_sync TIMESTAMP,
    last_apaar_verify TIMESTAMP,
    apaar_status VARCHAR(50),                  -- active|transferred|completed
    status VARCHAR(20),                        -- synced|pending|failed
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    UNIQUE(learner_id)
);

CREATE INDEX idx_learner_govt_refs_diksha ON learner_govt_references(diksha_learner_registry_id);
```

---

## 8. API Endpoints (Schools24 Internal)

### 8.1 Manual Sync Triggers (Admin)

```
GET /api/v1/admin/interop/status
  → Returns: Current sync status, next scheduled sync, failures

POST /api/v1/admin/interop/sync-learner
  Body: { learner_id: UUID }
  → Immediately sync single learner to DIKSHA

POST /api/v1/admin/interop/sync-batch
  Body: { learner_ids: UUID[], system: "diksha"|"digilocker"|"apaar" }
  → Sync batch of learners

GET /api/v1/admin/interop/failed-syncs
  Query: ?page=1&page_size=50&system=diksha
  → List failed syncs, paginated
```

### 8.2 Webhook Endpoints (Government → Schools24)

```
POST /api/v1/interop/webhooks/diksha
  From: DIKSHA
  Body: { event: "learner.synced"|"learner.rejected", details: {...} }
  
POST /api/v1/interop/webhooks/digilocker
  From: DigiLocker
  Body: { event: "document.registered"|"document.failed", details: {...} }
  
POST /api/v1/interop/webhooks/apaar
  From: APAAR
  Body: { event: "enrollment.confirmed", details: {...} }
```

---

## 9. Risk Assessment & Mitigation

### 9.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Government API Downtime** | Medium | High | Fallback to async queue, notify user of delayed sync |
| **Data Mismatch** (Schools24 vs DIKSHA) | Medium | Medium | Weekly reconciliation job, admin dashboard to detect drift |
| **Learner Duplication** (APAAR) | Low | High | Pre-enrollment duplicate check, manual approval workflow |
| **Signature Verification Failure** | Low | Low | Automated alerts, key rotation testing |
| **Rate Limiting** (gov APIs) | Medium | Medium | Batch syncing with backoff, caching of recent syncs |
| **Compliance Audit Fail** | Low | High | Immutable audit logs, automated compliance reporting |

### 9.2 Mitigation Strategies

1. **Fallback to Async**: If government API fails, queue request in DLQ, notify user
2. **Drift Detection**: Daily reconciliation query to DIKSHA/DigiLocker, alert if mismatch
3. **Pre-Flight Validation**: Check learner exists in APAAR before sync attempt
4. **Audit Logging**: Every request/response logged with signature + timestamp
5. **Key Rotation**: Automated rotation every 90 days with zero-downtime overlap
6. **User Communication**: Email user if learner transfer delayed due to gov sync

---

## 10. Rollout Plan

### Phase 1: Foundation (Weeks 1-2)
- [ ] Create interop module scaffold
- [ ] Implement signature verification
- [ ] Build sync infrastructure (DLQ, retry logic)
- [ ] Create schema migrations
- [ ] Write comprehensive tests

### Phase 2: DIKSHA Integration (Weeks 2-3)
- [ ] Implement learner profile sync
- [ ] Implement learning progress sync
- [ ] Implement transfer event notifications
- [ ] Build admin dashboard for sync status
- [ ] Deploy to staging, test with gov staging APIs

### Phase 3: DigiLocker Integration (Weeks 3-4)
- [ ] Implement document registration
- [ ] Implement document metadata updates
- [ ] Batch syncing for reports/certificates
- [ ] Deploy to staging
- [ ] Test with DigiLocker sandbox

### Phase 4: APAAR Verification (Weeks 4-5)
- [ ] Implement learner verification endpoint
- [ ] Implement duplicate detection
- [ ] Hook into enrollment flow
- [ ] Staging tests
- [ ] Handle verification failures gracefully

### Phase 5: Production Rollout (Week 6)
- [ ] Security audit (signature, rate limiting)
- [ ] Performance testing (10k+ learner sync)
- [ ] User acceptance testing (school admins)
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Monitor for 2 weeks, have rollback plan ready

---

## 11. Compliance & Legal

### 11.1 Data Sharing Agreements

**Required:** DPA (Data Processing Agreement) with Ministry of Education for:
- Learner profile data (name, DOB, APAAR ID)
- Learning progress metrics (scores, attendance)
- Document registrations (metadata only, not content)

**Covered by:** DPDPA consent framework (Privacy Policy §8)

### 11.2 Audit Trail Requirements

Every government sync must log:
- Request timestamp
- Request signature (to prove authenticity)
- Response status + payload
- External learner ID assigned by gov
- Operator/system that triggered sync

Retention: 7 years (per education regulations)

### 11.3 Learner Consent

**For Transfer/Sync:**
- If learner >= 18: Own digital consent
- If learner < 18: Guardian consent (already in system via parental_consents table)

**Capture During Sync:**
```
sync_log.consent_reference = parental_consents.consent_reference
```

---

## 12. Testing Strategy

### 12.1 Unit Tests
- Signature generation & verification
- Retry logic (exponential backoff)
- Error code handling
- Data model validation

### 12.2 Integration Tests
- Mock DIKSHA API server (use `httptest`)
- Test learner sync happy path
- Test failure scenarios (timeout, 500, invalid signature)
- Test idempotency (same request_id returns cached response)

### 12.3 End-to-End Tests
- Create learner → sync to DIKSHA → verify in staging registry
- Transfer learner → notification sent → APAAR updated
- Register document → DigiLocker metadata synced

### 12.4 Load Tests
- Sync 10,000 learners in parallel
- Retention of sign-in key rotation (old key still works during overlap)
- Rate limiting handled gracefully

---

## 13. Monitoring & Alerts

### 13.1 Metrics to Track

```
1. Sync Success Rate: % of syncs that succeeded on first attempt
2. Sync Latency: Time from trigger → gov confirmation
3. DLQ Size: # of failed syncs awaiting manual review
4. API Availability: % of time gov APIs responded successfully
5. Key Rotation Events: Timestamp of last rotation, days until next
```

### 13.2 Alerts

```
Critical:
- 3+ consecutive sync failures to DIKSHA
- Signature verification failure (possible key compromise)
- DLQ size > 50 items

Warning:
- Sync latency > 2 minutes
- Rate limiting detected (429 responses)
- 10% of learners out of sync with DIKSHA
```

### 13.3 Dashboard (Admin UI)

**Endpoint:** `/admin/interop/dashboard`

Shows:
- Last sync timestamp per system (DIKSHA, DigiLocker, APAAR)
- # of pending syncs
- # of failed syncs (with error breakdown)
- 30-day success rate graph
- Recent DLQ entries needing review

---

## 14. Production Checklist

Before going live, verify:

- [ ] Legal review of DPA with government signed
- [ ] Security audit passed (signature verification, rate limiting)
- [ ] All 6 phases completed
- [ ] Staging tested with government staging APIs
- [ ] DLQ monitoring and alerting operational
- [ ] Audit logs immutable and retained
- [ ] Rollback plan tested (disable interop config, revert learner state)
- [ ] Admin training completed (how to leverage new features)
- [ ] Support team trained on troubleshooting common issues
- [ ] Gradual rollout plan finalized (10% → 50% → 100% over 2 weeks)
- [ ] After-hours support available during initial rollout

---

## 15. Future Enhancements

Once Phase 1-5 complete:

1. **Real-time Webhooks**: DIKSHA/DigiLocker push events (not just pull)
2. **Learner Profile UI**: View APAAR status + linked documents in student portal
3. **Batch Operations**: Admin can trigger mass transfers/syncs
4. **Compliance Reporting**: Auto-generate NDEAR compliance reports
5. **Partner Integrations**: Allow other schools to query learner records (with consent)

---

## 16. Code Structure (Go Module Layout)

```
internal/modules/interop/
├── handler.go                 # HTTP handlers for admin/webhook endpoints
├── service.go                 # Business logic (when/what to sync)
├── repository.go              # DB operations (sync_logs, govt_references)
├── models.go                  # Go structs for requests/responses
├── client/
│   ├── diksha.go             # DIKSHA API client
│   ├── digilocker.go         # DigiLocker API client
│   └── apaar.go              # APAAR verification client
├── security/
│   ├── signature.go          # HMAC signing & verification
│   └── key_manager.go        # Key rotation logic
├── queue/
│   ├── dlq.go                # Dead letter queue implementation
│   └── retry.go              # Retry logic with exponential backoff
└── tests/
    ├── mocks.go              # Mock government APIs
    ├── service_test.go
    ├── signature_test.go
    └── retry_test.go
```

---

## Summary

This architecture provides a **secure, auditable, resilient** integration with India's government education systems. Key principles:

1. **Security First**: HMAC signatures, rate limiting, key rotation
2. **Reliability**: Retry logic, DLQ for failures, idempotency
3. **Auditability**: Immutable log trail of every government interaction
4. **User-Friendly**: Async syncing, no blocking delays, clear status visibility
5. **Compliance-Ready**: DPDPA consent enforcement, DPA enforcement

**Next Steps:**
1. Finalize government API spec with Ministry of Education
2. Secure DPA signatures from each government system
3. Begin Phase 1 implementation (week 1-2)
4. Target production rollout in week 6
