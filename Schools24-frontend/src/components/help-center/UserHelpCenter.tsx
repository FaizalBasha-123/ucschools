"use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  HelpCircle,
  Plus,
  TicketCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  MessagesSquare,
  RefreshCw,
} from 'lucide-react'
import { useMyTickets, useCreateTicket } from '@/hooks/useSupport'
import { SupportTicket } from '@/services/supportService'
import { format } from 'date-fns'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  open:        { label: 'Open',        color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',    icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <MessagesSquare className="h-3 w-3" /> },
  resolved:    { label: 'Resolved',    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: <CheckCircle2 className="h-3 w-3" /> },
  closed:      { label: 'Closed',      color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',   icon: <XCircle className="h-3 w-3" /> },
}

const PRIORITY_CONFIG: Record<string, string> = {
  low:      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  medium:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_CONFIG[priority] ?? ''}`}>
      {priority}
    </span>
  )
}

function TicketCard({ ticket }: { ticket: SupportTicket }) {
  return (
    <div className="rounded-xl border border-border/60 p-4 hover:border-border transition-colors bg-card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-muted-foreground">#{ticket.ticket_number}</span>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <p className="font-semibold text-sm truncate">{ticket.subject}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs capitalize">{ticket.category}</Badge>
      </div>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{ticket.description}</p>
      {ticket.admin_notes && (
        <div className="rounded-lg bg-muted/50 px-3 py-2 mb-3 text-sm">
          <span className="font-medium text-xs uppercase tracking-wide text-muted-foreground block mb-1">Support Reply</span>
          {ticket.admin_notes}
          {ticket.resolved_by_name && (
            <span className="block text-xs text-muted-foreground mt-1">— {ticket.resolved_by_name}</span>
          )}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Submitted {format(new Date(ticket.created_at), 'MMM d, yyyy · h:mm a')}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UserHelpCenter() {
  const [activeTab, setActiveTab] = useState<'new' | 'mine'>('new')
  const [page, setPage] = useState(1)

  // Form state
  const [subject, setSubject]       = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory]     = useState('general')
  const [priority, setPriority]     = useState('medium')

  const { data: ticketsData, isLoading: loadingTickets, refetch } = useMyTickets(page, 10)
  const createMutation = useCreateTicket()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !description.trim()) return
    await createMutation.mutateAsync({ subject, description, category, priority })
    setSubject('')
    setDescription('')
    setCategory('general')
    setPriority('medium')
    setActiveTab('mine')
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <HelpCircle className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Help Center</h1>
          <p className="text-sm text-muted-foreground">Submit a support request or track your existing tickets.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'new' | 'mine')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="new" className="gap-2">
            <Plus className="h-4 w-4" /> New Ticket
          </TabsTrigger>
          <TabsTrigger value="mine" className="gap-2">
            <TicketCheck className="h-4 w-4" /> My Tickets
            {ticketsData && ticketsData.total > 0 && (
              <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px]">
                {ticketsData.total}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        {/* New Ticket Tab                                                    */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="new">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Create Support Ticket</CardTitle>
              <CardDescription>
                Describe your issue and our support team will get back to you as soon as possible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="subject">Subject <span className="text-destructive">*</span></Label>
                  <Input
                    id="subject"
                    placeholder="Brief summary of your issue…"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    minLength={5}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="category">Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger id="category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="technical">Technical</SelectItem>
                        <SelectItem value="billing">Billing</SelectItem>
                        <SelectItem value="academic">Academic</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger id="priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="description"
                    placeholder="Explain the issue in detail. Include steps to reproduce if applicable…"
                    rows={5}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    minLength={10}
                    required
                  />
                  <p className="text-xs text-muted-foreground">{description.length} characters</p>
                </div>

                <Separator />

                <div className="flex justify-end">
                  <Button type="submit" disabled={createMutation.isPending} className="gap-2">
                    {createMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                    ) : (
                      <><Plus className="h-4 w-4" /> Submit Ticket</>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* My Tickets Tab                                                    */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="mine">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {ticketsData ? `${ticketsData.total} ticket${ticketsData.total !== 1 ? 's' : ''}` : ''}
              </p>
              <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1.5 h-8">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>

            {loadingTickets ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !ticketsData?.tickets.length ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <AlertCircle className="h-10 w-10 text-muted-foreground/40" />
                  <p className="font-medium">No tickets yet</p>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    You haven&apos;t submitted any support tickets. Use the &quot;New Ticket&quot; tab to get help.
                  </p>
                  <Button variant="outline" onClick={() => setActiveTab('new')} className="mt-2 gap-2">
                    <Plus className="h-4 w-4" /> Create First Ticket
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="space-y-3">
                  {ticketsData.tickets.map((t) => (
                    <TicketCard key={t.id} ticket={t} />
                  ))}
                </div>

                {/* Pagination */}
                {ticketsData.total_pages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <Button
                      variant="outline" size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >Prev</Button>
                    <span className="text-sm text-muted-foreground">
                      {page} / {ticketsData.total_pages}
                    </span>
                    <Button
                      variant="outline" size="sm"
                      disabled={page >= ticketsData.total_pages}
                      onClick={() => setPage((p) => p + 1)}
                    >Next</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
