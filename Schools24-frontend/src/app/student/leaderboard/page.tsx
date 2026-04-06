"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { cn, getInitials } from "@/lib/utils"
import { LeaderboardPodium, type PodiumItem } from "@/components/admin/leaderboard/LeaderboardPodium"
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver"
import {
  Trophy,
  Loader2,
  ChevronDown,
  BookOpen,
  ClipboardList,
  GraduationCap,
  BarChart3,
} from "lucide-react"

interface QuizLeaderboardEntry {
  student_id: string
  student_name: string
  total_quizzes: number
  quizzes_attempted: number
  avg_best_pct: number
  rating: number
  rank: number
  is_current_student: boolean
}

interface QuizLeaderboardResponse {
  class_id: string
  class_name: string
  total_quizzes: number
  total_students: number
  entries: QuizLeaderboardEntry[]
  my_entry?: QuizLeaderboardEntry
}

interface AssessmentLeaderboardEntry {
  student_id: string
  student_name: string
  total_assessments: number
  assessments_with_scores: number
  avg_assessment_pct: number
  rank: number
  is_current_student: boolean
}

interface AssessmentLeaderboardResponse {
  class_id: string
  class_name: string
  total_assessments: number
  total_students: number
  entries: AssessmentLeaderboardEntry[]
  my_entry?: AssessmentLeaderboardEntry
}

interface SchoolAssessmentLeaderboardEntry {
  student_id: string
  student_name: string
  class_name: string
  assessments_with_scores: number
  avg_assessment_pct: number
  rank: number
  is_current_student: boolean
}

interface SchoolAssessmentLeaderboardResponse {
  total_students: number
  entries: SchoolAssessmentLeaderboardEntry[]
  my_entry?: SchoolAssessmentLeaderboardEntry
}

type LeaderboardMode = "quiz" | "assessments" | "school-assessments"

interface LeaderboardRow {
  id: string
  rank: number
  name: string
  subtitle: string
  score: number
  scoreText: string
  metric1Label: string
  metric1Value: string
  metric2Label: string
  metric2Value: string
  metric3Label: string
  metric3Value: string
  isCurrentStudent: boolean
}

const BATCH_SIZE = 20

function getModeLabel(mode: LeaderboardMode): string {
  if (mode === "quiz") return "Quiz"
  if (mode === "assessments") return "My Class (Exams)"
  return "Whole School (Exams)"
}

export default function StudentLeaderboardPage() {
  const router = useRouter()
  const [mode, setMode] = useState<LeaderboardMode>("quiz")
  const [displayedCount, setDisplayedCount] = useState(BATCH_SIZE)

  const quizQuery = useQuery<QuizLeaderboardResponse>({
    queryKey: ["student-quiz-leaderboard"],
    queryFn: () =>
      api.getOrEmpty<QuizLeaderboardResponse>(
        "/student/leaderboard/quiz",
        { class_id: "", class_name: "", total_quizzes: 0, total_students: 0, entries: [], my_entry: undefined },
      ),
    staleTime: 60_000,
    enabled: mode === "quiz",
  })

  const classAssessmentsQuery = useQuery<AssessmentLeaderboardResponse>({
    queryKey: ["student-assessment-leaderboard"],
    queryFn: () =>
      api.getOrEmpty<AssessmentLeaderboardResponse>(
        "/student/leaderboard/assessments",
        { class_id: "", class_name: "", total_assessments: 0, total_students: 0, entries: [], my_entry: undefined },
      ),
    staleTime: 60_000,
    enabled: mode === "assessments",
  })

  const schoolAssessmentsQuery = useQuery<SchoolAssessmentLeaderboardResponse>({
    queryKey: ["student-school-assessment-leaderboard"],
    queryFn: () =>
      api.getOrEmpty<SchoolAssessmentLeaderboardResponse>(
        "/student/leaderboard/school-assessments",
        { total_students: 0, entries: [], my_entry: undefined },
      ),
    staleTime: 5 * 60_000,
    enabled: mode === "school-assessments",
  })

  const activeQuery =
    mode === "quiz"
      ? quizQuery
      : mode === "assessments"
      ? classAssessmentsQuery
      : schoolAssessmentsQuery

  const rows = useMemo<LeaderboardRow[]>(() => {
    if (mode === "quiz") {
      return (quizQuery.data?.entries || []).map((entry) => ({
        id: entry.student_id,
        rank: entry.rank,
        name: entry.student_name,
        subtitle: `${entry.quizzes_attempted}/${entry.total_quizzes} quizzes`,
        score: entry.rating,
        scoreText: `${entry.rating.toFixed(2)}/5.0`,
        metric1Label: "Rating",
        metric1Value: `${entry.rating.toFixed(2)}`,
        metric2Label: "Avg Quiz",
        metric2Value: `${entry.avg_best_pct.toFixed(1)}%`,
        metric3Label: "Activity",
        metric3Value: `${entry.quizzes_attempted}`,
        isCurrentStudent: entry.is_current_student,
      }))
    }

    if (mode === "assessments") {
      return (classAssessmentsQuery.data?.entries || []).map((entry) => ({
        id: entry.student_id,
        rank: entry.rank,
        name: entry.student_name,
        subtitle: `${entry.assessments_with_scores}/${entry.total_assessments} assessments`,
        score: entry.avg_assessment_pct,
        scoreText: `${entry.avg_assessment_pct.toFixed(2)}%`,
        metric1Label: "Avg",
        metric1Value: `${entry.avg_assessment_pct.toFixed(2)}%`,
        metric2Label: "Scored",
        metric2Value: `${entry.assessments_with_scores}`,
        metric3Label: "Total",
        metric3Value: `${entry.total_assessments}`,
        isCurrentStudent: entry.is_current_student,
      }))
    }

    return (schoolAssessmentsQuery.data?.entries || []).map((entry) => ({
      id: entry.student_id,
      rank: entry.rank,
      name: entry.student_name,
      subtitle: `${entry.class_name} • ${entry.assessments_with_scores} exams`,
      score: entry.avg_assessment_pct,
      scoreText: `${entry.avg_assessment_pct.toFixed(2)}%`,
      metric1Label: "Avg",
      metric1Value: `${entry.avg_assessment_pct.toFixed(2)}%`,
      metric2Label: "Class",
      metric2Value: entry.class_name,
      metric3Label: "Exams",
      metric3Value: `${entry.assessments_with_scores}`,
      isCurrentStudent: entry.is_current_student,
    }))
  }, [mode, quizQuery.data?.entries, classAssessmentsQuery.data?.entries, schoolAssessmentsQuery.data?.entries])

  const topThreeRows = useMemo(() => rows.filter((row) => row.rank <= 3).slice(0, 3), [rows])

  const podiumItems = useMemo<PodiumItem[]>(
    () =>
      topThreeRows.map((row) => ({
        id: row.id,
        rank: row.rank,
        name: row.name,
        subtitle: row.subtitle,
        score: Number(mode === "quiz" ? row.score.toFixed(2) : row.score.toFixed(1)),
        scoreLabel: mode === "quiz" ? "Rating" : "Assessment Avg",
        trend: "stable",
        secondaryMetric: {
          value: Number(row.metric3Value.replace(/[^0-9.]/g, "") || "0"),
          label: mode === "quiz" ? "Quizzes" : "Exams",
        },
        avatarUrl: undefined,
      })),
    [topThreeRows, mode],
  )

  const { ref: sentinelRef, inView } = useIntersectionObserver({ threshold: 0.1 })
  const visibleRows = rows.slice(0, displayedCount)
  const hasMore = displayedCount < rows.length

  useEffect(() => {
    if (inView && hasMore) {
      setDisplayedCount((count) => Math.min(count + BATCH_SIZE, rows.length))
    }
  }, [inView, hasMore, rows.length])

  useEffect(() => {
    setDisplayedCount(BATCH_SIZE)
  }, [mode, rows.length])

  const headerDescription =
    mode === "quiz"
      ? `${quizQuery.data?.class_name || "Class"} • ${quizQuery.data?.total_students || 0} students`
      : mode === "assessments"
      ? `${classAssessmentsQuery.data?.class_name || "Class"} • ${classAssessmentsQuery.data?.total_students || 0} students`
      : `${schoolAssessmentsQuery.data?.total_students || 0} students across school`

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold md:text-3xl">Students Leaderboard</h1>
          <p className="text-muted-foreground">{headerDescription}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-center sm:w-auto">
                {mode === "quiz" ? <BookOpen className="mr-2 h-4 w-4" /> : mode === "assessments" ? <ClipboardList className="mr-2 h-4 w-4" /> : <GraduationCap className="mr-2 h-4 w-4" />}
                {getModeLabel(mode)}
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setMode("quiz")}>Quiz</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("assessments")}>My Class (Exams)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode("school-assessments")}>Whole School (Exams)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="w-full sm:w-auto" onClick={() => router.push("/student/performance")}>
            <BarChart3 className="mr-2 h-4 w-4" />
            View Performance
          </Button>
        </div>
      </div>

      {activeQuery.isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading leaderboard...
          </CardContent>
        </Card>
      )}

      {activeQuery.isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Failed to load leaderboard.
          </CardContent>
        </Card>
      )}

      {!activeQuery.isLoading && !activeQuery.isError && rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No leaderboard data available yet.
          </CardContent>
        </Card>
      )}

      {!activeQuery.isLoading && !activeQuery.isError && rows.length > 0 && (
        <>
          <div className="mb-12">
            <LeaderboardPodium type="student" items={podiumItems} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Full Rankings</CardTitle>
              <CardDescription>
                {mode === "quiz"
                  ? "Students are ranked using quiz rating and average best score."
                  : mode === "assessments"
                  ? "Students are ranked within your class using assessment averages."
                  : "Students are ranked across the whole school using assessment averages."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="min-w-[760px] space-y-2">
                  {visibleRows.map((row, index) => (
                    <div
                      key={`${row.id}-${row.rank}`}
                      className={cn(
                        "grid grid-cols-[auto_auto_minmax(220px,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 px-3 py-3 transition-colors hover:bg-muted/50 whitespace-nowrap",
                        row.isCurrentStudent && "bg-teal-500/10 border-teal-500/40",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-full font-bold shadow-sm",
                          row.rank === 1
                            ? "bg-yellow-500 text-white"
                            : row.rank === 2
                            ? "bg-gray-400 text-white"
                            : row.rank === 3
                            ? "bg-amber-600 text-white"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        #{row.rank}
                      </div>
                      <Avatar className="h-11 w-11">
                        <AvatarFallback>{getInitials(row.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-[260px]">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{row.name}</p>
                          {row.isCurrentStudent && (
                            <Badge className="px-2 py-1 text-[10px] uppercase">You</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{row.subtitle}</p>
                      </div>
                      <div className="ml-auto flex items-center gap-3">
                        <div className="grid min-w-[400px] grid-cols-4 gap-3 text-center">
                          <div>
                            <p className="text-lg font-bold text-primary">{row.scoreText}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Score</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold">{row.metric1Value}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{row.metric1Label}</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold">{row.metric2Value}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{row.metric2Label}</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold">{row.metric3Value}</p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{row.metric3Label}</p>
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
                              `Rank #${row.rank}`
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
