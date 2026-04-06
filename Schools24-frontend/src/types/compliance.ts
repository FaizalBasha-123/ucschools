// Compliance module types — maps to backend consent/DSR/reconciliation models.

export interface ConsentRecord {
  id: string
  school_id: string
  admission_application_id: string
  student_user_id?: string
  student_date_of_birth: string
  guardian_name: string
  guardian_phone: string
  guardian_relation?: string
  consent_method: string
  declaration_accepted: boolean
  consent_reference?: string
  policy_version: string
  status: 'active' | 'withdrawn'
  consented_at: string
  withdrawn_at?: string
  withdrawn_by?: string
  withdrawal_reason?: string
  withdrawal_method?: string
  created_at: string
}

export interface WithdrawConsentPayload {
  reason: string
  method: 'otp' | 'written' | 'digital' | 'in_person' | 'other'
}

export interface DataSubjectRequest {
  id: string
  school_id: string
  requester_name: string
  requester_email?: string
  requester_phone?: string
  requester_relation?: string
  subject_student_id?: string
  subject_name?: string
  request_type: 'access' | 'rectification' | 'erasure' | 'portability' | 'objection'
  status: 'submitted' | 'under_review' | 'approved' | 'rejected' | 'completed' | 'cancelled'
  description?: string
  resolution_notes?: string
  assigned_to?: string
  reviewed_by?: string
  review_note?: string
  submitted_at?: string
  reviewed_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface CreateDSRPayload {
  requester_name: string
  requester_email?: string
  requester_phone?: string
  requester_relation?: string
  subject_student_id?: string
  subject_name?: string
  request_type: string
  description?: string
}

export interface UpdateDSRStatusPayload {
  status: string
  resolution_notes?: string
  review_note?: string
}

export interface AuditEvent {
  id: string
  school_id: string
  consent_id?: string
  dsr_id?: string
  event_type: string
  actor_id?: string
  actor_role?: string
  metadata?: Record<string, unknown>
  created_at: string
}

export interface ReconciliationSummary {
  total: number
  pending: number
  merged: number
  dismissed: number
  unmerged: number
}

export interface StudentIdentity {
  id: string
  school_id: string
  full_name: string
  apaar_id?: string
  abc_id?: string
  apaar_verified_at?: string
  abc_verified_at?: string
  identity_verification_status: string
}

export interface VerificationResult {
  student_id: string
  apaar_status: string
  abc_status: string
  identity_verification_status: string
  apaar_verified_at?: string
  abc_verified_at?: string
  reconciliation_required: boolean
  message: string
}
