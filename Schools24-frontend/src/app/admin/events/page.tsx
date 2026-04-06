"use client"

import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar } from '@/components/ui/calendar'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Plus, CalendarDays, Clock, MapPin, Edit, Trash2, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCreateEvent, useDeleteEvent, useInfiniteEvents, useUpdateEvent, EventItem } from '@/hooks/useEvents'
import { toast } from 'sonner'

interface EventFormData {
    title: string
    type: 'event' | 'exam' | 'holiday' | 'meeting' | 'sports'
    date: string
    time: string
    location: string
    description: string
}

const initialFormData: EventFormData = {
    title: '',
    type: 'event',
    date: '',
    time: '',
    location: '',
    description: '',
}

export default function EventsPage() {
    const { user, isLoading, userRole } = useAuth()
    const schoolId = undefined
    const isNormalAdmin = userRole === 'admin'
    const canLoad = !!user && !isLoading && isNormalAdmin

    const [date, setDate] = useState<Date | undefined>(new Date())
    const [formData, setFormData] = useState<EventFormData>(initialFormData)
    const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [mobileView, setMobileView] = useState<'calendar' | 'events'>('calendar')

    const eventTypes = [
        { value: 'event', label: 'Event', color: 'bg-purple-500' },
        { value: 'exam', label: 'Exam', color: 'bg-red-500' },
        { value: 'holiday', label: 'Holiday', color: 'bg-green-500' },
        { value: 'meeting', label: 'Meeting', color: 'bg-blue-500' },
        { value: 'sports', label: 'Sports', color: 'bg-yellow-500' },
    ]

    const {
        data: eventsData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        status
    } = useInfiniteEvents(schoolId, {
        pageSize: 20,
        enabled: canLoad,
    })

    const events = eventsData?.pages.flatMap(page => page.events) ?? []
    const upcomingEvents = useMemo(() => {
        const now = new Date()
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
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

    // Intersection Observer for infinite scrolling
    const loadMoreRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage()
                }
            },
            { threshold: 0.1 } // Trigger when 10% of the target is visible
        )

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current)
        }

        return () => {
            if (loadMoreRef.current) {
                observer.unobserve(loadMoreRef.current)
            }
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    const createEvent = useCreateEvent(schoolId)
    const updateEvent = useUpdateEvent(schoolId)
    const deleteEvent = useDeleteEvent(schoolId)

    const handleAddEvent = async () => {
        if (!formData.title || !formData.date) {
            toast.error('Please fill in required fields', {
                description: 'Title and date are required.',
            })
            return
        }

        try {
            await createEvent.mutateAsync({
                title: formData.title,
                type: formData.type,
                date: formData.date,
                time: formData.time,
                location: formData.location,
                description: formData.description,
            })
            setFormData(initialFormData)
            setIsAddDialogOpen(false)
        } catch (error) {
            // Error handled by mutation
        }
    }

    const handleEditEvent = async () => {
        if (!selectedEvent) return

        if (!formData.title || !formData.date) {
            toast.error('Please fill in required fields', {
                description: 'Title and date are required.',
            })
            return
        }

        try {
            await updateEvent.mutateAsync({
                id: selectedEvent.id,
                title: formData.title,
                type: formData.type,
                date: formData.date,
                time: formData.time,
                location: formData.location,
                description: formData.description,
            })
            setFormData(initialFormData)
            setSelectedEvent(null)
            setIsEditDialogOpen(false)
        } catch (error) {
            // Error handled by mutation
        }
    }

    const handleDeleteEvent = async () => {
        if (!selectedEvent) return

        try {
            await deleteEvent.mutateAsync(selectedEvent.id)
            setSelectedEvent(null)
            setIsDeleteDialogOpen(false)
        } catch (error) {
            // Error handled by mutation
        }
    }

    const openEditDialog = (event: EventItem) => {
        setSelectedEvent(event)
        setFormData({
            title: event.title,
            type: event.type as EventFormData['type'],
            date: event.date,
            time: event.startTime || '',
            location: event.location || '',
            description: event.description || '',
        })
        setIsEditDialogOpen(true)
    }

    const openDeleteDialog = (event: EventItem) => {
        setSelectedEvent(event)
        setIsDeleteDialogOpen(true)
    }

    const handleExport = () => {
        const csvContent = [
            ['Title', 'Type', 'Date', 'Time', 'Location', 'Description'].join(','),
            ...events.map(e => [
                e.title,
                e.type,
                e.date,
                e.time,
                e.location || '',
                e.description
            ].join(','))
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'events.csv'
        a.click()
        toast.success('Export completed', {
            description: 'Events data has been exported to CSV.',
        })
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

    const getBadgeVariant = (type: string): "destructive" | "success" | "default" | "warning" | "secondary" => {
        switch (type) {
            case 'exam': return 'destructive'
            case 'holiday': return 'success'
            case 'meeting': return 'default'
            case 'sports': return 'warning'
            default: return 'secondary'
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">Event Calendar</h1>
                    <p className="text-muted-foreground mt-1">Manage school events, holidays, and important dates</p>
                </div>
                <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
                    <Button variant="outline" onClick={handleExport} className="h-9 px-3 text-xs hover:bg-muted transition-colors sm:h-10 sm:w-auto sm:px-4 sm:text-sm" disabled={!canLoad}>
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                    <Button
                        disabled={!canLoad}
                        onClick={() => {
                            if (date) {
                                // Reset form first
                                setFormData({ ...initialFormData })

                                // Format date as YYYY-MM-DD for the input
                                const year = date.getFullYear()
                                const month = String(date.getMonth() + 1).padStart(2, '0')
                                const day = String(date.getDate()).padStart(2, '0')
                                const dateStr = `${year}-${month}-${day}`

                                setFormData(prev => ({
                                    ...prev,
                                    date: dateStr
                                }))
                            }
                            setIsAddDialogOpen(true)
                        }}
                        className="h-9 px-3 text-xs bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl sm:h-10 sm:w-auto sm:px-4 sm:text-sm"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Event
                    </Button>
                    <div className="inline-grid grid-cols-2 rounded-xl border bg-muted/60 p-0.5 shadow-sm sm:hidden">
                        <Button
                            type="button"
                            variant={mobileView === 'calendar' ? 'default' : 'ghost'}
                            size="sm"
                            className="h-8 rounded-md px-2 text-[11px]"
                            onClick={() => setMobileView('calendar')}
                        >
                            Cal
                        </Button>
                        <Button
                            type="button"
                            variant={mobileView === 'events' ? 'default' : 'ghost'}
                            size="sm"
                            className="h-8 rounded-md px-2 text-[11px]"
                            onClick={() => setMobileView('events')}
                        >
                            Event
                        </Button>
                    </div>

                    <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                        <DialogContent className="w-[95vw] sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Create New Event</DialogTitle>
                                <DialogDescription>
                                    Add a new event to the school calendar.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="title">Event Title *</Label>
                                    <Input
                                        id="title"
                                        placeholder="Enter event title"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="type">Event Type</Label>
                                    <Select
                                        value={formData.type}
                                        onValueChange={(value: EventFormData['type']) => setFormData({ ...formData, type: value })}
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {eventTypes.map((type) => (
                                                <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="date">Date *</Label>
                                        <Input
                                            id="date"
                                            type="date"
                                            value={formData.date}
                                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="time">Time</Label>
                                        <Input
                                            id="time"
                                            type="time"
                                            value={formData.time}
                                            onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="location">Location</Label>
                                    <Input
                                        id="location"
                                        placeholder="Enter location"
                                        value={formData.location}
                                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="description">Description</Label>
                                    <Textarea
                                        id="description"
                                        placeholder="Enter event description"
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => {
                                    setFormData(initialFormData)
                                    setIsAddDialogOpen(false)
                                }}>
                                    Cancel
                                </Button>
                                <Button onClick={handleAddEvent}>Create Event</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="hidden justify-end xl:hidden">
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

            <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-3">
                {/* Calendar */}
                <Card className={`xl:col-span-2 overflow-hidden min-h-[420px] md:min-h-[600px] ${mobileView === 'events' ? 'hidden xl:block' : ''}`}>

                    <CardContent className="p-4 md:p-6">
                        <div className="bg-gradient-to-br from-background to-muted/30 rounded-xl p-4 md:p-6 border shadow-inner">
                            <Calendar
                                mode="single"
                                selected={date}
                                onSelect={setDate}
                                className="w-full calendar-with-events [&_td_button]:font-bold"
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

                        {/* Selected Date Display with Events */}
                        {date && (() => {
                            // Format the selected date to YYYY-MM-DD to match event dates
                            const year = date.getFullYear()
                            const month = String(date.getMonth() + 1).padStart(2, '0')
                            const day = String(date.getDate()).padStart(2, '0')
                            const selectedDateStr = `${year}-${month}-${day}`

                            const eventsOnDate = events.filter(e => e.date === selectedDateStr)

                            return (
                                <div className="mt-4 space-y-4">
                                    {/* Selected Date Header */}
                                    <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-200/50 dark:border-indigo-800/50">
                                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Selected Date</p>
                                        <p className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                                            {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                                        </p>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            {eventsOnDate.length === 0 ? 'No events scheduled' :
                                                eventsOnDate.length === 1 ? '1 event scheduled' :
                                                    `${eventsOnDate.length} events scheduled`}
                                        </p>
                                    </div>

                                    {/* Events for Selected Date */}
                                    {eventsOnDate.length > 0 && (
                                        <div className="space-y-3">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1">
                                                <p className="text-sm font-bold text-foreground flex items-center gap-2">
                                                    <CalendarDays className="h-4 w-4 text-primary" />
                                                    {new Date().toDateString() === date.toDateString() ? "Events Today" : "Events"}
                                                </p>
                                                <Badge variant="secondary" className="text-xs">
                                                    {eventsOnDate.length}
                                                </Badge>
                                            </div>
                                            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
                                                {eventsOnDate.map((event, index) => (
                                                    <div
                                                        key={event.id}
                                                        className="relative p-3 rounded-xl border bg-card"
                                                    >
                                                        {/* Color accent bar */}
                                                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl ${getTypeColor(event.type)}`} />

                                                        <div className="pl-3">
                                                            {/* Event header */}
                                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                                                                <h4 className="font-bold text-sm leading-tight flex-1">{event.title}</h4>
                                                                <div className="flex items-center gap-2">
                                                                    <Badge
                                                                        variant={getBadgeVariant(event.type)}
                                                                        className="text-xs shrink-0 shadow-sm"
                                                                    >
                                                                        {event.type}
                                                                    </Badge>
                                                                    <div className="flex gap-1">
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-6 w-6 hover:bg-primary/10"
                                                                            onClick={() => openEditDialog(event)}
                                                                        >
                                                                            <Edit className="h-3 w-3" />
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-6 w-6 text-destructive hover:bg-destructive/10"
                                                                            onClick={() => openDeleteDialog(event)}
                                                                        >
                                                                            <Trash2 className="h-3 w-3" />
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Event details */}
                                                            <div className="space-y-1.5">
                                                                <div className="flex items-center gap-2 text-xs">
                                                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                                                        <Clock className="h-3.5 w-3.5 text-primary" />
                                                                        <span className="font-medium">{event.time}</span>
                                                                    </div>
                                                                    {event.location && (
                                                                        <>
                                                                            <span className="text-muted-foreground">•</span>
                                                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                                                <MapPin className="h-3.5 w-3.5 text-primary" />
                                                                                <span className="font-medium truncate">{event.location}</span>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>

                                                                {event.description && (
                                                                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                                                        {event.description}
                                                                    </p>
                                                                )}
                                                            </div>
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

                {/* Events List */}
                <Card className={`lg:col-span-1 flex flex-col min-h-[420px] md:h-[600px] ${mobileView === 'calendar' ? 'hidden xl:flex' : ''}`}>
                    <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-b shrink-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <CardTitle className="text-xl">Upcoming Events</CardTitle>
                                <CardDescription className="mt-1">All scheduled events and activities</CardDescription>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
                                <CalendarDays className="h-4 w-4 text-primary" />
                                <span className="text-sm font-semibold text-primary">{upcomingEvents.length} Events</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 flex-1 overflow-hidden">
                        <div className="h-full overflow-y-auto p-4 md:p-6 space-y-3 custom-scrollbar">
                            {!canLoad ? (
                                <div className="text-center py-16">
                                    <h3 className="text-lg font-semibold mb-2">Access Restricted</h3>
                                    <p className="text-muted-foreground max-w-sm mx-auto">
                                        Events can only be viewed and managed by the logged-in school admin.
                                    </p>
                                </div>
                            ) : upcomingEvents.length === 0 && !isFetchingNextPage ? (
                                <div className="text-center py-16">
                                    <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 mb-4">
                                        <CalendarDays className="h-10 w-10 text-muted-foreground" />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2">No Events Yet</h3>
                                    <p className="text-muted-foreground max-w-sm mx-auto mb-4">
                                        Start building your school calendar by adding your first event.
                                    </p>
                                    <Button
                                        onClick={() => setIsAddDialogOpen(true)}
                                        className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                                    >
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create Your First Event
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    {upcomingEvents.map((event) => (
                                        <div
                                            key={event.id}
                                            className="group relative flex gap-4 p-4 rounded-xl border bg-card hover:bg-accent/5 hover:shadow-md transition-all duration-300 hover:scale-[1.01]"
                                        >
                                            {/* Color indicator */}
                                            <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl ${getTypeColor(event.type)}`} />

                                            {/* Event icon */}
                                            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-white ${getTypeColor(event.type)} shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                                <CalendarDays className="h-7 w-7" />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-semibold text-lg mb-1 truncate">{event.title}</h3>
                                                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{event.description}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <Badge variant={getBadgeVariant(event.type)} className="text-xs font-semibold">
                                                            {event.type}
                                                        </Badge>
                                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 hover:bg-primary/10"
                                                                onClick={() => openEditDialog(event)}
                                                            >
                                                                <Edit className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                                                onClick={() => openDeleteDialog(event)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
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

                                    {/* Loading indicator and intersection target */}
                                    <div ref={loadMoreRef} className="py-4 flex justify-center w-full min-h-[50px]">
                                        {isFetchingNextPage ? (
                                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                        ) : hasNextPage ? (
                                            <div className="h-1" /> // Invisible target
                                        ) : upcomingEvents.length > 0 ? (
                                            <p className="text-xs text-muted-foreground">No more events</p>
                                        ) : null}
                                    </div>
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Edit Dialog */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Event</DialogTitle>
                        <DialogDescription>
                            Update the event details.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="edit-title">Event Title *</Label>
                            <Input
                                id="edit-title"
                                placeholder="Enter event title"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="edit-type">Event Type</Label>
                            <Select
                                value={formData.type}
                                onValueChange={(value: EventFormData['type']) => setFormData({ ...formData, type: value })}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {eventTypes.map((type) => (
                                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit-date">Date *</Label>
                                <Input
                                    id="edit-date"
                                    type="date"
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-time">Time</Label>
                                <Input
                                    id="edit-time"
                                    type="time"
                                    value={formData.time}
                                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="edit-location">Location</Label>
                            <Input
                                id="edit-location"
                                placeholder="Enter location"
                                value={formData.location}
                                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="edit-description">Description</Label>
                            <Textarea
                                id="edit-description"
                                placeholder="Enter event description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            setFormData(initialFormData)
                            setSelectedEvent(null)
                            setIsEditDialogOpen(false)
                        }}>
                            Cancel
                        </Button>
                        <Button onClick={handleEditEvent}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Event</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this event: {selectedEvent?.title}? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => {
                            setSelectedEvent(null)
                            setIsDeleteDialogOpen(false)
                        }}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteEvent}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete Event
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
