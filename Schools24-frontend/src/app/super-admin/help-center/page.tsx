"use client"

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
import { Separator } from '@/components/ui/separator'
import {
  Ticket,
  Search,
  Loader2,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Clock,
  MessagesSquare,
  XCircle,
  AlertCircle,
  User,
  Mail,
  Building2,
  Tag,
  CalendarDays,
  Shield,
} from 'lucide-react'
import { useTicketList, useUpdateTicketStatus, useDeleteTicket } from '@/hooks/useSupport'
import { useSupportWS } from '@/hooks/useSupportWS'
import { SupportTicket } from '@/services/supportService'
import { format } from 'date-fns'
import { useDebounce } from '@/hooks/useDebounce'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: '__all', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

const CATEGORY_OPTIONS = [
  { value: '__all', label: 'All Categories' },
  { value: 'general', label: 'General' },
  { value: 'technical', label: 'Technical' },
  { value: 'billing', label: 'Billing' },
  { value: 'academic', label: 'Academic' },
  { value: 'other', label: 'Other' },
]

const LABEL_OPTIONS = [
  { value: '__all',        label: 'All Portals' },
  { value: 'landing',      label: 'Landing Page' },
  { value: 'student',      label: 'Student' },
  { value: 'teacher',      label: 'Teacher' },
  { value: 'school_admin', label: 'School Admin' },
  { value: 'super_admin',  label: 'Super Admin' },
  { value: 'other',        label: 'Other' },
]

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    open:        { label: 'Open',        color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',    icon: <Clock className="h-3 w-3" /> },
    in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <MessagesSquare className="h-3 w-3" /> },
    resolved:    { label: 'Resolved',    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: <CheckCircle2 className="h-3 w-3" /> },
    closed:      { label: 'Closed',      color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',   icon: <XCircle className="h-3 w-3" /> },
  }
  const cfg = map[status] ?? map.open
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    low:      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    medium:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[priority] ?? ''}`}>
      {priority}
    </span>
  )
}

function UserTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    admin:       'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    teacher:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    student:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    staff:       'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    super_admin: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    public:      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[type] ?? ''}`}>
      <Shield className="h-3 w-3" /> {type.replace('_', ' ')}
    </span>
  )
}

function LabelBadge({ label }: { label: string }) {
  const map: Record<string, { text: string; color: string }> = {
    landing:      { text: 'Landing',      color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
    student:      { text: 'Student',      color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
    teacher:      { text: 'Teacher',      color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    school_admin: { text: 'School Admin', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
    super_admin:  { text: 'Super Admin',  color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
    other:        { text: 'Other',        color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  }
  const cfg = map[label] ?? map.other
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>
      {cfg.text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Ticket Detail Dialog
// ---------------------------------------------------------------------------

function TicketDetailDialog({
  ticket,
  open,
  onClose,
}: {
  ticket: SupportTicket | null
  open: boolean
  onClose: () => void
}) {
  const [newStatus, setNewStatus]     = useState('')
  const [adminNotes, setAdminNotes]   = useState('')
  const [deleteOpen, setDeleteOpen]   = useState(false)

  const updateMutation = useUpdateTicketStatus()
  const deleteMutation = useDeleteTicket()

  // Sync form when ticket changes
  const initForm = (t: SupportTicket) => {
    setNewStatus(t.status)
    setAdminNotes(t.admin_notes ?? '')
  }

  if (!ticket) return null

  const handleOpen = () => initForm(ticket)

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      id: ticket.id,
      payload: { status: newStatus, admin_notes: adminNotes || undefined },
    })
    onClose()
  }

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(ticket.id)
    setDeleteOpen(false)
    onClose()
  }
  const canDeleteTicket = ticket.status === 'closed'

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }} >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onOpenAutoFocus={() => handleOpen()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5" />
              Ticket #{ticket.ticket_number}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-2 pt-1">
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <Badge variant="outline" className="capitalize text-xs">{ticket.category}</Badge>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Submitter info */}
            <div className="rounded-xl border border-border/60 p-4 space-y-3 bg-muted/30">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submitted By</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{ticket.user_name}</span>
                </div>
                <UserTypeBadge type={ticket.user_type} />
                <div className="flex items-center gap-2 col-span-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{ticket.user_email}</span>
                </div>
                {ticket.school_name && (
                  <div className="flex items-center gap-2 col-span-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{ticket.school_name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {format(new Date(ticket.created_at), 'MMM d, yyyy · h:mm a')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <LabelBadge label={ticket.label} />
                </div>
              </div>
            </div>

            {/* Ticket content */}
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <Tag className="h-3 w-3" /> Subject
                </div>
                <p className="font-semibold">{ticket.subject}</p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Description</div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
              </div>
            </div>

            <Separator />

            {/* Resolution form */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold">Update Ticket</h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-notes">
                  Resolution Notes
                  <span className="text-muted-foreground font-normal ml-1">(visible to submitter)</span>
                </Label>
                <Textarea
                  id="admin-notes"
                  placeholder="Explain how the issue was resolved or provide guidance…"
                  rows={4}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            {canDeleteTicket ? (
              <Button
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
                className="gap-1.5 sm:mr-auto"
                disabled={updateMutation.isPending}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : (
              <p className="sm:mr-auto text-xs text-muted-foreground">
                Mark ticket as <span className="font-semibold">Closed</span> to enable delete.
              </p>
            )}
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-1.5">
              {updateMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle2 className="h-4 w-4" /> Save Changes</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              Ticket #{ticket.ticket_number} will be permanently deleted and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function SAHelpCenterSection() {

  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState('')
  const [category, setCategory] = useState('')
  const [label, setLabel]       = useState('')
  const [page, setPage]         = useState(1)
  const [selected, setSelected] = useState<SupportTicket | null>(null)

  // Real-time ticket updates via Gorilla WebSocket
  useSupportWS(true)

  const debouncedSearch = useDebounce(search, 350)

  const { data, isLoading, refetch } = useTicketList({
    page,
    page_size: 20,
    status:    status || undefined,
    category:  category || undefined,
    label:     label || undefined,
    search:    debouncedSearch || undefined,
  })

  // Quick stat totals from current data (always fetched without filters for real counts)
  const { data: allData } = useTicketList({ page: 1, page_size: 1 })
  const { data: openData }  = useTicketList({ page: 1, page_size: 1, status: 'open' })
  const { data: ipData }    = useTicketList({ page: 1, page_size: 1, status: 'in_progress' })
  const { data: resData }   = useTicketList({ page: 1, page_size: 1, status: 'resolved' })

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
  }

  return (
    <>
          <div className="max-w-[1400px] mx-auto space-y-6">
            {/* Section header */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                  <Ticket className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Help Center</h2>
                  <p className="text-sm text-muted-foreground">Manage and resolve user support tickets.</p>
                </div>
              </div>
              <Button
                variant="ghost" size="sm"
                onClick={() => refetch()}
                className="gap-1.5 h-8"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total',       value: allData?.total ?? 0, color: 'text-foreground',                   bg: 'bg-muted/40' },
                { label: 'Open',        value: openData?.total ?? 0, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30' },
                { label: 'In Progress', value: ipData?.total ?? 0,   color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
                { label: 'Resolved',    value: resData?.total ?? 0,  color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/30' },
              ].map((s) => (
                <Card key={s.label} className={`${s.bg} border-0 shadow-none`}>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{s.label}</p>
                    <p className={`text-3xl font-black mt-1 ${s.color}`}>{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by subject, name, email or school…"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={label || '__all'} onValueChange={(v) => { setLabel(v === '__all' ? '' : v); setPage(1) }}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All Portals" />
                </SelectTrigger>
                <SelectContent>
                  {LABEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status || '__all'} onValueChange={(v) => { setStatus(v === '__all' ? '' : v); setPage(1) }}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={category || '__all'} onValueChange={(v) => { setCategory(v === '__all' ? '' : v); setPage(1) }}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            <Card>
              <CardHeader className="pb-0 px-4 pt-4">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {data ? `${data.total} ticket${data.total !== 1 ? 's' : ''}` : ' '}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : !data?.tickets.length ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                    <AlertCircle className="h-10 w-10 text-muted-foreground/40" />
                    <p className="font-medium">No tickets found</p>
                    <p className="text-sm text-muted-foreground">
                      {search || status || category
                        ? 'Try adjusting your filters.'
                        : 'No support tickets have been submitted yet.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50">
                            {['#', 'Portal', 'Submitter', 'School', 'Subject', 'Category', 'Priority', 'Status', 'Date'].map((h) => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {data.tickets.map((t) => (
                            <tr
                              key={t.id}
                              onClick={() => setSelected(t)}
                              className="hover:bg-muted/40 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{t.ticket_number}</td>
                              <td className="px-4 py-3">
                                <LabelBadge label={t.label} />
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium truncate max-w-[140px]">{t.user_name}</div>
                                <div className="text-xs text-muted-foreground truncate max-w-[140px]">{t.user_email}</div>
                              </td>
                              <td className="px-4 py-3 text-muted-foreground text-xs max-w-[120px] truncate">
                                {t.school_name ?? '—'}
                              </td>
                              <td className="px-4 py-3 max-w-[200px]">
                                <p className="truncate font-medium">{t.subject}</p>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="outline" className="capitalize text-xs">{t.category}</Badge>
                              </td>
                              <td className="px-4 py-3">
                                <PriorityBadge priority={t.priority} />
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={t.status} />
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                {format(new Date(t.created_at), 'MMM d, yyyy')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden divide-y divide-border/30">
                      {data.tickets.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => setSelected(t)}
                          className="px-4 py-3 hover:bg-muted/40 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="font-mono text-xs text-muted-foreground">#{t.ticket_number}</span>
                            <StatusBadge status={t.status} />
                          </div>
                          <p className="font-medium text-sm truncate">{t.subject}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <LabelBadge label={t.label} />
                            <span className="text-xs text-muted-foreground">{t.user_name}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Pagination */}
                    {data.total_pages > 1 && (
                      <div className="flex items-center justify-center gap-2 p-4 border-t border-border/30">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                          Prev
                        </Button>
                        <span className="text-sm text-muted-foreground">{page} / {data.total_pages}</span>
                        <Button variant="outline" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>
                          Next
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

      {/* Ticket detail dialog */}
      <TicketDetailDialog
        ticket={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Standalone page wrapper (direct /super-admin/help-center navigation)
// ---------------------------------------------------------------------------

export default function SuperAdminHelpCenterPage() {
  return <SAHelpCenterSection />
}
