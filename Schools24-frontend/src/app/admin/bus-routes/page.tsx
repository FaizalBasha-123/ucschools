"use client"

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Search,
    Plus,
    Bus,
    MapPin,
    Phone,
    User,
    Edit,
    Trash2,
    Clock,
    Users,
    Route,
    Navigation,
    FileSpreadsheet,
    RefreshCw,
    Loader2,
    AlertTriangle,
    Info
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { BusRoute } from '@/types'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { useBusRoutes, useCreateBusRoute, useDeleteBusRoute, useUpdateBusRoute } from '@/hooks/useBusRoutes'
import { useStaff } from '@/hooks/useAdminStaff'
import { useAuth } from '@/contexts/AuthContext'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import { TrackBusDialog } from '@/components/transport/TrackBusDialog'
import { StopsBuilder } from '@/components/transport/StopsBuilder'
import { StopAssignmentManager } from '@/components/transport/StopAssignmentManager'

interface RouteFormData {
    routeNumber: string
    vehicleNumber: string
    driverStaffId: string
    capacity: number
    stops: string
}

const initialFormData: RouteFormData = {
    routeNumber: '',
    vehicleNumber: '',
    driverStaffId: '',
    capacity: 40,
    stops: '',
}

export default function BusRoutesPage() {
    const searchParams = useSearchParams()
    const { user } = useAuth()
    const isSuperAdmin = user?.role === 'super_admin'
    const schoolId = searchParams.get('school_id') || undefined
    const canLoadRoutes = !isSuperAdmin || !!schoolId

    const [searchQuery, setSearchQuery] = useState('')
    const [driverSearch, setDriverSearch] = useState('')

    // Dialog states
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [trackingRoute, setTrackingRoute] = useState<BusRoute | null>(null)
    const [stopsBuilderRoute, setStopsBuilderRoute] = useState<BusRoute | null>(null)
    const [assignmentManagerRoute, setAssignmentManagerRoute] = useState<BusRoute | null>(null)

    // Form data
    const [formData, setFormData] = useState<RouteFormData>(initialFormData)
    const [selectedRoute, setSelectedRoute] = useState<BusRoute | null>(null)

    const {
        data,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage
    } = useBusRoutes(searchQuery, isSuperAdmin ? schoolId : undefined, {
        enabled: canLoadRoutes,
    })
    const createRoute = useCreateBusRoute()
    const updateRoute = useUpdateBusRoute()
    const deleteRoute = useDeleteBusRoute()

    const routes = useMemo(() => data?.pages.flatMap(page => page.routes) || [], [data])
    const filteredRoutes = useMemo(() => {
        return [...routes].sort((a, b) => (a.routeNumber || '').localeCompare((b.routeNumber || ''), undefined, { numeric: true, sensitivity: 'base' }))
    }, [routes])
    const fetchTriggerIndex = filteredRoutes.length > 0 ? Math.max(0, Math.floor(filteredRoutes.length * 0.8) - 1) : -1

    // Infinite Scroll
    const { ref: loadMoreRef, inView } = useIntersectionObserver({ threshold: 0.1 })

    useEffect(() => {
        if (inView && hasNextPage && !isFetchingNextPage) {
            fetchNextPage()
        }
    }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

    const { data: staffData, isLoading: staffLoading } = useStaff(
        driverSearch,
        20,
        schoolId,
        'Driver',
        { enabled: (isAddDialogOpen || isEditDialogOpen) && (!isSuperAdmin || !!schoolId) }
    )

    const driverOptions = useMemo(() => {
        return (staffData?.pages.flatMap(page => page.staff) || []).filter(d => !!d)
    }, [staffData])

    const selectedDriver = useMemo(() => {
        return driverOptions.find(d => d.id === formData.driverStaffId)
    }, [driverOptions, formData.driverStaffId])

    const stats = {
        totalRoutes: routes.length,
        totalStudents: routes.reduce((sum, r) => sum + (r.currentStudents || 0), 0),
        totalCapacity: routes.reduce((sum, r) => sum + (r.capacity || 0), 0),
        totalStops: routes.reduce((sum, r) => sum + (r.stops?.length || 0), 0),
    }

    const parseStops = (stopsText: string): { name: string; time: string }[] => {
        return stopsText
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                const parts = line.split('-').map(p => p.trim())
                return {
                    name: parts[0] || '',
                    time: parts[1] || '07:00 AM',
                }
            })
    }

    const stopsToText = (stops: { name: string; time: string }[]): string => {
        return stops.map(s => `${s.name} - ${s.time}`).join('\n')
    }

    const handleAddRoute = () => {
        if (!formData.routeNumber || !formData.vehicleNumber || !formData.driverStaffId) {
            toast.error('Please fill in all required fields', {
                description: 'Route number, vehicle number, and driver are required.',
            })
            return
        }

        createRoute.mutate({
            payload: {
                route_number: formData.routeNumber,
                vehicle_number: formData.vehicleNumber,
                driver_staff_id: formData.driverStaffId,
                capacity: formData.capacity,
                stops: parseStops(formData.stops),
            },
            schoolId: isSuperAdmin ? schoolId : undefined,
        }, {
            onSuccess: () => {
                setFormData(initialFormData)
                setIsAddDialogOpen(false)
            }
        })
    }

    const handleEditRoute = () => {
        if (!selectedRoute) return

        if (!formData.routeNumber || !formData.vehicleNumber || !formData.driverStaffId) {
            toast.error('Please fill in all required fields', {
                description: 'Route number, vehicle number, and driver are required.',
            })
            return
        }

        updateRoute.mutate({
            id: selectedRoute.id,
            payload: {
                route_number: formData.routeNumber,
                vehicle_number: formData.vehicleNumber,
                driver_staff_id: formData.driverStaffId,
                capacity: formData.capacity,
                stops: parseStops(formData.stops),
            },
            schoolId: isSuperAdmin ? schoolId : undefined,
        }, {
            onSuccess: () => {
                setFormData(initialFormData)
                setSelectedRoute(null)
                setIsEditDialogOpen(false)
            }
        })
    }

    const handleDeleteRoute = () => {
        if (!selectedRoute) return

        deleteRoute.mutate({
            id: selectedRoute.id,
            schoolId: isSuperAdmin ? schoolId : undefined,
        }, {
            onSuccess: () => {
                setSelectedRoute(null)
                setIsDeleteDialogOpen(false)
            }
        })
    }

    const openEditDialog = (route: BusRoute) => {
        setSelectedRoute(route)
        setFormData({
            routeNumber: route.routeNumber,
            vehicleNumber: route.vehicleNumber,
            driverStaffId: route.driverStaffId || '',
            capacity: route.capacity,
            stops: stopsToText(route.stops),
        })
        setIsEditDialogOpen(true)
    }

    const openDeleteDialog = (route: BusRoute) => {
        setSelectedRoute(route)
        setIsDeleteDialogOpen(true)
    }

    const handleExport = () => {
        const csvContent = [
            ['Route Number', 'Vehicle Number', 'Driver Name', 'Driver Phone', 'Capacity', 'Current Students', 'Stops'].join(','),
            ...routes.map(r => [
                r.routeNumber,
                r.vehicleNumber,
                r.driverName,
                r.driverPhone,
                r.capacity,
                r.currentStudents,
                r.stops.map(s => `${s.name} (${s.time})`).join('; ')
            ].join(','))
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'bus-routes.csv'
        a.click()

        toast.success('Export completed', {
            description: 'Bus routes data has been exported to CSV.',
        })
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                        Bus Routes Management
                    </h1>
                    <p className="text-muted-foreground mt-1">Manage school bus routes, drivers, and schedules</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3 w-full sm:w-auto">
                    <Button variant="outline" onClick={handleExport} disabled={!canLoadRoutes} className="w-full h-9 px-3 text-xs sm:text-sm">
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                    <Dialog
                        open={isAddDialogOpen}
                        onOpenChange={(open) => {
                            setIsAddDialogOpen(open)
                            if (open) {
                                setDriverSearch('')
                            }
                        }}
                    >
                        <DialogTrigger asChild>
                            <Button
                                disabled={!canLoadRoutes}
                                className="w-full h-9 px-3 text-xs sm:text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-90 border-0 shadow-lg shadow-indigo-500/25"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add Route
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Bus className="h-5 w-5 text-indigo-500" />
                                    Add New Bus Route
                                </DialogTitle>
                                <DialogDescription>
                                    Create a new bus route with driver and stop details.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="add-routeNumber">Route Number *</Label>
                                        <Input
                                            id="add-routeNumber"
                                            placeholder="e.g., R-001"
                                            value={formData.routeNumber}
                                            onChange={(e) => setFormData({ ...formData, routeNumber: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="add-vehicleNumber">Vehicle Number *</Label>
                                        <Input
                                            id="add-vehicleNumber"
                                            placeholder="e.g., DL-01-AB-1234"
                                            value={formData.vehicleNumber}
                                            onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <div className="flex items-center gap-1.5">
                                            <Label htmlFor="add-driverName">Driver Name *</Label>
                                            <TooltipProvider delayDuration={100}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="max-w-[220px] text-xs">
                                                        Make sure to create a driver from &ldquo;Staff Management&rdquo; first.
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                        <Select
                                            value={formData.driverStaffId}
                                            onValueChange={(value) => setFormData({ ...formData, driverStaffId: value })}
                                        >
                                            <SelectTrigger id="add-driverName" className="w-full">
                                                <SelectValue placeholder="Select driver" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <div className="px-2 pb-2">
                                                    <Input
                                                        placeholder="Search drivers..."
                                                        value={driverSearch}
                                                        onChange={(e) => setDriverSearch(e.target.value)}
                                                    />
                                                </div>
                                                {staffLoading ? (
                                                    <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Loading drivers...
                                                    </div>
                                                ) : driverOptions.length === 0 ? (
                                                    <div className="px-3 py-2 text-sm text-muted-foreground">No drivers found</div>
                                                ) : (
                                                    driverOptions.map((driver) => (
                                                        <SelectItem key={driver.id} value={driver.id}>
                                                            {driver.name} {driver.designation ? `• ${driver.designation}` : ''}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="add-driverPhone">Driver Phone</Label>
                                        <Input
                                            id="add-driverPhone"
                                            placeholder="Auto-filled"
                                            value={selectedDriver?.phone || selectedRoute?.driverPhone || ''}
                                            readOnly
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="add-capacity">Capacity</Label>
                                        <Input
                                            id="add-capacity"
                                            type="number"
                                            placeholder="Enter bus capacity"
                                            value={formData.capacity}
                                            onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="add-stops">Stops (one per line: Stop Name - Time)</Label>
                                    <Textarea
                                        id="add-stops"
                                        placeholder="Green Park - 07:00 AM&#10;Hauz Khas - 07:15 AM&#10;Saket - 07:30 AM"
                                        rows={4}
                                        value={formData.stops}
                                        onChange={(e) => setFormData({ ...formData, stops: e.target.value })}
                                    />
                                </div>
                            </div>
                            <DialogFooter className="flex-col sm:flex-row gap-2">
                                <Button className="w-full sm:w-auto" variant="outline" onClick={() => {
                                    setFormData(initialFormData)
                                    setIsAddDialogOpen(false)
                                }}>
                                    Cancel
                                </Button>
                                <Button
                                    className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-violet-600"
                                    onClick={handleAddRoute}
                                >
                                    Create Route
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {isSuperAdmin && !schoolId && (
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-start gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                                <Route className="h-5 w-5" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-base font-semibold">Select a school to view routes</h3>
                                <p className="text-sm text-muted-foreground">
                                    As a Super Admin, you must provide a school context. Open a school from the
                                    Super Admin console or pass a school_id query parameter.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Stats Cards */}
            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-500 to-indigo-600">
                    <CardContent className="p-3 sm:p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm text-white flex-shrink-0">
                                <Bus className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-2xl sm:text-3xl font-bold leading-none text-white">{stats.totalRoutes}</p>
                                <p className="mt-1 text-xs sm:text-sm text-indigo-100 leading-tight">Total Routes</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-500 to-emerald-600">
                    <CardContent className="p-3 sm:p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm text-white flex-shrink-0">
                                <Users className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-2xl sm:text-3xl font-bold leading-none text-white">{stats.totalStudents}</p>
                                <p className="mt-1 text-xs sm:text-sm text-emerald-100 leading-tight">Total Students</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-amber-500 to-amber-600">
                    <CardContent className="p-3 sm:p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm text-white flex-shrink-0">
                                <Route className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-2xl sm:text-3xl font-bold leading-none text-white">{stats.totalCapacity}</p>
                                <p className="mt-1 text-xs sm:text-sm text-amber-100 leading-tight">Total Capacity</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-violet-500 to-violet-600">
                    <CardContent className="p-3 sm:p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm text-white flex-shrink-0">
                                <MapPin className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-2xl sm:text-3xl font-bold leading-none text-white">{stats.totalStops}</p>
                                <p className="mt-1 text-xs sm:text-sm text-violet-100 leading-tight">Total Stops</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Search and Filters */}
            <Card className="border-0 shadow-lg">
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 sm:gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search by route number, driver name, or vehicle..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 h-9"
                            />
                        </div>
                        <div className="flex flex-shrink-0">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 flex-shrink-0"
                                onClick={() => setSearchQuery('')}
                            >
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Routes Grid */}
            <div className="grid gap-4 md:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {!canLoadRoutes ? (
                    <Card className="border-0 shadow-lg">
                        <CardContent className="p-4 md:p-8 text-center text-muted-foreground">
                            Select a school to load bus routes.
                        </CardContent>
                    </Card>
                ) : isLoading ? (
                    <Card className="border-0 shadow-lg">
                        <CardContent className="p-4 md:p-8 flex items-center justify-center text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading routes...
                        </CardContent>
                    </Card>
                ) : (
                    filteredRoutes.map((route, index) => (
                        <Card
                            key={route.id}
                            ref={index === fetchTriggerIndex ? loadMoreRef : undefined}
                            className={`group border-0 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden stagger-${index + 1} animate-slide-up relative`}
                        >
                            {route.currentStudents > route.capacity && (
                                <Badge variant="destructive" className="absolute top-2 right-2 z-10 flex items-center gap-1 shadow-sm">
                                    <AlertTriangle className="h-3 w-3" />
                                    Capacity Exceeded
                                </Badge>
                            )}
                            {/* Card Header with gradient */}
                            <div className="p-4 bg-gradient-to-r from-indigo-500 to-violet-500">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                                            <Bus className="h-6 w-6 text-white" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-white">Route {route.routeNumber}</h3>
                                            <p className="text-sm text-white/80">{route.vehicleNumber}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <CardContent className="p-5 space-y-5">
                                {/* Driver Info */}
                                <div className="flex items-center gap-4 p-3 rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
                                        <User className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-semibold">{route.driverName}</p>
                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <Phone className="h-3 w-3" />
                                            <span>{route.driverPhone}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Capacity */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium flex items-center gap-2">
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                            Capacity
                                        </span>
                                        <span className="text-sm font-bold">
                                            {route.currentStudents}/{route.capacity} students
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <Progress
                                            value={(route.currentStudents / route.capacity) * 100}
                                            className="h-3 rounded-full"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground text-right">
                                        {Math.round((route.currentStudents / route.capacity) * 100)}% filled
                                    </p>
                                </div>

                                {/* Stops Timeline */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-sm font-medium flex items-center gap-2">
                                            <Route className="h-4 w-4 text-muted-foreground" />
                                            Stops
                                        </span>
                                        <Badge variant="secondary" className="text-xs">
                                            {route.stops.length} stops
                                        </Badge>
                                    </div>
                                    <div className="space-y-0 max-h-40 overflow-auto pr-2">
                                        {route.stops.map((stop, stopIndex) => (
                                            <div key={stopIndex} className="relative pl-6 pb-3 last:pb-0">
                                                {/* Timeline line */}
                                                {stopIndex !== route.stops.length - 1 && (
                                                    <div className="absolute left-[7px] top-3 bottom-0 w-0.5 bg-gradient-to-b from-indigo-500 to-violet-500" />
                                                )}
                                                {/* Timeline dot */}
                                                <div className={`absolute left-0 top-1 h-4 w-4 rounded-full border-2 ${stopIndex === 0
                                                    ? 'bg-indigo-500 border-indigo-500'
                                                    : stopIndex === route.stops.length - 1
                                                        ? 'bg-violet-500 border-violet-500'
                                                        : 'bg-card border-indigo-400'
                                                    }`} />
                                                {/* Stop info */}
                                                <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <MapPin className="h-3 w-3 text-muted-foreground" />
                                                        <span className="text-sm font-medium">{stop.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Clock className="h-3 w-3" />
                                                        <span>{stop.time}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 pt-2 border-t">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300"
                                        onClick={() => setTrackingRoute(route)}
                                    >
                                        <Navigation className="mr-2 h-4 w-4" />
                                        Track Bus
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-300"
                                        onClick={() => setStopsBuilderRoute(route)}
                                    >
                                        <MapPin className="mr-2 h-4 w-4" />
                                        GPS Stops
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300"
                                        onClick={() => setAssignmentManagerRoute(route)}
                                    >
                                        <Users className="mr-2 h-4 w-4" />
                                        Assign
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="hover:bg-slate-50 hover:text-slate-700"
                                        onClick={() => openEditDialog(route)}
                                    >
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="hover:bg-red-50 hover:text-red-600 hover:border-red-300"
                                        onClick={() => openDeleteDialog(route)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )))
                }
            </div>

            {isFetchingNextPage && (
                <div className="py-4 flex justify-center w-full">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Empty state */}
            {canLoadRoutes && !isLoading && filteredRoutes.length === 0 && (
                <Card className="border-0 shadow-lg">
                    <CardContent className="p-12 text-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mx-auto mb-4">
                            <Bus className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No routes found</h3>
                        <p className="text-muted-foreground mb-4">
                            Try adjusting your search or filter to find what you&apos;re looking for.
                        </p>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setSearchQuery('')
                            }}
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Clear filters
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Summary Footer */}
            <Card className="border-0 shadow-lg bg-gradient-to-r from-indigo-50 via-violet-50 to-purple-50 dark:from-indigo-950/30 dark:via-violet-950/30 dark:to-purple-950/30">
                <CardContent className="p-4 md:p-6">
                    <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white">
                                <Navigation className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="font-semibold">Fleet Overview</p>
                                <p className="text-sm text-muted-foreground">
                                    {stats.totalStudents} students across {stats.totalRoutes} routes
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 w-full md:w-auto">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.totalCapacity > 0 ? Math.round((stats.totalStudents / stats.totalCapacity) * 100) : 0}%</p>
                                <p className="text-xs text-muted-foreground">Fleet Utilization</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.totalRoutes}</p>
                                <p className="text-xs text-muted-foreground">Total Routes</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{stats.totalStops}</p>
                                <p className="text-xs text-muted-foreground">Total Stops</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Edit Dialog */}
            <Dialog
                open={isEditDialogOpen}
                onOpenChange={(open) => {
                    setIsEditDialogOpen(open)
                    if (open) {
                        setDriverSearch('')
                    }
                }}
            >
                <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Edit className="h-5 w-5 text-indigo-500" />
                            Edit Bus Route
                        </DialogTitle>
                        <DialogDescription>
                            Update the route details below.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit-routeNumber">Route Number *</Label>
                                <Input
                                    id="edit-routeNumber"
                                    placeholder="e.g., R-001"
                                    value={formData.routeNumber}
                                    onChange={(e) => setFormData({ ...formData, routeNumber: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-vehicleNumber">Vehicle Number *</Label>
                                <Input
                                    id="edit-vehicleNumber"
                                    placeholder="e.g., DL-01-AB-1234"
                                    value={formData.vehicleNumber}
                                    onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Label htmlFor="edit-driverName">Driver Name *</Label>
                                    <TooltipProvider delayDuration={100}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                                                Make sure to create a driver from &ldquo;Staff Management&rdquo; first.
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                <Select
                                    value={formData.driverStaffId}
                                    onValueChange={(value) => setFormData({ ...formData, driverStaffId: value })}
                                >
                                    <SelectTrigger id="edit-driverName" className="w-full">
                                        <SelectValue placeholder="Select driver" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <div className="px-2 pb-2">
                                            <Input
                                                placeholder="Search drivers..."
                                                value={driverSearch}
                                                onChange={(e) => setDriverSearch(e.target.value)}
                                            />
                                        </div>
                                        {staffLoading ? (
                                            <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Loading drivers...
                                            </div>
                                        ) : driverOptions.length === 0 ? (
                                            <div className="px-3 py-2 text-sm text-muted-foreground">No drivers found</div>
                                        ) : (
                                            driverOptions.map((driver) => (
                                                <SelectItem key={driver.id} value={driver.id}>
                                                    {driver.name} {driver.designation ? `• ${driver.designation}` : ''}
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-driverPhone">Driver Phone</Label>
                                <Input
                                    id="edit-driverPhone"
                                    placeholder="Auto-filled"
                                    value={selectedDriver?.phone || selectedRoute?.driverPhone || ''}
                                    readOnly
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit-capacity">Capacity</Label>
                                <Input
                                    id="edit-capacity"
                                    type="number"
                                    placeholder="Enter bus capacity"
                                    value={formData.capacity}
                                    onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                                />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="edit-stops">Stops (one per line: Stop Name - Time)</Label>
                            <Textarea
                                id="edit-stops"
                                placeholder="Green Park - 07:00 AM&#10;Hauz Khas - 07:15 AM&#10;Saket - 07:30 AM"
                                rows={4}
                                value={formData.stops}
                                onChange={(e) => setFormData({ ...formData, stops: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => {
                            setFormData(initialFormData)
                            setSelectedRoute(null)
                            setIsEditDialogOpen(false)
                        }}>
                            Cancel
                        </Button>
                        <Button
                            className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-violet-600"
                            onClick={handleEditRoute}
                        >
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Trash2 className="h-5 w-5 text-red-500" />
                            Delete Route
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <span className="font-semibold">Route {selectedRoute?.routeNumber}</span>?
                            This action cannot be undone and will affect {selectedRoute?.currentStudents} students currently assigned to this route.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => {
                            setSelectedRoute(null)
                            setIsDeleteDialogOpen(false)
                        }}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-500 hover:bg-red-600"
                            onClick={handleDeleteRoute}
                        >
                            Delete Route
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Live tracking dialog — opened by "Track Bus" button on each route card */}
            {trackingRoute && (
                <TrackBusDialog
                    open={!!trackingRoute}
                    onClose={() => setTrackingRoute(null)}
                    routeId={trackingRoute.id}
                    routeNumber={trackingRoute.routeNumber}
                    vehicleNumber={trackingRoute.vehicleNumber}
                    driverName={trackingRoute.driverName}
                />
            )}

            {/* GPS Stops builder — opened by "GPS Stops" button on each route card */}
            {stopsBuilderRoute && (
                <StopsBuilder
                    open={!!stopsBuilderRoute}
                    onClose={() => setStopsBuilderRoute(null)}
                    routeId={stopsBuilderRoute.id}
                    routeNumber={stopsBuilderRoute.routeNumber}
                    schoolId={isSuperAdmin ? schoolId : undefined}
                />
            )}

            {/* Stop assignment manager — opened by "Assign" button on each route card */}
            {assignmentManagerRoute && (
                <StopAssignmentManager
                    open={!!assignmentManagerRoute}
                    onClose={() => setAssignmentManagerRoute(null)}
                    routeId={assignmentManagerRoute.id}
                    routeNumber={assignmentManagerRoute.routeNumber}
                    schoolId={isSuperAdmin ? schoolId : undefined}
                />
            )}
        </div>
    )
}

