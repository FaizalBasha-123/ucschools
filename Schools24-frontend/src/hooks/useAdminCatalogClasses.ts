import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface AdminCatalogClass {
  id: string
  name: string
  sort_order: number
}

interface AdminCatalogClassesResponse {
  classes: AdminCatalogClass[]
}

export function useAdminCatalogClasses(enabled = true) {
  return useQuery({
    queryKey: ['admin-catalog-classes'],
    enabled,
    queryFn: () => api.get<AdminCatalogClassesResponse>('/admin/catalog/classes'),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}

