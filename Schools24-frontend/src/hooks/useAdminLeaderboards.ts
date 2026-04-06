import { useQuery } from '@tanstack/react-query'
import { adminService } from '@/services/adminService'

export function useStudentsLeaderboard(params: {
    enabled?: boolean
    schoolId?: string
    classId?: string
    academicYear?: string
    search?: string
    limit?: number
}) {
    return useQuery({
        queryKey: ['admin-students-leaderboard', params.schoolId, params.classId, params.academicYear, params.search, params.limit],
        queryFn: () => adminService.getStudentsLeaderboard({
            schoolId: params.schoolId,
            classId: params.classId,
            academicYear: params.academicYear,
            search: params.search,
            limit: params.limit,
            refresh: true,
        }),
        enabled: params.enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    })
}

export function useTeachersLeaderboard(params: {
    enabled?: boolean
    schoolId?: string
    academicYear?: string
    search?: string
    limit?: number
}) {
    return useQuery({
        queryKey: ['admin-teachers-leaderboard', params.schoolId, params.academicYear, params.search, params.limit],
        queryFn: () => adminService.getTeachersLeaderboard({
            schoolId: params.schoolId,
            academicYear: params.academicYear,
            search: params.search,
            limit: params.limit,
            refresh: false,
        }),
        enabled: params.enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    })
}
