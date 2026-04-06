import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Teacher } from '@/types'

interface TeacherApi {
    id: string
    userId: string
    name: string
    email: string
    phone?: string | null
    avatar?: string | null
    employeeId: string
    department?: string
    subject_ids?: string[]
    designation?: string | null
    qualifications?: string[]
    subjects?: string[]
    classes?: string[]
    experience?: number | null
    joinDate?: string | null
    salary?: number | null
    rating?: number | null
    status?: 'active' | 'on-leave' | 'inactive' | null
}

interface TeachersResponse {
    teachers: TeacherApi[]
    total: number
    page: number
    page_size: number
}

type TeacherMutationPayload = Record<string, unknown>
type ApiErrorLike = { response?: { data?: { error?: string } } }

const getErrorMessage = (error: unknown, fallback: string) => {
    const apiError = error as ApiErrorLike
    return apiError?.response?.data?.error || fallback
}

const mapTeacher = (t: TeacherApi): Teacher => ({
    id: t.id,
    userId: t.userId,
    name: t.name,
    email: t.email,
    phone: t.phone || '',
    employeeId: t.employeeId,
    department: t.department || '',
    subjects: t.subjects || [],
    subjectIds: t.subject_ids || [],
    classes: t.classes || [],
    qualification: (t.qualifications && t.qualifications.length > 0) ? t.qualifications.join(', ') : '',
    experience: t.experience != null ? `${t.experience} years` : '',
    joinDate: t.joinDate || '',
    avatar: t.avatar || undefined,
    salary: t.salary || 0,
    rating: t.rating || 0,
    status: (t.status || 'active') as Teacher['status'],
})

export function useTeachers(
    search: string = '',
    pageSize: number = 20,
    schoolId?: string,
    status?: string,
    options: { enabled?: boolean } = {}
) {
    return useInfiniteQuery({
        queryKey: ['teachers', search, pageSize, schoolId, status],
        queryFn: async ({ pageParam = 1 }) => {
            const params = new URLSearchParams()
            if (search) params.append('search', search)
            if (schoolId) params.append('school_id', schoolId)
            if (status && status !== 'all') params.append('status', status)
            params.append('page', pageParam.toString())
            params.append('page_size', pageSize.toString())

            const res = await api.get<TeachersResponse>(`/admin/teachers?${params.toString()}`)
            return {
                ...res,
                teachers: (res.teachers ?? []).map(mapTeacher),
            }
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            const totalPages = Math.ceil(lastPage.total / lastPage.page_size)
            return lastPage.page < totalPages ? lastPage.page + 1 : undefined
        },
        enabled: options.enabled,
        staleTime: 30_000,
        refetchInterval: 30_000,
    })
}

export function useCreateTeacher() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ data, schoolId }: { data: TeacherMutationPayload; schoolId?: string }) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/teachers${params.toString() ? `?${params.toString()}` : ''}`
            return api.post(url, data)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teachers'] })
            queryClient.invalidateQueries({ queryKey: ['school'] })
            toast.success('Teacher added successfully')
        },
        onError: (error: unknown) => {
            toast.error(getErrorMessage(error, 'Failed to create teacher'))
        },
    })
}

export function useUpdateTeacher() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data, schoolId }: { id: string; data: TeacherMutationPayload; schoolId?: string }) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/teachers/${id}${params.toString() ? `?${params.toString()}` : ''}`
            return api.put(url, data)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teachers'] })
            queryClient.invalidateQueries({ queryKey: ['school'] })
            toast.success('Teacher updated successfully')
        },
        onError: (error: unknown) => {
            toast.error(getErrorMessage(error, 'Failed to update teacher'))
        },
    })
}

export function useDeleteTeacher() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, schoolId }: { id: string; schoolId?: string }) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/teachers/${id}${params.toString() ? `?${params.toString()}` : ''}`
            return api.delete(url)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teachers'] })
            queryClient.invalidateQueries({ queryKey: ['school'] })
            toast.success('Teacher deleted successfully')
        },
        onError: (error: unknown) => {
            toast.error(getErrorMessage(error, 'Failed to delete teacher'))
        },
    })
}
