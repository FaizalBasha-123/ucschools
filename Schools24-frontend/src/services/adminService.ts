import { api } from '@/lib/api';
import { Event, InventoryItem } from '@/types';

export interface AdminDashboardData {
    total_users: number;
    total_students: number;
    total_teachers: number;
    total_classes: number;
    fee_collection?: {
        total_due: number;
        total_collected: number;
        total_pending: number;
        total_overdue: number;
        collection_rate_percent: number;
    };
    attendance_stats?: {
        today_present: number;
        today_absent: number;
        today_late: number;
        week_average_percent: number;
        month_average_percent: number;
    };
    recent_activity: unknown[];
    upcoming_events: Event[];
    inventory_alerts: InventoryItem[];
}

export interface RevenueChartPoint {
    label: string;
    revenue: number;
}

export interface FinanceChartResponse {
    period: string;
    data: RevenueChartPoint[];
}

export interface RecentPayment {
    id: string;
    student_id: string;
    student_fee_id?: string;
    amount: number;
    payment_method: string;
    transaction_id?: string;
    receipt_number: string;
    payment_date: string;
    status: string;
    notes?: string;
    purpose?: string;
    collected_by?: string;
    created_at: string;
    student_name: string;
    collector_name: string;
}

export interface StudentLeaderboardItem {
    rank: number;
    student_id: string;
    name: string;
    admission_number: string;
    roll_number?: string;
    class_name: string;
    section?: string;
    combined_score_pct: number;
    avg_assessment_pct: number;
    assessments_with_scores: number;
    avg_quiz_pct: number;
    quizzes_attempted: number;
    total_quizzes: number;
}

export interface TeacherLeaderboardItem {
    rank: number;
    teacher_id: string;
    name: string;
    employee_id: string;
    department: string;
    rating: number;
    students_count: number;
    status: string;
    assignments_count: number;
    graded_records_count: number;
    average_student_score: number;
    trend: 'up' | 'down' | 'stable';
    composite_score: number;
    last_calculated_at: string;
}

interface StudentLeaderboardResponse {
    academic_year: string;
    items: StudentLeaderboardItem[];
    top_3: StudentLeaderboardItem[];
}

interface TeacherLeaderboardResponse {
    academic_year: string;
    items: TeacherLeaderboardItem[];
    top_3: TeacherLeaderboardItem[];
}

export const adminService = {
    getDashboardStats: async () => {
        return api.get<AdminDashboardData>('/admin/dashboard');
    },

    getUsers: async (page = 1, pageSize = 20, role = '', search = '') => {
        return api.get<Record<string, unknown>>(`/admin/users?page=${page}&page_size=${pageSize}&role=${role}&search=${search}`);
    },

    getStudentsLeaderboard: async (params: { schoolId?: string; classId?: string; academicYear?: string; search?: string; limit?: number; refresh?: boolean } = {}) => {
        const query = new URLSearchParams();
        if (params.schoolId) query.set('school_id', params.schoolId);
        if (params.classId) query.set('class_id', params.classId);
        if (params.academicYear) query.set('academic_year', params.academicYear);
        if (params.search) query.set('search', params.search);
        if (params.limit) query.set('limit', String(params.limit));
        if (params.refresh === false) query.set('refresh', 'false');
        return api.get<StudentLeaderboardResponse>(`/admin/leaderboards/students?${query.toString()}`);
    },

    getTeachersLeaderboard: async (params: { schoolId?: string; academicYear?: string; search?: string; limit?: number; refresh?: boolean } = {}) => {
        const query = new URLSearchParams();
        if (params.schoolId) query.set('school_id', params.schoolId);
        if (params.academicYear) query.set('academic_year', params.academicYear);
        if (params.search) query.set('search', params.search);
        if (params.limit) query.set('limit', String(params.limit));
        if (params.refresh === false) query.set('refresh', 'false');
        return api.get<TeacherLeaderboardResponse>(`/admin/leaderboards/teachers?${query.toString()}`);
    },

    refreshLeaderboards: async (academicYear?: string, schoolId?: string) => {
        const query = new URLSearchParams();
        if (schoolId) query.set('school_id', schoolId);
        return api.post<{ message: string; academic_year: string }>(
            `/admin/leaderboards/refresh${query.toString() ? `?${query.toString()}` : ''}`,
            { academic_year: academicYear || '' },
        );
    },

    getRevenueChart: async (period: 'week' | 'month' | 'year' = 'month') => {
        return api.get<FinanceChartResponse>(`/admin/finance/chart?period=${period}`);
    },

    getRecentPayments: async (limit = 5) => {
        return api.get<{ payments: RecentPayment[] }>(`/admin/payments?limit=${limit}`);
    },
};
