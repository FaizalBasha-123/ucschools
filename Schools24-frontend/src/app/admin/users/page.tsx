"use client"

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
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
    MoreHorizontal,
    Edit,
    Trash2,
    FileSpreadsheet,
    Eye,
    Shield,
    GraduationCap,
    BookOpen,
    Users,
    CheckCircle2,
    XCircle,
    Filter,
    RefreshCw,
    Plus,
    FileDown,
    Briefcase,
    Lock,
    Unlock,
    Loader2,
    Check,
    X,
    Minus,
    EyeOff,
    AlertTriangle,
    ChevronsUpDown,
} from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { toast } from 'sonner'
import { useUsers, useUserStats, useCreateUser, useUpdateUser, useDeleteUser, useSuspendUser, useUnsuspendUser, AdminUser } from '@/hooks/useAdminUsers'
import { useStaff, useCreateStaff, useUpdateStaff } from '@/hooks/useAdminStaff'
import { Staff } from '@/types'
import { useClasses } from '@/hooks/useClasses'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
// import { useDebounce } from '@/hooks/useDebounce'
// I will just use simple useEffect debounce or just separate state for debounced search.
import { useAdminCatalogSubjects } from '@/hooks/useAdminCatalogSubjects'
import * as XLSX from 'xlsx'

const normalizeSection = (value: string) => value.trim().toUpperCase().replace(/[^A-Z]/g, '')
const APAAR_ID_REGEX = /^[0-9]{12}$/
const ABC_ID_REGEX = /^[0-9]{12}$/

function validateFederatedIDsInput(apaarRaw: string, abcRaw: string): string | null {
    const apaar = apaarRaw.trim()
    const abc = abcRaw.trim()

    if (apaar && !APAAR_ID_REGEX.test(apaar)) {
        return 'APAAR ID must be exactly 12 digits'
    }
    if (abc && !ABC_ID_REGEX.test(abc)) {
        return 'ABC ID must be exactly 12 digits'
    }
    return null
}

const sectionToNumber = (label?: string | null) => {
    if (!label) return 0
    const normalized = normalizeSection(label)
    if (!normalized) return 0
    let num = 0
    for (const char of normalized) {
        num = num * 26 + (char.charCodeAt(0) - 64)
    }
    return num
}

const numberToSection = (num: number) => {
    if (num <= 0) return ''
    let result = ''
    let n = num
    while (n > 0) {
        const rem = (n - 1) % 26
        result = String.fromCharCode(65 + rem) + result
        n = Math.floor((n - 1) / 26)
    }
    return result
}

const getNextSectionLabel = (existingLabels: string[]) => {
    let max = 0
    for (const label of existingLabels) {
        const value = sectionToNumber(label)
        if (value > max) max = value
    }
    return max === 0 ? 'A' : numberToSection(max + 1)
}

// ─── Profile interfaces ──────────────────────────────────────────────────────
interface StudentProfile {
    id: string
    user_id: string
    admission_number?: string
    roll_number?: string
    apaar_id?: string
    abc_id?: string
    class_id?: string
    class_name?: string
    section?: string
    gender?: string
    date_of_birth?: string
    blood_group?: string
    address?: string
    parent_name?: string
    parent_email?: string
    parent_phone?: string
    emergency_contact?: string
    admission_date?: string
    academic_year?: string
    bus_route_id?: string
    transport_mode?: string
}

interface TeacherProfileDetail {
    id: string
    userId: string
    employeeId?: string
    department?: string
    designation?: string
    qualifications?: string[]
    subjects?: string[]
    subject_ids?: string[]
    experience?: number
    joinDate?: string
    salary?: number
    status?: string
    classes?: string[]
}

interface BusRoute {
    id: string
    route_name: string
    description?: string
}

interface StaffResponse {
    staff: Staff[]
    total: number
    page: number
    page_size: number
}

const getCurrentAcademicYear = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    if (month < 4) {
        return `${year - 1}-${year}`
    }
    return `${year}-${year + 1}`
}

const getAcademicYears = () => {
    const now = new Date()
    const base = now.getFullYear()
    const years: string[] = []
    for (let i = -2; i <= 1; i += 1) {
        const start = base + i
        years.push(`${start}-${start + 1}`)
    }
    return years
}

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
    endpoint: string
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
        endpoint: '/admin/users',
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
        endpoint: '/admin/teachers',
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
            {
                full_name: 'Kiran Rao',
                email: 'kiran.teacher@testschool.edu',
                password: 'Teach@456',
                phone: '',
                employee_id: '',
                designation: 'Assistant Teacher',
                qualifications: 'B.A,B.Ed',
                subjects_taught: 'English',
                experience_years: '2',
                hire_date: '',
                salary: '',
                status: '',
            },
        ],
    },
    student: {
        role: 'student',
        title: 'Student import',
        endpoint: '/admin/students',
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
            {
                full_name: 'Neha Singh',
                email: 'neha.student@testschool.edu',
                password: 'Stud@456',
                phone: '',
                class_id: '7f2c0d70-11aa-44bb-88cc-001122334455',
                section: '',
                roll_number: '',
                admission_number: '',
                date_of_birth: '',
                gender: '',
                academic_year: '',
                parent_name: 'Asha Singh',
                parent_phone: '',
                parent_email: '',
                address: '',
            },
        ],
    },
    staff: {
        role: 'staff',
        title: 'Staff import',
        endpoint: '/admin/staff',
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
            {
                full_name: 'Maya Devi',
                email: 'maya.staff@testschool.edu',
                password: 'Staff@456',
                phone: '',
                employeeId: '',
                designation: 'Lab Assistant',
                qualification: '',
                experience: '',
                salary: '',
            },
        ],
    },
}

const normalizeImportCell = (value: unknown) => {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

const mapStaffToAdminUser = (staff: Staff): AdminUser => ({
    id: staff.id,
    user_id: staff.userId,
    email: staff.email,
    full_name: staff.name,
    role: 'staff',
    phone: staff.phone || undefined,
    avatar: staff.avatar || undefined,
    department: staff.designation,
    designation: staff.designation,
    salary: staff.salary,
    is_suspended: staff.is_suspended || false,
    created_at: staff.joinDate || '',
})

export default function UsersPage() {
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [roleFilter, setRoleFilter] = useState<string>('all')
    const [yearFilter, setYearFilter] = useState<string>('all')
    const [designationFilter, setDesignationFilter] = useState<string>('all')
    const [classFilter, setClassFilter] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [academicYear] = useState(getCurrentAcademicYear())
    const [isImportPanelOpen, setIsImportPanelOpen] = useState(false)
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

    // Pagination state
    const pageSize = 20

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery)
        }, 500)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // Reset role-specific sub-filters whenever the role changes
    useEffect(() => {
        setDesignationFilter('all')
        setClassFilter('all')
        setStatusFilter('all')
    }, [roleFilter])

    // Queries
    const {
        data,
        isLoading: isUsersLoading,
        isError,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage
    } = useUsers(roleFilter, debouncedSearch, pageSize, roleFilter !== 'staff')

    const {
        data: staffData,
        isLoading: isStaffLoading,
        fetchNextPage: fetchNextStaffPage,
        hasNextPage: hasNextStaffPage,
        isFetchingNextPage: isFetchingNextStaffPage,
    } = useStaff(debouncedSearch, pageSize, undefined, undefined, { enabled: roleFilter === 'all' || roleFilter === 'staff' })

    const { data: statsData, isLoading: statsLoading } = useUserStats()

    const { data: classesData } = useClasses(academicYear)

    // Mutations
    const queryClient = useQueryClient()
    const createUser = useCreateUser()
    const createStaff = useCreateStaff()
    const updateUser = useUpdateUser()
    const deleteUser = useDeleteUser()
    const suspendUser = useSuspendUser()
    const unsuspendUser = useUnsuspendUser()

    const users = useMemo(() => {
        const allUsers = data?.pages.flatMap(page => page.users) || []
        const allStaff = staffData?.pages.flatMap(page => page.staff) || []
        const seen = new Set<string>()
        const uniqueUsers: AdminUser[] = []

        for (const user of allUsers) {
            if (!user?.id || seen.has(user.id)) continue
            if (user.role === 'staff') continue // staff come from allStaff with salary data
            seen.add(user.id)
            uniqueUsers.push(user)
        }

        for (const s of allStaff) {
            if (!s?.id || seen.has(s.id)) continue
            seen.add(s.id)
            uniqueUsers.push(mapStaffToAdminUser(s))
        }

        return uniqueUsers.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', undefined, { sensitivity: 'base' }))
    }, [data, staffData])
    const totalUsersCount = (data?.pages[0]?.total || 0) + (roleFilter === 'all' || roleFilter === 'staff' ? (staffData?.pages[0]?.total || 0) : 0)
    const classes = classesData?.classes || []

    // Infinite Scroll Logic (Intersection Observer)
    const { ref: scrollRef, inView } = useIntersectionObserver({ threshold: 0.1 })
    const shouldUseUsersQuery = roleFilter !== 'staff'
    const shouldUseStaffQuery = roleFilter === 'all' || roleFilter === 'staff'

    useEffect(() => {
        if (inView && shouldUseUsersQuery && hasNextPage && !isFetchingNextPage) {
            fetchNextPage()
        }
        if (inView && shouldUseStaffQuery && hasNextStaffPage && !isFetchingNextStaffPage) {
            fetchNextStaffPage()
        }
    }, [inView, shouldUseUsersQuery, hasNextPage, isFetchingNextPage, fetchNextPage, shouldUseStaffQuery, hasNextStaffPage, isFetchingNextStaffPage, fetchNextStaffPage])

    // Derived filter option lists (built from already-loaded data, no extra requests)
    const staffDesignations = useMemo(() =>
        [...new Set(users.filter(u => u.role === 'staff').map(u => u.designation || u.department).filter((d): d is string => !!d))].sort(),
        [users])
    const studentClasses = useMemo(() =>
        [...new Set(users.filter(u => u.role === 'student').map(u => u.class_name).filter((c): c is string => !!c))].sort(),
        [users])
    const createdYears = useMemo(() => {
        const years = users
            .map(u => u.created_at ? new Date(u.created_at).getFullYear() : null)
            .filter((y): y is number => y != null && !isNaN(y))
        if (years.length === 0) return []
        const min = Math.min(...years)
        const max = Math.max(...years)
        return Array.from({ length: max - min + 1 }, (_, i) => min + i).reverse()
    }, [users])
    const filteredUsers = useMemo(() => {
        let list = roleFilter !== 'all' ? users.filter(u => u.role === roleFilter) : users
        if (yearFilter !== 'all')
            list = list.filter(u => u.created_at && new Date(u.created_at).getFullYear() === Number(yearFilter))
        if (roleFilter === 'staff' && designationFilter !== 'all')
            list = list.filter(u => (u.designation || u.department) === designationFilter)
        if (roleFilter === 'student') {
            if (classFilter !== 'all') list = list.filter(u => u.class_name === classFilter)
            if (statusFilter !== 'all') list = list.filter(u => statusFilter === 'suspended' ? !!u.is_suspended : !u.is_suspended)
        }
        return list
    }, [users, roleFilter, yearFilter, designationFilter, classFilter, statusFilter])
    const isUsersInitialLoading = shouldUseUsersQuery && isUsersLoading && !data
    const isStaffInitialLoading = shouldUseStaffQuery && isStaffLoading && !staffData
    const isAnyLoading = isUsersInitialLoading || isStaffInitialLoading
    const isAnyFetchingNextPage =
        (shouldUseUsersQuery && isFetchingNextPage) ||
        (shouldUseStaffQuery && isFetchingNextStaffPage)
    const fetchTriggerIndex = filteredUsers.length > 0 ? Math.max(0, Math.floor(filteredUsers.length * 0.8) - 1) : -1

    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [isSuspendDialogOpen, setIsSuspendDialogOpen] = useState(false)
    const [suspendAction, setSuspendAction] = useState<'suspend' | 'unsuspend'>('suspend')
    const [suspendPassword, setSuspendPassword] = useState('')
    const [showSuspendPassword, setShowSuspendPassword] = useState(false)
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
    const [editStudentForm, setEditStudentForm] = useState({
        profileId: '', admissionNumber: '', rollNumber: '', classId: '',
        apaarId: '', abcId: '',
        gender: '', dateOfBirth: '', bloodGroup: '', address: '',
        parentName: '', parentEmail: '', parentPhone: '', emergencyContact: '',
        admissionDate: '', academicYear: '', busRouteId: '', transportMode: ''
    })
    const [editTeacherForm, setEditTeacherForm] = useState({
        profileId: '', employeeId: '',
        qualificationsStr: '', subjectIds: [] as string[], experience: '', hireDate: '', salary: '', status: ''
    })
    const [busRouteSearch, setBusRouteSearch] = useState('')
    const [openBusRouteSelect, setOpenBusRouteSelect] = useState(false)
    const [editStaffForm, setEditStaffForm] = useState({
        designation: '', qualification: '', experience: '', salary: '',
        address: '', dateOfBirth: '', emergencyContact: '', bloodGroup: '',
    })

    // ─── Profile queries (after selectedUser + dialog state are declared) ─────
    const { data: studentProfileData } = useQuery({
        queryKey: ['admin-student-profile', selectedUser?.id],
        enabled: !!(selectedUser?.role === 'student' && (isViewDialogOpen || isEditDialogOpen)),
        queryFn: async () => {
            const res = await api.get<{ student: StudentProfile | null }>(`/admin/students/by-user/${selectedUser!.id}`)
            return res.student
        },
        staleTime: 60 * 1000,
    })

    const { data: teacherProfileData } = useQuery({
        queryKey: ['admin-teacher-profile', selectedUser?.id],
        enabled: !!(selectedUser?.role === 'teacher' && (isViewDialogOpen || isEditDialogOpen)),
        queryFn: async () => {
            const res = await api.get<{ teacher: TeacherProfileDetail | null }>(`/admin/teachers/by-user/${selectedUser!.id}`)
            return res.teacher
        },
        staleTime: 60 * 1000,
    })

    const { data: busRoutesData = [] } = useQuery({
        queryKey: ['admin-bus-routes'],
        enabled: !!(selectedUser?.role === 'student' && isEditDialogOpen),
        queryFn: async () => {
            const res = await api.get<{ bus_routes: BusRoute[] }>('/admin/bus-routes')
            return res.bus_routes || []
        },
        staleTime: 5 * 60 * 1000,
    })

    const { data: catalogSubjectsData } = useAdminCatalogSubjects({ enabled: isEditDialogOpen && selectedUser?.role === 'teacher' })
    const catalogSubjects = catalogSubjectsData?.subjects || []

    // ─── Profile mutations ────────────────────────────────────────────────────
    const updateStudentProfile = useMutation({
        mutationFn: async (payload: { id: string } & Record<string, unknown>) => {
            const { id, ...body } = payload
            return api.put(`/admin/students/${id}`, body)
        },
        onSuccess: () => toast.success('Student profile updated'),
        onError: (e: Error) => toast.error('Failed to update student profile', { description: e.message }),
    })

    const createStudentProfile = useMutation({
        mutationFn: async (payload: Record<string, unknown>) => {
            return api.post('/admin/students/profile', payload)
        },
        onSuccess: () => {
            toast.success('Student profile created')
            queryClient.invalidateQueries({ queryKey: ['users'] })
            queryClient.invalidateQueries({ queryKey: ['students'] })
        },
        onError: (e: Error) => toast.error('Failed to create student profile', { description: e.message }),
    })

    const updateTeacherProfile = useMutation({
        mutationFn: async (payload: { id: string } & Record<string, unknown>) => {
            const { id, ...body } = payload
            return api.put(`/admin/teachers/${id}`, body)
        },
        onSuccess: () => {
            toast.success('Teacher profile updated')
            queryClient.invalidateQueries({ queryKey: ['users'] })
            queryClient.refetchQueries({ queryKey: ['users'] })
        },
        onError: (e: Error) => toast.error('Failed to update teacher profile', { description: e.message }),
    })

    const updateStaff = useUpdateStaff()

    // Sync student profile → edit form when edit dialog opens
    useEffect(() => {
        if (isEditDialogOpen && selectedUser?.role === 'student' && studentProfileData) {
            setEditStudentForm({
                profileId: studentProfileData.id,
                admissionNumber: studentProfileData.admission_number || '',
                rollNumber: studentProfileData.roll_number || '',
                apaarId: studentProfileData.apaar_id || '',
                abcId: studentProfileData.abc_id || '',
                classId: studentProfileData.class_id || '',
                gender: studentProfileData.gender || '',
                dateOfBirth: studentProfileData.date_of_birth?.slice(0, 10) || '',
                bloodGroup: studentProfileData.blood_group || '',
                address: studentProfileData.address || '',
                parentName: studentProfileData.parent_name || '',
                parentEmail: studentProfileData.parent_email || '',
                parentPhone: studentProfileData.parent_phone || '',
                emergencyContact: studentProfileData.emergency_contact || '',
                admissionDate: studentProfileData.admission_date?.slice(0, 10) || '',
                academicYear: studentProfileData.academic_year || '',
                busRouteId: studentProfileData.bus_route_id || '',
                transportMode: studentProfileData.transport_mode || '',
            })
        }
    }, [isEditDialogOpen, selectedUser?.role, studentProfileData])

    // Sync teacher profile → edit form when edit dialog opens
    useEffect(() => {
        if (isEditDialogOpen && selectedUser?.role === 'teacher' && teacherProfileData) {
            setEditTeacherForm({
                profileId: teacherProfileData.id,
                employeeId: teacherProfileData.employeeId || '',
                qualificationsStr: (teacherProfileData.qualifications || []).join(', '),
                subjectIds: teacherProfileData.subject_ids || [],
                experience: teacherProfileData.experience ? String(teacherProfileData.experience) : '',
                hireDate: teacherProfileData.joinDate?.slice(0, 10) || '',
                salary: teacherProfileData.salary ? String(teacherProfileData.salary) : '',
                status: teacherProfileData.status || '',
            })
        }
    }, [isEditDialogOpen, selectedUser?.role, teacherProfileData])

    // Sync staff data → edit form when edit dialog opens
    useEffect(() => {
        if (isEditDialogOpen && selectedUser?.role === 'staff') {
            const allStaff = staffData?.pages.flatMap(p => p.staff) || []
            const s = allStaff.find(s => s.id === selectedUser.id)
            if (s) {
                setEditStaffForm({
                    designation: s.designation || '',
                    qualification: s.qualification || '',
                    experience: s.experience != null ? String(s.experience) : '',
                    salary: s.salary != null ? String(s.salary) : '',
                    address: s.address || '',
                    dateOfBirth: s.dateOfBirth?.slice(0, 10) || '',
                    emergencyContact: s.emergencyContact || '',
                    bloodGroup: s.bloodGroup || '',
                })
            }
        }
    }, [isEditDialogOpen, selectedUser?.role, selectedUser?.id, staffData])

    const [newUser, setNewUser] = useState<{
        name: string;
        email: string;
        role: string;
        phone: string;
        password: string;
        designation: string;
        qualification: string;
        classId: string;
    }>({
        name: '',
        email: '',
        role: 'student',
        phone: '',
        password: '',
        designation: '',
        qualification: '',
        classId: '',
    })
    const [editPassword, setEditPassword] = useState('')
    const [showAddPassword, setShowAddPassword] = useState(false)
    const [showEditPassword, setShowEditPassword] = useState(false)

    // Computed Stats (Naive implementation based on current view or basic assumption)
    // Real stats should come from Dashboard API.
    // For now, I will use data.total for total.
    // I cannot calculate exact Active/Inactive count for WHOLE DB without helper API.
    // I'll leave stats static or based on current page (which is wrong but safer than breaking).
    // Or I fetch stats separately? `useDashboardStats`?
    // I'll simply show "Total Users: {data?.total}" and maybe hide others or show "-"
    const userStats = {
        total: statsData?.total || 0,
        admins: statsData?.admins || 0,
        teachers: statsData?.teachers || 0,
        students: statsData?.students || 0,
        staff: statsData?.staff || 0,
    }
    // Note: User stats cards might look empty. I should ideally fetch dashboard stats.
    // But I'll focus on CRUD first.



    const handleEditUser = () => {
        if (!selectedUser) return

        if (editPassword && editPassword.length < 6) {
            toast.error('Invalid password', {
                description: 'Password must be at least 6 characters'
            })
            return
        }

        // Fire profile mutation alongside the user update (fire-and-forget)
        if (selectedUser.role === 'student') {
            const federatedValidationError = validateFederatedIDsInput(editStudentForm.apaarId, editStudentForm.abcId)
            if (federatedValidationError) {
                toast.error('Invalid student identifiers', { description: federatedValidationError })
                return
            }

            const studentPayload = {
                admission_number: editStudentForm.admissionNumber || undefined,
                roll_number: editStudentForm.rollNumber || undefined,
                apaar_id: editStudentForm.apaarId || undefined,
                abc_id: editStudentForm.abcId || undefined,
                class_id: editStudentForm.classId || undefined,
                gender: editStudentForm.gender || undefined,
                date_of_birth: editStudentForm.dateOfBirth || undefined,
                blood_group: editStudentForm.bloodGroup || undefined,
                address: editStudentForm.address || undefined,
                parent_name: editStudentForm.parentName || undefined,
                parent_email: editStudentForm.parentEmail || undefined,
                parent_phone: editStudentForm.parentPhone || undefined,
                emergency_contact: editStudentForm.emergencyContact || undefined,
                transport_mode: editStudentForm.transportMode || undefined,
                bus_route_id: editStudentForm.busRouteId || undefined,
                academic_year: editStudentForm.academicYear || undefined,
            }

            if (editStudentForm.profileId) {
                updateStudentProfile.mutate({
                    id: editStudentForm.profileId,
                    ...studentPayload,
                })
            } else if (editStudentForm.classId) {
                createStudentProfile.mutate({
                    user_id: selectedUser.id,
                    ...studentPayload,
                })
            }
        }

        if (selectedUser.role === 'teacher' && editTeacherForm.profileId) {
            updateTeacherProfile.mutate({
                id: editTeacherForm.profileId,
                employee_id: editTeacherForm.employeeId || undefined,
                experience_years: editTeacherForm.experience ? parseInt(editTeacherForm.experience) : undefined,
                hire_date: editTeacherForm.hireDate || undefined,
                salary: editTeacherForm.salary ? parseFloat(editTeacherForm.salary) : undefined,
                status: editTeacherForm.status || undefined,
                qualifications: editTeacherForm.qualificationsStr ? editTeacherForm.qualificationsStr.split(',').map(s => s.trim()).filter(Boolean) : undefined,
                subjects_taught: editTeacherForm.subjectIds.length > 0 ? editTeacherForm.subjectIds : undefined,
            })
        }

        if (selectedUser.role === 'staff') {
            updateStaff.mutate({
                id: selectedUser.id,
                data: {
                    full_name: selectedUser.full_name,
                    phone: selectedUser.phone || '',
                    designation: editStaffForm.designation,
                    qualification: editStaffForm.qualification,
                    experience: editStaffForm.experience ? parseInt(editStaffForm.experience) : 0,
                    salary: editStaffForm.salary ? parseFloat(editStaffForm.salary) : 0,
                    address: editStaffForm.address,
                    dateOfBirth: editStaffForm.dateOfBirth,
                    emergencyContact: editStaffForm.emergencyContact,
                    bloodGroup: editStaffForm.bloodGroup,
                },
            }, {
                onSuccess: () => {
                    setIsEditDialogOpen(false)
                    setEditPassword('')
                    setShowEditPassword(false)
                }
            })
            return
        }

        updateUser.mutate({
            id: selectedUser.id,
            full_name: selectedUser.full_name,
            email: selectedUser.email,
            role: selectedUser.role,
            phone: selectedUser.phone,
            password: editPassword || undefined,
        }, {
            onSuccess: () => {
                setIsEditDialogOpen(false)
                setEditPassword('')
                setShowEditPassword(false)
            }
        })
    }

    const handleAddUser = () => {
        const trimmedName = newUser.name.trim()
        const trimmedEmail = newUser.email.trim()
        const trimmedPassword = newUser.password.trim()

        if (!trimmedName || !trimmedEmail || !trimmedPassword) {
            toast.error('Missing fields', {
                description: 'Please fill in Name, Email, and Password'
            })
            return
        }

        // Validate email format before hitting the backend
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(trimmedEmail)) {
            toast.error('Invalid email address', {
                description: `"${trimmedEmail}" is not a valid email. Example: john@school.com`
            })
            return
        }

        if (trimmedPassword.length < 6) {
            toast.error('Invalid password', {
                description: 'Password must be at least 6 characters'
            })
            return
        }

        if (newUser.role === 'student' && !newUser.classId) {
            toast.info('Student created — assign a class via Edit to enable class-based filtering', {
                description: 'Open the student in User Management → Edit to assign a class and fill in profile details.',
                duration: 6000,
            })
            // Fall through — let creation proceed
        }

        const resetForm = () => {
            setIsAddDialogOpen(false)
            setNewUser({ name: '', email: '', role: 'student', phone: '', password: '', designation: '', qualification: '', classId: '' })
            setShowAddPassword(false)
        }

        if (newUser.role === 'staff') {
            if (!newUser.designation.trim()) {
                toast.error('Missing fields', { description: 'Designation is required for staff' })
                return
            }
            createStaff.mutate({
                full_name: trimmedName,
                email: trimmedEmail,
                password: trimmedPassword,
                phone: newUser.phone.trim(),
                designation: newUser.designation.trim(),
                qualification: newUser.qualification.trim(),
                staffType: 'non-teaching',
            }, { onSuccess: resetForm })
            return
        }

        createUser.mutate({
            full_name: trimmedName,
            email: trimmedEmail,
            role: newUser.role,
            phone: newUser.phone.trim(),
            password: trimmedPassword,
            class_id: newUser.role === 'student' && newUser.classId ? newUser.classId : undefined,
        }, {
            onSuccess: resetForm
        })
    }

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

    const handleImport = () => {
        resetImportState()
        setSelectedImportRole('')
        setIsImportPanelOpen(true)
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

    const handleDeleteUser = () => {
        if (!selectedUser) return
        deleteUser.mutate(selectedUser.id, {
            onSuccess: () => setIsDeleteDialogOpen(false)
        })
    }

    const handleSuspendAction = () => {
        if (!selectedUser || !suspendPassword) return
        const mutate = suspendAction === 'suspend' ? suspendUser : unsuspendUser
        // For staff, user_id is the actual user UUID; for others, id is the user UUID
        const targetId = selectedUser.user_id || selectedUser.id
        mutate.mutate(
            { id: targetId, password: suspendPassword },
            {
                onSuccess: () => {
                    setIsSuspendDialogOpen(false)
                    setSuspendPassword('')
                },
            }
        )
    }

    const getRoleIcon = (role: string) => {
        switch (role) {
            case 'admin':
                return <Shield className="h-4 w-4" />
            case 'teacher':
                return <BookOpen className="h-4 w-4" />
            case 'student':
                return <GraduationCap className="h-4 w-4" />
            case 'staff':
                return <Briefcase className="h-4 w-4" />
            default:
                return <Users className="h-4 w-4" />
        }
    }

    const getRoleBadgeClass = (role: string): string => {
        switch (role) {
            case 'admin':
                return '!bg-violet-500 hover:!bg-violet-600 !text-white !border-transparent'
            case 'teacher':
                return '!bg-green-500 hover:!bg-green-600 !text-white !border-transparent'
            case 'student':
                return '!bg-orange-500 hover:!bg-orange-600 !text-white !border-transparent'
            case 'staff':
                return '!bg-blue-500 hover:!bg-blue-600 !text-white !border-transparent'
            default:
                return '!bg-secondary !text-secondary-foreground !border-transparent'
        }
    }

    const fetchAllUsersForExport = async () => {
        const fetchUsersPage = async (page: number) => {
            const params = new URLSearchParams()
            if (roleFilter !== 'all' && roleFilter !== 'staff') params.append('role', roleFilter)
            if (debouncedSearch) params.append('search', debouncedSearch)
            params.append('page', page.toString())
            params.append('page_size', '200')
            return api.get<{ users: AdminUser[]; total: number; page: number; page_size: number }>(`/admin/users?${params.toString()}`)
        }

        const fetchStaffPage = async (page: number) => {
            const params = new URLSearchParams()
            if (debouncedSearch) params.append('search', debouncedSearch)
            params.append('page', page.toString())
            params.append('page_size', '200')
            return api.get<StaffResponse>(`/admin/staff?${params.toString()}`)
        }

        const aggregatedUsers: AdminUser[] = []
        const aggregatedStaff: Staff[] = []

        if (roleFilter !== 'staff') {
            let page = 1
            while (true) {
                const response = await fetchUsersPage(page)
                aggregatedUsers.push(...(response.users || []).filter((user) => user.role !== 'staff'))
                const totalPages = Math.ceil((response.total || 0) / (response.page_size || 200))
                if (page >= totalPages || totalPages === 0) break
                page += 1
            }
        }

        if (roleFilter === 'all' || roleFilter === 'staff') {
            let page = 1
            while (true) {
                const response = await fetchStaffPage(page)
                aggregatedStaff.push(...(response.staff || []))
                const totalPages = Math.ceil((response.total || 0) / (response.page_size || 200))
                if (page >= totalPages || totalPages === 0) break
                page += 1
            }
        }

        const merged = [...aggregatedUsers, ...aggregatedStaff.map(mapStaffToAdminUser)]

        return merged
            .filter((user) => {
                if (roleFilter !== 'all' && user.role !== roleFilter) return false
                if (yearFilter !== 'all' && user.created_at) {
                    const createdYear = new Date(user.created_at).getFullYear()
                    if (createdYear !== Number(yearFilter)) return false
                }
                if (roleFilter === 'staff' && designationFilter !== 'all') {
                    if ((user.designation || user.department) !== designationFilter) return false
                }
                if (roleFilter === 'student') {
                    if (classFilter !== 'all' && user.class_name !== classFilter) return false
                    if (statusFilter !== 'all') {
                        const isSuspended = !!user.is_suspended
                        if (statusFilter === 'suspended' ? !isSuspended : isSuspended) return false
                    }
                }
                return true
            })
            .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', undefined, { sensitivity: 'base' }))
    }

    const exportUsers = async () => {
        try {
            const exportUsers = await fetchAllUsersForExport()
            const rows = exportUsers.map((user) => ({
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                phone: user.phone || '',
                designation: user.designation || user.department || '',
                class_name: user.class_name || '',
                roll_number: user.roll_number || '',
                parent_name: user.parent_name || '',
                parent_phone: user.parent_phone || '',
                is_suspended: user.is_suspended ? 'Yes' : 'No',
                created_at: user.created_at || '',
            }))

            const worksheet = XLSX.utils.json_to_sheet(rows)
            const workbook = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Users')
            XLSX.writeFile(workbook, `users-export-${new Date().toISOString().slice(0, 10)}.xlsx`)

            toast.success('Export completed', {
                description: `${rows.length} user record(s) exported to XLSX.`,
            })
        } catch (error) {
            toast.error('Export failed', {
                description: error instanceof Error ? error.message : 'Could not export users.',
            })
        }
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
                    await api.post('/admin/staff', {
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
                    await api.post('/admin/teachers', {
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
                    await api.post('/admin/students', {
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
                    await api.post('/admin/users', {
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
            queryClient.invalidateQueries({ queryKey: ['users'] }),
            queryClient.invalidateQueries({ queryKey: ['staff'] }),
            queryClient.invalidateQueries({ queryKey: ['user-stats'] }),
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
        setIsImportPanelOpen(false)
        resetImportState()
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold">User Management</h1>
                    <p className="text-muted-foreground">Manage all users in the system</p>
                </div>
                <div className="grid grid-cols-3 gap-2 w-full md:w-auto md:min-w-[360px]">
                    <Button variant="outline" onClick={handleImport} className="h-9 w-full px-2 text-[11px] sm:text-sm">
                        <FileDown className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                        <span className="truncate">Import</span>
                    </Button>
                    <Button variant="outline" onClick={exportUsers} className="h-9 w-full px-2 text-[11px] sm:text-sm">
                        <FileSpreadsheet className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                        <span className="truncate">Export</span>
                    </Button>
                    <Button onClick={() => setIsAddDialogOpen(true)} className="h-9 w-full px-2 text-[11px] sm:text-sm bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0">
                        <Plus className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                        <span className="truncate">Add User</span>
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 grid-cols-2 xl:grid-cols-5">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                                <Users className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{userStats.total}</p>
                                <p className="text-xs text-muted-foreground">Total Users</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                                <Shield className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{userStats.admins}</p>
                                <p className="text-xs text-muted-foreground">Admins</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                                <BookOpen className="h-5 w-5 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{userStats.teachers}</p>
                                <p className="text-xs text-muted-foreground">Teachers</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                                <GraduationCap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{userStats.students}</p>
                                <p className="text-xs text-muted-foreground">Students</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                                <Briefcase className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{userStats.staff}</p>
                                <p className="text-xs text-muted-foreground">Staff</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Users Table */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                        <div className="relative flex-1 min-w-0 md:max-w-sm">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search users..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div className="flex flex-nowrap gap-2 w-full xl:w-auto xl:flex-wrap xl:gap-3">
                            <Select value={roleFilter} onValueChange={setRoleFilter}>
                                <SelectTrigger className="flex-1 min-w-0 sm:w-[160px] sm:flex-none">
                                    <Filter className="mr-2 h-4 w-4 shrink-0" />
                                    <SelectValue placeholder="Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Roles</SelectItem>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="teacher">Teacher</SelectItem>
                                    <SelectItem value="student">Student</SelectItem>
                                    <SelectItem value="staff">Staff</SelectItem>
                                </SelectContent>
                            </Select>

                            {createdYears.length > 0 && (
                                <Select value={yearFilter} onValueChange={setYearFilter}>
                                    <SelectTrigger className="flex-1 min-w-0 sm:w-[130px] sm:flex-none">
                                        <SelectValue placeholder="Year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Years</SelectItem>
                                        {createdYears.map(y => (
                                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                            {roleFilter === 'staff' && (
                                <Select value={designationFilter} onValueChange={setDesignationFilter}>
                                    <SelectTrigger className="flex-1 min-w-0 sm:w-[180px] sm:flex-none">
                                        <SelectValue placeholder="All Designations" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Designations</SelectItem>
                                        {staffDesignations.map(d => (
                                            <SelectItem key={d} value={d}>{d}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                            {roleFilter === 'student' && (
                                <>
                                    <Select value={classFilter} onValueChange={setClassFilter}>
                                        <SelectTrigger className="flex-1 min-w-0 sm:w-[150px] sm:flex-none">
                                            <SelectValue placeholder="All Classes" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Classes</SelectItem>
                                            {studentClasses.map(c => (
                                                <SelectItem key={c} value={c}>{c}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                                        <SelectTrigger className="flex-1 min-w-0 sm:w-[140px] sm:flex-none">
                                            <SelectValue placeholder="All Status" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Status</SelectItem>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="suspended">Suspended</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </>
                            )}

                            <Button
                                variant="outline"
                                size="icon"
                                className="shrink-0 w-10"
                                onClick={() => {
                                    setSearchQuery('')
                                    setRoleFilter('all')
                                    setYearFilter('all')
                                    setDesignationFilter('all')
                                    setClassFilter('all')
                                    setStatusFilter('all')
                                }}
                            >
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>User</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Info</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead>Salary</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isAnyLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-24 text-center">
                                            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                                        </TableCell>
                                    </TableRow>
                                ) : filteredUsers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                            No users found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredUsers.map((user, index) => (
                                        <TableRow key={user.id} className={`hover:bg-muted/50 ${user.is_suspended ? 'bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/60 dark:hover:bg-red-950/30' : ''}`} ref={index === fetchTriggerIndex ? scrollRef : undefined}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={user.avatar} />
                                                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
                                                            {getInitials(user.full_name)}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-medium">{user.full_name}</p>
                                                            {user.is_suspended && (
                                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-400 text-orange-600 bg-orange-50 dark:bg-orange-500/10 dark:text-orange-400">
                                                                    Suspended
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-muted-foreground">{user.email}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={`gap-1 ${getRoleBadgeClass(user.role)}`}>
                                                    {getRoleIcon(user.role)}
                                                    <span className="capitalize">{user.role}</span>
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{user.phone || <span className="text-muted-foreground">-</span>}</TableCell>
                                            <TableCell>
                                                <span className="text-sm text-muted-foreground">
                                                    {user.role === 'student' && user.class_name ? user.class_name
                                                        : user.role === 'teacher' ? 'Teacher'
                                                        : user.role === 'staff' && user.designation ? user.designation
                                                        : '-'}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-sm">
                                                    <p className="text-muted-foreground">{user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</p>
                                                    {user.created_by_name && <p className="text-xs text-muted-foreground/60">by {user.created_by_name}</p>}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {user.role !== 'student' && user.salary != null && user.salary > 0
                                                    ? <span className="text-sm font-medium">₹{user.salary.toLocaleString()}</span>
                                                    : <span className="text-muted-foreground">-</span>}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center justify-end gap-1">
                                                    {(!user.phone || (user.role === 'student' && (!user.class_name || !user.roll_number || !user.parent_name || !user.parent_phone)) || (user.role === 'staff' && !user.designation)) && (
                                                        <div className="group relative">
                                                            <div className="h-5 w-5 rounded-full bg-destructive/10 flex items-center justify-center cursor-help">
                                                                <AlertTriangle className="h-3 w-3 text-destructive" />
                                                            </div>
                                                            <div className="absolute bottom-full right-0 mb-2 hidden w-48 rounded bg-popover p-2 text-xs text-popover-foreground shadow-md group-hover:block border z-50">
                                                                <p className="font-semibold mb-1 text-destructive">Missing Info:</p>
                                                                <ul className="list-disc pl-3 space-y-0.5">
                                                                    {!user.phone && <li>Phone</li>}
                                                                    {user.role === 'student' && !user.class_name && <li>Class</li>}
                                                                    {user.role === 'student' && !user.roll_number && <li>Roll Number</li>}
                                                                    {user.role === 'student' && !user.parent_name && <li>Parent Name</li>}
                                                                    {user.role === 'student' && !user.parent_phone && <li>Parent Phone</li>}
                                                                    {user.role === 'staff' && !user.designation && <li>Designation</li>}
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setSelectedUser(user)
                                                                setIsViewDialogOpen(true)
                                                            }}
                                                        >
                                                            <Eye className="mr-2 h-4 w-4" />
                                                            View Details
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setSelectedUser(user)
                                                                setEditPassword('')
                                                                setIsEditDialogOpen(true)
                                                            }}
                                                        >
                                                            <Edit className="mr-2 h-4 w-4" />
                                                            Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setSelectedUser(user)
                                                                setSuspendAction(user.is_suspended ? 'unsuspend' : 'suspend')
                                                                setSuspendPassword('')
                                                                setShowSuspendPassword(false)
                                                                setIsSuspendDialogOpen(true)
                                                            }}
                                                            className={user.is_suspended ? 'text-green-600' : 'text-orange-600'}
                                                        >
                                                            {user.is_suspended ? (
                                                                <><Unlock className="mr-2 h-4 w-4" />Unsuspend</>
                                                            ) : (
                                                                <><Lock className="mr-2 h-4 w-4" />Suspend</>
                                                            )}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            className="text-destructive"
                                                            onClick={() => {
                                                                setSelectedUser(user)
                                                                setIsDeleteDialogOpen(true)
                                                            }}
                                                        >
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                        </div>
                    </div>
                    <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-muted-foreground">
                            Showing {filteredUsers.length} of {totalUsersCount} users
                        </p>
                        {isAnyFetchingNextPage && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading more...
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* View Dialog */}
            <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>User Details</DialogTitle>
                    </DialogHeader>
                    {selectedUser && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-20 w-20">
                                    <AvatarImage src={selectedUser.avatar} />
                                    <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-xl">
                                        {getInitials(selectedUser.full_name)}
                                    </AvatarFallback>
                                </Avatar>
                                <div>
                                    <h3 className="text-xl font-bold">{selectedUser.full_name}</h3>
                                    <p className="text-muted-foreground">{selectedUser.email}</p>
                                    <Badge variant="outline" className={`mt-2 gap-1 ${getRoleBadgeClass(selectedUser.role)}`}>
                                        {getRoleIcon(selectedUser.role)}
                                        <span className="capitalize">{selectedUser.role}</span>
                                    </Badge>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-3 rounded-lg bg-muted">
                                    <p className="text-sm text-muted-foreground">Phone</p>
                                    <p className="font-medium">{selectedUser.phone || 'Not provided'}</p>
                                </div>
                                {selectedUser.created_by_name && (
                                    <div className="p-3 rounded-lg bg-muted">
                                        <p className="text-sm text-muted-foreground">Created By</p>
                                        <p className="font-medium">{selectedUser.created_by_name}</p>
                                    </div>
                                )}
                            </div>

                            {/* Student profile section */}
                            {selectedUser.role === 'student' && studentProfileData && (
                                <>
                                    <Separator />
                                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Student Profile</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            { label: 'Admission No.', value: studentProfileData.admission_number },
                                            { label: 'Roll No.', value: studentProfileData.roll_number },
                                            { label: 'APAAR ID', value: studentProfileData.apaar_id },
                                            { label: 'ABC ID', value: studentProfileData.abc_id },
                                            { label: 'Class', value: studentProfileData.class_name },
                                            { label: 'Gender', value: studentProfileData.gender },
                                            { label: 'Date of Birth', value: studentProfileData.date_of_birth?.slice(0, 10) },
                                            { label: 'Blood Group', value: studentProfileData.blood_group },
                                            { label: 'Academic Year', value: studentProfileData.academic_year },
                                            { label: 'Transport Mode', value: studentProfileData.transport_mode },
                                            { label: 'Address', value: studentProfileData.address },
                                            { label: 'Parent / Guardian', value: studentProfileData.parent_name },
                                            { label: 'Parent Email', value: studentProfileData.parent_email },
                                            { label: 'Parent Phone', value: studentProfileData.parent_phone },
                                        ].map(({ label, value }) => (
                                            <div key={label} className="p-3 rounded-lg bg-muted">
                                                <p className="text-xs text-muted-foreground">{label}</p>
                                                <p className="text-sm font-medium break-words">{value || '—'}</p>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {/* Teacher profile section */}
                            {selectedUser.role === 'teacher' && teacherProfileData && (
                                <>
                                    <Separator />
                                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Teacher Profile</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            { label: 'Employee ID', value: teacherProfileData.employeeId },
                                            { label: 'Designation', value: teacherProfileData.designation },
                                            { label: 'Experience (yrs)', value: teacherProfileData.experience != null ? String(teacherProfileData.experience) : undefined },
                                            { label: 'Hire Date', value: teacherProfileData.joinDate?.slice(0, 10) },
                                            { label: 'Status', value: teacherProfileData.status },
                                            { label: 'Subjects', value: (teacherProfileData.subjects || []).join(', ') || undefined },
                                            { label: 'Classes', value: (teacherProfileData.classes || []).join(', ') || undefined },
                                            { label: 'Qualifications', value: (teacherProfileData.qualifications || []).join(', ') || undefined },
                                        ].map(({ label, value }) => (
                                            <div key={label} className="p-3 rounded-lg bg-muted">
                                                <p className="text-xs text-muted-foreground">{label}</p>
                                                <p className="text-sm font-medium break-words">{value || '—'}</p>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsViewDialogOpen(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog
                open={isEditDialogOpen}
                onOpenChange={(open) => {
                    setIsEditDialogOpen(open)
                    if (!open) {
                        setEditPassword('')
                        setShowEditPassword(false)
                    }
                }}
            >
                <DialogContent className="w-[95vw] sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit User</DialogTitle>
                        <DialogDescription>
                            Update user information.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedUser && (
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit-name">Full Name</Label>
                                <Input
                                    id="edit-name"
                                    value={selectedUser.full_name}
                                    onChange={(e) => setSelectedUser({ ...selectedUser, full_name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-email">Email Address</Label>
                                <Input
                                    id="edit-email"
                                    type="email"
                                    value={selectedUser.email}
                                    onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-role">Role</Label>
                                <Select
                                    value={selectedUser.role}
                                    onValueChange={(value: 'admin' | 'teacher' | 'student' | 'staff') =>
                                        setSelectedUser({ ...selectedUser, role: value })
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="teacher">Teacher</SelectItem>
                                        <SelectItem value="student">Student</SelectItem>
                                        <SelectItem value="staff">Staff</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-phone">Phone Number</Label>
                                <Input
                                    id="edit-phone"
                                    type="tel"
                                    inputMode="numeric"
                                    maxLength={10}
                                    placeholder="10-digit mobile number"
                                    value={selectedUser.phone || ''}
                                    onChange={(e) => setSelectedUser({ ...selectedUser, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-password">New Password</Label>
                                <div className="relative">
                                    <Input
                                        id="edit-password"
                                        type={showEditPassword ? "text" : "password"}
                                        value={editPassword}
                                        onChange={(e) => setEditPassword(e.target.value)}
                                        placeholder="Leave blank to keep current password"
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowEditPassword((prev) => !prev)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        aria-label={showEditPassword ? "Hide password" : "Show password"}
                                    >
                                        {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* ── Student profile edit section ── */}
                            {selectedUser.role === 'student' && (
                                <>
                                    <Separator className="my-1" />
                                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Student Profile</p>

                                    {/* Academic Info */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Academic Info</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1">
                                            <Label>Admission No.</Label>
                                            <Input value={editStudentForm.admissionNumber} onChange={e => setEditStudentForm(f => ({ ...f, admissionNumber: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Roll No.</Label>
                                            <Input value={editStudentForm.rollNumber} onChange={e => setEditStudentForm(f => ({ ...f, rollNumber: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>APAAR ID</Label>
                                            <Input value={editStudentForm.apaarId} onChange={e => setEditStudentForm(f => ({ ...f, apaarId: e.target.value.replace(/\s+/g, '') }))} placeholder="12-digit APAAR" />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>ABC ID</Label>
                                            <Input value={editStudentForm.abcId} onChange={e => setEditStudentForm(f => ({ ...f, abcId: e.target.value.replace(/\s+/g, '') }))} placeholder="Academic Bank ID" />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Class</Label>
                                            <Select value={editStudentForm.classId || '__none__'} onValueChange={v => setEditStudentForm(f => ({ ...f, classId: v === '__none__' ? '' : v }))}>
                                                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">None</SelectItem>
                                                    {classes.map(cls => <SelectItem key={cls.id} value={cls.id}>{cls.name}{cls.section ? ` - ${cls.section}` : ''}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Academic Year</Label>
                                            <Input value={editStudentForm.academicYear} onChange={e => setEditStudentForm(f => ({ ...f, academicYear: e.target.value }))} placeholder="e.g. 2025-2026" />
                                        </div>
                                    </div>

                                    {/* Personal Details */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Personal Details</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1">
                                            <Label>Gender</Label>
                                            <Select value={editStudentForm.gender || '__none__'} onValueChange={v => setEditStudentForm(f => ({ ...f, gender: v === '__none__' ? '' : v }))}>
                                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">None</SelectItem>
                                                    <SelectItem value="male">Male</SelectItem>
                                                    <SelectItem value="female">Female</SelectItem>
                                                    <SelectItem value="other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Date of Birth</Label>
                                            <Input type="date" value={editStudentForm.dateOfBirth} onChange={e => setEditStudentForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Blood Group</Label>
                                            <Input value={editStudentForm.bloodGroup} onChange={e => setEditStudentForm(f => ({ ...f, bloodGroup: e.target.value }))} placeholder="e.g. A+" />
                                        </div>
                                        <div className="col-span-2 grid gap-1">
                                            <Label>Address</Label>
                                            <Input value={editStudentForm.address} onChange={e => setEditStudentForm(f => ({ ...f, address: e.target.value }))} />
                                        </div>
                                    </div>

                                    {/* Parent & Contact */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Parent &amp; Contact</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1">
                                            <Label>Parent / Guardian</Label>
                                            <Input value={editStudentForm.parentName} onChange={e => setEditStudentForm(f => ({ ...f, parentName: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Parent Email</Label>
                                            <Input type="email" value={editStudentForm.parentEmail} onChange={e => setEditStudentForm(f => ({ ...f, parentEmail: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Parent Phone</Label>
                                            <Input value={editStudentForm.parentPhone} onChange={e => setEditStudentForm(f => ({ ...f, parentPhone: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Emergency Contact</Label>
                                            <Input value={editStudentForm.emergencyContact} onChange={e => setEditStudentForm(f => ({ ...f, emergencyContact: e.target.value }))} />
                                        </div>
                                    </div>

                                    {/* Transport */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Transport</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1">
                                            <Label>Transport Mode</Label>
                                            <Select value={editStudentForm.transportMode || '__none__'} onValueChange={v => setEditStudentForm(f => ({ ...f, transportMode: v === '__none__' ? '' : v, busRouteId: v !== 'school_bus' ? '' : f.busRouteId }))}>
                                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">None</SelectItem>
                                                    <SelectItem value="school_bus">School Bus</SelectItem>
                                                    <SelectItem value="private">Private</SelectItem>
                                                    <SelectItem value="walking">Walking</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-1">
                                            <Label className={editStudentForm.transportMode !== 'school_bus' ? 'text-muted-foreground' : ''}>Bus Route</Label>
                                            <Popover open={openBusRouteSelect && editStudentForm.transportMode === 'school_bus'} onOpenChange={v => { if (editStudentForm.transportMode === 'school_bus') setOpenBusRouteSelect(v) }}>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        role="combobox"
                                                        disabled={editStudentForm.transportMode !== 'school_bus'}
                                                        aria-expanded={openBusRouteSelect}
                                                        className="w-full justify-between font-normal"
                                                    >
                                                        <span className="truncate">
                                                            {editStudentForm.busRouteId
                                                                ? busRoutesData.find((r: BusRoute) => r.id === editStudentForm.busRouteId)?.route_name ?? 'Select route...'
                                                                : 'None'}
                                                        </span>
                                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-[260px] p-0" align="start">
                                                    <div className="p-2 border-b">
                                                        <Input
                                                            placeholder="Search route name..."
                                                            value={busRouteSearch}
                                                            onChange={e => setBusRouteSearch(e.target.value)}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                    <div className="max-h-52 overflow-y-auto p-1">
                                                        <div
                                                            className={`relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground ${!editStudentForm.busRouteId ? 'bg-accent' : ''}`}
                                                            onClick={() => { setEditStudentForm(f => ({ ...f, busRouteId: '' })); setOpenBusRouteSelect(false) }}
                                                        >
                                                            <Check className={`mr-2 h-4 w-4 ${!editStudentForm.busRouteId ? 'opacity-100' : 'opacity-0'}`} />
                                                            <span className="text-muted-foreground">None</span>
                                                        </div>
                                                        {busRoutesData
                                                            .filter((r: BusRoute) => !busRouteSearch || r.route_name.toLowerCase().includes(busRouteSearch.toLowerCase()))
                                                            .map((r: BusRoute) => (
                                                                <div
                                                                    key={r.id}
                                                                    className={`relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground ${editStudentForm.busRouteId === r.id ? 'bg-accent' : ''}`}
                                                                    onClick={() => { setEditStudentForm(f => ({ ...f, busRouteId: r.id })); setBusRouteSearch(''); setOpenBusRouteSelect(false) }}
                                                                >
                                                                    <Check className={`mr-2 h-4 w-4 ${editStudentForm.busRouteId === r.id ? 'opacity-100' : 'opacity-0'}`} />
                                                                    <span>{r.route_name}</span>
                                                                </div>
                                                            ))
                                                        }
                                                        {busRoutesData.filter((r: BusRoute) => !busRouteSearch || r.route_name.toLowerCase().includes(busRouteSearch.toLowerCase())).length === 0 && (
                                                            <p className="text-sm text-muted-foreground p-2 text-center">No routes found.</p>
                                                        )}
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* ── Teacher profile edit section ── */}
                            {selectedUser.role === 'staff' && (
                                <>
                                    <Separator className="my-1" />
                                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Staff Profile</p>

                                    {/* Job Details */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Job Details</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1 col-span-2">
                                            <Label>Designation</Label>
                                            <Select
                                                value={editStaffForm.designation}
                                                onValueChange={v => setEditStaffForm(f => ({ ...f, designation: v }))}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue placeholder="Select designation" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Driver">Driver</SelectItem>
                                                    <SelectItem value="Librarian">Librarian</SelectItem>
                                                    <SelectItem value="Security Guard">Security Guard</SelectItem>
                                                    <SelectItem value="Peon">Peon</SelectItem>
                                                    <SelectItem value="Sweeper">Sweeper</SelectItem>
                                                    <SelectItem value="Accountant">Accountant</SelectItem>
                                                    <SelectItem value="Office Staff">Office Staff</SelectItem>
                                                    <SelectItem value="Lab Assistant">Lab Assistant</SelectItem>
                                                    <SelectItem value="Nurse">Nurse</SelectItem>
                                                    <SelectItem value="Canteen Staff">Canteen Staff</SelectItem>
                                                    <SelectItem value="Gardener">Gardener</SelectItem>
                                                    <SelectItem value="IT Support">IT Support</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Qualification</Label>
                                            <Input value={editStaffForm.qualification} onChange={e => setEditStaffForm(f => ({ ...f, qualification: e.target.value }))} placeholder="e.g. B.Com" />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Experience (yrs)</Label>
                                            <Input type="number" min={0} value={editStaffForm.experience} onChange={e => setEditStaffForm(f => ({ ...f, experience: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Salary</Label>
                                            <Input type="number" min={0} value={editStaffForm.salary} onChange={e => setEditStaffForm(f => ({ ...f, salary: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Blood Group</Label>
                                            <Input value={editStaffForm.bloodGroup} onChange={e => setEditStaffForm(f => ({ ...f, bloodGroup: e.target.value }))} placeholder="e.g. O+" />
                                        </div>
                                    </div>

                                    {/* Personal */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Personal</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1">
                                            <Label>Date of Birth</Label>
                                            <Input type="date" value={editStaffForm.dateOfBirth} onChange={e => setEditStaffForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Emergency Contact</Label>
                                            <Input value={editStaffForm.emergencyContact} onChange={e => setEditStaffForm(f => ({ ...f, emergencyContact: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1 col-span-2">
                                            <Label>Address</Label>
                                            <Input value={editStaffForm.address} onChange={e => setEditStaffForm(f => ({ ...f, address: e.target.value }))} />
                                        </div>
                                    </div>
                                </>
                            )}

                            {selectedUser.role === 'teacher' && (
                                <>
                                    <Separator className="my-1" />
                                    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Teacher Profile</p>

                                    {/* Professional Info */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Professional Info</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1">
                                            <Label>Employee ID</Label>
                                            <Input value={editTeacherForm.employeeId} onChange={e => setEditTeacherForm(f => ({ ...f, employeeId: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Experience (yrs)</Label>
                                            <Input type="number" min={0} value={editTeacherForm.experience} onChange={e => setEditTeacherForm(f => ({ ...f, experience: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Hire Date</Label>
                                            <Input type="date" value={editTeacherForm.hireDate} onChange={e => setEditTeacherForm(f => ({ ...f, hireDate: e.target.value }))} />
                                        </div>
                                        <div className="grid gap-1">
                                            <Label>Status</Label>
                                            <Select value={editTeacherForm.status || '__none__'} onValueChange={v => setEditTeacherForm(f => ({ ...f, status: v === '__none__' ? '' : v }))}>
                                                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">None</SelectItem>
                                                    <SelectItem value="active">Active</SelectItem>
                                                    <SelectItem value="inactive">Inactive</SelectItem>
                                                    <SelectItem value="on_leave">On Leave</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {/* Qualifications */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Qualifications</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid gap-3">
                                        <div className="grid gap-1">
                                            <Label>Qualifications <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
                                            <Input value={editTeacherForm.qualificationsStr} onChange={e => setEditTeacherForm(f => ({ ...f, qualificationsStr: e.target.value }))} placeholder="B.Ed, M.Sc" />
                                        </div>
                                    </div>

                                    {/* Subjects */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Subjects Taught</span>
                                        <div className="flex-1 h-px bg-border" />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => {
                                                const first = catalogSubjects.find(s => !editTeacherForm.subjectIds.includes(s.id))
                                                if (first) setEditTeacherForm(f => ({ ...f, subjectIds: [...f.subjectIds, first.id] }))
                                            }}
                                        >
                                            <Plus className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="space-y-2">
                                        {editTeacherForm.subjectIds.length === 0 && (
                                            <p className="text-sm text-muted-foreground">No subjects assigned. Click + to add.</p>
                                        )}
                                        {editTeacherForm.subjectIds.map((id, index) => (
                                            <div key={`${id}-${index}`} className="flex items-center gap-2">
                                                <Select
                                                    value={id}
                                                    onValueChange={(val) => {
                                                        const next = [...editTeacherForm.subjectIds]
                                                        next[index] = val
                                                        setEditTeacherForm(f => ({ ...f, subjectIds: next }))
                                                    }}
                                                >
                                                    <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                                                    <SelectContent>
                                                        {[
                                                            ...catalogSubjects,
                                                            ...(catalogSubjects.find(s => s.id === id) ? [] : [{ id, name: id, code: '' }])
                                                        ].map(s => (
                                                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0"
                                                    onClick={() => setEditTeacherForm(f => ({ ...f, subjectIds: f.subjectIds.filter((_, i) => i !== index) }))}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Personal & Salary */}
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Personal &amp; Salary</span>
                                        <div className="flex-1 h-px bg-border" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="grid gap-1">
                                            <Label>Salary</Label>
                                            <Input type="number" min={0} value={editTeacherForm.salary} onChange={e => setEditTeacherForm(f => ({ ...f, salary: e.target.value }))} />
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button className="w-full sm:w-auto" onClick={handleEditUser} disabled={updateUser.isPending || updateStudentProfile.isPending || updateTeacherProfile.isPending || updateStaff.isPending}>
                            {(updateUser.isPending || updateStudentProfile.isPending || updateTeacherProfile.isPending || updateStaff.isPending) ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete{' '}
                            <span className="font-semibold">{selectedUser?.full_name}</span>&apos;s account and
                            remove all associated data.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                        <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteUser}
                            className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete User
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Suspend / Unsuspend Confirmation */}
            <Dialog
                open={isSuspendDialogOpen}
                onOpenChange={(open) => {
                    setIsSuspendDialogOpen(open)
                    if (!open) { setSuspendPassword(''); setShowSuspendPassword(false) }
                }}
            >
                <DialogContent className="w-[95vw] sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className={suspendAction === 'suspend' ? 'text-orange-600' : 'text-green-600'}>
                            {suspendAction === 'suspend' ? 'Suspend User' : 'Remove Suspension'}
                        </DialogTitle>
                        <DialogDescription>
                            {suspendAction === 'suspend' ? (
                                <>
                                    <span className="font-semibold">{selectedUser?.full_name}</span> will be unable to log in.
                                    Their materials, documents, and quizzes are fully preserved and can be restored at any time.
                                </>
                            ) : (
                                <>Remove the suspension from <span className="font-semibold">{selectedUser?.full_name}</span>. They will be able to log in again immediately.</>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <Label htmlFor="suspend-password">Your password to confirm</Label>
                        <div className="relative">
                            <Input
                                id="suspend-password"
                                type={showSuspendPassword ? 'text' : 'password'}
                                placeholder="Enter your password"
                                value={suspendPassword}
                                onChange={(e) => setSuspendPassword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && suspendPassword && handleSuspendAction()}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                                onClick={() => setShowSuspendPassword(v => !v)}
                            >
                                {showSuspendPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => setIsSuspendDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={!suspendPassword || suspendUser.isPending || unsuspendUser.isPending}
                            onClick={handleSuspendAction}
                            className={`w-full sm:w-auto ${suspendAction === 'suspend' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                        >
                            {(suspendUser.isPending || unsuspendUser.isPending) && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {suspendAction === 'suspend' ? 'Suspend' : 'Remove Suspension'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {isImportPanelOpen && (
                <div className="fixed inset-0 z-[120]">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
                        onClick={() => {
                            setIsImportPanelOpen(false)
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
                                    setIsImportPanelOpen(false)
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
                                        setIsImportPanelOpen(false)
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
            )}

            {/* Add User Dialog */}
            <Dialog
                open={isAddDialogOpen}
                onOpenChange={(open) => {
                    setIsAddDialogOpen(open)
                    if (!open) setShowAddPassword(false)
                }}
            >
                <DialogContent className="w-[95vw] sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Add New User</DialogTitle>
                        <DialogDescription>
                            Create a new user account.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="add-name">Full Name</Label>
                            <Input
                                id="add-name"
                                value={newUser.name}
                                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                                placeholder="John Doe"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="add-email">Email Address</Label>
                            <Input
                                id="add-email"
                                type="email"
                                value={newUser.email}
                                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                placeholder="john@school.com"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="add-role">Role</Label>
                            <Select
                                value={newUser.role}
                                onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                            >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="teacher">Teacher</SelectItem>
                                    <SelectItem value="student">Student</SelectItem>
                                    <SelectItem value="staff">Staff</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {newUser.role === 'student' ? (
                            <div className="grid gap-2">
                                <Label htmlFor="add-class">Class</Label>
                                <Select
                                    value={newUser.classId || '__none__'}
                                    onValueChange={(v) => setNewUser({ ...newUser, classId: v === '__none__' ? '' : v })}
                                >
                                    <SelectTrigger id="add-class" className="w-full">
                                        <SelectValue placeholder="Select class (optional)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">No class assigned</SelectItem>
                                        {classes.map(cls => (
                                            <SelectItem key={cls.id} value={cls.id}>
                                                {cls.name}{cls.section ? ` - ${cls.section}` : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}
                        {newUser.role === 'staff' ? (
                            <>
                                <div className="grid gap-2">
                                    <Label htmlFor="add-designation">Designation <span className="text-destructive">*</span></Label>
                                    <Select
                                        value={newUser.designation}
                                        onValueChange={v => setNewUser({ ...newUser, designation: v })}
                                    >
                                        <SelectTrigger className="w-full" id="add-designation">
                                            <SelectValue placeholder="Select designation" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Driver">Driver</SelectItem>
                                            <SelectItem value="Librarian">Librarian</SelectItem>
                                            <SelectItem value="Security Guard">Security Guard</SelectItem>
                                            <SelectItem value="Peon">Peon</SelectItem>
                                            <SelectItem value="Sweeper">Sweeper</SelectItem>
                                            <SelectItem value="Accountant">Accountant</SelectItem>
                                            <SelectItem value="Office Staff">Office Staff</SelectItem>
                                            <SelectItem value="Lab Assistant">Lab Assistant</SelectItem>
                                            <SelectItem value="Nurse">Nurse</SelectItem>
                                            <SelectItem value="Canteen Staff">Canteen Staff</SelectItem>
                                            <SelectItem value="Gardener">Gardener</SelectItem>
                                            <SelectItem value="IT Support">IT Support</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="add-qualification">Qualification</Label>
                                    <Input
                                        id="add-qualification"
                                        value={newUser.qualification}
                                        onChange={(e) => setNewUser({ ...newUser, qualification: e.target.value })}
                                        placeholder="e.g. B.Com, ITI"
                                    />
                                </div>
                            </>
                        ) : null}
                        <div className="grid gap-2">
                            <Label htmlFor="add-phone">Phone Number</Label>
                            <Input
                                id="add-phone"
                                type="tel"
                                inputMode="numeric"
                                maxLength={10}
                                placeholder="10-digit mobile number"
                                value={newUser.phone}
                                onChange={(e) => setNewUser({ ...newUser, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="add-password">Password</Label>
                            <div className="relative">
                                <Input
                                    id="add-password"
                                    type={showAddPassword ? "text" : "password"}
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                    placeholder="Minimum 6 characters"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowAddPassword((prev) => !prev)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    aria-label={showAddPassword ? "Hide password" : "Show password"}
                                >
                                    {showAddPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button className="w-full sm:w-auto" onClick={handleAddUser}>Create User</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

