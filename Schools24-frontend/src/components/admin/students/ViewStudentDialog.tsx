"use client"

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Award,
    CheckCircle2,
    BookOpen,
    Bus
} from 'lucide-react'
import { Student } from '@/hooks/useAdminStudents'
import { getInitials, formatCurrency } from '@/lib/utils'
import { useBusRoutes } from '@/hooks/useBusRoutes'

interface ViewStudentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    student: Student | null
    schoolId?: string
}

export function ViewStudentDialog({ open, onOpenChange, student, schoolId }: ViewStudentDialogProps) {
    const transportMode = student?.transport_mode
    const busRouteId = student?.bus_route_id

    const { data: busRoutesData } = useBusRoutes('', schoolId, {
        enabled: !!open && transportMode === 'bus'
    })
    const routes = busRoutesData?.pages.flatMap(page => page.routes) || []
    const selectedRoute = busRouteId ? routes.find(route => route.id === busRouteId) : undefined

    if (!student) return null

    const getFeesBadgeVariant = (status: string) => {
        switch (status) {
            case 'paid':
                return 'success'
            case 'partial':
                return 'warning'
            case 'pending':
                return 'destructive'
            default:
                return 'secondary'
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] flex flex-col max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>Student Details</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="academic" className="w-full flex-1 overflow-hidden flex flex-col">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="academic">Academic</TabsTrigger>
                        <TabsTrigger value="personal">Personal</TabsTrigger>
                        <TabsTrigger value="parent">Parent & Contact</TabsTrigger>
                        <TabsTrigger value="transport">Transport</TabsTrigger>
                    </TabsList>
                    <div className="flex-1 overflow-y-auto pr-4">
                    <TabsContent value="academic" className="space-y-4 mt-4">
                        <div className="flex items-center gap-4">
                            <Avatar className="h-20 w-20">
                                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500 text-white text-xl">
                                    {getInitials(student.full_name || '')}
                                </AvatarFallback>
                            </Avatar>
                            <div>
                                <h3 className="text-xl font-bold">{student.full_name}</h3>
                                <p className="text-muted-foreground">{student.email}</p>
                                <Badge variant="outline" className="mt-2">
                                    {student.class_name && student.section ? `Class ${student.class_name}-${student.section}` : 'Not Assigned'}
                                    {student.roll_number && ` | Roll: ${student.roll_number}`}
                                </Badge>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Admission Number</p>
                                <p className="font-medium">{student.admission_number || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Academic Year</p>
                                <p className="font-medium">{student.academic_year || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Admission Date</p>
                                <p className="font-medium">{student.admission_date || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Class / Section</p>
                                <p className="font-medium">{student.class_name ? `Class ${student.class_name}` : 'N/A'} {student.section ? `(${student.section})` : ''}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-center">
                                <Award className="h-8 w-8 mx-auto mb-2" />
                                <p className="text-2xl font-bold">{student.current_grade || 'X'}</p>
                                <p className="text-sm opacity-90">Current Class</p>
                            </div>
                            <div className="p-4 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white text-center">
                                <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
                                <p className="text-2xl font-bold">{student.attendance_stats?.attendance_percent || 0}%</p>
                                <p className="text-sm opacity-90">Attendance</p>
                            </div>
                        </div>
                        <div className="p-4 rounded-lg border bg-muted/50">
                            <h4 className="font-semibold mb-2 flex items-center gap-2">
                                <BookOpen className="h-4 w-4" />
                                Academic Information
                            </h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Roll Number:</span>
                                    <span className="font-medium">{student.roll_number || 'N/A'}</span>
                                </div>
                                {student.attendance_stats && (
                                    <>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Total Days:</span>
                                            <span className="font-medium">{student.attendance_stats.total_days || 'N/A'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Present Days:</span>
                                            <span className="font-medium">{student.attendance_stats.present_days || 'N/A'}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                        {student.fees ? (
                            <>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="p-4 rounded-lg border text-center">
                                        <p className="text-sm text-muted-foreground">Total Fees</p>
                                        <p className="text-2xl font-bold">{formatCurrency(student.fees.total)}</p>
                                    </div>
                                    <div className="p-4 rounded-lg border text-center bg-green-50 dark:bg-green-900/20">
                                        <p className="text-sm text-muted-foreground">Paid</p>
                                        <p className="text-2xl font-bold text-green-600">{formatCurrency(student.fees.paid)}</p>
                                    </div>
                                    <div className="p-4 rounded-lg border text-center bg-red-50 dark:bg-red-900/20">
                                        <p className="text-sm text-muted-foreground">Pending</p>
                                        <p className="text-2xl font-bold text-red-600">{formatCurrency(student.fees.total - student.fees.paid)}</p>
                                    </div>
                                </div>
                                <div className="p-4 rounded-lg border">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-sm text-muted-foreground">Payment Progress</span>
                                        <Badge variant={getFeesBadgeVariant(student.fees.status) as any}>
                                            {student.fees.status}
                                        </Badge>
                                    </div>
                                    <Progress
                                        value={(student.fees.paid / student.fees.total) * 100}
                                        className="h-2"
                                    />
                                </div>
                            </>
                        ) : null}
                    </TabsContent>
                    <TabsContent value="personal" className="space-y-4 mt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Date of Birth</p>
                                <p className="font-medium">{student.date_of_birth || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Gender</p>
                                <p className="font-medium capitalize">{student.gender || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Blood Group</p>
                                <p className="font-medium">{student.blood_group || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Address</p>
                                <p className="font-medium">{student.address || 'N/A'}</p>
                            </div>
                        </div>
                    </TabsContent>
                    <TabsContent value="parent" className="space-y-4 mt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Parent/Guardian Name</p>
                                <p className="font-medium">{student.parent_name || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Parent Phone</p>
                                <p className="font-medium">{student.parent_phone || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Parent Email</p>
                                <p className="font-medium">{student.parent_email || 'N/A'}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Emergency Contact</p>
                                <p className="font-medium">{student.emergency_contact || 'N/A'}</p>
                            </div>
                        </div>
                    </TabsContent>
                    <TabsContent value="transport" className="space-y-4 mt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-lg bg-muted flex items-center gap-3">
                                <Bus className="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <p className="text-xs text-muted-foreground">Transport Mode</p>
                                    <p className="font-medium capitalize">{student.transport_mode || 'private'}</p>
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-muted">
                                <p className="text-xs text-muted-foreground">Bus Route</p>
                                <p className="font-medium">
                                    {student.transport_mode === 'bus'
                                        ? (selectedRoute ? `${selectedRoute.routeNumber} - ${selectedRoute.vehicleNumber}` : (student.bus_route_id || 'N/A'))
                                        : 'N/A'}
                                </p>
                            </div>
                        </div>
                    </TabsContent>
                    </div>
                </Tabs>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
