"use client"

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
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
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Search, FileSpreadsheet, Users, Loader2, Pencil, IndianRupee, GraduationCap, Wrench } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useStaff, useUpdateStaff } from '@/hooks/useAdminStaff'
import { useTeachers, useUpdateTeacher } from '@/hooks/useAdminTeachers'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'

interface SalaryRow {
    id: string
    userId: string
    name: string
    email: string
    role: 'teacher' | 'staff'
    designation: string
    phone: string
    salary: number
}

function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export default function SalaryManagementPage() {
    const { user, isLoading, userRole } = useAuth()
    const searchParams = useSearchParams()
    const schoolId = searchParams.get('school_id') || undefined
    const isSuperAdmin = userRole === 'super_admin'
    const canLoad = !!user && !isLoading && (!isSuperAdmin || !!schoolId)

    const [searchQuery, setSearchQuery] = useState('')
    const [activeTab, setActiveTab] = useState<'all' | 'teachers' | 'staff'>('all')
    const [designationFilter, setDesignationFilter] = useState('all')
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [selectedRow, setSelectedRow] = useState<SalaryRow | null>(null)
    const [editSalary, setEditSalary] = useState('')

    const { data: staffData, isLoading: staffLoading } = useStaff('', 200, schoolId, undefined, { enabled: canLoad })
    const allStaff = useMemo(() => staffData?.pages.flatMap(p => p.staff) ?? [], [staffData])

    const { data: teacherData, isLoading: teacherLoading } = useTeachers('', 200, schoolId, undefined, { enabled: canLoad })
    const allTeachers = useMemo(() => teacherData?.pages.flatMap(p => p.teachers) ?? [], [teacherData])

    const updateStaff = useUpdateStaff()
    const updateTeacher = useUpdateTeacher()

    // Unified roster
    const allRows = useMemo<SalaryRow[]>(() => {
        const staffRows: SalaryRow[] = allStaff.map(s => ({
            id: s.id,
            userId: s.userId || '',
            name: s.name,
            email: s.email,
            role: 'staff',
            designation: s.designation || 'Staff',
            phone: s.phone || '',
            salary: s.salary || 0,
        }))
        const teacherRows: SalaryRow[] = allTeachers.map(t => ({
            id: t.id,
            userId: t.userId || '',
            name: t.name,
            email: t.email,
            role: 'teacher',
            designation: t.department || 'Teacher',
            phone: t.phone || '',
            salary: t.salary || 0,
        }))
        return [...teacherRows, ...staffRows]
    }, [allStaff, allTeachers])

    // Stats
    const totalPayroll = useMemo(() => allRows.reduce((sum, r) => sum + r.salary, 0), [allRows])
    const teacherPayroll = useMemo(() => allRows.filter(r => r.role === 'teacher').reduce((sum, r) => sum + r.salary, 0), [allRows])
    const staffPayroll = useMemo(() => allRows.filter(r => r.role === 'staff').reduce((sum, r) => sum + r.salary, 0), [allRows])

    const staffDesignations = useMemo(() =>
        [...new Set(allStaff.map(s => s.designation).filter((d): d is string => !!d))].sort(),
        [allStaff])

    // Filtered rows
    const filteredRows = useMemo(() => {
        let rows = allRows
        if (activeTab === 'teachers') rows = rows.filter(r => r.role === 'teacher')
        else if (activeTab === 'staff') rows = rows.filter(r => r.role === 'staff')

        if (designationFilter !== 'all' && activeTab === 'staff') {
            rows = rows.filter(r => r.designation === designationFilter)
        }

        const q = searchQuery.trim().toLowerCase()
        if (q) rows = rows.filter(r =>
            r.name.toLowerCase().includes(q) ||
            r.userId.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            r.designation.toLowerCase().includes(q)
        )

        return [...rows].sort((a, b) => a.name.localeCompare(b.name))
    }, [allRows, activeTab, designationFilter, searchQuery])

    const isPageLoading = staffLoading || teacherLoading

    const handleEditSalary = (row: SalaryRow) => {
        setSelectedRow(row)
        setEditSalary(row.salary > 0 ? String(row.salary) : '')
        setIsEditDialogOpen(true)
    }

    const handleSaveSalary = () => {
        if (!selectedRow) return
        const salary = parseFloat(editSalary)
        if (isNaN(salary) || salary < 0) {
            toast.error('Enter a valid salary amount')
            return
        }
        if (selectedRow.role === 'staff') {
            updateStaff.mutate({ id: selectedRow.id, data: { salary } }, {
                onSuccess: () => setIsEditDialogOpen(false),
            })
        } else {
            updateTeacher.mutate({ id: selectedRow.id, data: { salary } }, {
                onSuccess: () => setIsEditDialogOpen(false),
            })
        }
    }

    const handleExport = () => {
        const csv = [
            ['Name', 'Email', 'User ID', 'Role', 'Designation', 'Phone', 'Monthly Salary (INR)'].join(','),
            ...filteredRows.map(r => [
                `"${r.name}"`,
                r.email,
                r.userId,
                r.role,
                `"${r.designation}"`,
                r.phone,
                r.salary,
            ].join(','))
        ].join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'salary-records.csv'
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Exported salary records')
    }

    const handleTabChange = (v: string) => {
        setActiveTab(v as 'all' | 'teachers' | 'staff')
        setDesignationFilter('all')
    }

    const isSaving = updateStaff.isPending || updateTeacher.isPending

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-xl md:text-3xl font-bold">Salary Management</h1>
                    <p className="text-muted-foreground">Monthly payroll overview for teachers and staff</p>
                </div>
                <Button variant="outline" onClick={handleExport} className="h-9 shrink-0 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm">
                    <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                    <span className="whitespace-nowrap">Export CSV</span>
                </Button>
            </div>

            {/* Stats */}
            <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
                <Card>
                    <CardContent className="p-3 md:p-6">
                        <div className="flex items-center gap-3 md:gap-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white md:h-12 md:w-12">
                                <IndianRupee className="h-5 w-5 md:h-6 md:w-6" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-lg font-bold leading-tight md:text-2xl">{formatCurrency(totalPayroll)}</p>
                                <p className="text-xs text-muted-foreground md:text-sm">Total Monthly Payroll</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 md:p-6">
                        <div className="flex items-center gap-3 md:gap-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white md:h-12 md:w-12">
                                <GraduationCap className="h-5 w-5 md:h-6 md:w-6" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-lg font-bold leading-tight md:text-2xl">{formatCurrency(teacherPayroll)}</p>
                                <p className="text-xs text-muted-foreground md:text-sm">Teachers Payroll</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 md:p-6">
                        <div className="flex items-center gap-3 md:gap-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white md:h-12 md:w-12">
                                <Wrench className="h-5 w-5 md:h-6 md:w-6" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-lg font-bold leading-tight md:text-2xl">{formatCurrency(staffPayroll)}</p>
                                <p className="text-xs text-muted-foreground md:text-sm">Staff Payroll</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 md:p-6">
                        <div className="flex items-center gap-3 md:gap-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white md:h-12 md:w-12">
                                <Users className="h-5 w-5 md:h-6 md:w-6" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-lg font-bold leading-tight md:text-2xl">{allRows.length}</p>
                                <p className="text-xs text-muted-foreground md:text-sm">Total Employees</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Table */}
            <Card>
                <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <div className="flex flex-col gap-3 p-4 border-b lg:flex-row lg:items-center">
                        <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-muted/70 p-1 sm:inline-grid sm:w-auto sm:min-w-fit">
                            <TabsTrigger value="all" className="min-w-0 rounded-lg px-2 py-2 text-[11px] font-medium leading-tight sm:min-w-[112px] sm:px-3 sm:text-sm">
                                <span className="truncate">All ({allRows.length})</span>
                            </TabsTrigger>
                            <TabsTrigger value="teachers" className="min-w-0 rounded-lg px-2 py-2 text-[11px] font-medium leading-tight sm:min-w-[112px] sm:px-3 sm:text-sm">
                                <span className="truncate">Teachers ({allTeachers.length})</span>
                            </TabsTrigger>
                            <TabsTrigger value="staff" className="min-w-0 rounded-lg px-2 py-2 text-[11px] font-medium leading-tight sm:min-w-[112px] sm:px-3 sm:text-sm">
                                <span className="truncate">Staff ({allStaff.length})</span>
                            </TabsTrigger>
                        </TabsList>
                        <div className="flex flex-1 gap-2 lg:ml-auto">
                            <div className="relative flex-1">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search name, ID, email…"
                                    className="pl-8"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                            </div>
                            {activeTab === 'staff' && staffDesignations.length > 0 && (
                                <Select value={designationFilter} onValueChange={setDesignationFilter}>
                                    <SelectTrigger className="w-[160px]">
                                        <SelectValue placeholder="Designation" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Designations</SelectItem>
                                        {staffDesignations.map(d => (
                                            <SelectItem key={d} value={d}>{d}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    <TabsContent value={activeTab} className="m-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Employee</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead className="hidden md:table-cell">User ID</TableHead>
                                        <TableHead className="hidden lg:table-cell">Phone</TableHead>
                                        <TableHead>Monthly Salary</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isPageLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-14">
                                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-14 text-muted-foreground">
                                                {searchQuery ? 'No employees match your search.' : 'No employees found.'}
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredRows.map(row => (
                                        <TableRow key={`${row.role}-${row.id}`}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${row.role === 'teacher' ? 'bg-emerald-500' : 'bg-violet-500'}`}>
                                                        {getInitials(row.name)}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-medium truncate">{row.name}</p>
                                                        <p className="text-xs text-muted-foreground truncate">{row.email}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    <Badge variant={row.role === 'teacher' ? 'default' : 'secondary'} className="w-fit capitalize">
                                                        {row.role}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">{row.designation}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground max-w-[140px] truncate">
                                                {row.userId || '—'}
                                            </TableCell>
                                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                                                {row.phone || '—'}
                                            </TableCell>
                                            <TableCell>
                                                {row.salary > 0
                                                    ? <span className="font-semibold">{formatCurrency(row.salary)}</span>
                                                    : <span className="text-muted-foreground text-sm italic">Not set</span>
                                                }
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => handleEditSalary(row)} className="gap-1.5">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    Edit
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>
                </Tabs>
            </Card>

            {/* Edit Salary Dialog */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Edit Salary</DialogTitle>
                        <DialogDescription>
                            Update the monthly salary for this employee.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedRow && (
                        <div className="py-2 space-y-4">
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${selectedRow.role === 'teacher' ? 'bg-emerald-500' : 'bg-violet-500'}`}>
                                    {getInitials(selectedRow.name)}
                                </div>
                                <div className="min-w-0">
                                    <p className="font-medium truncate">{selectedRow.name}</p>
                                    <p className="text-xs text-muted-foreground capitalize">{selectedRow.role} · {selectedRow.designation}</p>
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="salary-input">Monthly Salary (₹)</Label>
                                <Input
                                    id="salary-input"
                                    type="number"
                                    min={0}
                                    placeholder="e.g. 25000"
                                    value={editSalary}
                                    onChange={e => setEditSalary(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveSalary() }}
                                />
                                {selectedRow.salary > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        Current: <span className="font-medium">{formatCurrency(selectedRow.salary)}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveSalary} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
