import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  acceptDemoRequest,
  DemoRequestListParams,
  getDemoRequestStats,
  listDemoRequests,
  trashDemoRequest,
} from '@/services/demoRequestService'

export function useDemoRequests(params: DemoRequestListParams, enabled: boolean = true) {
  return useQuery({
    queryKey: ['demo-requests', params],
    queryFn: () => listDemoRequests(params),
    enabled,
    staleTime: 30_000,
  })
}

export function useDemoRequestStats(year?: number, month?: number, enabled: boolean = true) {
  return useQuery({
    queryKey: ['demo-request-stats', year, month],
    queryFn: () => getDemoRequestStats(year, month),
    enabled,
    staleTime: 30_000,
  })
}

export function useAcceptDemoRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => acceptDemoRequest(id, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-requests'] })
      queryClient.invalidateQueries({ queryKey: ['demo-request-stats'] })
      queryClient.invalidateQueries({ queryKey: ['schools'] })
      queryClient.invalidateQueries({ queryKey: ['schools-infinite'] })
      toast.success('Demo request accepted', { description: 'The school has been created and the request has been marked as accepted.' })
    },
    onError: (error: any) => {
      toast.error('Failed to accept demo request', { description: error.message || 'Something went wrong.' })
    },
  })
}

export function useTrashDemoRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => trashDemoRequest(id, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['demo-requests'] })
      queryClient.invalidateQueries({ queryKey: ['demo-request-stats'] })
      toast.success('Demo request moved to trash', { description: 'The lead will be permanently deleted after 30 days.' })
    },
    onError: (error: any) => {
      toast.error('Failed to move demo request to trash', { description: error.message || 'Something went wrong.' })
    },
  })
}
