"use client"

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Trophy, Loader2 } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useStudentsLeaderboard } from '@/hooks/useAdminLeaderboards'
import { LeaderboardPodium } from '@/components/admin/leaderboard/LeaderboardPodium'
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'
import { formatSchoolClassLabel } from '@/lib/classOrdering'
import { Separator } from '@/components/ui/separator'

export default function StudentsLeaderboardPage() {
    const searchParams = useSearchParams()
    const schoolId = searchParams.get('school_id') || undefined
    const { user, isLoading } = useAuth()
    const canLoad = !!user && !isLoading && (user.role !== 'super_admin' || !!schoolId)

    const { data, isLoading: isLeaderboardLoading, isError } = useStudentsLeaderboard({
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

    useEffect(() => {
        setDisplayedCount(BATCH_SIZE)
    }, [data])

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold">Students Leaderboard</h1>
                    <p className="text-muted-foreground">School-wide rankings based on combined assessment and quiz performance</p>
                </div>
            </div>

            {/* Top 3 Students */}
            <div className="mb-12">
                <LeaderboardPodium
                    type="student"
                    items={topThree.map(s => ({
                        id: s.student_id,
                        rank: s.rank,
                        name: s.name,
                        subtitle: formatSchoolClassLabel({ name: s.class_name, section: s.section }) || 'Student',
                        score: s.combined_score_pct ?? 0,
                        scoreLabel: "Combined Score",
                        trend: 'stable' as const,
                        secondaryMetric: {
                            value: s.quizzes_attempted + s.assessments_with_scores,
                            label: "Activity"
                        },
                        avatarUrl: undefined
                    }))}
                />
            </div>

            {/* Full Leaderboard */}
            <Card>
                <CardHeader>
                    <CardTitle>Full Rankings</CardTitle>
                    <CardDescription>
                        Students are ranked across the whole school, regardless of class, using the combined academic score.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                    <div className="space-y-2 min-w-[760px]">
                        {isLeaderboardLoading && (
                            <div className="text-sm text-muted-foreground">Loading leaderboard...</div>
                        )}
                        {isError && (
                            <div className="text-sm text-destructive">Failed to load student leaderboard.</div>
                        )}
                        {!isLeaderboardLoading && !isError && visibleItems.map((student, index) => (
                            <div
                                key={student.student_id}
                                className="grid grid-cols-[auto_auto_minmax(220px,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 px-3 py-3 transition-colors hover:bg-muted/50 whitespace-nowrap"
                            >
                                <div className={`flex h-11 w-11 items-center justify-center rounded-full font-bold shadow-sm ${index === 0 ? 'bg-yellow-500 text-white' :
                                    index === 1 ? 'bg-gray-400 text-white' :
                                        index === 2 ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'
                                    }`}>
                                    #{student.rank}
                                </div>
                                <Avatar className="h-11 w-11">
                                    <AvatarFallback>{getInitials(student.name)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-[260px]">
                                    <p className="font-semibold">{student.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {formatSchoolClassLabel({ name: student.class_name, section: student.section }) || 'Class not assigned'}
                                        {' '}• Roll No: {student.roll_number || 'N/A'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Admission No: {student.admission_number || 'N/A'}
                                    </p>
                                </div>
                                <div className="ml-auto flex items-center gap-3">
                                    <div className="grid min-w-[400px] grid-cols-4 gap-3 text-center">
                                        <div>
                                            <p className="text-lg font-bold text-primary">{(student.combined_score_pct ?? 0).toFixed(1)}%</p>
                                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Combined</p>
                                        </div>
                                        <div>
                                            <p className="text-lg font-bold">{(student.avg_assessment_pct ?? 0).toFixed(1)}%</p>
                                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Assess.</p>
                                        </div>
                                        <div>
                                            <p className="text-lg font-bold">{(student.avg_quiz_pct ?? 0).toFixed(1)}%</p>
                                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Quiz</p>
                                        </div>
                                        <div>
                                            <p className="text-lg font-bold">{student.assessments_with_scores + student.quizzes_attempted}</p>
                                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Activity</p>
                                        </div>
                                    </div>
                                    <Separator orientation="vertical" className="h-10" />
                                    <div className="flex min-w-[120px] items-center justify-end gap-2">
                                        <Badge variant={index < 3 ? 'default' : 'secondary'} className="px-2 py-1">
                                            {index < 3 ? <><Trophy className="mr-1 h-3 w-3" />Top {index + 1}</> : `School Rank #${student.rank}`}
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
