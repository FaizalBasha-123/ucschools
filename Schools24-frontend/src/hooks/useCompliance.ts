import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getConsentHistory,
  withdrawConsent,
  createDSR,
  listDSRs,
  getDSR,
  updateDSRStatus,
  getAuditEvents,
  getReconciliationSummary,
  verifyLearnerIdentity,
  listUnverifiedStudents,
} from '@/services/complianceService'
import type { CreateDSRPayload, UpdateDSRStatusPayload, WithdrawConsentPayload } from '@/types/compliance'

// ---------------------------------------------------------------------------
// Consent Hooks
// ---------------------------------------------------------------------------

export function useConsentHistory(status = 'all', limit = 50) {
  return useQuery({
    queryKey: ['compliance', 'consent', 'history', status, limit],
    queryFn: () => getConsentHistory(status, limit),
  })
}

export function useWithdrawConsent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ consentId, payload }: { consentId: string; payload: WithdrawConsentPayload }) =>
      withdrawConsent(consentId, payload),
    onSuccess: () => {
      toast.success('Consent withdrawn', { description: 'The consent record has been updated.' })
      qc.invalidateQueries({ queryKey: ['compliance', 'consent'] })
      qc.invalidateQueries({ queryKey: ['compliance', 'audit'] })
    },
    onError: (err: Error) => toast.error('Withdrawal failed', { description: err.message }),
  })
}

// ---------------------------------------------------------------------------
// DSR Hooks
// ---------------------------------------------------------------------------

export function useDSRList(status = 'all', limit = 50) {
  return useQuery({
    queryKey: ['compliance', 'dsr', 'list', status, limit],
    queryFn: () => listDSRs(status, limit),
  })
}

export function useDSRDetail(id: string | null) {
  return useQuery({
    queryKey: ['compliance', 'dsr', 'detail', id],
    queryFn: () => getDSR(id!),
    enabled: !!id,
  })
}

export function useCreateDSR() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateDSRPayload) => createDSR(payload),
    onSuccess: () => {
      toast.success('DSR created', { description: 'Data subject request has been submitted.' })
      qc.invalidateQueries({ queryKey: ['compliance', 'dsr'] })
      qc.invalidateQueries({ queryKey: ['compliance', 'audit'] })
    },
    onError: (err: Error) => toast.error('Failed to create DSR', { description: err.message }),
  })
}

export function useUpdateDSRStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateDSRStatusPayload }) =>
      updateDSRStatus(id, payload),
    onSuccess: () => {
      toast.success('DSR status updated')
      qc.invalidateQueries({ queryKey: ['compliance', 'dsr'] })
      qc.invalidateQueries({ queryKey: ['compliance', 'audit'] })
    },
    onError: (err: Error) => toast.error('Status update failed', { description: err.message }),
  })
}

// ---------------------------------------------------------------------------
// Audit Hooks
// ---------------------------------------------------------------------------

export function useAuditEvents(eventType = '', limit = 50) {
  return useQuery({
    queryKey: ['compliance', 'audit', eventType, limit],
    queryFn: () => getAuditEvents(eventType, limit),
  })
}

// ---------------------------------------------------------------------------
// Reconciliation Hooks
// ---------------------------------------------------------------------------

export function useReconciliationSummary() {
  return useQuery({
    queryKey: ['compliance', 'reconciliation', 'summary'],
    queryFn: getReconciliationSummary,
  })
}

// ---------------------------------------------------------------------------
// Identity Verification Hooks
// ---------------------------------------------------------------------------

export function useUnverifiedStudents(limit = 50) {
  return useQuery({
    queryKey: ['compliance', 'identity', 'unverified', limit],
    queryFn: () => listUnverifiedStudents(limit),
  })
}

export function useVerifyLearner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studentId, type, dryRun }: { studentId: string; type: string; dryRun?: boolean }) =>
      verifyLearnerIdentity(studentId, type, dryRun),
    onSuccess: (data) => {
      const msg = data.result?.message || 'Verification complete'
      toast.success('Identity verified', { description: msg })
      qc.invalidateQueries({ queryKey: ['compliance', 'identity'] })
      qc.invalidateQueries({ queryKey: ['compliance', 'audit'] })
    },
    onError: (err: Error) => toast.error('Verification failed', { description: err.message }),
  })
}
