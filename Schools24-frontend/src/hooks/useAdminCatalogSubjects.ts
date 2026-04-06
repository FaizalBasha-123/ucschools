import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface AdminCatalogSubject {
    id: string
    name: string
    code: string
}

export function useAdminCatalogSubjects(options: { enabled?: boolean } = {}) {
    const { enabled = true } = options

    return useQuery({
        queryKey: ['admin-catalog-subjects'],
        queryFn: () => api.get<{ subjects: AdminCatalogSubject[] }>('/admin/catalog/subjects'),
        enabled,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    })
}

