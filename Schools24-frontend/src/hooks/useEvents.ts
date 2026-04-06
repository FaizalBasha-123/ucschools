import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { api, ValidationError } from '@/lib/api'
import { toast } from 'sonner'

export interface EventApi {
    id: string
    school_id: string
    title: string
    description?: string
    event_date: string
    start_time?: string
    end_time?: string
    type: 'event' | 'exam' | 'holiday' | 'meeting' | 'sports'
    location?: string
    created_at: string
    updated_at: string
}

export interface EventItem {
    id: string
    title: string
    description?: string
    date: string
    time: string
    startTime?: string
    type: 'event' | 'exam' | 'holiday' | 'meeting' | 'sports'
    location?: string
}

export interface EventsResponse {
    events: EventApi[]
    total_count: number
    page: number
    page_size: number
}

export interface CreateEventInput {
    title: string
    type: 'event' | 'exam' | 'holiday' | 'meeting' | 'sports'
    date: string
    time?: string
    location?: string
    description?: string
}

export interface UpdateEventInput {
    id: string
    title?: string
    type?: 'event' | 'exam' | 'holiday' | 'meeting' | 'sports'
    date?: string
    time?: string
    location?: string
    description?: string
}

const formatDateOnly = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().split('T')[0]
}

const formatTimeInput = (value?: string) => {
    if (!value) return ''
    if (value.includes('T')) {
        const date = new Date(value)
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString().split('T')[1]?.slice(0, 5) || ''
        }
    }
    return value.slice(0, 5)
}

const formatDisplayTime = (value?: string) => {
    const time = formatTimeInput(value)
    if (!time) return 'All Day'

    const [hourStr, minuteStr] = time.split(':')
    const hour = Number(hourStr)
    if (Number.isNaN(hour)) return time

    const suffix = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 === 0 ? 12 : hour % 12
    return `${displayHour.toString().padStart(2, '0')}:${minuteStr} ${suffix}`
}

const mapEvent = (item: EventApi): EventItem => {
    const date = formatDateOnly(item.event_date)
    const startTime = formatTimeInput(item.start_time)

    return {
        id: item.id,
        title: item.title,
        description: item.description || undefined,
        date,
        startTime: startTime || undefined,
        time: formatDisplayTime(item.start_time),
        type: item.type,
        location: item.location || undefined,
    }
}

export function useEvents(
    schoolId: string | undefined,
    params: { type?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number; enabled?: boolean } = {}
) {
    const { type = '', startDate = '', endDate = '', page = 1, pageSize = 200, enabled = true } = params

    return useQuery({
        queryKey: ['events', schoolId, type, startDate, endDate, page, pageSize],
        queryFn: async () => {
            const qs = new URLSearchParams()
            if (schoolId) qs.append('school_id', schoolId)
            if (type) qs.append('type', type)
            if (startDate) qs.append('start_date', startDate)
            if (endDate) qs.append('end_date', endDate)
            qs.append('page', page.toString())
            qs.append('page_size', pageSize.toString())

            const res = await api.get<EventsResponse>(`/admin/events?${qs.toString()}`)
            return {
                ...res,
                events: res.events.map(mapEvent),
            }
        },
        enabled,
    })
}

type ApiErrorLike = { message?: string }

export function useStudentEvents(
    params: { type?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number; enabled?: boolean } = {}
) {
    const { type = '', startDate = '', endDate = '', page = 1, pageSize = 200, enabled = true } = params

    return useQuery({
        queryKey: ['student-events', type, startDate, endDate, page, pageSize],
        queryFn: async () => {
            const qs = new URLSearchParams()
            if (type) qs.append('type', type)
            if (startDate) qs.append('start_date', startDate)
            if (endDate) qs.append('end_date', endDate)
            qs.append('page', page.toString())
            qs.append('page_size', pageSize.toString())

            try {
                const res = await api.get<EventsResponse>(`/student/events?${qs.toString()}`)
                return { ...res, events: res.events.map(mapEvent) }
            } catch (e) {
                if (e instanceof ValidationError) return { events: [], total: 0, page: 1, page_size: pageSize, has_more: false }
                throw e
            }
        },
        enabled,
    })
}

export function useTeacherEvents(
    params: { type?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number; enabled?: boolean } = {}
) {
    const { type = '', startDate = '', endDate = '', page = 1, pageSize = 500, enabled = true } = params

    return useQuery({
        queryKey: ['teacher-events', type, startDate, endDate, page, pageSize],
        queryFn: async () => {
            const qs = new URLSearchParams()
            if (type) qs.append('type', type)
            if (startDate) qs.append('start_date', startDate)
            if (endDate) qs.append('end_date', endDate)
            qs.append('page', page.toString())
            qs.append('page_size', pageSize.toString())

            const res = await api.get<EventsResponse>(`/teacher/events?${qs.toString()}`)
            return {
                ...res,
                events: res.events.map(mapEvent),
            }
        },
        enabled,
    })
}

export function useInfiniteEvents(
    schoolId: string | undefined,
    params: { type?: string; startDate?: string; endDate?: string; pageSize?: number; enabled?: boolean } = {}
) {
    const { type = '', startDate = '', endDate = '', pageSize = 20, enabled = true } = params

    return useInfiniteQuery({
        queryKey: ['infinite-events', schoolId, type, startDate, endDate, pageSize],
        queryFn: async ({ pageParam = 1 }) => {
            const qs = new URLSearchParams()
            if (schoolId) qs.append('school_id', schoolId)
            if (type) qs.append('type', type)
            if (startDate) qs.append('start_date', startDate)
            if (endDate) qs.append('end_date', endDate)
            qs.append('page', pageParam.toString())
            qs.append('page_size', pageSize.toString())

            const res = await api.get<EventsResponse>(`/admin/events?${qs.toString()}`)
            return {
                ...res,
                events: res.events.map(mapEvent),
            }
        },
        getNextPageParam: (lastPage) => {
            if (lastPage.page * lastPage.page_size < lastPage.total_count) {
                return lastPage.page + 1
            }
            return undefined
        },
        initialPageParam: 1,
        enabled,
        staleTime: 2 * 60_000,
        refetchInterval: 60_000,
    })
}

export function useCreateEvent(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (data: CreateEventInput) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/events${params.toString() ? `?${params.toString()}` : ''}`

            return api.post(url, {
                title: data.title,
                type: data.type,
                event_date: data.date,
                start_time: data.time || null,
                description: data.description || null,
                location: data.location || null,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['events', schoolId] })
            queryClient.invalidateQueries({ queryKey: ['infinite-events', schoolId] })
            toast.success('Event created')
        },
        onError: (error: unknown) => {
            const err = error as ApiErrorLike
            toast.error('Failed to create event', {
                description: err.message || 'An error occurred',
            })
        },
    })
}

export function useUpdateEvent(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (data: UpdateEventInput) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/events/${data.id}${params.toString() ? `?${params.toString()}` : ''}`

            return api.put(url, {
                title: data.title,
                type: data.type,
                event_date: data.date,
                start_time: data.time || null,
                description: data.description || null,
                location: data.location || null,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['events', schoolId] })
            queryClient.invalidateQueries({ queryKey: ['infinite-events', schoolId] })
            toast.success('Event updated')
        },
        onError: (error: unknown) => {
            const err = error as ApiErrorLike
            toast.error('Failed to update event', {
                description: err.message || 'An error occurred',
            })
        },
    })
}

export function useDeleteEvent(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (eventId: string) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/events/${eventId}${params.toString() ? `?${params.toString()}` : ''}`
            return api.delete(url)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['events', schoolId] })
            queryClient.invalidateQueries({ queryKey: ['infinite-events', schoolId] })
            toast.success('Event deleted')
        },
        onError: (error: unknown) => {
            const err = error as ApiErrorLike
            toast.error('Failed to delete event', {
                description: err.message || 'An error occurred',
            })
        },
    })
}
