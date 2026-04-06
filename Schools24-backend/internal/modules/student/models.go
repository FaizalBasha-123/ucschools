package student

import (
	"time"

	"github.com/google/uuid"
)

// Student represents a student profile linked to a user
type Student struct {
	ID               uuid.UUID  `json:"id" db:"id"`
	UserID           uuid.UUID  `json:"user_id" db:"user_id"`
	AdmissionNumber  string     `json:"admission_number" db:"admission_number"`
	ApaarID          *string    `json:"apaar_id,omitempty" db:"apaar_id"`
	AbcID            *string    `json:"abc_id,omitempty" db:"abc_id"`
	LearnerID        *uuid.UUID `json:"learner_id,omitempty" db:"learner_id"`
	RollNumber       *string    `json:"roll_number,omitempty" db:"roll_number"`
	ClassID          *uuid.UUID `json:"class_id,omitempty" db:"class_id"`
	Section          *string    `json:"section,omitempty" db:"section"`
	DateOfBirth      time.Time  `json:"date_of_birth" db:"date_of_birth"`
	Gender           string     `json:"gender" db:"gender"`
	BloodGroup       *string    `json:"blood_group,omitempty" db:"blood_group"`
	Address          *string    `json:"address,omitempty" db:"address"`
	ParentName       *string    `json:"parent_name,omitempty" db:"parent_name"`
	ParentEmail      *string    `json:"parent_email,omitempty" db:"parent_email"`
	ParentPhone      *string    `json:"parent_phone,omitempty" db:"parent_phone"`
	EmergencyContact *string    `json:"emergency_contact,omitempty" db:"emergency_contact"`
	AdmissionDate    time.Time  `json:"admission_date" db:"admission_date"`
	AcademicYear     string     `json:"academic_year" db:"academic_year"`
	BusRouteID       *uuid.UUID `json:"bus_route_id,omitempty" db:"bus_route_id"`
	TransportMode    *string    `json:"transport_mode,omitempty" db:"transport_mode"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	FullName     string `json:"full_name,omitempty"`
	Email        string `json:"email,omitempty"`
	ClassName    string `json:"class_name,omitempty"`
	CurrentGrade string `json:"current_grade,omitempty"` // Academic grade: A+, A, B+, B, C, D, F, or X (Not Graded)

	// Extra fields for list view
	AttendanceStats *AttendanceStats `json:"attendance_stats,omitempty"`
	Fees            *Fees            `json:"fees,omitempty"`
}

type Fees struct {
	Status string  `json:"status"`
	Paid   float64 `json:"paid"`
	Total  float64 `json:"total"`
}

// Class represents a school class
type Class struct {
	ID             uuid.UUID  `json:"id" db:"id"`
	SchoolID       *uuid.UUID `json:"school_id,omitempty" db:"school_id"`
	Name           string     `json:"name" db:"name"`
	Grade          *int       `json:"grade,omitempty" db:"grade"` // nullable: custom catalog classes have no numeric grade
	Section        *string    `json:"section,omitempty" db:"section"`
	ClassTeacherID *uuid.UUID `json:"class_teacher_id,omitempty" db:"class_teacher_id"`
	AcademicYear   string     `json:"academic_year" db:"academic_year"`
	TotalStudents  int        `json:"total_students" db:"total_students"`
	RoomNumber     *string    `json:"room_number,omitempty" db:"room_number"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	ClassTeacherName string `json:"class_teacher_name,omitempty"`
}

// UpdateClassRequest for updating class details
type UpdateClassRequest struct {
	Name           *string `json:"name,omitempty"`
	Grade          *int    `json:"grade,omitempty"`
	Section        *string `json:"section,omitempty"`
	AcademicYear   *string `json:"academic_year,omitempty"`
	RoomNumber     *string `json:"room_number,omitempty"`
	ClassTeacherID *string `json:"class_teacher_id,omitempty"`
}

// Attendance represents daily attendance record
type Attendance struct {
	ID        uuid.UUID  `json:"id" db:"id"`
	StudentID uuid.UUID  `json:"student_id" db:"student_id"`
	ClassID   uuid.UUID  `json:"class_id" db:"class_id"`
	Date      time.Time  `json:"date" db:"date"`
	Status    string     `json:"status" db:"status"` // present, absent, late, excused
	MarkedBy  *uuid.UUID `json:"marked_by,omitempty" db:"marked_by"`
	Remarks   *string    `json:"remarks,omitempty" db:"remarks"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
}

// AttendanceStatus constants
const (
	StatusPresent = "present"
	StatusAbsent  = "absent"
	StatusLate    = "late"
	StatusExcused = "excused"
)

// StudentDashboard represents dashboard data for a student
type StudentDashboard struct {
	Student          *Student          `json:"student"`
	Class            *Class            `json:"class"`
	AttendanceStats  *AttendanceStats  `json:"attendance_stats"`
	RecentAttendance []Attendance      `json:"recent_attendance"`
	UpcomingQuizzes  []UpcomingQuiz    `json:"upcoming_quizzes"`
	PendingHomework  []PendingHomework `json:"pending_homework"`
}

// AttendanceStats shows attendance summary
type AttendanceStats struct {
	TotalDays         int     `json:"total_days"`
	PresentDays       int     `json:"present_days"`
	AbsentDays        int     `json:"absent_days"`
	LateDays          int     `json:"late_days"`
	AttendancePercent float64 `json:"attendance_percent"`
}

// UpcomingQuiz for dashboard (placeholder until Quiz module)
type UpcomingQuiz struct {
	ID       uuid.UUID `json:"id"`
	Title    string    `json:"title"`
	Subject  string    `json:"subject"`
	DueDate  time.Time `json:"due_date"`
	MaxMarks int       `json:"max_marks"`
}

// PendingHomework for dashboard (placeholder until Homework module)
type PendingHomework struct {
	ID          uuid.UUID `json:"id"`
	Title       string    `json:"title"`
	Subject     string    `json:"subject"`
	DueDate     time.Time `json:"due_date"`
	Description string    `json:"description"`
}

type StudentClassSubject struct {
	SubjectID uuid.UUID `json:"subject_id"`
	Name      string    `json:"name"`
	Code      string    `json:"code"`
}

type StudentFeeBreakdownItem struct {
	ID          uuid.UUID  `json:"id"`
	PurposeID   *uuid.UUID `json:"purpose_id,omitempty"`
	PurposeName string     `json:"purpose_name"`
	Amount      float64    `json:"amount"`
	PaidAmount  float64    `json:"paid_amount"`
	Status      string     `json:"status"`
	DueDate     *time.Time `json:"due_date,omitempty"`
}

type StudentPaymentHistoryItem struct {
	ID            uuid.UUID  `json:"id"`
	Amount        float64    `json:"amount"`
	PaymentMethod string     `json:"payment_method"`
	PaymentDate   time.Time  `json:"payment_date"`
	Status        string     `json:"status"`
	ReceiptNumber string     `json:"receipt_number"`
	TransactionID *string    `json:"transaction_id,omitempty"`
	Purpose       *string    `json:"purpose,omitempty"`
	StudentFeeID  *uuid.UUID `json:"student_fee_id,omitempty"`
}

type StudentFeesResponse struct {
	StudentID      uuid.UUID                   `json:"student_id"`
	AcademicYear   string                      `json:"academic_year"`
	TotalAmount    float64                     `json:"total_amount"`
	PaidAmount     float64                     `json:"paid_amount"`
	PendingAmount  float64                     `json:"pending_amount"`
	Breakdown      []StudentFeeBreakdownItem   `json:"breakdown"`
	PaymentHistory []StudentPaymentHistoryItem `json:"payment_history"`
}

type FeedbackTeacherOption struct {
	TeacherID   uuid.UUID `json:"teacher_id"`
	TeacherName string    `json:"teacher_name"`
	SubjectName string    `json:"subject_name"`
	Label       string    `json:"label"`
}

type StudentFeedback struct {
	ID           uuid.UUID  `json:"id"`
	FeedbackType string     `json:"feedback_type"`
	TeacherID    *uuid.UUID `json:"teacher_id,omitempty"`
	TeacherName  string     `json:"teacher_name,omitempty"`
	SubjectName  *string    `json:"subject_name,omitempty"`
	Rating       int        `json:"rating"`
	Message      string     `json:"message"`
	IsAnonymous  bool       `json:"is_anonymous"`
	Status       string     `json:"status"`
	ResponseText *string    `json:"response_text,omitempty"`
	RespondedAt  *time.Time `json:"responded_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type StudentStudyMaterial struct {
	ID           string    `json:"id"`
	UploaderID   string    `json:"uploader_id,omitempty"`
	UploaderName string    `json:"uploader_name,omitempty"`
	UploaderRole string    `json:"uploader_role,omitempty"`
	TeacherID    string    `json:"teacher_id,omitempty"`
	TeacherName  string    `json:"teacher_name,omitempty"`
	SchoolID     string    `json:"school_id,omitempty"`
	Title        string    `json:"title"`
	Subject      string    `json:"subject"`
	ClassLevel   string    `json:"class_level"`
	Description  string    `json:"description,omitempty"`
	FileName     string    `json:"file_name"`
	FileSize     int64     `json:"file_size"`
	MimeType     string    `json:"mime_type"`
	FileSHA256   string    `json:"file_sha256,omitempty"`
	UploadedAt   time.Time `json:"uploaded_at"`
	Content      []byte    `json:"-"`
}

type StudentReportDocument struct {
	ID           string    `json:"id"`
	TeacherID    string    `json:"teacher_id,omitempty"`
	TeacherName  string    `json:"teacher_name,omitempty"`
	SchoolID     string    `json:"school_id,omitempty"`
	StudentID    string    `json:"student_id,omitempty"`
	StudentName  string    `json:"student_name,omitempty"`
	ClassName    string    `json:"class_name,omitempty"`
	Title        string    `json:"title"`
	ReportType   string    `json:"report_type,omitempty"`
	ClassLevel   string    `json:"class_level"`
	AcademicYear string    `json:"academic_year,omitempty"`
	Description  string    `json:"description,omitempty"`
	FileName     string    `json:"file_name"`
	FileSize     int64     `json:"file_size"`
	MimeType     string    `json:"mime_type"`
	FileSHA256   string    `json:"file_sha256,omitempty"`
	UploadedAt   time.Time `json:"uploaded_at"`
	Content      []byte    `json:"-"`
}

type CreateStudentFeedbackRequest struct {
	FeedbackType string `json:"feedback_type" binding:"required"`
	TeacherID    string `json:"teacher_id" binding:"required,uuid"`
	SubjectName  string `json:"subject_name,omitempty"`
	Rating       int    `json:"rating" binding:"required"`
	Message      string `json:"message" binding:"required"`
	IsAnonymous  bool   `json:"is_anonymous"`
}

// CreateStudentRequest for creating student profile
type CreateStudentRequest struct {
	UserID          uuid.UUID `json:"user_id" binding:"required"`
	AdmissionNumber string    `json:"admission_number" binding:"required"`
	ApaarID         string    `json:"apaar_id,omitempty"`
	AbcID           string    `json:"abc_id,omitempty"`
	RollNumber      string    `json:"roll_number,omitempty"`
	ClassID         string    `json:"class_id,omitempty"`
	Section         string    `json:"section,omitempty"`
	DateOfBirth     string    `json:"date_of_birth" binding:"required"` // YYYY-MM-DD
	Gender          string    `json:"gender" binding:"required,oneof=male female other"`
	BloodGroup      string    `json:"blood_group,omitempty"`
	Address         string    `json:"address,omitempty"`
	ParentName      string    `json:"parent_name,omitempty"`
	ParentEmail     string    `json:"parent_email,omitempty"`
	ParentPhone     string    `json:"parent_phone,omitempty"`

	EmergencyContact string `json:"emergency_contact,omitempty"`
	AcademicYear     string `json:"academic_year" binding:"required"`
}

type CreateStudentProfileForUserRequest struct {
	UserID           string `json:"user_id" binding:"required"`
	AdmissionNumber  string `json:"admission_number,omitempty"`
	ApaarID          string `json:"apaar_id,omitempty"`
	AbcID            string `json:"abc_id,omitempty"`
	RollNumber       string `json:"roll_number,omitempty"`
	ClassID          string `json:"class_id,omitempty"`
	DateOfBirth      string `json:"date_of_birth,omitempty"` // YYYY-MM-DD
	Gender           string `json:"gender,omitempty"`
	BloodGroup       string `json:"blood_group,omitempty"`
	Address          string `json:"address,omitempty"`
	ParentName       string `json:"parent_name,omitempty"`
	ParentEmail      string `json:"parent_email,omitempty"`
	ParentPhone      string `json:"parent_phone,omitempty"`
	EmergencyContact string `json:"emergency_contact,omitempty"`
	AcademicYear     string `json:"academic_year,omitempty"`
	BusRouteID       string `json:"bus_route_id,omitempty"`
	TransportMode    string `json:"transport_mode,omitempty"`
}

// UpdateStudentRequest for updating student profile
type UpdateStudentRequest struct {
	FullName         *string `json:"full_name,omitempty"`
	Email            *string `json:"email,omitempty"`
	AdmissionNumber  *string `json:"admission_number,omitempty"`
	ApaarID          *string `json:"apaar_id,omitempty"`
	AbcID            *string `json:"abc_id,omitempty"`
	RollNumber       *string `json:"roll_number,omitempty"`
	ClassID          *string `json:"class_id,omitempty"`
	BloodGroup       *string `json:"blood_group,omitempty"`
	Address          *string `json:"address,omitempty"`
	ParentName       *string `json:"parent_name,omitempty"`
	ParentEmail      *string `json:"parent_email,omitempty"`
	ParentPhone      *string `json:"parent_phone,omitempty"`
	EmergencyContact *string `json:"emergency_contact,omitempty"`
	DateOfBirth      *string `json:"date_of_birth,omitempty"` // YYYY-MM-DD
	Gender           *string `json:"gender,omitempty"`
	AdmissionDate    *string `json:"admission_date,omitempty"` // YYYY-MM-DD
	AcademicYear     *string `json:"academic_year,omitempty"`
	BusRouteID       *string `json:"bus_route_id,omitempty"`
	TransportMode    *string `json:"transport_mode,omitempty"`
}

// ─── Quiz models ──────────────────────────────────────────────────────────────

// StudentQuizListItem represents one quiz row in the student quiz list.
type StudentQuizListItem struct {
	ID              string    `json:"id"`
	QuizSource      string    `json:"quiz_source"`
	Title           string    `json:"title"`
	ChapterName     string    `json:"chapter_name"`
	ClassName       string    `json:"class_name"`
	SubjectName     string    `json:"subject_name"`
	ScheduledAt     time.Time `json:"scheduled_at"`
	IsAnytime       bool      `json:"is_anytime"`
	DurationMinutes int       `json:"duration_minutes"`
	TotalMarks      int       `json:"total_marks"`
	QuestionCount   int       `json:"question_count"`
	Status          string    `json:"status"` // upcoming | active | completed
	CreatorRole     string    `json:"creator_role"`
	CreatorName     string    `json:"creator_name"`
	AttemptCount    int       `json:"attempt_count"`
	BestScore       *int      `json:"best_score,omitempty"`
	BestPercentage  *float64  `json:"best_percentage,omitempty"`
	BestAttemptID   *string   `json:"best_attempt_id,omitempty"`
}

// StudentQuizOption is one answer option shown during a quiz attempt (no is_correct).
type StudentQuizOption struct {
	ID         string `json:"id"`
	OptionText string `json:"option_text"`
	OrderIndex int    `json:"order_index"`
}

// StudentQuizQuestion is one question shown during a quiz attempt.
type StudentQuizQuestion struct {
	ID           string              `json:"id"`
	QuestionText string              `json:"question_text"`
	Marks        int                 `json:"marks"`
	OrderIndex   int                 `json:"order_index"`
	Options      []StudentQuizOption `json:"options"`
}

// StartAttemptResponse is returned when a student starts/resumes a quiz.
type StartAttemptResponse struct {
	AttemptID       string                `json:"attempt_id"`
	QuizID          string                `json:"quiz_id"`
	QuizSource      string                `json:"quiz_source"`
	QuizTitle       string                `json:"quiz_title"`
	SubjectName     string                `json:"subject_name"`
	DurationMinutes int                   `json:"duration_minutes"`
	TotalMarks      int                   `json:"total_marks"`
	StartedAt       time.Time             `json:"started_at"`
	DeadlineAt      time.Time             `json:"deadline_at"`
	Questions       []StudentQuizQuestion `json:"questions"`
}

// SubmitQuizAnswer is one answer in a submit request.
type SubmitQuizAnswer struct {
	QuestionID       string `json:"question_id" binding:"required"`
	SelectedOptionID string `json:"selected_option_id"` // empty = skipped
}

// SubmitQuizRequest is the student's quiz submission body.
type SubmitQuizRequest struct {
	AttemptID string             `json:"attempt_id" binding:"required"`
	Answers   []SubmitQuizAnswer `json:"answers" binding:"required"`
}

// ReviewOption is an option in the post-submit result review (shows correctness).
type ReviewOption struct {
	ID         string `json:"id"`
	OptionText string `json:"option_text"`
	IsCorrect  bool   `json:"is_correct"`
	IsSelected bool   `json:"is_selected"`
	OrderIndex int    `json:"order_index"`
}

// ReviewQuestion is a question in the post-submit result review.
type ReviewQuestion struct {
	ID            string         `json:"id"`
	QuestionText  string         `json:"question_text"`
	Marks         int            `json:"marks"`
	MarksObtained int            `json:"marks_obtained"`
	OrderIndex    int            `json:"order_index"`
	Options       []ReviewOption `json:"options"`
}

// StudentQuizResult is the full result returned after submission or when viewing an old attempt.
type StudentQuizResult struct {
	AttemptID      string           `json:"attempt_id"`
	QuizID         string           `json:"quiz_id"`
	QuizSource     string           `json:"quiz_source"`
	QuizTitle      string           `json:"quiz_title"`
	SubjectName    string           `json:"subject_name"`
	Score          int              `json:"score"`
	TotalMarks     int              `json:"total_marks"`
	Percentage     float64          `json:"percentage"`
	IsNewBest      bool             `json:"is_new_best"`
	BestScore      int              `json:"best_score"`
	BestPercentage float64          `json:"best_percentage"`
	SubmittedAt    time.Time        `json:"submitted_at"`
	Questions      []ReviewQuestion `json:"questions"`
}

// ─── Quiz Leaderboard models ──────────────────────────────────────────────────

// QuizLeaderboardEntry represents one student's quiz rating in the class leaderboard.
// Rating (0–5) = average of best-attempt percentages across ALL quizzes in the class / 20.
// Unattempted quizzes contribute 0%, so adding a new quiz reduces everyone's rating
// until they complete it.
type QuizLeaderboardEntry struct {
	StudentID        string  `json:"student_id"`
	StudentName      string  `json:"student_name"`
	TotalQuizzes     int     `json:"total_quizzes"`     // total quizzes in class
	QuizzesAttempted int     `json:"quizzes_attempted"` // quizzes student completed ≥ 1 attempt
	AvgBestPct       float64 `json:"avg_best_pct"`      // 0–100
	Rating           float64 `json:"rating"`            // 0.00–5.00
	Rank             int     `json:"rank"`
	IsCurrentStudent bool    `json:"is_current_student"`
}

// QuizLeaderboardResponse is the full leaderboard payload returned to the student.
type QuizLeaderboardResponse struct {
	ClassID       string                 `json:"class_id"`
	ClassName     string                 `json:"class_name"`
	TotalQuizzes  int                    `json:"total_quizzes"`
	TotalStudents int                    `json:"total_students"`
	Entries       []QuizLeaderboardEntry `json:"entries"`
	MyEntry       *QuizLeaderboardEntry  `json:"my_entry,omitempty"`
}

type AssessmentLeaderboardEntry struct {
	StudentID             string  `json:"student_id"`
	StudentName           string  `json:"student_name"`
	TotalAssessments      int     `json:"total_assessments"`
	AssessmentsWithScores int     `json:"assessments_with_scores"`
	AvgAssessmentPct      float64 `json:"avg_assessment_pct"`
	Rank                  int     `json:"rank"`
	IsCurrentStudent      bool    `json:"is_current_student"`
}

type AssessmentLeaderboardResponse struct {
	ClassID          string                       `json:"class_id"`
	ClassName        string                       `json:"class_name"`
	TotalAssessments int                          `json:"total_assessments"`
	TotalStudents    int                          `json:"total_students"`
	Entries          []AssessmentLeaderboardEntry `json:"entries"`
	MyEntry          *AssessmentLeaderboardEntry  `json:"my_entry,omitempty"`
}

type StudentAssessmentStage struct {
	AssessmentID   uuid.UUID  `json:"assessment_id"`
	Name           string     `json:"name"`
	AssessmentType string     `json:"assessment_type"`
	ScheduledDate  *time.Time `json:"scheduled_date,omitempty"`
	Completed      bool       `json:"completed"`
}

type StudentAssessmentStagesResponse struct {
	ClassID        string                   `json:"class_id"`
	ClassName      string                   `json:"class_name"`
	AcademicYear   string                   `json:"academic_year"`
	CompletedCount int                      `json:"completed_count"`
	TotalCount     int                      `json:"total_count"`
	Stages         []StudentAssessmentStage `json:"stages"`
}

// ─── Student Messages models ────────────────────────────────────────────────

type StudentClassMessage struct {
	ID         uuid.UUID `json:"id"`
	ClassID    uuid.UUID `json:"class_id"`
	SenderID   uuid.UUID `json:"sender_id"`
	SenderName string    `json:"sender_name"`
	SenderRole string    `json:"sender_role"`
	Content    string    `json:"content"`
	CreatedAt  time.Time `json:"created_at"`
}

type StudentClassMessagesPage struct {
	ClassID    string                `json:"class_id"`
	ClassName  string                `json:"class_name"`
	Messages   []StudentClassMessage `json:"messages"`
	Page       int64                 `json:"page"`
	PageSize   int64                 `json:"page_size"`
	HasMore    bool                  `json:"has_more"`
	NextPage   int64                 `json:"next_page"`
	TotalCount int                   `json:"total_count"`
}

type SendStudentClassMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

// ─── Subject Performance ─────────────────────────────────────────────────────

// SubjectPerformanceEntry holds a student's aggregated marks for one subject.
type SubjectPerformanceEntry struct {
	SubjectID       string  `json:"subject_id"`
	SubjectName     string  `json:"subject_name"`
	AvgPercentage   float64 `json:"avg_percentage"`   // average % across assessments with marks
	TotalObtained   float64 `json:"total_obtained"`   // sum of marks_obtained
	TotalMax        float64 `json:"total_max"`        // sum of configured max_marks
	AssessmentCount int     `json:"assessment_count"` // number of assessments with marks
	GradeLetter     string  `json:"grade_letter"`     // derived grade letter
}

type StudentSubjectPerformanceResponse struct {
	AcademicYear string                    `json:"academic_year"`
	ClassName    string                    `json:"class_name"`
	Subjects     []SubjectPerformanceEntry `json:"subjects"`
}

// SchoolAssessmentLeaderboardEntry is one student's position in the school-wide ranking.
// Score = mean of per-assessment per-subject percentage averages across ALL assessments
// matched to that student's class grade.
type SchoolAssessmentLeaderboardEntry struct {
	StudentID             string  `json:"student_id"`
	StudentName           string  `json:"student_name"`
	ClassName             string  `json:"class_name"`
	AssessmentsWithScores int     `json:"assessments_with_scores"`
	AvgAssessmentPct      float64 `json:"avg_assessment_pct"`
	Rank                  int     `json:"rank"`
	IsCurrentStudent      bool    `json:"is_current_student"`
}

// SchoolAssessmentLeaderboardResponse is the envelope for GET /student/leaderboard/school-assessments.
type SchoolAssessmentLeaderboardResponse struct {
	TotalStudents int                                `json:"total_students"`
	Entries       []SchoolAssessmentLeaderboardEntry `json:"entries"`
	MyEntry       *SchoolAssessmentLeaderboardEntry  `json:"my_entry,omitempty"`
}
