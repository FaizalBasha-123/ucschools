"use client"

import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
    Trophy, TrendingUp, Award, ArrowLeft, Target, Minus,
    BookOpen, BarChart3, FlaskConical, Calculator, Globe,
    Languages, Atom, BookMarked, Landmark, Music2, Dumbbell, Computer,
} from 'lucide-react'
import {
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Radar,
    ResponsiveContainer,
} from 'recharts'
import {
    useStudentSubjectPerformance,
    useStudentAssessmentLeaderboard,
} from '@/hooks/useStudentPerformance'

// ─── Subject display helpers ─────────────────────────────────────────────────

const subjectIconMap: Record<string, React.ElementType> = {
    science: FlaskConical,
    chemistry: FlaskConical,
    physics: Atom,
    biology: FlaskConical,
    mathematics: Calculator,
    maths: Calculator,
    math: Calculator,
    social: Globe,
    'social studies': Globe,
    geography: Landmark,
    history: BookMarked,
    english: BookOpen,
    hindi: Languages,
    sanskrit: Languages,
    music: Music2,
    'physical education': Dumbbell,
    pe: Dumbbell,
    computer: Computer,
    'computer science': Computer,
    it: Computer,
}

const subjectColorPalette = [
    { color: '#0d9488', bgColor: '#ccfbf1', accentColor: '#14b8a6' },
    { color: '#4f46e5', bgColor: '#e0e7ff', accentColor: '#6366f1' },
    { color: '#0284c7', bgColor: '#e0f2fe', accentColor: '#0ea5e9' },
    { color: '#7c3aed', bgColor: '#f3e8ff', accentColor: '#a855f7' },
    { color: '#ea580c', bgColor: '#ffedd5', accentColor: '#f97316' },
    { color: '#059669', bgColor: '#d1fae5', accentColor: '#10b981' },
    { color: '#b45309', bgColor: '#fef3c7', accentColor: '#f59e0b' },
    { color: '#be185d', bgColor: '#fce7f3', accentColor: '#ec4899' },
]

function getSubjectIcon(name: string): React.ElementType {
    return subjectIconMap[name.toLowerCase()] ?? BookOpen
}

function getSubjectColor(index: number) {
    return subjectColorPalette[index % subjectColorPalette.length]
}

function getGradeStyle(grade: string) {
    if (grade.startsWith('A')) return { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' }
    if (grade.startsWith('B')) return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' }
    if (grade.startsWith('C')) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' }
    if (grade === 'X' || grade === '—') return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' }
    return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' }
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

export default function StudentPerformancePage() {
    const router = useRouter()

    const subjectPerfQuery = useStudentSubjectPerformance()
    const leaderboardQuery = useStudentAssessmentLeaderboard()

    const subjects = subjectPerfQuery.data?.subjects ?? []
    const className = subjectPerfQuery.data?.class_name ?? leaderboardQuery.data?.class_name ?? ''
    const academicYear = subjectPerfQuery.data?.academic_year ?? ''

    const myEntry = leaderboardQuery.data?.my_entry
    const totalStudents = leaderboardQuery.data?.total_students ?? 0

    const myAvg = myEntry?.avg_assessment_pct ?? 0
    const myRank = myEntry?.rank ?? 0
    const overallGrade = myAvg > 0 ? deriveGrade(myAvg) : '—'

    const classEntries = leaderboardQuery.data?.entries ?? []
    const classAvg =
        classEntries.length > 0
            ? classEntries.reduce((s, e) => s + e.avg_assessment_pct, 0) / classEntries.length
            : 0
    const improvement = classAvg > 0 ? myAvg - classAvg : null

    const isLoading = subjectPerfQuery.isLoading || leaderboardQuery.isLoading
    const hasSubjects = subjects.length > 0
    const hasRankData = !!myEntry

    const MIN_RADAR_SPOKES = 5
    const radarData = (() => {
        const real = subjects.map(s => ({
            subject: s.subject_name.length > 8 ? s.subject_name.slice(0, 8) + '…' : s.subject_name,
            score: s.avg_percentage,
            fullMark: 100,
        }))
        const padding = Math.max(0, MIN_RADAR_SPOKES - real.length)
        const phantoms = Array.from({ length: padding }, (_, i) => ({
            subject: `_ph${i}`, // hidden via custom tick renderer
            score: 0,
            fullMark: 100,
        }))
        return [...real, ...phantoms]
    })()

    return (
        <div className="min-h-[100dvh] bg-background">
            <div className="w-full space-y-6">

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-xl hover:bg-card hover:shadow-sm"
                            onClick={() => router.back()}
                        >
                            <ArrowLeft className="h-4 w-4 text-slate-600" />
                        </Button>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/25">
                                    <BarChart3 className="h-4 w-4 text-white" />
                                </div>
                                My Performance
                            </h1>
                            <p className="text-sm text-slate-500 font-medium mt-0.5 ml-[3.25rem]">
                                {className ? `${className}${academicYear ? ` · ${academicYear}` : ''}` : 'Track your academic progress'}
                            </p>
                        </div>
                    </div>
                    <Button
                        className="w-full sm:w-auto bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white font-semibold px-5 py-2.5 rounded-xl shadow-lg shadow-amber-500/25 hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 text-sm tracking-wide border-0"
                        onClick={() => router.push('/student/leaderboard')}
                    >
                        <Trophy className="w-4 h-4 mr-2" />
                        View Leaderboard
                    </Button>
                </div>

                {/* Stats */}
                {isLoading ? (
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                        {/* Class Rank */}
                        <Card className="border border-amber-200/80 shadow-sm bg-gradient-to-br from-amber-50 via-yellow-50/80 to-orange-50/60 overflow-hidden group hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                            <CardContent className="p-5 relative">
                                <div className="absolute top-0 right-0 w-20 h-20 bg-amber-200/20 rounded-full -translate-y-10 translate-x-10" />
                                <div className="flex items-center gap-4 relative z-10">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25 transition-transform group-hover:scale-110">
                                        <Trophy className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xl md:text-3xl font-bold text-amber-600">
                                            {hasRankData && myRank > 0 ? `#${myRank}` : '—'}
                                        </p>
                                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Class Rank</p>
                                        {hasRankData && totalStudents > 0 && (
                                            <p className="text-[10px] text-slate-400 font-medium">of {totalStudents} students</p>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Average Score */}
                        <Card className="border border-teal-200/80 shadow-sm bg-gradient-to-br from-teal-50 via-emerald-50/80 to-cyan-50/60 overflow-hidden group hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                            <CardContent className="p-5 relative">
                                <div className="absolute top-0 right-0 w-20 h-20 bg-teal-200/20 rounded-full -translate-y-10 translate-x-10" />
                                <div className="flex items-center gap-4 relative z-10">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/25 transition-transform group-hover:scale-110">
                                        <Target className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xl md:text-3xl font-bold text-teal-600">
                                            {hasRankData && myAvg > 0 ? `${myAvg.toFixed(1)}%` : '—'}
                                        </p>
                                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Average Score</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Overall Grade */}
                        <Card className="border border-emerald-200/80 shadow-sm bg-gradient-to-br from-green-50 via-emerald-50/80 to-teal-50/60 overflow-hidden group hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                            <CardContent className="p-5 relative">
                                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200/20 rounded-full -translate-y-10 translate-x-10" />
                                <div className="flex items-center gap-4 relative z-10">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/25 transition-transform group-hover:scale-110">
                                        <Award className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xl md:text-3xl font-bold text-emerald-600">{overallGrade}</p>
                                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Overall Grade</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* vs Class Average */}
                        <Card className="border border-blue-200/80 shadow-sm bg-gradient-to-br from-blue-50 via-cyan-50/80 to-sky-50/60 overflow-hidden group hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                            <CardContent className="p-5 relative">
                                <div className="absolute top-0 right-0 w-20 h-20 bg-blue-200/20 rounded-full -translate-y-10 translate-x-10" />
                                <div className="flex items-center gap-4 relative z-10">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/25 transition-transform group-hover:scale-110">
                                        {improvement !== null && improvement >= 0
                                            ? <TrendingUp className="h-6 w-6 text-white" />
                                            : improvement !== null
                                                ? <TrendingUp className="h-6 w-6 text-white rotate-180" />
                                                : <Minus className="h-6 w-6 text-white" />}
                                    </div>
                                    <div>
                                        <p className={`text-xl md:text-3xl font-bold ${improvement === null ? 'text-slate-400' : improvement >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                            {improvement === null
                                                ? '—'
                                                : improvement >= 0
                                                    ? `+${improvement.toFixed(1)}%`
                                                    : `${improvement.toFixed(1)}%`}
                                        </p>
                                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">vs Class Avg</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Performance Overview & Subject-wise Performance */}
                <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2">
                    {/* Radar Chart */}
                    <Card className="border-0 shadow-sm bg-card overflow-hidden">
                        <CardContent className="p-4 md:p-6">
                            <div className="flex items-center gap-2.5 mb-5">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                                    <Target className="h-4 w-4 text-white" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-sm tracking-wide">Performance Overview</h3>
                                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">Strength areas across subjects</p>
                                </div>
                            </div>
                            {subjectPerfQuery.isLoading && (
                                <div className="h-[320px] flex items-center justify-center">
                                    <div className="w-10 h-10 rounded-full border-4 border-indigo-200 border-t-indigo-500 animate-spin" />
                                </div>
                            )}
                            {!subjectPerfQuery.isLoading && !hasSubjects && (
                                <div className="h-[320px] flex items-center justify-center text-sm text-slate-400">
                                    No assessment data yet.
                                </div>
                            )}
                            {hasSubjects && (
                                <div className="h-[320px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart data={radarData}>
                                            <PolarGrid stroke="#e2e8f0" />
                                            <PolarAngleAxis
                                                dataKey="subject"
                                                tick={(props) => {
                                                    const { x, y, payload } = props
                                                    if (typeof payload?.value === 'string' && payload.value.startsWith('_ph')) {
                                                        return <g />
                                                    }
                                                    return (
                                                        <text
                                                            x={x}
                                                            y={y}
                                                            textAnchor="middle"
                                                            dominantBaseline="central"
                                                            fill="#64748b"
                                                            fontSize={12}
                                                            fontWeight={600}
                                                        >
                                                            {payload?.value}
                                                        </text>
                                                    )
                                                }}
                                            />
                                            <PolarRadiusAxis
                                                angle={30}
                                                domain={[0, 100]}
                                                tick={{ fill: '#94a3b8', fontSize: 10 }}
                                            />
                                            <Radar
                                                name="Score"
                                                dataKey="score"
                                                stroke="#14b8a6"
                                                fill="#14b8a6"
                                                fillOpacity={0.2}
                                                strokeWidth={2.5}
                                            />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Subject-wise list */}
                    <Card className="border-0 shadow-sm bg-card overflow-hidden">
                        <CardContent className="p-4 md:p-6">
                            <div className="flex items-center gap-2.5 mb-5">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/25">
                                    <BookOpen className="h-4 w-4 text-white" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-sm tracking-wide">Subject-wise Performance</h3>
                                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">Scores across all subjects</p>
                                </div>
                            </div>
                            {subjectPerfQuery.isLoading && (
                                <div className="space-y-4">
                                    {[...Array(4)].map((_, i) => (
                                        <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
                                    ))}
                                </div>
                            )}
                            {!subjectPerfQuery.isLoading && !hasSubjects && (
                                <div className="h-48 flex items-center justify-center text-sm text-slate-400">
                                    No assessment marks recorded yet.
                                </div>
                            )}
                            {hasSubjects && (
                                <div className="space-y-4">
                                    {subjects.map((subject, index) => {
                                        const gradeStyle = getGradeStyle(subject.grade_letter)
                                        const colors = getSubjectColor(index)
                                        const IconComponent = getSubjectIcon(subject.subject_name)

                                        return (
                                            <div
                                                key={subject.subject_id}
                                                className="group p-3 rounded-xl bg-muted/50 border border-transparent hover:bg-card hover:border-border hover:shadow-sm transition-all duration-300"
                                                style={{ borderLeft: `3px solid ${colors.accentColor}` }}
                                            >
                                                <div className="flex items-center justify-between mb-2.5">
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="w-9 h-9 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
                                                            style={{ backgroundColor: colors.bgColor }}
                                                        >
                                                            <IconComponent className="w-4 h-4" style={{ color: colors.color }} />
                                                        </div>
                                                        <span className="font-semibold text-sm text-slate-800">{subject.subject_name}</span>
                                                        {subject.grade_letter && subject.grade_letter !== 'X' && (
                                                            <Badge className={`${gradeStyle.bg} ${gradeStyle.text} border ${gradeStyle.border} text-[10px] font-bold uppercase tracking-wider`}>
                                                                {subject.grade_letter}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="font-bold text-base" style={{ color: colors.color }}>
                                                            {subject.avg_percentage.toFixed(1)}%
                                                        </span>
                                                        {subject.assessment_count > 0 && (
                                                            <p className="text-[10px] text-slate-400">
                                                                {subject.assessment_count} assessment{subject.assessment_count !== 1 ? 's' : ''}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                <Progress value={subject.avg_percentage} className="h-2 bg-muted rounded-full" />
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

            </div>
        </div>
    )
}
