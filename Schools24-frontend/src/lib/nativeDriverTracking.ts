'use client'

import { Capacitor, registerPlugin } from '@capacitor/core'
import { buildWsBaseUrl } from '@/lib/ws-ticket'

type NativeDriverTrackingStatus = {
  serviceEnabled: boolean
  trackingAllowed: boolean
  websocketConnected: boolean
  gpsActive: boolean
  lastPingAt: number
  lastLatitude?: number
  lastLongitude?: number
  message: string
}

type StartServiceOptions = {
  apiBaseUrl: string
  wsBaseUrl: string
  accessToken: string
  refreshToken?: string
}

type NativeDriverTrackingPlugin = {
  startService(options: StartServiceOptions): Promise<NativeDriverTrackingStatus & { started: boolean }>
  stopService(): Promise<NativeDriverTrackingStatus & { stopped: boolean }>
  getStatus(): Promise<NativeDriverTrackingStatus>
}

const STORAGE_KEYS = {
  TOKEN: 'School24_token',
  REFRESH_TOKEN: 'School24_refresh_token',
} as const

export const DriverTrackingNative = registerPlugin<NativeDriverTrackingPlugin>('DriverTrackingNative')

export function isNativeDriverTrackingAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DriverTrackingNative')
}

function getStoredToken(key: string) {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(key) || sessionStorage.getItem(key) || ''
}

function buildAbsoluteApiBaseUrl() {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || '/api/v1').replace(/\/+$/, '')
  if (apiUrl.startsWith('/')) {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}${apiUrl}`
  }
  return apiUrl
}

function buildAbsoluteWsBaseUrl() {
  return buildWsBaseUrl().replace(/\/+$/, '')
}

export async function startNativeDriverTrackingService(explicitAccessToken?: string, explicitRefreshToken?: string) {
  if (!isNativeDriverTrackingAvailable()) return null
  const accessToken = explicitAccessToken || getStoredToken(STORAGE_KEYS.TOKEN)
  if (!accessToken) {
    throw new Error('Driver tracking service requires an access token')
  }

  return DriverTrackingNative.startService({
    apiBaseUrl: buildAbsoluteApiBaseUrl(),
    wsBaseUrl: buildAbsoluteWsBaseUrl(),
    accessToken,
    refreshToken: explicitRefreshToken ?? getStoredToken(STORAGE_KEYS.REFRESH_TOKEN),
  })
}

export async function stopNativeDriverTrackingService() {
  if (!isNativeDriverTrackingAvailable()) return null
  return DriverTrackingNative.stopService()
}

export async function getNativeDriverTrackingStatus() {
  if (!isNativeDriverTrackingAvailable()) return null
  return DriverTrackingNative.getStatus()
}

export type { NativeDriverTrackingStatus }
