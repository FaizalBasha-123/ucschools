'use client'

import { registerPlugin } from '@capacitor/core'

export type NativePermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'

interface StartupPermissionStatus {
  backgroundLocation: NativePermissionState
}

interface AppPermissionsPlugin {
  checkStartupPermissions(): Promise<StartupPermissionStatus>
  requestBackgroundLocation(): Promise<Pick<StartupPermissionStatus, 'backgroundLocation'>>
  openAppSettings(): Promise<{ opened: boolean }>
  openLocationSettings(): Promise<{ opened: boolean }>
  promptEnableLocationServices(): Promise<{ opened: boolean }>
}

export const AppPermissions = registerPlugin<AppPermissionsPlugin>('AppPermissions')
