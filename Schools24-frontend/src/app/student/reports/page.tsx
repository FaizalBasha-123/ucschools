"use client"

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
    Download, FileText, BarChart3, GraduationCap, TrendingUp, Award,
    Printer, Share2, CheckCircle, Calendar, Star
} from 'lucide-react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from 'recharts'
import { api } from '@/lib/api'
import { useStudentAttendance } from '@/hooks/useStudentAttendance'
import { toast } from 'sonner'

const COLORS = ['#f97316', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

interface StudentReportDocument {
    id: string
    title: string
    report_type?: string
    class_level: string
    academic_year?: string
    description?: string
    file_name: string
    file_size: number
    mime_type: string
    uploaded_at: string
}

interface StudentReportDocumentsPage {
    reports: StudentReportDocument[]
    page: number
    page_size: number
    has_more: boolean
    next_page: number
    order: 'asc' | 'desc'
}

interface SubjectPerformanceEntry {
    subject_id: string
    subject_name: string
    avg_percentage: number
    total_obtained: number
    total_max: number
    assessment_count: number
    grade_letter: string
}

interface SubjectPerformanceResponse {
    academic_year: string
    class_name: string
    subjects: SubjectPerformanceEntry[]
}

interface AssessmentLeaderboardResponse {
    class_id: string
    class_name: string
    total_assessments: number
    total_students: number
    entries: Array<{ student_id: string; rank: number; avg_assessment_pct: number; is_current_student: boolean }>
    my_entry: { rank: number; avg_assessment_pct: number } | null
}

function deriveGrade(avg: number): string {
    if (avg >= 90) return 'A+'
    if (avg >= 80) return 'A'
    if (avg >= 70) return 'B+'
    if (avg >= 60) return 'B'
    if (avg >= 50) return 'C'
    if (avg >= 35) return 'D'
    return 'F'
}

function formatFileSize(bytes: number) {
    if (!bytes) return '0 Bytes'
    const units = ['Bytes', 'KB', 'MB', 'GB']
    let n = bytes
    let idx = 0
    while (n >= 1024 && idx < units.length - 1) {
        n /= 1024
        idx += 1
    }
    return `${n.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`
}

export default function StudentReportsPage() {
    const router = useRouter()

    const reportsQuery = useQuery({
        queryKey: ['student-report-documents'],
        queryFn: () =>
            api.getOrEmpty<StudentReportDocumentsPage>(
                '/student/report-documents?page=1&page_size=100&order=desc',
                { reports: [], page: 1, page_size: 100, has_more: false, next_page: 1, order: 'desc' },
            ),
    })

    const subjectPerfQuery = useQuery({
        queryKey: ['student-subject-performance'],
        queryFn: () =>
            api.getOrEmpty<SubjectPerformanceResponse>('/student/assessments/subject-performance',
                { academic_year: '', class_name: '', subjects: [] }),
    })

    const leaderboardQuery = useQuery({
        queryKey: ['student-assessment-leaderboard'],
        queryFn: () => api.getOrEmpty<AssessmentLeaderboardResponse>(
            '/student/leaderboard/assessments',
            { class_id: '', class_name: '', total_assessments: 0, total_students: 0, entries: [], my_entry: null },
        ),
        staleTime: 60_000,
    })

    const { data: attendanceData } = useStudentAttendance({}, true)

    // ── Computed summary stats from real data ─────────────────────
    const subjects = subjectPerfQuery.data?.subjects ?? []
    const avgScore = subjects.length > 0
        ? Math.round(subjects.reduce((s, e) => s + e.avg_percentage, 0) / subjects.length)
        : null
    const overallGrade = avgScore !== null ? deriveGrade(avgScore) : null
    const myRank = leaderboardQuery.data?.my_entry?.rank ?? null
    const totalStudents = leaderboardQuery.data?.total_students ?? null
    const attendancePct = attendanceData?.stats?.attendance_percent ?? null

    const fetchReportBlob = async (report: StudentReportDocument, action: 'view' | 'download') => {
        return api.fetchBlob(`/student/report-documents/${report.id}/${action}`)
    }

    const handleViewReport = async (report: StudentReportDocument) => {
        try {
            const blob = await fetchReportBlob(report, 'view')
            const url = URL.createObjectURL(blob)
            window.open(url, '_blank')
            setTimeout(() => URL.revokeObjectURL(url), 30000)
        } catch (error) {
            toast.error('View failed', {
                description: error instanceof Error ? error.message : 'Unexpected error',
            })
        }
    }

    const handleDownloadReport = async (report: StudentReportDocument) => {
        try {
            const blob = await fetchReportBlob(report, 'download')
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = report.file_name || report.title
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
            toast.success(`Downloading ${report.title}...`)
        } catch (error) {
            toast.error('Download failed', {
                description: error instanceof Error ? error.message : 'Unexpected error',
            })
        }
    }

    const handlePrintReport = () => {
        toast.info('Preparing print view...', {
            description: 'Opening print dialog.',
        })
        setTimeout(() => window.print(), 500)
    }

    const handleShareReport = () => {
        toast.success('Share link copied!', {
            description: 'You can now share your report card.',
        })
    }

    return (
        <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div>
                        <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                            My Reports
                        </h1>
                        <p className="text-muted-foreground">Academic and performance reports</p>
                    </div>
                </div>
                <div className="overflow-x-auto w-full sm:w-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex w-max sm:w-auto gap-2 sm:gap-3">
                    <Button className="w-full sm:w-auto" variant="outline" onClick={handlePrintReport}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print
                    </Button>
                    <Button className="w-full sm:w-auto" variant="outline" onClick={handleShareReport}>
                        <Share2 className="mr-2 h-4 w-4" />
                        Share
                    </Button>
                    <Button
                        className="w-full sm:w-auto bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 border-0 shadow-lg shadow-blue-500/20"
                        onClick={() => {
                            const first = reportsQuery.data?.reports?.[0]
                            if (!first) {
                                toast.info('No reports available yet')
                                return
                            }
                            void handleDownloadReport(first)
                        }}
                    >
                        <Download className="mr-2 h-4 w-4" />
                        Download Report Card
                    </Button>
                </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/50 dark:to-purple-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-violet-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex flex-col items-center text-center">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/30 mb-2 sm:mb-3">
                                <GraduationCap className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <p className="text-lg sm:text-xl md:text-3xl font-bold text-violet-700 dark:text-violet-400">
                                {overallGrade ?? (subjectPerfQuery.isLoading ? '—' : '—')}
                            </p>
                            <p className="text-[11px] sm:text-sm text-muted-foreground">Overall Grade</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex flex-col items-center text-center">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30 mb-2 sm:mb-3">
                                <TrendingUp className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <p className="text-lg sm:text-xl md:text-3xl font-bold text-green-700 dark:text-green-400">
                                {avgScore !== null ? `${avgScore}%` : '—'}
                            </p>
                            <p className="text-[11px] sm:text-sm text-muted-foreground">Average Score</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/50 dark:to-amber-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-yellow-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex flex-col items-center text-center">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-yellow-500 to-amber-600 text-white shadow-lg shadow-yellow-500/30 mb-2 sm:mb-3">
                                <Award className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <p className="text-lg sm:text-xl md:text-3xl font-bold text-yellow-700 dark:text-yellow-400">
                                {myRank !== null ? `#${myRank}${totalStudents ? ` / ${totalStudents}` : ''}` : '—'}
                            </p>
                            <p className="text-[11px] sm:text-sm text-muted-foreground">Class Rank</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex flex-col items-center text-center">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg shadow-blue-500/30 mb-2 sm:mb-3">
                                <BarChart3 className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <p className="text-lg sm:text-xl md:text-3xl font-bold text-blue-700 dark:text-blue-400">
                                {attendancePct !== null ? `${Math.round(attendancePct)}%` : '—'}
                            </p>
                            <p className="text-[11px] sm:text-sm text-muted-foreground">Attendance</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Subject Performance Chart + Subject-wise Breakdown — 2 column layout */}
            <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
                {/* Subject Performance Chart */}
                <Card className="border-0 shadow-lg overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
                        <div className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5" />
                            <CardTitle className="text-white">Subject Performance</CardTitle>
                        </div>
                        <CardDescription className="text-blue-100">Your scores across all subjects</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 md:p-6">
                        {subjectPerfQuery.isLoading && (
                            <div className="flex items-center justify-center h-[350px] text-sm text-muted-foreground">Loading performance data...</div>
                        )}
                        {subjectPerfQuery.isError && (
                            <div className="flex items-center justify-center h-[350px] text-sm text-destructive">Failed to load performance data</div>
                        )}
                        {!subjectPerfQuery.isLoading && !subjectPerfQuery.isError && (subjectPerfQuery.data?.subjects ?? []).length === 0 && (
                            <div className="flex items-center justify-center h-[350px] text-sm text-muted-foreground">No assessment marks recorded yet.</div>
                        )}
                        {!subjectPerfQuery.isLoading && (subjectPerfQuery.data?.subjects ?? []).length > 0 && (
                            <div className="h-[350px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={(subjectPerfQuery.data?.subjects ?? []).map(s => ({ name: s.subject_name, score: s.avg_percentage }))}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                        <XAxis dataKey="name" className="text-xs" />
                                        <YAxis className="text-xs" domain={[0, 100]} />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'hsl(var(--card))',
                                                border: '1px solid hsl(var(--border))',
                                                borderRadius: '12px',
                                                boxShadow: '0 10px 40px -15px rgba(0,0,0,0.2)',
                                            }}
                                            formatter={(value: number | undefined) => [`${value ?? 0}%`, 'Avg Score']}
                                            cursor={false}
                                        />
                                        <Bar dataKey="score" radius={[8, 8, 0, 0]}>
                                            {(subjectPerfQuery.data?.subjects ?? []).map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Subject Details */}
                <Card className="border-0 shadow-lg">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Star className="h-5 w-5 text-yellow-500" />
                            <CardTitle>Subject-wise Breakdown</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {subjectPerfQuery.isLoading && (
                            <div className="text-sm text-muted-foreground py-4 text-center">Loading subjects...</div>
                        )}
                        {subjectPerfQuery.isError && (
                            <div className="text-sm text-destructive py-4 text-center">Failed to load subject data</div>
                        )}
                        {!subjectPerfQuery.isLoading && !subjectPerfQuery.isError && (subjectPerfQuery.data?.subjects ?? []).length === 0 && (
                            <div className="text-sm text-muted-foreground py-4 text-center">No assessment marks recorded yet.</div>
                        )}
                        <div className="space-y-5">
                            {(subjectPerfQuery.data?.subjects ?? []).map((subject, index) => (
                                <div key={subject.subject_id} className={`space-y-2 stagger-${index + 1} animate-slide-up`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                            <div
                                                className="h-4 w-4 rounded-full"
                                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                            />
                                            <span className="font-semibold truncate">{subject.subject_name}</span>
                                            <Badge variant={subject.grade_letter.startsWith('A') ? 'success' : 'secondary'}>
                                                {subject.grade_letter}
                                            </Badge>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="font-bold text-base sm:text-lg">{subject.avg_percentage}%</span>
                                            {subject.assessment_count > 0 && (
                                                <p className="text-[11px] sm:text-xs text-muted-foreground">{subject.assessment_count} assessment{subject.assessment_count !== 1 ? 's' : ''}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <Progress value={subject.avg_percentage} className="h-3" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Available Reports */}
            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-500" />
                        <CardTitle>Available Reports</CardTitle>
                    </div>
                    <CardDescription>Download your academic reports</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                        {reportsQuery.isLoading ? (
                            <div className="text-sm text-muted-foreground">Loading reports...</div>
                        ) : reportsQuery.isError ? (
                            <div className="text-sm text-destructive">Failed to load reports</div>
                        ) : (reportsQuery.data?.reports || []).length === 0 ? (
                            <div className="text-sm text-muted-foreground">No reports available yet.</div>
                        ) : (reportsQuery.data?.reports || []).map((report, index) => (
                            <div
                                key={report.id}
                                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-5 rounded-2xl border-2 transition-all duration-300 hover:shadow-lg stagger-${index + 1} animate-slide-up border-green-200 bg-gradient-to-r from-green-50/50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20 hover:border-green-300`}
                            >
                                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                    <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shrink-0">
                                        <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                                    </div>
                                    <div className="min-w-0">
                                        <span className="font-semibold block truncate">{report.title}</span>
                                        <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mt-1">
                                            <Calendar className="h-3 w-3" />
                                            <span>{new Date(report.uploaded_at).toLocaleDateString()}</span>
                                        </div>
                                        <div className="text-[11px] sm:text-xs text-muted-foreground mt-1">
                                            {report.report_type || 'report'}{report.academic_year ? ` • ${report.academic_year}` : ''} • {formatFileSize(report.file_size)}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-row items-center gap-2 self-stretch sm:self-auto">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleViewReport(report)}
                                        className="flex-1 sm:flex-none hover:bg-blue-100 hover:text-blue-700 hover:border-blue-300"
                                    >
                                        <FileText className="h-4 w-4 mr-2" />
                                        View
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleDownloadReport(report)}
                                        className="flex-1 sm:flex-none hover:bg-green-100 hover:text-green-700 hover:border-green-300"
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Download
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Report Summary Banner */}
            <Card className="border-0 shadow-2xl bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 text-white overflow-hidden">
                <CardContent className="p-4 md:p-8 relative">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-20 translate-x-20" />
                    <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/10 rounded-full translate-y-16 -translate-x-16" />
                    <div className="relative z-10 flex flex-col xl:flex-row items-center justify-between gap-4 xl:gap-6">
                        <div className="text-center md:text-left">
                            <h3 className="text-xl sm:text-2xl font-bold mb-2 flex items-center gap-2 justify-center md:justify-start">
                                <CheckCircle className="h-7 w-7" />
                                Great Academic Progress!
                            </h3>
                            <p className="text-sm sm:text-base text-blue-100">You&apos;re performing above average in {(subjectPerfQuery.data?.subjects ?? []).filter(s => s.avg_percentage >= 80).length} out of {(subjectPerfQuery.data?.subjects ?? []).length} subjects</p>
                        </div>
                        <Button
                            size="lg"
                            className="w-full sm:w-auto bg-white text-blue-600 hover:bg-blue-50 shadow-xl px-8"
                            onClick={() => router.push('/student/performance')}
                        >
                            <TrendingUp className="mr-2 h-5 w-5" />
                            View Full Performance
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

