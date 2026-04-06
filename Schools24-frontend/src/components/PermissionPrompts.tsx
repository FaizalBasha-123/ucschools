'use client'

import { usePermissionPrompts } from '@/hooks/usePermissionPrompts'

/**
 * Invisible client component that fires Capacitor permission prompts on
 * every app launch until the user grants both location and notification access.
 * Renders nothing — purely a hook mount point in the server-rendered layout.
 */
export function PermissionPrompts() {
  usePermissionPrompts()
  return null
}
