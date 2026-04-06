import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export interface FeedbackTeacherOption {
    teacher_id: string
    teacher_name: string
    subject_name: string
    label: string
}

export interface StudentFeedbackItem {
    id: string
    feedback_type: string
    teacher_id?: string | null
    teacher_name?: string
    subject_name?: string | null
    rating: number
    message: string
    is_anonymous: boolean
    status: 'pending' | 'responded'
    response_text?: string | null
    responded_at?: string | null
    created_at: string
}

interface FeedbackOptionsResponse {
    teachers: FeedbackTeacherOption[]
}

interface FeedbackListResponse {
    feedback: StudentFeedbackItem[]
}

export interface CreateStudentFeedbackPayload {
    feedback_type: 'teacher'
    teacher_id: string
    subject_name?: string
    rating: number
    message: string
    is_anonymous: boolean
}

export function useStudentFeedbackOptions(enabled = true) {
    return useQuery({
        queryKey: ['student-feedback-options'],
        enabled,
        queryFn: () => api.getOrEmpty<FeedbackOptionsResponse>('/student/feedback/options', { teachers: [] }),
        staleTime: 60 * 1000,
    })
}

export function useStudentFeedbackHistory(limit = 50, enabled = true) {
    return useQuery({
        queryKey: ['student-feedback-history', limit],
        enabled,
        queryFn: () => api.getOrEmpty<FeedbackListResponse>(`/student/feedback?limit=${limit}`, { feedback: [] }),
    })
}

export function useSubmitStudentFeedback() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (payload: CreateStudentFeedbackPayload) => api.post<{ id: string; message: string }>('/student/feedback', payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['student-feedback-history'] })
            queryClient.invalidateQueries({ queryKey: ['student-feedback-options'] })
            toast.success('Feedback submitted successfully')
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Failed to submit feedback'
            toast.error('Feedback submission failed', { description: message })
        },
    })
}

