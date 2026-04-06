import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Subject {
    id: string
    name: string
    code: string
    description?: string | null
    grade_levels?: number[]
    credits?: number
    is_optional?: boolean
}

export function useSubjects(options: { enabled?: boolean; schoolId?: string } = {}) {
    const { enabled, schoolId } = options

    return useQuery({
        queryKey: ['subjects', schoolId],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            return api.get<{ subjects: Subject[] }>(`/academic/subjects${params.toString() ? `?${params.toString()}` : ''}`)
        },
        enabled,
    })
}
