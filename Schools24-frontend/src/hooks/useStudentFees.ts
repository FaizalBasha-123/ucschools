import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface StudentFeeBreakdownItem {
    id: string
    purpose_id?: string | null
    purpose_name: string
    amount: number
    paid_amount: number
    status: 'paid' | 'partial' | 'pending' | 'overdue'
    due_date?: string | null
}

export interface StudentPaymentHistoryItem {
    id: string
    amount: number
    payment_method: string
    payment_date: string
    status: string
    receipt_number: string
    transaction_id?: string | null
    purpose?: string | null
    student_fee_id?: string | null
}

export interface StudentFeesResponse {
    student_id: string
    academic_year: string
    total_amount: number
    paid_amount: number
    pending_amount: number
    breakdown: StudentFeeBreakdownItem[]
    payment_history: StudentPaymentHistoryItem[]
}

export function useStudentFees(enabled = true) {
    return useQuery({
        queryKey: ['student-fees'],
        enabled,
        queryFn: () => api.getOrEmpty<StudentFeesResponse>('/student/fees', {
            student_id: '', academic_year: '', total_amount: 0, paid_amount: 0,
            pending_amount: 0, breakdown: [], payment_history: [],
        }),
        staleTime: 30 * 1000,
    })
}
