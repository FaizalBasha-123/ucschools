import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createTicket,
  deleteTicket,
  getMyTickets,
  getTicketById,
  getUnreadTicketCount,
  listTickets,
  updateTicketStatus,
  CreateTicketPayload,
  UpdateTicketStatusPayload,
} from '@/services/supportService'

// ---------------------------------------------------------------------------
// End-user hooks
// ---------------------------------------------------------------------------

export function useMyTickets(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['support', 'mine', page, pageSize],
    queryFn: () => getMyTickets(page, pageSize),
  })
}

export function useCreateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateTicketPayload) => createTicket(payload),
    onSuccess: () => {
      toast.success('Ticket submitted', { description: 'We will get back to you soon.' })
      qc.invalidateQueries({ queryKey: ['support', 'mine'] })
    },
    onError: (err: Error) => {
      toast.error('Failed to submit ticket', { description: err.message })
    },
  })
}

// ---------------------------------------------------------------------------
// Super admin hooks
// ---------------------------------------------------------------------------

export function useTicketList(params: {
  page?: number
  page_size?: number
  status?: string
  category?: string
  label?: string
  search?: string
}) {
  return useQuery({
    queryKey: ['support', 'admin', 'list', params],
    queryFn: () => listTickets(params),
  })
}

export function useTicketById(id: string | null) {
  return useQuery({
    queryKey: ['support', 'admin', 'ticket', id],
    queryFn: () => getTicketById(id!),
    enabled: !!id,
  })
}

export function useUpdateTicketStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTicketStatusPayload }) =>
      updateTicketStatus(id, payload),
    onSuccess: () => {
      toast.success('Ticket updated')
      qc.invalidateQueries({ queryKey: ['support', 'admin'] })
      qc.invalidateQueries({ queryKey: ['support', 'unread'] })
    },
    onError: (err: Error) => toast.error('Update failed', { description: err.message }),
  })
}

export function useDeleteTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTicket(id),
    onSuccess: () => {
      toast.success('Ticket deleted')
      qc.invalidateQueries({ queryKey: ['support', 'admin'] })
      qc.invalidateQueries({ queryKey: ['support', 'unread'] })
    },
    onError: (err: Error) => toast.error('Delete failed', { description: err.message }),
  })
}

export function useUnreadTicketCount(enabled = true) {
  return useQuery({
    queryKey: ['support', 'unread'],
    queryFn: getUnreadTicketCount,
    enabled,
    refetchInterval: enabled ? 60_000 : false, // refresh every minute when active
    staleTime: 30_000,
  })
}
