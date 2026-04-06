"use client"

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Search, BookOpen, CheckCircle2, Clock, AlertTriangle, CalendarDays,
    Star, FileText, StickyNote, ChevronDown, ChevronUp,
    TrendingUp, Filter, BookOpenCheck, CircleDot,
    CheckCheck, XCircle, Pencil, Save, X, BarChart3, Loader2, Eye, Download
} from 'lucide-react'
import { toast } from 'sonner'

// ── Backend API types ─────────────────────────────────────────────
interface BackendHomework {
    id: string
    title: string
    description?: string
    subject_name?: string
    teacher_name?: string
    due_date: string
    max_marks: number
    is_submitted?: boolean
    submission?: { id: string; status: string; submitted_at: string }
    attachment_details?: { id: string; file_name: string; file_size: number; mime_type: string }[]
}

// ── UI model ──────────────────────────────────────────────────────
interface HomeworkItem {
    id: string
    title: string
    subject: string
    description: string
    dueDate: string
    assignedBy: string
    maxMarks: number
    status: 'pending' | 'completed' | 'overdue'
    priority: 'low' | 'medium' | 'high'
    attachments: number
    attachmentDetails: { id: string; file_name: string; file_size: number; mime_type: string }[]
    notes: string
}

// ── Mapper ────────────────────────────────────────────────────────
function mapToUI(hw: BackendHomework, notes: string): HomeworkItem {
    const due = new Date(hw.due_date)
    const now = new Date()
    const isSubmitted = hw.is_submitted === true

    let status: HomeworkItem['status']
    if (isSubmitted) {
        status = 'completed'
    } else if (!isNaN(due.getTime()) && due < now) {
        status = 'overdue'
    } else {
        status = 'pending'
    }

    let priority: HomeworkItem['priority']
    if (status === 'completed') {
        priority = 'low'
    } else {
        const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        priority = daysLeft <= 1 ? 'high' : daysLeft <= 4 ? 'medium' : 'low'
    }

    return {
        id: hw.id,
        title: hw.title,
        subject: hw.subject_name || 'General',
        description: hw.description || '',
        dueDate: hw.due_date,
        assignedBy: hw.teacher_name || 'Teacher',
        maxMarks: hw.max_marks,
        status,
        priority,
        attachments: hw.attachment_details?.length ?? 0,
        attachmentDetails: hw.attachment_details ?? [],
        notes,
    }
}

// ── Helpers ───────────────────────────────────────────────────────
function daysUntilDue(dueDate: string) {
    const due = new Date(dueDate)
    const now = new Date()
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function getDueLabel(dueDate: string, status: string) {
    if (status === 'completed') return 'Completed'
    const days = daysUntilDue(dueDate)
    if (days < 0) return `Overdue by ${Math.abs(days)}d`
    if (days === 0) return 'Due today!'
    if (days === 1) return 'Due tomorrow'
    return `${days} days left`
}

function getDueColor(dueDate: string, status: string): string {
    if (status === 'completed') return 'text-green-600 dark:text-green-400'
    const days = daysUntilDue(dueDate)
    if (days < 0) return 'text-red-600 dark:text-red-400'
    if (days <= 1) return 'text-orange-600 dark:text-orange-400'
    if (days <= 3) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-blue-600 dark:text-blue-400'
}

// ── Subject colour map ────────────────────────────────────────────
const subjectColors: Record<string, { gradient: string; bg: string; text: string; border: string; icon: string }> = {
    Mathematics:      { gradient: 'from-blue-500 to-indigo-600',   bg: 'from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30',     text: 'text-blue-700 dark:text-blue-300',     border: 'hover:border-blue-300',    icon: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' },
    Physics:          { gradient: 'from-cyan-500 to-teal-600',     bg: 'from-cyan-50 to-teal-50 dark:from-cyan-950/30 dark:to-teal-950/30',         text: 'text-cyan-700 dark:text-cyan-300',     border: 'hover:border-cyan-300',    icon: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900 dark:text-cyan-300' },
    Chemistry:        { gradient: 'from-purple-500 to-fuchsia-600',bg: 'from-purple-50 to-fuchsia-50 dark:from-purple-950/30 dark:to-fuchsia-950/30',text: 'text-purple-700 dark:text-purple-300', border: 'hover:border-purple-300', icon: 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300' },
    English:          { gradient: 'from-emerald-500 to-green-600', bg: 'from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30', text: 'text-emerald-700 dark:text-emerald-300',border: 'hover:border-emerald-300',icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-300' },
    History:          { gradient: 'from-amber-500 to-orange-600',  bg: 'from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30',   text: 'text-amber-700 dark:text-amber-300',   border: 'hover:border-amber-300',   icon: 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300' },
    Hindi:            { gradient: 'from-rose-500 to-pink-600',     bg: 'from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30',         text: 'text-rose-700 dark:text-rose-300',     border: 'hover:border-rose-300',    icon: 'bg-rose-100 text-rose-600 dark:bg-rose-900 dark:text-rose-300' },
    Science:          { gradient: 'from-teal-500 to-cyan-600',     bg: 'from-teal-50 to-cyan-50 dark:from-teal-950/30 dark:to-cyan-950/30',         text: 'text-teal-700 dark:text-teal-300',     border: 'hover:border-teal-300',    icon: 'bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300' },
    'Social Studies': { gradient: 'from-orange-500 to-red-600',    bg: 'from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30',       text: 'text-orange-700 dark:text-orange-300', border: 'hover:border-orange-300', icon: 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300' },
    'Computer Science':{ gradient: 'from-violet-500 to-indigo-600',bg: 'from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30', text: 'text-violet-700 dark:text-violet-300', border: 'hover:border-violet-300', icon: 'bg-violet-100 text-violet-600 dark:bg-violet-900 dark:text-violet-300' },
}

const fallbackPalettes = [
    { gradient: 'from-gray-500 to-slate-600',  bg: 'from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30',   text: 'text-gray-700 dark:text-gray-300',   border: 'hover:border-gray-300',  icon: 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300' },
    { gradient: 'from-lime-500 to-green-600',  bg: 'from-lime-50 to-green-50 dark:from-lime-950/30 dark:to-green-950/30',   text: 'text-lime-700 dark:text-lime-300',   border: 'hover:border-lime-300',  icon: 'bg-lime-100 text-lime-600 dark:bg-lime-900 dark:text-lime-300' },
    { gradient: 'from-sky-500 to-blue-600',    bg: 'from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/30',       text: 'text-sky-700 dark:text-sky-300',     border: 'hover:border-sky-300',   icon: 'bg-sky-100 text-sky-600 dark:bg-sky-900 dark:text-sky-300' },
]

function getSubjectColor(subject: string) {
    if (subjectColors[subject]) return subjectColors[subject]
    let hash = 0
    for (const c of subject) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
    return fallbackPalettes[hash % fallbackPalettes.length]
}

// ── Page ──────────────────────────────────────────────────────────
export default function StudentHomeworkPage() {
    const queryClient = useQueryClient()

    // local notes – not persisted; backend has no notes field
    const [notesMap,       setNotesMap]       = useState<Record<string, string>>({})
    const [searchQuery,    setSearchQuery]    = useState('')
    const [selectedSubject,setSelectedSubject]= useState('all')
    const [selectedStatus, setSelectedStatus] = useState<'all' | 'pending' | 'completed' | 'overdue'>('all')
    const [expandedCard,   setExpandedCard]   = useState<string | null>(null)
    const [editingNotes,   setEditingNotes]   = useState<string | null>(null)
    const [notesDraft,     setNotesDraft]     = useState('')
    const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false)
    const [previewTitle, setPreviewTitle] = useState('')
    const [previewMimeType, setPreviewMimeType] = useState('')
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [previewLoading, setPreviewLoading] = useState(false)

    // ── Fetch ─────────────────────────────────────────────────────
    const { data, isLoading } = useQuery({
        queryKey: ['student-homework'],
        queryFn: () => api.getOrEmpty<{ homework: BackendHomework[] }>('/academic/homework?status=all', { homework: [] }),
    })

    const homework: HomeworkItem[] = useMemo(
        () => (data?.homework ?? []).map(hw => mapToUI(hw, notesMap[hw.id] ?? '')),
        [data, notesMap],
    )

    // ── Submit mutation ───────────────────────────────────────────
    const submitMutation = useMutation({
        mutationFn: ({ id, submissionText }: { id: string; submissionText: string }) =>
            api.post(`/academic/homework/${id}/submit`, { submission_text: submissionText, attachments: [] }),
        onSuccess: (_data, variables) => {
            const hw = homework.find(h => h.id === variables.id)
            toast.success('Homework marked as done!', { description: hw?.title })
            queryClient.invalidateQueries({ queryKey: ['student-homework'] })
        },
        onError: (err: unknown) => {
            toast.error('Could not mark as done', {
                description: err instanceof Error ? err.message : 'Please try again',
            })
        },
    })

    const toggleStatus = (hw: HomeworkItem) => {
        if (hw.status === 'completed') {
            toast.info('Already submitted', { description: hw.title })
            return
        }
        const note = notesMap[hw.id]?.trim() || hw.notes?.trim() || `Completed: ${hw.title}`
        submitMutation.mutate({ id: hw.id, submissionText: note })
    }

    const saveNotes = (id: string) => {
        setNotesMap(prev => ({ ...prev, [id]: notesDraft }))
        setEditingNotes(null)
        toast.success('Notes saved!')
    }

    const startEditNotes = (id: string, current: string) => {
        setEditingNotes(id)
        setNotesDraft(current)
    }

    // ── Derived state ─────────────────────────────────────────────
    const subjects = useMemo(() => {
        const s = Array.from(new Set(homework.map(h => h.subject))).sort()
        return ['All', ...s]
    }, [homework])

    const selectedSubjectLabel = selectedSubject === 'all' ? 'Select subject' : selectedSubject

    const fetchAttachmentBlob = async (homeworkID: string, attachmentID: string, action: 'view' | 'download') => {
        return api.fetchBlob(`/academic/homework/${homeworkID}/attachments/${attachmentID}/${action}`)
    }

    const handlePreviewAttachment = async (homeworkID: string, attachment: { id: string; file_name: string; file_size: number; mime_type: string }) => {
        setPreviewLoading(true)
        try {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            const blob = await fetchAttachmentBlob(homeworkID, attachment.id, 'view')
            const url = URL.createObjectURL(blob)
            setPreviewUrl(url)
            setPreviewTitle(attachment.file_name)
            setPreviewMimeType(attachment.mime_type || blob.type)
            setIsPreviewOpen(true)
        } catch (error) {
            toast.error('Unable to preview attachment', {
                description: error instanceof Error ? error.message : 'Please try again',
            })
        } finally {
            setPreviewLoading(false)
        }
    }

    const handleDownloadAttachment = async (homeworkID: string, attachment: { id: string; file_name: string; file_size: number; mime_type: string }) => {
        try {
            const blob = await fetchAttachmentBlob(homeworkID, attachment.id, 'download')
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = attachment.file_name || 'attachment'
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
        } catch (error) {
            toast.error('Unable to download attachment', {
                description: error instanceof Error ? error.message : 'Please try again',
            })
        }
    }

    const filtered = useMemo(() => {
        return homework
            .filter(h => {
                const q = searchQuery.toLowerCase()
                const matchSearch = h.title.toLowerCase().includes(q) || h.subject.toLowerCase().includes(q) || h.description.toLowerCase().includes(q)
                const matchSubject = selectedSubject === 'all' || h.subject === selectedSubject
                const matchStatus  = selectedStatus  === 'all' || h.status  === selectedStatus
                return matchSearch && matchSubject && matchStatus
            })
            .sort((a, b) => {
                const order = { overdue: 0, pending: 1, completed: 2 }
                if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
                return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
            })
    }, [homework, searchQuery, selectedSubject, selectedStatus])

    const totalCount      = homework.length
    const completedCount  = homework.filter(h => h.status === 'completed').length
    const pendingCount    = homework.filter(h => h.status === 'pending').length
    const overdueCount    = homework.filter(h => h.status === 'overdue').length
    const completionRate  = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

    const subjectProgress = useMemo(() => {
        const map: Record<string, { total: number; completed: number }> = {}
        homework.forEach(h => {
            if (!map[h.subject]) map[h.subject] = { total: 0, completed: 0 }
            map[h.subject].total++
            if (h.status === 'completed') map[h.subject].completed++
        })
        return Object.entries(map)
            .map(([subject, d]) => ({ subject, ...d, percent: Math.round((d.completed / d.total) * 100) }))
            .sort((a, b) => b.percent - a.percent)
    }, [homework])

    // ── Loading ───────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        )
    }

    // ── Render ────────────────────────────────────────────────────
    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 bg-clip-text text-transparent">
                        My Homework
                    </h1>
                    <p className="text-muted-foreground">Track, submit, and manage all your homework assignments</p>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid gap-4 grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                {[
                    { icon: <BookOpen className="h-7 w-7" />, value: totalCount,     label: 'Total',      from: 'from-blue-500',   to: 'to-indigo-600',  shadow: 'shadow-blue-500/30',   valueColor: 'text-blue-700 dark:text-blue-400',     bg: 'from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50'   },
                    { icon: <CheckCircle2 className="h-7 w-7" />, value: completedCount, label: 'Done',   from: 'from-green-500',  to: 'to-emerald-600', shadow: 'shadow-green-500/30',  valueColor: 'text-green-700 dark:text-green-400',   bg: 'from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50' },
                    { icon: <Clock className="h-7 w-7" />,       value: pendingCount,   label: 'Pending', from: 'from-yellow-500', to: 'to-amber-600',   shadow: 'shadow-yellow-500/30', valueColor: 'text-yellow-700 dark:text-yellow-400', bg: 'from-yellow-50 to-amber-50 dark:from-yellow-950/50 dark:to-amber-950/50'   },
                    { icon: <AlertTriangle className="h-7 w-7" />,value: overdueCount,  label: 'Overdue', from: 'from-red-500',    to: 'to-rose-600',    shadow: 'shadow-red-500/30',    valueColor: 'text-red-700 dark:text-red-400',       bg: 'from-red-50 to-rose-50 dark:from-red-950/50 dark:to-rose-950/50'           },
                    { icon: <TrendingUp className="h-7 w-7" />,  value: `${completionRate}%`, label: 'Completion', from: 'from-violet-500', to: 'to-purple-600', shadow: 'shadow-violet-500/30', valueColor: 'text-violet-700 dark:text-violet-400', bg: 'from-violet-50 to-purple-50 dark:from-violet-950/50 dark:to-purple-950/50' },
                ].map(({ icon, value, label, from, to, shadow, valueColor, bg }) => (
                    <Card key={label} className={`border-0 shadow-lg bg-gradient-to-br ${bg} overflow-hidden`}>
                        <CardContent className="p-4 md:p-6 relative">
                            <div className={`absolute top-0 right-0 w-20 h-20 ${from.replace('from-', 'bg-').replace('500', '500/10')} rounded-full -translate-y-10 translate-x-10`} />
                            <div className="flex items-center gap-4">
                                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${from} ${to} text-white shadow-lg ${shadow}`}>
                                    {icon}
                                </div>
                                <div>
                                    <p className={`text-xl md:text-3xl font-bold ${valueColor}`}>{value}</p>
                                    <p className="text-sm text-muted-foreground">{label}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Subject Progress */}
            {subjectProgress.length > 0 && (
                <Card className="border-0 shadow-lg overflow-hidden">
                    <CardContent className="p-4 md:p-6">
                        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                            {subjectProgress.map(sp => {
                                const colors = getSubjectColor(sp.subject)
                                return (
                                    <div key={sp.subject} className={`p-4 rounded-2xl bg-gradient-to-br ${colors.bg} border-2 border-transparent ${colors.border} transition-all duration-300`}>
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.icon}`}>
                                                    <BookOpenCheck className="h-4 w-4" />
                                                </div>
                                                <span className="font-semibold">{sp.subject}</span>
                                            </div>
                                            <span className={`text-sm font-bold ${colors.text}`}>{sp.completed}/{sp.total}</span>
                                        </div>
                                        <Progress value={sp.percent} className="h-3" />
                                        <p className="text-xs text-muted-foreground mt-2">{sp.percent}% completed</p>
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Search & Filters */}
            <Card className="border-0 shadow-lg">
                <CardContent className="p-4 md:p-6">
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 w-full">
                            <div className="relative flex-1 min-w-0">
                                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Search homework..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="pl-12 h-11 sm:h-12 rounded-xl border-2 focus:border-orange-500"
                                />
                            </div>
                            <Button
                                variant="outline"
                                onClick={() => setIsSubjectDialogOpen(true)}
                                className="h-11 sm:h-12 rounded-xl border-2 shrink-0 whitespace-nowrap"
                            >
                                <BookOpen className="h-4 w-4 mr-2" />
                                {selectedSubjectLabel}
                            </Button>
                        </div>

                        <div className="overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                            <div className="flex items-center gap-2 w-max">
                                {(['all', 'pending', 'completed', 'overdue'] as const).map(st => {
                                    const isActive = selectedStatus === st
                                    const icons: Record<string, React.ReactNode> = {
                                        all: <Filter className="h-3.5 w-3.5 mr-1" />,
                                        pending: <Clock className="h-3.5 w-3.5 mr-1" />,
                                        completed: <CheckCheck className="h-3.5 w-3.5 mr-1" />,
                                        overdue: <XCircle className="h-3.5 w-3.5 mr-1" />,
                                    }
                                    return (
                                        <Button
                                            key={st}
                                            variant={isActive ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => setSelectedStatus(st)}
                                            className={`rounded-full px-3 text-xs shrink-0 ${isActive ? 'bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 border-0' : ''}`}
                                        >
                                            {icons[st]}{st.charAt(0).toUpperCase() + st.slice(1)}
                                        </Button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isSubjectDialogOpen} onOpenChange={setIsSubjectDialogOpen}>
                <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Select subject</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                        {subjects.map(subject => {
                            const subjectValue = subject === 'All' ? 'all' : subject
                            const isActive = selectedSubject === subjectValue
                            return (
                                <Button
                                    key={subject}
                                    variant={isActive ? 'default' : 'outline'}
                                    onClick={() => {
                                        setSelectedSubject(subjectValue)
                                        setIsSubjectDialogOpen(false)
                                    }}
                                    className={isActive ? 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 border-0' : ''}
                                >
                                    {subject}
                                </Button>
                            )
                        })}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Homework List */}
            <div className="space-y-4">
                {filtered.length === 0 && (
                    <Card className="border-0 shadow-lg">
                        <CardContent className="p-12 text-center">
                            <Search className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                            <h3 className="text-xl font-bold mb-2">No homework found</h3>
                            <p className="text-muted-foreground mb-4">Try adjusting your search or filter criteria</p>
                            <Button variant="outline" onClick={() => { setSearchQuery(''); setSelectedSubject('all'); setSelectedStatus('all') }}>
                                Clear Filters
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {filtered.map(hw => {
                    const colors       = getSubjectColor(hw.subject)
                    const isExpanded   = expandedCard === hw.id
                    const isEditingNote= editingNotes === hw.id
                    const isSubmitting = submitMutation.isPending && submitMutation.variables?.id === hw.id

                    return (
                        <Card
                            key={hw.id}
                            className={`border-2 border-transparent transition-all duration-300 hover:shadow-xl ${colors.border} bg-gradient-to-br ${colors.bg} ${hw.status === 'completed' ? 'opacity-80' : ''}`}
                        >
                            <CardContent className="p-4 md:p-6">
                                {/* Main Row */}
                                <div className="overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                                    <div className="flex items-center gap-4 min-w-[860px] md:min-w-0 md:flex-wrap">
                                        {/* Done circle */}
                                        <button
                                            onClick={() => toggleStatus(hw)}
                                            disabled={isSubmitting}
                                            title={hw.status === 'completed' ? 'Already submitted' : 'Mark as done'}
                                            className={`flex-shrink-0 flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 disabled:opacity-60
                                                ${hw.status === 'completed'
                                                    ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30 scale-110'
                                                    : hw.status === 'overdue'
                                                        ? 'bg-gradient-to-br from-red-100 to-rose-100 text-red-500 dark:from-red-900/50 dark:to-rose-900/50 dark:text-red-400 hover:from-green-500 hover:to-emerald-600 hover:text-white hover:shadow-green-500/30 hover:shadow-lg'
                                                        : 'bg-gradient-to-br from-gray-100 to-slate-100 text-gray-400 dark:from-gray-800 dark:to-slate-800 dark:text-gray-500 hover:from-green-500 hover:to-emerald-600 hover:text-white hover:shadow-green-500/30 hover:shadow-lg'
                                                }`}
                                        >
                                            {isSubmitting
                                                ? <Loader2 className="h-6 w-6 animate-spin" />
                                                : hw.status === 'completed'
                                                    ? <CheckCheck className="h-6 w-6" />
                                                    : <CircleDot className="h-6 w-6" />
                                            }
                                        </button>

                                        {/* Subject icon */}
                                        <div className={`flex-shrink-0 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${colors.gradient} text-white shadow-lg`}>
                                            <BookOpen className="h-6 w-6" />
                                        </div>

                                        {/* Text */}
                                        <div className="flex-1 min-w-[420px]">
                                            <div className="flex items-center gap-2 mb-1 whitespace-nowrap">
                                                <h3 className={`font-bold text-lg ${hw.status === 'completed' ? 'line-through opacity-70' : ''}`}>
                                                    {hw.title}
                                                </h3>
                                                <Badge className={`${colors.icon} border-0`}>{hw.subject}</Badge>
                                                {hw.status === 'overdue' && (
                                                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-0 animate-pulse">Overdue</Badge>
                                                )}
                                                {hw.status === 'completed' && (
                                                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0">✓ Done</Badge>
                                                )}
                                                {hw.priority === 'high' && hw.status !== 'completed' && (
                                                    <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-0">
                                                        <Star className="h-3 w-3 mr-1 fill-orange-500 text-orange-500" />High Priority
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-muted-foreground whitespace-nowrap">
                                                <span className="flex items-center gap-1">
                                                    <CalendarDays className="h-4 w-4" />
                                                    Due: {new Date(hw.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                <span className={`font-semibold ${getDueColor(hw.dueDate, hw.status)}`}>
                                                    {getDueLabel(hw.dueDate, hw.status)}
                                                </span>
                                                <span>By: {hw.assignedBy}</span>
                                                {hw.attachments > 0 && (
                                                    <span className="flex items-center gap-1">
                                                        <FileText className="h-4 w-4" />{hw.attachments} file{hw.attachments > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                                <span>Max Marks: {hw.maxMarks}</span>
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <Button
                                                variant={hw.status === 'completed' ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => toggleStatus(hw)}
                                                disabled={isSubmitting}
                                                className={`rounded-xl ${hw.status === 'completed'
                                                    ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 border-0 text-white'
                                                    : 'hover:bg-green-100 hover:text-green-700 hover:border-green-300'
                                                }`}
                                            >
                                                {isSubmitting ? (
                                                    <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Saving…</>
                                                ) : hw.status === 'completed' ? (
                                                    <><CheckCircle2 className="mr-1.5 h-4 w-4" />Done</>
                                                ) : (
                                                    <><CircleDot className="mr-1.5 h-4 w-4" />Mark Done</>
                                                )}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setExpandedCard(isExpanded ? null : hw.id)}
                                                className="rounded-xl"
                                            >
                                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && (
                                    <div className="mt-6 pt-6 border-t space-y-4 animate-fade-in">
                                        {/* Description */}
                                        <div className="p-4 rounded-xl bg-background/60 backdrop-blur-sm">
                                            <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-muted-foreground" />Description
                                            </h4>
                                            <p className="text-sm text-muted-foreground leading-relaxed">
                                                {hw.description || 'No description provided.'}
                                            </p>
                                        </div>

                                        {/* Details grid */}
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div className="p-3 rounded-xl bg-background/60">
                                                <p className="text-xs text-muted-foreground">Subject</p>
                                                <p className="font-semibold text-sm">{hw.subject}</p>
                                            </div>
                                            <div className="p-3 rounded-xl bg-background/60">
                                                <p className="text-xs text-muted-foreground">Max Marks</p>
                                                <p className="font-semibold text-sm">{hw.maxMarks}</p>
                                            </div>
                                            <div className="p-3 rounded-xl bg-background/60">
                                                <p className="text-xs text-muted-foreground">Priority</p>
                                                <p className={`font-semibold text-sm capitalize ${hw.priority === 'high' ? 'text-red-600' : hw.priority === 'medium' ? 'text-yellow-600' : 'text-green-600'}`}>
                                                    {hw.priority}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Attachments */}
                                        {hw.attachmentDetails.length > 0 && (
                                            <div className="p-4 rounded-xl bg-background/60">
                                                <h4 className="font-semibold mb-3 flex items-center gap-2">
                                                    <FileText className="h-4 w-4 text-muted-foreground" />Attachments
                                                </h4>
                                                <div className="space-y-2">
                                                    {hw.attachmentDetails.map(att => (
                                                        <div key={att.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm border rounded-lg p-2">
                                                            <div className="min-w-0">
                                                                <p className="font-medium truncate">{att.file_name}</p>
                                                                <p className="text-xs text-muted-foreground">{att.mime_type} | {(att.file_size / 1024).toFixed(1)} KB</p>
                                                            </div>
                                                            <div className="flex gap-2 w-full sm:w-auto">
                                                                <Button
                                                                    size="icon"
                                                                    variant="outline"
                                                                    onClick={() => handlePreviewAttachment(hw.id, att)}
                                                                    disabled={previewLoading}
                                                                    className="w-full sm:w-9"
                                                                >
                                                                    <Eye className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    size="icon"
                                                                    variant="outline"
                                                                    onClick={() => handleDownloadAttachment(hw.id, att)}
                                                                    className="w-full sm:w-9"
                                                                >
                                                                    <Download className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Notes */}
                                        <div className="p-4 rounded-xl bg-background/60">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-2">
                                                <h4 className="font-semibold flex items-center gap-2">
                                                    <StickyNote className="h-4 w-4 text-yellow-500" />My Notes
                                                </h4>
                                                {!isEditingNote && (
                                                    <Button variant="ghost" size="sm" onClick={() => startEditNotes(hw.id, hw.notes)} className="text-xs">
                                                        <Pencil className="h-3.5 w-3.5 mr-1" />{hw.notes ? 'Edit' : 'Add Notes'}
                                                    </Button>
                                                )}
                                            </div>
                                            {isEditingNote ? (
                                                <div className="space-y-2">
                                                    <Textarea
                                                        value={notesDraft}
                                                        onChange={e => setNotesDraft(e.target.value)}
                                                        placeholder="Add your notes, reminders, or questions here..."
                                                        rows={3}
                                                        className="resize-none"
                                                    />
                                                    <div className="flex gap-2 justify-end">
                                                        <Button variant="ghost" size="sm" onClick={() => setEditingNotes(null)}>
                                                            <X className="h-4 w-4 mr-1" />Cancel
                                                        </Button>
                                                        <Button size="sm" onClick={() => saveNotes(hw.id)} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 border-0">
                                                            <Save className="h-4 w-4 mr-1" />Save
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted-foreground italic">
                                                    {hw.notes || 'No notes yet. Click "Add Notes" to write something.'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            <Dialog
                open={isPreviewOpen}
                onOpenChange={(open) => {
                    setIsPreviewOpen(open)
                    if (!open && previewUrl) {
                        URL.revokeObjectURL(previewUrl)
                        setPreviewUrl(null)
                    }
                }}
            >
                <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="truncate">{previewTitle || 'Attachment Preview'}</DialogTitle>
                    </DialogHeader>
                    <div className="h-[58vh] min-h-[320px] md:h-[70vh] rounded-xl border bg-muted/20 overflow-hidden">
                        {!previewUrl ? (
                            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No preview available</div>
                        ) : previewMimeType.includes('pdf') ? (
                            <iframe src={previewUrl} className="w-full h-full" title="Attachment Preview" />
                        ) : previewMimeType.startsWith('image/') ? (
                            <img src={previewUrl} alt={previewTitle} className="w-full h-full object-contain" />
                        ) : previewMimeType.startsWith('video/') ? (
                            <video src={previewUrl} controls className="w-full h-full" />
                        ) : previewMimeType.startsWith('text/') ? (
                            <iframe src={previewUrl} className="w-full h-full" title="Text Preview" />
                        ) : (
                            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                Preview not supported for this file type. Please download.
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

