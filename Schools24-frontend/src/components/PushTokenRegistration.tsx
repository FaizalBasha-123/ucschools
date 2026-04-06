'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useNativePushRegistration } from '@/hooks/useNativePushRegistration'

export function PushTokenRegistration() {
  const { user } = useAuth()
  useNativePushRegistration(user)
  return null
}
