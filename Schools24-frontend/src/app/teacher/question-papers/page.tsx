"use client"

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    FileText,
    Download,
    Printer,
    Search,
    Filter,
    Eye,
    File,
    Calendar,
    User,
    GraduationCap,
    Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ValidationError } from '@/lib/api'
import { compareClassLabels } from '@/lib/classOrdering'

interface QuestionDocument {
    id: string
    title: string
    subject?: string
    class_level?: string
    file_name: string
    file_size: number
    mime_type: string
    teacher_name?: string
    uploaded_at: string
}

interface QuestionDocumentsPage {
    documents: QuestionDocument[]
    page: number
    page_size: number
    has_more: boolean
    next_page: number
    order: 'asc' | 'desc'
}

interface TimetableEntry {
    class_id: string
    class_name?: string
    subject_name?: string
}

interface QuestionPaper {
    id: string
    name: string
    fileName: string
    subject: string
    class: string
    uploadedBy: string
    uploadedAt: Date
    fileType: 'pdf' | 'doc' | 'docx'
    fileSize: number
    mimeType: string
}

function getFileType(fileName: string): 'pdf' | 'doc' | 'docx' {
    const name = fileName.toLowerCase()
    if (name.endsWith('.pdf')) return 'pdf'
    if (name.endsWith('.doc')) return 'doc'
    return 'docx'
}

function getCurrentAcademicYear() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    return month < 4 ? `${year - 1}-${year}` : `${year}-${year + 1}`
}

export default function TeacherQuestionPapersPage() {
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [subjectFilter, setSubjectFilter] = useState('all')
    const [classFilter, setClassFilter] = useState('all')
    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewPaper, setPreviewPaper] = useState<QuestionPaper | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const academicYear = getCurrentAcademicYear()

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    const { data: timetableData } = useQuery({
        queryKey: ['teacher-question-papers-timetable', academicYear],
        queryFn: () => api.getOrEmpty<{ timetable: TimetableEntry[] }>(`/teacher/timetable?academic_year=${encodeURIComponent(academicYear)}`, { timetable: [] }),
        staleTime: 60 * 1000,
    })

    const {
        data,
        isLoading,
        hasNextPage,
        fetchNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['teacher-question-documents', 'infinite', 20, 'asc', subjectFilter, classFilter, debouncedSearch],
        initialPageParam: 1,
        queryFn: async ({ pageParam }) => {
            try {
                const params = new URLSearchParams()
                params.set('page', String(pageParam))
                params.set('page_size', '20')
                params.set('order', 'asc')
                if (subjectFilter !== 'all') {
                    params.set('subject', subjectFilter === 'unspecified' ? '__unspecified__' : subjectFilter)
                }
                if (classFilter !== 'all') {
                    params.set('class_level', classFilter === 'unspecified' ? '__unspecified__' : classFilter)
                }
                if (debouncedSearch) {
                    params.set('search', debouncedSearch)
                }
                return await api.get<QuestionDocumentsPage>(`/teacher/question-documents?${params.toString()}`)
            } catch (e) {
                if (e instanceof ValidationError) return { documents: [], page: 1, page_size: 20, has_more: false, next_page: 0, order: 'asc' as const }
                throw e
            }
        },
        getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_page : undefined),
    })

    useEffect(() => {
        const onScroll = () => {
            if (!hasNextPage || isFetchingNextPage) return

            const el = document.documentElement
            const scrollTop = window.scrollY || el.scrollTop
            const viewportBottom = scrollTop + window.innerHeight
            const threshold = el.scrollHeight * 0.8

            if (viewportBottom >= threshold) {
                fetchNextPage()
            }
        }

        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    const papers = useMemo<QuestionPaper[]>(() => {
        const docs = data?.pages.flatMap((page) => page.documents) || []
        return docs.map((doc) => ({
            id: doc.id,
            name: doc.title || doc.file_name,
            fileName: doc.file_name,
            subject: doc.subject || 'General',
            class: doc.class_level || 'Unspecified',
            uploadedBy: doc.teacher_name || 'You',
            uploadedAt: new Date(doc.uploaded_at),
            fileType: getFileType(doc.file_name),
            fileSize: doc.file_size,
            mimeType: doc.mime_type,
        }))
    }, [data])

    const filteredPapers = papers

    const fetchDocumentBlob = async (paper: QuestionPaper, mode: 'view' | 'download') => {
        return api.fetchBlob(`/teacher/question-documents/${paper.id}/${mode}`)
    }

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    const getFileIcon = (fileType: string) => {
        switch (fileType) {
            case 'pdf':
                return <File className="h-5 w-5 text-red-500" />
            case 'doc':
            case 'docx':
                return <File className="h-5 w-5 text-blue-500" />
            default:
                return <FileText className="h-5 w-5 text-gray-500" />
        }
    }

    const getFileTypeBadge = (fileType: string) => {
        switch (fileType) {
            case 'pdf':
                return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100">PDF</Badge>
            case 'doc':
                return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100">DOC</Badge>
            case 'docx':
                return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100">DOCX</Badge>
            default:
                return <Badge variant="secondary">{fileType.toUpperCase()}</Badge>
        }
    }

    const handleDownload = async (paper: QuestionPaper) => {
        try {
            const blob = await fetchDocumentBlob(paper, 'download')
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = paper.fileName || paper.name
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Download failed'
            toast.error('Download failed', { description: message })
        }
    }

    const handleView = async (paper: QuestionPaper) => {
        setPreviewPaper(paper)
        setPreviewOpen(true)

        if (paper.fileType !== 'pdf') {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl)
                setPreviewUrl(null)
            }
            return
        }

        setPreviewLoading(true)
        try {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl)
                setPreviewUrl(null)
            }
            const blob = await fetchDocumentBlob(paper, 'view')
            const url = URL.createObjectURL(blob)
            setPreviewUrl(url)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Preview failed'
            toast.error('Preview failed', { description: message })
        } finally {
            setPreviewLoading(false)
        }
    }

    const handlePrint = async (paper: QuestionPaper) => {
        if (paper.fileType !== 'pdf') {
            toast.error('Print unavailable', { description: 'Printing is supported only for PDF documents.' })
            return
        }
        try {
            const blob = await fetchDocumentBlob(paper, 'view')
            const url = URL.createObjectURL(blob)
            const printWindow = window.open(url, '_blank', 'noopener,noreferrer')
            if (!printWindow) {
                URL.revokeObjectURL(url)
                throw new Error('Popup blocked. Please allow popups for printing.')
            }

            printWindow.addEventListener('load', () => {
                printWindow.focus()
                printWindow.print()
                setTimeout(() => URL.revokeObjectURL(url), 30000)
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Print failed'
            toast.error('Print failed', { description: message })
        }
    }

    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl)
            }
        }
    }, [previewUrl])

    const subjects = useMemo(() => {
        const set = new Set<string>()
        for (const row of timetableData?.timetable || []) {
            const trimmed = (row.subject_name || '').trim()
            if (trimmed) set.add(trimmed)
        }
        return [...set].sort((a, b) => a.localeCompare(b))
    }, [timetableData?.timetable])

    const classes = useMemo(() => {
        const set = new Set<string>()
        for (const row of timetableData?.timetable || []) {
            const trimmed = (row.class_name || '').trim()
            if (trimmed) set.add(trimmed)
        }
        return [...set].sort((a, b) => compareClassLabels(a, b))
    }, [timetableData?.timetable])

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row xl:items-center xl:justify-between">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 bg-clip-text text-transparent">
                        Question Papers
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Access and download question papers for your classes
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-sm py-1.5 px-3">
                        <FileText className="h-4 w-4 mr-2" />
                        {papers.length} Papers
                    </Badge>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Card className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent" />
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
                                <FileText className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{papers.length}</p>
                                <p className="text-sm text-muted-foreground">Total Papers</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent" />
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600 shadow-lg">
                                <File className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{papers.filter((p) => p.fileType === 'pdf').length}</p>
                                <p className="text-sm text-muted-foreground">PDF Files</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent" />
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 shadow-lg">
                                <File className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{papers.filter((p) => p.fileType === 'doc' || p.fileType === 'docx').length}</p>
                                <p className="text-sm text-muted-foreground">Word Files</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent" />
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
                                <GraduationCap className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{subjects.length}</p>
                                <p className="text-sm text-muted-foreground">Subjects</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by name or uploader..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <div className="flex w-full gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:w-auto">
                            <div className="min-w-[200px] sm:min-w-0">
                                <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                                    <SelectTrigger className="w-full whitespace-nowrap sm:w-[200px] [&>span]:truncate [&>span]:whitespace-nowrap">
                                        <Filter className="h-4 w-4 mr-2" />
                                        <SelectValue placeholder="Subject" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Subjects</SelectItem>
                                        {subjects.map((subject) => (
                                            <SelectItem key={subject} value={subject === 'Unspecified' ? 'unspecified' : subject}>
                                                {subject}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="min-w-[200px] sm:min-w-0">
                                <Select value={classFilter} onValueChange={setClassFilter}>
                                    <SelectTrigger className="w-full whitespace-nowrap sm:w-[200px] [&>span]:truncate [&>span]:whitespace-nowrap">
                                        <GraduationCap className="h-4 w-4 mr-2" />
                                        <SelectValue placeholder="Class" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Classes</SelectItem>
                                        {classes.map((cls) => (
                                            <SelectItem key={cls} value={cls === 'Unspecified' ? 'unspecified' : cls}>
                                                {cls}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Question Papers Library</CardTitle>
                    <CardDescription>View, download, and print question papers for your classes</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-lg border overflow-hidden">
                        <div className="hidden overflow-x-auto md:block">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="w-[40%]">Document</TableHead>
                                    <TableHead>Subject</TableHead>
                                    <TableHead>Class</TableHead>
                                    <TableHead>Uploaded By</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Size</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                            Loading question papers...
                                        </TableCell>
                                    </TableRow>
                                ) : filteredPapers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-12">
                                            <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                                            <p className="text-muted-foreground">No question papers found</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredPapers.map((paper) => (
                                        <TableRow key={paper.id} className="group hover:bg-muted/30 transition-colors">
                                            <TableCell className="min-w-[320px]">
                                                <div className="flex items-center gap-3">
                                                    {getFileIcon(paper.fileType)}
                                                    <div className="min-w-0">
                                                        <p className="font-medium whitespace-nowrap">{paper.name}</p>
                                                        <div className="mt-1">
                                                            {getFileTypeBadge(paper.fileType)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                <Badge variant="outline">{paper.subject}</Badge>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                    <GraduationCap className="h-4 w-4" />
                                                    <span>{paper.class}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                    <User className="h-4 w-4" />
                                                    <span>{paper.uploadedBy}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                    <Calendar className="h-4 w-4" />
                                                    <span>{paper.uploadedAt.toLocaleDateString()}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-muted-foreground">
                                                {formatFileSize(paper.fileSize)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => handleView(paper)}
                                                        title="View"
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                                        onClick={() => handleDownload(paper)}
                                                        title="Download"
                                                    >
                                                        <Download className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                                                        onClick={() => handlePrint(paper)}
                                                        title={paper.fileType === 'pdf' ? 'Print PDF' : 'Print available only for PDF'}
                                                        disabled={paper.fileType !== 'pdf'}
                                                    >
                                                        <Printer className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                        </div>

                        <div className="divide-y md:hidden">
                            {isLoading ? (
                                <div className="py-12 text-center text-muted-foreground">
                                    Loading question papers...
                                </div>
                            ) : filteredPapers.length === 0 ? (
                                <div className="py-12 text-center">
                                    <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                                    <p className="text-muted-foreground">No question papers found</p>
                                </div>
                            ) : (
                                filteredPapers.map((paper) => (
                                    <div key={paper.id} className="space-y-3 p-4">
                                        <div className="flex items-start gap-3">
                                            {getFileIcon(paper.fileType)}
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium whitespace-nowrap">{paper.name}</p>
                                                <div className="mt-2 flex items-center gap-2">
                                                    {getFileTypeBadge(paper.fileType)}
                                                    <Badge variant="outline" className="whitespace-nowrap">{paper.subject}</Badge>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                                            <div className="min-w-0">
                                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Class</p>
                                                <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap">
                                                    <GraduationCap className="h-4 w-4 shrink-0" />
                                                    <span className="whitespace-nowrap">{paper.class}</span>
                                                </div>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Date</p>
                                                <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap">
                                                    <Calendar className="h-4 w-4 shrink-0" />
                                                    <span className="whitespace-nowrap">{paper.uploadedAt.toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Uploaded By</p>
                                                <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap">
                                                    <User className="h-4 w-4 shrink-0" />
                                                    <span className="whitespace-nowrap">{paper.uploadedBy}</span>
                                                </div>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Size</p>
                                                <p className="mt-1 whitespace-nowrap">{formatFileSize(paper.fileSize)}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-end gap-2 pt-1">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleView(paper)} title="View">
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                                onClick={() => handleDownload(paper)}
                                                title="Download"
                                            >
                                                <Download className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                                                onClick={() => handlePrint(paper)}
                                                title="Print"
                                            >
                                                <Printer className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                    {isFetchingNextPage ? (
                        <div className="flex items-center justify-center py-4 text-muted-foreground text-sm gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading next 20 rows...
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Dialog
                open={previewOpen}
                onOpenChange={(open) => {
                    setPreviewOpen(open)
                    if (!open) {
                        setPreviewPaper(null)
                        if (previewUrl) {
                            URL.revokeObjectURL(previewUrl)
                            setPreviewUrl(null)
                        }
                    }
                }}
            >
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{previewPaper?.name || 'Document Preview'}</DialogTitle>
                        <DialogDescription>Preview metadata and document details</DialogDescription>
                    </DialogHeader>
                    {previewPaper ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div><span className="text-muted-foreground">File name:</span> {previewPaper.fileName}</div>
                                <div><span className="text-muted-foreground">Type:</span> {previewPaper.fileType.toUpperCase()}</div>
                                <div><span className="text-muted-foreground">Size:</span> {formatFileSize(previewPaper.fileSize)}</div>
                                <div><span className="text-muted-foreground">Uploaded by:</span> {previewPaper.uploadedBy}</div>
                                <div><span className="text-muted-foreground">Subject:</span> {previewPaper.subject}</div>
                                <div><span className="text-muted-foreground">Class:</span> {previewPaper.class}</div>
                                <div className="col-span-2"><span className="text-muted-foreground">Uploaded at:</span> {previewPaper.uploadedAt.toLocaleString()}</div>
                            </div>

                            {previewPaper.fileType === 'pdf' ? (
                                <div className="border rounded-md overflow-hidden h-[65vh] bg-muted/20">
                                    {previewLoading ? (
                                        <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Loading preview...
                                        </div>
                                    ) : previewUrl ? (
                                        <iframe src={previewUrl} className="w-full h-full" title="PDF Preview" />
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-muted-foreground">
                                            Preview unavailable
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="border rounded-md p-4 md:p-6 text-sm text-muted-foreground">
                                    Inline preview is available only for PDF documents. You can still download this file.
                                </div>
                            )}
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    )
}


