package admin

import "time"

// StudentLeaderboardItem is ranked school-wide using a combined academic score:
// assessment average and quiz average are blended into one 0-100 metric.
type StudentLeaderboardItem struct {
	Rank                  int     `json:"rank"`
	StudentID             string  `json:"student_id"`
	Name                  string  `json:"name"`
	AdmissionNumber       string  `json:"admission_number"`
	RollNumber            string  `json:"roll_number,omitempty"`
	ClassName             string  `json:"class_name"`
	Section               string  `json:"section,omitempty"`
	CombinedScorePct      float64 `json:"combined_score_pct"`
	AvgAssessmentPct      float64 `json:"avg_assessment_pct"`
	AssessmentsWithScores int     `json:"assessments_with_scores"`
	AvgQuizPct            float64 `json:"avg_quiz_pct"`
	QuizzesAttempted      int     `json:"quizzes_attempted"`
	TotalQuizzes          int     `json:"total_quizzes"`
}

type TeacherLeaderboardItem struct {
	Rank                int       `json:"rank" db:"rank"`
	TeacherID           string    `json:"teacher_id" db:"teacher_id"`
	Name                string    `json:"name" db:"name"`
	EmployeeID          string    `json:"employee_id" db:"employee_id"`
	Department          string    `json:"department" db:"department"`
	Rating              float64   `json:"rating" db:"rating"`
	StudentsCount       int       `json:"students_count" db:"students_count"`
	Status              string    `json:"status" db:"status"`
	AssignmentsCount    int       `json:"assignments_count" db:"assignments_count"`
	GradedRecordsCount  int       `json:"graded_records_count" db:"graded_records_count"`
	AverageStudentScore float64   `json:"average_student_score" db:"average_student_score"`
	Trend               string    `json:"trend" db:"trend"`
	CompositeScore      float64   `json:"composite_score" db:"composite_score"`
	LastCalculatedAt    time.Time `json:"last_calculated_at" db:"last_calculated_at"`
}

// AdminAssessmentLeaderboardItem represents one student entry in the school-wide
// assessment leaderboard. Score = mean of per-assessment subject-percentage averages.
type AdminAssessmentLeaderboardItem struct {
	Rank                  int     `json:"rank"`
	StudentID             string  `json:"student_id"`
	Name                  string  `json:"name"`
	ClassName             string  `json:"class_name"`
	AvgAssessmentPct      float64 `json:"avg_assessment_pct"`
	AssessmentsWithScores int     `json:"assessments_with_scores"`
}

// AdminAssessmentLeaderboardResponse is the envelope returned by GET /admin/leaderboards/assessments.
type AdminAssessmentLeaderboardResponse struct {
	AcademicYear string                           `json:"academic_year"`
	TotalItems   int                              `json:"total_items"`
	Items        []AdminAssessmentLeaderboardItem `json:"items"`
}

// WeeklyAttendanceDayItem is one day's present/absent totals across all classes.
type WeeklyAttendanceDayItem struct {
	Day     string `json:"day"`
	Present int    `json:"present"`
	Absent  int    `json:"absent"`
}

// WeeklyAttendanceSummaryResponse is returned by GET /admin/attendance/weekly.
type WeeklyAttendanceSummaryResponse struct {
	WeekStart string                    `json:"week_start"`
	WeekEnd   string                    `json:"week_end"`
	Days      []WeeklyAttendanceDayItem `json:"days"`
}
