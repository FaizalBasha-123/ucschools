import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { BusRoute } from '@/types';

interface BusRoutesResponse {
  routes: BusRoute[];
  total: number;
  page: number;
  page_size: number;
}
// ... (keep intermediate interfaces if needed, but I'll define them inside or reuse)

interface ApiBusStop {
  name: string;
  time?: string;
  arrival_time?: string;
}

interface ApiBusRoute {
  id: string;
  route_number?: string;
  vehicle_number?: string;
  driver_staff_id?: string | null;
  driver_name?: string;
  driver_phone?: string;
  capacity?: number;
  current_students?: number;
  stops?: ApiBusStop[];
  routeNumber?: string;
  vehicleNumber?: string;
  driverStaffId?: string | null;
  driverName?: string;
  driverPhone?: string;
  currentStudents?: number;
}

const normalizeStops = (stops: ApiBusStop[] | undefined) =>
  (stops || []).map((stop) => ({
    name: stop.name,
    time: stop.time || stop.arrival_time || '',
  }));

const normalizeRoute = (route: ApiBusRoute): BusRoute => ({
  id: route.id,
  routeNumber: route.routeNumber || route.route_number || '',
  driverStaffId: route.driverStaffId || route.driver_staff_id || undefined,
  driverName: route.driverName || route.driver_name || '',
  driverPhone: route.driverPhone || route.driver_phone || '',
  vehicleNumber: route.vehicleNumber || route.vehicle_number || '',
  capacity: route.capacity ?? 0,
  currentStudents: route.currentStudents ?? route.current_students ?? 0,
  stops: normalizeStops(route.stops),
});

interface BusStopInput {
  name: string;
  time?: string;
}

interface BusRoutePayload {
  route_number: string;
  vehicle_number: string;
  driver_staff_id: string;
  capacity: number;
  stops: BusStopInput[];
}

export function useBusRoutes(search: string = '', schoolId?: string, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ['bus-routes', search, schoolId],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (schoolId) params.append('school_id', schoolId);
      params.append('page', pageParam.toString());
      params.append('page_size', '20');

      const response = await api.get<{ routes?: ApiBusRoute[] | null; total: number; page: number; page_size: number }>(`/admin/bus-routes${params.toString() ? `?${params.toString()}` : ''}`);
      const normalizedRoutes = (response.routes || []).map(normalizeRoute);
      return {
        routes: normalizedRoutes,
        total: response.total || 0,
        page: response.page || pageParam,
        page_size: response.page_size || 20
      };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const totalPages = Math.ceil(lastPage.total / lastPage.page_size);
      return lastPage.page < totalPages ? lastPage.page + 1 : undefined;
    },
    staleTime: 2 * 60_000,
    refetchInterval: 60_000,
    enabled: options.enabled,
  });
}

export function useCreateBusRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, schoolId }: { payload: BusRoutePayload; schoolId?: string }) => {
      const params = new URLSearchParams();
      if (schoolId) params.append('school_id', schoolId);
      const query = params.toString();
      return api.post(`/admin/bus-routes${query ? `?${query}` : ''}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bus-routes'] });
      toast.success('Bus route created');
    },
    onError: (error: any) => {
      toast.error('Failed to create bus route', { description: error.message });
    },
  });
}

export function useUpdateBusRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, schoolId }: { id: string; payload: BusRoutePayload; schoolId?: string }) => {
      const params = new URLSearchParams();
      if (schoolId) params.append('school_id', schoolId);
      const query = params.toString();
      return api.put(`/admin/bus-routes/${id}${query ? `?${query}` : ''}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bus-routes'] });
      toast.success('Bus route updated');
    },
    onError: (error: any) => {
      toast.error('Failed to update bus route', { description: error.message });
    },
  });
}

export function useDeleteBusRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, schoolId }: { id: string; schoolId?: string }) => {
      const params = new URLSearchParams();
      if (schoolId) params.append('school_id', schoolId);
      const query = params.toString();
      return api.delete(`/admin/bus-routes/${id}${query ? `?${query}` : ''}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bus-routes'] });
      toast.success('Bus route deleted');
    },
    onError: (error: any) => {
      toast.error('Failed to delete bus route', { description: error.message });
    },
  });
}
