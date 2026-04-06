import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, shouldUseCookieSession } from '@/lib/api'
import { toast } from 'sonner'

interface UpdateProfileRequest {
  full_name?: string
  phone?: string
  profile_picture_url?: string
}

interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

interface UpdateProfileResponse {
  user: {
    id: string
    email: string
    role: string
    full_name: string
    phone?: string
    profile_picture_url?: string
    school_id?: string
    email_verified: boolean
    created_at: string
    updated_at: string
  }
}

interface ChangePasswordResponse {
  message: string
}

const STORAGE_KEYS = {
  USER: 'School24_user',
  TOKEN: 'School24_token',
  REMEMBER: 'School24_remember',
} as const

const getAuthStorage = (): Storage => {
  if (typeof window === 'undefined') return localStorage
  const remembered = localStorage.getItem(STORAGE_KEYS.REMEMBER) === 'true'
  return remembered ? localStorage : sessionStorage
}

const syncUpdatedUserToStorage = (updatedUser: UpdateProfileResponse['user']) => {
  if (typeof window === 'undefined') return

  const primary = getAuthStorage()
  const existingRaw = primary.getItem(STORAGE_KEYS.USER) || localStorage.getItem(STORAGE_KEYS.USER) || sessionStorage.getItem(STORAGE_KEYS.USER)
  const existingUser = existingRaw ? JSON.parse(existingRaw) : {}

  const mergedUser = {
    ...existingUser,
    ...updatedUser,
    name: updatedUser.full_name || existingUser.name,
    full_name: updatedUser.full_name || existingUser.full_name,
    avatar: updatedUser.profile_picture_url || existingUser.avatar,
    profile_picture_url: updatedUser.profile_picture_url || existingUser.profile_picture_url,
    phone: updatedUser.phone ?? existingUser.phone,
  }

  const useCookieSession = shouldUseCookieSession()
  if (useCookieSession) {
    primary.setItem(STORAGE_KEYS.USER, JSON.stringify(mergedUser))
    return
  }

  if (primary.getItem(STORAGE_KEYS.TOKEN)) {
    primary.setItem(STORAGE_KEYS.USER, JSON.stringify(mergedUser))
  }
  if (localStorage.getItem(STORAGE_KEYS.TOKEN)) {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(mergedUser))
  }
  if (sessionStorage.getItem(STORAGE_KEYS.TOKEN)) {
    sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(mergedUser))
  }
}

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response
    const message = response?.data?.message
    if (message) return message
  }
  return fallback
}

/**
 * Hook to update user profile (name, phone, avatar)
 * Works for both super_admins and regular users
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()

  return useMutation<UpdateProfileResponse, Error, UpdateProfileRequest>({
    mutationFn: async (data) => {
      return await api.put<UpdateProfileResponse>('/auth/me', data)
    },
    onSuccess: (response) => {
      syncUpdatedUserToStorage(response.user)
      // Invalidate auth queries to refresh user data
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success('Profile updated successfully')
    },
    onError: (error: unknown) => {
      const message = getApiErrorMessage(error, 'Failed to update profile')
      toast.error(message)
    },
  })
}

/**
 * Hook to change user password
 * Requires current password verification
 */
export function useChangePassword() {
  return useMutation<ChangePasswordResponse, Error, ChangePasswordRequest>({
    mutationFn: async (data) => {
      return await api.post<ChangePasswordResponse>('/auth/change-password', data)
    },
    onSuccess: () => {
      toast.success('Password changed successfully')
    },
    onError: (error: unknown) => {
      const response = typeof error === 'object' && error !== null
        ? (error as { response?: { data?: { error?: string; message?: string } } }).response
        : undefined
      const errorCode = response?.data?.error
      const message = response?.data?.message

      if (errorCode === 'invalid_password') {
        toast.error('Current password is incorrect')
      } else if (errorCode === 'weak_password') {
        toast.error('New password must be at least 8 characters')
      } else {
        toast.error(message || 'Failed to change password')
      }
    },
  })
}
