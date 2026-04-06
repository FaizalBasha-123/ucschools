"use client"

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { CalendarDays, Clock, MapPin, Sparkles, Loader2 } from 'lucide-react'
import { useTeacherEvents } from '@/hooks/useEvents'

export default function TeacherCalendarPage() {
    const [date, setDate] = useState<Date | undefined>(new Date())
    const [mobileView, setMobileView] = useState<'calendar' | 'events'>('calendar')
    const { data, isLoading, isError, error } = useTeacherEvents({ page: 1, pageSize: 500 })
    const events = useMemo(() => data?.events || [], [data?.events])
    const upcomingEvents = useMemo(() => {
        const today = new Date()
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        return [...events]
            .filter((event) => {
                const [year, month, day] = event.date.split('-').map(Number)
                if (!year || !month || !day) return false
                const eventDate = new Date(year, month - 1, day)
                return eventDate >= startOfToday
            })
            .sort((a, b) => {
                if (a.date !== b.date) return a.date.localeCompare(b.date)
                return (a.startTime || '').localeCompare(b.startTime || '')
            })
    }, [events])

    const eventTypes = [
        { value: 'event', label: 'Event', color: 'bg-purple-500' },
        { value: 'exam', label: 'Exam', color: 'bg-red-500' },
        { value: 'holiday', label: 'Holiday', color: 'bg-green-500' },
        { value: 'meeting', label: 'Meeting', color: 'bg-blue-500' },
        { value: 'sports', label: 'Sports', color: 'bg-yellow-500' },
    ]

    const getTypeGradient = (type: string) => {
        switch (type) {
            case 'exam': return 'from-red-500 to-rose-600'
            case 'holiday': return 'from-emerald-500 to-green-600'
            case 'meeting': return 'from-blue-500 to-indigo-600'
            case 'sports': return 'from-amber-500 to-orange-500'
            default: return 'from-purple-500 to-violet-600'
        }
    }

    const getBadgeVariant = (type: string): "destructive" | "success" | "default" | "warning" | "secondary" => {
        switch (type) {
            case 'exam': return 'destructive'
            case 'holiday': return 'success'
            case 'meeting': return 'default'
            case 'sports': return 'warning'
            default: return 'secondary'
        }
    }

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'exam': return 'bg-red-500'
            case 'holiday': return 'bg-green-500'
            case 'meeting': return 'bg-blue-500'
            case 'sports': return 'bg-yellow-500'
            default: return 'bg-purple-500'
        }
    }

    return (
        <div className="space-y-6">
            {isLoading ? (
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-6 flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading calendar events...
                    </CardContent>
                </Card>
            ) : null}
            {isError ? (
                <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
                    <CardContent className="p-4 text-sm text-red-700 dark:text-red-300">
                        Failed to load events: {(error as Error)?.message || 'Unknown error'}
                    </CardContent>
                </Card>
            ) : null}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-4">
                    <div>
                        <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">School Calendar</h1>
                        <p className="text-muted-foreground mt-1">Exam timetables, events, and important dates for your classes</p>
                    </div>
                </div>
            </div>

            <div className="flex justify-end xl:hidden">
                <div className="inline-grid grid-cols-2 rounded-xl border bg-muted/60 p-1 shadow-sm">
                    <Button
                        type="button"
                        variant={mobileView === 'calendar' ? 'default' : 'ghost'}
                        size="sm"
                        className="h-8 rounded-lg px-3 text-xs"
                        onClick={() => setMobileView('calendar')}
                    >
                        Calendar
                    </Button>
                    <Button
                        type="button"
                        variant={mobileView === 'events' ? 'default' : 'ghost'}
                        size="sm"
                        className="h-8 rounded-lg px-3 text-xs"
                        onClick={() => setMobileView('events')}
                    >
                        Upcoming
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
                <div className={`xl:col-span-2 ${mobileView === 'events' ? 'hidden xl:block' : ''}`}>
                    <Card className="overflow-hidden shadow-xl border-0">
                        <CardContent className="p-5 md:p-6">
                        {/* Calendar widget area */}
                        <div className="bg-gradient-to-br from-slate-50/80 via-white to-indigo-50/30 dark:from-slate-900/50 dark:via-slate-800/30 dark:to-indigo-950/10 rounded-2xl p-3 md:p-4 border border-slate-200/50 dark:border-slate-700/30 shadow-inner">
                            <style jsx>{`
                                .enhanced-calendar {
                                    width: 100% !important;
                                    max-width: 100% !important;
                                }
                                .enhanced-calendar table {
                                    width: 100% !important;
                                    border-spacing: 4px !important;
                                    border-collapse: separate !important;
                                }
                                .enhanced-calendar td,
                                .enhanced-calendar th {
                                    width: 14.2857% !important;
                                }
                                .enhanced-calendar td > button,
                                .enhanced-calendar td > div {
                                    width: 100% !important;
                                    height: 56px !important;
                                    font-size: 0.95rem !important;
                                    border-radius: 12px !important;
                                    font-weight: 500 !important;
                                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
                                }
                                .enhanced-calendar td > button:hover {
                                    background-color: hsl(var(--primary) / 0.07) !important;
                                    transform: scale(1.08) !important;
                                }
                                .enhanced-calendar th {
                                    font-size: 0.75rem !important;
                                    padding-bottom: 14px !important;
                                    text-transform: uppercase !important;
                                    letter-spacing: 0.08em !important;
                                    font-weight: 700 !important;
                                    color: hsl(var(--muted-foreground) / 0.6) !important;
                                }
                                .enhanced-calendar .rdp-caption_label,
                                .enhanced-calendar [class*="caption"] {
                                    font-size: 1.3rem !important;
                                    font-weight: 800 !important;
                                    letter-spacing: -0.02em !important;
                                }
                                .enhanced-calendar .rdp-nav_button {
                                    width: 36px !important;
                                    height: 36px !important;
                                    border-radius: 10px !important;
                                }
                                .enhanced-calendar .rdp-nav_button:hover {
                                    background-color: hsl(var(--primary) / 0.1) !important;
                                    transform: scale(1.1) !important;
                                }
                                .enhanced-calendar .rdp-day_today:not(.rdp-day_selected) {
                                    background: linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.04)) !important;
                                    font-weight: 800 !important;
                                    color: hsl(var(--primary)) !important;
                                    box-shadow: inset 0 0 0 2px hsl(var(--primary) / 0.15) !important;
                                }
                            `}</style>
                            <Calendar
                                mode="single"
                                selected={date}
                                onSelect={setDate}
                                className="w-full calendar-with-events enhanced-calendar"
                                modifiers={{
                                    hasEventType: events.map(e => {
                                        const [year, month, day] = e.date.split('-')
                                        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    }),
                                    hasExam: events.filter(e => e.type === 'exam').map(e => {
                                        const [year, month, day] = e.date.split('-')
                                        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    }),
                                    hasHoliday: events.filter(e => e.type === 'holiday').map(e => {
                                        const [year, month, day] = e.date.split('-')
                                        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    }),
                                    hasMeeting: events.filter(e => e.type === 'meeting').map(e => {
                                        const [year, month, day] = e.date.split('-')
                                        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    }),
                                    hasSports: events.filter(e => e.type === 'sports').map(e => {
                                        const [year, month, day] = e.date.split('-')
                                        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    }),
                                    hasEvent: events.filter(e => e.type === 'event').map(e => {
                                        const [year, month, day] = e.date.split('-')
                                        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                    }),
                                }}
                                modifiersClassNames={{
                                    hasEventType: 'has-event-marker',
                                    hasExam: 'has-exam-event',
                                    hasHoliday: 'has-holiday-event',
                                    hasMeeting: 'has-meeting-event',
                                    hasSports: 'has-sports-event',
                                    hasEvent: 'has-general-event',
                                }}
                            />
                        </div>

                        {/* Event Type Legend */}
                        <div className="mt-4 flex items-center justify-center gap-4 md:gap-6 flex-wrap px-2 py-3 rounded-xl bg-muted/50 border border-border/50">
                            {eventTypes.map((type) => (
                                <div key={type.value} className="flex items-center gap-2">
                                    <div className={`h-2.5 w-2.5 rounded-full ${type.color} shadow-sm`} />
                                    <span className="text-xs font-semibold text-muted-foreground">{type.label}</span>
                                </div>
                            ))}
                        </div>

                        {/* Selected Date Display with Events */}
                        {date && (() => {
                            const year = date.getFullYear()
                            const month = String(date.getMonth() + 1).padStart(2, '0')
                            const day = String(date.getDate()).padStart(2, '0')
                            const selectedDateStr = `${year}-${month}-${day}`

                            const eventsOnDate = events.filter(e => e.date === selectedDateStr)
                            const isToday = date.toDateString() === new Date().toDateString()

                            return (
                                <div className="mt-5 space-y-4">
                                    {/* Selected Date Header */}
                                    <div className="relative overflow-hidden p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-purple-500/8 to-pink-500/10 border border-indigo-200/40 dark:border-indigo-800/30">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-purple-500/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
                                        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-bold mb-1.5">Selected Date</p>
                                                <p className="text-2xl font-extrabold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent tracking-tight">
                                                    {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                                                </p>
                                                <div className="flex items-center gap-2 mt-2">
                                                    {isToday && (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-300/30 dark:border-emerald-700/30 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
                                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                            Today
                                                        </span>
                                                    )}
                                                    <span className="text-sm text-muted-foreground font-medium">
                                                        {eventsOnDate.length === 0 ? 'No events scheduled' :
                                                            eventsOnDate.length === 1 ? '1 event scheduled' :
                                                                `${eventsOnDate.length} events scheduled`}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="hidden sm:flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 border border-indigo-200/30 dark:border-indigo-700/20">
                                                <span className="text-2xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                                                    {date.getDate()}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Events for Selected Date */}
                                    {eventsOnDate.length > 0 && (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between px-1">
                                                <p className="text-sm font-bold text-foreground flex items-center gap-2">
                                                    <Sparkles className="h-4 w-4 text-primary" />
                                                    {isToday ? "Today's Events" : 'Events on this Day'}
                                                </p>
                                                <Badge variant="secondary" className="text-xs font-bold shadow-sm">
                                                    {eventsOnDate.length}
                                                </Badge>
                                            </div>
                                            <div className="grid gap-3 sm:grid-cols-2 grid-cols-1 lg:grid-cols-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                                                {eventsOnDate.map((event, index) => (
                                                    <div
                                                        key={event.id}
                                                        className="group relative p-4 rounded-xl border bg-gradient-to-br from-card via-card to-muted/10 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:scale-[1.02] hover:-translate-y-0.5 cursor-pointer animate-slide-in-left overflow-hidden"
                                                        style={{ animationDelay: `${index * 60}ms` }}
                                                    >
                                                        {/* Color accent bar */}
                                                        <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-gradient-to-b ${getTypeGradient(event.type)}`} />

                                                        <div className="pl-3">
                                                            {/* Event header */}
                                                            <div className="flex items-start justify-between gap-2 mb-2.5">
                                                                <h4 className="font-bold text-sm leading-tight flex-1">{event.title}</h4>
                                                                <Badge
                                                                    variant={getBadgeVariant(event.type)}
                                                                    className="text-[10px] shrink-0 shadow-sm uppercase tracking-wider font-bold"
                                                                >
                                                                    {event.type}
                                                                </Badge>
                                                            </div>

                                                            {/* Event details */}
                                                            <div className="space-y-1.5">
                                                                <div className="flex items-center gap-2 text-xs">
                                                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                                                        <Clock className="h-3.5 w-3.5 text-primary" />
                                                                        <span className="font-semibold">{event.time}</span>
                                                                    </div>
                                                                    {event.location && (
                                                                        <>
                                                                            <span className="text-muted-foreground/40">•</span>
                                                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                                                <MapPin className="h-3.5 w-3.5 text-primary" />
                                                                                <span className="font-semibold truncate">{event.location}</span>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>

                                                                {event.description && (
                                                                    <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">
                                                                        {event.description}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Hover glow indicator */}
                                                        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300">
                                                            <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-lg shadow-primary/50" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })()}
                        </CardContent>
                    </Card>
                </div>

                <Card className={`lg:col-span-1 flex flex-col h-auto lg:h-[600px] border-0 shadow-lg ${mobileView === 'calendar' ? 'hidden xl:flex' : ''}`}>
                    <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-b shrink-0">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl">Upcoming Events</CardTitle>
                                <CardDescription className="mt-1">Scheduled for your classes</CardDescription>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
                                <CalendarDays className="h-4 w-4 text-primary" />
                                <span className="text-sm font-semibold text-primary">{upcomingEvents.length} Events</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 flex-1 overflow-hidden">
                        <div className="h-full overflow-y-auto p-4 md:p-6 space-y-3 custom-scrollbar">
                            {upcomingEvents.length === 0 ? (
                                <div className="text-center py-16">
                                    <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 mb-4">
                                        <CalendarDays className="h-10 w-10 text-muted-foreground" />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2">No Upcoming Events</h3>
                                    <p className="text-muted-foreground max-w-sm mx-auto">
                                        No events are scheduled for your classes yet.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {upcomingEvents.map((event) => (
                                        <div
                                            key={event.id}
                                            className="group relative flex gap-4 p-4 rounded-xl border bg-card hover:bg-accent/5 hover:shadow-md transition-all duration-300 hover:scale-[1.01]"
                                        >
                                            <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl ${getTypeColor(event.type)}`} />
                                            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-white ${getTypeColor(event.type)} shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                                <CalendarDays className="h-7 w-7" />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-semibold text-lg mb-1 truncate">{event.title}</h3>
                                                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{event.description}</p>
                                                    </div>
                                                    <Badge variant={getBadgeVariant(event.type)} className="text-xs font-semibold shrink-0">
                                                        {event.type}
                                                    </Badge>
                                                </div>

                                                <div className="flex flex-wrap items-center gap-4 text-sm">
                                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                                        <CalendarDays className="h-4 w-4 text-primary" />
                                                        <span className="font-medium">{event.date}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                                        <Clock className="h-4 w-4 text-primary" />
                                                        <span className="font-medium">{event.time}</span>
                                                    </div>
                                                    {event.location && (
                                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                                            <MapPin className="h-4 w-4 text-primary" />
                                                            <span className="font-medium truncate">{event.location}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
