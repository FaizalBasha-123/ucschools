"use client"

import { useRef, useState, type ChangeEvent } from 'react'
import { Plus, Search, Edit2, Trash2, MoreVertical, Mail, Phone as PhoneIcon, Eye, EyeOff, FileSpreadsheet, Loader2, Check, X, AlertTriangle } from 'lucide-react'
import { useInfiniteSchoolUsers, useCreateUser, useUpdateUser, useDeleteUser, User } from '@/hooks/useSchools'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'

interface UserManagementProps {
    role: 'admin' | 'teacher' | 'student';
    schoolId: string;
}

type ImportRow = Record<string, string>
type ImportColumn = {
    key: string
    label: string
    required: boolean
    rule: string
}
type ImportSchema = {
    role: string
    title: string
    columns: ImportColumn[]
    sampleRows: ImportRow[]
}

const IMPORT_SCHEMAS: Record<string, ImportSchema> = {
    admin: {
        role: 'admin',
        title: 'Admin import',
        columns: [
            { key: 'full_name', label: 'full_name', required: true, rule: 'Required. Stored in users.full_name.' },
            { key: 'email', label: 'email', required: true, rule: 'Required. Must be a valid unique email.' },
            { key: 'password', label: 'password', required: true, rule: 'Required. Minimum 6 characters.' },
            { key: 'phone', label: 'phone', required: false, rule: 'Optional. Digits only.' },
        ],
        sampleRows: [
            { full_name: 'Ananya Sharma', email: 'ananya.admin@school.edu', password: 'Admin@123', phone: '9876543210' },
            { full_name: 'Rahul Verma', email: 'rahul.admin@school.edu', password: 'Admin@456', phone: '' },
        ],
    },
    teacher: {
        role: 'teacher',
        title: 'Teacher import',
        columns: [
            { key: 'full_name', label: 'full_name', required: true, rule: 'Required. Stored in users.full_name.' },
            { key: 'email', label: 'email', required: true, rule: 'Required. Must be a valid unique email.' },
            { key: 'password', label: 'password', required: true, rule: 'Required. Minimum 6 characters.' },
            { key: 'phone', label: 'phone', required: false, rule: 'Optional. Digits only.' },
            { key: 'employee_id', label: 'employee_id', required: false, rule: 'Optional. Teacher employee code.' },
            { key: 'designation', label: 'designation', required: false, rule: 'Optional. Stored in teachers.designation.' },
            { key: 'qualifications', label: 'qualifications', required: false, rule: 'Optional. Comma-separated values.' },
            { key: 'subjects_taught', label: 'subjects_taught', required: false, rule: 'Optional. Comma-separated subject names.' },
            { key: 'experience_years', label: 'experience_years', required: false, rule: 'Optional. Integer only.' },
            { key: 'hire_date', label: 'hire_date', required: false, rule: 'Optional. Format YYYY-MM-DD.' },
            { key: 'salary', label: 'salary', required: false, rule: 'Optional. Numeric value only.' },
            { key: 'status', label: 'status', required: false, rule: 'Optional. Defaults to active when blank.' },
        ],
        sampleRows: [
            {
                full_name: 'Ananya Sharma',
                email: 'ananya.teacher@school.edu',
                password: 'Teach@123',
                phone: '9876543210',
                employee_id: 'T-101',
                designation: 'Senior Teacher',
                qualifications: 'B.Sc,M.Sc,B.Ed',
                subjects_taught: 'Physics,Chemistry',
                experience_years: '6',
                hire_date: '2024-06-10',
                salary: '42000',
                status: 'active',
            },
        ],
    },
    student: {
        role: 'student',
        title: 'Student import',
        columns: [
            { key: 'full_name', label: 'full_name', required: true, rule: 'Required. Stored in users.full_name.' },
            { key: 'email', label: 'email', required: true, rule: 'Required. Must be a valid unique email.' },
            { key: 'password', label: 'password', required: true, rule: 'Required. Minimum 6 characters.' },
            { key: 'phone', label: 'phone', required: false, rule: 'Optional. Digits only.' },
            { key: 'roll_number', label: 'roll_number', required: false, rule: 'Optional. Student roll number.' },
            { key: 'admission_number', label: 'admission_number', required: false, rule: 'Optional. Auto-generated when blank.' },
            { key: 'date_of_birth', label: 'date_of_birth', required: false, rule: 'Optional. Format YYYY-MM-DD.' },
            { key: 'gender', label: 'gender', required: false, rule: 'Optional. Defaults to other when blank.' },
            { key: 'parent_name', label: 'parent_name', required: false, rule: 'Optional.' },
            { key: 'parent_phone', label: 'parent_phone', required: false, rule: 'Optional. Digits only.' },
            { key: 'parent_email', label: 'parent_email', required: false, rule: 'Optional. Must be a valid email if provided.' },
            { key: 'address', label: 'address', required: false, rule: 'Optional.' },
        ],
        sampleRows: [
            {
                full_name: 'Ravi Kumar',
                email: 'ravi.student@school.edu',
                password: 'Stud@123',
                phone: '9876500001',
                roll_number: '18',
                admission_number: '',
                date_of_birth: '2012-08-15',
                gender: 'male',
                parent_name: 'Suresh Kumar',
                parent_phone: '9876500010',
                parent_email: 'suresh.kumar@school.edu',
                address: 'Chennai',
            },
        ],
    },
}

const normalizeImportCell = (value: unknown) => {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

export function UserManagement({ role, schoolId }: UserManagementProps) {
    const {
        data: usersData,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage
    } = useInfiniteSchoolUsers(schoolId, role, 50)

    const createUserMutation = useCreateUser()
    const updateUserMutation = useUpdateUser()
    const deleteUserMutation = useDeleteUser()
    const queryClient = useQueryClient()

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [showPassword, setShowPassword] = useState(false)

    // Import/Export state
    const [isImportPanelOpen, setIsImportPanelOpen] = useState(false)
    const [importFileName, setImportFileName] = useState('')
    const [importRows, setImportRows] = useState<ImportRow[]>([])
    const [importPreviewRows, setImportPreviewRows] = useState<ImportRow[]>([])
    const [importValidationErrors, setImportValidationErrors] = useState<string[]>([])
    const [isImportingUsers, setIsImportingUsers] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        password: '',
        phone: '',
    })

    const selectedImportSchema = IMPORT_SCHEMAS[role]


    const resetForm = () => {
        setFormData({ full_name: '', email: '', password: '', phone: '' })
        setEditingUser(null)
    }

    const resetImportState = () => {
        setImportFileName('')
        setImportRows([])
        setImportPreviewRows([])
        setImportValidationErrors([])
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const validateImportedRows = (rows: ImportRow[], schema: ImportSchema) => {
        const errors: string[] = []
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/

        rows.forEach((row, index) => {
            const rowNumber = index + 2
            const phone = (row.phone || '').replace(/\s+/g, '')
            const parentPhone = (row.parent_phone || '').replace(/\s+/g, '')

            schema.columns.forEach((column) => {
                if (column.required && !normalizeImportCell(row[column.key])) {
                    errors.push(`Row ${rowNumber}: ${column.key} is mandatory and cannot be empty.`)
                }
            })

            if (row.email?.trim() && !emailRegex.test(row.email.trim())) {
                errors.push(`Row ${rowNumber}: email must be a valid email address.`)
            }
            if (row.password?.trim() && row.password.trim().length < 6) {
                errors.push(`Row ${rowNumber}: password must be at least 6 characters.`)
            }
            if (phone && !/^\d+$/.test(phone)) {
                errors.push(`Row ${rowNumber}: phone can contain digits only.`)
            }
            if (parentPhone && !/^\d+$/.test(parentPhone)) {
                errors.push(`Row ${rowNumber}: parent_phone can contain digits only.`)
            }
            if (row.parent_email?.trim() && !emailRegex.test(row.parent_email.trim())) {
                errors.push(`Row ${rowNumber}: parent_email must be a valid email address.`)
            }
            if (row.hire_date?.trim() && !dateRegex.test(row.hire_date.trim())) {
                errors.push(`Row ${rowNumber}: hire_date must be in YYYY-MM-DD format.`)
            }
            if (row.date_of_birth?.trim() && !dateRegex.test(row.date_of_birth.trim())) {
                errors.push(`Row ${rowNumber}: date_of_birth must be in YYYY-MM-DD format.`)
            }
            if (row.experience_years?.trim() && !/^\d+$/.test(row.experience_years.trim())) {
                errors.push(`Row ${rowNumber}: experience_years must be a whole number.`)
            }
            if (row.salary?.trim() && Number.isNaN(Number(row.salary.trim()))) {
                errors.push(`Row ${rowNumber}: salary must be numeric.`)
            }
        })

        return errors
    }

    const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        const extension = file.name.split('.').pop()?.toLowerCase()
        if (!extension || !['xlsx', 'csv'].includes(extension)) {
            const message = 'Only .xlsx and .csv files are supported.'
            setImportValidationErrors([message])
            setImportRows([])
            setImportPreviewRows([])
            toast.error('Unsupported file type', { description: message })
            return
        }

        try {
            const buffer = await file.arrayBuffer()
            const workbook = XLSX.read(buffer, { type: 'array' })
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
            const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(firstSheet, {
                header: 1,
                raw: false,
                defval: '',
                blankrows: false,
            })

            if (matrix.length < 2) {
                const message = 'The file must include the header row and at least one data row.'
                setImportValidationErrors([message])
                setImportRows([])
                setImportPreviewRows([])
                setImportFileName(file.name)
                toast.error('Import file is empty', { description: message })
                return
            }

            const schemaHeaders = selectedImportSchema.columns.map((column) => column.key)
            const headers = (matrix[0] || []).map((cell) => normalizeImportCell(cell))
            const missingColumns = schemaHeaders.filter((column, index) => headers[index] !== column)
            const hasExtraColumns = headers.length !== schemaHeaders.length

            if (missingColumns.length > 0 || hasExtraColumns) {
                const message = `Columns must exactly match: ${schemaHeaders.join(', ')}`
                setImportValidationErrors([message])
                setImportRows([])
                setImportPreviewRows([])
                setImportFileName(file.name)
                toast.error('Column mismatch detected', { description: message })
                return
            }

            const parsedRows = matrix
                .slice(1)
                .filter((row) => row.some((cell) => normalizeImportCell(cell) !== ''))
                .map((row) => {
                    const record = {} as ImportRow
                    schemaHeaders.forEach((column, index) => {
                        record[column] = normalizeImportCell(row[index])
                    })
                    if (record.phone) record.phone = record.phone.replace(/\D/g, '')
                    if (record.parent_phone) record.parent_phone = record.parent_phone.replace(/\D/g, '')
                    return record
                })

            const rowErrors = validateImportedRows(parsedRows, selectedImportSchema)
            setImportFileName(file.name)
            setImportRows(parsedRows)
            setImportPreviewRows(parsedRows.slice(0, 5))
            setImportValidationErrors(rowErrors)

            if (rowErrors.length > 0) {
                toast.error('Import validation failed', {
                    description: rowErrors[0],
                })
            } else {
                toast.success('Import file is ready', {
                    description: `${parsedRows.length} row(s) matched the schema.`,
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read import file.'
            setImportValidationErrors([message])
            setImportRows([])
            setImportPreviewRows([])
            setImportFileName(file.name)
            toast.error('Could not parse file', { description: message })
        }
    }

    const downloadImportTemplate = (format: 'xlsx' | 'csv') => {
        const worksheet = XLSX.utils.json_to_sheet(selectedImportSchema.sampleRows, {
            header: selectedImportSchema.columns.map((column) => column.key),
        })
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, role)
        XLSX.writeFile(
            workbook,
            `${role}-import-template.${format}`,
            { bookType: format }
        )
        toast.success('Template downloaded', {
            description: `${selectedImportSchema.title} template downloaded as .${format}.`,
        })
    }

    const uploadImportedUsers = async () => {
        if (importRows.length === 0) {
            const message = 'Upload a valid .xlsx or .csv file before importing.'
            setImportValidationErrors([message])
            toast.error('No import file ready', { description: message })
            return
        }

        if (importValidationErrors.length > 0) {
            toast.error('Resolve import issues first', {
                description: importValidationErrors[0],
            })
            return
        }

        setIsImportingUsers(true)
        const failures: string[] = []
        let successCount = 0

        for (const [index, row] of importRows.entries()) {
            try {
                if (role === 'teacher') {
                    await api.post(`/admin/users?school_id=${schoolId}`, {
                        role: 'teacher',
                        data: {
                            full_name: row.full_name,
                            email: row.email,
                            password: row.password,
                            phone: row.phone || '',
                            employee_id: row.employee_id || '',
                            designation: row.designation || '',
                            qualifications: row.qualifications ? row.qualifications.split(',').map((item) => item.trim()).filter(Boolean) : [],
                            subjects_taught: row.subjects_taught ? row.subjects_taught.split(',').map((item) => item.trim()).filter(Boolean) : [],
                            experience_years: row.experience_years ? Number(row.experience_years) : undefined,
                            hire_date: row.hire_date || '',
                            salary: row.salary ? Number(row.salary) : undefined,
                            status: row.status || '',
                        },
                    })
                } else if (role === 'student') {
                    await api.post(`/admin/users?school_id=${schoolId}`, {
                        role: 'student',
                        data: {
                            full_name: row.full_name,
                            email: row.email,
                            password: row.password,
                            phone: row.phone || '',
                            roll_number: row.roll_number || '',
                            admission_number: row.admission_number || '',
                            date_of_birth: row.date_of_birth || '',
                            gender: row.gender || '',
                            parent_name: row.parent_name || '',
                            parent_phone: row.parent_phone || '',
                            parent_email: row.parent_email || '',
                            address: row.address || '',
                        },
                    })
                } else {
                    await api.post(`/admin/users?school_id=${schoolId}`, {
                        role: 'admin',
                        data: {
                            full_name: row.full_name,
                            email: row.email,
                            password: row.password,
                            phone: row.phone || '',
                        },
                    })
                }
                successCount += 1
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown import failure'
                failures.push(`Row ${index + 2}: ${message}`)
            }
        }

        setIsImportingUsers(false)
        queryClient.invalidateQueries({ queryKey: ['school-users', schoolId] })

        if (failures.length > 0) {
            setImportValidationErrors(failures)
            toast.error('Import finished with issues', {
                description: `${successCount} row(s) imported, ${failures.length} failed.`,
            })
            return
        }

        toast.success('Import completed', {
            description: `${successCount} user record(s) imported successfully.`,
        })
        setIsImportPanelOpen(false)
        resetImportState()
    }

    const handleImport = () => {
        resetImportState()
        setIsImportPanelOpen(true)
    }

    const exportUsers = async () => {
        try {
            const allUsers = (usersData?.pages.flatMap(page => page.users) || [])
                .filter(u => u.role === role)
                .sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }))

            const rows = allUsers.map((user) => ({
                full_name: user.full_name,
                email: user.email,
                phone: user.phone || '',
            }))

            const worksheet = XLSX.utils.json_to_sheet(rows)
            const workbook = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(workbook, worksheet, role)
            XLSX.writeFile(workbook, `${role}-export-${new Date().toISOString().slice(0, 10)}.xlsx`)

            toast.success('Export completed', {
                description: `${rows.length} user record(s) exported to XLSX.`,
            })
        } catch (error) {
            toast.error('Export failed', {
                description: error instanceof Error ? error.message : 'Could not export users.',
            })
        }
    }

    const handleOpenChange = (open: boolean) => {
        setIsDialogOpen(open)
        if (!open) resetForm()
    }

    const handleEditClick = (user: User) => {
        setEditingUser(user)
        setFormData({
            full_name: user.full_name,
            email: user.email,
            password: '', // Password empty on edit
            phone: user.phone || '',
        })
        setIsDialogOpen(true)
    }



    const handleSubmit = async () => {
        try {
            if (editingUser) {
                if (formData.password && formData.password.length < 6) {
                    alert('Password must be at least 6 characters.')
                    return
                }
                // Update
                await updateUserMutation.mutateAsync({
                    id: editingUser.id,
                    school_id: schoolId,
                    full_name: formData.full_name,
                    email: formData.email,
                    phone: formData.phone,
                    password: formData.password || undefined // Only send if changed
                })
            } else {
                if (!formData.password) {
                    alert('Password is required when creating a user.')
                    return
                }
                if (formData.password.length < 6) {
                    alert('Password must be at least 6 characters.')
                    return
                }
                // Create
                await createUserMutation.mutateAsync({
                    school_id: schoolId,
                    role: role,
                    full_name: formData.full_name,
                    email: formData.email,
                    password: formData.password,
                    phone: formData.phone
                })
            }
            setIsDialogOpen(false)
            resetForm()
        } catch (error) {
            console.error('User management submission failed:', error)
            // Error is already toasted by mutation hooks
        }
    }

    const handleDelete = async (user: User) => {
        if (role === 'admin' && (usersData?.pages?.[0]?.total || 0) <= 1) {
            alert('Cannot delete the last admin of the school. At least one administrator is required.');
            return;
        }

        if (confirm(`Are you sure you want to delete ${user.full_name}? This action is permanent.`)) {
            try {
                await deleteUserMutation.mutateAsync({ userId: user.id, schoolId: schoolId })
            } catch (err) {
                // Error already handled in hook (onError)
                console.warn('Silent deletion error (likely already deleted):', err)
            }
        }
    }

    const allUsers = (usersData?.pages.flatMap(page => page.users) || [])
        .sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }))
    const flatUsers = allUsers.filter(user =>
        user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search users..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={exportUsers} className="h-9 text-xs sm:text-sm">
                        <FileSpreadsheet className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Export</span>
                        <span className="sm:hidden">Export</span>
                    </Button>
                    <Button onClick={() => setIsDialogOpen(true)} className="h-9 text-xs sm:text-sm">
                        <Plus className="h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Add {role.charAt(0).toUpperCase() + role.slice(1)}</span>
                        <span className="sm:hidden">Add</span>
                    </Button>
                </div>
            </div>

            <div className="rounded-md border bg-card max-h-[600px] overflow-y-auto" onScroll={(e) => {
                const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                if (scrollTop / (scrollHeight - clientHeight) >= 0.8 && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            }}>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Contact</TableHead>
                            <TableHead className="w-[80px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-10 w-[200px]" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                    <TableCell><Skeleton className="h-8 w-8 rounded-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : flatUsers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center">
                                    No users found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            <>
                                {flatUsers.map((user) => (
                                    <TableRow key={user.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar>
                                                    <AvatarFallback>{user.full_name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <div className="font-medium">{user.full_name}</div>
                                                    <div className="text-xs text-muted-foreground capitalize">{user.role}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Mail className="h-3 w-3 text-muted-foreground" />
                                                    {user.email}
                                                </div>
                                                {user.phone && (
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <PhoneIcon className="h-3 w-3" />
                                                        {user.phone}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEditClick(user)}>
                                                        <Edit2 className="h-4 w-4 mr-2" /> Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(user)}>
                                                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {isFetchingNextPage && (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center py-4">
                                            <div className="flex justify-center items-center gap-2">
                                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                                                Loading more...
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Add/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
                <DialogContent className="max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingUser ? 'Edit User' : `Add New ${role.charAt(0).toUpperCase() + role.slice(1)}`}</DialogTitle>
                        <DialogDescription>
                            {editingUser ? 'Update user credentials details.' : 'Enter details to create a new user account.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="full_name">Full Name</Label>
                            <Input
                                id="full_name"
                                value={formData.full_name}
                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="password">Password {editingUser && '(Leave empty to keep current)'}</Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    placeholder={editingUser ? "Leave empty to keep current" : "Minimum 6 characters"}
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded-sm transition-colors"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </button>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="phone">Phone (Optional)</Label>
                            <Input
                                id="phone"
                                type="tel"
                                inputMode="numeric"
                                maxLength={10}
                                placeholder="10-digit mobile number"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSubmit}>
                            {editingUser ? 'Update User' : 'Create User'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Import Panel Dialog */}
            <Dialog open={isImportPanelOpen} onOpenChange={setIsImportPanelOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Import Users</DialogTitle>
                        <DialogDescription>
                            Upload `.xlsx` or `.csv` only when the column names exactly match the supported schema.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {/* Template Download */}
                        <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
                            <h3 className="text-sm font-semibold mb-3">Step 1: Download Template</h3>
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" onClick={() => downloadImportTemplate('xlsx')}>
                                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                                    Download XLSX
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => downloadImportTemplate('csv')}>
                                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                                    Download CSV
                                </Button>
                            </div>
                        </div>

                        {/* File Upload */}
                        <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
                            <h3 className="text-sm font-semibold mb-3">Step 2: Upload File</h3>
                            <div className="flex flex-col gap-2">
                                <Input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv,.xlsx"
                                    onChange={handleImportFileChange}
                                    disabled={isImportingUsers}
                                    className="cursor-pointer"
                                />
                                {importFileName && (
                                    <p className="text-xs text-muted-foreground">
                                        Selected: {importFileName}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Validation Errors */}
                        {importValidationErrors.length > 0 && (
                            <div className="rounded-lg border border-red-200/50 bg-red-50 dark:bg-red-950/20 p-4">
                                <div className="flex gap-2 items-start mb-2">
                                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                    <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Validation Failed</h3>
                                </div>
                                <ScrollArea className="h-[150px] pr-4">
                                    <div className="space-y-1">
                                        {importValidationErrors.map((error, idx) => (
                                            <div key={idx} className="text-xs text-red-600 dark:text-red-300">
                                                • {error}
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        )}

                        {/* Preview */}
                        {importPreviewRows.length > 0 && (
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
                                <h3 className="text-sm font-semibold mb-3">Preview ({importPreviewRows.length} rows shown)</h3>
                                <ScrollArea className="h-[250px]">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="border-b">
                                                {selectedImportSchema.columns.map(col => (
                                                    <th key={col.key} className="text-left p-2 font-medium text-muted-foreground">
                                                        {col.key}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {importPreviewRows.map((row, idx) => (
                                                <tr key={idx} className="border-b hover:bg-muted/50">
                                                    {selectedImportSchema.columns.map(col => (
                                                        <td key={`${idx}-${col.key}`} className="p-2 text-muted-foreground">
                                                            {row[col.key] || '-'}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </ScrollArea>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsImportPanelOpen(false)} disabled={isImportingUsers}>
                            Cancel
                        </Button>
                        <Button
                            onClick={uploadImportedUsers}
                            disabled={importRows.length === 0 || importValidationErrors.length > 0 || isImportingUsers}
                        >
                            {isImportingUsers && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {isImportingUsers ? 'Importing...' : 'Import'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
