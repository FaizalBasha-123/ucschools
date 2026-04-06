"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createDriverTracker, TrackerEvent, TrackerStatus } from '@/lib/driverTracking'
import { api, ValidationError } from '@/lib/api'
import { AppPermissions, NativePermissionState } from '@/lib/nativeAppPermissions'
import {
  getNativeDriverTrackingStatus,
  isNativeDriverTrackingAvailable,
  NativeDriverTrackingStatus,
  startNativeDriverTrackingService,
} from '@/lib/nativeDriverTracking'
import { buildWsBaseUrl, getWSTicket } from '@/lib/ws-ticket'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Power,
  PowerOff,
  MapPin,
  Wifi,
  Loader2,
  AlertCircle,
  PauseCircle,
  Bus,
  RadioTower,
  Radio,
  Timer,
  CheckCircle2,
  XCircle,
  LocateFixed,
  Calendar,
  Clock,
  ShieldCheck,
} from 'lucide-react'
import { format } from 'date-fns'

// ─── session types ─────────────────────────────────────────────────────────────

interface TrackingSession {
  started_by_name: string
  started_at: number
  expires_at: number
}

interface TrackingSchedule {
  id: string
  day_of_week: number   // 0=Sunday…6=Saturday
  label: string
  start_time: string    // HH:MM:SS
  end_time: string      // HH:MM:SS
  is_active: boolean
}

interface SessionStatus {
  manual_active: boolean
  session: TrackingSession | null
  time_window_active: boolean
  tracking_allowed: boolean
  scheduled_active: boolean
  active_schedule: TrackingSchedule | null
  tracking_source?: 'manual' | 'scheduled' | ''
  activation_id?: string
  activation_start?: number | null
  activation_end?: number | null
  next_window?: UpcomingTrackingWindow | null
}

interface UpcomingTrackingWindow {
  schedule: TrackingSchedule | null
  starts_at: number
  ends_at: number
  minutes_until_start: number
}

interface DriverSessionPushMessage {
  type: 'session_status'
  updated_at: number
  status: SessionStatus
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface GpsReadiness {
  locationPermission: NativePermissionState | 'unsupported' | 'unknown'
  backgroundLocation: NativePermissionState | 'unsupported' | 'unknown'
  notificationPermission: NativePermissionState | 'unsupported' | 'unknown'
  environment: 'native' | 'web'
}

type GpsAccessState = 'unknown' | 'ok' | 'blocked' | 'unavailable'

function isLocationServicesDisabledError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  const message = (err as { message?: unknown } | null)?.message
  if (typeof code === 'string' && code.toUpperCase() === 'OS-PLUG-GLOC-0007') return true
  if (typeof message === 'string' && /location services are not enabled/i.test(message)) return true
  return false
}

// ─── status display config ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TrackerStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  idle:         { label: 'Not Tracking',  color: 'bg-slate-500',  icon: PowerOff   },
  connecting:   { label: 'Connecting…',   color: 'bg-amber-500',  icon: Loader2    },
  tracking:     { label: 'Tracking',      color: 'bg-emerald-500',icon: LocateFixed },
  paused:       { label: 'Outside Window',color: 'bg-amber-500',  icon: PauseCircle},
  error:        { label: 'Error',         color: 'bg-red-500',    icon: AlertCircle},
  disconnected: { label: 'Disconnected',  color: 'bg-rose-500',   icon: AlertCircle },
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function DriverTrackingPage() {
  const router = useRouter()
  const { user, userRole, isLoading } = useAuth()
  const nativeServiceManaged = isNativeDriverTrackingAvailable()

  const [trackerState, setTrackerState] = useState<TrackerEvent>({ status: 'idle' })
  const [isActive, setIsActive] = useState(false)
  const [pingCount, setPingCount] = useState(0)
  const [nativeTracker, setNativeTracker] = useState<NativeDriverTrackingStatus | null>(null)
  const trackerRef = useRef<ReturnType<typeof createDriverTracker> | null>(null)

  // ── session state ────────────────────────────────────────────────────────────
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<string>('')
  const [gpsReadiness, setGpsReadiness] = useState<GpsReadiness>({
    locationPermission: 'unknown',
    backgroundLocation: 'unknown',
    notificationPermission: 'unknown',
    environment: Capacitor.isNativePlatform() ? 'native' : 'web',
  })
  const [gpsAccessState, setGpsAccessState] = useState<GpsAccessState>('unknown')
  const [permissionsChecking, setPermissionsChecking] = useState(false)
  const [permissionActionNote, setPermissionActionNote] = useState<string | null>(null)
  // null = allow-all-time rationale not yet shown; true = waiting for user to dismiss
  const [showBgLocationRationale, setShowBgLocationRationale] = useState(false)
  const [schedules, setSchedules] = useState<TrackingSchedule[]>([])
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [pendingActivationId, setPendingActivationId] = useState<string | null>(null)
  const lastActivationIdRef = useRef<string | null>(null)

  // ── guard: staff only ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && userRole && userRole !== 'staff') {
      router.replace('/login')
    }
  }, [isLoading, userRole, router])

  // ── fallback poll (push stream handles primary updates) ─────────────────────
  const fetchSession = useCallback(async () => {
    try {
      setSessionError(null)
      setSession(await api.get<SessionStatus>('/transport/session-status'))
    } catch (err) {
      if (err instanceof ValidationError && err.code === 'unauthorized') {
        setSessionError('Session expired. Please sign in again to start tracking.')
      } else {
        setSessionError('Unable to verify tracking session right now.')
      }
    }
    finally { setSessionLoading(false) }
  }, [])

  useEffect(() => {
    let active = true
    void fetchSession()

    const tick = () => {
      if (!active) return
      void fetchSession()
    }

    // Slow fallback only; realtime changes come from driver-session WS.
    const intervalId = setInterval(tick, 60_000)

    const handleFocus = () => { void fetchSession() }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchSession()
      }
    }
    const handleTransportEvent = () => { void fetchSession() }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('schools24:transport-session', handleTransportEvent)

    return () => {
      active = false
      clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('schools24:transport-session', handleTransportEvent)
    }
  }, [fetchSession])

  // ── push session updates over websocket ─────────────────────────────────────
  useEffect(() => {
    if (isLoading || userRole !== 'staff') return

    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, 2_000)
    }

    const connect = async () => {
      if (stopped) return
      try {
        const ticket = await getWSTicket('driver_tracking')
        const wsBase = buildWsBaseUrl()
        if (!wsBase) {
          scheduleReconnect()
          return
        }

        const wsUrl = `${wsBase.replace(/\/$/, '')}/api/v1/transport/driver-session/ws?ticket=${encodeURIComponent(ticket.ticket)}`
        socket = new WebSocket(wsUrl)

        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data as string) as DriverSessionPushMessage
            if (message?.type !== 'session_status' || !message.status) return
            setSession(message.status)
            setSessionError(null)
            setSessionLoading(false)
          } catch {
            // Ignore malformed messages and continue fallback polling.
          }
        }

        socket.onclose = () => {
          socket = null
          scheduleReconnect()
        }

        socket.onerror = () => {
          try {
            socket?.close()
          } catch {
            // no-op
          }
        }
      } catch {
        scheduleReconnect()
      }
    }

    void connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try {
        socket?.close()
      } catch {
        // no-op
      }
    }
  }, [isLoading, userRole])

  // ── fetch schedules once on mount ────────────────────────────────────────────
  useEffect(() => {
    api.get<{ schedules: TrackingSchedule[] }>('/transport/schedules')
      .then(res => setSchedules(Array.isArray(res.schedules) ? res.schedules : []))
      .catch(() => {})
  }, [])

  // ── countdown ticker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current)
    if (!session?.session) { setRemaining(''); return }
    const tick = () => {
      const left = session.session!.expires_at - Date.now()
      if (left <= 0) { setRemaining('Expired'); fetchSession(); return }
      const m = Math.floor(left / 60_000)
      const s = Math.floor((left % 60_000) / 1000)
      setRemaining(`${m}m ${s.toString().padStart(2, '0')}s`)
    }
    tick()
    tickRef.current = setInterval(tick, 1000)
    return () => clearInterval(tickRef.current!)
  }, [session?.session?.expires_at])

  // ── cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      trackerRef.current?.stop()
    }
  }, [])

  const refreshNativeTrackerStatus = useCallback(async () => {
    if (!nativeServiceManaged) return
    try {
      const status = await getNativeDriverTrackingStatus()
      if (!status) return
      setNativeTracker(status)
      setIsActive(status.serviceEnabled)
      setTrackerState({
        status: !status.serviceEnabled
          ? 'idle'
          : status.trackingAllowed
            ? (status.websocketConnected ? 'tracking' : 'connecting')
            : 'idle',
        message: status.message,
        lastPingAt: status.lastPingAt || undefined,
        lat: status.lastLatitude,
        lng: status.lastLongitude,
      })
    } catch {
      // Keep the page usable even if the native bridge is temporarily unavailable.
    }
  }, [nativeServiceManaged])

  const verifyGpsAccess = useCallback(async (locationPermission: NativePermissionState | 'unknown' | 'unsupported') => {
    if (!Capacitor.isNativePlatform()) return 'unknown'
    if (locationPermission !== 'granted') {
      setGpsAccessState('blocked')
      return 'blocked'
    }

    try {
      const { Geolocation } = await import('@capacitor/geolocation')
      await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0,
      })
      setGpsAccessState('ok')
      return 'ok'
    } catch (err: any) {
      const code = typeof err?.code === 'number' ? err.code : null
      if (code === 1) {
        setGpsAccessState('blocked')
        return 'blocked'
      }
      setGpsAccessState('unavailable')
      return 'unavailable'
    }
  }, [])

  const refreshGpsReadiness = useCallback(async () => {
    const environment = Capacitor.isNativePlatform() ? 'native' : 'web'

    if (Capacitor.isNativePlatform()) {
      try {
        const { Geolocation } = await import('@capacitor/geolocation')
        const { PushNotifications } = await import('@capacitor/push-notifications')
        const locationStatus = await Geolocation.checkPermissions()
        const notificationStatus = await PushNotifications.checkPermissions()
        const startupStatus = await AppPermissions.checkStartupPermissions()

        const nextReadiness: GpsReadiness = {
          environment,
          locationPermission:
            locationStatus.location === 'granted' || locationStatus.coarseLocation === 'granted'
              ? 'granted'
              : locationStatus.location,
          backgroundLocation: startupStatus.backgroundLocation,
          notificationPermission: notificationStatus.receive as NativePermissionState,
        }
        setGpsReadiness(nextReadiness)
        await verifyGpsAccess(nextReadiness.locationPermission)
        return
      } catch {
        setGpsReadiness({
          environment,
          locationPermission: 'unknown',
          backgroundLocation: 'unknown',
          notificationPermission: 'unknown',
        })
        setGpsAccessState('unknown')
        return
      }
    }

    try {
      if (typeof navigator !== 'undefined' && 'permissions' in navigator && navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'geolocation' })
        setGpsReadiness({
          environment,
          locationPermission: status.state as NativePermissionState,
          backgroundLocation: 'unsupported',
          notificationPermission: 'unsupported',
        })
        return
      }
    } catch {
      // fall through to unknown
    }

    setGpsReadiness({
      environment,
      locationPermission: 'unknown',
      backgroundLocation: 'unsupported',
      notificationPermission: 'unsupported',
    })
    setGpsAccessState('unknown')
  }, [])

  const ensureNativeDriverPermissions = useCallback(async (openSettingsOnFail = false) => {
    if (!Capacitor.isNativePlatform()) return

    setPermissionsChecking(true)
    setPermissionActionNote(null)
    setShowBgLocationRationale(false)
    try {
      const hasGeo = Capacitor.isPluginAvailable('Geolocation')
      const hasPush = Capacitor.isPluginAvailable('PushNotifications')
      const hasAppPerms = Capacitor.isPluginAvailable('AppPermissions')

      if (!hasGeo || !hasPush || !hasAppPerms) {
        setPermissionActionNote('Required native plugins are unavailable in this app build. Reinstall the latest APK and try again.')
        return
      }

      const { Geolocation } = await import('@capacitor/geolocation')
      const { PushNotifications } = await import('@capacitor/push-notifications')

      // Step 1: ensure device GPS (location services) is physically ON
      let locationStatus: Awaited<ReturnType<typeof Geolocation.checkPermissions>>
      try {
        locationStatus = await Geolocation.checkPermissions()
      } catch (err) {
        if (isLocationServicesDisabledError(err)) {
          setGpsAccessState('unavailable')
          if (openSettingsOnFail) {
            try {
              await AppPermissions.promptEnableLocationServices()
              setPermissionActionNote('GPS is off. Enable it using the panel that appeared, then return here.')
            } catch {
              try {
                await AppPermissions.openLocationSettings()
                setPermissionActionNote('GPS is off. Enable it in Location Settings, then return here.')
              } catch {
                setPermissionActionNote('GPS is off. Open Settings \u203a Location and enable device GPS.')
              }
            }
          } else {
            setPermissionActionNote('GPS is off. Tap "Grant Required Permissions" to enable it.')
          }
          return
        }
        throw err
      }

      // Step 2: foreground location permission
      if (locationStatus.location !== 'granted' && locationStatus.coarseLocation !== 'granted') {
        const result = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] })
        const granted = result.location === 'granted' || result.coarseLocation === 'granted'
        if (!granted && openSettingsOnFail) {
          setPermissionActionNote('Location permission denied. Opening app settings \u2014 tap Permissions > Location > Allow.')
          await AppPermissions.openAppSettings().catch(() => {
            setPermissionActionNote('Open Settings \u203a Apps \u203a Schools24 \u203a Permissions \u203a Location.')
          })
          return
        }
      }

      // Step 3: background location (\u201cAllow all the time\u201d) \u2014 show Uber-style rationale first.
      // Android 11+ requires a separate settings visit; we explain this before sending the user there.
      const startupStatus = await AppPermissions.checkStartupPermissions()
      if (startupStatus.backgroundLocation !== 'granted') {
        setShowBgLocationRationale(true)
        return  // user must confirm the rationale card and tap the dedicated button
      }

      // Step 4: notification permission
      const notificationStatus = await PushNotifications.checkPermissions()
      if (notificationStatus.receive !== 'granted') {
        await PushNotifications.requestPermissions()
      }

      // Final verification
      const latestLocation = await Geolocation.checkPermissions()
      const latestStartup = await AppPermissions.checkStartupPermissions()
      const latestNotifications = await PushNotifications.checkPermissions()
      const locationGranted = latestLocation.location === 'granted' || latestLocation.coarseLocation === 'granted'
      const backgroundGranted = latestStartup.backgroundLocation === 'granted'
      const notificationsGranted = latestNotifications.receive === 'granted'
      const accessState = await verifyGpsAccess(locationGranted ? 'granted' : latestLocation.location)

      if (openSettingsOnFail) {
        if (accessState === 'unavailable') {
          try {
            await AppPermissions.promptEnableLocationServices()
            setPermissionActionNote('GPS is off. Enable it in the panel that appeared, then return.')
          } catch {
            await AppPermissions.openLocationSettings().catch(() => {})
            setPermissionActionNote('GPS is off. Enable it in Location Settings, then return.')
          }
        } else if (!locationGranted || !backgroundGranted || !notificationsGranted || accessState === 'blocked') {
          const missing: string[] = []
          if (!locationGranted) missing.push('Location')
          if (!backgroundGranted) missing.push('Always-On Location')
          if (!notificationsGranted) missing.push('Notifications')
          const desc = missing.length
            ? `Missing: ${missing.join(', ')}.`
            : 'GPS access is blocked.'
          setPermissionActionNote(`${desc} Opening app settings.`)
          await AppPermissions.openAppSettings().catch(() => {
            setPermissionActionNote(`Open Settings \u203a Apps \u203a Schools24 \u203a Permissions to grant: ${missing.join(', ') || 'GPS'}.`)
          })
        }
      }
    } catch (err) {
      if (isLocationServicesDisabledError(err)) {
        setGpsAccessState('unavailable')
        try {
          await AppPermissions.promptEnableLocationServices()
          setPermissionActionNote('GPS is off. Enable it using the panel, then return.')
        } catch {
          setPermissionActionNote('GPS is off. Open Settings \u203a Location and enable it.')
        }
      } else {
        setPermissionActionNote('Permission check failed. Reopen the app and try again.')
      }
    } finally {
      setPermissionsChecking(false)
      await refreshGpsReadiness()
    }
  }, [refreshGpsReadiness, verifyGpsAccess])

  // Called when driver taps "Always Allow" in the background-location rationale card
  const requestAllowAllTimeBgLocation = useCallback(async () => {
    setShowBgLocationRationale(false)
    setPermissionsChecking(true)
    try {
      await AppPermissions.requestBackgroundLocation()
      setPermissionActionNote('Select \u201cAllow all the time\u201d in the system screen that appears, then return here.')
    } catch {
      setPermissionActionNote('Could not open background location prompt. Go to Settings \u203a Apps \u203a Schools24 \u203a Permissions \u203a Location \u203a Always allow.')
    } finally {
      setPermissionsChecking(false)
      await refreshGpsReadiness()
    }
  }, [refreshGpsReadiness])

  useEffect(() => {
    void refreshGpsReadiness()
    const handleFocus = () => {
      void refreshGpsReadiness()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refreshGpsReadiness])

  useEffect(() => {
    if (!nativeServiceManaged) return
    void startNativeDriverTrackingService().catch(() => null)
    void refreshNativeTrackerStatus()
    const intervalId = setInterval(() => {
      void refreshNativeTrackerStatus()
    }, 5_000)
    const handleFocus = () => {
      void refreshNativeTrackerStatus()
    }
    window.addEventListener('focus', handleFocus)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
    }
  }, [nativeServiceManaged, refreshNativeTrackerStatus])

  const handleStart = useCallback(async () => {
    if (nativeServiceManaged) {
      setPendingActivationId(null)
      await startNativeDriverTrackingService()
      await refreshNativeTrackerStatus()
      return
    }

    const backendUrl = `${window.location.origin}/api/v1`

    const tracker = createDriverTracker(backendUrl)
    trackerRef.current = tracker

    tracker.onStatusChange = (ev) => {
      setTrackerState((prev) => ({ ...prev, ...ev }))
      if (ev.status === 'tracking' && ev.lat !== undefined) {
        setPingCount((n) => n + 1)
      }
    }

    setIsActive(true)
    setPingCount(0)
    setPendingActivationId(null)
    try {
      await tracker.start()
    } catch (error) {
      trackerRef.current = null
      setIsActive(false)
      setTrackerState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to start tracking.',
      })
    }
  }, [nativeServiceManaged, refreshNativeTrackerStatus])

  const trackingAllowed = session?.tracking_allowed ?? false
  const activationId = trackingAllowed ? (session?.activation_id?.trim() || '') : ''
  const permissionGateActive =
    gpsReadiness.environment === 'native' && (
      gpsReadiness.locationPermission !== 'granted' ||
      gpsReadiness.backgroundLocation !== 'granted' ||
      gpsReadiness.notificationPermission !== 'granted' ||
      gpsAccessState !== 'ok'
    )

  const handleStop = useCallback(() => {
    if (nativeServiceManaged) {
      return
    }
    setPendingActivationId(null)
    trackerRef.current?.stop()
    trackerRef.current = null
    setIsActive(false)
    setTrackerState({ status: 'idle' })
    setPingCount(0)
  }, [nativeServiceManaged])

  // ── auto-start / auto-stop when admin activates or deactivates session ────────
  useEffect(() => {
    if (!trackingAllowed || !activationId) {
      setPendingActivationId(null)
      lastActivationIdRef.current = null
    } else if (activationId !== lastActivationIdRef.current) {
      lastActivationIdRef.current = activationId
      setPendingActivationId(activationId)
    } else if (!isActive && !pendingActivationId) {
      setPendingActivationId(activationId)
    }
    // Auto-stop when the tracking window closes while driver is broadcasting
    if (!trackingAllowed && isActive && !nativeServiceManaged) {
      handleStop()
    }
  }, [trackingAllowed, activationId, isActive, pendingActivationId, handleStop, nativeServiceManaged])

  // Execute pending auto-start the moment permissions are fully ready
  useEffect(() => {
    if (
      pendingActivationId &&
      pendingActivationId === activationId &&
      !permissionGateActive &&
      !isActive &&
      !permissionsChecking &&
      !showBgLocationRationale
    ) {
      setPendingActivationId(null)
      void handleStart()
    }
  // permissionGateActive is derived from state; isActive/permissionsChecking also change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingActivationId, activationId, permissionGateActive, isActive, permissionsChecking, showBgLocationRationale, handleStart])

  // ── loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    )
  }

  const { status } = trackerState
  const cfg = STATUS_CONFIG[status]
  const StatusIcon = cfg.icon
  const isConnected = status === 'tracking'
  const pingIsFresh = trackerState.lastPingAt
    ? Date.now() - trackerState.lastPingAt < (nativeServiceManaged ? 120_000 : 20_000)
    : false
  const gpsInUse = nativeServiceManaged
    ? Boolean(nativeTracker?.gpsActive) && pingIsFresh && trackingAllowed
    : isActive && pingIsFresh && status !== 'error' && gpsAccessState === 'ok'
  // trackingAllowed and permissionGateActive are declared above the hooks
  const readinessRows = [
    {
      label: 'Environment',
      value: gpsReadiness.environment === 'native' ? 'Android app' : 'Web browser',
    },
    {
      label: 'Location Permission',
      value:
        gpsReadiness.locationPermission === 'granted'
          ? 'Granted'
          : gpsReadiness.locationPermission === 'prompt'
            ? 'Prompt required'
            : gpsReadiness.locationPermission === 'denied'
              ? 'Denied'
              : gpsReadiness.locationPermission === 'prompt-with-rationale'
                ? 'Needs approval'
                : 'Unknown',
    },
    {
      label: 'Background GPS',
      value:
        gpsReadiness.environment === 'web'
          ? 'Web does not support background tracking'
          : gpsReadiness.backgroundLocation === 'granted'
            ? 'Granted'
            : gpsReadiness.backgroundLocation === 'denied'
              ? 'Denied'
              : gpsReadiness.backgroundLocation === 'prompt'
                ? 'Prompt required'
                : gpsReadiness.backgroundLocation === 'prompt-with-rationale'
                  ? 'Needs approval'
                  : 'Unknown',
    },
    {
      label: 'Notifications',
      value:
        gpsReadiness.notificationPermission === 'granted'
          ? 'Granted'
          : gpsReadiness.notificationPermission === 'prompt'
            ? 'Prompt required'
            : gpsReadiness.notificationPermission === 'denied'
              ? 'Denied'
              : gpsReadiness.notificationPermission === 'prompt-with-rationale'
                ? 'Needs approval'
                : gpsReadiness.notificationPermission === 'unsupported'
                  ? 'Unsupported'
                  : 'Unknown',
    },
    {
      label: 'GPS In Use',
      value: gpsInUse
        ? 'Live from this device'
        : (trackingAllowed || isActive ? 'Acquiring GPS fix…' : 'Waiting for tracking window'),
    },
    {
      label: 'GPS Access',
      value:
        gpsReadiness.environment === 'web'
          ? 'Browser-managed'
          : gpsAccessState === 'ok'
            ? 'Verified'
            : gpsAccessState === 'blocked'
              ? 'Blocked'
              : gpsAccessState === 'unavailable'
                ? 'Unavailable'
                : 'Checking…',
    },
  ]

  const liveDetails = [
    {
      label: 'Latitude',
      value: trackerState.lat !== undefined ? trackerState.lat.toFixed(5) : '—',
    },
    {
      label: 'Longitude',
      value: trackerState.lng !== undefined ? trackerState.lng.toFixed(5) : '—',
    },
    {
      label: 'Speed',
      value: trackerState.speed !== undefined ? `${trackerState.speed.toFixed(1)} km/h` : '— km/h',
    },
    {
      label: 'Heading',
      value: trackerState.heading !== undefined ? `${trackerState.heading.toFixed(0)}°` : '—°',
    },
  ]

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700">
        <div>
          <h1 className="font-semibold text-lg leading-none">Driver Tracking</h1>
          {user?.name && (
            <p className="text-sm text-slate-400 mt-0.5">{user.name}</p>
          )}
        </div>
        <div className="ml-auto">
          <Badge className={`${cfg.color} text-white text-xs`}>
            <StatusIcon className={`h-3 w-3 mr-1 ${status === 'connecting' ? 'animate-spin' : ''}`} />
            {cfg.label}
          </Badge>
        </div>
      </div>

      {/* ── body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 p-4 max-w-sm mx-auto w-full">
        {sessionError && (
          <Card className="border-red-500/40 bg-red-950/20">
            <CardContent className="py-4 flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-300">Session Required</p>
                <p className="mt-1 text-xs leading-snug text-slate-300">
                  {sessionError}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => window.location.href = '/login'}
                  className="mt-3 border-red-400/40 bg-transparent text-red-200 hover:bg-red-500/10"
                >
                  Go to Login
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {permissionGateActive && !showBgLocationRationale && (
          <Card className="border-amber-500/40 bg-amber-950/20">
            <CardContent className="py-4 flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-300">Permissions Required</p>
                <p className="mt-1 text-xs leading-snug text-slate-300">
                  Driver tracking needs location (foreground + background) and notification access.
                  Tracking starts automatically once all permissions are granted.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void ensureNativeDriverPermissions(true)}
                  disabled={permissionsChecking}
                  className="mt-3 border-amber-400/40 bg-transparent text-amber-200 hover:bg-amber-500/10"
                >
                  {permissionsChecking ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking Permissions
                    </>
                  ) : (
                    'Grant Required Permissions'
                  )}
                </Button>
                {permissionActionNote && (
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-200/90">
                    {permissionActionNote}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Background location rationale (Uber-style) ──────────────────────── */}
        {showBgLocationRationale && (
          <Card className="border-indigo-500/40 bg-indigo-950/25">
            <CardContent className="py-4 flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-indigo-300">Always-On Location Needed</p>
                <p className="mt-1 text-xs leading-snug text-slate-300">
                  For safe bus tracking, Schools24 must send your GPS position even when the app is
                  in the background. On the next screen, select{' '}
                  <span className="font-semibold text-white">“Allow all the time”</span> to enable this.
                </p>
                <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                  This mirrors how Google Maps and Uber track drivers. Your location is only used
                  while a school tracking session is active.
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={requestAllowAllTimeBgLocation}
                  disabled={permissionsChecking}
                  className="mt-3 bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  {permissionsChecking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Allow Always-On Location'
                  )}
                </Button>
                {permissionActionNote && (
                  <p className="mt-2 text-[11px] leading-relaxed text-indigo-200/90">
                    {permissionActionNote}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── admin authorization status ──────────────────────────────────────── */}
        {!sessionLoading && (
          <Card className={`border ${
            trackingAllowed
              ? 'border-emerald-500/40 bg-emerald-950/20'
              : 'border-slate-700 bg-slate-800/60'
          }`}>
            <CardContent className="py-3.5 flex items-start gap-3">
              {trackingAllowed ? (
                <>
                  <div className="relative mt-0.5 shrink-0">
                    <Radio className="h-5 w-5 text-emerald-400 animate-pulse" />
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-400">Tracking Authorized</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                      {session?.manual_active && session.session
                        ? <>Override by <span className="text-slate-300">{session.session.started_by_name}</span>
                          {remaining
                            ? <> &bull; <Timer className="inline h-3 w-3 mx-0.5" />{remaining}</>
                            : null}
                        </>
                        : session?.scheduled_active && session.active_schedule
                          ? <>Scheduled window: <span className="text-slate-300">{session.active_schedule.label}</span>
                            {' '}({(session.active_schedule.start_time || '').slice(0, 5)}–{(session.active_schedule.end_time || '').slice(0, 5)} IST)
                          </>
                          : session?.next_window?.schedule
                            ? <>Next auto-start: <span className="text-slate-300">{session.next_window.schedule.label}</span>
                              {' '}in {session.next_window.minutes_until_start} min at {format(new Date(session.next_window.starts_at), 'hh:mm a')} IST
                            </>
                            : 'Within school bus window'}
                    </p>
                    {!isActive && !permissionGateActive && !showBgLocationRationale && pendingActivationId === activationId && (
                      <p className="text-[11px] text-emerald-300/70 mt-1">Starting automatically…</p>
                    )}
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                </>
              ) : (
                <>
                  <RadioTower className="h-5 w-5 text-slate-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-300">Awaiting Authorization</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                      {session?.next_window?.schedule
                        ? <>Outside tracking window. Next auto-start: <span className="text-slate-300">{session.next_window.schedule.label}</span>{' '}in {session.next_window.minutes_until_start} min at {format(new Date(session.next_window.starts_at), 'hh:mm a')} IST.</>
                        : 'Outside tracking window. The app will start automatically when the admin activates a session or a scheduled window begins.'}
                    </p>
                  </div>
                  <XCircle className="h-5 w-5 text-slate-600 shrink-0 mt-0.5" />
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── scheduled tracking windows ──────────────────────────────────── */}
        {schedules.length > 0 && (
          <Card className="border-slate-700 bg-slate-800/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-400" />
                Tracking Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {schedules.map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs border-b border-slate-700/60 pb-2 last:border-0 last:pb-0">
                  <div>
                    <span className="font-medium text-slate-200">{s.label}</span>
                    <span className="text-slate-500 ml-1.5">{DAY_NAMES[s.day_of_week] ?? 'Unknown day'}</span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400 tabular-nums">
                    <Clock className="h-3 w-3" />
                    {(s.start_time || '').slice(0, 5)}–{(s.end_time || '').slice(0, 5)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* status message card */}
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="py-4 flex items-start gap-3">
            {isConnected
              ? <Wifi className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
              : <AlertCircle className="h-5 w-5 text-slate-500 mt-0.5 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-300 leading-snug">
                {trackerState.message ??
                  (trackingAllowed
                    ? nativeServiceManaged
                      ? 'Android background service is standing by and will stream GPS as soon as the school tracking window is active.'
                      : 'Tracking will start automatically. You can also tap Start below.'
                    : 'Waiting for school admin to activate a tracking session.')}
              </p>
              {trackerState.lastPingAt && (
                <p className="text-xs text-slate-500 mt-1">
                  Last ping: {format(new Date(trackerState.lastPingAt), 'hh:mm:ss a')}
                </p>
              )}
              {pingCount > 0 && (
                <p className="text-xs text-emerald-400 mt-1">
                  {pingCount} ping{pingCount !== 1 ? 's' : ''} sent this session
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-800/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white">Live GPS Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {readinessRows.map((item) => (
              <div key={item.label} className="flex items-center justify-between border-b border-slate-700/70 pb-2 text-sm last:border-b-0 last:pb-0">
                <span className="text-slate-400">{item.label}</span>
                <span className="max-w-[60%] text-right font-medium text-white">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {isConnected && (
          <Card className="border-slate-700 bg-slate-800/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">Live Tracking Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {liveDetails.map((item) => (
                <div key={item.label} className="flex items-center justify-between border-b border-slate-700/70 pb-2 text-sm last:border-b-0 last:pb-0">
                  <span className="text-slate-400">{item.label}</span>
                  <span className="font-medium text-white">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* start button only: stop is controlled by admin/session lifecycle */}
        <div className="mt-auto pt-4">
          {!isActive ? (
            <Button
              onClick={handleStart}
              disabled={!trackingAllowed || permissionGateActive}
              className={`w-full h-14 text-base font-semibold transition-all ${
                trackingAllowed && !permissionGateActive
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed opacity-60'
              }`}
            >
              <Power className="h-5 w-5 mr-2" />
              {permissionGateActive ? 'Permissions Required' : trackingAllowed ? (nativeServiceManaged ? 'Activate Android Service' : 'Start Tracking') : 'Not Authorized'}
            </Button>
          ) : (
            <Button
              disabled
              className="w-full h-14 text-base font-semibold bg-emerald-700/80 text-emerald-100 cursor-default opacity-90"
            >
              <Radio className="h-5 w-5 mr-2" />
              {nativeServiceManaged ? 'Android Service Ready' : 'Tracking Active'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
