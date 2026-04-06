# ADR-002: Consent Lifecycle

**Status:** Accepted  
**Date:** 2026-03-18  
**Decision-makers:** Schools24 Platform Engineering + Legal  

## Context

Schools24 handles minors' data under India's DPDPA framework. Parental/guardian consent
is a legal prerequisite for data processing. This ADR captures the current consent model
and identifies gaps that future PRs will address.

## Current State

### Schema (`migrations/tenant/064_parental_consents.sql`)

```sql
parental_consents (
  id UUID PRIMARY KEY,
  school_id UUID NOT NULL,
  admission_application_id UUID NOT NULL,
  student_user_id UUID,
  student_date_of_birth DATE NOT NULL,
  guardian_name VARCHAR(200) NOT NULL,
  guardian_phone VARCHAR(20) NOT NULL,
  guardian_relation VARCHAR(100),
  consent_method VARCHAR(40) NOT NULL,  -- 'otp','written','digital','in_person','other'
  declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  consent_reference VARCHAR(255),
  consent_ip VARCHAR(64),
  consent_user_agent TEXT,
  policy_version VARCHAR(30) NOT NULL DEFAULT '2026-03-17',
  consented_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (school_id, admission_application_id)
)
```

**Indexes:** `(school_id, consented_at DESC)`, `(admission_application_id)`

### How Consent Is Captured Today

1. Parent submits admission application via public admission form.
2. Form includes consent declaration checkbox + guardian details.
3. `parental_consents` record created during `SubmitAdmission` in public module.
4. Consent reference is used by interop payload validation (`validateLegalGuards`).

### What Is Missing (Gap Analysis)

| Capability | Status | Notes |
|-----------|--------|-------|
| Consent grant | ✅ Implemented | Via admission flow |
| Consent withdrawal | ❌ Missing | No `withdrawn_at`, no withdrawal API |
| Consent audit trail | ❌ Missing | No immutable event log |
| Data Subject Requests (DSR) | ❌ Missing | No access/rectification/erasure tracking |
| Consent versioning | ⚠️ Partial | `policy_version` stored but no version history |
| Re-consent on policy change | ❌ Missing | No mechanism to invalidate old consents |

### Interop Dependency

The interop module's `validateLegalGuards()` checks for:
- `is_minor` → requires `guardian_consent_reference` + `consent_method`
- This validation runs at job creation time, not at consent grant time.

## Decision

PR-02 will extend `parental_consents` with withdrawal lifecycle columns and add
`data_subject_requests` + `consent_audit_events` tables. PR-03 will expose operational
APIs for these capabilities.

## Consequences

- All consent mutations MUST create an audit event.
- Withdrawal MUST be a soft-state change (retain record for audit, mark as withdrawn).
- DSR requests MUST follow a defined state machine: `submitted → under_review → approved/rejected → completed`.
- Existing admission flow remains unchanged.
