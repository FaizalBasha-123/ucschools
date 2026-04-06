"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import { Users, GraduationCap, BookOpen, TrendingUp, Calendar, ChevronDown, ShieldCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api"

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

interface MonthlyUserStat {
    month_num: number
    total: number
    students: number
    teachers: number
    admins: number
    super_admins: number
}

interface MonthlyUsersResponse {
    year: number
    months: MonthlyUserStat[]
    summary: {
        total_new_users: number
        total_students: number
        total_teachers: number
        total_admins: number
        total_super_admins: number
        peak_month: number
        peak_count: number
    }
}

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 4 }, (_, i) => currentYear - i)

function StatCard({
    label, value, icon, color, sub,
}: { label: string; value: number; icon: React.ReactNode; color: string; sub?: string }) {
    return (
        <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                    {icon}
                </div>
                <div>
                    <p className="text-sm text-muted-foreground font-medium">{label}</p>
                    <p className="text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
                    {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
                </div>
            </CardContent>
        </Card>
    )
}

export function UserGrowthSection() {
    const [year, setYear] = useState(currentYear)

    const { data, isLoading, isError } = useQuery<MonthlyUsersResponse>({
        queryKey: ["super-admin", "monthly-users", year],
        queryFn: () => api.get<MonthlyUsersResponse>(`/super-admin/analytics/monthly-users?year=${year}`),
        refetchOnWindowFocus: false,
    })

    const chartData = (data?.months ?? []).map((m) => ({
        month: MONTH_LABELS[m.month_num - 1],
        Students: m.students,
        Teachers: m.teachers,
        Admins: m.admins,
        "Super Admins": m.super_admins,
    }))

    const summary = data?.summary

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-card p-6 rounded-2xl border shadow-sm">
                <div>
                    <h1 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent tracking-tight">
                        User Growth
                    </h1>
                    <p className="text-muted-foreground mt-1 font-medium">Monthly new user registrations across all schools.</p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="gap-2 h-10 px-4 rounded-xl font-semibold">
                            <Calendar className="h-4 w-4 text-violet-500" />
                            {year}
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {YEAR_OPTIONS.map((y) => (
                            <DropdownMenuItem key={y} onClick={() => setYear(y)} className={y === year ? "font-bold text-violet-600" : ""}>
                                {y}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
                <StatCard
                    label="Total New Users"
                    value={summary?.total_new_users ?? 0}
                    icon={<Users className="w-6 h-6 text-white" />}
                    color="bg-gradient-to-br from-violet-500 to-indigo-600"
                    sub={`in ${year}`}
                />
                <StatCard
                    label="New Students"
                    value={summary?.total_students ?? 0}
                    icon={<GraduationCap className="w-6 h-6 text-white" />}
                    color="bg-gradient-to-br from-blue-500 to-blue-600"
                />
                <StatCard
                    label="New Teachers"
                    value={summary?.total_teachers ?? 0}
                    icon={<BookOpen className="w-6 h-6 text-white" />}
                    color="bg-gradient-to-br from-emerald-500 to-emerald-600"
                />
                <StatCard
                    label="New Admins"
                    value={summary?.total_admins ?? 0}
                    icon={<ShieldCheck className="w-6 h-6 text-white" />}
                    color="bg-gradient-to-br from-violet-500 to-purple-600"
                />
                <StatCard
                    label="Super Admins"
                    value={summary?.total_super_admins ?? 0}
                    icon={<TrendingUp className="w-6 h-6 text-white" />}
                    color="bg-gradient-to-br from-rose-500 to-red-600"
                />
            </div>

            {/* Bar Chart */}
            <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2 px-6 pt-5">
                    <CardTitle className="text-base font-bold">Monthly New Registrations — {year}</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-4">
                    {isLoading ? (
                        <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                            Loading chart…
                        </div>
                    ) : isError ? (
                        <div className="h-64 flex items-center justify-center text-red-500 text-sm">
                            Failed to load data. Make sure the backend is running.
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                                <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: "0.75rem",
                                        border: "1px solid hsl(var(--border))",
                                        background: "hsl(var(--card))",
                                        color: "hsl(var(--foreground))",
                                        fontSize: 13,
                                    }}
                                />
                                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 12 }} />
                                <Bar dataKey="Students" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32} />
                                <Bar dataKey="Teachers" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
                                <Bar dataKey="Admins" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={32} />
                                <Bar dataKey="Super Admins" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={32} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            {/* Data Table */}
            <Card className="border-0 shadow-sm overflow-hidden">
                <CardHeader className="pb-2 px-6 pt-5 border-b">
                    <CardTitle className="text-base font-bold">Month-by-Month Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="divide-y">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-4 px-6 py-3">
                                    <div className="h-4 w-16 rounded bg-muted animate-pulse" />
                                    <div className="h-4 w-12 rounded bg-muted animate-pulse" />
                                    <div className="h-4 w-12 rounded bg-muted animate-pulse" />
                                    <div className="h-4 w-12 rounded bg-muted animate-pulse" />
                                    <div className="h-4 w-12 rounded bg-muted animate-pulse" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-muted/50 border-b">
                                        <th className="text-left px-6 py-3 font-semibold text-muted-foreground">Month</th>
                                        <th className="text-right px-6 py-3 font-semibold text-muted-foreground">Students</th>
                                        <th className="text-right px-6 py-3 font-semibold text-muted-foreground">Teachers</th>
                                        <th className="text-right px-6 py-3 font-semibold text-muted-foreground">Admins</th>
                                        <th className="text-right px-6 py-3 font-semibold text-muted-foreground">Super Admins</th>
                                        <th className="text-right px-6 py-3 font-semibold text-muted-foreground">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                    {(data?.months ?? []).map((m) => {
                                        const isPeak = m.month_num === summary?.peak_month && m.total > 0
                                        return (
                                            <tr key={m.month_num} className={`transition-colors hover:bg-muted/30 ${isPeak ? "bg-violet-50/40 dark:bg-violet-500/5" : ""}`}>
                                                <td className="px-6 py-3 font-medium text-foreground flex items-center gap-2">
                                                    {MONTH_LABELS[m.month_num - 1]}
                                                    {isPeak && (
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400">
                                                            PEAK
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-right text-blue-600 dark:text-blue-400 font-medium">{m.students}</td>
                                                <td className="px-6 py-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">{m.teachers}</td>
                                                <td className="px-6 py-3 text-right text-violet-600 dark:text-violet-400 font-medium">{m.admins}</td>
                                                <td className="px-6 py-3 text-right text-rose-600 dark:text-rose-400 font-medium">{m.super_admins}</td>
                                                <td className="px-6 py-3 text-right font-bold text-foreground">{m.total}</td>
                                            </tr>
                                        )
                                    })}
                                    {/* Totals row */}
                                    <tr className="bg-muted/50 font-bold border-t-2 border-border">
                                        <td className="px-6 py-3 text-foreground">Total</td>
                                        <td className="px-6 py-3 text-right text-blue-600 dark:text-blue-400">{summary?.total_students ?? 0}</td>
                                        <td className="px-6 py-3 text-right text-emerald-600 dark:text-emerald-400">{summary?.total_teachers ?? 0}</td>
                                        <td className="px-6 py-3 text-right text-violet-600 dark:text-violet-400">{summary?.total_admins ?? 0}</td>
                                        <td className="px-6 py-3 text-right text-rose-600 dark:text-rose-400">{summary?.total_super_admins ?? 0}</td>
                                        <td className="px-6 py-3 text-right text-foreground">{summary?.total_new_users ?? 0}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

export default function SuperAdminUsersPage() {
    return <UserGrowthSection />
}
