"use client"

import { Card, CardContent } from '@/components/ui/card'
import {
    GraduationCap,
    CheckCircle2,
    Clock,
    XCircle,
    TrendingUp
} from 'lucide-react'

interface StatsCardsProps {
    stats: {
        total: number;
        feesPaid: number;
        feesPartial: number;
        feesPending: number;
        averageAttendance: number;
    }
}

export function StatsCards({ stats }: StatsCardsProps) {
    return (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="bg-gradient-to-br from-blue-500 to-blue-600 border-0">
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                            <GraduationCap className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <p className="text-3xl font-bold text-white">{stats.total}</p>
                            <p className="text-sm text-blue-100">Total Students</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/30">
                            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-bold">{stats.feesPaid}</p>
                            <p className="text-sm text-muted-foreground">Fees Paid</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                            <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-bold">{stats.feesPartial}</p>
                            <p className="text-sm text-muted-foreground">Partial Paid</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
                            <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-bold">{stats.feesPending}</p>
                            <p className="text-sm text-muted-foreground">Pending</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
                            <TrendingUp className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-bold">{stats.averageAttendance}%</p>
                            <p className="text-sm text-muted-foreground">Avg Attendance</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
