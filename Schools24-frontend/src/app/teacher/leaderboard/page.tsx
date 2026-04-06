"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { getInitials } from "@/lib/utils"
import { useTeacherLeaderboard } from "@/hooks/useTeacherLeaderboard"
import { LeaderboardPodium, type PodiumItem } from "@/components/admin/leaderboard/LeaderboardPodium"
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver"
import { Trophy, Loader2, Star } from "lucide-react"

const BATCH_SIZE = 20

export default function TeacherLeaderboardPage() {
  const { data, isLoading, isError } = useTeacherLeaderboard()

  const topThree = data?.top_3 || []
  const fullItems = data?.items || []

  const podiumItems = useMemo<PodiumItem[]>(
    () =>
      topThree.map((t) => ({
        id: t.teacher_id,
        rank: t.rank,
        name: t.name,
        subtitle: t.department || "Teacher",
        score: Number(t.rating.toFixed(2)),
        scoreLabel: "Rating",
        trend: t.trend,
        secondaryMetric: {
          value: t.students_count,
          label: "Students",
        },
        avatarUrl: undefined,
      })),
    [topThree],
  )

  const [displayedCount, setDisplayedCount] = useState(BATCH_SIZE)
  const visibleItems = fullItems.slice(0, displayedCount)
  const hasMore = displayedCount < fullItems.length

  const { ref: sentinelRef, inView } = useIntersectionObserver({ threshold: 0.1 })

  useEffect(() => {
    if (inView && hasMore) {
      setDisplayedCount((count) => Math.min(count + BATCH_SIZE, fullItems.length))
    }
  }, [inView, hasMore, fullItems.length])

  useEffect(() => {
    setDisplayedCount(BATCH_SIZE)
  }, [fullItems.length])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold md:text-3xl">Teachers Leaderboard</h1>
          <p className="text-muted-foreground">Top performing teachers based on ratings and classroom activity</p>
        </div>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading leaderboard...
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Failed to load teacher leaderboard.
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && fullItems.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No leaderboard data available yet.
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && fullItems.length > 0 && (
        <>
          <div className="mb-12">
            <LeaderboardPodium type="teacher" items={podiumItems} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Full Rankings</CardTitle>
              <CardDescription>Teachers are ranked by rating, student count, and profile activity.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="min-w-[760px] space-y-2">
                  {visibleItems.map((teacher, index) => (
                    <div
                      key={teacher.teacher_id}
                      className="grid grid-cols-[auto_auto_minmax(220px,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 px-3 py-3 transition-colors hover:bg-muted/50 whitespace-nowrap"
                    >
                      <div
                        className={`flex h-11 w-11 items-center justify-center rounded-full font-bold shadow-sm ${
                          index === 0
                            ? "bg-yellow-500 text-white"
                            : index === 1
                            ? "bg-gray-400 text-white"
                            : index === 2
                            ? "bg-amber-600 text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        #{teacher.rank}
                      </div>
                      <Avatar className="h-11 w-11">
                        <AvatarFallback>{getInitials(teacher.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-[260px]">
                        <p className="font-semibold">{teacher.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {teacher.department || "Department not set"}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-3">
                        <div className="grid min-w-[400px] grid-cols-4 gap-3 text-center">
                          <div>
                            <p className="text-lg font-bold text-primary">{teacher.rating.toFixed(2)}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rating</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold">{teacher.students_count}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Students</p>
                          </div>
                          <div className="flex items-center justify-center gap-1">
                            <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                            <p className="text-lg font-bold">{Math.round(teacher.rating)}</p>
                          </div>
                          <div>
                            <p className="text-sm font-bold capitalize">{teacher.trend}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Trend</p>
                          </div>
                        </div>
                        <Separator orientation="vertical" className="h-10" />
                        <div className="flex min-w-[120px] items-center justify-end gap-2">
                          <Badge variant={index < 3 ? "default" : "secondary"} className="px-2 py-1">
                            {index < 3 ? (
                              <>
                                <Trophy className="mr-1 h-3 w-3" />Top {index + 1}
                              </>
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
          </Card>
        </>
      )}
    </div>
  )
}
