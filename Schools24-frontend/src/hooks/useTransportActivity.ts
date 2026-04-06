import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface RouteActivityDay {
    day: string         // "YYYY-MM-DD" IST local date
    records: number
    avg_speed: number   // km/h
    max_speed: number   // km/h
    first_ping: number | null  // Unix ms
    last_ping: number | null   // Unix ms
}

export interface RouteActivity {
    route_id: string
    route_number: string
    vehicle_number: string
    driver_name: string
    total_records: number
    active_days: number
    avg_speed: number
    max_speed: number
    last_seen: number | null    // Unix ms, null if never tracked
    daily: RouteActivityDay[]
}

interface RoutesActivityResponse {
    routes: RouteActivity[]
}

export function useTransportActivity(schoolId?: string, options: { enabled?: boolean; isLive?: boolean } = {}) {
    return useQuery({
        queryKey: ['transport-activity', schoolId],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (schoolId) params.append('school_id', schoolId)
            const qs = params.toString()
            const data = await api.get<RoutesActivityResponse>(
                `/admin/transport/routes-activity${qs ? `?${qs}` : ''}`
            )
            return data.routes ?? []
        },
        // When a tracking session is live we want fresh counts quickly.
        // Backend merges the Valkey buffer so each fetch reflects the current session.
        staleTime: options.isLive ? 10_000 : 2 * 60_000,
        refetchInterval: options.isLive ? 30_000 : 5 * 60_000,
        enabled: options.enabled !== false,
    })
}
