import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { InventoryItem } from '@/types'

interface InventoryItemApi {
    id: string
    name: string
    category: string
    quantity: number
    unit: string
    min_stock: number
    location: string
    status: 'in-stock' | 'low-stock' | 'out-of-stock'
    last_updated: string
}

interface InventoryResponse {
    items: InventoryItemApi[]
    total: number
    page: number
    page_size: number
}

export interface CreateInventoryItemInput {
    name: string
    category: string
    quantity: number
    unit: string
    minStock: number
    location: string
}

const formatDate = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().split('T')[0]
}

const mapInventoryItem = (item: InventoryItemApi): InventoryItem => ({
    id: item.id,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit || 'pcs',
    minStock: item.min_stock ?? 0,
    location: item.location || '',
    lastUpdated: formatDate(item.last_updated),
    status: item.status,
})

interface InventoryFilters {
    search?: string
    category?: string
}

export function useInventoryItems(
    schoolId?: string,
    pageSize: number = 20,
    filters: InventoryFilters = {},
    options: { enabled?: boolean } = {}
) {
    const { enabled = true } = options
    const { search = '', category = 'all' } = filters

    return useInfiniteQuery({
        queryKey: ['inventory', schoolId, pageSize, search, category],
        queryFn: async ({ pageParam = 1 }) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            if (search.trim()) params.append('search', search.trim())
            if (category && category !== 'all') params.append('category', category)
            params.append('page', pageParam.toString())
            params.append('page_size', pageSize.toString())
            const url = `/admin/inventory${params.toString() ? `?${params.toString()}` : ''}`
            const res = await api.get<InventoryResponse>(url)
            return {
                ...res,
                items: (res.items ?? []).map(mapInventoryItem),
            }
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            const totalPages = Math.ceil(lastPage.total / lastPage.page_size)
            return lastPage.page < totalPages ? lastPage.page + 1 : undefined
        },
        enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    })
}

export function useCreateInventoryItem(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (data: CreateInventoryItemInput) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/inventory${params.toString() ? `?${params.toString()}` : ''}`
            return api.post(url, {
                name: data.name,
                category: data.category,
                quantity: data.quantity,
                unit: data.unit,
                min_stock: data.minStock,
                location: data.location,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory', schoolId] })
            toast.success('Item added to inventory')
        },
        onError: (error: any) => {
            toast.error('Failed to add item', {
                description: error.message || 'An error occurred',
            })
        },
    })
}

export function useDeleteInventoryItem(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (itemId: string) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/inventory/${itemId}${params.toString() ? `?${params.toString()}` : ''}`
            return api.delete(url)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory', schoolId] })
            toast.success('Item deleted')
        },
        onError: (error: any) => {
            toast.error('Failed to delete item', {
                description: error.message || 'An error occurred',
            })
        },
    })
}

export interface UpdateInventoryItemInput extends CreateInventoryItemInput {
    id: string
}

export function useUpdateInventoryItem(schoolId?: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (data: UpdateInventoryItemInput) => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const url = `/admin/inventory/${data.id}${params.toString() ? `?${params.toString()}` : ''}`
            return api.put(url, {
                name: data.name,
                category: data.category,
                quantity: data.quantity,
                unit: data.unit,
                min_stock: data.minStock,
                location: data.location,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory', schoolId] })
            toast.success('Item updated successfully')
        },
        onError: (error: any) => {
            toast.error('Failed to update item', {
                description: error.message || 'An error occurred',
            })
        },
    })
}
