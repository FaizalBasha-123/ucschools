"use client"

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Trophy, Star, Loader2 } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useTeachersLeaderboard } from '@/hooks/useAdminLeaderboards'
import { LeaderboardPodium } from '@/components/admin/leaderboard/LeaderboardPodium'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'

export default function TeachersLeaderboardPage() {
    const searchParams = useSearchParams()
    const schoolId = searchParams.get('school_id') || undefined
    const { user, isLoading } = useAuth()
    const canLoad = !!user && !isLoading && (user.role !== 'super_admin' || !!schoolId)

    const { data, isLoading: isLeaderboardLoading, isError } = useTeachersLeaderboard({
        enabled: canLoad,
        schoolId,
        limit: 100,
    })

    const topThree = data?.top_3 || []
    const fullItems = data?.items || []

    const BATCH_SIZE = 20
    const [displayedCount, setDisplayedCount] = useState(BATCH_SIZE)
    const visibleItems = fullItems.slice(0, displayedCount)
    const hasMore = displayedCount < fullItems.length

    const { ref: sentinelRef, inView } = useIntersectionObserver({ threshold: 0.1 })
    useEffect(() => {
        if (inView && hasMore) {
            setDisplayedCount(c => Math.min(c + BATCH_SIZE, fullItems.length))
        }
    }, [inView, hasMore, fullItems.length])

    // Reset when data arrives or changes
    useEffect(() => {
        setDisplayedCount(BATCH_SIZE)
    }, [data])

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold">Teachers Leaderboard</h1>
                    <p className="text-muted-foreground">Top performing teachers based on ratings and performance</p>
                </div>
            </div>

            {/* Top 3 Teachers */}
            <div className="mb-12">
                <LeaderboardPodium
                    type="teacher"
                    items={topThree.map(t => ({
                        id: t.teacher_id,
                        rank: t.rank,
                        name: t.name,
                        subtitle: t.department,
                        score: t.rating,
                        scoreLabel: "Rating",
                        trend: t.trend,
                        secondaryMetric: {
                            value: t.students_count,
                            label: "Students"
                        },
                        avatarUrl: undefined
                    }))}
                />
            </div>

            {/* Full Leaderboard */}
            <Card>
                <CardHeader>
                    <CardTitle>Full Rankings</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                    <div className="space-y-4 min-w-[640px]">
                        {isLeaderboardLoading && (
                            <div className="text-sm text-muted-foreground">Loading leaderboard...</div>
                        )}
                        {isError && (
                            <div className="text-sm text-destructive">Failed to load teacher leaderboard.</div>
                        )}
                        {!isLeaderboardLoading && !isError && visibleItems.map((teacher, index) => (
                            <div key={teacher.teacher_id} className="flex items-center gap-4 rounded-lg border p-4 hover:bg-muted transition-colors whitespace-nowrap">
                                <div className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${index === 0 ? 'bg-yellow-500 text-white' :
                                    index === 1 ? 'bg-gray-400 text-white' :
                                        index === 2 ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'
                                    }`}>
                                    {teacher.rank}
                                </div>
                                <Avatar>
                                    <AvatarFallback>{getInitials(teacher.name)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-[220px] flex-1">
                                    <p className="font-medium">{teacher.name}</p>
                                    <p className="text-sm text-muted-foreground">{teacher.department} • {teacher.employee_id}</p>
                                </div>
                                <div className="ml-auto flex items-center gap-4">
                                <div className="text-center">
                                    <div className="flex items-center gap-1">
                                        {[...Array(5)].map((_, i) => (
                                            <Star key={i} className={`h-3 w-3 ${i < Math.floor(teacher.rating) ? 'fill-yellow-500 text-yellow-500' : 'text-muted'}`} />
                                        ))}
                                    </div>
                                    <p className="mt-1 text-sm font-medium">{teacher.rating}</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-bold text-primary">{teacher.students_count}</p>
                                    <p className="text-xs text-muted-foreground">Students</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge
                                        variant="outline"
                                        className={`text-xs ${teacher.status === 'active' ? 'border-green-500 text-green-600' : 'border-amber-500 text-amber-600'}`}
                                    >
                                        {teacher.status || 'active'}
                                    </Badge>
                                    <Badge variant={
                                        index === 0 ? 'success' :
                                            index < 3 ? 'default' : 'secondary'
                                    }>
                                        {index === 0 ? (
                                            <><Trophy className="h-3 w-3 mr-1" />Top Performer</>
                                        ) : (
                                            `Rank #${teacher.rank}`
                                        )}
                                    </Badge>
                                </div>
                                </div>
                            </div>
                        ))}
                        {hasMore && (
                            <div ref={sentinelRef} className="flex justify-center py-3">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        )}
                    </div>
                    </div>
                </CardContent>
            </Card >
        </div >
    )
}
