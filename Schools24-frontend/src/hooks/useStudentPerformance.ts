import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// ─── Subject Performance ─────────────────────────────────────────────────────

export interface SubjectPerformanceEntry {
    subject_id: string
    subject_name: string
    avg_percentage: number
    total_obtained: number
    total_max: number
    assessment_count: number
    grade_letter: string
}

export interface StudentSubjectPerformanceResponse {
    academic_year: string
    class_name: string
    subjects: SubjectPerformanceEntry[]
}

// ─── Assessment Leaderboard (class rank) ─────────────────────────────────────

export interface AssessmentLeaderboardEntry {
    student_id: string
    student_name: string
    total_assessments: number
    assessments_with_scores: number
    avg_assessment_pct: number
    rank: number
    is_current_student: boolean
}

export interface AssessmentLeaderboardResponse {
    class_id: string
    class_name: string
    total_assessments: number
    total_students: number
    entries: AssessmentLeaderboardEntry[]
    my_entry?: AssessmentLeaderboardEntry | null
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useStudentSubjectPerformance() {
    return useQuery({
        queryKey: ['student-subject-performance'],
        queryFn: () =>
            api.getOrEmpty<StudentSubjectPerformanceResponse>(
                '/student/assessments/subject-performance',
                { academic_year: '', class_name: '', subjects: [] },
            ),
        staleTime: 60_000,
    })
}

export function useStudentAssessmentLeaderboard() {
    return useQuery({
        queryKey: ['student-assessment-leaderboard'],
        queryFn: () =>
            api.getOrEmpty<AssessmentLeaderboardResponse>(
                '/student/leaderboard/assessments',
                { class_id: '', class_name: '', total_assessments: 0, total_students: 0, entries: [], my_entry: null },
            ),
        staleTime: 60_000,
    })
}
