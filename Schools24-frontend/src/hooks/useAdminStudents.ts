import { useInfiniteQuery, useMutation, useQueryClient, InfiniteData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

// Define Student type based on backend response
export interface Student {
    id: string;
    user_id: string;
    full_name: string;
    email: string;
    admission_number: string;
    roll_number?: string;
    class_id?: string;
    class_name?: string;
    section?: string;
    parent_name?: string;
    parent_phone?: string;
    parent_email?: string;
    admission_date?: string;
    academic_year?: string;
    bus_route_id?: string | null;
    transport_mode?: string;
    gender: string;
    date_of_birth: string;
    blood_group?: string;
    address?: string;
    emergency_contact?: string;
    current_grade?: string;  // Academic performance grade: A+, A, B+, B, C, D, F, or X
    attendance_stats?: {
        attendance_percent: number;
        total_days?: number;
        present_days?: number;
    };
    fees?: {
        status: 'paid' | 'partial' | 'pending';
        paid: number;
        total: number;
    };
}

interface StudentsResponse {
    students: Student[];
    total: number;
    page: number;
    page_size: number;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'An unexpected error occurred';
}

export function useStudents(
    search: string = '',
    pageSize: number = 20,
    schoolId?: string,
    options: { enabled?: boolean; classId?: string; classIds?: string[] } = {}
) {
    const { user, isLoading } = useAuth();
    const isSuperAdmin = user?.role === 'super_admin';

    // For super admin: use provided schoolId or their school_id
    // For regular admin: backend will automatically scope to their school via JWT
    const resolvedSchoolId = isSuperAdmin ? (schoolId || user?.school_id) : undefined;

    // Regular admins can always load, super admins need a school specified
    const canLoad = !isLoading && (user?.role === 'admin' || user?.role === 'super_admin');

    const classId = options.classId?.trim();
    const classIds = (options.classIds || []).map((id) => id.trim()).filter(Boolean)

    return useInfiniteQuery({
        queryKey: ['students', search, pageSize, resolvedSchoolId, classId, classIds.join(',')],
        queryFn: async ({ pageParam = 1 }) => {
            const params = new URLSearchParams();
            if (search) params.append('search', search);
            params.append('page', pageParam.toString());
            params.append('page_size', pageSize.toString());
            if (classIds.length > 0) params.append('class_ids', classIds.join(','));
            else if (classId) params.append('class_id', classId);
            // Only super admins need to pass school_id explicitly
            if (isSuperAdmin && resolvedSchoolId) params.append('school_id', resolvedSchoolId);
            return api.get<StudentsResponse>(`/admin/students-list?${params.toString()}`);
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            const totalPages = Math.ceil(lastPage.total / lastPage.page_size);
            return lastPage.page < totalPages ? lastPage.page + 1 : undefined;
        },
        enabled: options.enabled ?? canLoad,
        staleTime: 30_000,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });
}

export function useStudentMutations() {
    const queryClient = useQueryClient();

    const updateStudentMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<Student> }) => {
            return api.put(`/admin/students/${id}`, data);
        },
        // Optimistic update: merge changes into cached pages immediately so the
        // table row reflects the new values before the server responds.
        onMutate: async ({ id, data }) => {
            await queryClient.cancelQueries({ queryKey: ['students'] });
            const previousData = queryClient.getQueriesData<InfiniteData<StudentsResponse>>({ queryKey: ['students'] });
            queryClient.setQueriesData<InfiniteData<StudentsResponse>>(
                { queryKey: ['students'] },
                (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        pages: old.pages.map(page => ({
                            ...page,
                            students: page.students.map(s =>
                                s.id === id ? { ...s, ...data } : s
                            ),
                        })),
                    };
                }
            );
            return { previousData };
        },
        onError: (error: unknown, _vars, context) => {
            // Roll back on failure
            if (context?.previousData) {
                context.previousData.forEach(([key, data]) => {
                    queryClient.setQueryData(key, data);
                });
            }
            toast.error('Failed to update student', { description: getErrorMessage(error) });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            toast.success('Student updated successfully');
        },
    });

    const deleteStudentMutation = useMutation({
        mutationFn: async (id: string) => {
            return api.delete(`/admin/students/${id}`);
        },
        // Optimistic update: remove student from cached pages immediately.
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ['students'] });
            const previousData = queryClient.getQueriesData<InfiniteData<StudentsResponse>>({ queryKey: ['students'] });
            queryClient.setQueriesData<InfiniteData<StudentsResponse>>(
                { queryKey: ['students'] },
                (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        pages: old.pages.map(page => ({
                            ...page,
                            total: Math.max(0, page.total - 1),
                            students: page.students.filter(s => s.id !== id),
                        })),
                    };
                }
            );
            return { previousData };
        },
        onError: (error: unknown, _id, context) => {
            if (context?.previousData) {
                context.previousData.forEach(([key, data]) => {
                    queryClient.setQueryData(key, data);
                });
            }
            toast.error('Failed to delete student', { description: getErrorMessage(error) });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            toast.success('Student deleted successfully');
        },
    });

    return {
        updateStudent: updateStudentMutation.mutateAsync,
        deleteStudent: deleteStudentMutation.mutateAsync,
        isUpdating: updateStudentMutation.isPending,
        isDeleting: deleteStudentMutation.isPending
    };
}

export interface CreateStudentPayload {
    full_name: string;
    email: string;
    password: string;
    phone?: string;
    class_id: string;
    section?: string;
    roll_number?: string;
    admission_number?: string;
    date_of_birth?: string;
    gender?: string;
    academic_year?: string;
    parent_name?: string;
    parent_phone?: string;
    parent_email?: string;
    address?: string;
    school_id?: string;
}

export function useCreateStudent() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateStudentPayload) => api.post<{ student_id: string }>('/admin/students', data),
        // Optimistic add: inject a placeholder row immediately so the table grows
        // before the server confirms. The server response invalidation will replace it.
        onMutate: async (data) => {
            await queryClient.cancelQueries({ queryKey: ['students'] });
            const previousData = queryClient.getQueriesData<InfiniteData<StudentsResponse>>({ queryKey: ['students'] });
            const placeholder: Student = {
                id: `optimistic-${Date.now()}`,
                user_id: '',
                full_name: data.full_name,
                email: data.email,
                admission_number: data.admission_number || '',
                class_id: data.class_id,
                class_name: undefined,
                section: data.section,
                gender: data.gender || '',
                date_of_birth: data.date_of_birth || '',
                academic_year: data.academic_year,
                parent_name: data.parent_name,
                parent_phone: data.parent_phone,
                parent_email: data.parent_email,
                address: data.address,
            };
            queryClient.setQueriesData<InfiniteData<StudentsResponse>>(
                { queryKey: ['students'] },
                (old) => {
                    if (!old) return old;
                    const firstPage = old.pages[0];
                    return {
                        ...old,
                        pages: [
                            { ...firstPage, total: firstPage.total + 1, students: [placeholder, ...firstPage.students] },
                            ...old.pages.slice(1),
                        ],
                    };
                }
            );
            return { previousData };
        },
        onError: (error: unknown, _data, context) => {
            if (context?.previousData) {
                context.previousData.forEach(([key, data]) => {
                    queryClient.setQueryData(key, data);
                });
            }
            toast.error('Failed to add student', { description: getErrorMessage(error) });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            toast.success('Student added successfully');
        },
    });
}
