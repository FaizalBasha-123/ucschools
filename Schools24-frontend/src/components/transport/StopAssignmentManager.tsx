"use client"

/**
 * StopAssignmentManager — Manage student-to-stop assignments for a bus route.
 *
 * Displays a data table with drag-select for bulk reassignment or per-row editing.
 * Saves to PUT /admin/bus-routes/:id/stop-assignments.
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react'
import {
    ChevronDown,
    Loader2,
    MapPin,
    Plus,
    Search,
    Trash2,
    Users,
    X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useGetStopAssignments, useUpdateStopAssignments } from '@/hooks/useBusRouteStops'
import { useGetRouteStops } from '@/hooks/useBusRouteStops'
import { BusStopAssignmentInput, BusRouteStop, BusStopAssignment } from '@/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface StopAssignmentManagerProps {
    open: boolean
    onClose: () => void
    routeId: string
    routeNumber: string
    schoolId?: string
}

// Local edit state for a pending assignment
interface AssignmentEdit extends BusStopAssignmentInput {
    _key: string
    _studentName?: string
    _stopName?: string
    _isNew?: boolean
}

export function StopAssignmentManager({
    open,
    onClose,
    routeId,
    routeNumber,
    schoolId,
}: StopAssignmentManagerProps) {
    const { data: savedAssignments, isLoading: loadingAssignments } = useGetStopAssignments(
        open ? routeId : null,
        schoolId
    )
    const { data: stops } = useGetRouteStops(open ? routeId : null, schoolId)
    const updateAssignments = useUpdateStopAssignments()

    const [drafts, setDrafts] = useState<AssignmentEdit[]>([])
    const [searchStudents, setSearchStudents] = useState('')
    const [selectedStops, setSelectedStops] = useState<string[]>([])
    const [filterPickupOrDrop, setFilterPickupOrDrop] = useState<string>('all')

    // Load saved assignments into draft state
    useEffect(() => {
        if (open && savedAssignments) {
            setDrafts(
                savedAssignments.map(a => ({
                    _key: a.id,
                    student_id: a.student_id,
                    stop_id: a.stop_id,
                    pickup_or_drop: a.pickup_or_drop,
                    _studentName: a.student_name,
                    _stopName: a.stop_name,
                    _isNew: false,
                }))
            )
        }
        if (!open) {
            setDrafts([])
            setSearchStudents('')
            setSelectedStops([])
            setFilterPickupOrDrop('all')
        }
    }, [open, savedAssignments])

    // Filter visible assignments based on search/filter
    const visibleAssignments = useMemo(() => {
        return drafts.filter(a => {
            if (
                searchStudents &&
                !(a._studentName || '').toLowerCase().includes(searchStudents.toLowerCase())
            ) {
                return false
            }
            if (filterPickupOrDrop !== 'all' && a.pickup_or_drop !== filterPickupOrDrop) {
                return false
            }
            return true
        })
    }, [drafts, searchStudents, filterPickupOrDrop])

    // Remove an assignment
    const removeAssignment = useCallback((key: string) => {
        setDrafts(prev => prev.filter(d => d._key !== key))
    }, [])

    // Change stop for an assignment
    const setAssignmentStop = useCallback((key: string, stopId: string) => {
        setDrafts(prev =>
            prev.map(d => {
                if (d._key !== key) return d
                const stop = stops?.find(s => s.id === stopId)
                return {
                    ...d,
                    stop_id: stopId,
                    _stopName: stop?.stop_name,
                }
            })
        )
    }, [stops])

    // Change pickup/drop type
    const setPickupOrDrop = useCallback((key: string, value: string) => {
        setDrafts(prev =>
            prev.map(d =>
                d._key === key
                    ? { ...d, pickup_or_drop: value as 'pickup' | 'drop' | 'both' }
                    : d
            )
        )
    }, [])

    // Bulk reassign selected drafts to a single stop
    const bulkReassignToStop = useCallback((stopId: string) => {
        if (selectedStops.length === 0) {
            toast.error('No assignments selected')
            return
        }
        const stop = stops?.find(s => s.id === stopId)
        setDrafts(prev =>
            prev.map(d =>
                selectedStops.includes(d._key)
                    ? { ...d, stop_id: stopId, _stopName: stop?.stop_name }
                    : d
            )
        )
        setSelectedStops([])
        toast.success(`Reassigned ${selectedStops.length} assignment(s)`)
    }, [selectedStops, stops])

    // Save all assignments
    const handleSave = async () => {
        const payload: BusStopAssignmentInput[] = drafts.map(d => ({
            student_id: d.student_id,
            stop_id: d.stop_id,
            pickup_or_drop: d.pickup_or_drop,
        }))

        try {
            await updateAssignments.mutateAsync({ routeId, assignments: payload, schoolId })
            onClose()
        } catch {
            // Error toast already handled by mutation hook
        }
    }

    const pickupOrDropOptions = [
        { label: 'Pickup', value: 'pickup' },
        { label: 'Drop', value: 'drop' },
        { label: 'Both', value: 'both' },
    ]

    return (
        <Dialog open={open} onOpenChange={open => { if (!open) onClose() }}>
            <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
                <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-indigo-500" />
                        Stop Assignments — Route {routeNumber}
                    </DialogTitle>
                    <DialogDescription>
                        Assign students to pickup and drop stops. Use bulk reassign to move multiple at once.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
                    {/* Search + Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search student name…"
                                value={searchStudents}
                                onChange={e => setSearchStudents(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <Select value={filterPickupOrDrop} onValueChange={setFilterPickupOrDrop}>
                            <SelectTrigger>
                                <SelectValue placeholder="Filter by type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="pickup">Pickup Only</SelectItem>
                                <SelectItem value="drop">Drop Only</SelectItem>
                                <SelectItem value="both">Both</SelectItem>
                            </SelectContent>
                        </Select>
                        <div />
                    </div>

                    {/* Bulk reassign toolbar */}
                    {selectedStops.length > 0 && (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                {selectedStops.length} selected
                            </span>
                            <div className="flex items-center gap-2">
                                <Label className="text-xs shrink-0">Reassign to:</Label>
                                <Select onValueChange={bulkReassignToStop}>
                                    <SelectTrigger className="w-48 h-8">
                                        <SelectValue placeholder="Choose stop…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {stops?.map(s => (
                                            <SelectItem key={s.id} value={s.id}>
                                                Stop {s.sequence}: {s.stop_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedStops([])}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    )}

                    {/* Assignments table */}
                    {loadingAssignments ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading assignments…
                        </div>
                    ) : visibleAssignments.length === 0 ? (
                        <div className="py-12 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                            <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                            {drafts.length === 0
                                ? 'No assignments yet. Add them from your student roster.'
                                : 'No assignments match your filters.'}
                        </div>
                    ) : (
                        <div className="border rounded-lg overflow-hidden">
                            <Table>
                                <TableHeader className="bg-slate-100 dark:bg-slate-900 sticky top-0">
                                    <TableRow>
                                        <TableHead className="w-10">
                                            <input
                                                type="checkbox"
                                                checked={
                                                    selectedStops.length > 0 &&
                                                    selectedStops.length === visibleAssignments.length
                                                }
                                                onChange={e => {
                                                    if (e.target.checked) {
                                                        setSelectedStops(
                                                            visibleAssignments.map(a => a._key)
                                                        )
                                                    } else {
                                                        setSelectedStops([])
                                                    }
                                                }}
                                                className="rounded"
                                            />
                                        </TableHead>
                                        <TableHead>Student</TableHead>
                                        <TableHead>Stop</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead className="w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visibleAssignments.map(assignment => (
                                        <TableRow key={assignment._key}>
                                            <TableCell>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedStops.includes(assignment._key)}
                                                    onChange={e => {
                                                        if (e.target.checked) {
                                                            setSelectedStops(prev => [
                                                                ...prev,
                                                                assignment._key,
                                                            ])
                                                        } else {
                                                            setSelectedStops(prev =>
                                                                prev.filter(
                                                                    k => k !== assignment._key
                                                                )
                                                            )
                                                        }
                                                    }}
                                                    className="rounded"
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {assignment._studentName}
                                            </TableCell>
                                            <TableCell>
                                                <Select
                                                    value={assignment.stop_id}
                                                    onValueChange={id =>
                                                        setAssignmentStop(assignment._key, id)
                                                    }
                                                >
                                                    <SelectTrigger className="h-8 w-40">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {stops?.map(s => (
                                                            <SelectItem key={s.id} value={s.id}>
                                                                {s.sequence}. {s.stop_name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell>
                                                <Select
                                                    value={assignment.pickup_or_drop}
                                                    onValueChange={v =>
                                                        setPickupOrDrop(assignment._key, v)
                                                    }
                                                >
                                                    <SelectTrigger className="h-8 w-24">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {pickupOrDropOptions.map(opt => (
                                                            <SelectItem
                                                                key={opt.value}
                                                                value={opt.value}
                                                            >
                                                                {opt.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 hover:bg-red-100 hover:text-red-600"
                                                    onClick={() =>
                                                        removeAssignment(assignment._key)
                                                    }
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>

                <DialogFooter className="px-6 py-4 border-t shrink-0 flex-col sm:flex-row gap-2">
                    <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                    </Button>
                    <Button
                        disabled={drafts.length === 0 || updateAssignments.isPending}
                        className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-violet-600"
                        onClick={handleSave}
                    >
                        {updateAssignments.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Plus className="mr-2 h-4 w-4" />
                        )}
                        Save {drafts.length} Assignment{drafts.length !== 1 ? 's' : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
