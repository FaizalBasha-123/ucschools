import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface StudentAttendanceRecord {
    id: string
    student_id: string
    class_id: string
    date: string
    status: 'present' | 'absent' | 'late' | 'excused'
    marked_by?: string | null
    remarks?: string | null
    created_at: string
}

export interface StudentAttendanceStats {
    total_days: number
    present_days: number
    absent_days: number
    late_days: number
    attendance_percent: number
}

export interface StudentAttendanceResponse {
    attendance: StudentAttendanceRecord[]
    stats: StudentAttendanceStats | null
}

interface AttendanceQueryParams {
    startDate?: string
    endDate?: string
}

export function useStudentAttendance(params: AttendanceQueryParams = {}, enabled = true) {
    return useQuery({
        queryKey: ['student-attendance', params.startDate ?? '', params.endDate ?? ''],
        enabled,
        queryFn: () => {
            const query = new URLSearchParams()
            if (params.startDate) query.set('start_date', params.startDate)
            if (params.endDate) query.set('end_date', params.endDate)
            const suffix = query.toString() ? `?${query.toString()}` : ''
            return api.getOrEmpty<StudentAttendanceResponse>(`/student/attendance${suffix}`, { attendance: [], stats: null })
        },
        staleTime: 30 * 1000,
    })
}

