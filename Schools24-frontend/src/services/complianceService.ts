import { api } from '@/lib/api'
import type {
  ConsentRecord,
  WithdrawConsentPayload,
  DataSubjectRequest,
  CreateDSRPayload,
  UpdateDSRStatusPayload,
  AuditEvent,
  ReconciliationSummary,
  StudentIdentity,
  VerificationResult,
} from '@/types/compliance'

// ---------------------------------------------------------------------------
// Consent History
// ---------------------------------------------------------------------------

export async function getConsentHistory(status = 'all', limit = 50) {
  return api.get<{ items: ConsentRecord[]; count: number }>(
    `/admin/consent/history?status=${status}&limit=${limit}`
  )
}

export async function withdrawConsent(consentId: string, payload: WithdrawConsentPayload) {
  return api.post<{ message: string }>(`/admin/consent/${consentId}/withdraw`, payload)
}

// ---------------------------------------------------------------------------
// Data Subject Requests (DSR)
// ---------------------------------------------------------------------------

export async function createDSR(payload: CreateDSRPayload) {
  return api.post<{ dsr: DataSubjectRequest }>('/admin/dsr', payload)
}

export async function listDSRs(status = 'all', limit = 50) {
  return api.get<{ items: DataSubjectRequest[]; count: number }>(
    `/admin/dsr?status=${status}&limit=${limit}`
  )
}

export async function getDSR(id: string) {
  return api.get<{ dsr: DataSubjectRequest }>(`/admin/dsr/${id}`)
}

export async function updateDSRStatus(id: string, payload: UpdateDSRStatusPayload) {
  return api.put<{ message: string }>(`/admin/dsr/${id}/status`, payload)
}

// ---------------------------------------------------------------------------
// Audit Events
// ---------------------------------------------------------------------------

export async function getAuditEvents(eventType = '', limit = 50) {
  return api.get<{ items: AuditEvent[]; count: number }>(
    `/admin/consent/audit?event_type=${eventType}&limit=${limit}`
  )
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export async function getReconciliationSummary() {
  return api.get<{ summary: ReconciliationSummary }>('/admin/reconciliations/summary')
}

// ---------------------------------------------------------------------------
// Identity Verification
// ---------------------------------------------------------------------------

export async function verifyLearnerIdentity(
  studentId: string,
  verificationType: string,
  dryRun = false
) {
  return api.post<{ result: VerificationResult }>(`/admin/learners/${studentId}/verify`, {
    verification_type: verificationType,
    dry_run: dryRun,
  })
}

export async function getStudentIdentity(studentId: string) {
  return api.get<{ identity: StudentIdentity }>(`/admin/learners/${studentId}/identity`)
}

export async function listUnverifiedStudents(limit = 50) {
  return api.get<{ items: StudentIdentity[]; count: number }>(
    `/admin/learners/unverified?limit=${limit}`
  )
}
