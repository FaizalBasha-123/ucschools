import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export interface FeeDemandApi {
    id: string
    student_id: string
    student_name: string
    admission_number: string
    class_name: string
    academic_year?: string
    purpose: string
    amount: number
    paid_amount: number
    due_date?: string
    last_payment_date?: string
    status: 'paid' | 'partial' | 'pending' | 'overdue'
    created_at: string
    updated_at: string
}

export interface FeeDemand {
    id: string
    studentId: string
    studentName: string
    admissionNumber: string
    className: string
    academicYear?: string
    purpose: string
    amount: number
    paidAmount: number
    dueDate?: string
    lastPaymentDate?: string
    status: 'paid' | 'partial' | 'pending' | 'overdue'
}

export interface FeeDemandResponse {
    items: FeeDemandApi[]
    total: number
    page: number
    page_size: number
}

export interface CreateFeeDemandInput {
    studentId: string
    purposeId: string
    amount: number
    dueDate?: string
    academicYear?: string
}

export interface RecordFeePaymentInput {
    studentId: string
    studentFeeId: string
    amount: number
    paymentMethod: string
    transactionId?: string
    purpose?: string
    notes?: string
}

export interface FeeDemandPurpose {
    id: string
    name: string
    created_at: string
    updated_at: string
}

interface FeeDemandPurposeResponse {
    purposes: FeeDemandPurpose[]
}

const formatDate = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().split('T')[0]
}

const mapFeeDemand = (item: FeeDemandApi): FeeDemand => ({
    id: item.id,
    studentId: item.student_id,
    studentName: item.student_name,
    admissionNumber: item.admission_number,
    className: item.class_name,
    academicYear: item.academic_year,
    purpose: item.purpose,
    amount: item.amount,
    paidAmount: item.paid_amount,
    dueDate: formatDate(item.due_date),
    lastPaymentDate: formatDate(item.last_payment_date),
    status: item.status,
})

const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return 'An error occurred'
}

export function useFeeDemands(
    schoolId: string | undefined,
    params: { search?: string; status?: string; academicYear?: string; pageSize?: number; enabled?: boolean } = {}
) {
    const { search = '', status = 'all', academicYear = '', pageSize = 20, enabled = true } = params

    return useInfiniteQuery({
        queryKey: ['fee-demands', schoolId, search, status, academicYear, pageSize],
        queryFn: async ({ pageParam = 1 }) => {
            const qs = new URLSearchParams()
            if (schoolId) qs.append('school_id', schoolId)
            if (search) qs.append('search', search)
            if (status) qs.append('status', status)
            if (academicYear) qs.append('academic_year', academicYear)
            qs.append('page', pageParam.toString())
            qs.append('page_size', pageSize.toString())
            const url = `/admin/fees/demands?${qs.toString()}`
            const res = await api.get<FeeDemandResponse>(url)
            return {
                ...res,
                items: res.items.map(mapFeeDemand),
            }
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            const totalPages = Math.ceil(lastPage.total / lastPage.page_size)
            return lastPage.page < totalPages ? lastPage.page + 1 : undefined
        },
        enabled,
        staleTime: 30_000,
        refetchInterval: 30_000,
    })
}

export function useCreateFeeDemand(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (data: CreateFeeDemandInput) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/fees/demands${params.toString() ? `?${params.toString()}` : ''}`
            return api.post(url, {
                student_id: data.studentId,
                purpose_id: data.purposeId,
                amount: data.amount,
                due_date: data.dueDate || null,
                academic_year: data.academicYear || null,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fee-demands', schoolId] })
            toast.success('Fee demand created')
        },
        onError: (error: unknown) => {
            toast.error('Failed to create fee demand', {
                description: getErrorMessage(error),
            })
        },
    })
}

export function useFeeDemandPurposes(schoolId?: string, enabled = true) {
    return useQuery({
        queryKey: ['fee-demand-purposes', schoolId],
        enabled,
        queryFn: async () => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/fees/purposes${params.toString() ? `?${params.toString()}` : ''}`
            return api.get<FeeDemandPurposeResponse>(url)
        },
        staleTime: 5 * 60 * 1000,
    })
}

export function useCreateFeeDemandPurpose(schoolId?: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (name: string) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/fees/purposes${params.toString() ? `?${params.toString()}` : ''}`
            return api.post(url, { name })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fee-demand-purposes', schoolId] })
            toast.success('Purpose created')
        },
        onError: (error: unknown) => {
            toast.error('Failed to create purpose', { description: getErrorMessage(error) })
        },
    })
}

export function useUpdateFeeDemandPurpose(schoolId?: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: { id: string; name: string }) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/fees/purposes/${payload.id}${params.toString() ? `?${params.toString()}` : ''}`
            return api.put(url, { name: payload.name })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fee-demand-purposes', schoolId] })
            toast.success('Purpose updated')
        },
        onError: (error: unknown) => {
            toast.error('Failed to update purpose', { description: getErrorMessage(error) })
        },
    })
}

export function useDeleteFeeDemandPurpose(schoolId?: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: string) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/fees/purposes/${id}${params.toString() ? `?${params.toString()}` : ''}`
            return api.delete(url)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fee-demand-purposes', schoolId] })
            toast.success('Purpose deleted')
        },
        onError: (error: unknown) => {
            toast.error('Failed to delete purpose', { description: getErrorMessage(error) })
        },
    })
}

export function useRecordFeePayment(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (data: RecordFeePaymentInput) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/fees/payments${params.toString() ? `?${params.toString()}` : ''}`
            return api.post(url, {
                student_id: data.studentId,
                student_fee_id: data.studentFeeId,
                amount: data.amount,
                payment_method: data.paymentMethod,
                transaction_id: data.transactionId || null,
                notes: data.notes || null,
                purpose: data.purpose || null,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fee-demands', schoolId] })
            toast.success('Payment recorded')
        },
        onError: (error: unknown) => {
            toast.error('Failed to record payment', {
                description: getErrorMessage(error),
            })
        },
    })
}
