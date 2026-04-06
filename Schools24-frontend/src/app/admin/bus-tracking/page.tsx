"use client"

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
    Card,
    CardContent,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
} from '@/components/ui/accordion'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import {
    Bus,
    Activity,
    Search,
    RefreshCw,
    Loader2,
    Navigation,
    Clock,
    Zap,
    Calendar,
    Route,
    User,
    Info,
    TrendingUp,
    AlertCircle,
    Radio,
    RadioTower,
    Play,
    Square,
    Timer,
    Plus,
    Pencil,
    Trash2,
} from 'lucide-react'
import { useTransportActivity, RouteActivity, RouteActivityDay } from '@/hooks/useTransportActivity'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { TrackBusDialog } from '@/components/transport/TrackBusDialog'
import { buildWsBaseUrl, getWSTicket } from '@/lib/ws-ticket'

// ─── session types ────────────────────────────────────────────────────────────

interface TrackingSession {
    started_by_id: string
    started_by_name: string
    started_at: number
    expires_at: number
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

interface TrackingSchedule {
    id: string
    school_id: string
    day_of_week: number
    label: string
    start_time: string
    end_time: string
    is_active: boolean
    created_at: number
    updated_at: number
}

interface RouteLiveStatus {
    route_id: string
    route_number: string
    vehicle_number: string
    driver_name: string
    online: boolean
    gps_in_use: boolean
    last_ping_at: number | null
    lat?: number | null
    lng?: number | null
    speed?: number | null
    heading?: number | null
}

interface FleetLiveStatus {
    updated_at: number
    tracking_allowed: boolean
    manual_active: boolean
    scheduled_active: boolean
    active_schedule: TrackingSchedule | null
    total_routes: number
    online_routes: number
    routes: RouteLiveStatus[]
}

interface TrackingSchedulePayload {
    day_of_week: number
    label: string
    start_time: string
    end_time: string
    is_active: boolean
}

interface TrackingScheduleCreatePayload {
    day_of_weeks?: number[]
    every_day?: boolean
    label: string
    start_time: string
    end_time: string
    is_active: boolean
}

const DAY_OPTIONS = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
]

const EMPTY_SCHEDULE_FORM: TrackingSchedulePayload = {
    day_of_week: 1,
    label: '',
    start_time: '06:00',
    end_time: '09:00',
    is_active: true,
}

// ─── Session Control Panel ────────────────────────────────────────────────────

function TrackingSessionPanel({ schoolId }: { schoolId?: string }) {
    const [status, setStatus] = useState<SessionStatus | null>(null)
    const [schedules, setSchedules] = useState<TrackingSchedule[]>([])
    const [loading, setLoading] = useState(true)
    const [acting, setActing] = useState(false)
    const [scheduleBusy, setScheduleBusy] = useState(false)
    const [duration, setDuration] = useState('120')
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const [remaining, setRemaining] = useState<string>('')
    const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
    const [scheduleForm, setScheduleForm] = useState<TrackingSchedulePayload>(EMPTY_SCHEDULE_FORM)
    const [selectedDays, setSelectedDays] = useState<number[]>([1])
    const [everyDay, setEveryDay] = useState(false)

    const qs = schoolId ? `?school_id=${schoolId}` : ''

    const fetchStatus = useCallback(async () => {
        try {
            const s = await api.get<SessionStatus>(`/admin/transport/tracking-session${qs}`)
            setStatus(s)
        } catch { /* silent */ }
    }, [qs])

    const fetchSchedules = useCallback(async () => {
        try {
            const res = await api.get<{ schedules: TrackingSchedule[] }>(`/admin/transport/tracking-schedules${qs}`)
            setSchedules(res.schedules ?? [])
        } catch (e: unknown) {
            toast.error('Failed to load tracking schedules', { description: (e as Error).message })
        }
    }, [qs])

    const fetchAll = useCallback(async () => {
        setLoading(true)
        await Promise.allSettled([fetchStatus(), fetchSchedules()])
        setLoading(false)
    }, [fetchSchedules, fetchStatus])

    useEffect(() => { fetchAll() }, [fetchAll])

    // Keep the admin badge live when a scheduled tracking window opens/closes.
    useEffect(() => {
        const statusId = setInterval(() => {
            void fetchStatus()
        }, 15_000)
        const schedulesId = setInterval(() => {
            void fetchSchedules()
        }, 60_000)
        return () => {
            clearInterval(statusId)
            clearInterval(schedulesId)
        }
    }, [fetchSchedules, fetchStatus])

    // countdown ticker
    useEffect(() => {
        if (tickRef.current) clearInterval(tickRef.current)
        if (!status?.session) { setRemaining(''); return }
        const tick = () => {
            const left = status.session!.expires_at - Date.now()
            if (left <= 0) { setRemaining('Expired'); fetchStatus(); return }
            const m = Math.floor(left / 60_000)
            const s = Math.floor((left % 60_000) / 1000)
            setRemaining(`${m}m ${s.toString().padStart(2, '0')}s`)
        }
        tick()
        tickRef.current = setInterval(tick, 1000)
        return () => clearInterval(tickRef.current!)
    }, [fetchStatus, status?.session])

    const handleStart = async () => {
        setActing(true)
        try {
            const s = await api.post<SessionStatus>(`/admin/transport/tracking-session${qs}`, {
                active: true,
                duration_minutes: parseInt(duration, 10),
            })
            setStatus(s)
            toast.success('Tracking session started', {
                description: `Drivers can now connect and broadcast GPS for ${duration} minutes.`,
            })
        } catch (e: unknown) {
            toast.error('Failed to start session', { description: (e as Error).message })
        } finally { setActing(false) }
    }

    const handleStop = async () => {
        setActing(true)
        try {
            const s = await api.post<SessionStatus>(`/admin/transport/tracking-session${qs}`, { active: false })
            setStatus(s)
            toast.success('Tracking stopped', { description: 'Current live tracking has been stopped for this school.' })
        } catch (e: unknown) {
            toast.error('Failed to stop session', { description: (e as Error).message })
        } finally { setActing(false) }
    }

    if (loading) return null

    const active = status?.tracking_allowed ?? false
    const isManual = status?.manual_active ?? false
    const isScheduled = status?.scheduled_active ?? false
    const activeSchedule = status?.active_schedule
    const nextWindow = status?.next_window

    const resetForm = () => {
        setEditingScheduleId(null)
        setScheduleForm(EMPTY_SCHEDULE_FORM)
        setSelectedDays([1])
        setEveryDay(false)
    }

    const toggleDay = (day: number) => {
        setSelectedDays(prev => {
            if (prev.includes(day)) {
                const next = prev.filter(d => d !== day)
                return next
            }
            return [...prev, day].sort((a, b) => a - b)
        })
    }

    const submitSchedule = async () => {
        if (!editingScheduleId && !everyDay && selectedDays.length === 0) {
            toast.error('Select at least one day')
            return
        }
        setScheduleBusy(true)
        try {
            if (editingScheduleId) {
                await api.put(`/admin/transport/tracking-schedules/${editingScheduleId}${qs}`, scheduleForm)
                toast.success('Tracking schedule updated')
            } else {
                const createPayload: TrackingScheduleCreatePayload = {
                    label: scheduleForm.label,
                    start_time: scheduleForm.start_time,
                    end_time: scheduleForm.end_time,
                    is_active: scheduleForm.is_active,
                }
                if (everyDay) {
                    createPayload.every_day = true
                } else {
                    createPayload.day_of_weeks = selectedDays
                }
                await api.post(`/admin/transport/tracking-schedules${qs}`, createPayload)
                toast.success('Tracking schedule created', {
                    description: everyDay
                        ? 'Created recurring windows for all 7 days.'
                        : `Created recurring windows for ${selectedDays.length} day(s).`,
                })
            }
            resetForm()
            await Promise.allSettled([fetchSchedules(), fetchStatus()])
        } catch (e: unknown) {
            toast.error('Failed to save tracking schedule', { description: (e as Error).message })
        } finally {
            setScheduleBusy(false)
        }
    }

    const editSchedule = (item: TrackingSchedule) => {
        setEditingScheduleId(item.id)
        setScheduleForm({
            day_of_week: item.day_of_week,
            label: item.label,
            start_time: item.start_time.slice(0, 5),
            end_time: item.end_time.slice(0, 5),
            is_active: item.is_active,
        })
        setSelectedDays([item.day_of_week])
        setEveryDay(false)
    }

    const removeSchedule = async (id: string) => {
        setScheduleBusy(true)
        try {
            await api.delete(`/admin/transport/tracking-schedules/${id}${qs}`)
            if (editingScheduleId === id) resetForm()
            toast.success('Tracking schedule deleted')
            await Promise.allSettled([fetchSchedules(), fetchStatus()])
        } catch (e: unknown) {
            toast.error('Failed to delete tracking schedule', { description: (e as Error).message })
        } finally {
            setScheduleBusy(false)
        }
    }

    return (
        <Card className={`border-2 shadow-md transition-colors duration-500 ${
            active
                ? 'border-emerald-400/60 dark:border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-border'
        }`}>
            <CardContent className="p-4 md:p-5">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                    {/* Status indicator */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl
                            ${active ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-muted-foreground'}`}>
                            {active
                                ? <Radio className="h-5 w-5 animate-pulse" />
                                : <RadioTower className="h-5 w-5" />}
                            {active && (
                                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                                </span>
                            )}
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-sm">
                                    {active ? 'Tracking Active' : 'Tracking Inactive'}
                                </span>
                                {isManual && (
                                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-xs">
                                        Manual override
                                    </Badge>
                                )}
                                {isScheduled && !isManual && (
                                    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0 text-xs">
                                        Scheduled window
                                    </Badge>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {isManual && status?.session ? (
                                    <>
                                        Started by <span className="font-medium">{status.session.started_by_name}</span>
                                        {remaining ? <> &bull; <Timer className="inline h-3 w-3 mx-0.5" />{remaining} remaining</> : null}
                                    </>
                                ) : isScheduled && activeSchedule ? (
                                    <>
                                        Active scheduled event: <span className="font-medium">{activeSchedule.label}</span>
                                        {' '}({activeSchedule.start_time.slice(0, 5)} - {activeSchedule.end_time.slice(0, 5)} IST)
                                    </>
                                ) : nextWindow?.schedule ? (
                                    <>
                                        Next auto-start: <span className="font-medium">{nextWindow.schedule.label}</span>
                                        {' '}in <span className="font-medium">{nextWindow.minutes_until_start} min</span>
                                        {' '}at {format(new Date(nextWindow.starts_at), 'hh:mm a')} IST
                                    </>
                                ) : (
                                    'Outside scheduled tracking windows. Use manual override or create schedule events below.'
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {!active && (
                            <Select value={duration} onValueChange={setDuration}>
                                <SelectTrigger className="w-[130px] h-9 text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="30">30 minutes</SelectItem>
                                    <SelectItem value="60">1 hour</SelectItem>
                                    <SelectItem value="120">2 hours</SelectItem>
                                    <SelectItem value="180">3 hours</SelectItem>
                                    <SelectItem value="360">6 hours</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                        {active ? (
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={handleStop}
                                disabled={acting}
                                className="gap-1.5"
                            >
                                {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                                Stop Tracking
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                onClick={handleStart}
                                disabled={acting}
                                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                Start Tracking
                            </Button>
                        )}
                    </div>
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                    <div className="rounded-xl border bg-muted/20 p-4">
                        <div className="mb-3">
                            <p className="text-sm font-semibold">{editingScheduleId ? 'Edit schedule event' : 'Add schedule event'}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Create multiple recurring tracking windows for each day.</p>
                        </div>
                        <div className="space-y-3">
                            {editingScheduleId ? (
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Day</label>
                                    <Select
                                        value={String(scheduleForm.day_of_week)}
                                        onValueChange={(value) => setScheduleForm((prev) => ({ ...prev, day_of_week: Number(value) }))}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {DAY_OPTIONS.map((day) => (
                                                <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-medium text-muted-foreground">Days</label>
                                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border"
                                                checked={everyDay}
                                                onChange={(e) => {
                                                    const checked = e.target.checked
                                                    setEveryDay(checked)
                                                    if (checked) setSelectedDays(DAY_OPTIONS.map(d => d.value))
                                                }}
                                            />
                                            Everyday
                                        </label>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {DAY_OPTIONS.map((day) => {
                                            const checked = selectedDays.includes(day.value)
                                            return (
                                                <label key={day.value} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${checked ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border'}`}>
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border"
                                                        checked={checked}
                                                        disabled={everyDay}
                                                        onChange={() => toggleDay(day.value)}
                                                    />
                                                    {day.label}
                                                </label>
                                            )
                                        })}
                                    </div>
                                    {!everyDay && selectedDays.length === 0 && (
                                        <p className="text-[11px] text-red-500">Select at least one day.</p>
                                    )}
                                </div>
                            )}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Label</label>
                                <Input
                                    value={scheduleForm.label}
                                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, label: e.target.value }))}
                                    placeholder="Morning pickup"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Start</label>
                                    <Input
                                        type="time"
                                        value={scheduleForm.start_time}
                                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, start_time: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Stop</label>
                                    <Input
                                        type="time"
                                        value={scheduleForm.end_time}
                                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, end_time: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Status</label>
                                <Select
                                    value={scheduleForm.is_active ? 'active' : 'inactive'}
                                    onValueChange={(value) => setScheduleForm((prev) => ({ ...prev, is_active: value === 'active' }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="inactive">Inactive</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                                <Button
                                    size="sm"
                                    onClick={submitSchedule}
                                    disabled={scheduleBusy || (!editingScheduleId && !everyDay && selectedDays.length === 0)}
                                    className="gap-1.5"
                                >
                                    {scheduleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                    {editingScheduleId ? 'Update Event' : 'Add Event'}
                                </Button>
                                {editingScheduleId && (
                                    <Button size="sm" variant="outline" onClick={resetForm} disabled={scheduleBusy}>
                                        Cancel
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border">
                        <div className="border-b bg-muted/30 px-4 py-3">
                            <p className="text-sm font-semibold">Recurring Schedule Events</p>
                            <p className="text-xs text-muted-foreground mt-0.5">These events are stored inside this school&apos;s tenant data and do not affect any other school.</p>
                        </div>
                        <div className="p-4">
                            {schedules.length === 0 ? (
                                <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                                    No schedule events yet. Add your first tracking window for this school.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {DAY_OPTIONS.map((day) => {
                                        const items = schedules.filter((item) => item.day_of_week === day.value)
                                        if (items.length === 0) return null
                                        return (
                                            <div key={day.value} className="rounded-xl border bg-background">
                                                <div className="border-b px-4 py-2.5 text-sm font-semibold">{day.label}</div>
                                                <div className="divide-y">
                                                    {items.map((item) => (
                                                        <div key={item.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                                                            <div className="min-w-0">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="font-medium">{item.label}</span>
                                                                    <Badge variant={item.is_active ? 'default' : 'secondary'}>{item.is_active ? 'Active' : 'Inactive'}</Badge>
                                                                    {status?.active_schedule?.id === item.id && (
                                                                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">Live now</Badge>
                                                                    )}
                                                                </div>
                                                                <p className="mt-1 text-sm text-muted-foreground">{item.start_time.slice(0, 5)} - {item.end_time.slice(0, 5)} IST</p>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <Button size="sm" variant="outline" onClick={() => editSchedule(item)} className="gap-1.5">
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                    Edit
                                                                </Button>
                                                                <Button size="sm" variant="destructive" onClick={() => removeSchedule(item.id)} disabled={scheduleBusy} className="gap-1.5">
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                    Delete
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatLastSeen(ms: number | null): string {
    if (!ms) return 'Never'
    const d = new Date(ms)
    const now = Date.now()
    const diffMins = Math.floor((now - ms) / 60_000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 24 * 60) return `${Math.floor(diffMins / 60)}h ago`
    return format(d, 'dd MMM, hh:mm a')
}

function formatTime(ms: number | null): string {
    if (!ms) return '—'
    return format(new Date(ms), 'hh:mm a')
}

function activityColor(records: number): string {
    if (records === 0) return 'bg-slate-200 dark:bg-slate-700'
    if (records < 20) return 'bg-amber-400'
    if (records < 60) return 'bg-emerald-400'
    return 'bg-indigo-500'
}

function activityLabel(records: number): string {
    if (records === 0) return 'No activity'
    if (records < 20) return 'Light activity'
    if (records < 60) return 'Moderate activity'
    return 'High activity'
}

// ─── sub-components ───────────────────────────────────────────────────────────

// Mon→Sun label characters for the 7 week-day slots
const WEEK_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// 7-cell mini heat-map aligned to Mon→Sun of the current calendar week.
// Future days are rendered dimmed so the admin can see the full week shape.
function ActivityHeatMap({ daily }: { daily: RouteActivityDay[] }) {
    const slots = useMemo(() => {
        const map = new Map(daily.map(d => [d.day, d.records]))
        const today = new Date()
        // Find Monday of the current ISO week (Mon=1 ... Sun=0)
        const dow = today.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
        const daysFromMonday = dow === 0 ? 6 : dow - 1
        const monday = new Date(today)
        monday.setDate(today.getDate() - daysFromMonday)
        monday.setHours(0, 0, 0, 0)

        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday)
            d.setDate(monday.getDate() + i)
            const key = format(d, 'yyyy-MM-dd')
            const isFuture = d > today
            return { day: key, records: map.get(key) ?? 0, isFuture, label: WEEK_DAY_LABELS[i] }
        })
    }, [daily])

    return (
        <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1">
                {slots.map(({ day, records, isFuture }) => (
                    <div
                        key={day}
                        title={`${format(parseISO(day), 'EEE dd MMM')}: ${records} records`}
                        className={`h-5 w-5 rounded-sm cursor-default transition-opacity hover:opacity-80
                            ${isFuture ? 'bg-slate-200 dark:bg-slate-700 opacity-40' : activityColor(records)}`}
                    />
                ))}
            </div>
            <div className="flex items-center gap-1">
                {slots.map(({ day, label }) => (
                    <div key={day} className="w-5 text-center text-[9px] leading-none text-muted-foreground font-medium">
                        {label}
                    </div>
                ))}
            </div>
        </div>
    )
}

// Daily breakdown table inside the accordion
function DailyBreakdown({ daily }: { daily: RouteActivityDay[] }) {
    if (daily.length === 0) {
        return (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                No tracking data recorded in the last 7 days.
            </div>
        )
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="pb-2 pr-4 font-medium">Date</th>
                        <th className="pb-2 pr-4 font-medium text-center">Records</th>
                        <th className="pb-2 pr-4 font-medium text-center">Activity</th>
                        <th className="pb-2 pr-4 font-medium text-right">First Ping</th>
                        <th className="pb-2 pr-4 font-medium text-right">Last Ping</th>
                        <th className="pb-2 pr-4 font-medium text-right">Avg Speed</th>
                        <th className="pb-2 font-medium text-right">Max Speed</th>
                    </tr>
                </thead>
                <tbody>
                    {daily.map((d) => (
                        <tr key={d.day} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 pr-4 font-medium">
                                {format(parseISO(d.day), 'EEE, dd MMM')}
                            </td>
                            <td className="py-2.5 pr-4 text-center">
                                <span className="font-semibold tabular-nums">{d.records}</span>
                            </td>
                            <td className="py-2.5 pr-4">
                                <div className="flex justify-center">
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
                                        ${d.records === 0 ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                            : d.records < 20 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                : d.records < 60 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                    : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'}`}>
                                        {activityLabel(d.records)}
                                    </span>
                                </div>
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                                {formatTime(d.first_ping)}
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                                {formatTime(d.last_ping)}
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums">
                                {d.avg_speed > 0 ? `${d.avg_speed.toFixed(1)} km/h` : '—'}
                            </td>
                            <td className="py-2.5 text-right tabular-nums font-medium text-indigo-600 dark:text-indigo-400">
                                {d.max_speed > 0 ? `${d.max_speed.toFixed(1)} km/h` : '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// Single route accordion row
function RouteRow({ route, liveRoute }: { route: RouteActivity; liveRoute?: RouteLiveStatus }) {
    const [trackOpen, setTrackOpen] = useState(false)
    const isTracked = route.total_records > 0
    const activeDaysFraction = `${route.active_days}/7`

    // Derive last-known GPS position from the live fleet status so Track Bus
    // dialog can show the location immediately before SSE connects.
    const lastKnownLocation = (liveRoute?.online && liveRoute.lat != null && liveRoute.lng != null)
        ? {
            lat: liveRoute.lat,
            lng: liveRoute.lng,
            speed: liveRoute.speed ?? 0,
            heading: liveRoute.heading ?? 0,
            lastPingAt: liveRoute.last_ping_at ?? Date.now(),
        }
        : null

    return (
        <>
            <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
                <Accordion type="single" collapsible>
                    <AccordionItem value="details" className="border-0">
                        {/*
                         * Radix AccordionPrimitive.Header + Trigger used directly here so the
                         * "Track Bus" action button can live as a flex sibling to the trigger
                         * rather than nested inside it — nested <button> inside <button> is
                         * invalid HTML and causes a Next.js hydration error.
                         */}
                        <AccordionPrimitive.Header className="flex items-start">
                            <AccordionPrimitive.Trigger
                                className="flex flex-1 flex-col items-start gap-0 px-3 py-3 sm:px-4 text-left font-medium transition-colors hover:bg-muted/20 [&[data-state=open]>svg]:rotate-180"
                            >
                                <div className="flex w-full items-start gap-3 sm:items-center">
                                    {/* Bus icon */}
                                    <div className="relative flex-shrink-0">
                                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl
                                            ${isTracked
                                                ? 'bg-gradient-to-br from-indigo-500 to-violet-600'
                                                : 'bg-slate-200 dark:bg-slate-700'}`}>
                                            <Bus className={`h-5 w-5 ${isTracked ? 'text-white' : 'text-muted-foreground'}`} />
                                        </div>
                                    </div>

                                    {/* Route info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                            <span className="text-sm sm:text-base font-semibold">Route {route.route_number}</span>
                                            <Badge variant="secondary" className="text-[10px] sm:text-xs font-mono">
                                                {route.vehicle_number}
                                            </Badge>
                                            {!isTracked && (
                                                <Badge variant="outline" className="text-[10px] sm:text-xs text-muted-foreground">
                                                    No data
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="mt-0.5 flex items-center gap-1 text-[11px] sm:text-xs text-muted-foreground">
                                            <User className="h-3 w-3" />
                                            {route.driver_name || 'No driver assigned'}
                                        </p>
                                    </div>

                                    {/* Right-side stats — desktop (no buttons here) */}
                                    <div className="hidden md:flex items-center gap-6 flex-shrink-0">
                                        <div className="flex flex-col items-center gap-1">
                                            <span className="text-xs text-muted-foreground">7-day activity</span>
                                            <ActivityHeatMap daily={route.daily} />
                                        </div>
                                        <div className="text-center min-w-[60px]">
                                            <p className="text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{activeDaysFraction}</p>
                                            <p className="text-xs text-muted-foreground">Active days</p>
                                        </div>
                                        <div className="text-center min-w-[60px]">
                                            <p className="text-lg font-bold tabular-nums">{route.total_records.toLocaleString()}</p>
                                            <p className="text-xs text-muted-foreground">Records</p>
                                        </div>
                                        <div className="text-center min-w-[80px]">
                                            <p className="text-sm font-semibold">{formatLastSeen(route.last_seen)}</p>
                                            <p className="text-xs text-muted-foreground">Last seen</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Mobile stats row */}
                                <div className="mt-3 grid w-full grid-cols-3 gap-2 pl-[52px] md:hidden">
                                    <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                                        <p className="text-sm font-bold text-indigo-600">{activeDaysFraction}</p>
                                        <p className="text-xs text-muted-foreground">Active</p>
                                    </div>
                                    <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                                        <p className="text-sm font-bold">{route.total_records.toLocaleString()}</p>
                                        <p className="text-xs text-muted-foreground">Records</p>
                                    </div>
                                    <div className="rounded-lg bg-muted/40 px-2 py-2 text-center">
                                        <p className="text-[11px] font-semibold leading-tight">{formatLastSeen(route.last_seen)}</p>
                                        <p className="text-xs text-muted-foreground">Last seen</p>
                                    </div>
                                </div>
                            </AccordionPrimitive.Trigger>

                            {/* Track Bus buttons — sibling to trigger, NOT nested inside it */}
                            <div className="flex items-center py-3 pr-3 shrink-0">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="hidden md:flex flex-shrink-0 border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
                                    onClick={() => setTrackOpen(true)}
                                >
                                    <Navigation className="mr-1.5 h-3.5 w-3.5" />
                                    Track Bus
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="md:hidden h-8 w-8 flex-shrink-0 border-indigo-300 p-0 text-indigo-600 hover:bg-indigo-50"
                                    onClick={() => setTrackOpen(true)}
                                >
                                    <Navigation className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </AccordionPrimitive.Header>

                        <AccordionContent className="px-3 pb-3 sm:px-4 sm:pb-4">
                            {/* Speed stats */}
                            {isTracked && (
                                <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 p-3 sm:grid-cols-2 dark:from-slate-900 dark:to-slate-800">
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                                            <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Avg speed</p>
                                            <p className="text-sm font-semibold">{route.avg_speed.toFixed(1)} km/h</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                                            <Zap className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Max speed</p>
                                            <p className="text-sm font-semibold">{route.max_speed.toFixed(1)} km/h</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                            <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Total records</p>
                                            <p className="text-sm font-semibold">{route.total_records.toLocaleString()}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Last seen</p>
                                            <p className="text-sm font-semibold">{formatLastSeen(route.last_seen)}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Daily table */}
                            <div className="overflow-hidden rounded-xl border">
                                <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b">
                                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        Daily Breakdown — Last 7 Days
                                    </span>
                                </div>
                                <div className="p-4">
                                    <DailyBreakdown daily={route.daily} />
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </Card>

            <TrackBusDialog
                open={trackOpen}
                onClose={() => setTrackOpen(false)}
                routeId={route.route_id}
                routeNumber={route.route_number}
                vehicleNumber={route.vehicle_number}
                driverName={route.driver_name}
                lastKnownLocation={lastKnownLocation}
            />
        </>
    )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function BusTrackingPage() {
    const searchParams = useSearchParams()
    const { user } = useAuth()
    const isSuperAdmin = user?.role === 'super_admin'
    const schoolId = searchParams.get('school_id') || undefined
    const canLoad = !isSuperAdmin || !!schoolId

    const [search, setSearch] = useState('')
    const [liveStatus, setLiveStatus] = useState<FleetLiveStatus | null>(null)
    const [liveSocketConnected, setLiveSocketConnected] = useState(false)
    const wsRef = useRef<WebSocket | null>(null)
    const wsRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const wsRetryCountRef = useRef(0)

    const { data: routes = [], isLoading, isError, refetch, isFetching } = useTransportActivity(
        isSuperAdmin ? schoolId : undefined,
        { enabled: canLoad, isLive: liveStatus?.tracking_allowed }
    )

    const filtered = useMemo(() => {
        const q = search.toLowerCase()
        if (!q) return routes
        return routes.filter(r =>
            r.route_number.toLowerCase().includes(q) ||
            r.vehicle_number.toLowerCase().includes(q) ||
            r.driver_name.toLowerCase().includes(q)
        )
    }, [routes, search])

    useEffect(() => {
        if (!canLoad) return

        let active = true
        const MAX_RETRY = 6
        const connect = async () => {
            try {
                const { ticket } = await getWSTicket('transport_read')
                if (!active) return
                const url = `${buildWsBaseUrl()}/api/v1/transport/admin-live/ws?ticket=${encodeURIComponent(ticket)}`
                const ws = new WebSocket(url)
                wsRef.current = ws

                ws.onopen = () => {
                    setLiveSocketConnected(true)
                    wsRetryCountRef.current = 0
                }
                ws.onmessage = (event) => {
                    try {
                        const payload = JSON.parse(event.data as string) as FleetLiveStatus
                        setLiveStatus(payload)
                    } catch {
                        // ignore malformed payload
                    }
                }
                ws.onclose = () => {
                    setLiveSocketConnected(false)
                    wsRef.current = null
                    if (!active) return
                    if (wsRetryCountRef.current >= MAX_RETRY) return
                    const delay = Math.min(1000 * 2 ** wsRetryCountRef.current, 15000)
                    wsRetryCountRef.current += 1
                    wsRetryRef.current = setTimeout(() => { void connect() }, delay)
                }
                ws.onerror = () => ws.close()
            } catch {
                setLiveSocketConnected(false)
                if (!active) return
                if (wsRetryCountRef.current >= MAX_RETRY) return
                const delay = Math.min(1000 * 2 ** wsRetryCountRef.current, 15000)
                wsRetryCountRef.current += 1
                wsRetryRef.current = setTimeout(() => { void connect() }, delay)
            }
        }

        void connect()
        return () => {
            active = false
            if (wsRetryRef.current) clearTimeout(wsRetryRef.current)
            wsRef.current?.close()
            wsRef.current = null
            setLiveSocketConnected(false)
        }
    }, [canLoad])

    // Fleet-level stats
    const stats = useMemo(() => {
        const totalRecords = routes.reduce((s, r) => s + r.total_records, 0)
        const trackedRoutes = routes.filter(r => r.total_records > 0).length
        const maxSpeed = routes.reduce((m, r) => Math.max(m, r.max_speed), 0)
        const avgSpeed = routes.filter(r => r.avg_speed > 0).reduce((s, r, _, arr) =>
            s + r.avg_speed / arr.length, 0)
        return { totalRecords, trackedRoutes, totalRoutes: routes.length, maxSpeed, avgSpeed }
    }, [routes])

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Page header */}
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                            Bus Tracking — 7-Day Activity
                        </h1>
                        <div className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs">
                            <span className={`h-2.5 w-2.5 rounded-full ${liveStatus?.tracking_allowed ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            <span className="font-medium text-muted-foreground">
                                Tracking {liveStatus?.tracking_allowed ? 'ON' : 'OFF'}
                            </span>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs">
                            <span className={`h-2.5 w-2.5 rounded-full ${liveSocketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            <span className="font-medium text-muted-foreground">
                                Socket {liveSocketConnected ? 'Connected' : 'Disconnected'}
                            </span>
                        </div>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm md:text-base text-muted-foreground">
                        GPS tracking log for each bus over the past 7 days. Data is retained for exactly 7 days and flushed nightly.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="h-9 w-full sm:w-auto"
                >
                    {isFetching
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <RefreshCw className="mr-2 h-4 w-4" />}
                    Refresh
                </Button>
            </div>

            {/* Manual tracking session control — only for admin (not super-admin school picker) */}
            {canLoad && <TrackingSessionPanel schoolId={isSuperAdmin ? schoolId : undefined} />}

            {/* Super-admin notice */}
            {isSuperAdmin && !schoolId && (
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-start gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                                <Info className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold">Select a school</h3>
                                <p className="text-sm text-muted-foreground">
                                    Pass a <code className="text-xs bg-muted px-1 rounded">?school_id=</code> query parameter
                                    or open this page from the school context in the Super Admin console.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Fleet summary stats */}
            {canLoad && (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-indigo-500 to-indigo-600">
                        <CardContent className="p-3.5 sm:p-4">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
                            <div className="relative z-10">
                                <Bus className="h-5 w-5 text-white/80 mb-1" />
                                <p className="text-xl sm:text-2xl font-bold text-white">{stats.trackedRoutes}/{stats.totalRoutes}</p>
                                <p className="text-xs text-indigo-100">Routes tracked this week</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-emerald-500 to-emerald-600">
                        <CardContent className="p-3.5 sm:p-4">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
                            <div className="relative z-10">
                                <Activity className="h-5 w-5 text-white/80 mb-1" />
                                <p className="text-xl sm:text-2xl font-bold text-white">{stats.totalRecords.toLocaleString()}</p>
                                <p className="text-xs text-emerald-100">Total GPS records</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-amber-500 to-amber-600">
                        <CardContent className="p-3.5 sm:p-4">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
                            <div className="relative z-10">
                                <TrendingUp className="h-5 w-5 text-white/80 mb-1" />
                                <p className="text-xl sm:text-2xl font-bold text-white">{stats.avgSpeed.toFixed(1)}</p>
                                <p className="text-xs text-amber-100">Fleet avg speed (km/h)</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-violet-500 to-violet-600">
                        <CardContent className="p-3.5 sm:p-4">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
                            <div className="relative z-10">
                                <Zap className="h-5 w-5 text-white/80 mb-1" />
                                <p className="text-xl sm:text-2xl font-bold text-white">{stats.maxSpeed.toFixed(1)}</p>
                                <p className="text-xs text-violet-100">Fleet max speed (km/h)</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Search bar */}
            {canLoad && (
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search by route number, vehicle number, or driver name..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="h-9 pl-10"
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Legend */}
            {canLoad && !isLoading && routes.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground px-1">
                    <span className="font-medium">Activity scale:</span>
                    {[
                        { color: 'bg-slate-200 dark:bg-slate-700', label: 'No activity' },
                        { color: 'bg-amber-400', label: 'Light (< 20)' },
                        { color: 'bg-emerald-400', label: 'Moderate (< 60)' },
                        { color: 'bg-indigo-500', label: 'High (≥ 60)' },
                    ].map(({ color, label }) => (
                        <div key={label} className="flex items-center gap-1.5">
                            <div className={`h-4 w-4 rounded-sm ${color}`} />
                            <span>{label}</span>
                        </div>
                    ))}
                    <span className="ml-1 text-muted-foreground/60">records per day (30-second batches)</span>
                    {liveStatus && (
                        <>
                            <span className="mx-1 h-3 w-px bg-border" />
                            <div className="flex items-center gap-1.5">
                                <span className={`h-2.5 w-2.5 rounded-full ${liveStatus.online_routes > 0 ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                <span>{liveStatus.online_routes}/{liveStatus.total_routes} routes live now</span>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Live driver GPS usage panel */}
            {canLoad && liveStatus && (
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">Driver GPS Usage — Live</p>
                            <p className="text-xs text-muted-foreground">
                                Updated {format(new Date(liveStatus.updated_at), 'hh:mm:ss a')}
                            </p>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {liveStatus.routes.map((r) => (
                                <div key={r.route_id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">Route {r.route_number} • {r.driver_name || 'No driver'}</p>
                                        <p className="text-xs text-muted-foreground">{r.vehicle_number}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="inline-flex items-center gap-1.5">
                                            <span className={`h-2.5 w-2.5 rounded-full ${r.gps_in_use ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                            <span className="text-xs font-medium">{r.gps_in_use ? 'GPS Active' : 'GPS Idle'}</span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground mt-1">
                                            {r.last_ping_at ? `Last ping ${format(new Date(r.last_ping_at), 'hh:mm:ss a')}` : 'No live ping'}
                                        </p>
                                        {typeof r.lat === 'number' && typeof r.lng === 'number' && (
                                            <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                                                {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Route list */}
            {isLoading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground">
                    <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                    Loading tracking data...
                </div>
            ) : isError ? (
                <Card className="border-0 shadow-sm">
                    <CardContent className="py-12 text-center">
                        <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
                        <p className="font-semibold">Failed to load tracking data</p>
                        <p className="text-sm text-muted-foreground mt-1">Check your connection and try again.</p>
                        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            ) : canLoad && filtered.length === 0 ? (
                <Card className="border-0 shadow-sm">
                    <CardContent className="py-12 text-center">
                        <Route className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                        <p className="font-semibold">
                            {search ? 'No routes match your search' : 'No bus routes found'}
                        </p>
                        {search && (
                            <Button variant="ghost" className="mt-3 text-sm" onClick={() => setSearch('')}>
                                Clear search
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {filtered.map((route) => (
                        <RouteRow
                            key={route.route_id}
                            route={route}
                            liveRoute={liveStatus?.routes.find(r => r.route_id === route.route_id)}
                        />
                    ))}
                </div>
            )}

            {/* Data retention notice */}
            {canLoad && !isLoading && routes.length > 0 && (
                <Card className="border-0 shadow-sm bg-muted/30">
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                            <p className="text-xs text-muted-foreground">
                                GPS records are written every 30 seconds per active driver and flushed automatically after 7 days.
                                Each record captures latitude, longitude, speed, and heading. History is school-isolated —
                                data from other schools is never visible here.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
