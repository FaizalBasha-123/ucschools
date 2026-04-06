import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface SchoolClass {
  id: string;
  name: string;
  grade: number | null; // null for custom catalog classes that have no numeric grade
  section?: string | null;
  academic_year: string;
  room_number?: string | null;
  total_students?: number;
  class_teacher_id?: string | null;
  class_teacher_name?: string;
}

interface ClassesResponse {
  classes: SchoolClass[];
}

interface CreateClassPayload {
  name: string;
  grade?: number | null; // optional: omit for custom catalog classes
  section?: string | null;
  academic_year: string;
  room_number?: string | null;
}

interface UpdateClassPayload {
  id: string;
  name?: string;
  grade?: number;
  section?: string | null;
  academic_year?: string;
  room_number?: string | null;
  class_teacher_id?: string | null;
}

export function useClasses(academicYear?: string) {
  return useQuery({
    queryKey: ['classes', academicYear],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (academicYear) params.append('academic_year', academicYear);
      const query = params.toString();
      return api.get<ClassesResponse>(`/classes${query ? `?${query}` : ''}`);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateClassPayload) => api.post('/classes', data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['classes', vars.academic_year] });
      toast.success('Class created');
    },
    onError: (error: any) => {
      toast.error('Failed to create class', { description: error.message });
    },
  });
}

export function useUpdateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateClassPayload) => api.put(`/classes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      toast.success('Class updated');
    },
    onError: (error: any) => {
      toast.error('Failed to update class', { description: error.message });
    },
  });
}

export function useDeleteClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/classes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      toast.success('Class deleted');
    },
    onError: (error: any) => {
      const message = error.message === 'class_has_students'
        ? 'Cannot delete class with assigned students.'
        : error.message;
      toast.error('Failed to delete class', { description: message });
    },
  });
}
