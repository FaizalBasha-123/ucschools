"use client"

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Bus, MapPin, Phone, User, Clock, ArrowLeft, Navigation,
    AlertTriangle, CheckCircle, PhoneCall, MessageCircle, Loader2,
    Radio, WifiOff, Wifi, RefreshCw, AlertCircle,
} from 'lucide-react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { api } from '@/lib/api'
import { buildWsBaseUrl, getWSTicket } from '@/lib/ws-ticket'
import { toast } from 'sonner'

// ─── session / location types ─────────────────────────────────────────────────

interface LocationEvent {
    route_id: string
    lat: number
    lng: number
    speed: number
    heading: number
    updated_at: number
}

interface SessionStatus {
    tracking_allowed: boolean
    manual_active: boolean
}

// ─── Google Maps singleton ────────────────────────────────────────────────────

let _mapsPromise: Promise<void> | null = null
let _mapsConfigured = false

function loadGoogleMaps(): Promise<void> {
    if (_mapsPromise) return _mapsPromise
    const key = process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''
    if (!key) { _mapsPromise = Promise.reject(new Error('NEXT_PUBLIC_GMAPS_KEY not set')); return _mapsPromise }
    if (!_mapsConfigured) { setOptions({ key, v: 'weekly' }); _mapsConfigured = true }
    _mapsPromise = importLibrary('maps').then(() => undefined)
    return _mapsPromise
}

// ─── LiveTrackSection component ───────────────────────────────────────────────

function LiveTrackSection({ routeId, routeNumber }: { routeId: string; routeNumber: string }) {
    const mapDivRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<google.maps.Map | null>(null)
    const markerRef = useRef<google.maps.Marker | null>(null)
    const esRef = useRef<EventSource | null>(null)

    const [mapReady, setMapReady] = useState(false)
    const [mapError, setMapError] = useState<string | null>(null)
    const [busStatus, setBusStatus] = useState<'loading' | 'online' | 'offline'>('loading')
    const [lastEvent, setLastEvent] = useState<LocationEvent | null>(null)

    const initMap = useCallback(async () => {
        if (!mapDivRef.current) return
        try {
            await loadGoogleMaps()
            const map = new google.maps.Map(mapDivRef.current, {
                center: { lat: 20.5937, lng: 78.9629 },
                zoom: 13,
                mapTypeControl: false,
                fullscreenControl: false,
                streetViewControl: false,
                zoomControl: true,
                styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
            })
            const marker = new google.maps.Marker({
                map,
                title: `Route ${routeNumber}`,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 10,
                    fillColor: '#6366f1',
                    fillOpacity: 1,
                    strokeColor: '#fff',
                    strokeWeight: 2,
                },
                visible: false,
            })
            mapRef.current = map
            markerRef.current = marker
            setMapReady(true)
        } catch (err) {
            setMapError(err instanceof Error ? err.message : 'Map failed to load')
        }
    }, [routeNumber])

    const connectSSE = useCallback(() => {
        ;(async () => {
            esRef.current?.close()
            try {
                const { ticket } = await getWSTicket('transport_read')
                const apiBase = buildWsBaseUrl().replace(/^ws/, 'http')
                const es = new EventSource(`${apiBase}/api/v1/transport/track/${routeId}?ticket=${encodeURIComponent(ticket)}`)
                esRef.current = es
                es.addEventListener('connected', (e) => {
                    const d = JSON.parse((e as MessageEvent).data)
                    setBusStatus(d.status === 'offline' ? 'offline' : 'online')
                })
                es.addEventListener('location', (e) => {
                    const ev: LocationEvent = JSON.parse((e as MessageEvent).data)
                    setLastEvent(ev)
                    setBusStatus('online')
                    if (!mapRef.current || !markerRef.current) return
                    const pos = { lat: ev.lat, lng: ev.lng }
                    markerRef.current.setPosition(pos)
                    markerRef.current.setVisible(true)
                    markerRef.current.setIcon({
                        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: 6,
                        rotation: ev.heading,
                        fillColor: '#6366f1',
                        fillOpacity: 1,
                        strokeColor: '#fff',
                        strokeWeight: 2,
                    })
                    mapRef.current.panTo(pos)
                })
                es.onerror = () => setBusStatus('offline')
            } catch {
                setBusStatus('offline')
            }
        })()
    }, [routeId])

    useEffect(() => { initMap() }, [initMap])
    useEffect(() => {
        if (!mapReady) return
        setBusStatus('loading')
        connectSSE()
        return () => { esRef.current?.close() }
    }, [mapReady, connectSSE])

    return (
        <Card className="border-0 shadow-lg overflow-hidden">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Radio className="h-5 w-5 text-indigo-500" />
                        <CardTitle className="text-base">Live Bus Tracking</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                        {busStatus === 'loading' && <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Connecting</Badge>}
                        {busStatus === 'online'  && <Badge className="gap-1 bg-emerald-500 hover:bg-emerald-500 text-white"><span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />Live</Badge>}
                        {busStatus === 'offline' && <Badge variant="secondary" className="gap-1 text-slate-500"><WifiOff className="h-3 w-3" />Bus offline</Badge>}
                        <Button variant="ghost" size="sm" onClick={() => { setBusStatus('loading'); connectSSE() }} title="Reconnect">
                            <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
                {lastEvent && (
                    <p className="text-xs text-muted-foreground mt-1">
                        Speed: {lastEvent.speed.toFixed(1)} km/h · Heading: {lastEvent.heading.toFixed(0)}° · Updated: {new Date(lastEvent.updated_at).toLocaleTimeString()}
                    </p>
                )}
            </CardHeader>
            <CardContent className="p-0">
                <div className="relative" style={{ height: 320 }}>
                    <div ref={mapDivRef} className="absolute inset-0" />
                    {!mapReady && !mapError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 z-10">
                            <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mb-2" />
                            <p className="text-sm text-muted-foreground">Loading map…</p>
                        </div>
                    )}
                    {mapError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 z-10 p-6 text-center">
                            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                            <p className="text-sm font-medium">Map unavailable</p>
                            <p className="text-xs text-muted-foreground mt-1">{mapError}</p>
                        </div>
                    )}
                    {mapReady && busStatus === 'offline' && !lastEvent && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm z-10">
                            <WifiOff className="h-8 w-8 text-slate-400 mb-2" />
                            <p className="text-sm text-slate-300 font-medium">Bus not yet broadcasting</p>
                            <p className="text-xs text-slate-400 mt-1">The driver hasn&apos;t started tracking yet</p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

interface BusStop {
    stop_name: string
    pickup_time?: string | null
    drop_time?: string | null
    order?: number | null
}

interface StudentBusRoute {
    id: string
    route_number: string
    vehicle_number: string
    driver_name: string
    driver_phone: string
    capacity: number
    status: string
    stops: BusStop[]
    student_stop?: BusStop | null
}

export default function StudentBusRoutePage() {
    const router = useRouter()

    const { data: route, isLoading } = useQuery({
        queryKey: ['student-bus-route'],
        queryFn: () => api.getOrEmpty<StudentBusRoute | null>('/student/bus-route', null),
        staleTime: 2 * 60 * 1000,
    })

    // ── session status polling (15s) — check if admin has enabled tracking ────
    const [session, setSession] = useState<SessionStatus | null>(null)
    useEffect(() => {
        const fetchSession = async () => {
            try {
                setSession(await api.get<SessionStatus>('/transport/session-status'))
            } catch { /* silent */ }
        }
        fetchSession()
        const id = setInterval(fetchSession, 15_000)
        return () => clearInterval(id)
    }, [])

    const handleCallDriver = () => {
        if (!route?.driver_phone) return
        toast.success('Initiating call...', {
            description: `Calling ${route.driver_name} at ${route.driver_phone}`,
        })
    }

    const handleMessageDriver = () => {
        if (!route?.driver_phone) return
        toast.info('Opening message...', {
            description: 'Opening SMS app to message the driver.',
        })
    }

    const handleCallCoordinator = (name: string, phone: string) => {
        toast.success('Initiating call...', {
            description: `Calling ${name} at ${phone}`,
        })
    }

    const handleReportIssue = () => {
        toast.info('Opening issue form...', {
            description: 'You can report any transport-related issues here.',
        })
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/student/dashboard')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                            My Bus Route
                        </h1>
                        <p className="text-muted-foreground">View your school bus route and schedule</p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    onClick={handleReportIssue}
                    className="gap-2"
                >
                    <AlertTriangle className="h-4 w-4" />
                    Report Issue
                </Button>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* No route assigned */}
            {!isLoading && !route && (
                <Card className="border-0 shadow-lg">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-4">
                        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
                            <Bus className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold">No Bus Route Assigned</h3>
                            <p className="text-muted-foreground mt-1 max-w-sm">
                                You have not been assigned to a school bus route yet, or you are using private transport.
                                Contact your school admin if you need transport assistance.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Route data */}
            {!isLoading && route && (
                <>
                    {/* Live tracking — visible only when admin has activated tracking */}
                    {session?.tracking_allowed && (
                        <LiveTrackSection routeId={route.id} routeNumber={route.route_number} />
                    )}

                    {/* Tracking not active notice (shown when route exists but tracking is off) */}
                    {!session?.tracking_allowed && (
                        <Card className="border border-dashed border-slate-200 dark:border-slate-700 shadow-none bg-transparent">
                            <CardContent className="flex items-center gap-3 py-4">
                                <Radio className="h-5 w-5 text-slate-400 shrink-0" />
                                <p className="text-sm text-muted-foreground">
                                    Live tracking is not active right now. Your school admin can enable it during bus hours.
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Route Info Card */}
                    <Card className="border-0 shadow-lg overflow-hidden">
                        <CardHeader className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                                        <Bus className="h-8 w-8" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-white text-2xl">Route {route.route_number}</CardTitle>
                                        <CardDescription className="text-blue-100">{route.vehicle_number}</CardDescription>
                                    </div>
                                </div>
                                <Badge variant="success" className="text-sm px-4 py-2 bg-green-500 text-white border-0 shadow-lg">
                                    <CheckCircle className="h-4 w-4 mr-1" />
                                    {route.status}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-4 md:p-6">
                            <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2">
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-lg flex items-center gap-2">
                                        <User className="h-5 w-5 text-blue-500" />
                                        Driver Information
                                    </h3>
                                    <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border">
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg">
                                                <User className="h-7 w-7" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-bold text-lg">{route.driver_name}</p>
                                                <p className="text-sm text-muted-foreground">{route.driver_phone}</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-3 mt-4">
                                            <Button
                                                size="sm"
                                                className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 border-0"
                                                onClick={handleCallDriver}
                                            >
                                                <PhoneCall className="h-4 w-4 mr-2" />
                                                Call
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="flex-1"
                                                onClick={handleMessageDriver}
                                            >
                                                <MessageCircle className="h-4 w-4 mr-2" />
                                                Message
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-lg flex items-center gap-2">
                                        <Clock className="h-5 w-5 text-blue-500" />
                                        Schedule
                                    </h3>
                                    <div className="space-y-3">
                                        {route.stops.length > 0 && route.stops[0].pickup_time && (
                                            <div className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border border-green-200 dark:border-green-800">
                                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg">
                                                    <Navigation className="h-6 w-6" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-green-700 dark:text-green-400">{route.stops[0].pickup_time}</p>
                                                    <p className="text-sm text-muted-foreground">Morning Pickup (first stop)</p>
                                                </div>
                                            </div>
                                        )}
                                        {route.stops.length > 0 && route.stops[route.stops.length - 1].drop_time && (
                                            <div className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border border-orange-200 dark:border-orange-800">
                                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg">
                                                    <Navigation className="h-6 w-6 rotate-180" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-orange-700 dark:text-orange-400">{route.stops[route.stops.length - 1].drop_time}</p>
                                                    <p className="text-sm text-muted-foreground">Afternoon Drop (last stop)</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Student's Stop */}
                    {route.student_stop && (
                        <Card className="border-4 border-blue-500 shadow-2xl overflow-hidden">
                            <CardHeader className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
                                <div className="flex items-center gap-2">
                                    <MapPin className="h-5 w-5" />
                                    <CardTitle className="text-white">Your Stop</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4 md:p-6">
                                <div className="flex items-center gap-4 md:gap-6 p-4 md:p-6 rounded-2xl bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50">
                                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-xl animate-pulse-glow">
                                        <MapPin className="h-10 w-10" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-bold text-2xl text-blue-700 dark:text-blue-400">{route.student_stop.stop_name}</p>
                                        <p className="text-muted-foreground mt-1">Your designated pickup/drop point</p>
                                    </div>
                                    {route.student_stop.pickup_time && (
                                        <div className="text-right">
                                            <p className="text-2xl md:text-4xl font-bold text-blue-600 dark:text-blue-400">{route.student_stop.pickup_time}</p>
                                            <p className="text-sm text-muted-foreground">Pickup Time</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Route Stops Timeline */}
                    {route.stops.length > 0 && (
                        <Card className="border-0 shadow-lg">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Navigation className="h-5 w-5 text-blue-500" />
                                    <CardTitle>Route Schedule</CardTitle>
                                </div>
                                <CardDescription>All stops on this route</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="relative">
                                    {route.stops.map((stop, index) => {
                                        const isMyStop = route.student_stop?.stop_name === stop.stop_name
                                        return (
                                            <div key={index} className={`flex gap-4 pb-6 last:pb-0 stagger-${index + 1} animate-slide-up`}>
                                                <div className="flex flex-col items-center">
                                                    <div className={`flex h-10 w-10 items-center justify-center rounded-full border-3 font-bold ${isMyStop
                                                        ? 'bg-gradient-to-br from-blue-500 to-cyan-600 text-white border-blue-500 shadow-lg shadow-blue-500/30'
                                                        : 'bg-background border-muted text-muted-foreground'
                                                        }`}>
                                                        {index + 1}
                                                    </div>
                                                    {index < route.stops.length - 1 && (
                                                        <div className={`w-1 flex-1 mt-2 rounded-full ${isMyStop ? 'bg-gradient-to-b from-blue-500 to-muted' : 'bg-muted'}`} />
                                                    )}
                                                </div>
                                                <div className={`flex-1 p-4 rounded-2xl transition-all duration-300 ${isMyStop
                                                    ? 'bg-gradient-to-r from-blue-100 to-cyan-100 dark:from-blue-950/50 dark:to-cyan-950/50 border-2 border-blue-500 shadow-lg'
                                                    : 'bg-muted/50 hover:bg-muted'
                                                    }`}>
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className={`font-semibold text-lg ${isMyStop ? 'text-blue-700 dark:text-blue-400' : ''}`}>
                                                                {stop.stop_name}
                                                            </p>
                                                            {isMyStop && (
                                                                <Badge variant="default" className="mt-2 bg-gradient-to-r from-blue-500 to-cyan-600 border-0">
                                                                    <MapPin className="h-3 w-3 mr-1" />
                                                                    Your Stop
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        {stop.pickup_time && (
                                                            <p className={`font-bold text-xl ${isMyStop ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                                                                {stop.pickup_time}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Emergency Contact */}
                    <Card className="border-0 shadow-lg">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Phone className="h-5 w-5 text-red-500" />
                                <CardTitle>Emergency Contact</CardTitle>
                            </div>
                            <CardDescription>In case of any issues with transport</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                <div className="p-5 rounded-2xl border-2 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 hover:border-blue-300 transition-all duration-300 hover:shadow-lg">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg">
                                            <User className="h-6 w-6" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm text-muted-foreground">Driver</p>
                                            <p className="font-bold text-lg">{route.driver_name}</p>
                                            <p className="text-blue-600 dark:text-blue-400 font-medium">{route.driver_phone}</p>
                                        </div>
                                        <Button
                                            size="icon"
                                            className="bg-gradient-to-br from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 border-0"
                                            onClick={() => handleCallCoordinator(route.driver_name, route.driver_phone)}
                                        >
                                            <PhoneCall className="h-5 w-5" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="p-5 rounded-2xl border-2 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 hover:border-blue-300 transition-all duration-300 hover:shadow-lg">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg">
                                            <Phone className="h-6 w-6" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm text-muted-foreground">School Reception</p>
                                            <p className="font-bold text-lg">Main Office</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    )
}
