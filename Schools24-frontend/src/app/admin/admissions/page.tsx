"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleSwitch } from "@/components/ui/toggle-switch"
import { Textarea } from "@/components/ui/textarea"
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  ClipboardList,
  CheckCircle2,
  XCircle,
  Eye,
  FileText,
  Image as ImageIcon,
  Search,
  Printer,
  Loader2,
  Copy,
  ExternalLink,
  Settings,
  Users,
  Clock,
  CheckCheck,
  GraduationCap,
  CircleDot,
  BookOpen,
  QrCode,
  LayoutList,
  FormInput,
  ArrowLeft,
  ArrowRight,
  Upload,
  AlertCircle,
  PartyPopper,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import { useClasses } from "@/hooks/useClasses"
import { buildWsBaseUrl, getWSTicket } from "@/lib/ws-ticket"
import { toast } from "sonner"
import { format } from "date-fns"
import QRCode from "qrcode"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdmissionListItem {
  id: string
  student_name: string
  date_of_birth: string
  mother_phone: string
  applying_for_class?: string
  document_count: number
  status: "pending" | "under_review" | "approved" | "rejected"
  submitted_at: string
}

interface AdmissionApplication extends AdmissionListItem {
  school_id: string
  gender?: string
  religion?: string
  caste_category?: string
  nationality?: string
  mother_tongue?: string
  blood_group?: string
  aadhaar_number?: string
  email?: string
  father_name?: string
  father_phone?: string
  mother_name?: string
  mother_occupation?: string
  father_occupation?: string
  guardian_name?: string
  guardian_phone?: string
  guardian_relation?: string
  address_line1?: string
  address_line2?: string
  city?: string
  state?: string
  pincode?: string
  previous_school_name?: string
  previous_class?: string
  previous_school_address?: string
  tc_number?: string
  has_birth_certificate: boolean
  has_aadhaar_card: boolean
  has_transfer_certificate: boolean
  has_caste_certificate: boolean
  has_income_certificate: boolean
  has_passport_photo: boolean
  rejection_reason?: string
}

interface AdmissionSettings {
  admissions_open: boolean
  auto_approve: boolean
  global_academic_year: string
  school_slug: string
  school_name: string
  admission_portal_url?: string
  admission_embed_url?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:      { label: "Pending",      bg: "bg-amber-50 text-amber-700 border border-amber-200",   dot: "bg-amber-400" },
  under_review: { label: "Under Review", bg: "bg-blue-50 text-blue-700 border border-blue-200",      dot: "bg-blue-500" },
  approved:     { label: "Approved",     bg: "bg-green-50 text-green-700 border border-green-200",   dot: "bg-green-500" },
  rejected:     { label: "Rejected",     bg: "bg-red-50 text-red-700 border border-red-200",         dot: "bg-red-400" },
} as const

const DOC_FLAGS: { key: keyof AdmissionApplication; label: string }[] = [
  { key: "has_birth_certificate",    label: "Birth Certificate" },
  { key: "has_aadhaar_card",         label: "Aadhaar Card" },
  { key: "has_transfer_certificate", label: "Transfer Certificate" },
  { key: "has_caste_certificate",    label: "Caste Certificate" },
  { key: "has_income_certificate",   label: "Income Certificate" },
  { key: "has_passport_photo",       label: "Passport Photo" },
]

const STATUS_TABS = [
  { key: "all",          label: "All" },
  { key: "pending",      label: "Pending" },
  { key: "under_review", label: "Under Review" },
  { key: "approved",     label: "Approved" },
  { key: "rejected",     label: "Rejected" },
]

function getAgeFromDob(dobRaw?: string): number | null {
  if (!dobRaw) return null
  const dob = new Date(dobRaw)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
    age -= 1
  }
  return age
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAdmissionsPage() {
  const queryClient = useQueryClient()

  // ── Real-time WebSocket: invalidate queries on new admission  ─────────────
  const wsRef    = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount = useRef(0)
  const MAX_RETRY = 5

  useEffect(() => {
    async function connect() {
      try {
        const { ticket } = await getWSTicket("admissions")
        const url =
          `${buildWsBaseUrl()}/api/v1/admin/admissions/ws?ticket=${encodeURIComponent(ticket)}`

        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string) as { type: string }
            if (data.type === "new_admission") {
              queryClient.invalidateQueries({ queryKey: ["admin-admissions"] })
              queryClient.invalidateQueries({ queryKey: ["adm-count"] })
              queryClient.invalidateQueries({ queryKey: ["admin-admissions-pending-count"] })
            }
          } catch {
          }
        }

        ws.onclose = () => {
          wsRef.current = null
          if (retryCount.current < MAX_RETRY) {
            const delay = Math.min(1_000 * 2 ** retryCount.current, 15_000)
            retryCount.current += 1
            retryRef.current = setTimeout(() => {
              void connect()
            }, delay)
          }
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
      }
    }

    retryCount.current = 0
    void connect()

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [queryClient])

  // Local state
  const [statusTab, setStatusTab]           = useState("all")
  const [search, setSearch]                 = useState("")
  const [viewMode, setViewMode]             = useState<"data" | "form">("data")
  const [settingsOpen, setSettingsOpen]     = useState(false)
  const [detailOpen, setDetailOpen]         = useState(false)
  const [rejectOpen, setRejectOpen]         = useState(false)
  const [rejectReason, setRejectReason]     = useState("")
  const [selectedApp, setSelectedApp]       = useState<AdmissionListItem | null>(null)
  const [approveOpen, setApproveOpen]       = useState(false)
  const [approveClassId, setApproveClassId] = useState("")
  const [consentGuardianName, setConsentGuardianName] = useState("")
  const [consentGuardianPhone, setConsentGuardianPhone] = useState("")
  const [consentGuardianRelation, setConsentGuardianRelation] = useState("")
  const [consentMethod, setConsentMethod] = useState("digital")
  const [consentReference, setConsentReference] = useState("")
  const [guardianDeclarationAccepted, setGuardianDeclarationAccepted] = useState(false)

  // Settings draft state (controlled inside the dialog)
  const [draftOpen, setDraftOpen]           = useState(false)
  const [draftAutoApprove, setDraftAutoApprove] = useState(false)

  // ── Queries
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["admin-admission-settings"],
    queryFn: () => api.get<AdmissionSettings>("/admin/settings/admissions"),
  })

  const { data: classes } = useClasses(settings?.global_academic_year)
  const classList = classes?.classes ?? []

  const sentinelRef = useRef<HTMLDivElement>(null)

  const {
    data: listData,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin-admissions", statusTab],
    queryFn: ({ pageParam }: { pageParam: number }) =>
      api.get<{ items: AdmissionListItem[]; total: number }>(
        `/admin/admissions?${statusTab !== "all" ? `status=${statusTab}&` : ""}page=${pageParam}&page_size=20`
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.flatMap((p) => p.items).length
      return loaded < lastPage.total ? allPages.length + 1 : undefined
    },
  })

  // Sentinel intersection observer for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const cAll      = useQuery({ queryKey: ["adm-count", "all"],          queryFn: () => api.get<{ total: number }>("/admin/admissions?page=1&page_size=1"),                      staleTime: 30000 })
  const cPending  = useQuery({ queryKey: ["adm-count", "pending"],      queryFn: () => api.get<{ total: number }>("/admin/admissions?status=pending&page=1&page_size=1"),       staleTime: 30000 })
  const cReview   = useQuery({ queryKey: ["adm-count", "under_review"], queryFn: () => api.get<{ total: number }>("/admin/admissions?status=under_review&page=1&page_size=1"), staleTime: 30000 })
  const cApproved = useQuery({ queryKey: ["adm-count", "approved"],     queryFn: () => api.get<{ total: number }>("/admin/admissions?status=approved&page=1&page_size=1"),      staleTime: 30000 })
  const cRejected = useQuery({ queryKey: ["adm-count", "rejected"],     queryFn: () => api.get<{ total: number }>("/admin/admissions?status=rejected&page=1&page_size=1"),      staleTime: 30000 })

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["admin-admission-detail", selectedApp?.id],
    queryFn: () => api.get<AdmissionApplication>(`/admin/admissions/${selectedApp!.id}`),
    enabled: !!selectedApp?.id,
    staleTime: 0,
    gcTime: 0,
  })

  // ── Mutations
  const settingsMutation = useMutation({
    mutationFn: (payload: { admissions_open: boolean; auto_approve: boolean }) =>
      api.put("/admin/settings/admissions", payload),
    onSuccess: (_data: unknown, payload: { admissions_open: boolean; auto_approve: boolean }) => {
      toast.success(payload.admissions_open ? "Admissions opened." : "Admissions closed.")
      queryClient.invalidateQueries({ queryKey: ["admin-admission-settings"] })
      setSettingsOpen(false)
    },
    onError: () => toast.error("Failed to save settings"),
  })

  const approveMutation = useMutation({
    mutationFn: ({
      id,
      class_id,
      guardian_name,
      guardian_phone,
      guardian_relation,
      consent_method,
      consent_reference,
      guardian_declaration_accepted,
    }: {
      id: string
      class_id?: string
      guardian_name?: string
      guardian_phone?: string
      guardian_relation?: string
      consent_method?: string
      consent_reference?: string
      guardian_declaration_accepted?: boolean
    }) =>
      api.put(`/admin/admissions/${id}/approve`, {
        ...(class_id ? { class_id } : {}),
        ...(guardian_name ? { guardian_name } : {}),
        ...(guardian_phone ? { guardian_phone } : {}),
        ...(guardian_relation ? { guardian_relation } : {}),
        ...(consent_method ? { consent_method } : {}),
        ...(consent_reference ? { consent_reference } : {}),
        ...(guardian_declaration_accepted ? { guardian_declaration_accepted: true } : {}),
      }),
    onSuccess: () => {
      toast.success("Approved — student account created.")
      queryClient.invalidateQueries({ queryKey: ["admin-admissions"] })
      queryClient.invalidateQueries({ queryKey: ["adm-count"] })
      setApproveOpen(false)
      setApproveClassId("")
      setConsentGuardianName("")
      setConsentGuardianPhone("")
      setConsentGuardianRelation("")
      setConsentMethod("digital")
      setConsentReference("")
      setGuardianDeclarationAccepted(false)
      setDetailOpen(false)
    },
    onError: (e: Error) => toast.error(e.message || "Approval failed"),
  })

  const applicantAge = getAgeFromDob(detailData?.date_of_birth)
  const isMinorApplicant = applicantAge !== null && applicantAge < 18

  useEffect(() => {
    if (!approveOpen || !detailData) return
    setConsentGuardianName(detailData.guardian_name || detailData.mother_name || detailData.father_name || "")
    setConsentGuardianPhone(detailData.guardian_phone || detailData.mother_phone || detailData.father_phone || "")
    setConsentGuardianRelation(detailData.guardian_relation || "parent")
  }, [approveOpen, detailData])

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.put(`/admin/admissions/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success("Application rejected.")
      queryClient.invalidateQueries({ queryKey: ["admin-admissions"] })
      queryClient.invalidateQueries({ queryKey: ["adm-count"] })
      setRejectOpen(false)
      setDetailOpen(false)
      setRejectReason("")
    },
    onError: (e: Error) => toast.error(e.message || "Rejection failed"),
  })

  // ── Helpers
  const items = useMemo(
    () => listData?.pages.flatMap((p) => p.items) ?? [],
    [listData]
  )
  const filtered = search.trim()
    ? items.filter(
        (a) =>
          a.student_name.toLowerCase().includes(search.toLowerCase()) ||
          a.mother_phone.includes(search)
      )
    : items

  const portalUrl = settings?.admission_portal_url || ""

  // The forms host is our own deployment — no liveness
  // ping needed. A cross-origin HEAD from dash.schools24.in would be blocked by
  // CORS anyway. Just show a static active indicator when the slug exists.
  const pingDot = portalUrl ? "bg-green-500" : "bg-gray-300"
  const pingLabel = portalUrl || "No portal URL"

  const copyPortalUrl = () => {
    if (!portalUrl) return
    navigator.clipboard.writeText(portalUrl).then(() => toast.success("Link copied!"))
  }

  const downloadQR = async () => {
    if (!portalUrl) return
    try {
      const dataUrl = await QRCode.toDataURL(portalUrl, {
        width: 512,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      })
      const a = document.createElement("a")
      a.href = dataUrl
      a.download = `admission-qr-${settings?.school_slug ?? "portal"}.png`
      a.click()
      toast.success("QR code downloaded!")
    } catch {
      toast.error("Failed to generate QR code")
    }
  }

  const openSettings = () => {
    setDraftOpen(settings?.admissions_open ?? false)
    setDraftAutoApprove(settings?.auto_approve ?? false)
    setSettingsOpen(true)
  }

  const printApp = useCallback(() => {
    const app = detailData
    if (!app) return
    const docList = DOC_FLAGS.filter(({ key }) => app[key])
      .map(({ label }) => `<li>${label}</li>`).join("")
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(`<html><head><title>Admission — ${app.student_name}</title>
    <style>body{font-family:Arial,sans-serif;font-size:13px;margin:32px;color:#111}
    h2{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:12px}
    th{text-align:left;background:#f5f5f5;padding:5px 9px;font-size:11px;text-transform:uppercase}
    td{padding:6px 9px;border-bottom:1px solid #eee}.lbl{color:#888;font-size:10px;text-transform:uppercase}
    @media print{@page{margin:20mm}}</style></head><body>
    <h2>Admission Application — ${app.student_name}</h2>
    <p style="color:#666;font-size:12px">Ref: ${app.id} &nbsp;|&nbsp; ${format(new Date(app.submitted_at), "dd MMM yyyy")} &nbsp;|&nbsp; ${STATUS_CFG[app.status]?.label}</p>
    <table>
      <tr><th>Field</th><th>Value</th></tr>
      <tr><td>Name</td><td>${app.student_name}</td></tr>
      <tr><td>DOB</td><td>${app.date_of_birth}</td></tr>
      <tr><td>Gender</td><td>${app.gender ?? "—"}</td></tr>
      <tr><td>Class</td><td>${app.applying_for_class ?? "—"}</td></tr>
      <tr><td>Father</td><td>${app.father_name ?? "—"} ${app.father_phone ?? ""}</td></tr>
      <tr><td>Mother</td><td>${app.mother_name ?? "—"} ${app.mother_phone}</td></tr>
    </table>
    <p style="margin-top:16px;font-weight:600">Documents</p><ul>${docList || "<li>None</li>"}</ul>
    </body></html>`)
    w.document.close()
    w.focus()
    w.print()
    w.onafterprint = () => w.close()
  }, [detailData])

  const statItems = [
    { key: "all",          label: "All",          count: cAll.data?.total ?? 0,      icon: <Users      className="h-4 w-4" /> },
    { key: "pending",      label: "Pending",      count: cPending.data?.total ?? 0,  icon: <Clock      className="h-4 w-4" /> },
    { key: "under_review", label: "Under Review", count: cReview.data?.total ?? 0,   icon: <CircleDot  className="h-4 w-4" /> },
    { key: "approved",     label: "Approved",     count: cApproved.data?.total ?? 0, icon: <CheckCheck className="h-4 w-4" /> },
    { key: "rejected",     label: "Rejected",     count: cRejected.data?.total ?? 0, icon: <XCircle    className="h-4 w-4" /> },
  ]

  const totalLoaded = items.length
  const grandTotal  = listData?.pages[0]?.total ?? 0

  return (
    <div className="flex flex-col h-full">

      {/* ── PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="border-b bg-background px-4 sm:px-6 py-3 sm:py-4">

        {/* Main row: left info + right actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

          {/* ── Left block */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">

            {/* Title + badges */}
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
              <h1 className="text-base font-semibold sm:text-lg">Admissions</h1>
              {settings?.global_academic_year && (
                <Badge variant="secondary" className="gap-1 text-xs shrink-0">
                  <BookOpen className="h-3 w-3" />
                  {settings.global_academic_year}
                </Badge>
              )}
              {!settingsLoading && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  settings?.admissions_open
                    ? "bg-green-100 text-green-700"
                    : "bg-muted text-muted-foreground"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${settings?.admissions_open ? "bg-green-500" : "bg-gray-400"}`} />
                  {settings?.admissions_open ? "Open" : "Closed"}
                </span>
              )}
            </div>

            {/* Portal URL row — icon-only buttons on mobile */}
            {portalUrl && (
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${pingDot}`} title={pingLabel} />
                  <span className="truncate text-[11px] font-mono text-muted-foreground max-w-full lg:max-w-[24rem]">
                    {pingLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 lg:w-auto lg:flex lg:flex-nowrap lg:items-center">
                  <button
                    onClick={copyPortalUrl}
                    title="Copy link"
                    className="flex h-7 min-w-0 items-center justify-center rounded-md border px-1 text-muted-foreground transition-colors hover:bg-muted lg:min-w-[70px] lg:gap-1 lg:px-2"
                  >
                    <Copy className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                    <span className="hidden lg:inline text-[10px] font-medium">Copy</span>
                  </button>
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Preview form"
                    className="flex h-7 min-w-0 items-center justify-center rounded-md border border-primary/30 px-1 text-primary transition-colors hover:bg-primary/5 lg:min-w-[80px] lg:gap-1 lg:px-2"
                  >
                    <ExternalLink className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                    <span className="hidden lg:inline text-[10px] font-medium">Preview</span>
                  </a>
                  <button
                    onClick={downloadQR}
                    title="Download QR code"
                    className="flex h-7 min-w-0 items-center justify-center rounded-md border px-1 text-muted-foreground transition-colors hover:bg-muted lg:min-w-[56px] lg:gap-1 lg:px-2"
                  >
                    <QrCode className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                    <span className="hidden lg:inline text-[10px] font-medium">QR</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Right block: toggle + settings — row on mobile, col on sm+ */}
          <div className="grid grid-cols-[1fr_auto] gap-1.5 lg:flex lg:flex-row lg:items-center lg:justify-end shrink-0 self-stretch lg:self-auto">
            {/* Form / Data toggle */}
            <div className="flex items-center justify-between gap-0.5 rounded-lg border bg-muted p-0.5 lg:p-1">
              <button
                onClick={() => setViewMode("data")}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors sm:text-[11px] lg:px-2.5 lg:py-1.5 lg:text-xs ${
                  viewMode === "data"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutList className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                <span>Data</span>
              </button>
              <button
                onClick={() => setViewMode("form")}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors sm:text-[11px] lg:px-2.5 lg:py-1.5 lg:text-xs ${
                  viewMode === "form"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FormInput className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                <span>Form</span>
              </button>
            </div>
            <Button variant="outline" size="icon" className="h-7 w-7 shrink-0 lg:h-9 lg:w-9" onClick={openSettings}>
              <Settings className="h-3 w-3 lg:h-4 lg:w-4" />
            </Button>
          </div>

        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">

        {/* ── FORM VIEW ──────────────────────────────────────────────── */}
        {viewMode === "form" && (
          settings?.school_slug ? (
            <InlineAdmissionForm
              slug={settings.school_slug}
              academicYear={settings.global_academic_year}
              onSubmitted={() => {
                queryClient.invalidateQueries({ queryKey: ["admin-admissions"] })
                queryClient.invalidateQueries({ queryKey: ["adm-count"] })
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-muted-foreground">
              <FormInput className="h-8 w-8 mb-3 opacity-40" />
              <p className="text-sm font-medium">No school slug configured</p>
              <p className="text-xs mt-1">Set a school slug in Admission Settings to enable the walk-in form.</p>
            </div>
          )
        )}

        {/* ── DATA VIEW ──────────────────────────────────────────────── */}
        {viewMode === "data" && (<>

        {/* ── STATS ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {statItems.map(({ key, label, count, icon }) => (
            <button
              key={key}
              onClick={() => { setStatusTab(key); setViewMode("data") }}
              className={`flex min-h-[104px] flex-col items-center justify-center gap-1 rounded-xl border px-3 py-3 text-center transition-all ${
                statusTab === key
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-border/80 hover:bg-muted/50"
              }`}
            >
              <span className={statusTab === key ? "text-primary" : "text-muted-foreground"}>{icon}</span>
              <span className={`text-xl font-bold ${statusTab === key ? "text-primary" : "text-foreground"}`}>{count}</span>
              <span className={`text-[11px] font-medium leading-tight ${statusTab === key ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
            </button>
          ))}
        </div>

        {/* ── SEARCH + FILTER TABS ───────────────────────────────────── */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 pl-9 text-sm"
            />
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-auto">
            {STATUS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusTab(key)}
                className={`rounded-full px-3 py-1.5 text-[11px] sm:text-xs font-medium transition-colors ${
                  statusTab === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── TABLE ──────────────────────────────────────────────────── */}
        <Card className="border shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
              <TableRow className="border-b bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-3 sm:pl-6 py-2 font-semibold text-[10px] sm:text-xs uppercase tracking-wide text-gray-500">Student</TableHead>
                <TableHead className="hidden sm:table-cell py-2 font-semibold text-xs uppercase tracking-wide text-gray-500">DOB</TableHead>
                <TableHead className="py-2 font-semibold text-[10px] sm:text-xs uppercase tracking-wide text-gray-500">Phone</TableHead>
                <TableHead className="hidden md:table-cell py-2 font-semibold text-xs uppercase tracking-wide text-gray-500">Class</TableHead>
                <TableHead className="hidden lg:table-cell py-2 font-semibold text-xs uppercase tracking-wide text-gray-500">Docs</TableHead>
                <TableHead className="py-2 font-semibold text-[10px] sm:text-xs uppercase tracking-wide text-gray-500">Status</TableHead>
                <TableHead className="hidden sm:table-cell py-2 font-semibold text-xs uppercase tracking-wide text-gray-500">Date</TableHead>
                <TableHead className="pr-3 sm:pr-6 py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-14 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-300" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-14 text-center">
                    <p className="text-sm text-gray-400">No applications found</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((app) => {
                  const cfg = STATUS_CFG[app.status]
                  const initials = app.student_name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
                  return (
                    <TableRow
                      key={app.id}
                      className="group cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => { setSelectedApp(app); setDetailOpen(true) }}
                    >
                      <TableCell className="pl-3 pr-2 py-2.5 sm:pl-6 sm:py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] sm:text-[11px] font-bold text-primary">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <span className="block truncate font-medium text-sm leading-tight">{app.student_name}</span>
                            <span className="block text-[11px] text-muted-foreground sm:hidden leading-tight mt-0.5">
                              {format(new Date(app.submitted_at), "dd MMM yy")}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell py-3 text-sm text-gray-500">{app.date_of_birth}</TableCell>
                      <TableCell className="py-2.5 sm:py-3 pr-2 text-[12px] sm:text-sm text-gray-600 align-middle">
                        <div className="truncate max-w-[92px] sm:max-w-none">{app.mother_phone}</div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell py-3 text-sm text-gray-500">{app.applying_for_class ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell py-3">
                        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          <FileText className="h-3 w-3" /> {app.document_count}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5 sm:py-3 pr-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold whitespace-nowrap ${cfg.bg}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                          <span className="hidden sm:inline">{cfg.label}</span>
                          <span className="sm:hidden">
                            {app.status === "under_review" ? "Review" : cfg.label}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell py-3 text-sm text-gray-400">
                        {format(new Date(app.submitted_at), "dd MMM yy")}
                      </TableCell>
                      <TableCell className="pr-3 py-2.5 sm:pr-6 sm:py-3 text-right align-middle">
                        <Eye className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
          {isFetchingNextPage && (
            <div className="flex justify-center py-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
            </div>
          )}
          {!isFetchingNextPage && grandTotal > 0 && (
            <div className="border-t px-4 sm:px-6 py-2 text-center text-[11px] sm:text-xs text-gray-400">
              {totalLoaded} of {grandTotal} applications
            </div>
          )}
        </Card>

        </>)}
      </div>

      {/* ── SETTINGS DIALOG ────────────────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-sm overflow-x-hidden px-4 sm:px-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-gray-500" /> Admission Settings
            </DialogTitle>
            <DialogDescription>
              {settings?.school_name} &mdash; {settings?.global_academic_year}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Portal link */}
            {settings?.school_slug && (
              <div className="rounded-lg border bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1.5 font-medium">Admission Portal URL</p>
                <div className="space-y-2">
                  <div className="min-w-0 rounded-md bg-background/80 px-2.5 py-2">
                    <code className="block text-[11px] leading-5 break-all text-foreground/80">{portalUrl}</code>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="ghost" size="sm" onClick={copyPortalUrl} className="h-8 px-2">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <a href={portalUrl} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm" className="h-8 w-full px-2">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                    <Button variant="ghost" size="sm" onClick={downloadQR} className="h-8 px-2" title="Download QR code">
                      <QrCode className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Toggle: Admissions Open */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-semibold text-gray-800">Accept Applications</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {draftOpen ? (
                    <span className="text-green-600 font-medium">● Admissions are OPEN</span>
                  ) : (
                    <span className="text-gray-400">○ Admissions are CLOSED</span>
                  )}
                </p>
              </div>
              <ToggleSwitch
                checked={draftOpen}
                onCheckedChange={setDraftOpen}
                variant="green"
              />
            </div>

            {/* Toggle: Auto-Approve */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-semibold text-gray-800">Auto-Accept Applications</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Automatically approve &amp; create student accounts on submission
                </p>
              </div>
              <ToggleSwitch
                checked={draftAutoApprove}
                onCheckedChange={setDraftAutoApprove}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-xs sm:h-9 sm:px-4 sm:text-sm" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-8 px-3 text-xs sm:h-9 sm:px-4 sm:text-sm"
              disabled={settingsMutation.isPending}
              onClick={() => settingsMutation.mutate({ admissions_open: draftOpen, auto_approve: draftAutoApprove })}
            >
              {settingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DETAIL DIALOG ──────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={(o) => { setDetailOpen(o); if (!o) setSelectedApp(null) }}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-blue-600" />
              Application — {selectedApp?.student_name}
            </DialogTitle>
            <DialogDescription>
              Submitted {selectedApp && format(new Date(selectedApp.submitted_at), "dd MMM yyyy")}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
            </div>
          ) : detailData ? (
            <div className="space-y-5 text-sm">
              {/* Status */}
              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CFG[detailData.status]?.bg ?? ""}`}>
                  <span className={`h-2 w-2 rounded-full ${STATUS_CFG[detailData.status]?.dot ?? ""}`} />
                  {STATUS_CFG[detailData.status]?.label ?? detailData.status}
                </span>
                {detailData.rejection_reason && (
                  <span className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-1 text-red-700 text-xs">
                    {detailData.rejection_reason}
                  </span>
                )}
              </div>

              <DSec title="Student">
                <DGrid>
                  <DRow label="Full Name"       value={detailData.student_name} />
                  <DRow label="Date of Birth"   value={detailData.date_of_birth} />
                  <DRow label="Email"           value={detailData.email} />
                  <DRow label="Gender"          value={detailData.gender} />
                  <DRow label="Blood Group"     value={detailData.blood_group} />
                  <DRow label="Nationality"     value={detailData.nationality} />
                  <DRow label="Mother Tongue"   value={detailData.mother_tongue} />
                  <DRow label="Aadhaar"         value={detailData.aadhaar_number} />
                  <DRow label="Religion"        value={detailData.religion} />
                  <DRow label="Caste Category"  value={detailData.caste_category} />
                  <DRow label="Applying For"    value={detailData.applying_for_class} />
                </DGrid>
              </DSec>

              <DSec title="Parents / Guardian">
                <DGrid>
                  <DRow label="Father's Name"       value={detailData.father_name} />
                  <DRow label="Father's Phone"      value={detailData.father_phone} />
                  <DRow label="Father's Occupation" value={detailData.father_occupation} />
                  <DRow label="Mother's Name"       value={detailData.mother_name} />
                  <DRow label="Mother's Phone"      value={detailData.mother_phone} />
                  <DRow label="Mother's Occupation" value={detailData.mother_occupation} />
                  <DRow label="Guardian"            value={detailData.guardian_name} />
                  <DRow label="Guardian Phone"      value={detailData.guardian_phone} />
                  <DRow label="Guardian Relation"   value={detailData.guardian_relation} />
                </DGrid>
              </DSec>

              {detailData.address_line1 && (
                <DSec title="Address">
                  <p className="text-gray-700">
                    {[detailData.address_line1, detailData.address_line2, detailData.city, detailData.state, detailData.pincode].filter(Boolean).join(", ")}
                  </p>
                </DSec>
              )}

              {detailData.previous_school_name && (
                <DSec title="Previous School">
                  <DGrid>
                    <DRow label="School"          value={detailData.previous_school_name} />
                    <DRow label="Class Completed" value={detailData.previous_class} />
                    <DRow label="School Address"  value={detailData.previous_school_address} />
                    <DRow label="TC Number"       value={detailData.tc_number} />
                  </DGrid>
                </DSec>
              )}

              <DSec title="Documents">
                <div className="flex flex-wrap gap-2">
                  {DOC_FLAGS.map(({ key, label }) => (
                    <Badge
                      key={key}
                      variant="secondary"
                      className={`gap-1 text-xs ${
                        detailData[key]
                          ? "bg-green-50 text-green-700 border-green-200 border"
                          : "bg-gray-50 text-gray-400 border border-gray-200 opacity-60 line-through"
                      }`}
                    >
                      {label.toLowerCase().includes("photo") ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                      {label}
                    </Badge>
                  ))}
                </div>
              </DSec>
            </div>
          ) : null}

          <DialogFooter className="flex flex-col sm:flex-row gap-2 border-t pt-3 mt-2">
            <Button variant="outline" size="sm" onClick={printApp} className="gap-1.5">
              <Printer className="h-4 w-4" /> Print
            </Button>
            <div className="flex-1" />
            {detailData && (detailData.status === "pending" || detailData.status === "under_review") && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-600 hover:bg-red-50 gap-1.5"
                  onClick={() => setRejectOpen(true)}
                >
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 gap-1.5"
                  disabled={approveMutation.isPending}
                  onClick={() => { setApproveClassId(""); setApproveOpen(true) }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── APPROVE DIALOG ─────────────────────────────────────────── */}
      <Dialog open={approveOpen} onOpenChange={(o) => { if (!approveMutation.isPending) setApproveOpen(o) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" /> Approve Application
            </DialogTitle>
            <DialogDescription>
              Assign a class before creating the student account.
              {detailData?.applying_for_class && (
                <span className="block mt-1 text-xs text-muted-foreground">
                  Applied for: <strong>{detailData.applying_for_class}</strong>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="approve-class">Class <span className="text-muted-foreground text-xs">(optional — can be assigned later)</span></Label>
            <Select
              value={approveClassId || "__none__"}
              onValueChange={(v) => setApproveClassId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger id="approve-class">
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No class assigned yet</SelectItem>
                {classList.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}{cls.section ? ` - ${cls.section}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isMinorApplicant && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start gap-2 text-amber-800">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="text-xs font-semibold">Parental consent required</p>
                  <p className="text-[11px]">Applicant age is {applicantAge}. Approval requires guardian consent details.</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="consent-guardian-name">Guardian Name</Label>
                <Input id="consent-guardian-name" value={consentGuardianName} onChange={(e) => setConsentGuardianName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="consent-guardian-phone">Guardian Phone</Label>
                <Input id="consent-guardian-phone" value={consentGuardianPhone} onChange={(e) => setConsentGuardianPhone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="consent-guardian-relation">Guardian Relation</Label>
                <Input id="consent-guardian-relation" value={consentGuardianRelation} onChange={(e) => setConsentGuardianRelation(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="consent-method">Consent Method</Label>
                <Select value={consentMethod} onValueChange={setConsentMethod}>
                  <SelectTrigger id="consent-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="digital">Digital</SelectItem>
                    <SelectItem value="otp">OTP</SelectItem>
                    <SelectItem value="written">Written</SelectItem>
                    <SelectItem value="in_person">In person</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="consent-ref">Consent Reference (optional)</Label>
                <Input id="consent-ref" value={consentReference} onChange={(e) => setConsentReference(e.target.value)} placeholder="e.g. OTP transaction / signed form ref" />
              </div>
              <label className="flex items-start gap-2 text-xs text-amber-900">
                <input
                  type="checkbox"
                  checked={guardianDeclarationAccepted}
                  onChange={(e) => setGuardianDeclarationAccepted(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I confirm guardian consent has been verified and recorded.</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveOpen(false)} disabled={approveMutation.isPending}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={approveMutation.isPending || (isMinorApplicant && (!consentGuardianName.trim() || !consentGuardianPhone.trim() || !guardianDeclarationAccepted))}
              onClick={() => detailData && approveMutation.mutate({
                id: detailData.id,
                class_id: approveClassId || undefined,
                ...(isMinorApplicant
                  ? {
                      guardian_name: consentGuardianName.trim(),
                      guardian_phone: consentGuardianPhone.trim(),
                      guardian_relation: consentGuardianRelation.trim() || 'parent',
                      consent_method: consentMethod,
                      consent_reference: consentReference.trim() || undefined,
                      guardian_declaration_accepted: guardianDeclarationAccepted,
                    }
                  : {}),
              })}
            >
              {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Confirm Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── REJECT DIALOG ──────────────────────────────────────────── */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" /> Reject Application
            </DialogTitle>
            <DialogDescription>Provide a reason. Documents will be deleted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason <span className="text-red-500">*</span></Label>
            <Textarea
              placeholder="e.g. Documents incomplete, age criteria not met…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              onClick={() => selectedApp && rejectMutation.mutate({ id: selectedApp.id, reason: rejectReason })}
            >
              {rejectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">{title}</p>
      {children}
    </div>
  )
}

function DGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">{children}</div>
}

function DRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-gray-800 font-medium">{value || "—"}</p>
    </div>
  )
}

// ─── Inline Walk-in Admission Form ────────────────────────────────────────────

const BLANK_DOC_TYPES = [
  { key: "birth_certificate",    label: "Birth Certificate" },
  { key: "aadhaar_card",         label: "Aadhaar Card" },
  { key: "transfer_certificate", label: "Transfer Certificate" },
  { key: "caste_certificate",    label: "Caste Certificate" },
  { key: "income_certificate",   label: "Income Certificate" },
  { key: "passport_photo",       label: "Passport Photo" },
] as const

type DocKey = typeof BLANK_DOC_TYPES[number]["key"]

const BLANK_FORM = {
  student_name: "", date_of_birth: "", mother_phone: "", email: "",
  gender: "", religion: "", caste_category: "", nationality: "Indian",
  mother_tongue: "", blood_group: "", aadhaar_number: "", applying_for_class: "",
  previous_school_name: "", previous_class: "", previous_school_address: "", tc_number: "",
  father_name: "", father_phone: "", father_occupation: "",
  mother_name: "", mother_occupation: "",
  guardian_name: "", guardian_phone: "", guardian_relation: "",
  address_line1: "", address_line2: "", city: "", state: "", pincode: "",
}

const BLANK_DOCS: Record<DocKey, File | null> = {
  birth_certificate: null, aadhaar_card: null, transfer_certificate: null,
  caste_certificate: null, income_certificate: null, passport_photo: null,
}

function InlineAdmissionForm({
  slug,
  academicYear,
  onSubmitted,
}: {
  slug: string
  academicYear?: string
  onSubmitted?: () => void
}) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || ""
  const [step, setStep]           = useState<1 | 2 | 3 | 4>(1)
  const [form, setForm]           = useState({ ...BLANK_FORM })
  const [docs, setDocs]           = useState<Record<DocKey, File | null>>({ ...BLANK_DOCS })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ id: string; name: string } | null>(null)
  const fileRefs                  = useRef<Record<DocKey, HTMLInputElement | null>>({
    birth_certificate: null, aadhaar_card: null, transfer_certificate: null,
    caste_certificate: null, income_certificate: null, passport_photo: null,
  })

  const set = (f: keyof typeof BLANK_FORM, v: string) => setForm((p) => ({ ...p, [f]: v }))
  const setPhone = (f: keyof typeof BLANK_FORM, v: string) => set(f, v.replace(/\D/g, "").slice(0, 10))

  const step1Valid =
    form.student_name.trim() !== "" &&
    form.date_of_birth !== "" &&
    form.email.trim() !== "" &&
    /\S+@\S+\.\S+/.test(form.email.trim())

  const handleDoc = (key: DocKey, file: File | null) => {
    if (file) {
      if (file.size > 5 * 1024 * 1024) { alert(`${file.name} exceeds 5 MB limit.`); return }
      if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
        alert("Only JPEG, PNG, or PDF files are accepted."); return
      }
    }
    setDocs((d) => ({ ...d, [key]: file }))
  }

  const handleSubmit = async () => {
    setSubmitting(true); setError(null)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => { if (v.trim() !== "") fd.append(k, v) })
      if (academicYear) fd.append("academic_year", academicYear)
      BLANK_DOC_TYPES.forEach(({ key }) => { if (docs[key]) fd.append(key, docs[key]!) })
      const res = await fetch(`${apiBase}/public/admission/${encodeURIComponent(slug)}`, {
        method: "POST", body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error === "admissions_closed"
          ? "Admissions are currently closed."
          : err.error || "Submission failed. Please try again.")
        return
      }
      const data = await res.json()
      setSubmitted({ id: data.application_id, name: data.student_name })
      onSubmitted?.()
    } catch {
      setError("Network error. Please check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setForm({ ...BLANK_FORM }); setDocs({ ...BLANK_DOCS })
    setStep(1); setError(null); setSubmitted(null)
  }

  // ── Success state
  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 px-6 text-center space-y-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20">
          <PartyPopper className="h-8 w-8 text-green-500" />
        </div>
        <div>
          <p className="text-lg font-semibold">Application Submitted</p>
          <p className="text-sm text-muted-foreground mt-1">{submitted.name}&apos;s application is now pending review.</p>
        </div>
        <p className="text-[11px] font-mono text-muted-foreground bg-muted px-3 py-1.5 rounded-md">
          ID: {submitted.id}
        </p>
        <Button variant="outline" onClick={reset} className="mt-2">
          Submit Another Application
        </Button>
      </div>
    )
  }

  // ── Step indicator
  const STEPS = [
    { n: 1, label: "Student" },
    { n: 2, label: "Family" },
    { n: 3, label: "Previous School" },
    { n: 4, label: "Documents" },
  ] as const

  return (
    <div className="space-y-5">
      {/* Step bar */}
      <div className="flex items-center gap-1">
        {STEPS.map(({ n, label }) => (
          <div key={n} className="flex items-center gap-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                ${step === n ? "bg-primary text-primary-foreground"
                  : step > n ? "bg-green-500 text-white"
                  : "bg-muted text-muted-foreground"}`}>
                {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
              </div>
              <span className={`text-xs font-medium hidden sm:inline ${step === n ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </div>
            {n < 4 && <div className={`flex-1 h-0.5 mx-1 rounded ${step > n ? "bg-green-500" : "bg-border"}`} />}
          </div>
        ))}
      </div>

      {/* Form card */}
      <Card>
        {/* ── Step 1: Student Details */}
        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle className="text-base">Student Details</CardTitle>
              <p className="text-xs text-muted-foreground">Fields marked * are required</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <Label>Student Full Name *</Label>
                  <Input placeholder="As in birth certificate" value={form.student_name}
                    onChange={(e) => set("student_name", e.target.value)} />
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <Label>Email Address * <span className="text-muted-foreground font-normal text-xs">(used for login after approval)</span></Label>
                  <Input type="email" placeholder="student@example.com" value={form.email}
                    onChange={(e) => set("email", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Date of Birth *</Label>
                  <Input type="date" value={form.date_of_birth}
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => set("date_of_birth", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                    <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Blood Group</Label>
                  <Select value={form.blood_group} onValueChange={(v) => set("blood_group", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map((bg) => (
                        <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Nationality</Label>
                  <Input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Mother Tongue</Label>
                  <Input placeholder="e.g. Tamil, Hindi" value={form.mother_tongue}
                    onChange={(e) => set("mother_tongue", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Religion</Label>
                  <Input placeholder="e.g. Hindu, Christian" value={form.religion}
                    onChange={(e) => set("religion", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Caste Category</Label>
                  <Select value={form.caste_category} onValueChange={(v) => set("caste_category", v)}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="obc">OBC</SelectItem>
                      <SelectItem value="sc">SC</SelectItem>
                      <SelectItem value="st">ST</SelectItem>
                      <SelectItem value="ews">EWS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Aadhaar Number</Label>
                  <Input placeholder="12-digit number" maxLength={14} value={form.aadhaar_number}
                    onChange={(e) => set("aadhaar_number", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Applying for Class</Label>
                  <Input placeholder="e.g. Class 1, LKG" value={form.applying_for_class}
                    onChange={(e) => set("applying_for_class", e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <Button onClick={() => setStep(2)} disabled={!step1Valid}>
                  Next: Family Details <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {/* ── Step 2: Family & Address */}
        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle className="text-base">Family &amp; Address Details</CardTitle>
              <p className="text-xs text-muted-foreground">Mother&apos;s phone is required *</p>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Father */}
              <div>
                <p className="text-sm font-semibold mb-3">Father</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5"><Label>Father&apos;s Name</Label>
                    <Input value={form.father_name} onChange={(e) => set("father_name", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Father&apos;s Phone</Label>
                    <Input type="tel" inputMode="numeric" maxLength={10} value={form.father_phone}
                      onChange={(e) => setPhone("father_phone", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Father&apos;s Occupation</Label>
                    <Input value={form.father_occupation} onChange={(e) => set("father_occupation", e.target.value)} /></div>
                </div>
              </div>
              <Separator />
              {/* Mother */}
              <div>
                <p className="text-sm font-semibold mb-3">Mother</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5"><Label>Mother&apos;s Name</Label>
                    <Input value={form.mother_name} onChange={(e) => set("mother_name", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Mother&apos;s Phone *</Label>
                    <Input type="tel" inputMode="numeric" maxLength={10} value={form.mother_phone}
                      onChange={(e) => setPhone("mother_phone", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Mother&apos;s Occupation</Label>
                    <Input value={form.mother_occupation} onChange={(e) => set("mother_occupation", e.target.value)} /></div>
                </div>
              </div>
              <Separator />
              {/* Guardian */}
              <div>
                <p className="text-sm font-semibold mb-3">Guardian <span className="text-muted-foreground font-normal">(if applicable)</span></p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5"><Label>Guardian&apos;s Name</Label>
                    <Input value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Guardian&apos;s Phone</Label>
                    <Input type="tel" inputMode="numeric" maxLength={10} value={form.guardian_phone}
                      onChange={(e) => setPhone("guardian_phone", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Relation</Label>
                    <Input placeholder="e.g. Uncle, Grandparent" value={form.guardian_relation}
                      onChange={(e) => set("guardian_relation", e.target.value)} /></div>
                </div>
              </div>
              <Separator />
              {/* Address */}
              <div>
                <p className="text-sm font-semibold mb-3">Residential Address</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-1.5"><Label>Address Line 1</Label>
                    <Input placeholder="House no., Street" value={form.address_line1}
                      onChange={(e) => set("address_line1", e.target.value)} /></div>
                  <div className="md:col-span-2 space-y-1.5"><Label>Address Line 2</Label>
                    <Input placeholder="Locality, Landmark" value={form.address_line2}
                      onChange={(e) => set("address_line2", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>City</Label>
                    <Input value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>State</Label>
                    <Input value={form.state} onChange={(e) => set("state", e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>PIN Code</Label>
                    <Input maxLength={6} value={form.pincode} onChange={(e) => set("pincode", e.target.value)} /></div>
                </div>
              </div>
              <div className="flex justify-between pt-1">
                <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                <Button onClick={() => setStep(3)} disabled={form.mother_phone.trim().length < 10}>
                  Next: Previous School <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {/* ── Step 3: Previous School */}
        {step === 3 && (
          <>
            <CardHeader>
              <CardTitle className="text-base">Previous School Details</CardTitle>
              <p className="text-xs text-muted-foreground">Skip if this is a fresh admission</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2 space-y-1.5"><Label>Previous School Name</Label>
                  <Input value={form.previous_school_name}
                    onChange={(e) => set("previous_school_name", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Class Last Studied</Label>
                  <Input placeholder="e.g. Class 5" value={form.previous_class}
                    onChange={(e) => set("previous_class", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>TC Number</Label>
                  <Input placeholder="Transfer Certificate no." value={form.tc_number}
                    onChange={(e) => set("tc_number", e.target.value)} /></div>
                <div className="md:col-span-2 space-y-1.5"><Label>Previous School Address</Label>
                  <Input placeholder="City, State" value={form.previous_school_address}
                    onChange={(e) => set("previous_school_address", e.target.value)} /></div>
              </div>
              <div className="flex justify-between pt-1">
                <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                <Button onClick={() => setStep(4)}>Next: Documents <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </CardContent>
          </>
        )}

        {/* ── Step 4: Documents & Submit */}
        {step === 4 && (
          <>
            <CardHeader>
              <CardTitle className="text-base">Upload Documents</CardTitle>
              <p className="text-xs text-muted-foreground">All optional. Max 5 MB per file — JPEG, PNG, or PDF.</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {BLANK_DOC_TYPES.map(({ key, label }) => {
                  const file = docs[key]
                  return (
                    <div key={key} className="space-y-1.5">
                      <Label>{label}</Label>
                      <div
                        className={`flex items-center gap-2.5 rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors
                          ${file ? "border-green-500/50 bg-green-500/5" : "border-border hover:border-primary/50 hover:bg-muted/50"}`}
                        onClick={() => fileRefs.current[key]?.click()}
                      >
                        <input
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          className="hidden"
                          ref={(el) => { fileRefs.current[key] = el }}
                          onChange={(e) => handleDoc(key, e.target.files?.[0] ?? null)}
                        />
                        {file ? (
                          <>
                            {file.type.startsWith("image") ? (
                              <ImageIcon className="h-4 w-4 text-green-500 shrink-0" />
                            ) : (
                              <FileText className="h-4 w-4 text-green-500 shrink-0" />
                            )}
                            <span className="text-sm text-green-600 font-medium truncate flex-1">{file.name}</span>
                            <Badge variant="secondary" className="text-[10px] shrink-0">{(file.size / 1024).toFixed(0)} KB</Badge>
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-sm text-muted-foreground">Click to upload</span>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Summary */}
              <div className="rounded-lg border bg-muted/40 p-4 space-y-1.5 text-sm">
                <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-2">Application Summary</p>
                {academicYear && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Academic Year</span><span className="font-medium">{academicYear}</span></div>}
                <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Student</span><span className="font-medium">{form.student_name}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Date of Birth</span><span className="font-medium">{form.date_of_birth}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Email</span><span className="font-medium">{form.email}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Class Applied</span><span className="font-medium">{form.applying_for_class || "—"}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Mother&apos;s Phone</span><span className="font-medium">{form.mother_phone}</span></div>
                <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Documents</span><span className="font-medium">{Object.values(docs).filter(Boolean).length} attached</span></div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-1">
                <Button variant="outline" onClick={() => setStep(3)} disabled={submitting}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                  ) : (
                    <><CheckCircle2 className="mr-2 h-4 w-4" /> Submit Application</>
                  )}
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
