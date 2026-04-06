import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface School {
    id: string;
    name: string;
    slug?: string;
    code?: string;
    address?: string;
    contact_email?: string;
    is_active: boolean;
    created_at: string;
    deleted_at?: string;
    deleted_by?: string;
    deleted_by_name?: string;
    admin_count?: number; // Optional, if backend provides it
    stats?: {
        students: number;
        teachers: number;
        staff: number;
        admins: number;
    };
}

interface SchoolsResponse {
    schools: School[];
}

export interface SchoolsPageResponse {
    schools: School[];
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
    next_page: number;
}

export interface AdminParams {
    name: string;
    email: string;
    password: string;
}

export interface CreateSchoolParams {
    name: string;
    code?: string;
    address?: string;
    contact_email?: string;
    admins: AdminParams[];
    password: string; // Super admin password verification
}

export function useSchools(enabled: boolean = true) {
    return useQuery({
        queryKey: ['schools'],
        queryFn: async () => {
            const response = await api.get<SchoolsResponse>('/super-admin/schools');
            return response.schools;
        },
        enabled,
        staleTime: 2 * 60_000,
        refetchInterval: 30_000,
    });
}

export function useInfiniteSchools(enabled: boolean = true) {
    return useInfiniteQuery({
        queryKey: ['schools-infinite'],
        queryFn: async ({ pageParam = 1 }) => {
            const params = new URLSearchParams({ page: String(pageParam), page_size: '50' });
            return api.get<SchoolsPageResponse>(`/super-admin/schools?${params.toString()}`);
        },
        getNextPageParam: (lastPage) => {
            return lastPage.has_more ? lastPage.next_page : undefined;
        },
        initialPageParam: 1,
        enabled,
        staleTime: 2 * 60_000,
        refetchInterval: 30_000,
    });
}


export function useSchool(idOrSlug: string, enabled: boolean = true) {
    return useQuery({
        queryKey: ['school', idOrSlug],
        queryFn: async () => {
            return api.get<School>(`/super-admin/schools/${idOrSlug}`);
        },
        enabled: !!idOrSlug && enabled,
        staleTime: 20_000,
        refetchInterval: 30_000,
    });
}

export interface User {
    id: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    created_at: string;
    department?: string;
    phone?: string;
}

interface UsersResponse {
    users: User[];
    total: number;
    page: number;
    page_size: number;
}

export function useSchoolUsers(schoolId: string, role?: string, enabled: boolean = true) {
    return useQuery({
        queryKey: ['school-users', schoolId, role],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (role) params.append('role', role);
            params.append('school_id', schoolId); // Backend expects school_id for Super Admin

            return api.get<UsersResponse>(`/admin/users?${params.toString()}`);
        },
        enabled: !!schoolId && enabled,
        staleTime: 30_000,
    });
}

export function useInfiniteSchoolUsers(schoolId: string, role?: string, pageSize: number = 50, enabled: boolean = true) {
    return useInfiniteQuery({
        queryKey: ['school-users-infinite', schoolId, role, pageSize],
        queryFn: async ({ pageParam = 1 }) => {
            const params = new URLSearchParams();
            if (role) params.append('role', role);
            params.append('school_id', schoolId);
            params.append('page', pageParam.toString());
            params.append('page_size', pageSize.toString());

            return api.get<UsersResponse>(`/admin/users?${params.toString()}`);
        },
        getNextPageParam: (lastPage) => {
            const totalPages = Math.ceil(lastPage.total / lastPage.page_size);
            return lastPage.page < totalPages ? lastPage.page + 1 : undefined;
        },
        initialPageParam: 1,
        enabled: !!schoolId && enabled,
        staleTime: 30_000,
    });
}

export interface CreateUserParams {
    email: string;
    full_name: string;
    password?: string;
    role: string;
    school_id?: string;
    phone?: string;
}

export function useCreateUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateUserParams) => {
            const params = new URLSearchParams();
            if (data.school_id) params.append('school_id', data.school_id);
            const qs = params.toString();
            return api.post(`/admin/users${qs ? `?${qs}` : ''}`, data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['school-users'] });
            queryClient.invalidateQueries({ queryKey: ['school-users-infinite'] });
            queryClient.invalidateQueries({ queryKey: ['school'] });
            toast.success('User created successfully');
        },
        onError: (error: any) => {
            toast.error('Failed to create user', { description: error.message });
        }
    });
}

export interface UpdateUserParams {
    id: string;
    email?: string;
    full_name?: string;
    password?: string;
    phone?: string;
    is_active?: boolean;
    school_id?: string;
}

export function useUpdateUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, school_id, ...data }: UpdateUserParams) => {
            const params = new URLSearchParams();
            if (school_id) params.append('school_id', school_id);
            const qs = params.toString();
            return api.put(`/admin/users/${id}${qs ? `?${qs}` : ''}`, data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['school-users'] });
            queryClient.invalidateQueries({ queryKey: ['school-users-infinite'] });
            queryClient.invalidateQueries({ queryKey: ['school'] });
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
        mutationFn: ({ userId, schoolId }: { userId: string; schoolId?: string }) => {
            const params = new URLSearchParams();
            if (schoolId) params.append('school_id', schoolId);
            const qs = params.toString();
            return api.delete(`/admin/users/${userId}${qs ? `?${qs}` : ''}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['school-users'] });
            queryClient.invalidateQueries({ queryKey: ['school-users-infinite'] });
            queryClient.invalidateQueries({ queryKey: ['school'] });
            toast.success('User deleted successfully');
        },
        onError: (error: any) => {
            if (error.message === 'user_not_found') {
                queryClient.invalidateQueries({ queryKey: ['school-users'] });
                queryClient.invalidateQueries({ queryKey: ['school-users-infinite'] });
                queryClient.invalidateQueries({ queryKey: ['school'] });
                return;
            }
            toast.error('Failed to delete user', { description: error.message });
        }
    });
}

export interface UpdateSchoolParams {
    id: string;
    name: string;
    code?: string;
    address?: string;
    contact_email?: string;
}

export function useUpdateSchool() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...data }: UpdateSchoolParams) =>
            api.put<School>(`/super-admin/schools/${id}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schools'] });
            queryClient.invalidateQueries({ queryKey: ['schools-infinite'] });
            toast.success('School updated successfully');
        },
        onError: (error: any) => {
            const message = error.message || 'Failed to update school';
            toast.error('Failed to update school', { description: message });
        },
    });
}

export function useCreateSchool() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateSchoolParams) => api.post('/super-admin/schools', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schools'] });
            queryClient.invalidateQueries({ queryKey: ['schools-infinite'] });
            toast.success('School created successfully');
        },
        onError: (error: any) => {
            const message = error.message || 'Failed to create school'
            toast.error('Failed to create school', { description: message });
        }
    });
}

export function useDeleteSchool() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ schoolId, password }: { schoolId: string; password: string }) =>
            api.delete(`/super-admin/schools/${schoolId}`, { body: JSON.stringify({ password }) }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schools'] });
            queryClient.invalidateQueries({ queryKey: ['schools-infinite'] });
            queryClient.invalidateQueries({ queryKey: ['deleted-schools'] });
            toast.success('School moved to trash', {
                description: 'Can be restored within 24 hours'
            });
        },
        onError: (error: any) => {
            const message = error.message || 'Failed to delete school'
            toast.error('Failed to delete school', { description: message });
        }
    });
}

export function useDeletedSchools(enabled: boolean = true) {
    return useQuery({
        queryKey: ['deleted-schools'],
        queryFn: async () => {
            const response = await api.get<SchoolsResponse>('/super-admin/schools/trash');
            return response.schools;
        },
        enabled,
        staleTime: 25_000,
        refetchInterval: 30_000,
    });
}

export function useRestoreSchool() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ schoolId, password }: { schoolId: string; password: string }) =>
            api.post(`/super-admin/schools/${schoolId}/restore`, { password }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schools'] });
            queryClient.invalidateQueries({ queryKey: ['deleted-schools'] });
            toast.success('School restored successfully');
        },
        onError: (error: any) => {
            const message = error.message || 'Failed to restore school'
            toast.error('Failed to restore school', { description: message });
        }
    });
}
