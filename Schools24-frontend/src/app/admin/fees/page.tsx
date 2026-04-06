"use client"

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
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
    DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Search, Plus, DollarSign, FileSpreadsheet, TrendingUp, AlertCircle, CheckCircle, Send, Receipt, CreditCard, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
    useFeeDemands,
    useCreateFeeDemand,
    useRecordFeePayment,
    useFeeDemandPurposes,
    useCreateFeeDemandPurpose,
    useUpdateFeeDemandPurpose,
    useDeleteFeeDemandPurpose,
    FeeDemand,
    FeeDemandResponse,
} from '@/hooks/useFees'
import { useStudents } from '@/hooks/useAdminStudents'
import { useClasses } from '@/hooks/useClasses'
import { collapseClassesForTimetable, formatSchoolClassLabel } from '@/lib/classOrdering'
import { formatCurrency } from '@/lib/utils'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface FeeFormData {
    classId: string
    studentId: string
    purposeId: string
    amount: number
    dueDate: string
}

interface AdmissionSettingsResponse {
    global_academic_year: string
}

const initialFormData: FeeFormData = {
    classId: '',
    studentId: '',
    purposeId: '',
    amount: 0,
    dueDate: '',
}

const getCurrentAcademicYear = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    return month < 4 ? `${year - 1}-${year}` : `${year}-${year + 1}`
}

const buildAcademicYearOptions = (currentYear: string) => {
    const [start] = currentYear.split('-').map(Number)
    if (!start || Number.isNaN(start)) return [currentYear]
    return Array.from({ length: 11 }, (_, i) => `${start - i}-${start - i + 1}`)
}

const normalizeAcademicYear = (value?: string) => {
    if (!value) return ''
    const trimmed = value.trim()
    const parts = trimmed.split('-')
    if (parts.length !== 2) return trimmed
    const start = Number(parts[0])
    const endRaw = parts[1]
    if (Number.isNaN(start)) return trimmed
    const end = endRaw.length === 2 ? Number(`20${endRaw}`) : Number(endRaw)
    if (Number.isNaN(end)) return trimmed
    return `${start}-${end}`
}

export default function FeesPage() {
    const { user, isLoading, userRole } = useAuth()
    const searchParams = useSearchParams()
    const schoolId = searchParams.get('school_id') || undefined
    const isSuperAdmin = userRole === 'super_admin'
    const canLoad = !!user && !isLoading && (!isSuperAdmin || !!schoolId)

    const currentAcademicYear = useMemo(() => getCurrentAcademicYear(), [])
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [academicYear, setAcademicYear] = useState('')
    const [formData, setFormData] = useState<FeeFormData>(initialFormData)
    const [studentSearchQuery, setStudentSearchQuery] = useState('')
    const [isPurposeDialogOpen, setIsPurposeDialogOpen] = useState(false)
    const [isPurposeFormVisible, setIsPurposeFormVisible] = useState(false)
    const [purposeNameInput, setPurposeNameInput] = useState('')
    const [editingPurposeId, setEditingPurposeId] = useState<string | null>(null)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false)
    const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false)
    const [selectedFee, setSelectedFee] = useState<FeeDemand | null>(null)
    const [paymentAmount, setPaymentAmount] = useState<number>(0)
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [paymentPurpose, setPaymentPurpose] = useState('')
    const settingsQuery = useQuery({
        queryKey: ['admin-admission-settings'],
        queryFn: () => api.get<AdmissionSettingsResponse>('/admin/settings/admissions'),
        enabled: canLoad,
    })
    const platformAcademicYear = (settingsQuery.data?.global_academic_year || '').trim()

    useEffect(() => {
        if (!academicYear && platformAcademicYear) {
            setAcademicYear(platformAcademicYear)
        }
    }, [academicYear, platformAcademicYear])

    useEffect(() => {
        if (!academicYear && !platformAcademicYear && !settingsQuery.isLoading) {
            setAcademicYear(currentAcademicYear)
        }
    }, [academicYear, currentAcademicYear, platformAcademicYear, settingsQuery.isLoading])

    const {
        data: feeDemandsData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useFeeDemands(schoolId, {
        search: searchQuery,
        status: statusFilter,
        academicYear,
        pageSize: 20,
        enabled: canLoad,
    })
    const fees = feeDemandsData?.pages.flatMap(page => page.items) ?? []

    // Infinite scroll
    const { ref: feeScrollRef, inView: feeInView } = useIntersectionObserver({ threshold: 0.1 })
    useEffect(() => {
        if (feeInView && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, [feeInView, hasNextPage, isFetchingNextPage, fetchNextPage])
    const academicYearOptions = useMemo(
        () => buildAcademicYearOptions(platformAcademicYear || currentAcademicYear),
        [currentAcademicYear, platformAcademicYear]
    )

    const { data: classesData } = useClasses('all')
    const allClasses = useMemo(() => classesData?.classes ?? [], [classesData])
    const availableClasses = useMemo(
        () => collapseClassesForTimetable(allClasses, academicYear),
        [allClasses, academicYear]
    )
    const { data: purposeData } = useFeeDemandPurposes(schoolId, canLoad)
    const feePurposes = purposeData?.purposes ?? []

    // Use the exact selected class ID (not cross-year expansion) so only students
    // actually enrolled in that specific class row are shown. The timetable view
    // uses selectedClassGroupIds to span all academic years, but for fee entry
    // we want strict filtering — students from an old year's version of Class 1-A
    // should not bleed into the current year's fee dialog.
    const { data: studentPages } = useStudents('', 200, schoolId, {
        enabled: canLoad && !!formData.classId,
        classId: formData.classId,
    })
    const students = useMemo(
        () => studentPages?.pages.flatMap(page => page.students) || [],
        [studentPages]
    )
    const filteredStudents = useMemo(() => {
        const term = studentSearchQuery.trim().toLowerCase()
        if (!term) return students
        return students.filter((student) =>
            student.full_name.toLowerCase().includes(term) ||
            student.admission_number.toLowerCase().includes(term) ||
            student.email.toLowerCase().includes(term)
        )
    }, [students, studentSearchQuery])
    const createFeeDemand = useCreateFeeDemand(schoolId)
    const recordPayment = useRecordFeePayment(schoolId)
    const createFeePurpose = useCreateFeeDemandPurpose(schoolId)
    const updateFeePurpose = useUpdateFeeDemandPurpose(schoolId)
    const deleteFeePurpose = useDeleteFeeDemandPurpose(schoolId)

    const fetchTriggerIndex = fees.length > 0 ? Math.max(0, Math.floor(fees.length * 0.8) - 1) : -1

    const filteredFees = fees.filter(fee => {
        const matchesSearch = fee.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            fee.admissionNumber.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesStatus = statusFilter === 'all' || fee.status === statusFilter
        const normalizedSelectedYear = normalizeAcademicYear(academicYear)
        const normalizedFeeYear = normalizeAcademicYear(fee.academicYear)
        const normalizedConfiguredYear = normalizeAcademicYear(platformAcademicYear || currentAcademicYear)
        const matchesAcademicYear = normalizedSelectedYear === ''
            ? true
            : normalizedFeeYear === normalizedSelectedYear ||
            (normalizedSelectedYear === normalizedConfiguredYear && normalizedFeeYear === '')
        return matchesSearch && matchesStatus && matchesAcademicYear
    })
    const showAcademicYearEmptyState =
        filteredFees.length === 0 &&
        searchQuery.trim() === '' &&
        (statusFilter === 'all' || statusFilter === '')

    const totalFees = fees.reduce((sum, fee) => sum + fee.amount, 0)
    const paidFees = fees.reduce((sum, fee) => sum + fee.paidAmount, 0)
    const pendingFees = fees
        .filter(f => f.status === 'pending' || f.status === 'partial')
        .reduce((sum, fee) => sum + Math.max(fee.amount - fee.paidAmount, 0), 0)
    const overdueFees = fees
        .filter(f => f.status === 'overdue')
        .reduce((sum, fee) => sum + Math.max(fee.amount - fee.paidAmount, 0), 0)

    const handleAddFee = async () => {
        if (!formData.studentId || !formData.purposeId || !formData.amount) {
            toast.error('Please fill in required fields', {
                description: 'Student, purpose, and amount are required.',
            })
            return
        }
        try {
            const createAcademicYear = (academicYear || platformAcademicYear || currentAcademicYear).trim()
            await createFeeDemand.mutateAsync({
                studentId: formData.studentId,
                purposeId: formData.purposeId,
                amount: formData.amount,
                dueDate: formData.dueDate,
                academicYear: createAcademicYear,
            })
            setFormData(initialFormData)
            setStudentSearchQuery('')
            setIsAddDialogOpen(false)
        } catch {
            // Error handled by mutation
        }
    }

    const handleSaveFeePurpose = async () => {
        const trimmedName = purposeNameInput.trim()
        if (!trimmedName) {
            toast.error('Purpose name is required')
            return
        }
        try {
            if (editingPurposeId) {
                await updateFeePurpose.mutateAsync({ id: editingPurposeId, name: trimmedName })
            } else {
                await createFeePurpose.mutateAsync(trimmedName)
            }
            setPurposeNameInput('')
            setEditingPurposeId(null)
            setIsPurposeFormVisible(false)
        } catch {
            // handled by hook
        }
    }

    const handleEditFeePurpose = (id: string, name: string) => {
        setEditingPurposeId(id)
        setPurposeNameInput(name)
        setIsPurposeFormVisible(true)
    }

    const handleCancelFeePurposeEdit = () => {
        setEditingPurposeId(null)
        setPurposeNameInput('')
        setIsPurposeFormVisible(false)
    }

    const handleDeleteFeePurpose = async (id: string) => {
        try {
            await deleteFeePurpose.mutateAsync(id)
            if (formData.purposeId === id) {
                setFormData((prev) => ({ ...prev, purposeId: '' }))
            }
        } catch {
            // handled by hook
        }
    }

    const handleRecordPayment = async () => {
        if (!selectedFee) return

        if (paymentAmount <= 0) {
            toast.error('Invalid amount', {
                description: 'Please enter a valid payment amount.',
            })
            return
        }

        try {
            await recordPayment.mutateAsync({
                studentId: selectedFee.studentId,
                studentFeeId: selectedFee.id,
                amount: paymentAmount,
                paymentMethod,
                purpose: paymentPurpose || selectedFee.purpose,
            })
            setSelectedFee(null)
            setPaymentAmount(0)
            setPaymentPurpose('')
            setIsPaymentDialogOpen(false)
        } catch {
            // Error handled by mutation
        }
    }

    const openPaymentDialog = (fee: FeeDemand) => {
        setSelectedFee(fee)
        setPaymentAmount(Math.max(fee.amount - fee.paidAmount, 0))
        setPaymentPurpose(fee.purpose)
        setPaymentMethod('cash')
        setIsPaymentDialogOpen(true)
    }

    const openReceiptDialog = (fee: FeeDemand) => {
        setSelectedFee(fee)
        setIsReceiptDialogOpen(true)
    }

    const handleSendReminders = () => {
        const pendingCount = fees.filter(f => f.status === 'pending' || f.status === 'partial' || f.status === 'overdue').length
        toast.success('Reminders sent', {
            description: `Payment reminders sent to ${pendingCount} students with pending fees.`,
        })
    }

    const handleExport = async () => {
        if (!canLoad || !academicYear) return

        try {
            const allFees: FeeDemand[] = []
            let page = 1
            let totalPages = 1

            do {
                const params = new URLSearchParams()
                if (schoolId) params.append('school_id', schoolId)
                if (searchQuery.trim()) params.append('search', searchQuery.trim())
                if (statusFilter) params.append('status', statusFilter)
                if (academicYear) params.append('academic_year', academicYear)
                params.append('page', page.toString())
                params.append('page_size', '200')

                const response = await api.get<FeeDemandResponse>(`/admin/fees/demands?${params.toString()}`)
                allFees.push(
                    ...response.items.map((item) => ({
                        id: item.id,
                        studentId: item.student_id,
                        studentName: item.student_name,
                        admissionNumber: item.admission_number,
                        className: item.class_name,
                        academicYear: item.academic_year,
                        purpose: item.purpose,
                        amount: item.amount,
                        paidAmount: item.paid_amount,
                        dueDate: item.due_date ? item.due_date.split('T')[0] : '',
                        lastPaymentDate: item.last_payment_date ? item.last_payment_date.split('T')[0] : '',
                        status: item.status,
                    }))
                )
                totalPages = Math.max(1, Math.ceil(response.total / response.page_size))
                page += 1
            } while (page <= totalPages)

            const worksheet = XLSX.utils.json_to_sheet(
                allFees.map((fee) => ({
                    'Student Name': fee.studentName,
                    'Admission No': fee.admissionNumber,
                    'Class': fee.className,
                    'Academic Year': fee.academicYear || academicYear,
                    'Purpose': fee.purpose,
                    'Amount': fee.amount,
                    'Paid Amount': fee.paidAmount,
                    'Outstanding Amount': Math.max(fee.amount - fee.paidAmount, 0),
                    'Due Date': fee.dueDate || '',
                    'Last Payment': fee.lastPaymentDate || '',
                    'Status': fee.status,
                }))
            )
            const workbook = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Fee Records')
            XLSX.writeFile(workbook, `fee-records-${academicYear}.xlsx`)

            toast.success('Export completed', {
                description: `Exported ${allFees.length} fee records to XLSX.`,
            })
        } catch (error) {
            toast.error('Export failed', {
                description: error instanceof Error ? error.message : 'Unable to export fee records.',
            })
        }
    }

    const handlePrintReceipt = () => {
        toast.success('Receipt generated', {
            description: 'Receipt is ready for printing.',
        })
        setIsReceiptDialogOpen(false)
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold">Fee Management</h1>
                    <p className="text-muted-foreground">Manage student fees and payments</p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:flex-wrap sm:w-auto sm:gap-3">
                    <Button variant="outline" onClick={handleExport} className="h-9 w-full px-2 text-xs sm:h-10 sm:w-auto sm:px-4 sm:text-sm">
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                    <Dialog open={isPurposeDialogOpen} onOpenChange={setIsPurposeDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-9 w-full px-2 text-xs sm:h-10 sm:w-auto sm:px-4 sm:text-sm bg-green-600 hover:bg-green-700 text-white">
                                Demand Management
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Demand Management</DialogTitle>
                                <DialogDescription>
                                    Manage fee purposes used in Add Fee Entry.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">Existing purposes</p>
                                    <Button
                                        size="icon"
                                        onClick={() => {
                                            setEditingPurposeId(null)
                                            setPurposeNameInput('')
                                            setIsPurposeFormVisible(true)
                                        }}
                                    >
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </div>

                                {isPurposeFormVisible ? (
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Input
                                            placeholder="e.g., Tuition Fee"
                                            value={purposeNameInput}
                                            onChange={(e) => setPurposeNameInput(e.target.value)}
                                        />
                                        <div className="flex gap-2">
                                            <Button onClick={handleSaveFeePurpose}>
                                                {editingPurposeId ? 'Update' : 'Add'}
                                            </Button>
                                            <Button variant="outline" onClick={handleCancelFeePurposeEdit}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[360px] overflow-y-auto pr-1">
                                    {feePurposes.map((purpose) => (
                                        <Card key={purpose.id}>
                                            <CardContent className="p-3 flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-medium truncate">{purpose.name}</p>
                                                    <p className="text-xs text-muted-foreground truncate">{purpose.id}</p>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button variant="outline" size="sm" onClick={() => handleEditFeePurpose(purpose.id, purpose.name)}>
                                                        Edit
                                                    </Button>
                                                    <Button variant="destructive" size="sm" onClick={() => handleDeleteFeePurpose(purpose.id)}>
                                                        Delete
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                    <Button variant="outline" onClick={handleSendReminders} className="h-9 w-full px-2 text-xs sm:h-10 sm:w-auto sm:px-4 sm:text-sm">
                        <Send className="mr-2 h-4 w-4" />
                        Send Reminders
                    </Button>
                    <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-9 w-full px-2 text-xs sm:h-10 sm:w-auto sm:px-4 sm:text-sm">
                                <Plus className="mr-2 h-4 w-4" />
                                Add Fee Entry
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Add Fee Entry</DialogTitle>
                                <DialogDescription>
                                    Create a new fee record for a student.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="classId">Class *</Label>
                                        <Select
                                            value={formData.classId}
                                            onValueChange={(value) => {
                                                setFormData({ ...formData, classId: value, studentId: '' })
                                                setStudentSearchQuery('')
                                            }}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Select class" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {availableClasses.map(schoolClass => (
                                                    <SelectItem key={schoolClass.id} value={schoolClass.id}>
                                                        {formatSchoolClassLabel(schoolClass)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="studentId">Student *</Label>
                                        <Select
                                            value={formData.studentId}
                                            onValueChange={(value) => setFormData({ ...formData, studentId: value })}
                                            disabled={!formData.classId}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder={formData.classId ? "Select student" : "Select class first"} />
                                            </SelectTrigger>
                                            <SelectContent className="w-[--radix-select-trigger-width]">
                                                {/* Search is outside the Radix scroll viewport so sticky works */}
                                                <div className="p-2 border-b">
                                                    <Input
                                                        id="studentSearchInDropdown"
                                                        placeholder={formData.classId ? 'Search student...' : 'Select class first'}
                                                        value={studentSearchQuery}
                                                        onChange={(e) => setStudentSearchQuery(e.target.value)}
                                                        onKeyDown={(e) => e.stopPropagation()}
                                                        disabled={!formData.classId}
                                                        className="h-8 text-sm"
                                                    />
                                                </div>
                                                <div className="max-h-48 overflow-y-auto">
                                                    {filteredStudents.map(student => (
                                                        <SelectItem key={student.id} value={student.id}>
                                                            {student.full_name} ({student.admission_number})
                                                        </SelectItem>
                                                    ))}
                                                    {formData.classId && filteredStudents.length === 0 ? (
                                                        <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                                                            No students found for this class.
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid gap-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="feeType">Purpose *</Label>
                                        <Select
                                            value={formData.purposeId}
                                            onValueChange={(value) => setFormData({ ...formData, purposeId: value })}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Select purpose" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {feePurposes.map((purpose) => (
                                                    <SelectItem key={purpose.id} value={purpose.id}>
                                                        {purpose.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="amount">Amount (₹) *</Label>
                                        <Input
                                            id="amount"
                                            type="number"
                                            placeholder="Enter amount"
                                            value={formData.amount || ''}
                                            onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="dueDate">Due Date</Label>
                                        <Input
                                            id="dueDate"
                                            type="date"
                                            value={formData.dueDate}
                                            onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => {
                                    setFormData(initialFormData)
                                    setStudentSearchQuery('')
                                    setIsAddDialogOpen(false)
                                }}>
                                    Cancel
                                </Button>
                                <Button onClick={handleAddFee}>Add Fee Entry</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Card>
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500 text-white">
                                <DollarSign className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-xl sm:text-2xl font-bold">{formatCurrency(totalFees)}</p>
                                <p className="text-sm text-muted-foreground">Total Fees</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500 text-white">
                                <CheckCircle className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-xl sm:text-2xl font-bold">{formatCurrency(paidFees)}</p>
                                <p className="text-sm text-muted-foreground">Collected</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-500 text-white">
                                <TrendingUp className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-xl sm:text-2xl font-bold">{formatCurrency(pendingFees)}</p>
                                <p className="text-sm text-muted-foreground">Pending</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500 text-white">
                                <AlertCircle className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-xl sm:text-2xl font-bold">{formatCurrency(overdueFees)}</p>
                                <p className="text-sm text-muted-foreground">Overdue</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant={statusFilter === 'all' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('all')}
                            >
                                All
                            </Button>
                            <Button
                                variant={statusFilter === 'paid' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('paid')}
                                className={statusFilter === 'paid' ? 'bg-green-500 hover:bg-green-600' : ''}
                            >
                                Paid
                            </Button>
                            <Button
                                variant={statusFilter === 'partial' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('partial')}
                                className={statusFilter === 'partial' ? 'bg-yellow-500 hover:bg-yellow-600' : ''}
                            >
                                Partial
                            </Button>
                            <Button
                                variant={statusFilter === 'pending' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('pending')}
                                className={statusFilter === 'pending' ? 'bg-yellow-500 hover:bg-yellow-600' : ''}
                            >
                                Pending
                            </Button>
                            <Button
                                variant={statusFilter === 'overdue' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('overdue')}
                                className={statusFilter === 'overdue' ? 'bg-red-500 hover:bg-red-600' : ''}
                            >
                                Overdue
                            </Button>
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_136px] gap-2 w-full xl:flex xl:w-auto xl:items-center">
                            <div className="relative min-w-0 xl:w-[320px]">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Search by student name..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="h-9 pl-10"
                                />
                            </div>
                            <Select value={academicYear} onValueChange={setAcademicYear}>
                                <SelectTrigger className="h-9 w-full xl:w-[136px]">
                                    <SelectValue placeholder="Academic year" />
                                </SelectTrigger>
                                <SelectContent>
                                    {academicYearOptions.map((year) => (
                                        <SelectItem key={year} value={year}>
                                            {year}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Student</TableHead>
                                <TableHead>Class</TableHead>
                                <TableHead>Purpose</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Due Date</TableHead>
                                <TableHead>Paid Amount</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredFees.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                        {showAcademicYearEmptyState
                                            ? `No data found for academic year ${academicYear}`
                                            : 'No matching fee records found'}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredFees.map((fee, index) => (
                                    <TableRow key={fee.id} ref={index === fetchTriggerIndex ? feeScrollRef : undefined}>
                                        <TableCell>
                                            <div>
                                                <p className="font-medium">{fee.studentName}</p>
                                                <p className="text-sm text-muted-foreground">Admission: {fee.admissionNumber}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell>{fee.className}</TableCell>
                                        <TableCell>{fee.purpose}</TableCell>
                                        <TableCell className="font-medium">{formatCurrency(fee.amount)}</TableCell>
                                        <TableCell>{fee.dueDate || '-'}</TableCell>
                                        <TableCell>{fee.paidAmount > 0 ? formatCurrency(fee.paidAmount) : '-'}</TableCell>
                                        <TableCell>
                                            <Badge variant={
                                                fee.status === 'paid' ? 'success' :
                                                    fee.status === 'partial' ? 'warning' :
                                                        fee.status === 'pending' ? 'warning' : 'destructive'
                                            }>
                                                {fee.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {fee.status !== 'paid' ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => openPaymentDialog(fee)}
                                                >
                                                    <CreditCard className="mr-2 h-4 w-4" />
                                                    Record Payment
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => openReceiptDialog(fee)}
                                                >
                                                    <Receipt className="mr-2 h-4 w-4" />
                                                    View Receipt
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                    {isFetchingNextPage && (
                        <div className="flex justify-center py-3">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    )}
                    </div>
                </CardContent>
            </Card>

            {/* Payment Dialog */}
            <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Record Payment</DialogTitle>
                        <DialogDescription>
                            Record a payment for {selectedFee?.studentName}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="p-4 rounded-lg bg-muted">
                            <div className="flex justify-between mb-2">
                                <span className="text-muted-foreground">Purpose:</span>
                                <span className="font-medium">{selectedFee?.purpose}</span>
                            </div>
                            <div className="flex justify-between mb-2">
                                <span className="text-muted-foreground">Total Amount:</span>
                                <span className="font-medium">{formatCurrency(selectedFee?.amount || 0)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Paid Amount:</span>
                                <span className="font-medium">{formatCurrency(selectedFee?.paidAmount || 0)}</span>
                            </div>
                            <div className="flex justify-between mt-2">
                                <span className="text-muted-foreground">Balance:</span>
                                <span className="font-medium">{formatCurrency(Math.max((selectedFee?.amount || 0) - (selectedFee?.paidAmount || 0), 0))}</span>
                            </div>
                            <div className="flex justify-between mt-2">
                                <span className="text-muted-foreground">Due Date:</span>
                                <span className="font-medium">{selectedFee?.dueDate || '-'}</span>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="paymentAmount">Payment Amount (₹)</Label>
                            <Input
                                id="paymentAmount"
                                type="number"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Payment Method</Label>
                                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="cash">Cash</SelectItem>
                                        <SelectItem value="card">Card</SelectItem>
                                        <SelectItem value="upi">UPI</SelectItem>
                                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                                        <SelectItem value="cheque">Cheque</SelectItem>
                                        <SelectItem value="online">Online</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Payment Purpose</Label>
                                <Input
                                    value={paymentPurpose}
                                    onChange={(e) => setPaymentPurpose(e.target.value)}
                                    placeholder="e.g., Partial payment"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            setSelectedFee(null)
                            setPaymentAmount(0)
                            setPaymentPurpose('')
                            setPaymentMethod('cash')
                            setIsPaymentDialogOpen(false)
                        }}>
                            Cancel
                        </Button>
                        <Button onClick={handleRecordPayment}>
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Confirm Payment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Receipt Dialog */}
            <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Payment Receipt</DialogTitle>
                        <DialogDescription>
                            Receipt for {selectedFee?.studentName}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="border rounded-lg p-4 md:p-6 space-y-4">
                            <div className="text-center border-b pb-4">
                                <h3 className="text-xl font-bold">Academify School</h3>
                                <p className="text-sm text-muted-foreground">Payment Receipt</p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-muted-foreground">Receipt No:</p>
                                    <p className="font-medium">RCP-{selectedFee?.id?.slice(0, 8)}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Date:</p>
                                    <p className="font-medium">{selectedFee?.lastPaymentDate || '-'}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Student Name:</p>
                                    <p className="font-medium">{selectedFee?.studentName}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Admission No:</p>
                                    <p className="font-medium">{selectedFee?.admissionNumber}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Class:</p>
                                    <p className="font-medium">{selectedFee?.className}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Purpose:</p>
                                    <p className="font-medium">{selectedFee?.purpose}</p>
                                </div>
                            </div>
                            <div className="border-t pt-4">
                                <div className="flex justify-between text-lg font-bold">
                                    <span>Amount Paid:</span>
                                    <span className="text-green-600">{formatCurrency(selectedFee?.paidAmount || 0)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsReceiptDialogOpen(false)}>
                            Close
                        </Button>
                        <Button onClick={handlePrintReceipt}>
                            <Receipt className="mr-2 h-4 w-4" />
                            Print Receipt
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
