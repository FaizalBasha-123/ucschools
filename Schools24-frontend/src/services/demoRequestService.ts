import { api } from '@/lib/api'

export interface DemoRequestAdminView {
  name: string
  email: string
}

export interface DemoRequest {
  id: string
  request_number: number
  school_name: string
  school_code?: string
  address?: string
  contact_email?: string
  admins: DemoRequestAdminView[]
  status: 'pending' | 'accepted' | 'trashed'
  accepted_school_id?: string
  accepted_school_name?: string
  accepted_at?: string
  accepted_by_name?: string
  trashed_at?: string
  trashed_by_name?: string
  delete_after?: string
  source_ip?: string
  created_at: string
  updated_at: string
}

export interface DemoRequestListResponse {
  requests: DemoRequest[]
  total: number
  page: number
  page_size: number
  total_pages: number
  available_years: number[]
}

export interface DemoRequestStatsMonth {
  month: number
  total: number
}

export interface DemoRequestStatsResponse {
  year: number
  month: number
  total: number
  pending: number
  accepted: number
  trashed: number
  available_years: number[]
  months: DemoRequestStatsMonth[]
}

export interface DemoRequestListParams {
  page?: number
  pageSize?: number
  search?: string
  status?: string
  year?: number
  month?: number
}

export const listDemoRequests = async (params: DemoRequestListParams): Promise<DemoRequestListResponse> => {
  const q = new URLSearchParams()
  if (params.page) q.set('page', String(params.page))
  if (params.pageSize) q.set('page_size', String(params.pageSize))
  if (params.search) q.set('search', params.search)
  if (params.status && params.status !== 'all') q.set('status', params.status)
  if (params.year) q.set('year', String(params.year))
  if (params.month) q.set('month', String(params.month))
  return api.get<DemoRequestListResponse>(`/super-admin/demo-requests?${q.toString()}`)
}

export const getDemoRequestStats = async (year?: number, month?: number): Promise<DemoRequestStatsResponse> => {
  const q = new URLSearchParams()
  if (year) q.set('year', String(year))
  if (month) q.set('month', String(month))
  return api.get<DemoRequestStatsResponse>(`/super-admin/demo-requests/stats?${q.toString()}`)
}

export const acceptDemoRequest = async (id: string, password: string) =>
  api.post<{ request: DemoRequest }>(`/super-admin/demo-requests/${id}/accept`, { password })

export const trashDemoRequest = async (id: string, password: string) =>
  api.post<{ request: DemoRequest }>(`/super-admin/demo-requests/${id}/trash`, { password })
