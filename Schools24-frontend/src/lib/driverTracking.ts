/**
 * driverTracking.ts
 *
 * Background GPS → WebSocket bridge for the Schools24 driver app.
 *
 * When running inside the Capacitor native shell (Android APK), the
 * `@capacitor-community/background-geolocation` plugin handles location —
 * it runs as an Android ForegroundService, so GPS continues even with
 * the screen locked or the app in the background.
 *
 * When running in a regular browser (desktop / PWA), it falls back to
 * `navigator.geolocation.watchPosition` (foreground only, but functional
 * for testing/admin demos).
 *
 * Usage:
 *   const tracker = createDriverTracker(backendWsUrl)
 *   await tracker.start()   // connects WS, starts GPS, begins sending pings
 *   tracker.stop()          // stops GPS, closes WS
 *   tracker.onStatusChange = (status) => { ... }
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { buildWsBaseUrl, getWSTicket } from '@/lib/ws-ticket'
import type {
  BackgroundGeolocationPlugin,
  Location as GeoLocation,
  CallbackError,
} from '@capacitor-community/background-geolocation'

// Lazily resolved only when in native platform; evaluates to undefined on web.
function getBgGeo(): BackgroundGeolocationPlugin | null {
  if (!Capacitor.isNativePlatform()) return null
  return registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
}

export type TrackerStatus =
  | 'idle'
  | 'connecting'
  | 'tracking'
  | 'paused'        // outside IST tracking window (server said so)
  | 'error'
  | 'disconnected'

export interface TrackerEvent {
  status: TrackerStatus
  message?: string
  lat?: number
  lng?: number
  speed?: number
  heading?: number
  lastPingAt?: number // Unix ms
}

export interface DriverTracker {
  start(): Promise<void>
  stop(): void
  onStatusChange?: (event: TrackerEvent) => void
}

// ── factory ───────────────────────────────────────────────────────────────────

export function createDriverTracker(
  backendBaseUrl: string, // e.g. "https://schools24-backend-xxxxx.onrender.com/api/v1"
): DriverTracker {
  let ws: WebSocket | null = null
  let watchId: number | null = null        // browser geolocation watchId
  let bgGeoWatcherId: string | null = null  // Capacitor plugin watcher ID
  let heartbeatId: ReturnType<typeof setInterval> | null = null
  let stopped = false
  let lastLocation: { lat: number; lng: number; speed: number; heading: number } | null = null
  let lastFix: { lat: number; lng: number; at: number } | null = null
  let lastGpsFixAt = 0
  let gpsAvailable = true
  let openingSocket = false
  const HEARTBEAT_STALE_MS = 120_000 // keep device "online" while stationary

  const ensureSocketOpen = async () => {
    if (stopped || openingSocket) return
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    openingSocket = true
    try {
      ws = await openWebSocket()
    } catch {
      // best-effort reconnect; next tick or GPS fix will retry
    } finally {
      openingSocket = false
    }
  }

  const startHeartbeat = () => {
    if (heartbeatId) clearInterval(heartbeatId)
    heartbeatId = setInterval(() => {
      if (!lastLocation) return
      if (!gpsAvailable) return
      if (Date.now() - lastGpsFixAt > HEARTBEAT_STALE_MS) return
      sendPing(lastLocation.lat, lastLocation.lng, lastLocation.speed, lastLocation.heading, 'heartbeat')
    }, 5_000)
  }

  const stopHeartbeat = () => {
    if (heartbeatId) {
      clearInterval(heartbeatId)
      heartbeatId = null
    }
  }

  const tracker: DriverTracker = {
    onStatusChange: undefined,

    async start() {
      stopped = false
      gpsAvailable = true
      lastGpsFixAt = 0
      emit({ status: 'connecting', message: 'Opening WebSocket connection…' })

      ws = await openWebSocket()
      if (stopped) { ws?.close(); return }

      startHeartbeat()
      await startGeo()
    },

    stop() {
      stopped = true
      stopHeartbeat()
      stopGeo()
      if (ws) {
        ws.close(1000, 'driver stopped tracking')
        ws = null
      }
      emit({ status: 'idle', message: 'Tracking stopped.' })
    },
  }

  // ── emit helper ─────────────────────────────────────────────────────────────
  function emit(event: TrackerEvent) {
    tracker.onStatusChange?.(event)
  }

  // ── WebSocket ────────────────────────────────────────────────────────────────
  async function fetchDriverTrackingTicket(): Promise<string> {
    const data = await getWSTicket('driver_tracking')
    if (!data.ticket) {
      throw new Error('ws ticket missing')
    }
    return data.ticket
  }

  async function buildDriverWsUrl(): Promise<string> {
    const ticket = await fetchDriverTrackingTicket()
    const wsBase = buildWsBaseUrl() || backendBaseUrl
      .replace(/^https?:\/\//, (m) => (m.startsWith('https') ? 'wss://' : 'ws://'))
      .replace(/\/api\/v1\/?$/, '')
    return `${wsBase.replace(/\/$/, '')}/api/v1/transport/driver/ws?ticket=${encodeURIComponent(ticket)}`
  }

  async function openWebSocket(): Promise<WebSocket> {
    const wsUrl = await buildDriverWsUrl()
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        if (lastLocation) {
          sendPing(lastLocation.lat, lastLocation.lng, lastLocation.speed, lastLocation.heading, 'heartbeat')
        }
        emit({ status: 'tracking', message: 'Connected to server.' })
        resolve(socket)
      }

      socket.onclose = (ev) => {
        if (stopped) return
        if (ev.reason === 'outside_tracking_window') {
          emit({ status: 'paused', message: 'Outside IST tracking window (06:00–09:00 / 17:00–19:00).' })
        } else if (ev.reason === 'session_revoked') {
          emit({ status: 'error', message: 'Session expired. Please sign in again.' })
        } else if (ev.reason === 'no_route_assigned') {
          emit({ status: 'error', message: 'This driver account is not assigned to a bus route.' })
        } else if (ev.reason === 'invalid_ws_scope') {
          emit({ status: 'error', message: 'Driver tracking ticket is invalid or expired. Refresh and try again.' })
        } else if (ev.reason === 'gps_unavailable') {
          emit({ status: 'error', message: 'GPS is turned off. Turn on location services to continue tracking.' })
        } else {
          emit({ status: 'disconnected', message: `Connection closed (${ev.code}).` })
        }
        // Auto-reconnect quickly; most driver disconnects are transient mobile network blips.
        if (!stopped && gpsAvailable) {
          setTimeout(async () => {
            if (!stopped) {
              await ensureSocketOpen()
            }
          }, 2_000)
        }
      }

      socket.onerror = () => {
        emit({ status: 'error', message: 'WebSocket error — check network.' })
        reject(new Error('WebSocket connection failed'))
      }

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { error?: string }
          if (msg.error === 'outside_tracking_window') {
            emit({ status: 'paused', message: 'Server: outside tracking window.' })
          }
        } catch {
          // non-JSON — ignore
        }
      }
    })
  }

  // ── Send a single GPS ping over the WebSocket ────────────────────────────────
  function sendPing(lat: number, lng: number, speed: number, heading: number, source: 'gps' | 'heartbeat' = 'gps') {
    if (source === 'gps') {
      lastLocation = { lat, lng, speed, heading }
      lastGpsFixAt = Date.now()
      gpsAvailable = true
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ lat, lng, speed, heading }))
    if (source === 'gps') {
      emit({ status: 'tracking', lat, lng, speed, heading, lastPingAt: Date.now() })
      return
    }
    emit({ status: 'tracking', message: 'Connection alive.', lastPingAt: Date.now() })
  }

  // ── Geolocation: Capacitor (background) or browser (foreground) ─────────────
  async function startGeo() {
    if (Capacitor.isNativePlatform()) {
      await startCapacitorGeo()
    } else {
      startBrowserGeo()
    }
  }

  function stopGeo() {
    stopHeartbeat()
    if (bgGeoWatcherId !== null) {
      const bg = getBgGeo()
      bg?.removeWatcher({ id: bgGeoWatcherId })
      bgGeoWatcherId = null
    }
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
  }

  async function startCapacitorGeo() {
    const bg = getBgGeo()
    if (!bg) {
      // Fallback: native platform check said true but plugin unavailable — shouldn't happen
      startBrowserGeo()
      return
    }

    bgGeoWatcherId = await bg.addWatcher(
      {
        backgroundMessage: 'Schools24 is tracking your location.',
        backgroundTitle: 'Driver Tracking Active',
        requestPermissions: true,
        stale: false,
        distanceFilter: 10, // metres
      },
      (position: GeoLocation | undefined, err: CallbackError | undefined) => {
        if (err) {
          gpsAvailable = false
          lastGpsFixAt = 0
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'gps_unavailable')
          }
          emit({ status: 'error', message: `GPS error: ${err.message}` })
          return
        }
        if (!position) return
        void ensureSocketOpen()
        const now = Date.now()
        const speedKmh = deriveSpeedKmh({
          lat: position.latitude,
          lng: position.longitude,
          speedMs: position.speed ?? null,
          accuracy: position.accuracy ?? null,
          now,
          lastFix,
        })
        lastFix = { lat: position.latitude, lng: position.longitude, at: now }
        sendPing(
          position.latitude,
          position.longitude,
          speedKmh,
          position.bearing ?? 0,
        )
      },
    )

    emit({ status: 'tracking', message: 'Background GPS active.' })
  }

  function startBrowserGeo() {
    if (!navigator.geolocation) {
      emit({ status: 'error', message: 'Geolocation not supported in this browser.' })
      return
    }

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        const speedKmh = deriveSpeedKmh({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedMs: pos.coords.speed ?? null,
          accuracy: pos.coords.accuracy ?? null,
          now,
          lastFix,
        })
        lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: now }
        sendPing(
          pos.coords.latitude,
          pos.coords.longitude,
          speedKmh,
          pos.coords.heading ?? 0,
        )
      },
      (err) => {
        gpsAvailable = false
        lastGpsFixAt = 0
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'gps_unavailable')
        }
        emit({ status: 'error', message: `GPS denied: ${err.message}` })
      },
      { enableHighAccuracy: true, maximumAge: 4_000, timeout: 10_000 },
    )

    emit({
      status: 'tracking',
      message: Capacitor.isNativePlatform()
        ? 'Background GPS active.'
        : 'Foreground GPS active (open app stays in GPS mode).',
    })
  }

  return tracker
}

function deriveSpeedKmh(args: {
  lat: number
  lng: number
  speedMs: number | null
  accuracy: number | null
  now: number
  lastFix: { lat: number; lng: number; at: number } | null
}) {
  const MAX_REASONABLE_SPEED = 120
  const MIN_MOVEMENT_METERS = 5
  const ACCURACY_CUTOFF = 50

  let speedKmh = Math.max(0, (args.speedMs ?? 0) * 3.6)
  if (args.accuracy !== null && args.accuracy > ACCURACY_CUTOFF) {
    speedKmh = 0
  }

  if (args.lastFix) {
    const dtSec = Math.max(0.5, (args.now - args.lastFix.at) / 1000)
    const dist = haversineMeters(args.lastFix.lat, args.lastFix.lng, args.lat, args.lng)
    const computed = (dist / dtSec) * 3.6

    if (dist < MIN_MOVEMENT_METERS) {
      speedKmh = 0
    } else if (computed > 0) {
      speedKmh = speedKmh > 0 ? Math.min(speedKmh, computed) : computed
    }
  }

  if (!Number.isFinite(speedKmh)) speedKmh = 0
  return Math.min(speedKmh, MAX_REASONABLE_SPEED)
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
