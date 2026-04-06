import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface TeacherLeaderboardEntry {
    rank: number
    teacher_id: string
    name: string
    department: string
    rating: number
    students_count: number
    status: string
    trend: 'up' | 'down' | 'stable'
}

export interface TeacherLeaderboardResponse {
    academic_year: string
    items: TeacherLeaderboardEntry[]
    top_3: TeacherLeaderboardEntry[]
    my_teacher_id: string
    my_rank: number
    my_rating: number
    my_students_count: number
    my_trend: 'up' | 'down' | 'stable'
}

export function useTeacherLeaderboard(params: { academicYear?: string; enabled?: boolean } = {}) {
    const query = new URLSearchParams()
    if (params.academicYear) query.set('academic_year', params.academicYear)

    return useQuery({
        queryKey: ['teacher-leaderboard', params.academicYear],
        queryFn: () => api.getOrEmpty<TeacherLeaderboardResponse>(
            `/teacher/leaderboard${query.toString() ? `?${query.toString()}` : ''}`,
            { academic_year: '', items: [], top_3: [], my_teacher_id: '', my_rank: 0, my_rating: 0, my_students_count: 0, my_trend: 'stable' }
        ),
        enabled: params.enabled ?? true,
    })
}
