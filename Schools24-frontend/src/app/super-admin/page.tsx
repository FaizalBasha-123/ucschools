"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PasswordPromptDialog } from "@/components/super-admin/PasswordPromptDialog"
import { QuestionUploaderForm } from "@/app/super-admin/question-generator/page"
import { SuperAdminMaterialsForm } from "@/app/super-admin/materials/page"
import SuperAdminQuizSchedulerPage from "@/app/super-admin/quiz-scheduler/page"
import { SuperAdminSettingsPanel } from "@/app/super-admin/settings/page"
import { SuperAdminTrashPanel } from "@/app/super-admin/trash/page"
import SuperAdminHelpCenterPage from "@/app/super-admin/help-center/page"
import { SADemoRequestsSection } from "@/app/super-admin/demo-requests/page"
import { SuperAdminBlogManagementSection } from "@/app/super-admin/blogs/page"
import { UserGrowthSection } from "@/app/super-admin/users/page"
import { SuperAdminStorageSection, type StorageOverviewResponse, formatStorageBytes } from "@/app/super-admin/storage/page"
import { useAuth } from "@/contexts/AuthContext"
import { useDebounce } from "@/hooks/useDebounce"
import { useInfiniteSchools, useCreateSchool, useDeleteSchool, useUpdateSchool, CreateSchoolParams, UpdateSchoolParams } from "@/hooks/useSchools"
import { api } from "@/lib/api"
import { toast } from "sonner"
import { Eye, EyeOff, Loader2, Mail, MapPin, MoreVertical, Plus, School as SchoolIcon, Search, Trash2, Edit, Layers3, BookOpenCheck, Check, X, Shield, Sparkles, CheckCircle2, Save, ArrowRight, ArrowUp, ArrowDown, Database, HardDrive, RefreshCcw, Link2Off, GitMerge } from "lucide-react"

const UDISE_CODE_REGEX = /^UDISE\d{6,14}$/
const INTERNAL_SCHOOL_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{0,29}$/

function validateSchoolCodeInput(raw: string): string | null {
    const value = raw.trim().toUpperCase()
    if (!value) return null

    if (value.startsWith("UDISE")) {
        if (!UDISE_CODE_REGEX.test(value)) {
            return "UDISE code must be in format UDISE followed by 6-14 digits"
        }
        return null
    }

    if (!INTERNAL_SCHOOL_CODE_REGEX.test(value)) {
        return "School code must use only A-Z, 0-9, underscore, or hyphen (max 30 chars)"
    }
    return null
}

type SuperAdminTab = "schools" | "storage" | "catalog" | "reconciliations" | "question-uploader" | "quiz-scheduler" | "materials" | "blogs" | "settings" | "trash" | "users" | "help-center" | "demo-requests"

function getTabFromSearch(raw: string | null): SuperAdminTab {
    if (raw === "storage" || raw === "catalog" || raw === "reconciliations" || raw === "question-uploader" || raw === "quiz-scheduler" || raw === "materials" || raw === "blogs" || raw === "settings" || raw === "trash" || raw === "users" || raw === "help-center" || raw === "demo-requests") return raw
    return "schools"
}

function SchoolsSection() {
    const router = useRouter()
    const [searchQuery, setSearchQuery] = useState("")
    const debouncedSearch = useDebounce(searchQuery, 300)
    const [isAddSchoolOpen, setIsAddSchoolOpen] = useState(false)
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ id: string; name: string } | null>(null)
    const [showCreatePasswordPrompt, setShowCreatePasswordPrompt] = useState(false)
    const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({})
    const [newSchool, setNewSchool] = useState<Omit<CreateSchoolParams, "password">>({
        name: "",
        code: "",
        address: "",
        contact_email: "",
        admins: [{ name: "", email: "", password: "" }],
    })
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

    const { user, isLoading } = useAuth()
    const isSuperAdmin = user?.role === "super_admin"
    const canLoad = isSuperAdmin && !isLoading
    const { data: schoolsData, isLoading: isSchoolsLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteSchools(canLoad)
    const createSchool = useCreateSchool()
    const deleteSchool = useDeleteSchool()
    const updateSchool = useUpdateSchool()
    const storageOverviewQuery = useQuery({
        queryKey: ["super-admin-storage-overview", "schools-cards"],
        queryFn: () => api.get<StorageOverviewResponse>("/super-admin/storage/overview"),
        enabled: canLoad,
        staleTime: 60_000,
    })

    // ── Edit School state ─────────────────────────────────────────────────────
    const [editSchool, setEditSchool] = useState<{ id: string; name: string; code: string; address: string; contact_email: string } | null>(null)
    const [editForm, setEditForm] = useState({ name: "", code: "", address: "", contact_email: "" })

    const handleEditClick = (e: React.MouseEvent, school: { id: string; name: string; code?: string; address?: string; contact_email?: string }) => {
        e.stopPropagation()
        setEditForm({
            name: school.name,
            code: school.code || "",
            address: school.address || "",
            contact_email: school.contact_email || "",
        })
        setEditSchool({ id: school.id, name: school.name, code: school.code || "", address: school.address || "", contact_email: school.contact_email || "" })
    }

    const handleEditSave = async () => {
        if (!editSchool) return
        if (!editForm.name.trim()) {
            toast.error("School name is required")
            return
        }
        const schoolCodeValidationError = validateSchoolCodeInput(editForm.code || "")
        if (schoolCodeValidationError) {
            toast.error(schoolCodeValidationError)
            return
        }
        try {
            await updateSchool.mutateAsync({ id: editSchool.id, name: editForm.name, code: editForm.code, address: editForm.address, contact_email: editForm.contact_email })
            setEditSchool(null)
        } catch (_) {
            // error already shown by the hook
        }
    }

    const allSchools = useMemo(() => schoolsData?.pages.flatMap((p) => p.schools) ?? [], [schoolsData])

    const filteredSchools = useMemo(() => {
        return allSchools.filter((s) =>
            s.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
            s.contact_email?.toLowerCase().includes(debouncedSearch.toLowerCase())
        )
    }, [allSchools, debouncedSearch])
    const storageBySchool = useMemo(() => {
        const map = new Map<string, StorageOverviewResponse["schools"][number]>()
        for (const item of storageOverviewQuery.data?.schools ?? []) {
            map.set(item.school_id, item)
        }
        return map
    }, [storageOverviewQuery.data])

    const totalSchools = schoolsData?.pages[0]?.total ?? allSchools.length
    const activeSchools = allSchools.filter((s) => s.is_active).length
    const inactiveSchools = Math.max(0, totalSchools - activeSchools)

    useEffect(() => {
        const onScroll = () => {
            if (!hasNextPage || isFetchingNextPage) return
            const el = document.documentElement
            const scrollTop = window.scrollY || el.scrollTop
            const viewportBottom = scrollTop + window.innerHeight
            if (viewportBottom >= el.scrollHeight * 0.8) fetchNextPage()
        }
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    const validatePassword = (password: string) => {
        const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
        if (!regex.test(password)) {
            return "Password must be 8+ chars, incl. uppercase, lowercase, and a number."
        }
        return ""
    }

    const handleCreateSchool = async () => {
        setValidationErrors({})
        const errors: Record<string, string> = {}
        let hasError = false

        const schoolCodeValidationError = validateSchoolCodeInput(newSchool.code || "")
        if (schoolCodeValidationError) {
            toast.error(schoolCodeValidationError)
            return
        }

        if (!newSchool.name) {
            toast.error("School name is required")
            return
        }

        newSchool.admins.forEach((admin, index) => {
            if (!admin.name) errors[`admin_${index}_name`] = "Name is required"
            if (!admin.email) errors[`admin_${index}_email`] = "Email is required"

            if (!admin.password) {
                errors[`admin_${index}_password`] = "Password is required"
            } else {
                const passErr = validatePassword(admin.password)
                if (passErr) errors[`admin_${index}_password`] = passErr
            }

            if (Object.keys(errors).length > 0) hasError = true
        })

        if (hasError) {
            setValidationErrors(errors)
            return
        }
        setShowCreatePasswordPrompt(true)
    }

    const handleCreateSchoolWithPassword = async (password: string) => {
        try {
            await createSchool.mutateAsync({
                ...newSchool,
                password,
            })
            setIsAddSchoolOpen(false)
            setShowCreatePasswordPrompt(false)
            setNewSchool({ name: "", code: "", address: "", contact_email: "", admins: [{ name: "", email: "", password: "" }] })
            setValidationErrors({})
            toast.success("School Created", {
                description: `${newSchool.name} has been successfully created.`,
            })
        } catch (e) {
            throw e
        }
    }

    const confirmDeleteSchool = async (password: string) => {
        if (!deleteConfirmation) return

        try {
            await deleteSchool.mutateAsync({
                schoolId: deleteConfirmation.id,
                password,
            })
            toast.success("School Deleted", {
                description: `${deleteConfirmation.name} has been moved to trash and will be permanently deleted after 24 hours.`,
            })
            setDeleteConfirmation(null)
        } catch (error: unknown) {
            throw error
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col xl:flex-row justify-between xl:items-center items-stretch gap-4 rounded-xl border border-border/60 bg-card/50 backdrop-blur-xl p-4 md:p-5 shadow-sm">
                <div className="relative w-full lg:max-w-[400px]">
                    <Search className="absolute left-3.5 top-3 h-4 w-4 text-indigo-500/70" />
                    <Input
                        placeholder="Search schools by name or contact email..."
                        className="pl-11 h-10 bg-card border-border focus-visible:ring-indigo-500/30 transition-all shadow-sm rounded-lg"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <Dialog open={isAddSchoolOpen} onOpenChange={setIsAddSchoolOpen}>
                    <DialogTrigger asChild>
                        <Button className="w-full md:w-auto h-10 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 transition-all rounded-lg font-medium">
                            <Plus className="h-4 w-4 mr-2" />
                            Add New School
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="w-[95vw] sm:max-w-[600px] p-0 overflow-hidden border-border max-h-[92vh]">
                        <div className="h-2 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500"></div>
                        <div className="px-6 pt-6 pb-2">
                            <DialogHeader>
                                <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                                    <SchoolIcon className="h-5 w-5 text-indigo-500" /> Register New School
                                </DialogTitle>
                                <DialogDescription className="text-base mt-2">
                                    Create a new isolated tenant namespace. This automatically provisions a default Admin account for the school.
                                </DialogDescription>
                            </DialogHeader>
                        </div>

                        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-8 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                            {/* School Information Section */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                    <MapPin className="h-4 w-4" /> School Intelligence
                                </h3>
                                <div className="p-4 rounded-xl bg-muted/50 border border-border space-y-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="name">Registered Name</Label>
                                        <Input id="name" placeholder="e.g. Springfield High School" value={newSchool.name} onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })} className="bg-card focus-visible:ring-indigo-500/30" />
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label htmlFor="contact">Primary Contact Email</Label>
                                            <Input id="contact" type="email" placeholder="admin@springfield.edu" value={newSchool.contact_email} onChange={(e) => setNewSchool({ ...newSchool, contact_email: e.target.value })} className="bg-card focus-visible:ring-indigo-500/30" />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="address">Campus Address</Label>
                                            <Input id="address" placeholder="123 Education Lane, City" value={newSchool.address} onChange={(e) => setNewSchool({ ...newSchool, address: e.target.value })} className="bg-card focus-visible:ring-indigo-500/30" />
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="code">School Code (UDISE+ / Internal)</Label>
                                        <Input
                                            id="code"
                                            placeholder="e.g. UDISE123456"
                                            value={newSchool.code || ''}
                                            onChange={(e) => setNewSchool({ ...newSchool, code: e.target.value.toUpperCase() })}
                                            className="bg-card focus-visible:ring-indigo-500/30"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Admin Accounts Section */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-end border-b border-border pb-2">
                                    <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                        <Shield className="h-4 w-4" /> Root Administrators
                                    </h3>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setNewSchool({ ...newSchool, admins: [...(newSchool.admins || []), { name: "", email: "", password: "" }] })}
                                        className="h-8 text-xs font-medium border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-900/30 transition-colors"
                                    >
                                        <Plus className="h-3.5 w-3.5 mr-1" /> Add Additional Admin
                                    </Button>
                                </div>
                                <div className="space-y-4">
                                    {(newSchool.admins || [{ name: "", email: "", password: "" }]).map((admin, index) => (
                                        <div key={index} className="p-4 bg-card rounded-xl border border-border relative group transition-all hover:border-indigo-300 dark:hover:border-indigo-700 shadow-sm">
                                            {index > 0 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="absolute -top-3 -right-3 h-7 w-7 rounded-full bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-700 dark:bg-red-900/80 dark:text-red-300 dark:hover:bg-red-900 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => {
                                                        const newAdmins = [...newSchool.admins]
                                                        newAdmins.splice(index, 1)
                                                        setNewSchool({ ...newSchool, admins: newAdmins })
                                                    }}
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                            <div className="grid gap-4">
                                                <div className="grid gap-1.5">
                                                    <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Full Name</Label>
                                                    <Input
                                                        placeholder="e.g. Principal Skinner"
                                                        value={admin.name}
                                                        onChange={(e) => {
                                                            const newAdmins = [...newSchool.admins]
                                                            newAdmins[index].name = e.target.value
                                                            setNewSchool({ ...newSchool, admins: newAdmins })
                                                        }}
                                                        className={`h-9 focus-visible:ring-indigo-500/30 ${validationErrors[`admin_${index}_name`] ? "border-red-500 focus-visible:ring-red-500/30" : ""}`}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div className="grid gap-1.5">
                                                        <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Login Email</Label>
                                                        <Input
                                                            type="email"
                                                            placeholder="admin@school.edu"
                                                            value={admin.email}
                                                            onChange={(e) => {
                                                                const newAdmins = [...newSchool.admins]
                                                                newAdmins[index].email = e.target.value
                                                                setNewSchool({ ...newSchool, admins: newAdmins })
                                                            }}
                                                            className={`h-9 focus-visible:ring-indigo-500/30 ${validationErrors[`admin_${index}_email`] ? "border-red-500 focus-visible:ring-red-500/30" : ""}`}
                                                        />
                                                    </div>
                                                    <div className="grid gap-1.5">
                                                        <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Secure Password</Label>
                                                        <div className="relative">
                                                            <Input
                                                                type={showPasswords[index] ? "text" : "password"}
                                                                placeholder="Minimum 8 characters"
                                                                value={admin.password}
                                                                onChange={(e) => {
                                                                    const newAdmins = [...newSchool.admins]
                                                                    newAdmins[index].password = e.target.value
                                                                    setNewSchool({ ...newSchool, admins: newAdmins })
                                                                }}
                                                                className={`h-9 pr-9 focus-visible:ring-indigo-500/30 ${validationErrors[`admin_${index}_password`] ? "border-red-500 focus-visible:ring-red-500/30" : ""}`}
                                                            />
                                                            <button
                                                                type="button"
                                                                className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 hover:bg-muted rounded-md transition-colors"
                                                                onClick={() => setShowPasswords({ ...showPasswords, [index]: !showPasswords[index] })}
                                                                aria-label={showPasswords[index] ? "Hide password" : "Show password"}
                                                            >
                                                                {showPasswords[index] ? (
                                                                    <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                                                                ) : (
                                                                    <Eye className="h-3.5 w-3.5 text-slate-400" />
                                                                )}
                                                            </button>
                                                        </div>
                                                        {validationErrors[`admin_${index}_password`] && (
                                                            <div className="text-[10px] text-red-500 font-medium">
                                                                {validationErrors[`admin_${index}_password`]}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="p-4 border-t border-border bg-muted/50 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                            <Button variant="outline" onClick={() => setIsAddSchoolOpen(false)} className="w-full sm:w-auto">
                                Cancel
                            </Button>
                            <Button onClick={handleCreateSchool} disabled={createSchool.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 w-full sm:w-auto sm:min-w-[140px]">
                                {createSchool.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                {createSchool.isPending ? "Provisioning..." : "Provision School"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {isSchoolsLoading ? (
                    Array(4).fill(0).map((_, i) => (
                        <Card key={i} className="animate-pulse rounded-2xl border-2 border-slate-300/80 dark:border-slate-700/80 overflow-hidden">
                            <CardHeader className="h-28 bg-muted/50" />
                            <CardContent className="p-5 space-y-4">
                                <div className="h-4 bg-slate-200/70 dark:bg-slate-700/70 rounded w-3/4" />
                                <div className="h-4 bg-slate-200/70 dark:bg-slate-700/70 rounded w-1/2" />
                            </CardContent>
                        </Card>
                    ))
                ) : filteredSchools.length === 0 ? (
                    <div className="col-span-full py-24 flex flex-col items-center justify-center text-center bg-card/30 rounded-3xl border border-border/50 backdrop-blur-sm">
                        <div className="p-5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 mb-6">
                            <SchoolIcon className="h-12 w-12 text-indigo-300 dark:text-indigo-700" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">No schools found</h3>
                        <p className="text-sm text-slate-500 max-w-sm">We couldn&apos;t find any schools matching your search. Click &quot;Add New School&quot; to provision a new tenant.</p>
                    </div>
                ) : (
                    filteredSchools.map((school) => (
                        <Card
                            key={school.id}
                            className="group relative overflow-hidden rounded-2xl border-2 border-border/80 bg-card/60 backdrop-blur-xl cursor-pointer transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-indigo-500/10"
                            onClick={() => router.push(`/super-admin/school/${school.slug || school.id}`)}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                            <CardHeader className="relative pb-2 pt-6 px-6">
                                <div className="flex justify-end items-start mb-4">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-muted rounded-full" onClick={(e) => e.stopPropagation()}>
                                                <MoreVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="rounded-xl border-slate-200 dark:border-slate-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
                                            <DropdownMenuItem
                                                className="cursor-pointer focus:bg-indigo-50 dark:focus:bg-indigo-900/30"
                                                onClick={(e) => handleEditClick(e, school)}
                                            >
                                                <Edit className="h-4 w-4 mr-2 text-indigo-500" /> Edit Details
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator className="bg-border" />
                                            <DropdownMenuItem
                                                className="cursor-pointer text-red-600 dark:text-red-400 focus:bg-red-50 dark:focus:bg-red-900/30 focus:text-red-700 dark:focus:text-red-300"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setDeleteConfirmation({ id: school.id, name: school.name })
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" /> Delete School
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                                <CardTitle className="text-xl font-bold tracking-tight text-slate-800 dark:text-white line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" title={school.name}>
                                    {school.name}
                                </CardTitle>
                                {school.code && (
                                    <div className="mt-2 inline-flex w-fit items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                        {school.code}
                                    </div>
                                )}
                                <CardDescription className="flex items-center text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                                    <MapPin className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                                    <span className="truncate">{school.address || "Location unassigned"}</span>
                                </CardDescription>
                            </CardHeader>

                            <CardContent className="relative px-6 pb-6 pt-3 space-y-5">
                                <div className="flex items-center text-sm text-slate-600 dark:text-slate-300 bg-muted/50 p-2.5 rounded-lg border border-border">
                                    <Mail className="h-4 w-4 mr-2.5 shrink-0 text-indigo-400" />
                                    <span className="truncate font-medium">{school.contact_email || "No contact email"}</span>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-indigo-50/50 dark:bg-indigo-500/10 border border-indigo-100/50 dark:border-indigo-500/20 transition-all duration-300 group-hover:bg-indigo-100/50 dark:group-hover:bg-indigo-500/20">
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-indigo-600/70 dark:text-indigo-400/70 mb-1">Admins</p>
                                        <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{school.stats?.admins || school.admin_count || 0}</p>
                                    </div>
                                    <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-violet-50/50 dark:bg-violet-500/10 border border-violet-100/50 dark:border-violet-500/20 transition-all duration-300 group-hover:bg-violet-100/50 dark:group-hover:bg-violet-500/20">
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-violet-600/70 dark:text-violet-400/70 mb-1">Teachers</p>
                                        <p className="text-lg font-bold text-violet-700 dark:text-violet-300">{school.stats?.teachers || 0}</p>
                                    </div>
                                    <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-fuchsia-50/50 dark:bg-fuchsia-500/10 border border-fuchsia-100/50 dark:border-fuchsia-500/20 transition-all duration-300 group-hover:bg-fuchsia-100/50 dark:group-hover:bg-fuchsia-500/20">
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-fuchsia-600/70 dark:text-fuchsia-400/70 mb-1">Students</p>
                                        <p className="text-lg font-bold text-fuchsia-700 dark:text-fuchsia-300">{school.stats?.students || 0}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-xl border border-sky-100/60 bg-sky-50/60 p-3 dark:border-sky-900/40 dark:bg-sky-950/20">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-sky-700/70 dark:text-sky-300/70">
                                            <Database className="h-3.5 w-3.5" />
                                            Neon
                                        </div>
                                        <p className="mt-2 text-sm font-bold text-sky-800 dark:text-sky-200">
                                            {formatStorageBytes(storageBySchool.get(school.id)?.neon_bytes ?? 0)}
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-emerald-100/60 bg-emerald-50/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70">
                                            <HardDrive className="h-3.5 w-3.5" />
                                            R2
                                        </div>
                                        <p className="mt-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
                                            {formatStorageBytes(storageBySchool.get(school.id)?.r2_bytes ?? 0)}
                                        </p>
                                        <p className="mt-1 text-[10px] text-emerald-700/70 dark:text-emerald-300/70">
                                            {(storageBySchool.get(school.id)?.r2_documents ?? 0).toLocaleString()} objects
                                        </p>
                                    </div>
                                </div>
                            </CardContent>

                            <CardFooter className="relative bg-muted/50 px-6 py-4 border-t border-border flex justify-between items-center group-hover:bg-indigo-50/30 dark:group-hover:bg-indigo-900/20 transition-colors">
                                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                                    Open Dashboard <ArrowRight className="h-3 w-3" />
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="ml-auto text-xs font-medium border-border hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-card shadow-sm"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        router.push(`/super-admin/school/${school.slug || school.id}?tab=admins`)
                                    }}
                                >
                                    Manage Admins
                                </Button>
                            </CardFooter>
                        </Card>
                    ))
                )}
            </div>

            {isFetchingNextPage && (
                <div className="flex justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                </div>
            )}

            {/* ── Edit School Dialog ──────────────────────────────────────────── */}
            <Dialog open={!!editSchool} onOpenChange={(open) => { if (!open) setEditSchool(null) }}>
                <DialogContent className="w-[95vw] sm:max-w-[500px] p-0 overflow-hidden border-slate-200 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                    <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" />
                    <div className="px-6 pt-5 pb-2">
                        <DialogHeader>
                            <DialogTitle className="text-xl font-bold flex items-center gap-2">
                                <Edit className="h-5 w-5 text-indigo-500" /> Edit School
                            </DialogTitle>
                            <DialogDescription>
                                Update details for <span className="font-semibold">{editSchool?.name}</span>.
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    <div className="px-6 py-4 space-y-5">
                        <div className="grid gap-2">
                            <Label htmlFor="edit_name" className="text-slate-700 dark:text-slate-300 font-medium">
                                School Name <span className="text-rose-500">*</span>
                            </Label>
                            <Input
                                id="edit_name"
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                placeholder="e.g. Springfield High School"
                                className="h-10 bg-card focus-visible:ring-indigo-500/30"
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="edit_code" className="text-slate-700 dark:text-slate-300 font-medium">School Code</Label>
                                <Input
                                    id="edit_code"
                                    value={editForm.code}
                                    onChange={(e) => setEditForm({ ...editForm, code: e.target.value.toUpperCase() })}
                                    placeholder="e.g. UDISE123456"
                                    className="h-10 bg-card focus-visible:ring-indigo-500/30"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit_contact_email" className="text-slate-700 dark:text-slate-300 font-medium">Contact Email</Label>
                                <Input
                                    id="edit_contact_email"
                                    type="email"
                                    value={editForm.contact_email}
                                    onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                                    placeholder="admin@school.edu"
                                    className="h-10 bg-card focus-visible:ring-indigo-500/30"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit_address" className="text-slate-700 dark:text-slate-300 font-medium">Address</Label>
                                <Input
                                    id="edit_address"
                                    value={editForm.address}
                                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                                    placeholder="123 Education Lane"
                                    className="h-10 bg-card focus-visible:ring-indigo-500/30"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="px-6 pb-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                        <Button variant="outline" onClick={() => setEditSchool(null)} className="w-full sm:w-auto border-slate-200 dark:border-slate-700">
                            Cancel
                        </Button>
                        <Button
                            onClick={handleEditSave}
                            disabled={updateSchool.isPending}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 w-full sm:w-auto sm:min-w-[120px]"
                        >
                            {updateSchool.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                            {updateSchool.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <PasswordPromptDialog
                open={!!deleteConfirmation}
                onOpenChange={(open) => !open && setDeleteConfirmation(null)}
                onConfirm={confirmDeleteSchool}
                title={`Delete Target: ${deleteConfirmation?.name}`}
                description="Authentication required to perform this tenant deletion. The school will be moved to the Trash Bin and can be restored within 24 hours."
                actionLabel="Confirm Deletion"
                actionVariant="destructive"
                warningMessage="⚠️ After 24 hours, the tenant schema, including all admins, teachers, students, and materials, will be permanently purged from the database."
            />

            <PasswordPromptDialog
                open={showCreatePasswordPrompt}
                onOpenChange={setShowCreatePasswordPrompt}
                onConfirm={handleCreateSchoolWithPassword}
                title="Authorize New Tenant"
                description={`Provide your super-admin credentials to provision the infrastructure for "${newSchool.name}".`}
                actionLabel="Authorize & Provision"
                actionVariant="default"
            />
        </div>
    )
}

interface GlobalClass {
    id: string
    name: string
    sort_order: number
}

interface GlobalSubject {
    id: string
    name: string
    code: string
}

interface AssignmentItem {
    class: GlobalClass
    subjects: GlobalSubject[]
}

interface LearnerReconciliationCaseItem {
    id: string
    pair_key: string
    primary_learner_id: string
    candidate_learner_id: string
    status: "pending" | "resolved" | "dismissed"
    resolution?: "merged" | "dismissed" | "unmerged"
    review_note?: string
    primary_learner_name?: string
    candidate_learner_name?: string
    primary_date_of_birth?: string
    candidate_date_of_birth?: string
}

function ReconciliationsSection() {
    const queryClient = useQueryClient()
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved" | "dismissed">("pending")
    const [page, setPage] = useState(1)
    const pageSize = 20

    const reconciliationsQuery = useQuery({
        queryKey: ["super-admin-reconciliations", statusFilter, page, pageSize],
        queryFn: () => {
            const params = new URLSearchParams()
            params.set("page", String(page))
            params.set("page_size", String(pageSize))
            if (statusFilter !== "all") {
                params.set("status", statusFilter)
            }
            return api.get<{ items: LearnerReconciliationCaseItem[]; total: number }>(`/super-admin/reconciliations?${params.toString()}`)
        },
        staleTime: 15_000,
    })

    const refreshCasesMutation = useMutation({
        mutationFn: () => api.post<{ created: number }>("/super-admin/reconciliations/scan", {}),
        onSuccess: (data) => {
            toast.success("Reconciliation scan complete", {
                description: `${data.created ?? 0} new case(s) identified.`,
            })
            queryClient.invalidateQueries({ queryKey: ["super-admin-reconciliations"] })
        },
        onError: (error) => {
            toast.error("Scan failed", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const reviewCaseMutation = useMutation({
        mutationFn: (payload: { id: string; action: "merge" | "dismiss"; survivorLearnerId?: string }) =>
            api.put(`/super-admin/reconciliations/${payload.id}/review`, {
                action: payload.action,
                survivor_learner_id: payload.survivorLearnerId,
            }),
        onSuccess: () => {
            toast.success("Reconciliation updated")
            queryClient.invalidateQueries({ queryKey: ["super-admin-reconciliations"] })
        },
        onError: (error) => {
            toast.error("Failed to update reconciliation", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const unmergeCaseMutation = useMutation({
        mutationFn: (id: string) => api.put(`/super-admin/reconciliations/${id}/unmerge`, {}),
        onSuccess: () => {
            toast.success("Reconciliation merge rolled back")
            queryClient.invalidateQueries({ queryKey: ["super-admin-reconciliations"] })
        },
        onError: (error) => {
            toast.error("Failed to unmerge", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const items = reconciliationsQuery.data?.items ?? []
    const total = reconciliationsQuery.data?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const isBusy = refreshCasesMutation.isPending || reviewCaseMutation.isPending || unmergeCaseMutation.isPending
    const pendingCount = items.filter((item) => item.status === "pending").length

    return (
        <div className="space-y-6">
            <Card className="overflow-hidden border-2 border-cyan-100 dark:border-cyan-900/40 bg-card shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <CardTitle className="text-xl">Learner Reconciliation Console</CardTitle>
                            <CardDescription>
                                Review identity collisions and decide whether to merge, dismiss, or unmerge prior decisions.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-900">
                                Total {total}
                            </Badge>
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900">
                                Pending {pendingCount}
                            </Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="w-full sm:w-[240px]">
                            <Select
                                value={statusFilter}
                                onValueChange={(value: "all" | "pending" | "resolved" | "dismissed") => {
                                    setStatusFilter(value)
                                    setPage(1)
                                }}
                            >
                                <SelectTrigger className="bg-card">
                                    <SelectValue placeholder="Filter status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All statuses</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="resolved">Resolved</SelectItem>
                                    <SelectItem value="dismissed">Dismissed</SelectItem>
                                </SelectContent>
                            </Select>
                            </div>
                            <Button
                                onClick={() => refreshCasesMutation.mutate()}
                                disabled={isBusy}
                                className="bg-cyan-600 hover:bg-cyan-700 text-white"
                            >
                                {refreshCasesMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                                Scan for New Cases
                            </Button>
                        </div>
                    </div>

                    {reconciliationsQuery.isLoading ? (
                        <div className="py-10 text-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
                            Loading reconciliation cases...
                        </div>
                    ) : items.length === 0 ? (
                        <div className="py-10 text-center border rounded-xl bg-muted/40 text-muted-foreground">
                            No reconciliation cases for the selected status.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {items.map((item) => (
                                <div key={item.id} className="rounded-xl border-2 border-border/70 bg-card p-4 shadow-sm space-y-3">
                                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                                        <div>
                                            <div className="text-xs text-muted-foreground">Case ID: {item.id}</div>
                                            <div className="font-semibold text-slate-800 dark:text-slate-100">
                                                {item.primary_learner_name || "Unknown Learner"} vs {item.candidate_learner_name || "Unknown Learner"}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                DOB: {item.primary_date_of_birth || "-"} | {item.candidate_date_of_birth || "-"}
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="w-fit uppercase tracking-wide">{item.status}</Badge>
                                    </div>

                                    {item.review_note ? (
                                        <p className="text-xs text-muted-foreground border-l-2 border-indigo-300 pl-3">{item.review_note}</p>
                                    ) : null}

                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isBusy || item.status !== "pending"}
                                            onClick={() => reviewCaseMutation.mutate({ id: item.id, action: "merge", survivorLearnerId: item.primary_learner_id })}
                                        >
                                            <GitMerge className="h-3.5 w-3.5 mr-1.5" /> Merge Into Primary
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isBusy || item.status !== "pending"}
                                            onClick={() => reviewCaseMutation.mutate({ id: item.id, action: "merge", survivorLearnerId: item.candidate_learner_id })}
                                        >
                                            <GitMerge className="h-3.5 w-3.5 mr-1.5" /> Merge Into Candidate
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isBusy || item.status !== "pending"}
                                            onClick={() => reviewCaseMutation.mutate({ id: item.id, action: "dismiss" })}
                                        >
                                            <X className="h-3.5 w-3.5 mr-1.5" /> Dismiss
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={isBusy || item.resolution !== "merged"}
                                            onClick={() => unmergeCaseMutation.mutate(item.id)}
                                        >
                                            <Link2Off className="h-3.5 w-3.5 mr-1.5" /> Unmerge
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-2">
                        <div className="text-sm text-muted-foreground">Total cases: {total}</div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" disabled={page <= 1 || isBusy} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                Previous
                            </Button>
                            <span className="text-sm text-muted-foreground">Page {page} / {totalPages}</span>
                            <Button variant="outline" size="sm" disabled={page >= totalPages || isBusy} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                                Next
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function CatalogSection() {
    const queryClient = useQueryClient()
    const [showClassesDialog, setShowClassesDialog] = useState(false)
    const [showSubjectsDialog, setShowSubjectsDialog] = useState(false)
    const [newClassName, setNewClassName] = useState("")
    const [newSubjectName, setNewSubjectName] = useState("")
    const [newSubjectCode, setNewSubjectCode] = useState("")
    const [selectedClassId, setSelectedClassId] = useState<string>("")
    const [assignedByClass, setAssignedByClass] = useState<Record<string, string[]>>({})
    const [editingClassId, setEditingClassId] = useState<string | null>(null)
    const [editingClassName, setEditingClassName] = useState("")
    const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null)
    const [editingSubjectName, setEditingSubjectName] = useState("")
    const [editingSubjectCode, setEditingSubjectCode] = useState("")

    const classesQuery = useQuery({
        queryKey: ["super-admin-catalog-classes"],
        queryFn: () => api.get<{ classes: GlobalClass[] }>("/super-admin/catalog/classes"),
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    })
    const subjectsQuery = useQuery({
        queryKey: ["super-admin-catalog-subjects"],
        queryFn: () => api.get<{ subjects: GlobalSubject[] }>("/super-admin/catalog/subjects"),
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    })
    const assignmentsQuery = useQuery({
        queryKey: ["super-admin-catalog-assignments"],
        queryFn: () => api.get<{ assignments: AssignmentItem[] }>("/super-admin/catalog/assignments"),
        staleTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    })

    // ── Academic Year ──────────────────────────────────────────────────────────
    const [editingAcademicYear, setEditingAcademicYear] = useState(false)
    const [draftAcademicYear, setDraftAcademicYear] = useState("")

    const globalSettingsQuery = useQuery({
        queryKey: ["super-admin-global-settings"],
        queryFn: () => api.get<{ current_academic_year: string }>("/super-admin/settings/global"),
        staleTime: 5 * 60_000,
    })
    const updateGlobalSettingsMutation = useMutation({
        mutationFn: (year: string) =>
            api.put("/super-admin/settings/global", { current_academic_year: year }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["super-admin-global-settings"] })
            toast.success("Academic year updated across all schools.")
            setEditingAcademicYear(false)
        },
        onError: () => toast.error("Failed to update academic year"),
    })

    const classes = useMemo(() => classesQuery.data?.classes || [], [classesQuery.data?.classes])
    const subjects = useMemo(() => subjectsQuery.data?.subjects || [], [subjectsQuery.data?.subjects])
    const assignments = useMemo(() => assignmentsQuery.data?.assignments || [], [assignmentsQuery.data?.assignments])
    const effectiveSelectedClassId = selectedClassId
    const defaultAssignedSubjectIds = useMemo(() => {
        if (!effectiveSelectedClassId) return []
        const current = assignments.find((item) => item.class.id === effectiveSelectedClassId)
        return (current?.subjects || []).map((s) => s.id)
    }, [assignments, effectiveSelectedClassId])
    const assignedSubjectIds = assignedByClass[effectiveSelectedClassId] || defaultAssignedSubjectIds

    const invalidateCatalog = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["super-admin-catalog-classes"] }),
            queryClient.invalidateQueries({ queryKey: ["super-admin-catalog-subjects"] }),
            queryClient.invalidateQueries({ queryKey: ["super-admin-catalog-assignments"] }),
        ])
    }

    const createClassMutation = useMutation({
        mutationFn: (payload: { name: string; sort_order: number }) => api.post<{ class: GlobalClass }>("/super-admin/catalog/classes", payload),
        onSuccess: async () => {
            setNewClassName("")
            await invalidateCatalog()
            toast.success("Class created")
        },
        onError: (error) => {
            toast.error("Failed to create class", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const updateClassMutation = useMutation({
        mutationFn: (payload: { id: string; name: string; sort_order: number }) =>
            api.put<{ class: GlobalClass }>(`/super-admin/catalog/classes/${payload.id}`, { name: payload.name, sort_order: payload.sort_order }),
        onSuccess: async () => {
            setEditingClassId(null)
            await invalidateCatalog()
            toast.success("Class updated")
        },
        onError: (error) => {
            toast.error("Failed to update class", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const deleteClassMutation = useMutation({
        mutationFn: (id: string) => api.delete(`/super-admin/catalog/classes/${id}`),
        onSuccess: async () => {
            if (effectiveSelectedClassId && !classes.some((c) => c.id !== effectiveSelectedClassId)) {
                setSelectedClassId("")
            }
            await invalidateCatalog()
            toast.success("Class deleted")
        },
        onError: (error) => {
            toast.error("Failed to delete class", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const reorderClassMutation = useMutation({
        mutationFn: (items: { id: string; sort_order: number }[]) =>
            api.put("/super-admin/catalog/classes/reorder", { items }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["super-admin-catalog-classes"] })
        },
        onError: (error) => {
            toast.error("Failed to reorder classes", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const moveClass = (index: number, direction: "up" | "down") => {
        const sorted = [...classes]
        const targetIndex = direction === "up" ? index - 1 : index + 1
        if (targetIndex < 0 || targetIndex >= sorted.length) return
        const newOrder = [...sorted]
        ;[newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]]
        const items = newOrder.map((c, i) => ({ id: c.id, sort_order: i + 1 }))
        reorderClassMutation.mutate(items)
    }

    const createSubjectMutation = useMutation({
        mutationFn: (payload: { name: string; code: string }) => api.post<{ subject: GlobalSubject }>("/super-admin/catalog/subjects", payload),
        onSuccess: async () => {
            setNewSubjectName("")
            setNewSubjectCode("")
            await invalidateCatalog()
            toast.success("Subject created")
        },
        onError: (error) => {
            toast.error("Failed to create subject", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const updateSubjectMutation = useMutation({
        mutationFn: (payload: { id: string; name: string; code: string }) =>
            api.put<{ subject: GlobalSubject }>(`/super-admin/catalog/subjects/${payload.id}`, { name: payload.name, code: payload.code }),
        onSuccess: async () => {
            setEditingSubjectId(null)
            await invalidateCatalog()
            toast.success("Subject updated")
        },
        onError: (error) => {
            toast.error("Failed to update subject", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const deleteSubjectMutation = useMutation({
        mutationFn: (id: string) => api.delete(`/super-admin/catalog/subjects/${id}`),
        onSuccess: async () => {
            await invalidateCatalog()
            toast.success("Subject deleted")
        },
        onError: (error) => {
            toast.error("Failed to delete subject", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const assignSubjectsMutation = useMutation({
        mutationFn: (payload: { classId: string; subjectIds: string[] }) =>
            api.put(`/super-admin/catalog/classes/${payload.classId}/subjects`, { subject_ids: payload.subjectIds }),
        onSuccess: async () => {
            await invalidateCatalog()
            toast.success("Class subjects updated")
        },
        onError: (error) => {
            toast.error("Failed to update class subjects", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const isBusy =
        createClassMutation.isPending ||
        updateClassMutation.isPending ||
        deleteClassMutation.isPending ||
        reorderClassMutation.isPending ||
        createSubjectMutation.isPending ||
        updateSubjectMutation.isPending ||
        deleteSubjectMutation.isPending ||
        assignSubjectsMutation.isPending

    const shownClassName = classes.find((c) => c.id === effectiveSelectedClassId)?.name || "Select a class"
    const catalogError = classesQuery.error || subjectsQuery.error || assignmentsQuery.error

    return (
        <div className="space-y-6 lg:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
            {/* Academic Year — Global Setting */}
            <Card>
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <CardTitle className="text-base font-semibold">Current Academic Year</CardTitle>
                            <CardDescription className="mt-0.5 text-xs">
                                Applies globally to all schools — admissions, attendance, timetables and more.
                            </CardDescription>
                        </div>
                        {!editingAcademicYear && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setDraftAcademicYear(globalSettingsQuery.data?.current_academic_year ?? "")
                                    setEditingAcademicYear(true)
                                }}
                            >
                                Edit
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="pt-0">
                    {editingAcademicYear ? (
                        <div className="flex items-center gap-3">
                            <Input
                                value={draftAcademicYear}
                                onChange={(e) => setDraftAcademicYear(e.target.value)}
                                placeholder="e.g. 2025-2026"
                                className="max-w-[200px]"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") updateGlobalSettingsMutation.mutate(draftAcademicYear.trim())
                                    if (e.key === "Escape") setEditingAcademicYear(false)
                                }}
                                autoFocus
                            />
                            <Button
                                size="sm"
                                disabled={!draftAcademicYear.trim() || updateGlobalSettingsMutation.isPending}
                                onClick={() => updateGlobalSettingsMutation.mutate(draftAcademicYear.trim())}
                            >
                                {updateGlobalSettingsMutation.isPending ? "Saving..." : "Save"}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditingAcademicYear(false)}>
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            {globalSettingsQuery.isLoading ? (
                                <div className="h-6 w-28 animate-pulse rounded bg-muted" />
                            ) : (
                                <span className="text-2xl font-bold tracking-tight">
                                    {globalSettingsQuery.data?.current_academic_year ?? "—"}
                                </span>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 gap-4 md:gap-6">
                <Card className="group relative overflow-hidden border-indigo-100 dark:border-indigo-900/50 shadow-sm hover:shadow-md transition-all duration-300 bg-card">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500">
                        <Layers3 className="w-24 h-24 text-indigo-600" />
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-500 dark:text-slate-400">
                            <div className="p-1.5 rounded-md bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                                <Layers3 className="h-4 w-4" />
                            </div>
                            Centralized Classes
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl md:text-5xl font-bold tracking-tighter text-slate-900 dark:text-white">
                                {classesQuery.isLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : classes.length}
                            </span>
                            <span className="text-sm font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                                Active
                            </span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group relative overflow-hidden border-fuchsia-100 dark:border-fuchsia-900/50 shadow-sm hover:shadow-md transition-all duration-300 bg-card">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500">
                        <BookOpenCheck className="w-24 h-24 text-fuchsia-600" />
                    </div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-500 dark:text-slate-400">
                            <div className="p-1.5 rounded-md bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400">
                                <BookOpenCheck className="h-4 w-4" />
                            </div>
                            Subject Catalog
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl md:text-5xl font-bold tracking-tighter text-slate-900 dark:text-white">
                                {subjectsQuery.isLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : subjects.length}
                            </span>
                            <span className="text-sm font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                                Managed
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {catalogError ? (
                <Card className="border-red-300">
                    <CardHeader>
                        <CardTitle className="text-red-600">Catalog Load Failed</CardTitle>
                        <CardDescription>
                            {catalogError instanceof Error ? catalogError.message : "Failed to load catalog data from backend."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button
                            variant="outline"
                            onClick={() => {
                                classesQuery.refetch()
                                subjectsQuery.refetch()
                                assignmentsQuery.refetch()
                            }}
                        >
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
                {/* Classes Panel */}
                <Card className="flex flex-col border-indigo-100 dark:border-indigo-900/50 shadow-sm bg-card overflow-hidden">
                    <CardHeader className="bg-indigo-50/50 dark:bg-indigo-950/20 border-b border-indigo-100 dark:border-indigo-900/50 pb-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <CardTitle className="text-lg text-indigo-900 dark:text-indigo-100">Manage Classes</CardTitle>
                                <CardDescription>Create and maintain centralized class levels</CardDescription>
                            </div>
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-full">
                                <Layers3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 flex flex-col pt-4">
                        <div className="px-5 pb-5 space-y-4">
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div className="relative flex-1">
                                    <Layers3 className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Class name (e.g. Class 5)"
                                        value={newClassName}
                                        onChange={(e) => setNewClassName(e.target.value)}
                                        className="pl-9 border-border focus-visible:ring-indigo-500 bg-muted/50"
                                    />
                                </div>
                                <Button
                                    onClick={() => {
                                        const nextSort = classes.length > 0
                                            ? Math.max(...classes.map(c => c.sort_order)) + 1
                                            : 1
                                        createClassMutation.mutate({ name: newClassName.trim(), sort_order: nextSort })
                                    }}
                                    disabled={!newClassName.trim() || isBusy}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shrink-0 transition-all hover:shadow-md"
                                >
                                    <Plus className="h-4 w-4 mr-2" /> Add
                                </Button>
                            </div>

                            <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                {classesQuery.isLoading ? (
                                    <div className="flex items-center pt-4 justify-center text-indigo-500"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...</div>
                                ) : classes.length === 0 ? (
                                    <div className="text-center pt-6 pb-4 text-slate-400 italic">No classes added yet.</div>
                                ) : (
                                    classes.map((item, index) => (
                                        <div key={item.id} className="group flex items-center gap-3 border border-border/60 rounded-xl p-3 bg-card hover:bg-muted/50 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 transition-all duration-300">
                                            {editingClassId === item.id ? (
                                                <div className="flex-1 flex items-center gap-2 w-full animate-in fade-in zoom-in-95 duration-200">
                                                    <Input value={editingClassName} onChange={(e) => setEditingClassName(e.target.value)} className="h-9" autoFocus />
                                                    <Button
                                                        size="sm"
                                                        className="h-9 px-3 bg-indigo-600 hover:bg-indigo-700 text-white"
                                                        onClick={() =>
                                                            updateClassMutation.mutate({
                                                                id: item.id,
                                                                name: editingClassName.trim(),
                                                                sort_order: item.sort_order,
                                                            })
                                                        }
                                                        disabled={!editingClassName.trim() || isBusy}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="h-9 px-3" onClick={() => setEditingClassId(null)}>
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex flex-col gap-0.5 mr-0.5">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-5 w-5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-20"
                                                            disabled={index === 0 || reorderClassMutation.isPending}
                                                            onClick={() => moveClass(index, "up")}
                                                            tabIndex={-1}
                                                        >
                                                            <ArrowUp className="h-3 w-3" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-5 w-5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-20"
                                                            disabled={index === classes.length - 1 || reorderClassMutation.isPending}
                                                            onClick={() => moveClass(index, "down")}
                                                            tabIndex={-1}
                                                        >
                                                            <ArrowDown className="h-3 w-3" />
                                                        </Button>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        className={`flex-1 text-left flex items-center gap-3 py-1 ${effectiveSelectedClassId === item.id ? "text-indigo-700 dark:text-indigo-400 font-semibold" : "text-slate-700 dark:text-slate-300 font-medium"}`}
                                                        onClick={() => setSelectedClassId(item.id)}
                                                    >
                                                        {effectiveSelectedClassId === item.id && <CheckCircle2 className="h-4 w-4 text-indigo-500 shrink-0 animate-in zoom-in" />}
                                                        <span>{item.name}</span>
                                                    </button>

                                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                                                            onClick={() => {
                                                                setEditingClassId(item.id)
                                                                setEditingClassName(item.name)
                                                            }}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                                                            onClick={() => deleteClassMutation.mutate(item.id)}
                                                            disabled={isBusy}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Subjects Panel */}
                <Card className="flex flex-col border-fuchsia-100 dark:border-fuchsia-900/50 shadow-sm bg-card overflow-hidden">
                    <CardHeader className="bg-fuchsia-50/50 dark:bg-fuchsia-950/20 border-b border-fuchsia-100 dark:border-fuchsia-900/50 pb-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <CardTitle className="text-lg text-fuchsia-900 dark:text-fuchsia-100">Manage Subjects</CardTitle>
                                <CardDescription>Create and maintain centralized subjects</CardDescription>
                            </div>
                            <div className="p-2 bg-fuchsia-100 dark:bg-fuchsia-900/40 rounded-full">
                                <BookOpenCheck className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 flex flex-col pt-4">
                        <div className="px-5 pb-5 space-y-4">
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div className="relative flex-1">
                                    <BookOpenCheck className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Subject name"
                                        value={newSubjectName}
                                        onChange={(e) => setNewSubjectName(e.target.value)}
                                        className="pl-9 border-border focus-visible:ring-fuchsia-500 bg-muted/50"
                                    />
                                </div>
                                <div className="relative w-full sm:w-32">
                                    <Input
                                        placeholder="Code (opt)"
                                        value={newSubjectCode}
                                        onChange={(e) => setNewSubjectCode(e.target.value)}
                                        className="border-border focus-visible:ring-fuchsia-500 bg-muted/50 uppercase"
                                    />
                                </div>
                                <Button
                                    onClick={() => createSubjectMutation.mutate({ name: newSubjectName.trim(), code: newSubjectCode.trim() })}
                                    disabled={!newSubjectName.trim() || isBusy}
                                    className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white shadow-sm shrink-0 transition-all hover:shadow-md"
                                >
                                    <Plus className="h-4 w-4 mr-2" /> Add
                                </Button>
                            </div>

                            <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                {subjectsQuery.isLoading ? (
                                    <div className="flex items-center pt-4 justify-center text-fuchsia-500"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...</div>
                                ) : subjects.length === 0 ? (
                                    <div className="text-center pt-6 pb-4 text-slate-400 italic">No subjects added yet.</div>
                                ) : (
                                    subjects.map((item) => (
                                        <div key={item.id} className="group flex items-center gap-3 border border-border/60 rounded-xl p-3 bg-card hover:bg-muted/50 shadow-sm hover:shadow-md hover:border-fuchsia-200 dark:hover:border-fuchsia-800 transition-all duration-300">
                                            {editingSubjectId === item.id ? (
                                                <div className="flex-1 flex items-center gap-2 w-full animate-in fade-in zoom-in-95 duration-200">
                                                    <Input value={editingSubjectName} onChange={(e) => setEditingSubjectName(e.target.value)} className="h-9" autoFocus />
                                                    <Input value={editingSubjectCode} onChange={(e) => setEditingSubjectCode(e.target.value)} className="h-9 w-24 uppercase" />
                                                    <Button
                                                        size="sm"
                                                        className="h-9 px-3 bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
                                                        onClick={() =>
                                                            updateSubjectMutation.mutate({
                                                                id: item.id,
                                                                name: editingSubjectName.trim(),
                                                                code: editingSubjectCode.trim(),
                                                            })
                                                        }
                                                        disabled={!editingSubjectName.trim() || isBusy}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="h-9 px-3" onClick={() => setEditingSubjectId(null)}>
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex-1 text-slate-700 dark:text-slate-300 font-medium py-1">{item.name}</div>

                                                    {item.code ? (
                                                        <span className="flex-shrink-0 text-[11px] font-bold tracking-widest text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-500/10 px-2 py-1 rounded-md border border-fuchsia-100 dark:border-fuchsia-800/50">
                                                            {item.code}
                                                        </span>
                                                    ) : null}

                                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-500/10"
                                                            onClick={() => {
                                                                setEditingSubjectId(item.id)
                                                                setEditingSubjectName(item.name)
                                                                setEditingSubjectCode(item.code || "")
                                                            }}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                                                            onClick={() => deleteSubjectMutation.mutate(item.id)}
                                                            disabled={isBusy}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-border shadow-sm bg-card overflow-hidden">
                <div className="h-1 w-full bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400"></div>
                <CardHeader className="pb-4 pt-6">
                    <CardTitle className="text-xl flex items-center gap-2 text-slate-800 dark:text-slate-100">
                        <Shield className="h-5 w-5 text-violet-500" /> Subject Mapping
                    </CardTitle>
                    <CardDescription className="text-base">
                        Select a class and assign the allowed subjects. This defines the curriculum availability for all schools.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="p-5 rounded-xl bg-muted/50 border border-border">
                        <div className="flex flex-col xl:flex-row gap-4 xl:items-center">
                            <Label htmlFor="assignment-class-select" className="text-sm font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                                Target Class
                            </Label>
                            <div className="flex-1 max-w-sm relative">
                                <Select
                                    value={effectiveSelectedClassId}
                                    onValueChange={(value) => setSelectedClassId(value)}
                                    disabled={classesQuery.isLoading || classes.length === 0}
                                >
                                    <SelectTrigger id="assignment-class-select" className="w-full bg-card border-border shadow-sm h-11">
                                        <SelectValue placeholder={classes.length === 0 ? "No classes available" : "Choose class"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {classes.map((cls) => (
                                            <SelectItem key={cls.id} value={cls.id} className="font-medium">
                                                {cls.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {classes.length > 0 && effectiveSelectedClassId ? (
                                <div className="hidden md:flex ml-auto items-center text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-3 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-800">
                                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Configuring {shownClassName}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Available Subjects</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                            {subjects.map((subject) => {
                                const checked = assignedSubjectIds.includes(subject.id)
                                return (
                                    <label key={subject.id} className={`group relative flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-all duration-300 overflow-hidden ${checked ? "border-violet-500 bg-violet-50/50 dark:bg-violet-500/10 shadow-[0_4px_14px_0_rgba(139,92,246,0.15)] dark:shadow-none translate-y-[-1px]" : "border-border bg-card hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-sm"}`}>
                                        <div className={`absolute inset-0 bg-gradient-to-r from-violet-500/0 to-violet-500/5 dark:to-violet-500/10 transition-opacity duration-300 ${checked ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}></div>

                                        <div className={`relative flex items-center justify-center w-5 h-5 rounded-[6px] border transition-all duration-300 ${checked ? "bg-violet-600 border-violet-600 text-white" : "border-slate-300 dark:border-slate-600 bg-transparent group-hover:border-violet-400"}`}>
                                            <Check className={`w-3.5 h-3.5 transition-transform duration-300 ${checked ? "scale-100" : "scale-0"}`} strokeWidth={4} />
                                        </div>

                                        <input
                                            type="checkbox"
                                            className="sr-only"
                                            checked={checked}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setAssignedByClass((prev) => ({
                                                        ...prev,
                                                        [effectiveSelectedClassId]: [...assignedSubjectIds, subject.id],
                                                    }))
                                                } else {
                                                    setAssignedByClass((prev) => ({
                                                        ...prev,
                                                        [effectiveSelectedClassId]: assignedSubjectIds.filter((id) => id !== subject.id),
                                                    }))
                                                }
                                            }}
                                            disabled={!effectiveSelectedClassId}
                                        />

                                        <div className="relative flex-1 min-w-0">
                                            <div className={`text-sm tracking-tight truncate transition-colors duration-300 ${checked ? "font-semibold text-violet-900 dark:text-violet-100" : "font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white"}`}>
                                                {subject.name}
                                            </div>
                                            {subject.code ? (
                                                <div className={`text-[10px] uppercase font-bold tracking-widest truncate mt-0.5 transition-colors duration-300 ${checked ? "text-violet-600 dark:text-violet-400" : "text-slate-400"}`}>
                                                    {subject.code}
                                                </div>
                                            ) : null}
                                        </div>
                                    </label>
                                )
                            })}
                        </div>
                    </div>

                    <div className="pt-4 flex items-center justify-end border-t border-slate-100 dark:border-slate-800">
                        <Button
                            onClick={() => {
                                if (!effectiveSelectedClassId) return
                                assignSubjectsMutation.mutate({ classId: effectiveSelectedClassId, subjectIds: assignedSubjectIds })
                            }}
                            disabled={!effectiveSelectedClassId || isBusy}
                            size="lg"
                            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 dark:shadow-none w-full sm:w-auto sm:min-w-[200px] transition-all"
                        >
                            {isBusy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
                            Save Configuration
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={showClassesDialog} onOpenChange={setShowClassesDialog}>
                <DialogContent className="w-[95vw] max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>All Classes</DialogTitle>
                        <DialogDescription>Loaded from centralized DB catalog</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-auto space-y-2 pr-1">
                        {classesQuery.isLoading ? (
                            <p className="text-sm text-muted-foreground">Loading classes...</p>
                        ) : classes.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No classes found in DB.</p>
                        ) : (
                            classes.map((item) => (
                                <div key={item.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                                    <span className="font-medium">{item.name}</span>
                                    <Badge variant="outline">Sort {item.sort_order}</Badge>
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={showSubjectsDialog} onOpenChange={setShowSubjectsDialog}>
                <DialogContent className="w-[95vw] max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>All Subjects</DialogTitle>
                        <DialogDescription>Loaded from centralized DB catalog</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-auto space-y-2 pr-1">
                        {subjectsQuery.isLoading ? (
                            <p className="text-sm text-muted-foreground">Loading subjects...</p>
                        ) : subjects.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No subjects found in DB.</p>
                        ) : (
                            subjects.map((item) => (
                                <div key={item.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                                    <span className="font-medium">{item.name}</span>
                                    {item.code ? <Badge variant="outline">{item.code}</Badge> : <span className="text-xs text-muted-foreground">No code</span>}
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function SuperAdminPageContent() {
    const searchParams = useSearchParams()
    const tab = getTabFromSearch(searchParams.get("tab"))

    return (
        <div className="space-y-6">
            {tab === "schools" && <SchoolsSection />}
            {tab === "storage" && <SuperAdminStorageSection />}
            {tab === "catalog" && <CatalogSection />}
            {tab === "reconciliations" && <ReconciliationsSection />}
            {tab === "question-uploader" && <QuestionUploaderForm />}
            {tab === "quiz-scheduler" && <SuperAdminQuizSchedulerPage />}
            {tab === "materials" && <SuperAdminMaterialsForm />}
            {tab === "blogs" && <SuperAdminBlogManagementSection />}
            {tab === "settings" && <SuperAdminSettingsPanel embedded />}
            {tab === "trash" && <SuperAdminTrashPanel embedded />}
            {tab === "users" && <UserGrowthSection />}
            {tab === "help-center" && <SuperAdminHelpCenterPage />}
            {tab === "demo-requests" && <SADemoRequestsSection />}
        </div>
    )
}

export default function SuperAdminPage() {
    return (
        <Suspense fallback={<div className="min-h-[100dvh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <SuperAdminPageContent />
        </Suspense>
    )
}
