import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Staff } from '@/types';

interface StaffResponse {
    staff: Staff[];
    total: number;
    page: number;
    page_size: number;
}

export function useStaff(search: string = '', pageSize: number = 20, schoolId?: string, designation?: string, options: { enabled?: boolean } = {}) {
    return useInfiniteQuery({
        queryKey: ['staff', search, pageSize, schoolId, designation],
        queryFn: async ({ pageParam = 1 }) => {
            const params = new URLSearchParams();
            if (search) params.append('search', search);
            if (schoolId) params.append('school_id', schoolId);
            if (designation) params.append('designation', designation);
            params.append('page', pageParam.toString());
            params.append('page_size', pageSize.toString());
            return api.get<StaffResponse>(`/admin/staff?${params.toString()}`);
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            const totalPages = Math.ceil(lastPage.total / lastPage.page_size);
            return lastPage.page < totalPages ? lastPage.page + 1 : undefined;
        },
        enabled: options.enabled,
        staleTime: 0,
        refetchInterval: 30_000,
    });
}

export function useCreateStaff() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: any) => api.post('/admin/staff', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            queryClient.invalidateQueries({ queryKey: ['school'] });
            toast.success('Staff member added successfully');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Failed to create staff');
        }
    });
}

export function useUpdateStaff() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data, schoolId }: { id: string; data: any; schoolId?: string }) => {
            const params = new URLSearchParams();
            if (schoolId) params.append('school_id', schoolId);
            const url = `/admin/staff/${id}${params.toString() ? `?${params.toString()}` : ''}`;
            return api.put(url, data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            queryClient.refetchQueries({ queryKey: ['staff'] });
            queryClient.invalidateQueries({ queryKey: ['school'] });
            toast.success('Staff member updated successfully');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Failed to update staff');
        }
    });
}

export function useDeleteStaff() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, staffType, schoolId }: { id: string; staffType: string; schoolId?: string }) => {
            const params = new URLSearchParams();
            params.append('type', staffType);
            if (schoolId) params.append('school_id', schoolId);
            return api.delete(`/admin/staff/${id}?${params.toString()}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            queryClient.invalidateQueries({ queryKey: ['school'] });
            toast.success('Staff member deleted successfully');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.error || 'Failed to delete staff');
        }
    });
}
