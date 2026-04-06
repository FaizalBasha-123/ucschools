'use client'

/**
 * usePermissionPrompts
 *
 * Runs on every app launch while on a native Capacitor platform.
 * Prompts the user for location and notification permissions until both
 * are granted.  On web / browser the hook is a no-op.
 */

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { AppPermissions } from '@/lib/nativeAppPermissions'

const PERMISSION_PROMPT_KEY = 'School24_permissions_prompted'

export function usePermissionPrompts() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    if (typeof window !== 'undefined' && localStorage.getItem(PERMISSION_PROMPT_KEY)) {
      return
    }

    void requestPermissions()
      .finally(() => {
        if (typeof window !== 'undefined') {
          localStorage.setItem(PERMISSION_PROMPT_KEY, '1')
        }
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

async function requestPermissions() {
  await requestLocationPermission()
  await requestBackgroundLocationPermission()
  await requestNotificationPermission()
}

// ── Location ─────────────────────────────────────────────────────────────────

async function requestLocationPermission() {
  try {
    const { Geolocation } = await import('@capacitor/geolocation')
    const status = await Geolocation.checkPermissions()

    if (status.location === 'granted' || status.coarseLocation === 'granted') return

    // 'prompt' or 'denied' — attempt request (Android will show dialog on 'prompt',
    // and on 'denied' the OS will not show a dialog but may redirect to settings).
    await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] })
  } catch {
    // Plugin unavailable in current build — silently ignore
  }
}

async function requestBackgroundLocationPermission() {
  try {
    const status = await AppPermissions.checkStartupPermissions()
    if (status.backgroundLocation === 'granted') return

    await AppPermissions.requestBackgroundLocation()
  } catch {
    // Native plugin unavailable in current build — silently ignore
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function requestNotificationPermission() {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const status = await PushNotifications.checkPermissions()

    if (status.receive === 'granted') return

    await PushNotifications.requestPermissions()
  } catch {
    // Plugin unavailable or push notifications not configured — silently ignore
  }
}

