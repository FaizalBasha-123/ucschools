"use client"

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Calendar, Clock, MapPin, CalendarDays, Users, ArrowLeft, Bell,
    PartyPopper, BookOpen, Trophy, Sparkles, ExternalLink
} from 'lucide-react'
import { useStudentEvents } from '@/hooks/useEvents'
import { toast } from 'sonner'

export default function StudentEventsPage() {
    const router = useRouter()
    const { data, isLoading } = useStudentEvents({ page: 1, pageSize: 500 })
    const allEvents = useMemo(() => data?.events || [], [data?.events])
    const upcomingEvents = useMemo(() => {
        const today = new Date()
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        return [...allEvents]
            .filter(e => e.type !== 'meeting')
            .filter(e => {
                const [y, m, d] = e.date.split('-').map(Number)
                if (!y || !m || !d) return true
                return new Date(y, m - 1, d) >= startOfToday
            })
            .sort((a, b) => a.date.localeCompare(b.date))
    }, [allEvents])

    const getEventColor = (type: string) => {
        switch (type) {
            case 'exam': return 'from-red-500 to-rose-600'
            case 'holiday': return 'from-green-500 to-emerald-600'
            case 'sports': return 'from-yellow-500 to-amber-600'
            case 'cultural': return 'from-purple-500 to-violet-600'
            default: return 'from-blue-500 to-cyan-600'
        }
    }

    const getEventBg = (type: string) => {
        switch (type) {
            case 'exam': return 'from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 hover:border-red-300'
            case 'holiday': return 'from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 hover:border-green-300'
            case 'sports': return 'from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 hover:border-yellow-300'
            case 'cultural': return 'from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/30 hover:border-violet-300'
            default: return 'from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 hover:border-blue-300'
        }
    }

    const getEventIcon = (type: string) => {
        switch (type) {
            case 'exam': return <BookOpen className="h-6 w-6" />
            case 'holiday': return <PartyPopper className="h-6 w-6" />
            case 'sports': return <Trophy className="h-6 w-6" />
            case 'cultural': return <Sparkles className="h-6 w-6" />
            default: return <CalendarDays className="h-6 w-6" />
        }
    }

    const handleSetReminder = (eventTitle: string) => {
        toast.success(`Reminder set for ${eventTitle}`, {
            description: 'You will be notified before the event.',
        })
    }

    const handleViewDetails = (eventTitle: string) => {
        toast.info(`Loading details for ${eventTitle}`, {
            description: 'Fetching event information...',
        })
    }

    if (isLoading) {
        return (
            <div className="space-y-6 animate-fade-in">
                <div className="flex items-center gap-2 p-6 text-muted-foreground">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading events...
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div>
                        <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                            Events
                        </h1>
                        <p className="text-muted-foreground">Stay updated with school events and activities</p>
                    </div>
                </div>
                <Button
                    className="w-full sm:w-auto bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 border-0 shadow-lg shadow-blue-500/20"
                    onClick={() => router.push('/student/calendar')}
                >
                    <Calendar className="mr-2 h-4 w-4" />
                    View Calendar
                </Button>
            </div>

            {/* Quick Stats */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg shadow-blue-500/30">
                                <CalendarDays className="h-7 w-7" />
                            </div>
                            <div>
                                <p className="text-xl md:text-3xl font-bold text-blue-700 dark:text-blue-400">{allEvents.length}</p>
                                <p className="text-sm text-muted-foreground">Upcoming Events</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/50 dark:to-rose-950/50">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/30">
                                <BookOpen className="h-7 w-7" />
                            </div>
                            <div>
                                <p className="text-xl md:text-3xl font-bold text-red-700 dark:text-red-400">{allEvents.filter(e => e.type === 'exam').length}</p>
                                <p className="text-sm text-muted-foreground">Exams</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30">
                                <PartyPopper className="h-7 w-7" />
                            </div>
                            <div>
                                <p className="text-xl md:text-3xl font-bold text-green-700 dark:text-green-400">{allEvents.filter(e => e.type === 'holiday').length}</p>
                                <p className="text-sm text-muted-foreground">Holidays</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/50 dark:to-amber-950/50">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-500 to-amber-600 text-white shadow-lg shadow-yellow-500/30">
                                <Trophy className="h-7 w-7" />
                            </div>
                            <div>
                                <p className="text-xl md:text-3xl font-bold text-yellow-700 dark:text-yellow-400">{allEvents.filter(e => e.type === 'sports').length}</p>
                                <p className="text-sm text-muted-foreground">Sports Events</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Events List */}
            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-blue-500" />
                        <CardTitle>Upcoming Events</CardTitle>
                    </div>
                    <CardDescription>Events scheduled for the next few weeks</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {upcomingEvents.map((event, index) => (
                            <div
                                key={event.id}
                                className={`p-5 rounded-2xl border-2 border-transparent transition-all duration-300 hover:shadow-xl bg-gradient-to-r ${getEventBg(event.type)} stagger-${(index % 5) + 1} animate-slide-up`}
                            >
                                <div className="flex flex-col sm:flex-row gap-5">
                                    <div className={`flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${getEventColor(event.type)} text-white shadow-lg`}>
                                        {getEventIcon(event.type)}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-2">
                                            <div>
                                                <h3 className="font-bold text-lg">{event.title}</h3>
                                                <p className="text-sm text-muted-foreground mt-1">{event.description}</p>
                                            </div>
                                            <Badge variant={
                                                event.type === 'exam' ? 'destructive' :
                                                    event.type === 'holiday' ? 'success' :
                                                        event.type === 'sports' ? 'warning' : 'secondary'
                                            } className="capitalize px-3 py-1 text-sm">
                                                {event.type}
                                            </Badge>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-full border">
                                                <Calendar className="h-4 w-4 text-blue-500" />
                                                <span>{event.date}</span>
                                            </div>
                                            <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-full border">
                                                <Clock className="h-4 w-4 text-violet-500" />
                                                <span>{event.time}</span>
                                            </div>
                                            {event.location && (
                                                <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-full border">
                                                    <MapPin className="h-4 w-4 text-green-500" />
                                                    <span>{event.location}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col sm:flex-row gap-3 mt-4">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleSetReminder(event.title)}
                                                className="w-full sm:w-auto hover:bg-blue-100 hover:text-blue-700 hover:border-blue-300"
                                            >
                                                <Bell className="h-4 w-4 mr-2" />
                                                Set Reminder
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleViewDetails(event.title)}
                                                className="w-full sm:w-auto hover:bg-violet-100 hover:text-violet-700 hover:border-violet-300"
                                            >
                                                <ExternalLink className="h-4 w-4 mr-2" />
                                                View Details
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Calendar CTA */}
            <Card className="border-0 shadow-2xl bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 text-white overflow-hidden">
                <CardContent className="p-4 md:p-8 relative">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-20 translate-x-20" />
                    <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/10 rounded-full translate-y-16 -translate-x-16" />
                    <div className="relative z-10 flex flex-col xl:flex-row items-center justify-between gap-4 xl:gap-6">
                        <div className="text-center md:text-left">
                            <h3 className="text-2xl font-bold mb-2 flex items-center gap-2 justify-center md:justify-start">
                                <CalendarDays className="h-7 w-7" />
                                Never Miss an Event!
                            </h3>
                            <p className="text-blue-100">View the full calendar to stay on top of all school activities</p>
                        </div>
                        <Button
                            size="lg"
                            className="w-full sm:w-auto bg-white text-blue-600 hover:bg-blue-50 shadow-xl px-8"
                            onClick={() => router.push('/student/calendar')}
                        >
                            <Calendar className="mr-2 h-5 w-5" />
                            Open Calendar
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
