"use client"

import { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, CheckCircle, XCircle, Clock, Download, CalendarDays } from 'lucide-react'
import { useStudentAttendance } from '@/hooks/useStudentAttendance'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts'

type MonthlyRow = {
    month: string
    present: number
    absent: number
    total: number
}

export default function StudentAttendancePage() {
    const { data, isLoading, isError } = useStudentAttendance({}, true)

    const stats = data?.stats
    const records = useMemo(() => data?.attendance ?? [], [data?.attendance])

    const recentAttendance = useMemo(() => records.slice(0, 7), [records])

    const monthlyData = useMemo<MonthlyRow[]>(() => {
        const grouped = new Map<string, { present: number; absent: number; total: number; ts: number }>()
        for (const item of records) {
            const date = new Date(item.date)
            if (Number.isNaN(date.getTime())) continue
            const key = `${date.getFullYear()}-${date.getMonth()}`
            const existing = grouped.get(key) ?? { present: 0, absent: 0, total: 0, ts: date.getTime() }
            if (item.status === 'present') existing.present += 1
            if (item.status === 'absent') existing.absent += 1
            existing.total += 1
            existing.ts = date.getTime()
            grouped.set(key, existing)
        }

        return Array.from(grouped.entries())
            .sort((a, b) => a[1].ts - b[1].ts)
            .slice(-6)
            .map(([, row]) => ({
                month: new Date(row.ts).toLocaleDateString('en-US', { month: 'short' }),
                present: row.present,
                absent: row.absent,
                total: row.total,
            }))
    }, [records])

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'present': return <CheckCircle className="h-4 w-4" />
            case 'absent': return <XCircle className="h-4 w-4" />
            case 'late': return <Clock className="h-4 w-4" />
            default: return <CalendarDays className="h-4 w-4" />
        }
    }

    return (
        <div className="space-y-4 sm:space-y-6 animate-fade-in">
            <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                        My Attendance
                    </h1>
                    <Button disabled title="Coming soon" size="sm" className="bg-gradient-to-r from-green-500 to-emerald-600 border-0 shadow-lg shadow-green-500/20 disabled:opacity-60 shrink-0 h-9 px-3 sm:h-10 sm:px-4">
                        <Download className="mr-1.5 h-4 w-4" />
                        Download Report
                    </Button>
                </div>
                <p className="text-muted-foreground">Track your attendance record</p>
            </div>

            {isError ? (
                <Card className="border-0 shadow-lg">
                    <CardContent className="py-10 text-center text-red-600">
                        Unable to load attendance data.
                    </CardContent>
                </Card>
            ) : null}

            <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex items-center gap-2.5 sm:gap-4">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30">
                                <CheckCircle className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <div>
                                <p className="text-lg sm:text-xl md:text-3xl font-bold text-green-700 dark:text-green-400">{stats?.present_days ?? 0}</p>
                                <p className="text-[11px] sm:text-sm text-muted-foreground">Days Present</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/50 dark:to-rose-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-red-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex items-center gap-2.5 sm:gap-4">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/30">
                                <XCircle className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <div>
                                <p className="text-lg sm:text-xl md:text-3xl font-bold text-red-700 dark:text-red-400">{stats?.absent_days ?? 0}</p>
                                <p className="text-[11px] sm:text-sm text-muted-foreground">Days Absent</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/50 dark:to-amber-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-yellow-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex items-center gap-2.5 sm:gap-4">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-yellow-500 to-amber-600 text-white shadow-lg shadow-yellow-500/30">
                                <Clock className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <div>
                                <p className="text-lg sm:text-xl md:text-3xl font-bold text-yellow-700 dark:text-yellow-400">{stats?.late_days ?? 0}</p>
                                <p className="text-[11px] sm:text-sm text-muted-foreground">Late Arrivals</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/10 rounded-full -translate-y-10 translate-x-10" />
                        <div className="flex items-center gap-2.5 sm:gap-4">
                            <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg shadow-blue-500/30">
                                <Calendar className="h-5 w-5 sm:h-7 sm:w-7" />
                            </div>
                            <div>
                                <p className="text-lg sm:text-xl md:text-3xl font-bold text-blue-700 dark:text-blue-400">{(stats?.attendance_percent ?? 0).toFixed(1)}%</p>
                                <p className="text-[11px] sm:text-sm text-muted-foreground">Attendance Rate</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-primary" />
                        <CardTitle>Monthly Attendance</CardTitle>
                    </div>
                    <CardDescription>Your attendance trend over the academic year</CardDescription>
                </CardHeader>
                <CardContent>
                    {!isLoading && (
                        <div className="space-y-2">
                            <p className="text-[11px] text-muted-foreground sm:hidden">Swipe chart left/right if labels are cramped</p>
                        <div className="h-[260px] sm:h-[350px] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                            <div className="h-full w-[520px] sm:w-full">
                            <ResponsiveContainer width="100%" height="100%" minWidth={320}>
                                <BarChart data={monthlyData} margin={{ left: 4, right: 4, top: 8, bottom: 2 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis dataKey="month" className="text-xs" />
                                    <YAxis className="text-xs" />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'hsl(var(--card))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '12px',
                                            boxShadow: '0 10px 40px -15px rgba(0,0,0,0.2)',
                                        }}
                                        cursor={false}
                                    />
                                    <Legend />
                                    <Bar dataKey="present" fill="url(#presentGradient)" name="Present" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="absent" fill="url(#absentGradient)" name="Absent" radius={[4, 4, 0, 0]} />
                                    <defs>
                                        <linearGradient id="presentGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#10b981" />
                                            <stop offset="100%" stopColor="#059669" />
                                        </linearGradient>
                                        <linearGradient id="absentGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#ef4444" />
                                            <stop offset="100%" stopColor="#dc2626" />
                                        </linearGradient>
                                    </defs>
                                </BarChart>
                            </ResponsiveContainer>
                            </div>
                        </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <CalendarDays className="h-5 w-5 text-primary" />
                                <CardTitle>Recent Attendance</CardTitle>
                            </div>
                            <CardDescription>Last 7 marked days</CardDescription>
                        </div>

                    </div>
                </CardHeader>
                <CardContent className="p-4 md:p-6">
                    {isLoading ? (
                        <div className="text-sm text-muted-foreground">Loading attendance...</div>
                    ) : recentAttendance.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No attendance records found.</div>
                    ) : (
                        <div className="overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                        <div className="flex sm:grid sm:grid-cols-7 gap-2 md:gap-4 w-max sm:w-full">
                            {recentAttendance.map((record) => {
                                const d = new Date(record.date)
                                const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
                                const dayNum = d.getDate()
                                const month = d.toLocaleDateString('en-US', { month: 'short' })
                                const year = d.getFullYear()

                                const boxStyle = record.status === 'present'
                                    ? { bg: 'bg-emerald-500', border: 'border-emerald-400', glow: 'shadow-emerald-400/40', label: 'text-emerald-600', light: 'bg-emerald-50' }
                                    : record.status === 'absent'
                                        ? { bg: 'bg-red-500', border: 'border-red-400', glow: 'shadow-red-400/40', label: 'text-red-600', light: 'bg-red-50' }
                                        : record.status === 'late'
                                            ? { bg: 'bg-amber-400', border: 'border-amber-400', glow: 'shadow-amber-400/40', label: 'text-amber-600', light: 'bg-amber-50' }
                                            : { bg: 'bg-blue-500', border: 'border-blue-400', glow: 'shadow-blue-400/40', label: 'text-blue-600', light: 'bg-blue-50' }

                                return (
                                    <div key={record.id} className="group flex flex-col items-center gap-2 min-w-[92px] sm:min-w-0">
                                        <div className={`sm:w-full flex-1 sm:flex-none rounded-xl ${boxStyle.light} border ${boxStyle.border} border-opacity-30 p-2 flex sm:flex-col flex-row sm:items-center items-center gap-2 sm:gap-0.5`}>
                                            <span className={`text-[10px] font-bold uppercase tracking-widest ${boxStyle.label}`}>{dayName}</span>
                                            <span className="text-xl md:text-2xl font-black text-slate-800 leading-none">{dayNum}</span>
                                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{month}</span>
                                            <span className="text-[9px] text-slate-400 font-medium">{year}</span>
                                        </div>

                                        <div
                                            className={`sm:w-full w-14 h-10 rounded-lg ${boxStyle.bg} border-2 ${boxStyle.border} shadow-lg ${boxStyle.glow} flex items-center justify-center transition-all duration-300 group-hover:scale-105 group-hover:shadow-xl`}
                                        >
                                            <div className="text-white">
                                                {getStatusIcon(record.status)}
                                            </div>
                                        </div>

                                        <span className={`text-[10px] font-bold uppercase tracking-wide ${boxStyle.label} sm:text-center`}>
                                            {record.status}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                        </div>
                    )}

                    <div className="flex items-center justify-center gap-4 sm:gap-5 mt-5 sm:mt-6 pt-4 border-t border-slate-100">
                        {[
                            { color: 'bg-emerald-500', label: 'Present' },
                            { color: 'bg-red-500', label: 'Absent' },
                            { color: 'bg-amber-400', label: 'Late' },
                        ].map((item) => (
                            <div key={item.label} className="flex items-center gap-1.5">
                                <div className={`w-3 h-3 rounded-sm ${item.color}`} />
                                <span className="text-xs text-slate-500 font-medium">{item.label}</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

