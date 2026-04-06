"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Bus,
    Navigation,
    Loader2,
    WifiOff,
    Wifi,
    MapPin,
    Gauge,
    Compass,
    Clock,
    RefreshCw,
    AlertCircle,
} from 'lucide-react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { format } from 'date-fns'
import { buildWsBaseUrl, getWSTicket } from '@/lib/ws-ticket'

// ─── types ────────────────────────────────────────────────────────────────────

interface LocationEvent {
    route_id: string
    lat: number
    lng: number
    speed: number
    heading: number
    updated_at: number // Unix ms
}

interface TrackBusDialogProps {
    open: boolean
    onClose: () => void
    routeId: string
    routeNumber: string
    vehicleNumber: string
    driverName: string
    lastKnownLocation?: {
        lat: number
        lng: number
        speed: number
        heading: number
        lastPingAt: number
    } | null
}

// ─── Map loader singleton with aggressive error handling ─────────────────────

let _loaderPromise: Promise<void> | null = null
let _apiConfigured = false
let _apiLoadFailed = false

function getGoogleMaps(): Promise<void> {
    // If we already failed to load, don't retry indefinitely
    if (_apiLoadFailed && _loaderPromise) {
        return _loaderPromise
    }

    if (_loaderPromise && !_apiLoadFailed) return _loaderPromise

    const apiKey = process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''
    if (!apiKey) {
        _apiLoadFailed = true
        const err = new Error(
            'NEXT_PUBLIC_GMAPS_KEY is not configured. Please add it to .env.local'
        )
        _loaderPromise = Promise.reject(err)
        return _loaderPromise
    }

    if (!_apiConfigured) {
        try {
            setOptions({
                key: apiKey,
                v: 'weekly',
                libraries: ['maps', 'marker'],
            })
            _apiConfigured = true
        } catch (e) {
            _apiLoadFailed = true
            _loaderPromise = Promise.reject(
                new Error('Failed to configure Google Maps API')
            )
            return _loaderPromise
        }
    }

    _loaderPromise = Promise.race([
        importLibrary('maps').then(() => {
            _apiLoadFailed = false
        }),
        new Promise<void>((_, reject) =>
            setTimeout(
                () => reject(new Error('Google Maps API loading timeout (5s)')),
                5000
            )
        ),
    ]).catch((err) => {
        _apiLoadFailed = true
        throw err
    })

    return _loaderPromise
}

// ─── component ────────────────────────────────────────────────────────────────

export function TrackBusDialog({
    open,
    onClose,
    routeId,
    routeNumber,
    vehicleNumber,
    driverName,
    lastKnownLocation,
}: TrackBusDialogProps) {
    const mapDivRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<google.maps.Map | null>(null)
    const markerRef = useRef<google.maps.Marker | null>(null)
    const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
    const esRef = useRef<EventSource | null>(null)
    const autoPanRef = useRef(true)
    const abortControllerRef = useRef<AbortController | null>(null)
    const isUnmountedRef = useRef(false)

    const [mapError, setMapError] = useState<string | null>(null)
    const [mapReady, setMapReady] = useState(false)
    const [busStatus, setBusStatus] = useState<'loading' | 'online' | 'offline'>('loading')
    const [lastEvent, setLastEvent] = useState<LocationEvent | null>(null)
    const [autoPan, setAutoPan] = useState(true)

    useEffect(() => {
        autoPanRef.current = autoPan
    }, [autoPan])

    // Cleanup refs when dialog opens/closes
    useEffect(() => {
        isUnmountedRef.current = !open
        return () => {
            isUnmountedRef.current = true
        }
    }, [open])

    // ── Initialise Google Maps ────────────────────────────────────────────────
    const initMap = useCallback(async () => {
        if (!mapDivRef.current) return
        try {
            await getGoogleMaps()
            const map = new google.maps.Map(mapDivRef.current, {
                center: lastKnownLocation
                    ? { lat: lastKnownLocation.lat, lng: lastKnownLocation.lng }
                    : { lat: 20.5937, lng: 78.9629 }, // centre of India as default
                zoom: lastKnownLocation ? 15 : 12,
                mapTypeControl: false,
                fullscreenControl: true,
                streetViewControl: false,
                zoomControl: true,
                styles: [
                    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                ],
            })

            // Start with a directional arrow; hidden until first position is known.
            const marker = new google.maps.Marker({
                map,
                title: `Bus Route ${routeNumber}`,
                icon: {
                    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    scale: 6,
                    fillColor: '#6366f1',
                    fillOpacity: 1,
                    strokeColor: '#fff',
                    strokeWeight: 2,
                    rotation: lastKnownLocation?.heading ?? 0,
                },
                visible: false,
            })

            const infoWindow = new google.maps.InfoWindow()

            marker.addListener('click', () => {
                if (!lastEvent) return
                infoWindow.setContent(`
                    <div style="font-family:sans-serif;padding:4px 2px">
                        <strong>Route ${routeNumber}</strong><br/>
                        Speed: ${lastEvent.speed.toFixed(1)} km/h<br/>
                        Heading: ${lastEvent.heading.toFixed(0)}°
                    </div>
                `)
                infoWindow.open(map, marker)
            })

            mapRef.current = map
            markerRef.current = marker
            infoWindowRef.current = infoWindow

            // If we already have a last-known position (from the live-status WS),
            // pin the bus on the map immediately so the admin isn't staring at India.
            if (lastKnownLocation) {
                const pos = { lat: lastKnownLocation.lat, lng: lastKnownLocation.lng }
                marker.setPosition(pos)
                marker.setVisible(true)
                // Seed the stats panel with last-known data so it’s not empty.
                setLastEvent({
                    route_id: routeId,
                    lat: lastKnownLocation.lat,
                    lng: lastKnownLocation.lng,
                    speed: lastKnownLocation.speed,
                    heading: lastKnownLocation.heading,
                    updated_at: lastKnownLocation.lastPingAt,
                })
                setBusStatus('online')
            }

            setMapReady(true)
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Map failed to load'
            setMapError(msg)
        }
    }, [routeNumber, routeId, lastKnownLocation]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Connect to SSE stream with retry + proper cleanup ──────────────────────
    const connectSSE = useCallback(async () => {
        if (!routeId || isUnmountedRef.current) return

        // Ensure old connection is closed
        if (esRef.current) {
            esRef.current.close()
            esRef.current = null
        }

        // Create new abort controller for this attempt
        const controller = new AbortController()
        abortControllerRef.current = controller

        try {
            const { ticket } = await getWSTicket('transport_read')
            const apiBase = buildWsBaseUrl().replace(/^ws/, 'http')
            const url = `${apiBase}/api/v1/transport/track/${routeId}?ticket=${encodeURIComponent(
                ticket
            )}`

            const es = new EventSource(url)
            esRef.current = es

            es.addEventListener('connected', (e) => {
                if (isUnmountedRef.current) return
                const data = JSON.parse((e as MessageEvent).data)
                setBusStatus(data.status === 'offline' ? 'offline' : 'online')
            })

            es.addEventListener('location', (e) => {
                if (isUnmountedRef.current) return

                const event: LocationEvent = JSON.parse((e as MessageEvent).data)
                setLastEvent(event)
                setBusStatus('online')

                if (!mapRef.current || !markerRef.current) return
                const pos = { lat: event.lat, lng: event.lng }
                markerRef.current.setPosition(pos)
                markerRef.current.setVisible(true)

                const icon = markerRef.current.getIcon() as google.maps.Symbol
                markerRef.current.setIcon({
                    ...icon,
                    rotation: event.heading,
                    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    scale: 6,
                    fillColor: '#6366f1',
                    fillOpacity: 1,
                    strokeColor: '#fff',
                    strokeWeight: 2,
                })

                // Only auto-pan if in tracking mode
                if (autoPanRef.current && mapRef.current) {
                    mapRef.current.panTo(pos)
                }
            })

            es.addEventListener('error', () => {
                if (isUnmountedRef.current) return
                setBusStatus('offline')
                es.close()
                esRef.current = null
            })

            es.onerror = (err) => {
                if (isUnmountedRef.current) return
                console.error('SSE error:', err)
                setBusStatus('offline')
                es.close()
                esRef.current = null
            }
        } catch (err) {
            if (isUnmountedRef.current) return
            console.error('SSE connection error:', err)
            setBusStatus('offline')
        }
    }, [routeId])

    // ── Lifecycle: Dialog open/close ────────────────────────────────────────────
    useEffect(() => {
        if (!open) {
            // Hard stop: close everything on unmount
            isUnmountedRef.current = true
            abortControllerRef.current?.abort()
            if (esRef.current) {
                esRef.current.close()
                esRef.current = null
            }
            setMapReady(false)
            setMapError(null)
            setBusStatus('loading')
            setLastEvent(null)
            mapRef.current = null
            markerRef.current = null
            infoWindowRef.current = null
            return
        }

        // Reset unmounted flag and reinitialize
        isUnmountedRef.current = false
        setMapReady(false)
        setMapError(null)
        initMap()
    }, [open, initMap])

    // ── Connect SSE once map is ready ──────────────────────────────────────────
    useEffect(() => {
        if (!mapReady || isUnmountedRef.current) return
        setBusStatus('loading')
        connectSSE()

        return () => {
            if (esRef.current) {
                esRef.current.close()
                esRef.current = null
            }
        }
    }, [mapReady, connectSSE])

    // ── Status badge ───────────────────────────────────────────────────────────
    const StatusBadge = () => {
        if (busStatus === 'loading') {
            return (
                <Badge variant="secondary" className="gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Connecting…
                </Badge>
            )
        }
        if (busStatus === 'online') {
            return (
                <Badge className="gap-1.5 bg-emerald-500 hover:bg-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                    Live
                </Badge>
            )
        }
        return (
            <Badge variant="secondary" className="gap-1.5 text-slate-500">
                <WifiOff className="h-3 w-3" />
                Bus offline
            </Badge>
        )
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!o) {
                    isUnmountedRef.current = true
                    abortControllerRef.current?.abort()
                    if (esRef.current) {
                        esRef.current.close()
                        esRef.current = null
                    }
                    onClose()
                }
            }}
        >
            <DialogContent className="w-[95vw] max-w-4xl p-0 gap-0 overflow-hidden">
                {/* Header */}
                <DialogHeader className="px-5 pt-5 pb-3 border-b">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600">
                                <Bus className="h-5 w-5 text-white" />
                            </div>
                            <div>
                                <DialogTitle className="text-base leading-tight">
                                    Route {routeNumber} — Live Tracking
                                </DialogTitle>
                                <DialogDescription className="text-xs">
                                    {vehicleNumber} · {driverName || 'No driver assigned'}
                                </DialogDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <StatusBadge />
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setBusStatus('loading')
                                    connectSSE()
                                }}
                                title="Reconnect"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                </DialogHeader>

                {/* Body: map + stats */}
                <div className="flex flex-col md:flex-row" style={{ height: '520px' }}>
                    {/* Map pane */}
                    <div className="flex-1 relative bg-slate-100 dark:bg-slate-900">
                        {/* Map container */}
                        <div ref={mapDivRef} className="absolute inset-0" />

                        {/* Auto-pan toggle */}
                        {mapReady && !mapError && (
                            <div className="absolute top-3 right-3 z-10">
                                <button
                                    onClick={() => setAutoPan((p) => !p)}
                                    title={
                                        autoPan
                                            ? 'Tracking bus — click to free-roam'
                                            : 'Free-roam mode — click to track bus'
                                    }
                                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-md border transition-colors ${
                                        autoPan
                                            ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
                                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600'
                                    }`}
                                >
                                    <Navigation className="h-3.5 w-3.5" />
                                    {autoPan ? 'Tracking' : 'Free-roam'}
                                </button>
                            </div>
                        )}

                        {/* Loading skeleton (like Uber/Swiggy) */}
                        {!mapReady && !mapError && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/95 dark:bg-slate-900/95 backdrop-blur-sm z-10">
                                {/* Animated skeleton bars */}
                                <div className="space-y-3 w-32">
                                    <div className="h-12 w-32 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
                                    <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                                </div>
                                <p className="text-xs text-muted-foreground mt-6 font-medium">
                                    Initializing map…
                                </p>
                            </div>
                        )}

                        {/* Map error state — graceful fallback */}
                        {mapError && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 z-10 p-6 text-center">
                                <AlertCircle className="h-12 w-12 text-destructive mb-4 opacity-80" />
                                <p className="font-bold text-sm mb-2">Map couldn't load</p>
                                <p className="text-xs text-muted-foreground max-w-xs leading-relaxed mb-4">
                                    {mapError}
                                </p>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setMapError(null)
                                        setMapReady(false)
                                        initMap()
                                    }}
                                >
                                    <RefreshCw className="h-3 w-3 mr-1.5" />
                                    Try Again
                                </Button>
                                {lastEvent && (
                                    <div className="mt-6 p-3 rounded-lg bg-muted/50 text-left w-full">
                                        <p className="text-xs font-semibold mb-2">Last known position:</p>
                                        <p className="text-xs font-mono text-muted-foreground break-all">
                                            {lastEvent.lat.toFixed(6)}, {lastEvent.lng.toFixed(6)}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Bus offline overlay */}
                        {mapReady && busStatus === 'offline' && !lastEvent && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm z-10 pointer-events-none">
                                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl px-6 py-5 text-center">
                                    <WifiOff className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                                    <p className="font-semibold text-sm">Bus is offline</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        No GPS signal. Driver may be idle or out of range.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stats panel */}
                    <div className="w-full md:w-64 flex-shrink-0 border-t md:border-t-0 md:border-l p-4 space-y-4 overflow-y-auto bg-card">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                                Driver GPS Usage
                            </p>
                            <div className="space-y-3">
                                {/* Position */}
                                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/40">
                                    <MapPin className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                                    <div className="min-w-0">
                                        <p className="text-xs text-muted-foreground">Position</p>
                                        {lastEvent ? (
                                            <p className="text-xs font-mono font-semibold break-all">
                                                {lastEvent.lat.toFixed(6)}, {lastEvent.lng.toFixed(6)}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground italic">
                                                Waiting for signal…
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Speed */}
                                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40">
                                    <Gauge className="h-4 w-4 text-emerald-500 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Speed</p>
                                        <p className="text-sm font-semibold">
                                            {lastEvent ? `${lastEvent.speed.toFixed(1)} km/h` : '—'}
                                        </p>
                                    </div>
                                </div>

                                {/* Heading */}
                                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40">
                                    <Compass className="h-4 w-4 text-amber-500 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Heading</p>
                                        <p className="text-sm font-semibold">
                                            {lastEvent ? `${lastEvent.heading.toFixed(0)}°` : '—'}
                                        </p>
                                    </div>
                                </div>

                                {/* Last update */}
                                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/40">
                                    <Clock className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-muted-foreground">Last update</p>
                                        <p className="text-sm font-semibold">
                                            {lastEvent
                                                ? format(
                                                      new Date(lastEvent.updated_at),
                                                      'HH:mm:ss'
                                                  )
                                                : '—'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Status info card */}
                        <div className="p-3 rounded-lg border border-muted/50 bg-muted/30">
                            <div className="flex items-center gap-2 mb-2">
                                <div
                                    className={`h-2 w-2 rounded-full ${
                                        busStatus === 'online'
                                            ? 'bg-emerald-500 animate-pulse'
                                            : busStatus === 'loading'
                                              ? 'bg-amber-500 animate-pulse'
                                              : 'bg-slate-400'
                                    }`}
                                />
                                <p className="text-xs font-semibold">
                                    {busStatus === 'online'
                                        ? 'Connected'
                                        : busStatus === 'loading'
                                          ? 'Connecting'
                                          : 'Offline'}
                                </p>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                {busStatus === 'loading'
                                    ? 'Waiting for GPS signal from the bus…'
                                    : busStatus === 'online'
                                      ? 'Receiving live GPS updates.'
                                      : 'No active GPS signal. Try the refresh button.'}
                            </p>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
