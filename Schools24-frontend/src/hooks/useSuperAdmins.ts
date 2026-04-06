import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export interface SuperAdmin {
  id: string
  email: string
  full_name: string
  phone?: string
  profile_picture_url?: string
  email_verified: boolean
  last_login_at?: string
  created_at: string
  updated_at: string
  is_suspended?: boolean
  suspended_at?: string
}

interface SuperAdminsResponse {
  super_admins: SuperAdmin[]
}

interface CreateSuperAdminRequest {
  email: string
  password: string
  full_name: string
  phone?: string
  profile_picture_url?: string
  current_password: string  // Password of the current super admin for verification
}

interface CreateSuperAdminResponse {
  super_admin: SuperAdmin
}

export function useSuperAdmins(enabled = true) {
  return useQuery<SuperAdmin[]>({
    queryKey: ['super-admins'],
    enabled,
    queryFn: async () => {
      const response = await api.get<SuperAdminsResponse>('/super-admins')
      return response.super_admins
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useCreateSuperAdmin() {
  const queryClient = useQueryClient()

  return useMutation<CreateSuperAdminResponse, Error, CreateSuperAdminRequest>({
    mutationFn: async (data) => {
      const response = await api.post<CreateSuperAdminResponse>('/super-admins', data)
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admins'] })
      toast.success('Super admin created')
    },
    onError: (error: any) => {
      const message = error.message || 'Failed to create super admin'
      toast.error('Failed to create super admin', {
        description: message
      })
    },
  })
}

export function useDeleteSuperAdmin() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, { id: string; password: string }>({
    mutationFn: async ({ id, password }) => {
      await api.delete(`/super-admins/${id}`, { body: JSON.stringify({ password }) })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admins'] })
      toast.success('Super admin removed')
    },
    onError: (error: any) => {
      const message = error.message || 'Failed to remove super admin'
      toast.error('Failed to remove super admin', {
        description: message
      })
    },
  })
}

export function useSuspendSuperAdmin() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, { id: string; password: string }>({
    mutationFn: async ({ id, password }) => {
      await api.put(`/super-admins/${id}/suspend`, { password })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admins'] })
      toast.success('Super admin suspended')
    },
    onError: (error: any) => {
      const message = error.message || 'Failed to suspend super admin'
      toast.error('Failed to suspend super admin', { description: message })
    },
  })
}

export function useUnsuspendSuperAdmin() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, { id: string; password: string }>({
    mutationFn: async ({ id, password }) => {
      await api.put(`/super-admins/${id}/unsuspend`, { password })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admins'] })
      toast.success('Suspension removed')
    },
    onError: (error: any) => {
      const message = error.message || 'Failed to remove suspension'
      toast.error('Failed to remove suspension', { description: message })
    },
  })
}
