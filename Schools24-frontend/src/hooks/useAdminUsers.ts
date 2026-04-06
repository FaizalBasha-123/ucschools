import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface AdminUser {
    id: string;
    user_id?: string; // for staff: the actual user UUID (non_teaching_staff.user_id)
    email: string;
    full_name: string;
    role: 'super_admin' | 'admin' | 'teacher' | 'student' | 'staff';
    phone?: string;
    created_at: string;
    created_by?: string; // UUID of admin who created this account
    created_by_name?: string; // Name of admin who created this account
    last_login?: string;
    avatar?: string;
    department?: string;
    designation?: string;
    is_suspended?: boolean;
    suspended_at?: string;
    class_name?: string;
    roll_number?: string;
    parent_name?: string;
    parent_phone?: string;
    salary?: number;
}

interface UsersResponse {
    users: AdminUser[];
    total: number;
    page: number;
    page_size: number;
}

export interface UserStats {
    total: number;
    admins: number;
    teachers: number;
    students: number;
    staff: number;
}

interface CreateUserParams {
    email: string;
    full_name: string;
    role: string;
    phone?: string;
    password?: string; // Optional (auto-generated if empty)
    class_id?: string; // For students: optional class assignment at creation time
}

interface UpdateUserParams {
    id: string;
    email?: string;
    full_name?: string;
    role?: string;
    phone?: string;
    password?: string;
}

export function useUsers(role: string = 'all', search: string = '', pageSize: number = 20, enabled: boolean = true) {
    return useInfiniteQuery({
        queryKey: ['users', role, search, pageSize],
        queryFn: async ({ pageParam = 1 }) => {
            const params = new URLSearchParams();
            if (role && role !== 'all') params.append('role', role);
            if (search) params.append('search', search);
            params.append('page', pageParam.toString());
            params.append('page_size', pageSize.toString());
            return api.get<UsersResponse>(`/admin/users?${params.toString()}`);
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const totalPages = Math.ceil(lastPage.total / lastPage.page_size);
            const nextPage = allPages.length + 1;
            return nextPage <= totalPages ? nextPage : undefined;
        },
        enabled,
        staleTime: 0,
        refetchInterval: 30_000,
    });
}

export function useUserStats() {
    return useQuery({
        queryKey: ['user-stats'],
        queryFn: () => api.get<UserStats>('/admin/stats/users'),
        staleTime: 30_000,
        refetchInterval: 30_000,
    });
}

export function useCreateUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateUserParams) => api.post('/admin/users', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast.success('User created successfully');
        },
        onError: (error: any) => {
            toast.error('Failed to create user', { description: error.message });
        }
    });
}

export function useUpdateUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...data }: UpdateUserParams) => api.put(`/admin/users/${id}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast.success('User updated successfully');
        },
        onError: (error: any) => {
            toast.error('Failed to update user', { description: error.message });
        }
    });
}

export function useDeleteUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast.success('User deleted successfully');
        },
        onError: (error: any) => {
            if (error.message === 'user_not_found') {
                // Already deleted, treat as success
                queryClient.invalidateQueries({ queryKey: ['users'] });
                return;
            }
            toast.error('Failed to delete user', { description: error.message });
        }
    });
}

export function useSuspendUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, password }: { id: string; password: string }) =>
            api.put(`/admin/users/${id}/suspend`, { password }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            toast.success('User suspended. They can no longer log in.');
        },
        onError: (error: any) => {
            if (error.message === 'invalid_password') {
                toast.error('Incorrect password', { description: 'Please verify your password and try again.' });
            } else {
                toast.error('Failed to suspend user', { description: error.message });
            }
        }
    });
}

export function useUnsuspendUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, password }: { id: string; password: string }) =>
            api.put(`/admin/users/${id}/unsuspend`, { password }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            queryClient.invalidateQueries({ queryKey: ['staff'] });
            toast.success('Suspension lifted. User can now log in again.');
        },
        onError: (error: any) => {
            if (error.message === 'invalid_password') {
                toast.error('Incorrect password', { description: 'Please verify your password and try again.' });
            } else {
                toast.error('Failed to lift suspension', { description: error.message });
            }
        }
    });
}
