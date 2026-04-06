"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
    Users,
    GraduationCap,
    BookOpen,
    DollarSign,
    TrendingUp,
    TrendingDown,
    Calendar,
    Clock,
    Bell,
    BarChart3,
    ArrowUpRight,
    ArrowDownRight,
    ChevronRight,
    Activity,
    Award,
    UserCheck,
    AlertCircle,
    CheckCircle2,
    XCircle,
    ClipboardList,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { adminService } from '@/services/adminService'
import { formatCurrency, getInitials } from '@/lib/utils'
import { useEvents } from '@/hooks/useEvents'
import { useAdminWeeklyAttendance, useAdminAssessmentLeaderboard, useAdminRevenueChart, useAdminRecentPayments } from '@/hooks/useAdminDashboardSections'
import Link from 'next/link'
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,
    Bar,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell,
    Sector,
    ResponsiveContainer,
} from 'recharts'

const quickActions = [
    { title: 'Add Student', icon: GraduationCap, href: '/admin/users', color: 'bg-blue-500' },
    { title: 'Add Teacher', icon: BookOpen, href: '/admin/users', color: 'bg-green-500' },
    { title: 'Manage Fees', icon: DollarSign, href: '/admin/fees', color: 'bg-yellow-500' },
    { title: 'View Reports', icon: BarChart3, href: '/admin/reports', color: 'bg-purple-500' },
]

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444']

export default function AdminDashboard() {
    const [selectedPeriod, setSelectedPeriod] = useState('month')
    const [mounted, setMounted] = useState(false)
    const [activePieIndex, setActivePieIndex] = useState<number | undefined>(undefined)

    // Fetch real data from backend
    const { data: dashboardData, isLoading } = useQuery({
        queryKey: ['adminDashboard'],
        queryFn: adminService.getDashboardStats,
    })

    const stats = dashboardData || {
        total_users: 0,
        total_students: 0,
        total_teachers: 0,
        total_classes: 0,
        fee_collection: { total_collected: 0, total_pending: 0, total_overdue: 0, total_due: 0, collection_rate_percent: 0 },
        upcoming_events: [],
        inventory_alerts: [],
        recent_activity: [],
    };

    const upcomingEvents = stats.upcoming_events?.length > 0 ? stats.upcoming_events : []
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: eventsData, isLoading: eventsLoading } = useEvents(undefined, {
        startDate: todayStr,
        pageSize: 4,
    })
    const liveEvents = eventsData?.events ?? []

    // Real weekly attendance — bar chart
    const { data: attendanceWeekly, isLoading: attendanceLoading } = useAdminWeeklyAttendance()
    const attendanceChartDays = attendanceWeekly?.days ?? []

    // Real assessment leaderboard — top 5 across all classes
    const { data: leaderboardResp, isLoading: leaderboardLoading } = useAdminAssessmentLeaderboard({ limit: 5 })
    const topStudents = leaderboardResp?.items ?? []

    // Real revenue chart — period-aware
    const { data: revenueChartResp, isLoading: revenueChartLoading } = useAdminRevenueChart(
        selectedPeriod as 'week' | 'month' | 'quarter' | 'year'
    )
    const revenueChartData = revenueChartResp?.data ?? []

    // Real recent payments — 5 most recent
    const { data: paymentsResp, isLoading: recentFeesLoading } = useAdminRecentPayments(5)
    const recentFees = paymentsResp?.payments ?? []

    // Fee collection status derived from real dashboard fee_collection stats
    const fc = stats.fee_collection
    const feeStatusData = (() => {
        const collected = fc?.total_collected ?? 0
        const pending = fc?.total_pending ?? 0
        const overdue = fc?.total_overdue ?? 0
        const total = collected + pending + overdue
        if (total === 0) {
            return [
                { name: 'Collected', value: 0, color: '#22c55e' },
                { name: 'Pending', value: 0, color: '#f59e0b' },
                { name: 'Overdue', value: 0, color: '#ef4444' },
            ]
        }
        return [
            { name: 'Collected', value: Math.round((collected / total) * 100), color: '#22c55e' },
            { name: 'Pending', value: Math.round((pending / total) * 100), color: '#f59e0b' },
            { name: 'Overdue', value: Math.round((overdue / total) * 100), color: '#ef4444' },
        ]
    })()

    // Ensure charts only render after component is mounted and DOM is ready
    useEffect(() => {
        const timer = setTimeout(() => {
            setMounted(true)
        }, 100)
        return () => clearTimeout(timer)
    }, [])

    // Custom active shape renderer for pie chart with center-origin animation
    const renderActiveShape = (props: any) => {
        const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props

        // Calculate the mid-angle of the sector to offset it outward from center
        const RADIAN = Math.PI / 180
        const midAngle = (startAngle + endAngle) / 2
        const offsetDistance = 10 // How far the segment moves outward from center

        // Calculate offset position (segment moves outward from center)
        const offsetX = Math.cos(-midAngle * RADIAN) * offsetDistance
        const offsetY = Math.sin(-midAngle * RADIAN) * offsetDistance

        return (
            <g>
                <Sector
                    cx={cx + offsetX}
                    cy={cy + offsetY}
                    innerRadius={innerRadius}
                    outerRadius={outerRadius + 4}
                    startAngle={startAngle}
                    endAngle={endAngle}
                    fill={fill}
                    style={{
                        filter: 'brightness(1.2) drop-shadow(0 6px 16px rgba(0, 0, 0, 0.3))',
                    }}
                />
            </g>
        )
    }



    return (
        <div className="space-y-6">
            {/* Welcome Section */}
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                        Welcome back, Admin!
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Here's what's happening at your school today.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" className="bg-white/50 backdrop-blur-sm">
                        <Calendar className="mr-2 h-4 w-4" />
                        {new Date().toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                        })}
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
                <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-blue-500 to-blue-600">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm text-blue-100">Total Students</p>
                                <p className="text-xl md:text-3xl font-bold text-white">{stats.total_students}</p>
                                {stats.total_students > 0 ? (
                                    <div className="flex items-center gap-1 text-blue-100 text-xs">
                                        <Users className="h-3 w-3" />
                                        <span>Enrolled</span>
                                    </div>
                                ) : (
                                    <p className="text-blue-100 text-xs">No students yet</p>
                                )}
                            </div>
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
                                <GraduationCap className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-white/10" />
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-green-500 to-green-600">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm text-green-100">Total Teachers</p>
                                <p className="text-xl md:text-3xl font-bold text-white">{stats.total_teachers}</p>
                                {stats.total_teachers > 0 ? (
                                    <div className="flex items-center gap-1 text-green-100 text-xs">
                                        <BookOpen className="h-3 w-3" />
                                        <span>Active staff</span>
                                    </div>
                                ) : (
                                    <p className="text-green-100 text-xs">No teachers yet</p>
                                )}
                            </div>
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
                                <BookOpen className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-white/10" />
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-violet-500 to-violet-600">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm text-violet-100">Total Revenue</p>
                                <p className="text-xl md:text-3xl font-bold text-white">{formatCurrency(stats.fee_collection?.total_collected || 0)}</p>
                                {(stats.fee_collection?.total_collected ?? 0) > 0 ? (
                                    <div className="flex items-center gap-1 text-violet-100 text-xs">
                                        <TrendingUp className="h-3 w-3" />
                                        <span>Total collected</span>
                                    </div>
                                ) : (
                                    <p className="text-violet-100 text-xs">No payments yet</p>
                                )}
                            </div>
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
                                <DollarSign className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-white/10" />
                    </CardContent>
                </Card>

                <Card className="relative overflow-hidden border-0 shadow-lg bg-gradient-to-br from-amber-500 to-amber-600">
                    <CardContent className="p-4 md:p-6">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-sm text-amber-100">Pending Fees</p>
                                <p className="text-xl md:text-3xl font-bold text-white">{formatCurrency(stats.fee_collection?.total_pending || 0)}</p>
                                {(stats.fee_collection?.total_pending ?? 0) > 0 ? (
                                    <div className="flex items-center gap-1 text-amber-100 text-xs">
                                        <AlertCircle className="h-3 w-3" />
                                        <span>Requires attention</span>
                                    </div>
                                ) : (
                                    <p className="text-amber-100 text-xs">No pending fees</p>
                                )}
                            </div>
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
                                <AlertCircle className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-white/10" />
                    </CardContent>
                </Card>
            </div>

            {/* Quick Actions */}
            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
                {quickActions.map((action, index) => {
                    const Icon = action.icon
                    return (
                        <Link key={index} href={action.href}>
                            <Card className="card-hover cursor-pointer group">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${action.color} text-white group-hover:scale-110 transition-transform`}>
                                            <Icon className="h-5 w-5" />
                                        </div>
                                        <span className="font-medium">{action.title}</span>
                                        <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    )
                })}
            </div>

            {/* Charts Row */}
            <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-3">
                {/* Revenue Chart */}
                <div className="xl:col-span-2">
                    <Card>
                        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <CardTitle>Revenue Overview</CardTitle>
                                <CardDescription>Fee collections by period</CardDescription>
                            </div>
                            <div className="flex gap-1 bg-muted rounded-lg p-1">
                                {([
                                    { period: 'week', label: '7D' },
                                    { period: 'month', label: '1M' },
                                    { period: 'quarter', label: '3M' },
                                    { period: 'year', label: '1Y' },
                                ] as const).map(({ period, label }) => (
                                    <button
                                        key={period}
                                        onClick={() => setSelectedPeriod(period)}
                                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${selectedPeriod === period
                                                ? 'bg-background shadow text-foreground'
                                                : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] min-h-[300px] w-full min-w-0 overflow-hidden">
                                {revenueChartLoading ? (
                                    <div className="h-full w-full flex items-center justify-center text-muted-foreground animate-pulse">
                                        Loading chart...
                                    </div>
                                ) : !mounted ? (
                                    <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                                        Loading chart...
                                    </div>
                                ) : revenueChartData.length === 0 ? (
                                    <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                        <BarChart3 className="h-8 w-8 opacity-40" />
                                        <p className="text-sm">No payment data for this period yet.</p>
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <AreaChart data={revenueChartData}>
                                            <defs>
                                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                            <XAxis dataKey="label" className="text-xs" />
                                            <YAxis className="text-xs" tickFormatter={(value) => `₹${(value / 100000).toFixed(1)}L`} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: 'hsl(var(--card))',
                                                    border: '1px solid hsl(var(--border))',
                                                    borderRadius: '8px',
                                                }}
                                                formatter={(value: number | undefined) => [formatCurrency(value ?? 0), '']}
                                                cursor={false}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="revenue"
                                                stroke="#6366f1"
                                                fillOpacity={1}
                                                fill="url(#colorRevenue)"
                                                name="Revenue"
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Fee Status Chart */}
                <div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Fee Collection Status</CardTitle>
                            <CardDescription>Overall collected vs pending vs overdue</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[200px] min-h-[200px] w-full min-w-0 overflow-visible pie-chart-container">
                                {mounted ? (
                                    <ResponsiveContainer width="100%" height={200}>
                                        <PieChart>
                                            <Pie
                                                data={feeStatusData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                                {...({
                                                    activeIndex: activePieIndex,
                                                    activeShape: renderActiveShape,
                                                    onMouseEnter: (_: any, index: number) => setActivePieIndex(index),
                                                    onMouseLeave: () => setActivePieIndex(undefined)
                                                } as any)}
                                            >
                                                {feeStatusData.map((entry, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={entry.color}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                cursor={false}
                                                animationDuration={200}
                                                animationEasing="ease-out"
                                                content={({ active, payload }) => {
                                                    if (active && payload && payload.length) {
                                                        return (
                                                            <div
                                                                className="bg-background/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 shadow-lg"
                                                                style={{
                                                                    animation: 'slideUp 0.2s ease-out'
                                                                }}
                                                            >
                                                                <p className="font-medium text-sm">{payload[0].name}</p>
                                                            </div>
                                                        )
                                                    }
                                                    return null
                                                }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                                        Loading chart...
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                                {feeStatusData.map((item, index) => (
                                    <div key={index} className="flex items-center gap-2 group cursor-pointer hover:bg-muted/50 rounded-md p-1.5 transition-colors">
                                        <div className="h-3 w-3 rounded-full group-hover:scale-110 transition-transform" style={{ backgroundColor: item.color }} />
                                        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{item.name}</span>
                                        <span className="text-sm font-medium ml-auto group-hover:text-foreground transition-colors">{item.value}%</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Attendance & Performance */}
            <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-2">
                {/* Weekly Attendance */}
                <Card>
                    <CardHeader>
                        <CardTitle>Weekly Attendance</CardTitle>
                        <CardDescription>Student attendance this week</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[250px] w-full min-w-0 overflow-hidden">
                            {attendanceLoading ? (
                                <div className="h-full w-full flex items-center justify-center text-muted-foreground animate-pulse">
                                    Loading attendance...
                                </div>
                            ) : !mounted ? (
                                <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                                    Loading chart...
                                </div>
                            ) : attendanceChartDays.length === 0 ? (
                                <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                    <UserCheck className="h-8 w-8 opacity-40" />
                                    <p className="text-sm">No attendance records for this week yet.</p>
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={attendanceChartDays}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                        <XAxis dataKey="day" className="text-xs" />
                                        <YAxis className="text-xs" />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'hsl(var(--card))',
                                                border: '1px solid hsl(var(--border))',
                                                borderRadius: '8px',
                                            }}
                                            cursor={false}
                                        />
                                        <Bar dataKey="present" fill="#22c55e" radius={[4, 4, 0, 0]} name="Present" />
                                        <Bar dataKey="absent" fill="#ef4444" radius={[4, 4, 0, 0]} name="Absent" />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Top Performers */}
                <Card>
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <CardTitle>Top Performers</CardTitle>
                            <CardDescription>Students with highest scores</CardDescription>
                        </div>
                        <Link href="/admin/students-leaderboard">
                            <Button variant="outline" size="sm">
                                View All
                                <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {leaderboardLoading && (
                                <>
                                    {[0, 1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 animate-pulse">
                                            <div className="h-10 w-10 rounded-full bg-muted" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-4 bg-muted rounded w-3/4" />
                                                <div className="h-3 bg-muted rounded w-1/2" />
                                            </div>
                                            <div className="h-6 w-14 bg-muted rounded" />
                                        </div>
                                    ))}
                                </>
                            )}
                            {!leaderboardLoading && topStudents.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-6">No assessment data available yet.</p>
                            )}
                            {!leaderboardLoading && topStudents.map((student, index) => (
                                <div key={student.student_id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                                    <div className={`flex h-10 w-10 items-center justify-center rounded-full font-bold text-white ${index === 0 ? 'bg-yellow-500' :
                                            index === 1 ? 'bg-gray-400' :
                                                index === 2 ? 'bg-amber-600' : 'bg-slate-500'
                                        }`}>
                                        {student.rank}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{student.name}</p>
                                        <p className="text-sm text-muted-foreground truncate">{student.class_name}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-bold text-lg">{student.avg_assessment_pct.toFixed(1)}%</p>
                                        <p className="text-xs text-muted-foreground">{student.assessments_with_scores} exam{student.assessments_with_scores !== 1 ? 's' : ''}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Events & Recent Activity */}
            <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-2">
                {/* Upcoming Events */}
                <Card>
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <CardTitle>Upcoming Events</CardTitle>
                            <CardDescription>Events scheduled for this month</CardDescription>
                        </div>
                        <Link href="/admin/events">
                            <Button variant="outline" size="sm">
                                View All
                                <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {eventsLoading && (
                                <>
                                    {[0, 1, 2, 3].map((i) => (
                                        <div key={i} className="flex items-start gap-4 p-3 rounded-lg border animate-pulse">
                                            <div className="h-12 w-12 rounded-xl bg-muted shrink-0" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-4 bg-muted rounded w-3/4" />
                                                <div className="h-3 bg-muted rounded w-1/2" />
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                            {!eventsLoading && liveEvents.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-6">No upcoming events scheduled.</p>
                            )}
                            {!eventsLoading && liveEvents.slice(0, 4).map((event) => (
                                <div key={event.id} className="flex items-start gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-white ${event.type === 'exam' ? 'bg-red-500' :
                                        event.type === 'holiday' ? 'bg-green-500' :
                                            event.type === 'meeting' ? 'bg-blue-500' :
                                                event.type === 'sports' ? 'bg-yellow-500' : 'bg-purple-500'
                                        }`}>
                                        <Calendar className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{event.title}</p>
                                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                {event.date}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                {event.time}
                                            </span>
                                        </div>
                                    </div>
                                    <Badge variant={
                                        event.type === 'exam' ? 'destructive' :
                                            event.type === 'holiday' ? 'success' :
                                                event.type === 'meeting' ? 'default' :
                                                    event.type === 'sports' ? 'warning' : 'secondary'
                                    }>
                                        {event.type}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Recent Fee Payments */}
                <div>
                    <Card>
                        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <CardTitle>Recent Fee Activity</CardTitle>
                                <CardDescription>Latest fee transactions</CardDescription>
                            </div>
                            <Link href="/admin/fees">
                                <Button variant="outline" size="sm">
                                    View All
                                    <ChevronRight className="ml-1 h-4 w-4" />
                                </Button>
                            </Link>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {recentFeesLoading && (
                                    <>
                                        {[0, 1, 2, 3, 4].map((i) => (
                                            <div key={i} className="flex items-center gap-4 p-3 rounded-lg border animate-pulse">
                                                <div className="h-10 w-10 rounded-full bg-muted" />
                                                <div className="flex-1 space-y-2">
                                                    <div className="h-4 bg-muted rounded w-3/4" />
                                                    <div className="h-3 bg-muted rounded w-1/2" />
                                                </div>
                                                <div className="h-6 w-20 bg-muted rounded" />
                                            </div>
                                        ))}
                                    </>
                                )}
                                {!recentFeesLoading && recentFees.length === 0 && (
                                    <p className="text-sm text-muted-foreground text-center py-6">No fee payments recorded yet.</p>
                                )}
                                {!recentFeesLoading && recentFees.map((fee) => (
                                    <div key={fee.id} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                                        <Avatar>
                                            <AvatarFallback>{getInitials(fee.student_name)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">{fee.student_name}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {fee.purpose ?? fee.payment_method} • {new Date(fee.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-medium">{formatCurrency(fee.amount)}</p>
                                            <Badge variant={
                                                fee.status === 'completed' ? 'success' :
                                                    fee.status === 'pending' ? 'warning' : 'destructive'
                                            } className="mt-1">
                                                {fee.status === 'completed' && <CheckCircle2 className="mr-1 h-3 w-3" />}
                                                {fee.status === 'pending' && <Clock className="mr-1 h-3 w-3" />}
                                                {fee.status === 'failed' && <XCircle className="mr-1 h-3 w-3" />}
                                                {fee.status}
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

        </div>
    )
}

