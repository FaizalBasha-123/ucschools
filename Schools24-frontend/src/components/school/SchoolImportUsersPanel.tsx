"use client"

import { useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AlertTriangle, CheckCircle2, FileDown, FileSpreadsheet, Loader2, X } from 'lucide-react'

type ImportRole = 'admin' | 'teacher' | 'student' | 'staff'

type ImportColumn = {
    key: string
    label: string
    required: boolean
    rule: string
}

type ImportRow = Record<string, string>

type ImportSchema = {
    role: ImportRole
    title: string
    columns: ImportColumn[]
    sampleRows: ImportRow[]
}

const IMPORT_ROLE_OPTIONS: { value: ImportRole; label: string; description: string }[] = [
    { value: 'admin', label: 'Admin', description: 'Creates admin users in tenant users table.' },
    { value: 'teacher', label: 'Teacher', description: 'Creates users + teacher profiles with teaching details.' },
    { value: 'student', label: 'Student', description: 'Creates users + student profiles tied to a class UUID.' },
    { value: 'staff', label: 'Staff', description: 'Creates users + non-teaching staff profiles.' },
]

const IMPORT_SCHEMAS: Record<ImportRole, ImportSchema> = {
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
            { full_name: 'Ananya Sharma', email: 'ananya.admin@testschool.edu', password: 'Admin@123', phone: '9876543210' },
            { full_name: 'Rahul Verma', email: 'rahul.admin@testschool.edu', password: 'Admin@456', phone: '' },
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
                email: 'ananya.teacher@testschool.edu',
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
            { key: 'class_id', label: 'class_id', required: true, rule: 'Required. Must be the exact class UUID from class management.' },
            { key: 'section', label: 'section', required: false, rule: 'Optional. Defaults to A when blank.' },
            { key: 'roll_number', label: 'roll_number', required: false, rule: 'Optional. Student roll number.' },
            { key: 'admission_number', label: 'admission_number', required: false, rule: 'Optional. Auto-generated when blank.' },
            { key: 'date_of_birth', label: 'date_of_birth', required: false, rule: 'Optional. Format YYYY-MM-DD.' },
            { key: 'gender', label: 'gender', required: false, rule: 'Optional. Defaults to other when blank.' },
            { key: 'academic_year', label: 'academic_year', required: false, rule: 'Optional. Defaults to current academic year.' },
            { key: 'parent_name', label: 'parent_name', required: false, rule: 'Optional.' },
            { key: 'parent_phone', label: 'parent_phone', required: false, rule: 'Optional. Digits only.' },
            { key: 'parent_email', label: 'parent_email', required: false, rule: 'Optional. Must be a valid email if provided.' },
            { key: 'address', label: 'address', required: false, rule: 'Optional.' },
        ],
        sampleRows: [
            {
                full_name: 'Ravi Kumar',
                email: 'ravi.student@testschool.edu',
                password: 'Stud@123',
                phone: '9876500001',
                class_id: '7f2c0d70-11aa-44bb-88cc-001122334455',
                section: 'A',
                roll_number: '18',
                admission_number: '',
                date_of_birth: '2012-08-15',
                gender: 'male',
                academic_year: '2025-2026',
                parent_name: 'Suresh Kumar',
                parent_phone: '9876500010',
                parent_email: 'suresh.kumar@testschool.edu',
                address: 'Chennai',
            },
        ],
    },
    staff: {
        role: 'staff',
        title: 'Staff import',
        columns: [
            { key: 'full_name', label: 'full_name', required: true, rule: 'Required. Stored in users.full_name.' },
            { key: 'email', label: 'email', required: true, rule: 'Required. Must be a valid unique email.' },
            { key: 'password', label: 'password', required: true, rule: 'Required. Minimum 6 characters.' },
            { key: 'phone', label: 'phone', required: false, rule: 'Optional. Digits only.' },
            { key: 'employeeId', label: 'employeeId', required: false, rule: 'Optional. Staff employee code.' },
            { key: 'designation', label: 'designation', required: true, rule: 'Required. Stored in non_teaching_staff.designation.' },
            { key: 'qualification', label: 'qualification', required: false, rule: 'Optional.' },
            { key: 'experience', label: 'experience', required: false, rule: 'Optional. Integer only.' },
            { key: 'salary', label: 'salary', required: false, rule: 'Optional. Numeric value only.' },
        ],
        sampleRows: [
            {
                full_name: 'Ravi Kumar',
                email: 'ravi.staff@testschool.edu',
                password: 'Staff@123',
                phone: '9123456780',
                employeeId: 'S-202',
                designation: 'Office Staff',
                qualification: 'B.Com',
                experience: '4',
                salary: '25000',
            },
        ],
    },
}

const normalizeImportCell = (value: unknown) => {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

type SchoolImportUsersPanelProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    schoolId: string
}

export function SchoolImportUsersPanel({ open, onOpenChange, schoolId }: SchoolImportUsersPanelProps) {
    const queryClient = useQueryClient()
    const [selectedImportRole, setSelectedImportRole] = useState<ImportRole | ''>('')
    const [importFileName, setImportFileName] = useState('')
    const [importRows, setImportRows] = useState<ImportRow[]>([])
    const [importPreviewRows, setImportPreviewRows] = useState<ImportRow[]>([])
    const [importValidationErrors, setImportValidationErrors] = useState<string[]>([])
    const [importHeaderCheck, setImportHeaderCheck] = useState<{
        expected: string[]
        uploaded: string[]
        matched: string[]
        missing: string[]
        unexpected: string[]
        orderMismatch: string[]
    } | null>(null)
    const [isImportingUsers, setIsImportingUsers] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const selectedImportSchema = selectedImportRole ? IMPORT_SCHEMAS[selectedImportRole] : null

    const resetImportState = () => {
        setImportFileName('')
        setImportRows([])
        setImportPreviewRows([])
        setImportValidationErrors([])
        setImportHeaderCheck(null)
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
            if (row.experience?.trim() && !/^\d+$/.test(row.experience.trim())) {
                errors.push(`Row ${rowNumber}: experience must be a whole number.`)
            }
            if (row.salary?.trim() && Number.isNaN(Number(row.salary.trim()))) {
                errors.push(`Row ${rowNumber}: salary must be numeric.`)
            }
        })

        return errors
    }

    const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        if (!selectedImportSchema) {
            const message = 'Select a role first so the exact import columns can be validated.'
            setImportValidationErrors([message])
            setImportHeaderCheck(null)
            toast.error('Choose a role first', { description: message })
            return
        }

        const file = event.target.files?.[0]
        if (!file) return

        const extension = file.name.split('.').pop()?.toLowerCase()
        if (!extension || !['xlsx', 'csv'].includes(extension)) {
            const message = 'Only .xlsx and .csv files are supported.'
            setImportValidationErrors([message])
            setImportHeaderCheck(null)
            setImportRows([])
            setImportPreviewRows([])
            toast.error('Unsupported file type', { description: message })
            return
        }

        setImportHeaderCheck(null)

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
                setImportHeaderCheck(null)
                setImportRows([])
                setImportPreviewRows([])
                setImportFileName(file.name)
                toast.error('Import file is empty', { description: message })
                return
            }

            const schemaHeaders = selectedImportSchema.columns.map((column) => column.key)
            const headers = (matrix[0] || []).map((cell) => normalizeImportCell(cell))
            const matched = schemaHeaders.filter((column) => headers.includes(column))
            const missingColumns = schemaHeaders.filter((column) => !headers.includes(column))
            const unexpectedColumns = headers.filter((column) => !schemaHeaders.includes(column))
            const orderMismatch = schemaHeaders.filter(
                (column, index) => headers[index] !== column && headers.includes(column)
            )

            setImportHeaderCheck({
                expected: schemaHeaders,
                uploaded: headers,
                matched,
                missing: missingColumns,
                unexpected: unexpectedColumns,
                orderMismatch,
            })

            if (missingColumns.length > 0 || unexpectedColumns.length > 0 || orderMismatch.length > 0) {
                const message = `Columns must exactly match: ${schemaHeaders.join(', ')}`
                const details: string[] = []
                if (missingColumns.length > 0) {
                    details.push(`Missing columns: ${missingColumns.join(', ')}`)
                }
                if (unexpectedColumns.length > 0) {
                    details.push(`Unexpected columns: ${unexpectedColumns.join(', ')}`)
                }
                if (orderMismatch.length > 0) {
                    details.push(`Correct columns but wrong order: ${orderMismatch.join(', ')}`)
                }
                setImportValidationErrors([message, ...details])
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
            setImportPreviewRows(parsedRows.slice(0, 6))
            setImportValidationErrors(rowErrors)

            if (rowErrors.length > 0) {
                toast.error('Import validation failed', {
                    description: rowErrors[0],
                })
            } else {
                toast.success('Import file is ready', {
                    description: `${parsedRows.length} row(s) matched the required schema.`,
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read import file.'
            setImportValidationErrors([message])
            setImportHeaderCheck(null)
            setImportRows([])
            setImportPreviewRows([])
            setImportFileName(file.name)
            toast.error('Could not parse file', { description: message })
        }
    }

    const downloadImportTemplate = (format: 'xlsx' | 'csv') => {
        if (!selectedImportSchema) {
            toast.error('Choose a role first', {
                description: 'Select a role before downloading the matching import template.',
            })
            return
        }

        const worksheet = XLSX.utils.json_to_sheet(selectedImportSchema.sampleRows, {
            header: selectedImportSchema.columns.map((column) => column.key),
        })
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, selectedImportSchema.role)
        XLSX.writeFile(
            workbook,
            `${selectedImportSchema.role}-import-template.${format}`,
            { bookType: format }
        )

        toast.success('Template downloaded', {
            description: `${selectedImportSchema.title} template downloaded as .${format}.`,
        })
    }

    const uploadImportedUsers = async () => {
        if (!selectedImportSchema || !selectedImportRole) {
            toast.error('Choose a role first', {
                description: 'Select the target role before uploading a file.',
            })
            return
        }

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
                if (selectedImportRole === 'staff') {
                    await api.post(`/admin/staff?school_id=${schoolId}`, {
                        full_name: row.full_name,
                        email: row.email,
                        password: row.password,
                        phone: row.phone || '',
                        employeeId: row.employeeId || '',
                        designation: row.designation,
                        qualification: row.qualification || '',
                        experience: row.experience ? Number(row.experience) : undefined,
                        salary: row.salary ? Number(row.salary) : undefined,
                        staffType: 'non-teaching',
                    })
                } else if (selectedImportRole === 'teacher') {
                    await api.post(`/admin/teachers?school_id=${schoolId}`, {
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
                    })
                } else if (selectedImportRole === 'student') {
                    await api.post(`/admin/students?school_id=${schoolId}`, {
                        full_name: row.full_name,
                        email: row.email,
                        password: row.password,
                        phone: row.phone || '',
                        class_id: row.class_id,
                        section: row.section || '',
                        roll_number: row.roll_number || '',
                        admission_number: row.admission_number || '',
                        date_of_birth: row.date_of_birth || '',
                        gender: row.gender || '',
                        academic_year: row.academic_year || '',
                        parent_name: row.parent_name || '',
                        parent_phone: row.parent_phone || '',
                        parent_email: row.parent_email || '',
                        address: row.address || '',
                    })
                } else {
                    await api.post(`/admin/users?school_id=${schoolId}`, {
                        full_name: row.full_name,
                        email: row.email,
                        role: 'admin',
                        phone: row.phone || '',
                        password: row.password,
                    })
                }
                successCount += 1
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown import failure'
                failures.push(`Row ${index + 2}: ${message}`)
            }
        }

        setIsImportingUsers(false)
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['school-users', schoolId] }),
            queryClient.invalidateQueries({ queryKey: ['staff'] }),
            queryClient.invalidateQueries({ queryKey: ['schools'] }),
        ])

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
        onOpenChange(false)
        resetImportState()
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 z-[120]">
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
                onClick={() => {
                    onOpenChange(false)
                    resetImportState()
                }}
            />
            <div className="absolute right-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-[720px] overflow-hidden border-l border-border bg-background shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 ease-out">
                <div className="shrink-0 flex items-center justify-between border-b border-border px-5 py-4">
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight">Import Users</h2>
                        <p className="text-sm text-muted-foreground">
                            Upload `.xlsx` or `.csv` only when the column names exactly match the supported schema.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => {
                            onOpenChange(false)
                            resetImportState()
                        }}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-6">
                    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                        <div className="space-y-1">
                            <h3 className="text-sm font-semibold">1. Pick Role First</h3>
                            <p className="text-xs text-muted-foreground">
                                The import template changes by role because admin, teacher, student, and staff use different backend contracts.
                            </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {IMPORT_ROLE_OPTIONS.map((roleOption) => (
                                <button
                                    key={roleOption.value}
                                    type="button"
                                    onClick={() => {
                                        setSelectedImportRole(roleOption.value)
                                        resetImportState()
                                    }}
                                    className={`rounded-xl border px-4 py-3 text-left transition ${selectedImportRole === roleOption.value
                                        ? 'border-primary bg-primary/5 shadow-sm'
                                        : 'border-border bg-background hover:border-primary/40'
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold">{roleOption.label}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">{roleOption.description}</p>
                                        </div>
                                        {selectedImportRole === roleOption.value ? (
                                            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                        ) : null}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {!selectedImportSchema ? (
                        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                            Select a role to reveal the exact import columns, required fields, sample rows, and upload rules.
                        </div>
                    ) : (
                        <>
                            <div className="rounded-2xl border border-border bg-card">
                                <div className="border-b border-border px-4 py-3">
                                    <h3 className="text-sm font-semibold">{selectedImportSchema.title}: expected columns</h3>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        These columns are the import contract. Any extra column, missing column, or different column name will block the upload.
                                    </p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-[880px] w-full text-sm">
                                        <thead className="bg-muted/60">
                                            <tr>
                                                {selectedImportSchema.columns.map((column) => (
                                                    <th key={column.key} className="border-b border-border px-3 py-2.5 text-left font-semibold whitespace-nowrap">
                                                        <div className="flex items-center gap-2">
                                                            <span>{column.label}</span>
                                                            <Badge variant={column.required ? 'destructive' : 'secondary'} className="h-5 px-1.5 text-[10px]">
                                                                {column.required ? 'Required' : 'Optional'}
                                                            </Badge>
                                                        </div>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedImportSchema.sampleRows.map((row, rowIndex) => (
                                                <tr key={rowIndex} className="odd:bg-background even:bg-muted/20">
                                                    {selectedImportSchema.columns.map((column) => (
                                                        <td key={column.key} className="border-b border-border px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                                            {row[column.key] || <span className="text-muted-foreground/50">optional</span>}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                                    <h3 className="text-sm font-semibold">Import Rules</h3>
                                </div>
                                <div className="grid gap-2 text-xs text-muted-foreground">
                                    {selectedImportSchema.columns.map((column) => (
                                        <p key={column.key}>
                                            <span className="font-semibold text-foreground">{column.label}</span>: {column.rule}
                                        </p>
                                    ))}
                                    <p><span className="font-semibold text-foreground">Mandatory row rule</span>: if any required column is empty in even one row, the entire upload stays blocked.</p>
                                    <p><span className="font-semibold text-foreground">Strict match</span>: column order and names must remain exactly the same.</p>
                                    <p><span className="font-semibold text-foreground">Accepted files</span>: `.xlsx`, `.csv`.</p>
                                </div>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => downloadImportTemplate('xlsx')}
                                    >
                                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                                        Download XLSX template
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => downloadImportTemplate('csv')}
                                    >
                                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                                        Download CSV template
                                    </Button>
                                </div>
                            </div>

                            <Separator />

                            <div className="rounded-2xl border border-dashed border-border bg-card p-5 space-y-4">
                                <div>
                                    <h3 className="text-sm font-semibold">Upload File</h3>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Upload the {selectedImportRole} sheet only after you verify that it follows the same column structure shown above.
                                    </p>
                                </div>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".xlsx,.csv"
                                    className="hidden"
                                    onChange={handleImportFileChange}
                                />

                                <div className="flex flex-col sm:flex-row gap-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="sm:w-auto"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <FileDown className="mr-2 h-4 w-4" />
                                        Choose XLSX / CSV
                                    </Button>
                                    {importFileName ? (
                                        <div className="flex-1 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                                            {importFileName}
                                        </div>
                                    ) : null}
                                </div>

                                {importPreviewRows.length > 0 && (
                                    <div className="rounded-xl border border-border overflow-hidden">
                                        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Parsed Preview
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-[880px] w-full text-xs">
                                                <thead className="bg-muted/60">
                                                    <tr>
                                                        {selectedImportSchema.columns.map((column) => (
                                                            <th key={column.key} className="px-3 py-2 text-left whitespace-nowrap">{column.label}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {importPreviewRows.map((row, rowIndex) => (
                                                        <tr key={rowIndex} className="odd:bg-background even:bg-muted/15">
                                                            {selectedImportSchema.columns.map((column) => (
                                                                <td key={column.key} className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                                                                    {row[column.key] || <span className="text-muted-foreground/50">-</span>}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {importValidationErrors.length > 0 && (
                                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                                        <p className="text-sm font-semibold text-destructive">Import blocked</p>
                                        {importHeaderCheck && (
                                            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expected columns</p>
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {importHeaderCheck.expected.map((column) => {
                                                            const isMissing = importHeaderCheck.missing.includes(column)
                                                            const isOrderMismatch = importHeaderCheck.orderMismatch.includes(column)
                                                            return (
                                                                <span
                                                                    key={`expected-${column}`}
                                                                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                                                        isMissing
                                                                            ? 'bg-destructive/15 text-destructive'
                                                                            : isOrderMismatch
                                                                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                                                                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                                                                    }`}
                                                                >
                                                                    {column}
                                                                </span>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Uploaded columns</p>
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {importHeaderCheck.uploaded.map((column, index) => {
                                                            const key = `uploaded-${column}-${index}`
                                                            const isUnexpected = importHeaderCheck.unexpected.includes(column)
                                                            const isOrderMismatch = importHeaderCheck.orderMismatch.includes(column)
                                                            return (
                                                                <span
                                                                    key={key}
                                                                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                                                        isUnexpected
                                                                            ? 'bg-destructive/15 text-destructive'
                                                                            : isOrderMismatch
                                                                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                                                                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                                                                    }`}
                                                                >
                                                                    {column || '(blank)'}
                                                                </span>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="mt-2 space-y-1 text-xs text-destructive/90">
                                            {importValidationErrors.slice(0, 8).map((error, index) => (
                                                <p key={`${error}-${index}`}>{error}</p>
                                            ))}
                                            {importValidationErrors.length > 8 && (
                                                <p>+ {importValidationErrors.length - 8} more issue(s)</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="shrink-0 border-t border-border bg-background px-5 py-4 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                        {!selectedImportSchema
                            ? 'Pick a role first. The upload stays disabled until a role-specific schema is selected.'
                            : 'The file will be rejected if any column is missing, renamed, added, or if a mandatory cell is empty.'}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                onOpenChange(false)
                                resetImportState()
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={uploadImportedUsers}
                            disabled={!selectedImportSchema || isImportingUsers || importRows.length === 0 || importValidationErrors.length > 0}
                        >
                            {isImportingUsers ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                            Import {selectedImportRole ? IMPORT_SCHEMAS[selectedImportRole].title.replace(' import', '') : 'Users'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
