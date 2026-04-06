"use client"

import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Inbox,
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { PasswordPromptDialog } from "@/components/super-admin/PasswordPromptDialog"
import {
  useAcceptDemoRequest,
  useDemoRequests,
  useDemoRequestStats,
  useTrashDemoRequest,
} from "@/hooks/useDemoRequests"
import type { DemoRequest } from "@/services/demoRequestService"
import { cn } from "@/lib/utils"

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const currentYear = new Date().getFullYear()
const currentMonth = new Date().getMonth() + 1

type ActionState = { type: "accept" | "trash"; request: DemoRequest } | null

function StatusBadge({ status }: { status: DemoRequest["status"] }) {
  const config = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    trashed: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  }
  return <Badge className={cn("capitalize border-0", config[status])}>{status}</Badge>
}

function StatCard({
  title,
  value,
  hint,
  icon,
  color,
}: {
  title: string
  value: number
  hint: string
  icon: React.ReactNode
  color: string
}) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl text-white", color)}>{icon}</div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function RequestRow({ request, onAccept, onTrash }: { request: DemoRequest; onAccept: () => void; onTrash: () => void }) {
  const adminSummary = request.admins.map((admin) => admin.email).join(", ")
  return (
    <tr className="border-b border-border/60">
      <td className="px-4 py-4 align-top">
        <div className="space-y-1">
          <p className="font-semibold text-foreground">{request.school_name}</p>
          <p className="text-xs text-muted-foreground">#{request.request_number}{request.school_code ? ` | ${request.school_code}` : ""}</p>
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">{request.contact_email || "No contact email"}</p>
          <p className="text-xs text-muted-foreground line-clamp-2">{adminSummary || "No admins provided"}</p>
        </div>
      </td>
      <td className="px-4 py-4 align-top text-sm text-muted-foreground">{request.address || "No address provided"}</td>
      <td className="px-4 py-4 align-top"><StatusBadge status={request.status} /></td>
      <td className="px-4 py-4 align-top text-sm text-muted-foreground">{format(new Date(request.created_at), "dd MMM yyyy, hh:mm a")}</td>
      <td className="px-4 py-4 align-top">
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" className="whitespace-nowrap" disabled={request.status !== "pending"} onClick={onAccept}>
            Accept
          </Button>
          <Button size="sm" variant="destructive" className="whitespace-nowrap" disabled={request.status !== "pending"} onClick={onTrash}>
            Delete
          </Button>
        </div>
      </td>
    </tr>
  )
}

function RequestCard({ request, onAccept, onTrash }: { request: DemoRequest; onAccept: () => void; onTrash: () => void }) {
  const adminSummary = request.admins.map((admin) => admin.email).join(", ")
  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-semibold text-foreground">{request.school_name}</p>
          <p className="text-xs text-muted-foreground">#{request.request_number}{request.school_code ? ` | ${request.school_code}` : ""}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <p className="break-all text-foreground">{request.contact_email || "No contact email"}</p>
        <p className="text-muted-foreground">{request.address || "No address provided"}</p>
        <p className="break-all text-xs text-muted-foreground">{adminSummary || "No admins provided"}</p>
        <p className="text-xs text-muted-foreground">{format(new Date(request.created_at), "dd MMM yyyy, hh:mm a")}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button size="sm" disabled={request.status !== "pending"} onClick={onAccept}>Accept</Button>
        <Button size="sm" variant="destructive" disabled={request.status !== "pending"} onClick={onTrash}>Delete</Button>
      </div>
    </div>
  )
}

export function SADemoRequestsSection() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("pending")
  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState<number | "all">(currentMonth)
  const [page, setPage] = useState(1)
  const [actionState, setActionState] = useState<ActionState>(null)

  const listQuery = useDemoRequests(
    {
      page,
      pageSize: 20,
      search: search.trim() || undefined,
      status,
      year,
      month: month === "all" ? undefined : month,
    },
    true,
  )
  const statsQuery = useDemoRequestStats(year, month === "all" ? undefined : month, true)
  const acceptMutation = useAcceptDemoRequest()
  const trashMutation = useTrashDemoRequest()

  const availableYears = useMemo(() => {
    const raw = listQuery.data?.available_years?.length ? listQuery.data.available_years : statsQuery.data?.available_years
    return raw && raw.length > 0 ? raw : [currentYear]
  }, [listQuery.data?.available_years, statsQuery.data?.available_years])

  const chartData = useMemo(
    () =>
      (statsQuery.data?.months ?? []).map((item) => ({
        month: MONTH_LABELS[item.month - 1],
        requests: item.total,
      })),
    [statsQuery.data?.months],
  )

  const handlePasswordAction = async (password: string) => {
    if (!actionState) return
    if (actionState.type === "accept") {
      await acceptMutation.mutateAsync({ id: actionState.request.id, password })
    } else {
      await trashMutation.mutateAsync({ id: actionState.request.id, password })
    }
    setActionState(null)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/60 p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Demo Requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review inbound school demo leads, approve them into real schools, or move them to a 30-day trash window.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:items-center">
            <div className="relative min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search school or email" className="pl-10" />
            </div>
            <Select value={String(year)} onValueChange={(value) => { setYear(Number(value)); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Year" /></SelectTrigger>
              <SelectContent>
                {availableYears.map((item) => (
                  <SelectItem key={item} value={String(item)}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={month === "all" ? "all" : String(month)} onValueChange={(value) => { setMonth(value === "all" ? "all" : Number(value)); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All months</SelectItem>
                {MONTH_LABELS.map((label, index) => (
                  <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1) }}>
              <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="trashed">Trashed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Total" value={statsQuery.data?.total ?? 0} hint="matching current filter" icon={<Inbox className="h-6 w-6" />} color="bg-gradient-to-br from-slate-600 to-slate-800" />
        <StatCard title="Pending" value={statsQuery.data?.pending ?? 0} hint="awaiting review" icon={<Clock3 className="h-6 w-6" />} color="bg-gradient-to-br from-amber-500 to-orange-600" />
        <StatCard title="Accepted" value={statsQuery.data?.accepted ?? 0} hint="already provisioned" icon={<CheckCircle2 className="h-6 w-6" />} color="bg-gradient-to-br from-emerald-500 to-green-600" />
        <StatCard title="Trashed" value={statsQuery.data?.trashed ?? 0} hint="auto-delete after 30 days" icon={<Trash2 className="h-6 w-6" />} color="bg-gradient-to-br from-rose-500 to-red-600" />
      </div>

      <Card className="border-border/60 bg-card/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-indigo-500" />
            Monthly Lead Volume
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4 sm:px-4">
          {statsQuery.isLoading ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading chart...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320} minWidth={0}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/70" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: "rgba(99,102,241,0.08)" }}
                  contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                />
                <Bar dataKey="requests" fill="#4f46e5" radius={[8, 8, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-indigo-500" />
            Requests Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {listQuery.isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading requests...
            </div>
          ) : (listQuery.data?.requests.length ?? 0) === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 text-center">
              <ShieldAlert className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium text-foreground">No demo requests found</p>
              <p className="mt-1 text-sm text-muted-foreground">Try adjusting the month, year, search, or status filters.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {listQuery.data?.requests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    onAccept={() => setActionState({ type: "accept", request })}
                    onTrash={() => setActionState({ type: "trash", request })}
                  />
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">School</th>
                      <th className="px-4 py-3 font-semibold">Contact</th>
                      <th className="px-4 py-3 font-semibold">Address</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Received</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listQuery.data?.requests.map((request) => (
                      <RequestRow
                        key={request.id}
                        request={request}
                        onAccept={() => setActionState({ type: "accept", request })}
                        onTrash={() => setActionState({ type: "trash", request })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing page {listQuery.data?.page ?? 1} of {listQuery.data?.total_pages ?? 1} · {listQuery.data?.total ?? 0} total requests
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= (listQuery.data?.total_pages ?? 1)}
                    onClick={() => setPage((prev) => prev + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <PasswordPromptDialog
        open={!!actionState}
        onOpenChange={(open) => !open && setActionState(null)}
        onConfirm={handlePasswordAction}
        title={actionState?.type === "accept" ? "Accept Demo Request" : "Delete Demo Request"}
        description={
          actionState?.type === "accept"
            ? `This will provision "${actionState?.request.school_name ?? "this school"}" using the stored demo details.`
            : `This will move "${actionState?.request.school_name ?? "this request"}" to trash for exactly 30 days before permanent deletion.`
        }
        actionLabel={actionState?.type === "accept" ? "Accept & Create School" : "Move To Trash"}
        actionVariant={actionState?.type === "accept" ? "default" : "destructive"}
        warningMessage={
          actionState?.type === "trash"
            ? "This is password protected. Trashed demo requests are retained for 30 days and then deleted permanently by the backend cleanup job."
            : undefined
        }
      />
    </div>
  )
}

export default SADemoRequestsSection
