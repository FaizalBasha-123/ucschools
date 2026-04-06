"use client"

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
    Users,
    BookOpen,
    ClipboardCheck,
    Calendar,
    Play,
    FileText,
    CheckCircle,
    TrendingUp,
} from 'lucide-react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'
import { getInitials } from '@/lib/utils'
import { api } from '@/lib/api'

const quickActions = [
    { icon: <Play className="h-5 w-5" />, label: 'Start Class', href: '/teacher/teach', color: 'bg-gradient-to-br from-teal-500 to-emerald-600 shadow-teal-500/20' },
    { icon: <ClipboardCheck className="h-5 w-5" />, label: 'Take Attendance', href: '/teacher/attendance-upload', color: 'bg-gradient-to-br from-emerald-500 to-green-600 shadow-emerald-500/20' },
    { icon: <FileText className="h-5 w-5" />, label: 'Create Quiz', href: '/teacher/quiz-scheduler', color: 'bg-gradient-to-br from-teal-400 to-cyan-500 shadow-cyan-500/20' },
    { icon: <BookOpen className="h-5 w-5" />, label: 'Upload Material', href: '/teacher/materials', color: 'bg-gradient-to-br from-green-500 to-emerald-700 shadow-green-500/20' },
]

interface TeacherDashboardResponse {
    teacher?: {
        full_name?: string
        rating?: number | null
        status?: string | null
    }
    today_schedule?: Array<{
        class_id?: string
        class_name?: string
        subject_name?: string
        period_number?: number
        start_time?: string
        end_time?: string
    }>
    today_unique_classes?: number
    assigned_class_count?: number
    pending_homework_to_grade?: number
    homework_submitted?: number
    teacher_rank?: number
    total_students?: number
    class_performance?: Array<{
        class_id: string
        class_name: string
        average_score: number
        student_count: number
    }>
    upcoming_quizzes?: Array<{
        id: string
        title: string
        subject_name: string
        class_name: string
        scheduled_at: string
        duration_minutes: number
        is_anytime: boolean
    }>
    recent_student_activity?: Array<{
        student_id: string
        student_name: string
        homework_id: string
        homework_title: string
        submitted_at: string
        status: string
    }>
}

export default function TeacherDashboard() {
    const { data: dashboardData } = useQuery({
        queryKey: ['teacher-dashboard'],
        queryFn: () => api.getOrEmpty<TeacherDashboardResponse>('/teacher/dashboard', {} as TeacherDashboardResponse),
    })

    const totalStudents = Number(dashboardData?.total_students ?? 0)
    const todayUniqueClasses = Number(dashboardData?.today_unique_classes ?? 0)
    const pendingReviews = Number(dashboardData?.pending_homework_to_grade ?? 0)
    const teacherRating = Number(dashboardData?.teacher?.rating ?? 0)
    const teacherName = (dashboardData?.teacher?.full_name || 'Teacher').trim()
    const classPerformance = (dashboardData?.class_performance || []).map((item) => ({
        class: item.class_name,
        avg: Number(item.average_score || 0),
    }))
    const classPerformanceChartHeight = Math.max(224, classPerformance.length * 56)
    const upcomingQuizzes = dashboardData?.upcoming_quizzes || []
    const recentActivity = dashboardData?.recent_student_activity || []

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-teal-700 to-emerald-600 dark:from-teal-400 dark:to-emerald-200 bg-clip-text text-transparent">Welcome back, {teacherName}!</h1>
                    <p className="text-muted-foreground mt-1">Here&apos;s what&apos;s on your schedule today.</p>
                </div>
                <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                    <Button variant="outline" className="hidden md:flex">
                        <Calendar className="mr-2 h-4 w-4" />
                        {new Date().toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                        })}
                    </Button>
                </div>
            </div>

            <div className="space-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/90">Quick Actions</h2>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {quickActions.map((action, index) => (
                    <Card key={index} className="card-hover cursor-pointer bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-100/50 dark:border-blue-800/50 hover:border-blue-300 dark:hover:border-blue-500 transition-all shadow-sm hover:shadow-md" onClick={() => window.location.href = action.href}>
                        <CardContent className="p-4 md:p-6 flex flex-col items-center text-center">
                            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${action.color} text-white mb-3 shadow-lg transition-transform hover:scale-110 duration-300`}>
                                {action.icon}
                            </div>
                            <p className="font-medium text-slate-700 dark:text-slate-200">{action.label}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="space-y-1 pt-1">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/90">Today&apos;s Snapshot</h2>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
                <Card className="card-hover bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20 border-teal-100/50 dark:border-teal-800/50 hover:border-teal-300 dark:hover:border-teal-500 transition-all shadow-sm hover:shadow-md">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/20">
                                <BookOpen className="h-5 w-5" />
                            </div>
                            <Badge variant="secondary">{todayUniqueClasses} Today</Badge>
                        </div>
                        <div className="mt-4">
                            <p className="text-2xl font-bold">{todayUniqueClasses}</p>
                            <p className="text-sm text-muted-foreground">Total Classes</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="card-hover bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20 border-teal-100/50 dark:border-teal-800/50 hover:border-teal-300 dark:hover:border-teal-500 transition-all shadow-sm hover:shadow-md">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/20">
                                <Users className="h-5 w-5" />
                            </div>
                            <Badge variant="success">Active</Badge>
                        </div>
                        <div className="mt-4">
                            <p className="text-2xl font-bold">{totalStudents}</p>
                            <p className="text-sm text-muted-foreground">Total Students</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="card-hover bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20 border-teal-100/50 dark:border-teal-800/50 hover:border-teal-300 dark:hover:border-teal-500 transition-all shadow-sm hover:shadow-md">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-yellow-600 text-white shadow-lg shadow-amber-500/20">
                                <ClipboardCheck className="h-5 w-5" />
                            </div>
                            <Badge variant="warning">{pendingReviews} Pending</Badge>
                        </div>
                        <div className="mt-4">
                            <p className="text-2xl font-bold">{pendingReviews}</p>
                            <p className="text-sm text-muted-foreground">Pending Reviews</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="card-hover bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20 border-teal-100/50 dark:border-teal-800/50 hover:border-teal-300 dark:hover:border-teal-500 transition-all shadow-sm hover:shadow-md">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
                                <TrendingUp className="h-5 w-5" />
                            </div>
                            <div className="flex items-center text-yellow-500">
                                {'★'.repeat(Math.max(0, Math.min(5, Math.floor(teacherRating))))}
                            </div>
                        </div>
                        <div className="mt-4">
                            <p className="text-2xl font-bold">{teacherRating.toFixed(1)}</p>
                            <p className="text-sm text-muted-foreground">Your Rating</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content */}
            <div className="grid gap-4 md:gap-6">

                {/* Class Performance Chart */}
                <Card className="min-w-0">
                    <CardHeader>
                        <CardTitle>Class Performance</CardTitle>
                        <CardDescription>Average scores across your classes</CardDescription>
                    </CardHeader>
                    <CardContent className="min-w-0">
                        {classPerformance.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No class performance data available yet</p>
                        ) : (
                        <div className={`${classPerformance.length > 4 ? 'max-h-[260px] overflow-y-auto pr-2' : ''}`}>
                            <div className="w-full min-w-0">
                                <ResponsiveContainer width="100%" height={classPerformanceChartHeight} minWidth={0}>
                                <BarChart data={classPerformance} layout="vertical" margin={{ left: 8, right: 16 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis type="number" domain={[0, 100]} className="text-xs" />
                                    <YAxis dataKey="class" type="category" className="text-xs" width={50} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'hsl(var(--card))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '8px',
                                        }}
                                        cursor={false}
                                    />
                                    <Bar dataKey="avg" fill="#10b981" radius={[0, 4, 4, 0]} />
                                </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Bottom Row */}
            <div className="grid gap-4 md:gap-6 grid-cols-1 lg:grid-cols-2">
                {/* Upcoming Quizzes */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <CardTitle>Scheduled Quizzes</CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => { window.location.href = '/teacher/quiz-scheduler' }}>View All</Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {upcomingQuizzes.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No quizzes found</p>
                            ) : upcomingQuizzes.slice(0, 3).map((quiz) => (
                                <div key={quiz.id} className="flex flex-col sm:flex-row sm:items-center gap-4 p-3 rounded-lg hover:bg-muted transition-colors">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{quiz.title}</p>
                                        <p className="text-sm text-muted-foreground">{quiz.subject_name} • {quiz.class_name}</p>
                                    </div>
                                    <div className="text-left sm:text-right shrink-0 w-full sm:w-auto">
                                        {quiz.is_anytime ? (
                                            <Badge variant="secondary">Anytime</Badge>
                                        ) : (
                                            <p className="text-sm font-medium">{new Date(quiz.scheduled_at).toLocaleDateString()}</p>
                                        )}
                                        <p className="text-xs text-muted-foreground mt-0.5">{quiz.duration_minutes} mins</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Recent Student Activity */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <CardTitle>Student Activity</CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => { window.location.href = '/teacher/homework' }}>View All</Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {recentActivity.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No recent homework submissions</p>
                            ) : recentActivity.slice(0, 4).map((student) => (
                                <div key={`${student.homework_id}-${student.student_id}-${student.submitted_at}`} className="flex flex-col sm:flex-row sm:items-center gap-4">
                                    <Avatar>
                                        <AvatarFallback>{getInitials(student.student_name)}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium">{student.student_name}</p>
                                        <p className="text-sm text-muted-foreground">{student.homework_title} • {new Date(student.submitted_at).toLocaleString()}</p>
                                    </div>
                                    <Badge variant="success" className="w-full sm:w-auto justify-center">
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        {student.status === 'graded' ? 'Graded' : 'Submitted'}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

        </div>
    )
}
