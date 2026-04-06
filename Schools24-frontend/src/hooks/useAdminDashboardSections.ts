/**
 * useAdminDashboardSections
 *
 * Four focused hooks for the admin-dashboard live sections:
 *  • useAdminWeeklyAttendance  — GET /admin/attendance/weekly
 *  • useAdminAssessmentLeaderboard — GET /admin/leaderboards/assessments
 *  • useAdminRevenueChart — GET /admin/finance/chart?period=
 *  • useAdminRecentPayments — GET /admin/payments?limit=
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { FinanceChartResponse, RecentPayment } from '@/services/adminService'

// ─── Weekly Attendance ────────────────────────────────────────────────────────

export interface WeeklyAttendanceDayItem {
    day: string      // e.g. "Mon", "Tue"
    present: number
    absent: number
}

export interface WeeklyAttendanceSummary {
    week_start: string
    week_end: string
    days: WeeklyAttendanceDayItem[]
}

export function useAdminWeeklyAttendance(schoolId?: string) {
    return useQuery<WeeklyAttendanceSummary>({
        queryKey: ['adminWeeklyAttendance', schoolId],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (schoolId) params.set('school_id', schoolId)
            return api.get<WeeklyAttendanceSummary>(
                `/admin/attendance/weekly${params.toString() ? `?${params}` : ''}`
            )
        },
        staleTime: 5 * 60 * 1000, // 5 min
        refetchInterval: 2 * 60_000,
    })
}

// ─── Assessment Leaderboard ───────────────────────────────────────────────────

export interface AdminAssessmentLeaderboardItem {
    rank: number
    student_id: string
    name: string
    class_name: string
    avg_assessment_pct: number
    assessments_with_scores: number
}

export interface AdminAssessmentLeaderboardResponse {
    academic_year: string
    total_items: number
    items: AdminAssessmentLeaderboardItem[]
}

export function useAdminAssessmentLeaderboard(params?: {
    limit?: number
    academicYear?: string
    schoolId?: string
}) {
    return useQuery<AdminAssessmentLeaderboardResponse>({
        queryKey: ['adminAssessmentLeaderboard', params],
        queryFn: async () => {
            const q = new URLSearchParams()
            if (params?.limit) q.set('limit', String(params.limit))
            if (params?.academicYear) q.set('academic_year', params.academicYear)
            if (params?.schoolId) q.set('school_id', params.schoolId)
            return api.get<AdminAssessmentLeaderboardResponse>(
                `/admin/leaderboards/assessments${q.toString() ? `?${q}` : ''}`
            )
        },
        staleTime: 5 * 60 * 1000,
        refetchInterval: 2 * 60_000,
    })
}

// ─── Revenue Chart ─────────────────────────────────────────────────────────────

export function useAdminRevenueChart(period: 'week' | 'month' | 'quarter' | 'year' = 'month') {
    return useQuery<FinanceChartResponse>({
        queryKey: ['adminRevenueChart', period],
        queryFn: () =>
            api.get<FinanceChartResponse>(`/admin/finance/chart?period=${period}`),
        staleTime: 2 * 60 * 1000, // 2 min
        refetchInterval: 2 * 60_000,
    })
}

// ─── Recent Payments ──────────────────────────────────────────────────────────

export function useAdminRecentPayments(limit = 5) {
    return useQuery<{ payments: RecentPayment[] }>({
        queryKey: ['adminRecentPayments', limit],
        queryFn: () =>
            api.get<{ payments: RecentPayment[] }>(`/admin/payments?limit=${limit}`),
        staleTime: 1 * 60 * 1000, // 1 min
        refetchInterval: 30_000,
    })
}

// ─── Class Distribution ────────────────────────────────────────────────────────

export interface ClassDistributionItem {
    name: string
    grade: number
    student_count: number
}

export interface ClassDistributionResponse {
    items: ClassDistributionItem[]
}

export function useAdminClassDistribution() {
    return useQuery<ClassDistributionResponse>({
        queryKey: ['adminClassDistribution'],
        queryFn: () =>
            api.get<ClassDistributionResponse>('/admin/reports/class-distribution'),
        staleTime: 5 * 60 * 1000,
        refetchInterval: 5 * 60_000,
    })
}
