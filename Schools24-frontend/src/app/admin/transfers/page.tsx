"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import {
    Loader2,
    RefreshCcw,
    ArrowRightLeft,
    ChevronDown,
    ChevronUp,
    CheckCircle2,
    XCircle,
    Clock,
    Play,
    RotateCcw,
    Search,
    UserRound,
} from "lucide-react"
import { api } from "@/lib/api"
import { useDebounce } from "@/hooks/useDebounce"
import { ValidationError } from "@/lib/api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassOption {
    id: string
    name: string
    grade?: number
    section?: string
    academic_year: string
}

interface StudentOption {
    id: string
    full_name: string
    admission_number: string
    class_name?: string
    section?: string
}

interface TransferItem {
    id: string
    learner_id: string
    source_school_id: string
    destination_school_id: string
    source_student_id?: string
    status: "pending" | "approved" | "rejected" | "cancelled"
    reason?: string
    evidence_ref?: string
    review_note?: string
    requested_at: string
    reviewed_at?: string
    learner_name?: string
    source_school_name?: string
    destination_school_name?: string
    gov_sync_job_id?: string
    gov_sync_status?: "pending" | "running" | "succeeded" | "failed"
    gov_sync_mode?: "live" | string
    gov_sync_last_error?: string
    gov_sync_updated_at?: string
    preferred_auto_gov_sync: boolean
}

interface DestinationSchoolOption {
    id: string
    name: string
    code?: string
}

interface TransferReviewResponse {
    message: string
    review?: {
        transfer_id: string
        status: string
        auto_gov_sync: boolean
        gov_sync_triggered: boolean
        gov_sync_mode?: "live" | string
        gov_sync_job_id?: string
        gov_sync_warning?: string
    }
}

interface TransferGovSyncResponse {
    message: string
    sync?: {
        transfer_id: string
        gov_sync_triggered: boolean
        gov_sync_mode?: "live" | string
        gov_sync_job_id?: string
        gov_sync_status?: "pending" | "running" | "succeeded" | "failed"
        gov_sync_warning?: string
    }
}

interface InteropReadiness {
    enabled: boolean
    required_missing: string[]
    systems: Record<string, boolean>
    safety_checks: Record<string, boolean>
}

interface InteropJob {
    id: string
    system: string
    operation: string
    status: "pending" | "running" | "succeeded" | "failed"
    dry_run: boolean
    payload: Record<string, unknown>
    attempt_count: number
    max_attempts: number
    last_error?: string
    response_code?: number
    response_body?: string
    created_at: string
    updated_at: string
}

interface SweeperStats {
    runs_total: number
    lock_miss_total: number
    retries_total: number
    errors_total: number
    retry_sweep_enabled: boolean
}

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------
const SYSTEM_INFO: Record<string, { label: string; description: string; color: string }> = {
    diksha: { label: "DIKSHA", description: "Learning records & curriculum sync", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    digilocker: { label: "DigiLocker", description: "Document verification & storage", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
    abc: { label: "ABC / APAAR", description: "Academic credit & identity verification", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
}

const OPERATION_INFO: Record<string, { label: string; description: string; system: string }> = {
    learner_profile_sync: { label: "Sync Learner Profile", description: "Push student profile to DIKSHA", system: "diksha" },
    learning_progress_sync: { label: "Sync Learning Progress", description: "Update academic progress records", system: "diksha" },
    transfer_event_sync: { label: "Sync Transfer Event", description: "Report inter-school transfer", system: "diksha" },
    document_metadata_sync: { label: "Sync Document Metadata", description: "Register document with DigiLocker", system: "digilocker" },
    apaar_verify: { label: "Verify APAAR ID", description: "Validate student's APAAR/ABC identity", system: "abc" },
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
    succeeded: { icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800", label: "Succeeded" },
    failed: { icon: XCircle, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800", label: "Failed" },
    running: { icon: Play, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800", label: "Running" },
    pending: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted/50 border-border", label: "Pending" },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function prettyDate(value?: string) {
    if (!value) return "-"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString()
}

function relativeTime(value?: string) {
    if (!value) return ""
    const diff = Date.now() - new Date(value).getTime()
    if (diff < 60000) return "just now"
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
}

function stageLabel(item: TransferItem): string {
    if (item.status !== "approved") {
        if (item.status === "pending") return "Awaiting school decision"
        if (item.status === "rejected") return "Transfer rejected"
        return "Transfer closed"
    }
    if (!item.gov_sync_status) return "Approved — gov sync not started"
    if (item.gov_sync_status === "pending") return "Approved — gov sync queued"
    if (item.gov_sync_status === "running") return "Approved — syncing with government"
    if (item.gov_sync_status === "succeeded") return "Transfer complete ✓"
    return "Approved — gov sync failed (retry needed)"
}

const PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function AdminTransfersPage() {
    const queryClient = useQueryClient()

    // --- Transfer form state ---
    const [selectedClassID, setSelectedClassID] = useState("")
    const [studentSearch, setStudentSearch] = useState("")
    const [selectedStudentID, setSelectedStudentID] = useState("")
    const [studentComboOpen, setStudentComboOpen] = useState(false)
    const [destinationSchoolSearch, setDestinationSchoolSearch] = useState("")
    const [selectedDestinationSchoolID, setSelectedDestinationSchoolID] = useState("")
    const [reason, setReason] = useState("")
    const [evidenceRef, setEvidenceRef] = useState("")
    const studentInputRef = useRef<HTMLInputElement>(null)

    // --- Transfer list state ---
    const [direction, setDirection] = useState<"all" | "incoming" | "outgoing">("all")
    const [status, setStatus] = useState<"all" | "pending" | "approved" | "rejected" | "cancelled">("pending")
    const [page, setPage] = useState(1)
    const [autoGovSyncOnApprove, setAutoGovSyncOnApprove] = useState(true)

    // --- Interop job list state ---
    const [jobFilterStatus, setJobFilterStatus] = useState("all")
    const [expandedJobId, setExpandedJobId] = useState<string | null>(null)

    const debouncedStudentSearch = useDebounce(studentSearch, 250)
    const debouncedDestinationSchoolSearch = useDebounce(destinationSchoolSearch, 250)

    // Reset student selection when class changes
    useEffect(() => {
        setSelectedStudentID("")
        setStudentSearch("")
    }, [selectedClassID])

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------
    const classesQuery = useQuery({
        queryKey: ["admin-transfer-classes"],
        queryFn: () => api.get<{ classes: ClassOption[] }>("/classes?academic_year=all"),
        staleTime: 60_000,
    })

    const studentsQuery = useQuery({
        queryKey: ["admin-transfer-students", selectedClassID, debouncedStudentSearch],
        queryFn: () => {
            const params = new URLSearchParams()
            params.set("page", "1")
            params.set("page_size", "100")
            if (selectedClassID) params.set("class_id", selectedClassID)
            if (debouncedStudentSearch.trim()) params.set("search", debouncedStudentSearch.trim())
            return api.get<{ students: StudentOption[] }>(`/admin/students-list?${params.toString()}`)
        },
        enabled: !!selectedClassID,
        staleTime: 30_000,
    })

    const transfersQuery = useQuery({
        queryKey: ["admin-transfers", direction, status, page],
        queryFn: () => {
            const params = new URLSearchParams()
            params.set("page", String(page))
            params.set("page_size", String(PAGE_SIZE))
            if (direction !== "all") params.set("direction", direction)
            if (status !== "all") params.set("status", status)
            return api.get<{ items: TransferItem[]; total: number }>(`/admin/transfers?${params.toString()}`)
        },
        staleTime: 10_000,
    })

    const destinationSchoolsQuery = useQuery({
        queryKey: ["admin-transfer-destination-schools", debouncedDestinationSchoolSearch],
        queryFn: () => {
            const params = new URLSearchParams()
            params.set("limit", "50")
            if (debouncedDestinationSchoolSearch.trim()) params.set("search", debouncedDestinationSchoolSearch.trim())
            return api.get<{ items: DestinationSchoolOption[] }>(`/admin/transfers/destination-schools?${params.toString()}`)
        },
        staleTime: 30_000,
    })

    const readinessQuery = useQuery({
        queryKey: ["admin-interop-readiness"],
        queryFn: () => api.get<InteropReadiness>("/admin/interop/readiness"),
        staleTime: 15_000,
    })

    const jobsQuery = useQuery({
        queryKey: ["admin-interop-jobs", jobFilterStatus],
        queryFn: () => {
            const params = new URLSearchParams()
            params.set("limit", "50")
            if (jobFilterStatus !== "all") params.set("status", jobFilterStatus)
            return api.get<{ items: InteropJob[]; count: number }>(`/admin/interop/jobs?${params.toString()}`)
        },
        staleTime: 10_000,
    })



    // -----------------------------------------------------------------------
    // Transfer Mutations
    // -----------------------------------------------------------------------
    const createTransferMutation = useMutation({
        mutationFn: () =>
            api.post<{ transfer: TransferItem }>("/admin/transfers", {
                student_id: selectedStudentID,
                destination_school_id: selectedDestinationSchoolID,
                reason: reason.trim() || undefined,
                evidence_ref: evidenceRef.trim() || undefined,
                auto_gov_sync: autoGovSyncOnApprove,
            }),
        onSuccess: () => {
            toast.success("Transfer request created")
            setSelectedDestinationSchoolID("")
            setDestinationSchoolSearch("")
            setReason("")
            setEvidenceRef("")
            queryClient.invalidateQueries({ queryKey: ["admin-transfers"] })
        },
        onError: (error) => {
            if (error instanceof ValidationError && error.code === "transfer_request_conflict") {
                toast.error("Transfer request conflict", {
                    description: "Destination school not eligible, learner already active there, or pending request exists.",
                })
                return
            }
            toast.error("Failed to create transfer", { description: error instanceof Error ? error.message : "Unexpected error" })
        },
    })

    const reviewTransferMutation = useMutation({
        mutationFn: (payload: { id: string; action: "approve" | "reject" }) =>
            api.put<TransferReviewResponse>(`/admin/transfers/${payload.id}/review`, {
                action: payload.action,
                auto_gov_sync: payload.action === "approve" ? undefined : false,
            }),
        onSuccess: (data, vars) => {
            toast.success(vars.action === "approve" ? "Transfer approved" : "Transfer rejected")
            if (vars.action === "approve" && data.review?.auto_gov_sync) {
                if (data.review.gov_sync_triggered) {
                    toast.success("Government sync queued", { description: "The official DIKSHA connector job was queued." })
                } else if (data.review.gov_sync_warning) {
                    toast.warning("Approved, gov sync pending", { description: data.review.gov_sync_warning })
                }
            }
            queryClient.invalidateQueries({ queryKey: ["admin-transfers"] })
            queryClient.invalidateQueries({ queryKey: ["admin-interop-jobs"] })
        },
        onError: (error) => toast.error("Failed to update transfer", { description: error instanceof Error ? error.message : "Unexpected error" }),
    })

    const completeTransferMutation = useMutation({
        mutationFn: (transferID: string) =>
            api.post<TransferReviewResponse>(`/admin/transfers/${transferID}/complete`, {}),
        onSuccess: (data) => {
            toast.success("Transfer completed")
            if (data.review?.auto_gov_sync && data.review.gov_sync_triggered) {
                toast.success("Government sync queued", { description: "The official DIKSHA connector job was queued." })
            } else if (data.review?.gov_sync_warning) {
                toast.warning("Completed, gov sync pending", { description: data.review.gov_sync_warning })
            }
            queryClient.invalidateQueries({ queryKey: ["admin-transfers"] })
            queryClient.invalidateQueries({ queryKey: ["admin-interop-jobs"] })
        },
        onError: (error) => toast.error("Failed to complete transfer", { description: error instanceof Error ? error.message : "Unexpected error" }),
    })

    const triggerGovSyncMutation = useMutation({
        mutationFn: (transferID: string) => api.post<TransferGovSyncResponse>(`/admin/transfers/${transferID}/gov-sync`, {}),
        onSuccess: (data) => {
            if (data.sync?.gov_sync_triggered) {
                toast.success("Government sync started", { description: "The official DIKSHA connector job was queued." })
            } else {
                toast.warning("Gov sync not started", { description: data.sync?.gov_sync_warning || "Review prerequisites and try again." })
            }
            queryClient.invalidateQueries({ queryKey: ["admin-transfers"] })
            queryClient.invalidateQueries({ queryKey: ["admin-interop-jobs"] })
        },
        onError: (error) => toast.error("Failed to start gov sync", { description: error instanceof Error ? error.message : "Unexpected error" }),
    })

    const retryGovSyncMutation = useMutation({
        mutationFn: (transferID: string) => api.post<TransferGovSyncResponse>(`/admin/transfers/${transferID}/gov-sync/retry`, {}),
        onSuccess: (data) => {
            if (data.sync?.gov_sync_triggered) toast.success("Gov sync retry started")
            else toast.warning("Retry not started", { description: data.sync?.gov_sync_warning || "Retry conditions not met." })
            queryClient.invalidateQueries({ queryKey: ["admin-transfers"] })
            queryClient.invalidateQueries({ queryKey: ["admin-interop-jobs"] })
        },
        onError: (error) => toast.error("Failed to retry gov sync", { description: error instanceof Error ? error.message : "Unexpected error" }),
    })

    const retryJobMutation = useMutation({
        mutationFn: (jobID: string) => api.post<{ job: InteropJob }>(`/admin/interop/jobs/${jobID}/retry`, {}),
        onSuccess: () => {
            toast.success("Retry triggered")
            queryClient.invalidateQueries({ queryKey: ["admin-interop-jobs"] })
        },
        onError: (error) => toast.error("Retry failed", { description: error instanceof Error ? error.message : "Unexpected error" }),
    })

    // -----------------------------------------------------------------------
    // Derived
    // -----------------------------------------------------------------------
    const isBusy = createTransferMutation.isPending || completeTransferMutation.isPending || reviewTransferMutation.isPending || triggerGovSyncMutation.isPending || retryGovSyncMutation.isPending

    const studentOptions = studentsQuery.data?.students ?? []
    const destinationSchoolOptions = destinationSchoolsQuery.data?.items ?? []
    const destinationSchoolsError = destinationSchoolsQuery.error
    const transferItems = transfersQuery.data?.items ?? []
    const total = transfersQuery.data?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    const readiness = readinessQuery.data
    const transferJobs = useMemo(
        () => (jobsQuery.data?.items || []).filter((job) => job.operation === "transfer_event_sync"),
        [jobsQuery.data?.items],
    )

    const selectedStudent = useMemo(
        () => studentOptions.find((s) => s.id === selectedStudentID),
        [studentOptions, selectedStudentID],
    )

    const classOptions = classesQuery.data?.classes ?? []

    const refreshAll = () => {
        readinessQuery.refetch()
        jobsQuery.refetch()
        transfersQuery.refetch()
    }

    const handleSelectStudent = (student: StudentOption) => {
        setSelectedStudentID(student.id)
        setStudentSearch(student.full_name)
        setStudentComboOpen(false)
    }

    const handleStudentSearchChange = (value: string) => {
        setStudentSearch(value)
        if (selectedStudentID) setSelectedStudentID("")
        if (!studentComboOpen) setStudentComboOpen(true)
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    return (
        <div className="space-y-6">
            {/* ============================================================ */}
            {/* Header                                                       */}
            {/* ============================================================ */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <ArrowRightLeft className="h-6 w-6 text-primary" /> Learner Transfers
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Transfer students between schools and prepare connector jobs for configured government systems (DIKSHA, DigiLocker, ABC) from one place.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={refreshAll} disabled={readinessQuery.isFetching || jobsQuery.isFetching || transfersQuery.isFetching}>
                    {(readinessQuery.isFetching || jobsQuery.isFetching || transfersQuery.isFetching)
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <RefreshCcw className="h-4 w-4" />}
                </Button>
            </div>

            {/* ============================================================ */}
            {/* Create Transfer Request                                      */}
            {/* ============================================================ */}
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle>Create Transfer Request</CardTitle>
                    <CardDescription>Select a student, pick the destination school, and submit the transfer.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Step 1: Select Class */}
                        <div className="space-y-2">
                            <Label>Class</Label>
                            <Select value={selectedClassID} onValueChange={setSelectedClassID}>
                                <SelectTrigger>
                                    <SelectValue placeholder={classesQuery.isLoading ? "Loading classes..." : "Select a class first"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {classOptions.map((cls) => (
                                        <SelectItem key={cls.id} value={cls.id}>
                                            {cls.name}{cls.section ? ` - ${cls.section}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Step 2: Search + Select Student (combobox) */}
                        <div className="space-y-2">
                            <Label>Student</Label>
                            <Popover open={studentComboOpen && !!selectedClassID} onOpenChange={setStudentComboOpen}>
                                <PopoverTrigger asChild>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            ref={studentInputRef}
                                            value={studentSearch}
                                            onChange={(e) => handleStudentSearchChange(e.target.value)}
                                            onFocus={() => { if (selectedClassID) setStudentComboOpen(true) }}
                                            placeholder={!selectedClassID ? "Pick a class first" : "Type to search students..."}
                                            disabled={!selectedClassID}
                                            className="pl-9"
                                        />
                                        {studentsQuery.isFetching && selectedClassID && (
                                            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                                        )}
                                    </div>
                                </PopoverTrigger>
                                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" sideOffset={4} onOpenAutoFocus={(e) => e.preventDefault()}>
                                    <div className="max-h-60 overflow-y-auto">
                                        {studentOptions.length === 0 ? (
                                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                                {studentsQuery.isFetching ? "Searching..." : debouncedStudentSearch ? "No students found" : "Type to search"}
                                            </div>
                                        ) : (
                                            studentOptions.map((student) => (
                                                <button
                                                    key={student.id}
                                                    onClick={() => handleSelectStudent(student)}
                                                    className={`flex items-center gap-3 w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                                                        selectedStudentID === student.id ? "bg-accent font-medium" : ""
                                                    }`}
                                                >
                                                    <UserRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                    <div className="min-w-0">
                                                        <p className="truncate text-foreground">{student.full_name}</p>
                                                        <p className="text-xs text-muted-foreground truncate">
                                                            {student.admission_number}{student.class_name ? ` · ${student.class_name}` : ""}
                                                        </p>
                                                    </div>
                                                    {selectedStudentID === student.id && <CheckCircle2 className="h-4 w-4 text-primary ml-auto flex-shrink-0" />}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            {selectedStudent ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                    {selectedStudent.full_name} ({selectedStudent.admission_number})
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Destination School</Label>
                            <Input value={destinationSchoolSearch} onChange={(e) => setDestinationSchoolSearch(e.target.value)} placeholder="Search destination school" />
                            <Select value={selectedDestinationSchoolID} onValueChange={setSelectedDestinationSchoolID}>
                                <SelectTrigger><SelectValue placeholder="Select destination school" /></SelectTrigger>
                                <SelectContent>
                                    {destinationSchoolOptions.map((school) => (
                                        <SelectItem key={school.id} value={school.id}>
                                            {school.name}{school.code ? ` (${school.code})` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {destinationSchoolsQuery.isFetching ? <p className="text-xs text-muted-foreground">Loading...</p> : null}
                            {!destinationSchoolsQuery.isFetching && destinationSchoolsError instanceof ValidationError && destinationSchoolsError.code === "transfer_request_conflict" ? (
                                <p className="text-xs text-amber-700 dark:text-amber-400">Source school is not eligible for transfers.</p>
                            ) : null}
                            {!destinationSchoolsQuery.isFetching && !destinationSchoolsError && destinationSchoolOptions.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No eligible destination schools found.</p>
                            ) : null}
                        </div>
                        <div className="space-y-2">
                            <Label>Evidence Reference (optional)</Label>
                            <Input value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} placeholder="Document ID / ticket / reference" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Reason (optional)</Label>
                        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for transfer" />
                    </div>

                    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                        <div>
                            <p className="text-sm font-medium text-foreground">Government sync after approval</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                This form only creates the transfer request inside Schools24. After the receiving school approves it, Schools24 can prepare the official DIKSHA connector job if interop has been properly onboarded. If the connector-side call fails, the receiving school can retry it from the transfer queue.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="rounded-lg border bg-background p-3">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Government sync mode</p>
                                <p className="mt-1 font-medium text-foreground">Official DIKSHA connector</p>
                            </div>
                            <div className="rounded-lg border bg-background p-3">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Execution flow</p>
                                <p className="mt-1 font-medium text-foreground">Source school requests, destination school approves, then Schools24 queues the official connector job when interop is enabled</p>
                            </div>
                            <div className="rounded-lg border bg-background p-3">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Transparency</p>
                                <p className="mt-1 font-medium text-foreground">Both schools can track the request status, decision, timestamps, and sync outcome from the same transfer workflow</p>
                            </div>
                        </div>
                        {!readiness?.enabled ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                Government sync is currently unavailable because interop is disabled. Enable the official connector configuration before submitting transfer events outside Schools24.
                            </div>
                        ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t">
                        <div className="flex items-center gap-2">
                            <Checkbox id="auto-gov-sync-create" checked={autoGovSyncOnApprove} onCheckedChange={(checked) => setAutoGovSyncOnApprove(Boolean(checked))} />
                            <Label htmlFor="auto-gov-sync-create" className="text-sm text-muted-foreground">Start the official connector job automatically after the receiving school approves</Label>
                        </div>
                        <Button
                            onClick={() => createTransferMutation.mutate()}
                            disabled={!selectedStudentID || !selectedDestinationSchoolID || isBusy}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                            {createTransferMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Create Transfer Request
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* ============================================================ */}
            {/* Transfer Queue                                               */}
            {/* ============================================================ */}
            <Card className="border-border/70">
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle>Transfer Queue</CardTitle>
                            <CardDescription>{total} transfer{total !== 1 ? "s" : ""} found</CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Select value={direction} onValueChange={(v: "all" | "incoming" | "outgoing") => { setDirection(v); setPage(1) }}>
                                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All directions</SelectItem>
                                    <SelectItem value="incoming">Incoming</SelectItem>
                                    <SelectItem value="outgoing">Outgoing</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={status} onValueChange={(v: "all" | "pending" | "approved" | "rejected" | "cancelled") => { setStatus(v); setPage(1) }}>
                                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All statuses</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="approved">Approved</SelectItem>
                                    <SelectItem value="rejected">Rejected</SelectItem>
                                    <SelectItem value="cancelled">Cancelled</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {transfersQuery.isLoading ? (
                        <div className="py-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" /> Loading transfers...</div>
                    ) : transferItems.length === 0 ? (
                        <div className="py-10 text-center text-muted-foreground border rounded-lg bg-muted/30">No transfers found for selected filters.</div>
                    ) : (
                        <div className="space-y-2">
                            {transferItems.map((item) => (
                                <div key={item.id} className="border rounded-xl p-4 space-y-2 bg-card">
                                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                                        <div>
                                            <div className="font-medium">{item.learner_name || "Learner"}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {item.source_school_name || item.source_school_id} {" → "} {item.destination_school_name || item.destination_school_id}
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="uppercase w-fit">{item.status}</Badge>
                                    </div>

                                    {item.reason ? <p className="text-sm text-muted-foreground">Reason: {item.reason}</p> : null}
                                    {item.evidence_ref ? <p className="text-xs text-muted-foreground">Evidence: {item.evidence_ref}</p> : null}

                                    <div className="text-xs text-muted-foreground">
                                        Requested: {new Date(item.requested_at).toLocaleString()}
                                        {item.reviewed_at ? ` | Reviewed: ${new Date(item.reviewed_at).toLocaleString()}` : ""}
                                    </div>

                                    <div className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Stage: {stageLabel(item)}</div>
                                    <div className="text-xs text-muted-foreground">
                                        Government handoff: {item.preferred_auto_gov_sync ? "automatic after approval" : "manual after approval"}
                                    </div>

                                    {/* Gov Sync Panel (for approved transfers) */}
                                    {item.status === "approved" ? (
                                        <div className="rounded-md border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/20 p-2 text-xs">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium text-indigo-900 dark:text-indigo-300">Gov Sync</span>
                                                {item.gov_sync_status ? (
                                                    <Badge variant="outline" className="uppercase">{item.gov_sync_status}</Badge>
                                                ) : (
                                                    <Badge variant="secondary">Not started</Badge>
                                                )}
                                                {item.gov_sync_mode ? <Badge variant="outline">Live</Badge> : null}
                                                {item.gov_sync_updated_at ? <span className="text-muted-foreground">Updated: {new Date(item.gov_sync_updated_at).toLocaleString()}</span> : null}
                                            </div>
                                            {item.gov_sync_last_error ? <p className="mt-2 text-amber-800 dark:text-amber-300">{item.gov_sync_last_error}</p> : null}
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {!item.gov_sync_status ? (
                                                    <Button size="sm" variant="outline" disabled={isBusy} onClick={() => triggerGovSyncMutation.mutate(item.id)}>
                                                        {triggerGovSyncMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                                        Start Gov Sync
                                                    </Button>
                                                ) : null}
                                                {item.gov_sync_status === "failed" ? (
                                                    <Button size="sm" variant="outline" disabled={isBusy} onClick={() => retryGovSyncMutation.mutate(item.id)}>
                                                        {retryGovSyncMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                                        Retry Gov Sync
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : null}

                                    {/* Action buttons for pending incoming transfers */}
                                    {direction !== "outgoing" && item.status === "pending" ? (
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            <Button size="sm" disabled={isBusy} onClick={() => completeTransferMutation.mutate(item.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                                {completeTransferMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                                {item.preferred_auto_gov_sync ? "Approve + Complete + Gov Sync" : "Approve + Complete"}
                                            </Button>
                                            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => reviewTransferMutation.mutate({ id: item.id, action: "reject" })}>
                                                Reject
                                            </Button>
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Pagination */}
                    <div className="flex items-center justify-end gap-2 pt-4 border-t border-border mt-4">
                        <Button variant="outline" size="sm" disabled={page <= 1 || isBusy} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                        <span className="text-sm text-muted-foreground">Page {page} / {totalPages}</span>
                        <Button variant="outline" size="sm" disabled={page >= totalPages || isBusy} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
                    </div>
                </CardContent>
            </Card>

            {/* ============================================================ */}
            {/* Interop Job History                                          */}
            {/* ============================================================ */}
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle>Transfer Government Sync Jobs</CardTitle>
                            <CardDescription>{transferJobs.length} transfer sync job{transferJobs.length !== 1 ? "s" : ""} found</CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Select value={jobFilterStatus} onValueChange={setJobFilterStatus}>
                                <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Status</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="running">Running</SelectItem>
                                    <SelectItem value="succeeded">Succeeded</SelectItem>
                                    <SelectItem value="failed">Failed</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {jobsQuery.isLoading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading jobs...</div>
                    ) : jobsQuery.isError ? (
                        <div className="text-center py-12 text-red-600 dark:text-red-400">Failed to load jobs.</div>
                    ) : transferJobs.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-muted-foreground text-sm">No transfer sync jobs found yet</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {transferJobs.map((job) => {
                                const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending
                                const StatusIcon = statusCfg.icon
                                const isExpanded = expandedJobId === job.id
                                const opInfo = OPERATION_INFO[job.operation]
                                const sysInfo = SYSTEM_INFO[job.system]

                                return (
                                    <div key={job.id} className={`rounded-lg border transition-all ${statusCfg.bg} ${isExpanded ? "shadow-sm" : ""}`}>
                                        <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setExpandedJobId(isExpanded ? null : job.id)}>
                                            <StatusIcon className={`h-5 w-5 flex-shrink-0 ${statusCfg.color}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium text-sm text-foreground">{opInfo?.label || job.operation}</span>
                                                    <Badge className={`${sysInfo?.color || "bg-slate-100"} text-[10px]`}>{sysInfo?.label || job.system}</Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                                    {relativeTime(job.created_at)} · Attempt {job.attempt_count}/{job.max_attempts}
                                                    {job.last_error && <span className="text-red-600 dark:text-red-400"> · {job.last_error}</span>}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {job.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                                                {job.status === "failed" && (
                                                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={(e) => { e.stopPropagation(); retryJobMutation.mutate(job.id) }} disabled={retryJobMutation.isPending}>
                                                        <RotateCcw className="h-3 w-3 mr-1" /> Retry
                                                    </Button>
                                                )}
                                                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="border-t px-3 py-3 text-xs space-y-2">
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                    <Detail label="Job ID" value={job.id} mono />
                                                    <Detail label="Created" value={prettyDate(job.created_at)} />
                                                    <Detail label="Updated" value={prettyDate(job.updated_at)} />
                                                    <Detail label="Response Code" value={job.response_code ? String(job.response_code) : "-"} />
                                                </div>
                                                {job.last_error && <div className="rounded bg-red-100 dark:bg-red-900/30 p-2 text-red-700 dark:text-red-300"><strong>Error:</strong> {job.last_error}</div>}
                                                {job.response_body && <div className="rounded bg-muted p-2 font-mono text-foreground/80 break-all">{job.response_body}</div>}
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</p>
            <p className={`text-foreground/90 ${mono ? "font-mono text-[10px] break-all" : ""}`}>{value}</p>
        </div>
    )
}
