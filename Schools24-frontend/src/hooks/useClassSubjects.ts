import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ClassSubject {
    id: string
    global_subject_id?: string | null
    name: string
    code: string
    description?: string | null
    grade_levels?: number[]
    credits?: number
    is_optional?: boolean
    created_at?: string
}

export function useClassSubjects(classId: string | null, options: { enabled?: boolean } = {}) {
    const { enabled = true } = options

    return useQuery({
        queryKey: ['class-subjects', classId],
        queryFn: async () => {
            if (!classId) throw new Error('Class ID is required')
            return api.get<{ subjects: ClassSubject[] }>(`/admin/classes/${classId}/subjects`)
        },
        enabled: enabled && !!classId,
        staleTime: 2 * 60_000,
        refetchOnWindowFocus: false,
    })
}
