"use client"

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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
    Search,
    Plus,
    MoreHorizontal,
    Edit,
    Trash2,
    FileSpreadsheet,
    FileDown,
    Eye,
    UserCog,
    DollarSign,
    Loader2,
} from 'lucide-react'
import { Staff } from '@/types'
import { getInitials, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import { useStaff, useCreateStaff, useUpdateStaff, useDeleteStaff } from '@/hooks/useAdminStaff'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

interface StaffManagementProps {
    schoolId?: string; // Optional: If provided, filters staff by school. Super admins may omit to see all.
    enabled?: boolean; // Optional: Control query execution
}

export function StaffManagement({ schoolId, enabled = true }: StaffManagementProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
    const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null)
    const [newStaff, setNewStaff] = useState({
        name: '',
        email: '',
        phone: '',
        employeeId: '',
        designation: '',
        subjects: '',
        salary: '',
        qualification: '',
        experience: '',
        address: '',
        dateOfBirth: '',
        emergencyContact: '',
        bloodGroup: '',
    })

    // Use Infinite Query
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        error
    } = useStaff(searchQuery, 50, schoolId, undefined, { enabled })

    // Flatten pages into a single list (filter out nulls defensively)
    const staffList = (data?.pages.flatMap(page => page.staff) || []).filter(
        (s): s is Staff => s !== null && s !== undefined
    )

    // Infinite Scroll Logic (Intersection Observer)
    const { ref: scrollRef, inView } = useIntersectionObserver({ threshold: 0.1 })

    useEffect(() => {
        if (inView && hasNextPage && !isFetchingNextPage) {
            fetchNextPage()
        }
    }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

    const createMutation = useCreateStaff()
    const updateMutation = useUpdateStaff()
    const deleteMutation = useDeleteStaff()

    const handleAddStaff = () => {
        if (!newStaff.name || !newStaff.email || !newStaff.designation) {
            toast.error('Please fill in all required fields')
            return
        }

        const payload = {
            ...newStaff,
            full_name: newStaff.name,
            salary: parseFloat(newStaff.salary) || 0,
            experience: parseInt(newStaff.experience) || 0,
            subjects: newStaff.subjects ? newStaff.subjects.split(',').map(s => s.trim()) : [],
            schoolId: schoolId
        }

        createMutation.mutate(payload, {
            onSuccess: () => {
                setIsAddDialogOpen(false)
                resetForm()
            }
        })
    }

    const resetForm = () => {
        setNewStaff({
            name: '',
            email: '',
            phone: '',
            employeeId: '',
            designation: '',
            subjects: '',
            salary: '',
            qualification: '',
            experience: '',
            address: '',
            dateOfBirth: '',
            emergencyContact: '',
            bloodGroup: '',
        })
        setSelectedStaff(null)
    }

    const handleEditStaff = (staff: Staff) => {
        setSelectedStaff(staff)
        setNewStaff({
            name: staff.name,
            email: staff.email,
            phone: staff.phone || '',
            employeeId: staff.employeeId,
            designation: staff.designation,
            subjects: '', // Subjects not easily available in list view, might need detail fetch or just empty
            salary: staff.salary?.toString() || '',
            qualification: staff.qualification || '',
            experience: staff.experience?.toString() || '',
            address: staff.address || '',
            dateOfBirth: staff.dateOfBirth || '',
            emergencyContact: staff.emergencyContact || '',
            bloodGroup: staff.bloodGroup || '',
        })
        setIsEditDialogOpen(true)
    }

    const handleUpdateStaff = () => {
        if (!selectedStaff) return
        if (!newStaff.name || !newStaff.designation) {
            toast.error('Please fill in required fields')
            return
        }

        const payload = {
            full_name: newStaff.name,
            phone: newStaff.phone,
            avatar: '',
            designation: newStaff.designation,
            qualification: newStaff.qualification,
            experience: parseInt(newStaff.experience) || 0,
            salary: parseFloat(newStaff.salary) || 0,
            subjects: newStaff.subjects ? newStaff.subjects.split(',').map(s => s.trim()) : [],
        }

        updateMutation.mutate({ id: selectedStaff.id, data: payload, schoolId: schoolId }, {
            onSuccess: () => {
                setIsEditDialogOpen(false)
                resetForm()
            }
        })
    }

    const handleDeleteStaff = (staff: Staff | null) => {
        if (!staff) return
        if (confirm(`Are you sure you want to delete ${staff.name}? This action cannot be undone.`)) {
            deleteMutation.mutate({ id: staff.id, staffType: staff.staffType, schoolId: schoolId }, {
                onSuccess: () => {
                    setIsDeleteDialogOpen(false)
                    setSelectedStaff(null)
                }
            })
        }
    }

    const handleExport = () => {
        const csvContent = [
            ['Name', 'Email', 'Employee ID', 'Designation', 'Salary'].join(','),
            ...filteredStaff.map((s: Staff) =>
                [
                    s.name,
                    s.email,
                    s.employeeId,
                    s.designation,
                    s.salary || 0
                ].join(',')
            )
        ].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `staff-export-${new Date().toISOString().split('T')[0]}.csv`
        a.click()
        window.URL.revokeObjectURL(url)
        toast.success('Staff data exported successfully')
    }

    const filteredStaff = useMemo(() => {
        return staffList
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
    }, [staffList])

    const fetchTriggerIndex = filteredStaff.length > 0 ? Math.max(0, Math.floor(filteredStaff.length * 0.8) - 1) : -1

    const totalSalary = staffList.reduce(
        (acc: number, curr: Staff) => acc + (Number(curr?.salary ?? 0) || 0),
        0
    )
    const stats = {
        total: data?.pages[0]?.total || 0,
        totalSalary: totalSalary,
        avgSalary: staffList.length > 0 ? totalSalary / staffList.length : 0,
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (error) {
        return <div className="p-8 text-center text-red-500">Error loading staff data.</div>
    }

    return (
        <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 border-0">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                                <UserCog className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-white">{stats.total}</p>
                                <p className="text-sm text-blue-100">Total Staff</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
                                <DollarSign className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{formatCurrency(stats.totalSalary)}</p>
                                <p className="text-sm text-muted-foreground">Total Salary</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/30">
                                <DollarSign className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{formatCurrency(stats.avgSalary)}</p>
                                <p className="text-sm text-muted-foreground">Average Salary</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Staff Table */}
            <Card>
                <div className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search staff..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div className="flex gap-3">
                            <Button variant="outline" onClick={() => document.getElementById('import-staff')?.click()}>
                                <FileDown className="mr-2 h-4 w-4" />
                                Import
                            </Button>
                            <input
                                id="import-staff"
                                type="file"
                                accept=".csv,.xlsx,.xls"
                                className="hidden"
                                onChange={() => { }} // Placeholder
                            />
                            <Button variant="outline" onClick={handleExport}>
                                <FileSpreadsheet className="mr-2 h-4 w-4" />
                                Export
                            </Button>
                            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90">
                                        <Plus className="mr-2 h-4 w-4" />
                                        Add Staff
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[650px]">
                                    <DialogHeader>
                                        <DialogTitle>Add New Staff Member</DialogTitle>
                                        <DialogDescription>
                                            Add a new non-teaching staff member to the school.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-4 py-4 max-h-[65vh] overflow-y-auto">
                                        {/* Form fields */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="grid gap-2">
                                                <Label htmlFor="name">Full Name *</Label>
                                                <Input
                                                    id="name"
                                                    placeholder="Enter full name"
                                                    value={newStaff.name}
                                                    onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                                                />
                                            </div>
                                            <div className="grid gap-2">
                                                <Label htmlFor="email">Email Address *</Label>
                                                <Input
                                                    id="email"
                                                    type="email"
                                                    placeholder="Enter email"
                                                    value={newStaff.email}
                                                    onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="employeeId">Employee ID (Optional)</Label>
                                            <Input
                                                id="employeeId"
                                                value={newStaff.employeeId}
                                                onChange={(e) => setNewStaff({ ...newStaff, employeeId: e.target.value })}
                                                placeholder="Auto-generated if empty"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="grid gap-2">
                                                <Label htmlFor="designation">Designation *</Label>
                                                <Select
                                                    value={newStaff.designation}
                                                    onValueChange={(val) => setNewStaff({ ...newStaff, designation: val })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select designation" />
                                                    </SelectTrigger>
                                                    <SelectContent className="max-h-[200px]">
                                                        {[
                                                            "Principal", "Vice Principal", "Head of Department",
                                                            "Teacher", "Assistant Teacher", "Substitute Teacher",
                                                            "Librarian", "Lab Assistant",
                                                            "Accountant", "Clerk", "Admin Officer", "Receptionist",
                                                            "Driver", "Conductor", "Security Guard",
                                                            "Cleaner", "Peon", "Sports Coach", "Nurse", "Counselor"
                                                        ].sort().map((role) => (
                                                            <SelectItem key={role} value={role}>{role}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="grid gap-2">
                                                <Label htmlFor="salary">Salary</Label>
                                                <Input type="number" id="salary" value={newStaff.salary} onChange={(e) => setNewStaff({ ...newStaff, salary: e.target.value })} />
                                            </div>
                                            <div className="grid gap-2">
                                                <Label htmlFor="experience">Experience (Years)</Label>
                                                <Input type="number" id="experience" value={newStaff.experience} onChange={(e) => setNewStaff({ ...newStaff, experience: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="qualification">Qualification</Label>
                                            <Input id="qualification" value={newStaff.qualification} onChange={(e) => setNewStaff({ ...newStaff, qualification: e.target.value })} />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                                        <Button onClick={handleAddStaff} disabled={createMutation.isPending}>
                                            {createMutation.isPending ? 'Adding...' : 'Add Staff Member'}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Staff Member</TableHead>
                                    <TableHead>Employee ID</TableHead>
                                    <TableHead>Designation</TableHead>
                                    <TableHead>Salary</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredStaff.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                            No staff members found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredStaff.map((member: Staff, index: number) => (
                                        <TableRow key={member.id} className="hover:bg-muted/50" ref={index === fetchTriggerIndex ? scrollRef : undefined}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={member.avatar} />
                                                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500 text-white">
                                                            {getInitials(member.name)}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-medium">{member.name}</p>
                                                        <p className="text-sm text-muted-foreground">{member.email}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">{member.employeeId}</TableCell>
                                            <TableCell className="text-sm">{member.designation}</TableCell>
                                            <TableCell className="font-medium">{formatCurrency(member.salary)}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => { setSelectedStaff(member); setIsViewDialogOpen(true) }}>
                                                            <Eye className="mr-2 h-4 w-4" />
                                                            View Details
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleEditStaff(member)}>
                                                            <Edit className="mr-2 h-4 w-4" />
                                                            Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteStaff(member)}>
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Remove
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    {isFetchingNextPage && (
                        <div className="flex justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    )}
                </div>
            </Card>

            {/* View Details Dialog */}
            <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
                <DialogContent className="sm:max-w-[700px]">
                    <DialogHeader>
                        <DialogTitle>Staff Member Details</DialogTitle>
                    </DialogHeader>
                    {selectedStaff && (
                        <div className="p-4 space-y-6">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-20 w-20">
                                    <AvatarImage src={selectedStaff.avatar} />
                                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500 text-white text-xl">
                                        {getInitials(selectedStaff.name)}
                                    </AvatarFallback>
                                </Avatar>
                                <div>
                                    <h3 className="text-xl font-bold">{selectedStaff.name}</h3>
                                    <p className="text-muted-foreground">{selectedStaff.email}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <Badge>{selectedStaff.designation}</Badge>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6 border-t pt-6">
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Employee ID</p>
                                    <p className="font-medium">{selectedStaff.employeeId}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Phone Number</p>
                                    <p className="font-medium">{selectedStaff.phone || 'N/A'}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Qualification</p>
                                    <p className="font-medium">{selectedStaff.qualification || 'N/A'}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Experience</p>
                                    <p className="font-medium">{selectedStaff.experience} Years</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Join Date</p>
                                    <p className="font-medium">{selectedStaff.joinDate || 'N/A'}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Salary</p>
                                    <p className="font-medium">{formatCurrency(selectedStaff.salary)}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="sm:max-w-[650px]">
                    <DialogHeader>
                        <DialogTitle>Edit Staff Member</DialogTitle>
                    </DialogHeader>
                    {/* Reuse form logic - ideally componentize, but duplicating for speed and context awareness */}
                    <div className="grid gap-4 py-4 max-h-[65vh] overflow-y-auto">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit-name">Full Name *</Label>
                                <Input
                                    id="edit-name"
                                    value={newStaff.name}
                                    onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-phone">Phone</Label>
                                <Input
                                    id="edit-phone"
                                    type="tel"
                                    inputMode="numeric"
                                    maxLength={10}
                                    placeholder="10-digit mobile number"
                                    value={newStaff.phone}
                                    onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit-designation">Designation *</Label>
                                <Select
                                    value={newStaff.designation}
                                    onValueChange={(val) => setNewStaff({ ...newStaff, designation: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select designation" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-[200px]">
                                        {[
                                            "Principal", "Vice Principal", "Head of Department",
                                            "Teacher", "Assistant Teacher", "Substitute Teacher",
                                            "Librarian", "Lab Assistant",
                                            "Accountant", "Clerk", "Admin Officer", "Receptionist",
                                            "Driver", "Conductor", "Security Guard",
                                            "Cleaner", "Peon", "Sports Coach", "Nurse", "Counselor"
                                        ].sort().map((role) => (
                                            <SelectItem key={role} value={role}>{role}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit-salary">Salary</Label>
                                <Input type="number" id="edit-salary" value={newStaff.salary} onChange={(e) => setNewStaff({ ...newStaff, salary: e.target.value })} />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-experience">Experience (Years)</Label>
                                <Input type="number" id="edit-experience" value={newStaff.experience} onChange={(e) => setNewStaff({ ...newStaff, experience: e.target.value })} />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="edit-qualification">Qualification</Label>
                            <Input id="edit-qualification" value={newStaff.qualification} onChange={(e) => setNewStaff({ ...newStaff, qualification: e.target.value })} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleUpdateStaff} disabled={updateMutation.isPending}>
                            {updateMutation.isPending ? 'Updating...' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
