"use client"

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    CheckCircle, Clock, AlertCircle, Receipt,
    Wallet, Calendar, CreditCard,
    FileText, Users, Search, ChevronDown, ChevronUp,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/lib/api'
import { TeacherClassStudent, useTeacherClasses, useTeacherStudentFees } from '@/hooks/useTeacherFees'
import { Skeleton } from '@/components/ui/skeleton'

type StudentWithClass = TeacherClassStudent & {
    class_id: string
    class_name: string
}

export default function TeacherFeesPage() {
    const [selectedClassId, setSelectedClassId] = useState<string>('all')
    const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')

    const { data: classesData, isLoading: loadingClasses } = useTeacherClasses()
    const { data: feeData, isLoading: loadingFees, isError: feeError } = useTeacherStudentFees(expandedStudentId)

    const classes = classesData?.classes ?? []

    const { data: allStudents = [], isLoading: loadingStudents } = useQuery({
        queryKey: ['teacher', 'all-class-students', classes.map((c) => c.id).join(',')],
        enabled: classes.length > 0,
        queryFn: async () => {
            const grouped = await Promise.all(
                classes.map(async (cls) => {
                    const response = await api.getOrEmpty<{ students: TeacherClassStudent[] }>(
                        `/teacher/classes/${cls.id}/students`,
                        { students: [] }
                    )

                    return response.students.map((student) => ({
                        ...student,
                        class_id: cls.id,
                        class_name: cls.class_name,
                    }))
                })
            )

            return grouped.flat()
        },
        staleTime: 60 * 1000,
    })

    const filteredStudents = useMemo(() => {
        const byClass = selectedClassId === 'all'
            ? allStudents
            : allStudents.filter((student) => student.class_id === selectedClassId)

        const query = searchText.trim().toLowerCase()
        if (!query) return byClass

        return byClass.filter((student) =>
            student.full_name.toLowerCase().includes(query) ||
            student.roll_number?.toLowerCase().includes(query) ||
            student.email.toLowerCase().includes(query)
        )
    }, [allStudents, selectedClassId, searchText])

    const toggleExpandedRow = (studentId: string) => {
        setExpandedStudentId((prev) => (prev === studentId ? null : studentId))
    }

    const breakdown = feeData?.breakdown ?? []
    const paymentHistory = feeData?.payment_history ?? []
    const totalFees = feeData?.total_amount ?? 0
    const paidFees = feeData?.paid_amount ?? 0
    const pendingFees = feeData?.pending_amount ?? 0

    const selectedClassLabel = selectedClassId === 'all'
        ? 'All classes'
        : classes.find((cls) => cls.id === selectedClassId)?.class_name || 'Class'

    return (
        <div className="space-y-6 animate-fade-in">
            <div>
                <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                    Fee Overview
                </h1>
                <p className="text-muted-foreground mt-1">Browse all assigned students first, then narrow down using filters.</p>
            </div>

            <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
                <Card>
                    <CardContent className="p-4 md:p-5">
                        <p className="text-xs text-muted-foreground">Assigned Classes</p>
                        <p className="text-lg md:text-2xl font-semibold">{classes.length}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 md:p-5">
                        <p className="text-xs text-muted-foreground">Students in Scope</p>
                        <p className="text-lg md:text-2xl font-semibold">{allStudents.length}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 md:p-5">
                        <p className="text-xs text-muted-foreground">Current View</p>
                        <p className="text-sm md:text-base font-semibold truncate">{selectedClassLabel}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 md:p-5">
                        <p className="text-xs text-muted-foreground">Visible Students</p>
                        <p className="text-lg md:text-2xl font-semibold">{filteredStudents.length}</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-0 shadow-md">
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                    <CardDescription>Default view includes every assigned class and student.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5 min-w-0">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                            <Users className="h-4 w-4" />
                            Class
                        </label>
                        <Select value={selectedClassId} onValueChange={setSelectedClassId} disabled={loadingClasses}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={loadingClasses ? 'Loading classes...' : 'All classes'} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All classes</SelectItem>
                                {classes.map((cls) => (
                                    <SelectItem key={cls.id} value={cls.id}>
                                        {cls.class_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5 min-w-0">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                            <Search className="h-4 w-4" />
                            Search Student
                        </label>
                        <Input
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            placeholder="Name, roll number, or email"
                        />
                    </div>

                </CardContent>
            </Card>

            <Card className="border-0 shadow-md">
                <CardHeader>
                    <CardTitle>Student Roster</CardTitle>
                    <CardDescription>Tap a row to open inline fee overview. Collapse it to close.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loadingStudents ? (
                        <div className="space-y-2">
                            {[1, 2, 3, 4].map((row) => (
                                <Skeleton key={row} className="h-12 w-full" />
                            ))}
                        </div>
                    ) : filteredStudents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No students match the selected filters.</p>
                    ) : (
                        <div className="space-y-3">
                            {filteredStudents.map((student) => {
                                const isExpanded = expandedStudentId === student.id
                                const showLiveDetails = isExpanded && expandedStudentId === student.id

                                const liveBreakdown = showLiveDetails ? (feeData?.breakdown ?? []) : []
                                const livePaymentHistory = showLiveDetails ? (feeData?.payment_history ?? []) : []
                                const liveTotalFees = showLiveDetails ? (feeData?.total_amount ?? 0) : 0
                                const livePaidFees = showLiveDetails ? (feeData?.paid_amount ?? 0) : 0
                                const livePendingFees = showLiveDetails ? (feeData?.pending_amount ?? 0) : 0

                                return (
                                    <div key={student.id} className="rounded-xl border bg-card overflow-hidden">
                                        <button
                                            type="button"
                                            className={`w-full px-3 sm:px-4 py-3 text-left transition-colors ${isExpanded ? 'bg-primary/5' : 'hover:bg-muted/40'}`}
                                            onClick={() => toggleExpandedRow(student.id)}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-semibold truncate">{student.full_name}</p>
                                                    <p className="text-xs sm:text-sm text-muted-foreground truncate">
                                                        {student.class_name} • Roll {student.roll_number || '-'}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {isExpanded && <Badge variant="secondary">Opened</Badge>}
                                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                </div>
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="border-t px-3 sm:px-4 py-4 bg-muted/20 space-y-4">
                                                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-muted/60 border">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
                                                        {student.full_name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold truncate">{student.full_name}</p>
                                                        <p className="text-sm text-muted-foreground whitespace-nowrap truncate">
                                                            {student.class_name} · Academic Year {showLiveDetails && feeData ? feeData.academic_year : '...'}
                                                        </p>
                                                    </div>
                                                </div>

                                                {loadingFees && showLiveDetails && (
                                                    <div className="grid gap-4 grid-cols-2 xl:grid-cols-3">
                                                        {[0, 1, 2].map((i) => (
                                                            <Skeleton key={i} className={`h-28 rounded-2xl ${i === 2 ? 'col-span-2 xl:col-span-1' : ''}`} />
                                                        ))}
                                                    </div>
                                                )}

                                                {showLiveDetails && feeError && (
                                                    <Card className="border-destructive">
                                                        <CardContent className="py-8 text-center text-destructive text-sm">
                                                            Failed to load fee data. The student may not be in your assigned classes.
                                                        </CardContent>
                                                    </Card>
                                                )}

                                                {!loadingFees && !feeError && showLiveDetails && feeData && (
                                                    <>
                                                        <div className="grid gap-4 grid-cols-2 xl:grid-cols-3">
                                                            <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50 overflow-hidden">
                                                                <CardContent className="p-4 md:p-6 relative">
                                                                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full -translate-y-12 translate-x-12" />
                                                                    <div className="flex items-center gap-4">
                                                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg shadow-blue-500/30">
                                                                            <Wallet className="h-7 w-7" />
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xl md:text-2xl font-bold text-blue-700 dark:text-blue-400">{formatCurrency(liveTotalFees)}</p>
                                                                            <p className="text-sm text-muted-foreground">Total Fees</p>
                                                                        </div>
                                                                    </div>
                                                                </CardContent>
                                                            </Card>

                                                            <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 overflow-hidden">
                                                                <CardContent className="p-4 md:p-6 relative">
                                                                    <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-full -translate-y-12 translate-x-12" />
                                                                    <div className="flex items-center gap-4">
                                                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30">
                                                                            <CheckCircle className="h-7 w-7" />
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xl md:text-2xl font-bold text-green-700 dark:text-green-400">{formatCurrency(livePaidFees)}</p>
                                                                            <p className="text-sm text-muted-foreground">Paid</p>
                                                                        </div>
                                                                    </div>
                                                                </CardContent>
                                                            </Card>

                                                            <Card className="col-span-2 xl:col-span-1 border-0 shadow-lg bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/50 dark:to-rose-950/50 overflow-hidden">
                                                                <CardContent className="p-4 md:p-6 relative">
                                                                    <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-full -translate-y-12 translate-x-12" />
                                                                    <div className="flex items-center gap-4">
                                                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/30">
                                                                            <AlertCircle className="h-7 w-7" />
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xl md:text-2xl font-bold text-red-700 dark:text-red-400">{formatCurrency(livePendingFees)}</p>
                                                                            <p className="text-sm text-muted-foreground">Pending</p>
                                                                        </div>
                                                                    </div>
                                                                </CardContent>
                                                            </Card>
                                                        </div>

                                                        {liveTotalFees > 0 && (
                                                            <Card className="border-0 shadow-lg overflow-hidden">
                                                                <CardHeader className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white pb-4">
                                                                    <CardTitle className="text-white">Payment Progress</CardTitle>
                                                                    <CardDescription className="text-emerald-100">Academic Year {feeData.academic_year}</CardDescription>
                                                                </CardHeader>
                                                                <CardContent className="p-4 md:p-6">
                                                                    <div className="space-y-4">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="font-medium">Overall Payment Status</span>
                                                                            <Badge variant={livePendingFees === 0 ? 'success' : 'warning'} className="text-sm px-4 py-1">
                                                                                {livePendingFees === 0 ? '✓ Fully Paid' : `${Math.round((livePaidFees / liveTotalFees) * 100)}% Paid`}
                                                                            </Badge>
                                                                        </div>
                                                                        <div className="relative">
                                                                            <Progress value={(livePaidFees / liveTotalFees) * 100} className="h-6 rounded-full" />
                                                                            <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white drop-shadow">
                                                                                {formatCurrency(livePaidFees)} / {formatCurrency(liveTotalFees)}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex justify-between text-sm">
                                                                            <span className="text-green-600">Paid: {formatCurrency(livePaidFees)}</span>
                                                                            <span className="text-red-600">Pending: {formatCurrency(livePendingFees)}</span>
                                                                        </div>
                                                                    </div>
                                                                </CardContent>
                                                            </Card>
                                                        )}

                                                        <Card className="border-0 shadow-lg">
                                                            <CardHeader>
                                                                <div className="flex items-center gap-2">
                                                                    <FileText className="h-5 w-5 text-primary" />
                                                                    <CardTitle>Fee Breakdown</CardTitle>
                                                                </div>
                                                                <CardDescription>Individual fee components for {feeData.student_name}</CardDescription>
                                                            </CardHeader>
                                                            <CardContent>
                                                                <div className="space-y-4">
                                                                    {liveBreakdown.length === 0 && (
                                                                        <p className="text-sm text-muted-foreground">No fee demands found for this student.</p>
                                                                    )}
                                                                    {liveBreakdown.map((fee, index) => (
                                                                        <div
                                                                            key={fee.id}
                                                                            className={`p-4 sm:p-5 rounded-2xl border-2 transition-all duration-300 hover:shadow-lg stagger-${index + 1} animate-slide-up ${
                                                                                fee.status === 'paid'
                                                                                    ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20 hover:border-green-300'
                                                                                    : fee.status === 'partial'
                                                                                        ? 'border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20 hover:border-yellow-300'
                                                                                        : fee.status === 'overdue'
                                                                                            ? 'border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 hover:border-orange-300'
                                                                                            : 'border-red-200 bg-red-50/50 dark:bg-red-950/20 hover:border-red-300'
                                                                            }`}
                                                                        >
                                                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                                                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                                                                    <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-muted shrink-0">
                                                                                        <FileText className="h-5 w-5" />
                                                                                    </div>
                                                                                    <div className="min-w-0">
                                                                                        <p className="font-semibold text-base sm:text-lg truncate">{fee.purpose_name}</p>
                                                                                        <p className="text-xs sm:text-sm text-muted-foreground">
                                                                                            Paid {formatCurrency(fee.paid_amount)} of {formatCurrency(fee.amount)}
                                                                                            {fee.due_date && (
                                                                                                <span className="ml-2">· Due {new Date(fee.due_date).toLocaleDateString()}</span>
                                                                                            )}
                                                                                        </p>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4">
                                                                                    <div className="text-left sm:text-right">
                                                                                        <p className="font-bold text-base sm:text-lg">{formatCurrency(fee.amount - fee.paid_amount)}</p>
                                                                                        <p className="text-xs text-muted-foreground">Remaining</p>
                                                                                    </div>
                                                                                    <Badge
                                                                                        variant={
                                                                                            fee.status === 'paid' ? 'success' :
                                                                                            fee.status === 'partial' ? 'warning' :
                                                                                            fee.status === 'overdue' ? 'warning' : 'destructive'
                                                                                        }
                                                                                        className="px-3 py-1.5 text-xs sm:text-sm font-medium"
                                                                                    >
                                                                                        {fee.status === 'paid' && <CheckCircle className="h-3 w-3 mr-1" />}
                                                                                        {fee.status === 'partial' && <Clock className="h-3 w-3 mr-1" />}
                                                                                        {(fee.status === 'pending' || fee.status === 'overdue') && <AlertCircle className="h-3 w-3 mr-1" />}
                                                                                        {fee.status.charAt(0).toUpperCase() + fee.status.slice(1)}
                                                                                    </Badge>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </CardContent>
                                                        </Card>

                                                        <Card className="border-0 shadow-lg">
                                                            <CardHeader>
                                                                <div className="flex items-center gap-2">
                                                                    <Receipt className="h-5 w-5 text-primary" />
                                                                    <CardTitle>Payment History</CardTitle>
                                                                </div>
                                                                <CardDescription>
                                                                    Recent transactions · Academic Year {feeData.academic_year}
                                                                </CardDescription>
                                                            </CardHeader>
                                                            <CardContent>
                                                                <div className="space-y-4">
                                                                    {livePaymentHistory.length === 0 && (
                                                                        <p className="text-sm text-muted-foreground">No payments recorded for this student yet.</p>
                                                                    )}
                                                                    {livePaymentHistory.map((payment, index) => (
                                                                        <div
                                                                            key={payment.id}
                                                                            className={`p-4 sm:p-5 rounded-2xl border transition-all duration-300 hover:shadow-md bg-gradient-to-r from-green-50/50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20 stagger-${index + 1} animate-slide-up`}
                                                                        >
                                                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                                                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                                                                    <div className="flex h-11 w-11 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/20 shrink-0">
                                                                                        <Receipt className="h-5 w-5 sm:h-6 sm:w-6" />
                                                                                    </div>
                                                                                    <div className="min-w-0">
                                                                                        <p className="font-bold text-base sm:text-lg">{formatCurrency(payment.amount)}</p>
                                                                                        <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground flex-wrap">
                                                                                            <Calendar className="h-3 w-3" />
                                                                                            <span>{new Date(payment.payment_date).toLocaleDateString()}</span>
                                                                                            <span>·</span>
                                                                                            <CreditCard className="h-3 w-3" />
                                                                                            <span>{payment.payment_method}</span>
                                                                                            {payment.purpose && (
                                                                                                <>
                                                                                                    <span>·</span>
                                                                                                    <span className="truncate">{payment.purpose}</span>
                                                                                                </>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="shrink-0 text-left sm:text-right">
                                                                                    <Badge variant="success" className="px-3 py-1">
                                                                                        Success
                                                                                    </Badge>
                                                                                    <p className="text-xs text-muted-foreground mt-1 truncate">{payment.receipt_number}</p>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </CardContent>
                                                        </Card>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
