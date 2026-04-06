"use client"

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
    Trophy,
    Calendar,
    HelpCircle,
    BookOpen,
    Award,
    Clock,
    Crown,
    Sparkles,
    TrendingUp,
    Target,
    Star,
    ArrowUpRight,
    BookOpenCheck,
    AlertCircle,
} from 'lucide-react'
import { api } from '@/lib/api'

interface DashboardResponse {
    student?: { id: string }
    class?: { id?: string; name?: string }
}

interface TimetableResponse {
    timetable: Array<{
        periods: Array<{
            subject_name?: string
        }>
    }>
}

interface ClassSubjectsResponse {
    subjects: Array<{
        subject_id: string
        name: string
        code: string
    }>
}

interface QuizListItem {
    subject_name: string
    status: 'upcoming' | 'active' | 'completed'
}

interface QuizListResponse {
    quizzes: QuizListItem[]
}

interface QuizLeaderboardEntry {
    student_id: string
    student_name: string
    rank: number
    is_current_student: boolean
}

interface QuizLeaderboardResponse {
    total_students: number
    entries: QuizLeaderboardEntry[]
    my_entry?: QuizLeaderboardEntry
}

interface AssessmentStage {
    assessment_id: string
    name: string
    assessment_type?: string
    completed: boolean
}

interface AssessmentStagesResponse {
    completed_count: number
    total_count: number
    stages: AssessmentStage[]
}

const SUBJECT_VISUALS = [
    { color: '#0d9488', bgColor: '#ccfbf1', iconColor: '#0d9488', accentColor: '#14b8a6' },
    { color: '#4f46e5', bgColor: '#e0e7ff', iconColor: '#4f46e5', accentColor: '#6366f1' },
    { color: '#0284c7', bgColor: '#e0f2fe', iconColor: '#0284c7', accentColor: '#0ea5e9' },
    { color: '#7c3aed', bgColor: '#f3e8ff', iconColor: '#7c3aed', accentColor: '#a855f7' },
    { color: '#ea580c', bgColor: '#ffedd5', iconColor: '#ea580c', accentColor: '#f97316' },
]

// Quick action buttons — refined muted palette
const quickActions = [
    { icon: Clock, label: 'Time Table', href: '/student/timetable', color: '#e0e7ff', iconColor: '#4f46e5' },
    { icon: Calendar, label: 'Schools Schedule', href: '/student/events', color: '#ccfbf1', iconColor: '#0d9488' },
    { icon: BookOpenCheck, label: 'Homework', href: '/student/homework', color: '#ffedd5', iconColor: '#ea580c' },
    { icon: HelpCircle, label: 'Quiz', href: '/student/quizzes', color: '#f3e8ff', iconColor: '#7c3aed' },
    { icon: BookOpen, label: 'Learn', href: '/student/materials', color: '#e0f2fe', iconColor: '#0284c7' },
    { icon: Award, label: 'Rewards', href: '/student/rewards', color: '#fef08a', iconColor: '#a16207' },
]

// Motivational quotes
const quotes = [
    { text: "All our dreams can come true, if we have the courage to pursue them.", author: "Walt Disney" },
    { text: "Education is the passport to the future, for tomorrow belongs to those who prepare for it today.", author: "Malcolm X" },
    { text: "The beautiful thing about learning is that nobody can take it away from you.", author: "B.B. King" },
]

export default function StudentDashboard() {
    const router = useRouter()
    const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0)
    const [mobilePanel, setMobilePanel] = useState<'subjects' | 'leaderboard'>('subjects')

    const dashboardQuery = useQuery({
        queryKey: ['student-dashboard'],
        queryFn: () => api.getOrEmpty<DashboardResponse>('/student/dashboard', { student: undefined, class: undefined }),
        staleTime: 60_000,
    })
    const timetableQuery = useQuery({
        queryKey: ['student-dashboard-timetable'],
        queryFn: () => api.getOrEmpty<TimetableResponse>('/academic/timetable', { timetable: [] }),
        staleTime: 60_000,
    })
    const classSubjectsQuery = useQuery({
        queryKey: ['student-dashboard-class-subjects'],
        queryFn: () => api.getOrEmpty<ClassSubjectsResponse>('/student/class-subjects', { subjects: [] }),
        staleTime: 60_000,
    })
    const quizzesQuery = useQuery({
        queryKey: ['student-dashboard-quizzes'],
        queryFn: () => api.getOrEmpty<QuizListResponse>('/student/quizzes', { quizzes: [] }),
        staleTime: 60_000,
    })
    const leaderboardQuery = useQuery({
        queryKey: ['student-dashboard-leaderboard-quiz'],
        queryFn: () => api.getOrEmpty<QuizLeaderboardResponse>('/student/leaderboard/quiz', { total_students: 0, entries: [], my_entry: undefined }),
        staleTime: 60_000,
    })
    const stagesQuery = useQuery({
        queryKey: ['student-dashboard-assessment-stages'],
        queryFn: () => api.getOrEmpty<AssessmentStagesResponse>('/student/assessments/stages', { completed_count: 0, total_count: 0, stages: [] }),
        staleTime: 60_000,
    })

    useEffect(() => {
        // Rotate quotes every 10 seconds
        const quoteInterval = setInterval(() => {
            setCurrentQuoteIndex((prev) => (prev + 1) % quotes.length)
        }, 10000)
        return () => clearInterval(quoteInterval)
    }, [])

    const handleQuickAction = (href: string) => {
        router.push(href)
    }

    const handleViewLeaderboard = () => {
        router.push('/student/leaderboard')
    }

    const quizzes = useMemo(() => quizzesQuery.data?.quizzes ?? [], [quizzesQuery.data?.quizzes])
    const leaderboardEntries = useMemo(() => leaderboardQuery.data?.entries ?? [], [leaderboardQuery.data?.entries])
    const myEntry = leaderboardQuery.data?.my_entry
    const totalStudents = leaderboardQuery.data?.total_students || leaderboardEntries.length || 0

    const timetableSubjects = useMemo(() => {
        const set = new Set<string>()
        ;(timetableQuery.data?.timetable || []).forEach((day) => {
            ;(day.periods || []).forEach((period) => {
                const name = (period.subject_name || '').trim()
                if (name) set.add(name)
            })
        })
        return Array.from(set)
    }, [timetableQuery.data?.timetable])

    const classAssignedSubjects = useMemo(() => {
        return (classSubjectsQuery.data?.subjects || [])
            .map((item) => (item.name || '').trim())
            .filter((name) => name.length > 0)
    }, [classSubjectsQuery.data?.subjects])

    const dashboardSubjects = useMemo(() => {
        if (classAssignedSubjects.length > 0) {
            return classAssignedSubjects
        }
        return timetableSubjects
    }, [classAssignedSubjects, timetableSubjects])

    const normalized = (value: string) => value.trim().toLowerCase()
    const subjectProgress = useMemo(() => {
        return dashboardSubjects.map((name, idx) => {
            const scoped = quizzes.filter((item) => normalized(item.subject_name) === normalized(name))
            const completed = scoped.filter((item) => item.status === 'completed').length
            const total = scoped.length
            const progress = total > 0 ? Math.round((completed / total) * 100) : 0
            const visual = SUBJECT_VISUALS[idx % SUBJECT_VISUALS.length]
            return {
                name,
                progress,
                total,
                completed,
                ...visual,
            }
        })
    }, [dashboardSubjects, quizzes])

    const completedQuizzes = useMemo(
        () => quizzes.filter((item) => item.status === 'completed').length,
        [quizzes],
    )
    const totalQuizzes = quizzes.length
    const overallProgress = totalQuizzes > 0 ? Math.round((completedQuizzes / totalQuizzes) * 100) : 0
    const subjectsToMaster = subjectProgress.filter((item) => item.progress < 80).length

    const leaderboardData = useMemo(() => {
        return leaderboardEntries.slice(0, 8).map((item) => ({
            studentId: item.student_id,
            rank: item.rank,
            name: item.student_name,
            badge: item.rank === 1 ? 'Gold' : item.rank === 2 ? 'Silver' : item.rank === 3 ? 'Bronze' : '',
            badgeColor: item.rank === 1 ? '#d97706' : item.rank === 2 ? '#64748b' : item.rank === 3 ? '#b45309' : '',
        }))
    }, [leaderboardEntries])

    const assessmentStages = stagesQuery.data?.stages || []
    const completedAssessments = stagesQuery.data?.completed_count || 0
    const totalAssessments = stagesQuery.data?.total_count || 0
    const assessmentProgressPct = totalAssessments > 0 ? (completedAssessments / totalAssessments) * 100 : 0
    const hasDataError = dashboardQuery.isError || timetableQuery.isError || classSubjectsQuery.isError || quizzesQuery.isError || leaderboardQuery.isError || stagesQuery.isError

    const subjectCards = subjectProgress.map((subject) => (
        <Card
            key={subject.name}
            className="border-0 shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer hover:-translate-y-1 bg-card group overflow-hidden"
            style={{ borderLeft: `3px solid ${subject.accentColor}` }}
            onClick={() => router.push('/student/performance')}
        >
            <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                    <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
                        style={{ backgroundColor: subject.bgColor }}
                    >
                        <BookOpen
                            className="w-5 h-5"
                            style={{ color: subject.iconColor }}
                        />
                    </div>
                    <div className="flex-1">
                        <span className="font-semibold text-foreground text-sm tracking-wide">{subject.name}</span>
                    </div>
                    {subject.progress >= 70 && (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 border border-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                            <TrendingUp className="w-3 h-3 mr-1" />
                            Good
                        </Badge>
                    )}
                </div>
                <div className="relative">
                    <Progress
                        value={subject.progress}
                        className="h-2.5 bg-muted rounded-full"
                    />
                </div>
                <div className="flex items-center justify-between mt-2.5">
                    <p className="text-xs font-medium text-muted-foreground">{subject.progress}% Complete</p>
                    <p className="text-[10px] text-muted-foreground/80 font-medium">{100 - subject.progress}% remaining</p>
                </div>
            </CardContent>
        </Card>
    ))

    return (
        <div className="rounded-xl p-3 pb-28 sm:p-4 sm:pb-32 md:p-6 md:pb-36">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 md:gap-6 w-full">
                {hasDataError && (
                    <div className="order-0 lg:col-span-12">
                        <Card className="border border-red-200 bg-red-50">
                            <CardContent className="p-3 flex items-center gap-2 text-red-700 text-sm">
                                <AlertCircle className="w-4 h-4" />
                                Some dashboard sections failed to load. Refresh to retry.
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* ── MOBILE ORDER 1: Motivational Quote ───────────────── */}
                <div className="order-1 lg:order-none lg:col-span-6 lg:col-start-4 lg:row-start-1">
                    <Card className="border border-border/60 shadow-sm bg-gradient-to-br from-teal-50 via-emerald-50/80 to-cyan-50/60 dark:from-teal-950/40 dark:via-emerald-950/30 dark:to-cyan-950/20 overflow-hidden relative">
                        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-teal-300/30 to-emerald-300/30 dark:from-teal-500/10 dark:to-emerald-500/10 rounded-full -translate-y-20 translate-x-20" />
                        <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-br from-cyan-300/25 to-teal-300/25 dark:from-cyan-500/10 dark:to-teal-500/10 rounded-full translate-y-16 -translate-x-16" />
                        <CardContent className="p-4 md:p-6 relative z-10">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 mt-1">
                                    <div className="w-1 h-12 bg-gradient-to-b from-teal-400 to-emerald-400 rounded-full" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-base font-medium text-foreground/80 italic leading-relaxed transition-opacity duration-300 min-h-[3.5rem]">
                                        &ldquo;{quotes[currentQuoteIndex].text}&rdquo;
                                    </p>
                                    <p className="mt-3 text-teal-700 dark:text-teal-300 font-semibold text-sm tracking-wide">— {quotes[currentQuoteIndex].author}</p>
                                </div>
                            </div>
                            {/* Quote navigation dots */}
                            <div className="flex justify-center gap-1.5 mt-4 items-center">
                                {quotes.map((_, index) => (
                                    <button
                                        key={index}
                                        type="button"
                                        className={`flex-none shrink-0 rounded-full p-0 !min-h-0 !min-w-0 transition-all duration-300 ${index === currentQuoteIndex
                                            ? 'h-px w-4 bg-teal-500 md:h-1.5 md:w-6'
                                            : 'h-px w-px bg-teal-200 hover:bg-teal-300 md:h-1.5 md:w-1.5'
                                            }`}
                                        aria-label={`Quote ${index + 1}`}
                                        onClick={() => setCurrentQuoteIndex(index)}
                                    />
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* ── MOBILE ORDER 2: Quick Actions ────────────────────── */}
                <div className="order-2 lg:order-none lg:col-span-6 lg:col-start-4 lg:row-start-2">
                    <Card className="border-0 shadow-sm bg-card overflow-hidden">
                        <CardContent className="p-4 md:p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                                <h3 className="font-bold text-foreground flex items-center gap-2 text-sm tracking-wide uppercase">
                                    Quick Actions
                                </h3>
                            </div>
                            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                                {quickActions.map((action) => (
                                    <button
                                        key={action.label}
                                        className="flex flex-col items-center gap-2.5 p-4 rounded-xl bg-muted/40 hover:bg-card hover:shadow-md transition-all duration-300 hover:-translate-y-1 group border border-border/70 hover:border-primary/30"
                                        onClick={() => handleQuickAction(action.href)}
                                    >
                                        <div
                                            className="w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-105 shadow-sm"
                                            style={{ backgroundColor: action.color }}
                                        >
                                            <action.icon
                                                className="w-7 h-7 transition-transform"
                                                style={{ color: action.iconColor }}
                                            />
                                        </div>
                                        <span className="text-xs font-semibold text-foreground/75 text-center group-hover:text-foreground transition-colors tracking-wide">
                                            {action.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* ── DESKTOP LEFT: Subject Progress ──────────────────── */}
                <div className="hidden order-5 lg:order-none lg:col-span-3 lg:row-span-4 lg:row-start-1 lg:block space-y-4">
                    {subjectCards}
                </div>

                {/* ── DESKTOP RIGHT: Leaderboard ─────────────────────── */}
                <div className="hidden order-6 lg:order-none lg:col-span-3 lg:row-span-4 lg:row-start-1 lg:col-start-10 lg:block">
                    <Card className="border-0 shadow-sm bg-card overflow-hidden">
                        <CardContent className="p-5">
                            {/* Leaderboard Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                                        <Crown className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-foreground tracking-tight">Leaderboard</h3>
                                        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Top performers</p>
                                    </div>
                                </div>
                            </div>

                            {/* Your Rank Banner */}
                            <div className="bg-gradient-to-r from-teal-100/80 to-emerald-100/70 dark:from-teal-950/40 dark:to-emerald-950/30 rounded-xl p-3.5 mb-4 border border-teal-300/50 dark:border-teal-900/60">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white font-bold shadow-lg shadow-teal-500/30 text-sm">
                                        {myEntry?.rank || '-'}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Your Rank</p>
                                        <p className="font-semibold text-foreground text-sm">
                                            {myEntry ? `#${myEntry.rank} of ${totalStudents}` : 'Not ranked yet'}
                                        </p>
                                    </div>
                                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                                </div>
                            </div>

                            {/* Leaderboard List */}
                            <div className="space-y-1.5">
                                {leaderboardData.length === 0 ? (
                                    <div className="text-sm text-muted-foreground py-4 text-center">
                                        No quiz leaderboard data available.
                                    </div>
                                ) : leaderboardData.map((item) => (
                                    <div
                                        key={`${item.studentId}-${item.rank}`}
                                        className={`flex items-center gap-3 p-2.5 rounded-lg transition-all duration-300 hover:shadow-sm hover:-translate-x-1 cursor-pointer ${item.rank <= 3
                                            ? item.rank === 1
                                                ? 'bg-amber-50/80 border border-amber-200/60 dark:bg-amber-950/30 dark:border-amber-800/60'
                                                : item.rank === 2
                                                    ? 'bg-slate-100/90 border border-slate-200/70 dark:bg-slate-800/70 dark:border-slate-700/70'
                                                    : 'bg-orange-50/60 border border-orange-200/60 dark:bg-orange-950/25 dark:border-orange-800/60'
                                            : 'bg-muted/50 hover:bg-muted dark:bg-slate-900/40 dark:hover:bg-slate-800/60 border border-transparent'
                                            }`}
                                    >
                                        <div
                                            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white text-xs shadow-sm ${item.rank === 1
                                                ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                                                : item.rank === 2
                                                    ? 'bg-gradient-to-br from-slate-400 to-slate-600'
                                                    : item.rank === 3
                                                        ? 'bg-gradient-to-br from-orange-400 to-orange-600'
                                                        : 'bg-gradient-to-br from-slate-300 to-slate-500'
                                                }`}
                                        >
                                            {item.rank}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-foreground/85 truncate text-sm">{item.name}</p>
                                            {item.badge && (
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: item.badgeColor }}>
                                                        {item.badge}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        {item.rank <= 3 ? (
                                            <Award className="w-4 h-4" style={{ color: item.badgeColor }} />
                                        ) : (
                                            <Star className="w-4 h-4 text-amber-400" />
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* View Full Leaderboard Button */}
                            <Button
                                className="w-full mt-5 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white font-semibold py-6 rounded-xl shadow-lg shadow-teal-500/25 hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 text-sm tracking-wide"
                                onClick={handleViewLeaderboard}
                            >
                                View Full Leaderboard
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* ── MOBILE ORDER 3 / DESKTOP CENTER: Overall Progress ── */}
                <div className="order-3 lg:order-none lg:col-span-6 lg:col-start-4 lg:row-start-3 space-y-4">
                    {/* Progress Banner */}
                    <Card className="border border-border/60 shadow-lg bg-gradient-to-r from-teal-50 via-teal-100/60 to-emerald-100/50 dark:from-teal-950/35 dark:via-teal-900/20 dark:to-emerald-950/25 overflow-hidden relative">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-teal-200/50 via-transparent to-transparent dark:from-teal-500/10" />
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-emerald-200/40 via-transparent to-transparent dark:from-emerald-500/10" />
                        <CardContent className="p-4 md:p-6 relative z-10">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/30">
                                        <Target className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Overall Progress</p>
                                        <p className="text-2xl font-bold text-foreground mt-0.5">{overallProgress}% Complete</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-xl md:text-3xl font-bold text-teal-500">{subjectsToMaster}</p>
                                    <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Subjects to master</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 text-foreground/75 bg-teal-100/60 dark:bg-teal-950/35 rounded-lg p-3 border border-teal-200 dark:border-teal-900/70">
                                <ArrowUpRight className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                <span className="text-sm font-medium">
                                    Quiz completion: {completedQuizzes} of {totalQuizzes} completed ({overallProgress}%).
                                </span>
                                <Sparkles className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* ── MOBILE ORDER 4: Subjects / Leaderboard Toggle ───── */}
                <div className="order-4 lg:hidden">
                    <div className="rounded-2xl border border-border/70 bg-card/90 p-1.5 shadow-sm backdrop-blur">
                        <div className="grid grid-cols-2 gap-1.5">
                        <button
                            type="button"
                            onClick={() => setMobilePanel('subjects')}
                            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] transition-all ${mobilePanel === 'subjects'
                                ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-md shadow-teal-500/25'
                                : 'bg-muted/50 text-muted-foreground'
                                }`}
                        >
                            <BookOpen className="h-4 w-4" />
                            Subjects
                        </button>
                        <button
                            type="button"
                            onClick={() => setMobilePanel('leaderboard')}
                            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] transition-all ${mobilePanel === 'leaderboard'
                                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25'
                                : 'bg-muted/50 text-muted-foreground'
                                }`}
                        >
                            <Trophy className="h-4 w-4" />
                            Leaderboard
                        </button>
                        </div>
                    </div>
                </div>

                {/* ── MOBILE ORDER 5: Selected Panel ─────────────────── */}
                <div className="order-5 lg:hidden">
                    {mobilePanel === 'subjects' ? (
                        <div className="space-y-4">
                            {subjectCards}
                        </div>
                    ) : (
                        <Card className="border-0 shadow-sm bg-card overflow-hidden">
                            <CardContent className="p-5">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                                            <Crown className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-foreground tracking-tight">Leaderboard</h3>
                                            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Top performers</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-gradient-to-r from-teal-100/80 to-emerald-100/70 dark:from-teal-950/40 dark:to-emerald-950/30 rounded-xl p-3.5 mb-4 border border-teal-300/50 dark:border-teal-900/60">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white font-bold shadow-lg shadow-teal-500/30 text-sm">
                                            {myEntry?.rank || '-'}
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Your Rank</p>
                                            <p className="font-semibold text-foreground text-sm">
                                                {myEntry ? `#${myEntry.rank} of ${totalStudents}` : 'Not ranked yet'}
                                            </p>
                                        </div>
                                        <TrendingUp className="w-5 h-5 text-emerald-500" />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    {leaderboardData.length === 0 ? (
                                        <div className="text-sm text-muted-foreground py-4 text-center">
                                            No quiz leaderboard data available.
                                        </div>
                                    ) : leaderboardData.map((item) => (
                                        <div
                                            key={`${item.studentId}-${item.rank}`}
                                            className={`flex items-center gap-3 p-2.5 rounded-lg transition-all duration-300 hover:shadow-sm hover:-translate-x-1 cursor-pointer ${item.rank <= 3
                                                ? item.rank === 1
                                                    ? 'bg-amber-50/80 border border-amber-200/60 dark:bg-amber-950/30 dark:border-amber-800/60'
                                                    : item.rank === 2
                                                        ? 'bg-slate-100/90 border border-slate-200/70 dark:bg-slate-800/70 dark:border-slate-700/70'
                                                        : 'bg-orange-50/60 border border-orange-200/60 dark:bg-orange-950/25 dark:border-orange-800/60'
                                                : 'bg-muted/50 hover:bg-muted dark:bg-slate-900/40 dark:hover:bg-slate-800/60 border border-transparent'
                                                }`}
                                        >
                                            <div
                                                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white text-xs shadow-sm ${item.rank === 1
                                                    ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                                                    : item.rank === 2
                                                        ? 'bg-gradient-to-br from-slate-400 to-slate-600'
                                                        : item.rank === 3
                                                            ? 'bg-gradient-to-br from-orange-400 to-orange-600'
                                                            : 'bg-gradient-to-br from-slate-300 to-slate-500'
                                                    }`}
                                            >
                                                {item.rank}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-foreground/85 truncate text-sm">{item.name}</p>
                                                {item.badge && (
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: item.badgeColor }}>
                                                            {item.badge}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            {item.rank <= 3 ? (
                                                <Award className="w-4 h-4" style={{ color: item.badgeColor }} />
                                            ) : (
                                                <Star className="w-4 h-4 text-amber-400" />
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <Button
                                    className="w-full mt-5 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white font-semibold py-6 rounded-xl shadow-lg shadow-teal-500/25 hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 text-sm tracking-wide"
                                    onClick={handleViewLeaderboard}
                                >
                                    View Full Leaderboard
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </div>

            </div>

            {/* Floating Assessment Progress Dock */}
            <div className="sticky bottom-3 z-20 mt-6 w-full animate-in slide-in-from-bottom-4 fade-in duration-300 ease-in-out">
                <div className="group/tracker mx-auto w-full max-w-[320px] px-2 transition-all duration-300 ease-in-out sm:max-w-[380px] md:hover:max-w-4xl">
                    <div className="relative overflow-x-auto">
                        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.32)_0%,rgba(255,255,255,0.16)_46%,rgba(255,255,255,0)_100%)] shadow-[0_12px_34px_rgba(2,6,23,0.16)] backdrop-blur-sm dark:bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.50)_0%,rgba(15,23,42,0.22)_46%,rgba(15,23,42,0)_100%)]" />
                        <div className="relative z-10 min-w-[300px] rounded-2xl px-1 pt-8 transition-all duration-300 ease-in-out sm:min-w-[340px] md:group-hover/tracker:min-w-[640px] md:group-hover/tracker:pt-12">
                            <div className="pointer-events-none absolute left-0 top-0 z-20 flex w-full justify-between px-3 opacity-100 translate-y-0 transition-all duration-300 ease-in-out md:opacity-0 md:translate-y-2 md:group-hover/tracker:translate-y-0 md:group-hover/tracker:opacity-100">
                                {assessmentStages.map((exam) => (
                                    <div
                                        key={exam.assessment_id}
                                        className={`flex min-w-0 flex-col items-center gap-1 ${exam.completed ? 'text-emerald-600 dark:text-emerald-300' : 'text-muted-foreground'}`}
                                    >
                                        <div
                                            className={`max-w-[110px] rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide shadow-sm transition-all duration-300 ease-in-out sm:max-w-[140px] sm:px-3 sm:text-xs ${exam.completed
                                                ? 'border-emerald-300 bg-emerald-100/95 text-emerald-700'
                                                : 'border-border bg-card/95 text-muted-foreground'
                                                }`}
                                        >
                                            <span className="block truncate">
                                                {exam.completed && <span className="mr-1 text-[10px]">✓</span>}
                                                {exam.assessment_type?.trim() || exam.name}
                                            </span>
                                        </div>
                                        <div className={`h-2 w-0.5 rounded-full ${exam.completed ? 'bg-emerald-400' : 'bg-border'}`} />
                                    </div>
                                ))}
                            </div>

                            <div className="relative mt-1 h-2 overflow-hidden rounded-full border border-border/70 bg-muted/80 transition-all duration-300 ease-in-out md:group-hover/tracker:h-3">
                                <div className="absolute inset-0 flex opacity-20">
                                    {Array.from({ length: Math.max(totalAssessments, 1) }).map((_, i) => (
                                        <div key={i} className="flex-1 border-r border-border/70 last:border-0" />
                                    ))}
                                </div>
                                <div
                                    className="relative h-full bg-gradient-to-r from-orange-400 via-amber-400 to-orange-500 transition-all duration-700 ease-in-out md:group-hover/tracker:brightness-110"
                                    style={{ width: `${assessmentProgressPct}%` }}
                                >
                                    <div className="absolute inset-0 w-full -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                                </div>
                            </div>

                            <div className="mt-1.5 flex items-center justify-between gap-3 transition-all duration-300 ease-in-out md:group-hover/tracker:mt-2">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground sm:text-[10px]">Start</span>
                                <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/95 px-2 py-1 shadow-sm backdrop-blur">
                                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-orange-600 sm:text-[10px]">
                                        {completedAssessments} of {totalAssessments} Completed
                                    </span>
                                </div>
                                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground sm:text-[10px]">Finish</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
