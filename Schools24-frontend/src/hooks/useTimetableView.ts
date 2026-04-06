import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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

export interface TimetableEntry {
    id: string
    class_id: string
    day_of_week: number
    period_number: number
    subject_id?: string | null
    teacher_id?: string | null
    start_time: string
    end_time: string
    room_number?: string | null
    academic_year: string
    subject_name?: string
    teacher_name?: string
    class_name?: string
}

export interface TeacherClassAssignment {
    id: string
    class_id: string
    class_name: string
    subject_name?: string
}

export function useTeacherTimetableConfig() {
    return useQuery({
        queryKey: ['teacher-timetable-config'],
        queryFn: () => api.get<{ config: { days: TimetableDayConfig[]; periods: TimetablePeriodConfig[] } }>(`/teacher/timetable/config`),
    })
}

export function useTeacherTimetable(_academicYear: string) {
    return useQuery({
        queryKey: ['teacher-timetable'],
        queryFn: () => api.get<{ timetable: TimetableEntry[] }>(`/teacher/timetable`),
    })
}

export function useTeacherClassTimetable(classId: string, _academicYear: string, options: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: ['teacher-class-timetable', classId],
        queryFn: () => api.get<{ timetable: TimetableEntry[] }>(`/teacher/timetable/classes/${classId}`),
        enabled: options.enabled,
    })
}

export function useStudentTimetableConfig() {
    return useQuery({
        queryKey: ['student-timetable-config'],
        queryFn: () => api.getOrEmpty<{ config: { days: TimetableDayConfig[]; periods: TimetablePeriodConfig[] } }>(
            '/academic/timetable/config',
            { config: { days: [], periods: [] } }
        ),
    })
}

export function useStudentTimetable() {
    return useQuery({
        queryKey: ['student-timetable'],
        queryFn: () => api.getOrEmpty<{ timetable: Array<{ day_of_week: number; day_name: string; periods: TimetableEntry[] }> }>(
            '/academic/timetable',
            { timetable: [] }
        ),
    })
}

export function useTeacherClasses() {
    return useQuery({
        queryKey: ['teacher-classes'],
        queryFn: () => api.get<{ classes: TeacherClassAssignment[] }>(`/teacher/classes`),
    })
}
