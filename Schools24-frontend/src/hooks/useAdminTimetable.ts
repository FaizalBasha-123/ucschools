import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export interface TimetableDayConfig {
    day_of_week: number
    day_name: string
    is_active: boolean
}

export interface TimetablePeriodConfig {
    period_number: number
    start_time: string
    end_time: string
    is_break: boolean
    break_name?: string | null
}

export interface TimetableConfigResponse {
    config: {
        days: TimetableDayConfig[]
        periods: TimetablePeriodConfig[]
    }
}

export interface TimetableEntry {
    id: string
    class_id: string
    day_of_week: number
    period_number: number
    subject_id?: string | null
    global_subject_id?: string | null
    teacher_id?: string | null
    start_time: string
    end_time: string
    room_number?: string | null
    academic_year: string
    subject_name?: string
    teacher_name?: string
    class_name?: string
}

export interface TimetableConflictEntry {
    class_id: string
    class_name: string
    subject_name: string
    room_number?: string | null
}

export interface TimetableConflict {
    day_of_week: number
    day_name: string
    period_number: number
    start_time: string
    end_time: string
    entries: TimetableConflictEntry[]
}

export function useAdminTimetableConfig(schoolId?: string, options: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: ['timetable-config', schoolId],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            return api.get<TimetableConfigResponse>(`/admin/timetable/config${params.toString() ? `?${params.toString()}` : ''}`)
        },
        enabled: options.enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    })
}

export function useUpdateTimetableConfig() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ payload, schoolId }: { payload: { days: TimetableDayConfig[]; periods: TimetablePeriodConfig[] }; schoolId?: string }) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/timetable/config${params.toString() ? `?${params.toString()}` : ''}`
            return api.put(url, payload)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['timetable-config'] })
            queryClient.invalidateQueries({ queryKey: ['class-timetable'] })
            queryClient.invalidateQueries({ queryKey: ['teacher-timetable'] })
            toast.success('Timetable configuration updated')
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Failed to update timetable configuration')
        },
    })
}

export function useClassTimetable(classId: string, _academicYear: string, schoolId?: string, options: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: ['class-timetable', classId, schoolId],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            return api.get<{ timetable: TimetableEntry[] }>(`/admin/timetable/classes/${classId}${params.toString() ? `?${params.toString()}` : ''}`)
        },
        enabled: options.enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    })
}

export function useTeacherTimetable(teacherId: string, _academicYear: string, schoolId?: string, options: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: ['teacher-timetable', teacherId, schoolId],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            return api.get<{ timetable: TimetableEntry[]; conflicts: TimetableConflict[] }>(`/admin/timetable/teachers/${teacherId}${params.toString() ? `?${params.toString()}` : ''}`)
        },
        enabled: options.enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    })
}

export function useUpsertTimetableSlot() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ payload, schoolId }: { payload: any; schoolId?: string }) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/timetable/slots${params.toString() ? `?${params.toString()}` : ''}`
            return api.post(url, payload)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['class-timetable'] })
            queryClient.invalidateQueries({ queryKey: ['teacher-timetable'] })
            toast.success('Timetable slot updated')
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Failed to update timetable slot')
        },
    })
}

export function useDeleteTimetableSlot() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ classId, dayOfWeek, periodNumber, academicYear, schoolId }: { classId: string; dayOfWeek: number; periodNumber: number; academicYear: string; schoolId?: string }) => {
            const params = new URLSearchParams()
            params.append('class_id', classId)
            params.append('day_of_week', dayOfWeek.toString())
            params.append('period_number', periodNumber.toString())
            params.append('academic_year', academicYear)
            if (schoolId) params.append('school_id', schoolId)
            return api.delete(`/admin/timetable/slots?${params.toString()}`)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['class-timetable'] })
            queryClient.invalidateQueries({ queryKey: ['teacher-timetable'] })
            toast.success('Timetable slot deleted')
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Failed to delete timetable slot')
        },
    })
}
