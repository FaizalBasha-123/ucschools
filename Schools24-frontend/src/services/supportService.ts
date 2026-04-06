import { api } from '@/lib/api'

export interface SupportTicket {
  id: string
  ticket_number: number
  user_id?: string
  user_type: string
  user_name: string
  user_email: string
  school_id?: string
  school_name?: string
  source?: string
  label: string  // landing | student | teacher | school_admin | super_admin | other
  subject: string
  description: string
  category: string
  priority: string
  status: string
  admin_notes?: string
  resolved_by_name?: string
  resolved_at?: string
  created_at: string
  updated_at: string
}

export interface TicketListResponse {
  tickets: SupportTicket[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface CreateTicketPayload {
  subject: string
  description: string
  category: string
  priority: string
}

export interface UpdateTicketStatusPayload {
  status: string
  admin_notes?: string
}

export interface UnreadCountResponse {
  count: number
}

// End-user: create a ticket
export const createTicket = (payload: CreateTicketPayload) =>
  api.post<{ ticket: SupportTicket }>('/support/tickets', payload)

// End-user: list own tickets
export const getMyTickets = (page = 1, pageSize = 20) =>
  api.get<TicketListResponse>(`/support/tickets/mine?page=${page}&page_size=${pageSize}`)

// Super admin: list all tickets with optional filters
export const listTickets = (params: {
  page?: number
  page_size?: number
  status?: string
  category?: string
  label?: string
  search?: string
}) => {
  const q = new URLSearchParams()
  if (params.page)      q.set('page',      String(params.page))
  if (params.page_size) q.set('page_size', String(params.page_size))
  if (params.status)    q.set('status',    params.status)
  if (params.category)  q.set('category',  params.category)
  if (params.label)     q.set('label',     params.label)
  if (params.search)    q.set('search',    params.search)
  return api.get<TicketListResponse>(`/super-admin/support/tickets?${q.toString()}`)
}

// Super admin: get one ticket
export const getTicketById = (id: string) =>
  api.get<{ ticket: SupportTicket }>(`/super-admin/support/tickets/${id}`)

// Super admin: update status / add notes
export const updateTicketStatus = (id: string, payload: UpdateTicketStatusPayload) =>
  api.put<{ ticket: SupportTicket }>(`/super-admin/support/tickets/${id}/status`, payload)

// Super admin: delete ticket permanently
export const deleteTicket = (id: string) =>
  api.delete<{ message: string }>(`/super-admin/support/tickets/${id}`)

// Super admin: unread (open) count for notification badge
export const getUnreadTicketCount = () =>
  api.get<UnreadCountResponse>('/super-admin/support/tickets/unread-count')
