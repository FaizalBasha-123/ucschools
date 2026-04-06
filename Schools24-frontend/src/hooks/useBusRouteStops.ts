import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { BusRouteStop, BusRouteStopInput, BusRouteShape, BusStopAssignment, BusStopAssignmentInput } from '@/types';

interface StopsResponse {
    stops: BusRouteStop[];
}

interface AssignmentsResponse {
    assignments: BusStopAssignment[];
}

export function useGetRouteStops(routeId: string | null, schoolId?: string) {
    return useQuery<BusRouteStop[]>({
        queryKey: ['bus-route-stops', routeId, schoolId],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (schoolId) params.append('school_id', schoolId);
            const qs = params.toString();
            const res = await api.get<StopsResponse>(`/admin/bus-routes/${routeId}/stops${qs ? `?${qs}` : ''}`);
            return res.stops ?? [];
        },
        enabled: !!routeId,
        staleTime: 2 * 60_000,
    });
}

export function useUpdateRouteStops() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ routeId, stops, schoolId }: { routeId: string; stops: BusRouteStopInput[]; schoolId?: string }) => {
            const params = new URLSearchParams();
            if (schoolId) params.append('school_id', schoolId);
            const qs = params.toString();
            return api.put(`/admin/bus-routes/${routeId}/stops${qs ? `?${qs}` : ''}`, { stops });
        },
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['bus-route-stops', vars.routeId] });
            toast.success('GPS stops saved');
        },
        onError: (err: any) => {
            toast.error('Failed to save stops', { description: err.message });
        },
    });
}

export function useUpdateRouteShape() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            routeId,
            shape,
            schoolId,
        }: {
            routeId: string;
            shape: Omit<BusRouteShape, 'route_id' | 'school_id'>;
            schoolId?: string;
        }) => {
            const params = new URLSearchParams();
            if (schoolId) params.append('school_id', schoolId);
            const qs = params.toString();
            return api.put(`/admin/bus-routes/${routeId}/shape${qs ? `?${qs}` : ''}`, shape);
        },
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['bus-route-stops', vars.routeId] });
        },
        onError: (err: any) => {
            toast.error('Failed to save route shape', { description: err.message });
        },
    });
}

export function useGetStopAssignments(routeId: string | null, schoolId?: string) {
    return useQuery<BusStopAssignment[]>({
        queryKey: ['bus-stop-assignments', routeId, schoolId],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (schoolId) params.append('school_id', schoolId);
            const qs = params.toString();
            const res = await api.get<AssignmentsResponse>(`/admin/bus-routes/${routeId}/stop-assignments${qs ? `?${qs}` : ''}`);
            return res.assignments ?? [];
        },
        enabled: !!routeId,
        staleTime: 2 * 60_000,
    });
}

export function useUpdateStopAssignments() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ routeId, assignments, schoolId }: { routeId: string; assignments: BusStopAssignmentInput[]; schoolId?: string }) => {
            const params = new URLSearchParams();
            if (schoolId) params.append('school_id', schoolId);
            const qs = params.toString();
            return api.put(`/admin/bus-routes/${routeId}/stop-assignments${qs ? `?${qs}` : ''}`, { assignments });
        },
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['bus-stop-assignments', vars.routeId] });
            toast.success('Stop assignments saved');
        },
        onError: (err: any) => {
            toast.error('Failed to save stop assignments', { description: err.message });
        },
    });
}
