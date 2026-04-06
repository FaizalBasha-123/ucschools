"use client"

/**
 * StopsBuilder — Dialog for defining GPS-based route stops.
 *
 * Uses Google Places Autocomplete (importLibrary('places')) to let admins
 * search real addresses. Stops can be drag-reordered with HTML5 drag-and-drop.
 * Each stop has an adjustable arrival-radius (30–300 m) used by the
 * server-side stop-arrival engine.
 *
 * On save → PUT /admin/bus-routes/:id/stops
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { GripVertical, Loader2, MapPin, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { useGetRouteStops, useUpdateRouteShape, useUpdateRouteStops } from '@/hooks/useBusRouteStops'
import { BusRouteStopInput } from '@/types'
import { cn } from '@/lib/utils'

// ── Google Maps singleton ─────────────────────────────────────────────────────

let _mapsLoaded: Promise<void> | null = null
let _configured = false

function loadMapsLibraries(): Promise<void> {
    if (_mapsLoaded) return _mapsLoaded
    const key = process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''
    if (!key) {
        _mapsLoaded = Promise.reject(new Error('NEXT_PUBLIC_GMAPS_KEY not configured'))
        return _mapsLoaded
    }
    if (!_configured) {
        setOptions({ key, v: 'weekly' })
        _configured = true
    }
    // Load both maps + places
    _mapsLoaded = Promise.all([
        importLibrary('maps'),
        importLibrary('places'),
        importLibrary('geometry'),
    ]).then(() => undefined)
    return _mapsLoaded
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DraftStop extends BusRouteStopInput {
    _key: string   // stable local identity for React keys / drag
}

interface StopsBuilderProps {
    open: boolean
    onClose: () => void
    routeId: string
    routeNumber: string
    schoolId?: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

let _keyCounter = 0
function nextKey() { return `stop_${++_keyCounter}` }

// ── Component ────────────────────────────────────────────────────────────────

export function StopsBuilder({ open, onClose, routeId, routeNumber, schoolId }: StopsBuilderProps) {
    const { data: savedStops, isLoading: loadingStops } = useGetRouteStops(open ? routeId : null, schoolId)
    const updateStops = useUpdateRouteStops()
    const updateShape = useUpdateRouteShape()

    const [drafts, setDrafts] = useState<DraftStop[]>([])
    const [mapsReady, setMapsReady] = useState(false)
    const [mapsError, setMapsError] = useState<string | null>(null)
    const [searchValue, setSearchValue] = useState('')
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

    const searchInputRef = useRef<HTMLInputElement>(null)
    const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
    const dragSourceRef = useRef<number | null>(null)

    // ── Load saved stops into draft array when dialog opens ──────────────────
    useEffect(() => {
        if (open && savedStops) {
            setDrafts(
                [...savedStops]
                    .sort((a, b) => a.sequence - b.sequence)
                    .map(s => ({
                        _key: nextKey(),
                        sequence: s.sequence,
                        stop_name: s.stop_name,
                        address: s.address,
                        lat: s.lat,
                        lng: s.lng,
                        radius_meters: s.radius_meters,
                        place_id: s.place_id ?? undefined,
                        notes: s.notes ?? undefined,
                    }))
            )
        }
        if (!open) {
            setDrafts([])
            setSearchValue('')
        }
    }, [open, savedStops])

    // ── Load Google Maps once when dialog first opens ─────────────────────────
    useEffect(() => {
        if (!open) return
        loadMapsLibraries()
            .then(() => setMapsReady(true))
            .catch(e => setMapsError(e.message ?? 'Maps failed to load'))
    }, [open])

    // ── Wire Autocomplete to the search input ─────────────────────────────────
    useEffect(() => {
        if (!mapsReady || !searchInputRef.current) return
        const ac = new google.maps.places.Autocomplete(searchInputRef.current, {
            fields: ['place_id', 'name', 'formatted_address', 'geometry'],
        })
        autocompleteRef.current = ac

        const listener = ac.addListener('place_changed', () => {
            const place = ac.getPlace()
            if (!place.geometry?.location) return

            const lat = place.geometry.location.lat()
            const lng = place.geometry.location.lng()
            const stop: DraftStop = {
                _key: nextKey(),
                sequence: 0,            // will be renumbered on save
                stop_name: place.name ?? place.formatted_address ?? 'Stop',
                address: place.formatted_address ?? '',
                lat,
                lng,
                radius_meters: 80,
                place_id: place.place_id ?? undefined,
            }
            setDrafts(prev => [...prev, stop])
            setSearchValue('')
            // Clear the autocomplete input manually
            if (searchInputRef.current) searchInputRef.current.value = ''
        })

        return () => {
            google.maps.event.removeListener(listener)
            autocompleteRef.current = null
        }
    }, [mapsReady])

    // ── Drag helpers ─────────────────────────────────────────────────────────

    const onDragStart = useCallback((index: number) => {
        dragSourceRef.current = index
    }, [])

    const onDragEnter = useCallback((index: number) => {
        setDragOverIndex(index)
    }, [])

    const onDragEnd = useCallback(() => {
        const from = dragSourceRef.current
        const to = dragOverIndex
        if (from !== null && to !== null && from !== to) {
            setDrafts(prev => {
                const next = [...prev]
                const [moved] = next.splice(from, 1)
                next.splice(to, 0, moved)
                return next
            })
        }
        dragSourceRef.current = null
        setDragOverIndex(null)
    }, [dragOverIndex])

    // ── Remove stop ──────────────────────────────────────────────────────────

    const removeStop = useCallback((key: string) => {
        setDrafts(prev => prev.filter(d => d._key !== key))
    }, [])

    // ── Radius change ────────────────────────────────────────────────────────

    const setRadius = useCallback((key: string, value: number) => {
        setDrafts(prev => prev.map(d => d._key === key ? { ...d, radius_meters: value } : d))
    }, [])

    const buildShapeFromStops = useCallback(async (stops: BusRouteStopInput[]) => {
        if (stops.length < 2) return null

        const service = new google.maps.DirectionsService()
        const origin = { lat: stops[0].lat, lng: stops[0].lng }
        const destination = { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng }
        const waypoints = stops.slice(1, -1).map(s => ({
            location: { lat: s.lat, lng: s.lng },
            stopover: true,
        }))

        const result = await service.route({
            origin,
            destination,
            waypoints,
            optimizeWaypoints: false,
            travelMode: google.maps.TravelMode.DRIVING,
        })

        const route = result.routes?.[0]
        if (!route) return null

        let polyline = ''
        if (typeof route.overview_polyline === 'string') {
            polyline = route.overview_polyline
        } else if (route.overview_path?.length && google.maps.geometry?.encoding?.encodePath) {
            polyline = google.maps.geometry.encoding.encodePath(route.overview_path)
        }

        const distanceM = (route.legs || []).reduce((sum, leg) => sum + (leg.distance?.value || 0), 0)
        const durationSec = (route.legs || []).reduce((sum, leg) => sum + (leg.duration?.value || 0), 0)

        return {
            polyline,
            distance_m: distanceM || undefined,
            duration_est: durationSec || undefined,
        }
    }, [])

    // ── Save ─────────────────────────────────────────────────────────────────

    const handleSave = async () => {
        const payload: BusRouteStopInput[] = drafts.map((d, i) => ({
            sequence: i + 1,
            stop_name: d.stop_name,
            address: d.address,
            lat: d.lat,
            lng: d.lng,
            radius_meters: d.radius_meters,
            place_id: d.place_id,
            notes: d.notes,
        }))

        try {
            await updateStops.mutateAsync({ routeId, stops: payload, schoolId })

            // Shape is best-effort: stops are the source of truth.
            if (mapsReady && payload.length >= 2) {
                try {
                    const shape = await buildShapeFromStops(payload)
                    if (shape?.polyline) {
                        await updateShape.mutateAsync({ routeId, shape, schoolId })
                    }
                } catch {
                    // Route shape is optional; do not block stop persistence.
                }
            }

            onClose()
        } catch {
            // Error toasts are already handled by mutation hooks.
        }
    }

    const isSaving = updateStops.isPending || updateShape.isPending

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <Dialog open={open} onOpenChange={open => { if (!open) onClose() }}>
            <DialogContent className="w-[95vw] max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
                <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-indigo-500" />
                        GPS Stops — Route {routeNumber}
                    </DialogTitle>
                    <DialogDescription>
                        Search for stops using Google Places. Drag to reorder. Set arrival-radius per stop.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
                    {/* ── Search bar ─────────────────────────────────────────── */}
                    <div className="space-y-1.5">
                        <Label htmlFor="stop-search">Add Stop</Label>
                        {mapsError ? (
                            <p className="text-sm text-red-500">{mapsError}</p>
                        ) : !mapsReady ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading Google Maps…
                            </div>
                        ) : (
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                <input
                                    id="stop-search"
                                    ref={searchInputRef}
                                    value={searchValue}
                                    onChange={e => setSearchValue(e.target.value)}
                                    placeholder="Search address or place…"
                                    className={cn(
                                        "flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 py-1 text-sm shadow-sm",
                                        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    )}
                                    autoComplete="off"
                                />
                            </div>
                        )}
                    </div>

                    {/* ── Stop list ──────────────────────────────────────────── */}
                    {loadingStops ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading saved stops…
                        </div>
                    ) : drafts.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                            <MapPin className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                            No stops yet. Search above to add the first stop.
                        </div>
                    ) : (
                        <ol className="space-y-2">
                            {drafts.map((stop, index) => (
                                <li
                                    key={stop._key}
                                    draggable
                                    onDragStart={() => onDragStart(index)}
                                    onDragEnter={() => onDragEnter(index)}
                                    onDragEnd={onDragEnd}
                                    onDragOver={e => e.preventDefault()}
                                    className={cn(
                                        "group flex gap-3 items-start p-3 rounded-lg border bg-card select-none transition-colors",
                                        dragOverIndex === index && dragSourceRef.current !== index
                                            ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30"
                                            : "hover:border-slate-300"
                                    )}
                                >
                                    {/* Drag handle + sequence */}
                                    <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                                        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
                                        <span className="text-xs font-mono font-semibold text-muted-foreground w-4 text-center">
                                            {index + 1}
                                        </span>
                                    </div>

                                    {/* Stop details */}
                                    <div className="flex-1 min-w-0 space-y-2">
                                        <p className="font-medium text-sm leading-tight truncate">{stop.stop_name}</p>
                                        <p className="text-xs text-muted-foreground truncate">{stop.address}</p>

                                        {/* Radius slider */}
                                        <div className="flex items-center gap-3 pt-1">
                                            <Label className="text-xs whitespace-nowrap shrink-0 text-muted-foreground">
                                                Arrival radius
                                            </Label>
                                            <Slider
                                                value={[stop.radius_meters]}
                                                onValueChange={([v]) => setRadius(stop._key, v)}
                                                min={30}
                                                max={300}
                                                step={10}
                                                className="flex-1"
                                            />
                                            <span className="text-xs font-mono w-12 shrink-0 text-right">
                                                {stop.radius_meters} m
                                            </span>
                                        </div>
                                    </div>

                                    {/* Remove */}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 transition-opacity"
                                        onClick={() => removeStop(stop._key)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>

                <DialogFooter className="px-5 py-4 border-t shrink-0 flex-col sm:flex-row gap-2">
                    <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                    </Button>
                    <Button
                        disabled={drafts.length === 0 || isSaving}
                        className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-violet-600"
                        onClick={handleSave}
                    >
                        {isSaving ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Save {drafts.length} Stop{drafts.length !== 1 ? 's' : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
