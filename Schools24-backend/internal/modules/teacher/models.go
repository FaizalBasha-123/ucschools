package teacher

import (
	"time"

	"github.com/google/uuid"
)

// Teacher represents a teacher profile
type Teacher struct {
	ID             uuid.UUID  `json:"id" db:"id"`
	UserID         uuid.UUID  `json:"user_id" db:"user_id"`
	SchoolID       *uuid.UUID `json:"school_id,omitempty" db:"school_id"`
	EmployeeID     string     `json:"employee_id" db:"employee_id"`
	Department     *string    `json:"department,omitempty" db:"department"`
	Designation    *string    `json:"designation,omitempty" db:"designation"`
	Qualifications []string   `json:"qualifications,omitempty" db:"qualifications"`
	JoiningDate    *time.Time `json:"joining_date,omitempty" db:"joining_date"`
	SubjectsTaught []string   `json:"subjects_taught,omitempty" db:"subjects_taught"`
	Experience     *int       `json:"experience_years,omitempty" db:"experience_years"`
	Salary         *float64   `json:"salary,omitempty" db:"salary"`
	Rating         *float64   `json:"rating,omitempty" db:"rating"`
	Status         *string    `json:"status,omitempty" db:"status"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	FullName string `json:"full_name,omitempty"`
	Email    string `json:"email,omitempty"`
	Phone    string `json:"phone,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}

// TeacherLeaderboardEntry represents a leaderboard row for teachers.
type TeacherLeaderboardEntry struct {
	Rank          int     `json:"rank"`
	TeacherID     string  `json:"teacher_id"`
	Name          string  `json:"name"`
	Department    string  `json:"department"`
	Rating        float64 `json:"rating"`
	StudentsCount int     `json:"students_count"`
	Status        string  `json:"status"`
	Trend         string  `json:"trend"`
}

// TeacherLeaderboardResponse represents the teacher leaderboard payload.
type TeacherLeaderboardResponse struct {
	AcademicYear string                    `json:"academic_year"`
	Items        []TeacherLeaderboardEntry `json:"items"`
	Top3         []TeacherLeaderboardEntry `json:"top_3"`
	MyTeacherID  string                    `json:"my_teacher_id"`
	MyRank       int                       `json:"my_rank"`
	MyRating     float64                   `json:"my_rating"`
	MyStudents   int                       `json:"my_students_count"`
	MyTrend      string                    `json:"my_trend"`
}

// TeacherAssignment represents a teacher's class/subject assignment
type TeacherAssignment struct {
	ID             uuid.UUID  `json:"id" db:"id"`
	TeacherID      uuid.UUID  `json:"teacher_id" db:"teacher_id"`
	ClassID        uuid.UUID  `json:"class_id" db:"class_id"`
	SubjectID      *uuid.UUID `json:"subject_id,omitempty" db:"subject_id"`
	IsClassTeacher bool       `json:"is_class_teacher" db:"is_class_teacher"`
	AcademicYear   string     `json:"academic_year" db:"academic_year"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	ClassName   string `json:"class_name,omitempty"`
	SubjectName string `json:"subject_name,omitempty"`
}

// TeacherDashboard represents the teacher dashboard data
type TeacherDashboard struct {
	Teacher               *Teacher              `json:"teacher"`
	AssignedClasses       []TeacherAssignment   `json:"assigned_classes"`
	TodaySchedule         []TodayPeriod         `json:"today_schedule"`
	TodayUniqueClasses    int                   `json:"today_unique_classes"`
	AssignedClassCount    int                   `json:"assigned_class_count"`
	PendingHomework       int                   `json:"pending_homework_to_grade"`
	HomeworkSubmitted     int                   `json:"homework_submitted"`
	TeacherRank           int                   `json:"teacher_rank"`
	TotalStudents         int                   `json:"total_students"`
	ClassPerformance      []ClassPerformance    `json:"class_performance"`
	UpcomingQuizzes       []DashboardQuizItem   `json:"upcoming_quizzes"`
	RecentStudentActivity []StudentActivityItem `json:"recent_student_activity"`
	AttendanceToday       *AttendanceSummary    `json:"attendance_today"`
	RecentAnnouncements   []Announcement        `json:"recent_announcements"`
}

type ClassPerformance struct {
	ClassID      string  `json:"class_id"`
	ClassName    string  `json:"class_name"`
	AverageScore float64 `json:"average_score"`
	StudentCount int     `json:"student_count"`
}

type DashboardQuizItem struct {
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	SubjectName     string    `json:"subject_name"`
	ClassName       string    `json:"class_name"`
	ScheduledAt     time.Time `json:"scheduled_at"`
	DurationMinutes int       `json:"duration_minutes"`
	IsAnytime       bool      `json:"is_anytime"`
}

type StudentActivityItem struct {
	StudentID     string    `json:"student_id"`
	StudentName   string    `json:"student_name"`
	HomeworkID    string    `json:"homework_id"`
	HomeworkTitle string    `json:"homework_title"`
	SubmittedAt   time.Time `json:"submitted_at"`
	Status        string    `json:"status"`
}

// TodayPeriod represents a period in today's schedule
type TodayPeriod struct {
	PeriodNumber int    `json:"period_number"`
	StartTime    string `json:"start_time"`
	EndTime      string `json:"end_time"`
	ClassID      string `json:"class_id"`
	ClassName    string `json:"class_name"`
	SubjectName  string `json:"subject_name"`
	RoomNumber   string `json:"room_number,omitempty"`
}

// AttendanceSummary for a class
type AttendanceSummary struct {
	TotalStudents int `json:"total_students"`
	Present       int `json:"present"`
	Absent        int `json:"absent"`
	Late          int `json:"late"`
}

// Announcement represents a school announcement
type Announcement struct {
	ID         uuid.UUID  `json:"id" db:"id"`
	Title      string     `json:"title" db:"title"`
	Content    string     `json:"content" db:"content"`
	AuthorID   uuid.UUID  `json:"author_id" db:"author_id"`
	TargetType string     `json:"target_type" db:"target_type"` // all, class, grade, teachers, parents
	TargetID   *uuid.UUID `json:"target_id,omitempty" db:"target_id"`
	Priority   string     `json:"priority" db:"priority"` // low, normal, high, urgent
	IsPinned   bool       `json:"is_pinned" db:"is_pinned"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	AuthorName string `json:"author_name,omitempty"`
}

// Message represents a message between users
type Message struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	SenderID    uuid.UUID  `json:"sender_id" db:"sender_id"`
	RecipientID uuid.UUID  `json:"recipient_id" db:"recipient_id"`
	Subject     *string    `json:"subject,omitempty" db:"subject"`
	Content     string     `json:"content" db:"content"`
	IsRead      bool       `json:"is_read" db:"is_read"`
	ReadAt      *time.Time `json:"read_at,omitempty" db:"read_at"`
	ParentID    *uuid.UUID `json:"parent_id,omitempty" db:"parent_id"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`

	// Joined fields
	SenderName    string `json:"sender_name,omitempty"`
	RecipientName string `json:"recipient_name,omitempty"`
}

// Request types

// MarkAttendanceRequest for marking class attendance
type MarkAttendanceRequest struct {
	ClassID    string `json:"class_id" form:"class_id" binding:"required"`
	Date       string `json:"date" form:"date" binding:"required"`             // YYYY-MM-DD
	Attendance string `json:"attendance" form:"attendance" binding:"required"` // JSON string of []StudentAttendance
	Photo      *any   `json:"photo,omitempty" form:"photo,omitempty"`          // Handled manually in handler
}

// StudentAttendance for individual student
type StudentAttendance struct {
	StudentID string `json:"student_id" binding:"required"`
	Status    string `json:"status" binding:"required"` // present, absent, late
	Remarks   string `json:"remarks,omitempty"`
}

type AttendanceStudentRecord struct {
	StudentID    uuid.UUID  `json:"student_id"`
	UserID       uuid.UUID  `json:"user_id"`
	FullName     string     `json:"full_name"`
	RollNumber   string     `json:"roll_number"`
	Email        string     `json:"email"`
	Status       string     `json:"status"`
	Remarks      string     `json:"remarks"`
	LastMarkedBy *uuid.UUID `json:"last_marked_by,omitempty"`
}

type AttendanceByDateResponse struct {
	ClassID  uuid.UUID                 `json:"class_id"`
	Date     string                    `json:"date"`
	Students []AttendanceStudentRecord `json:"students"`
}

type QuestionDocument struct {
	ID             string    `json:"id,omitempty"`
	TeacherID      string    `json:"teacher_id"`
	TeacherName    string    `json:"teacher_name,omitempty"`
	UploadedByName string    `json:"uploaded_by_name,omitempty"`
	SchoolID       string    `json:"school_id,omitempty"`
	Title          string    `json:"title"`
	Topic          string    `json:"topic,omitempty"`
	Subject        string    `json:"subject,omitempty"`
	ClassLevel     string    `json:"class_level,omitempty"`
	QuestionType   string    `json:"question_type"`
	Difficulty     string    `json:"difficulty,omitempty"`
	NumQuestions   int       `json:"num_questions,omitempty"`
	Context        string    `json:"context,omitempty"`
	FileName       string    `json:"file_name"`
	FileSize       int64     `json:"file_size"`
	MimeType       string    `json:"mime_type"`
	FileSHA256     string    `json:"file_sha256,omitempty"`
	UploadedAt     time.Time `json:"uploaded_at"`
	Content        []byte    `json:"-"`
}

type StudyMaterial struct {
	ID           string    `json:"id,omitempty"`
	UploaderID   string    `json:"uploader_id,omitempty"`
	UploaderName string    `json:"uploader_name,omitempty"`
	UploaderRole string    `json:"uploader_role,omitempty"`
	TeacherID    string    `json:"teacher_id"`
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

// StudentIndividualReport is a PDF/document uploaded by a teacher for one specific student.
// Metadata is stored in tenant Postgres table "student_individual_reports".
type StudentIndividualReport struct {
	ID           string    `json:"id,omitempty"`
	SchoolID     string    `json:"school_id,omitempty"`
	ClassID      string    `json:"class_id"`
	ClassName    string    `json:"class_name,omitempty"`
	StudentID    string    `json:"student_id"`
	StudentName  string    `json:"student_name,omitempty"`
	TeacherID    string    `json:"teacher_id,omitempty"`
	TeacherName  string    `json:"teacher_name,omitempty"`
	Title        string    `json:"title"`
	ReportType   string    `json:"report_type,omitempty"`
	AcademicYear string    `json:"academic_year,omitempty"`
	Description  string    `json:"description,omitempty"`
	FileName     string    `json:"file_name"`
	FileSize     int64     `json:"file_size"`
	MimeType     string    `json:"mime_type"`
	FileSHA256   string    `json:"file_sha256,omitempty"`
	UploadedAt   time.Time `json:"uploaded_at"`
	Content      []byte    `json:"-"`
}

type QuestionUploaderClassOption struct {
	ClassID    string   `json:"class_id"`
	ClassName  string   `json:"class_name"`
	ClassLevel string   `json:"class_level"`
	Subjects   []string `json:"subjects"`
}

// CreateHomeworkRequest for teachers
type CreateHomeworkRequest struct {
	Title       string   `json:"title" binding:"required"`
	Description string   `json:"description,omitempty"`
	ClassID     string   `json:"class_id" binding:"required"`
	SubjectID   string   `json:"subject_id,omitempty"`
	DueDate     string   `json:"due_date" binding:"required"` // RFC3339
	MaxMarks    int      `json:"max_marks"`
	Attachments []string `json:"attachments,omitempty"`
}

type HomeworkSubjectOption struct {
	SubjectID   string `json:"subject_id"`
	SubjectName string `json:"subject_name"`
}

type HomeworkClassOption struct {
	ClassID    string                  `json:"class_id"`
	ClassName  string                  `json:"class_name"`
	ClassLevel string                  `json:"class_level"`
	Subjects   []HomeworkSubjectOption `json:"subjects"`
}

type HomeworkAttachmentMeta struct {
	ID         string    `json:"id"`
	FileName   string    `json:"file_name"`
	FileSize   int64     `json:"file_size"`
	MimeType   string    `json:"mime_type"`
	FileSHA256 string    `json:"file_sha256,omitempty"`
	UploadedAt time.Time `json:"uploaded_at"`
}

type HomeworkAttachmentUpload struct {
	FileName string
	FileSize int64
	MimeType string
	Content  []byte
}

type TeacherHomeworkItem struct {
	ID               string                   `json:"id"`
	Title            string                   `json:"title"`
	Description      string                   `json:"description,omitempty"`
	ClassID          string                   `json:"class_id"`
	ClassName        string                   `json:"class_name"`
	SubjectID        string                   `json:"subject_id,omitempty"`
	SubjectName      string                   `json:"subject_name,omitempty"`
	DueDate          time.Time                `json:"due_date"`
	MaxMarks         int                      `json:"max_marks"`
	SubmissionsCount int                      `json:"submissions_count"`
	StudentsCount    int                      `json:"students_count"`
	AttachmentCount  int                      `json:"attachment_count"`
	HasAttachments   bool                     `json:"has_attachments"`
	Attachments      []HomeworkAttachmentMeta `json:"attachments,omitempty"`
	CreatedAt        time.Time                `json:"created_at"`
}

type UpdateHomeworkRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description,omitempty"`
	DueDate     string `json:"due_date" binding:"required"` // RFC3339 or YYYY-MM-DD
	MaxMarks    int    `json:"max_marks"`
}

type HomeworkSubmissionEntry struct {
	StudentID     string    `json:"student_id"`
	StudentName   string    `json:"student_name"`
	RollNumber    string    `json:"roll_number,omitempty"`
	SubmittedAt   time.Time `json:"submitted_at"`
	Status        string    `json:"status"`
	MarksObtained *int      `json:"marks_obtained"`
	Feedback      string    `json:"feedback,omitempty"`
}

type HomeworkSubmissionsResponse struct {
	HomeworkID       string                    `json:"homework_id"`
	Title            string                    `json:"title"`
	SubmissionsCount int                       `json:"submissions_count"`
	StudentsCount    int                       `json:"students_count"`
	Submissions      []HomeworkSubmissionEntry `json:"submissions"`
}

type QuizOptionCreateRequest struct {
	OptionText string `json:"option_text" binding:"required"`
	IsCorrect  bool   `json:"is_correct"`
}

type QuizQuestionCreateRequest struct {
	QuestionText string                    `json:"question_text" binding:"required"`
	Marks        int                       `json:"marks"`
	Options      []QuizOptionCreateRequest `json:"options" binding:"required"`
}

type CreateQuizRequest struct {
	Title           string                      `json:"title" binding:"required"`
	ChapterName     string                      `json:"chapter_name" binding:"required"`
	ClassID         string                      `json:"class_id" binding:"required"`
	SubjectID       string                      `json:"subject_id" binding:"required"`
	ScheduledAt     string                      `json:"scheduled_at"`
	IsAnytime       bool                        `json:"is_anytime"`
	DurationMinutes int                         `json:"duration_minutes"`
	TotalMarks      int                         `json:"total_marks"`
	Questions       []QuizQuestionCreateRequest `json:"questions" binding:"required"`
}

type QuizChapter struct {
	ID            string    `json:"id"`
	TeacherID     string    `json:"teacher_id"`
	ClassID       string    `json:"class_id"`
	SubjectID     string    `json:"subject_id"`
	ChapterName   string    `json:"chapter_name"`
	ChapterSource string    `json:"chapter_source"`
	CanEdit       bool      `json:"can_edit"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type CreateQuizChapterRequest struct {
	ClassID     string `json:"class_id" binding:"required"`
	SubjectID   string `json:"subject_id" binding:"required"`
	ChapterName string `json:"chapter_name" binding:"required"`
}

type UpdateQuizChapterRequest struct {
	ChapterName string `json:"chapter_name" binding:"required"`
}

type UpdateQuizRequest struct {
	Title           string `json:"title"`
	ChapterName     string `json:"chapter_name"`
	ScheduledAt     string `json:"scheduled_at"`
	IsAnytime       *bool  `json:"is_anytime"`
	DurationMinutes int    `json:"duration_minutes"`
	Status          string `json:"status"`
}

type AddQuizQuestionRequest struct {
	QuestionText string                    `json:"question_text" binding:"required"`
	Marks        int                       `json:"marks"`
	Options      []QuizOptionCreateRequest `json:"options" binding:"required,min=2"`
}

type TeacherQuizOption struct {
	ID         string `json:"id"`
	OptionText string `json:"option_text"`
	IsCorrect  bool   `json:"is_correct"`
	Order      int    `json:"order"`
}

type TeacherQuizQuestion struct {
	ID           string              `json:"id"`
	QuestionText string              `json:"question_text"`
	Marks        int                 `json:"marks"`
	Order        int                 `json:"order"`
	Options      []TeacherQuizOption `json:"options"`
}

type TeacherQuizItem struct {
	ID              string                `json:"id"`
	QuizSource      string                `json:"quiz_source"`
	Title           string                `json:"title"`
	ChapterName     string                `json:"chapter_name"`
	ClassID         string                `json:"class_id"`
	ClassName       string                `json:"class_name"`
	SubjectID       string                `json:"subject_id"`
	SubjectName     string                `json:"subject_name"`
	ScheduledAt     time.Time             `json:"scheduled_at"`
	IsAnytime       bool                  `json:"is_anytime"`
	DurationMinutes int                   `json:"duration_minutes"`
	TotalMarks      int                   `json:"total_marks"`
	QuestionCount   int                   `json:"question_count"`
	Status          string                `json:"status"`
	CreatorRole     string                `json:"creator_role"`
	CreatorName     string                `json:"creator_name"`
	CanEdit         bool                  `json:"can_edit"`
	Questions       []TeacherQuizQuestion `json:"questions,omitempty"`
	CreatedAt       time.Time             `json:"created_at"`
}

// EnterGradeRequest for entering student grades
type EnterGradeRequest struct {
	StudentID     string  `json:"student_id" binding:"required"`
	SubjectID     string  `json:"subject_id,omitempty"`
	ExamType      string  `json:"exam_type" binding:"required"` // FA1, FA2, SA1, SA2, Quiz
	ExamName      string  `json:"exam_name" binding:"required"`
	MaxMarks      int     `json:"max_marks" binding:"required"`
	MarksObtained float64 `json:"marks_obtained" binding:"required"`
	Remarks       string  `json:"remarks,omitempty"`
	ExamDate      string  `json:"exam_date,omitempty"` // YYYY-MM-DD
}

type TeacherReportAssessment struct {
	ID             uuid.UUID  `json:"id"`
	Name           string     `json:"name"`
	AssessmentType string     `json:"assessment_type"`
	AcademicYear   string     `json:"academic_year"`
	TotalMarks     float64    `json:"total_marks"`
	ClassIDs       []string   `json:"class_ids"`
	ScheduledDate  *time.Time `json:"scheduled_date,omitempty"`
}

type TeacherReportClass struct {
	ClassID   uuid.UUID              `json:"class_id"`
	ClassName string                 `json:"class_name"`
	Grade     *int                   `json:"grade"`
	Subjects  []TeacherReportSubject `json:"subjects,omitempty"`
}

type TeacherReportSubject struct {
	SubjectID   uuid.UUID `json:"subject_id"`
	SubjectName string    `json:"subject_name"`
}

type TeacherReportOptionsResponse struct {
	CurrentAcademicYear string                    `json:"current_academic_year"`
	Assessments         []TeacherReportAssessment `json:"assessments"`
	Classes             []TeacherReportClass      `json:"classes"`
}

type TeacherReportStudentMark struct {
	StudentID      uuid.UUID                           `json:"student_id"`
	FullName       string                              `json:"full_name"`
	RollNumber     string                              `json:"roll_number"`
	MarksObtained  *float64                            `json:"marks_obtained,omitempty"`
	Remarks        string                              `json:"remarks,omitempty"`
	BreakdownMarks []TeacherReportStudentBreakdownMark `json:"breakdown_marks,omitempty"`
}

type TeacherReportBreakdownItem struct {
	AssessmentMarkBreakdownID uuid.UUID `json:"assessment_mark_breakdown_id"`
	Title                     string    `json:"title"`
	MaxMarks                  float64   `json:"max_marks"`
}

type TeacherReportStudentBreakdownMark struct {
	AssessmentMarkBreakdownID uuid.UUID `json:"assessment_mark_breakdown_id"`
	MarksObtained             float64   `json:"marks_obtained"`
}

type TeacherReportMarksSheet struct {
	AssessmentID uuid.UUID                    `json:"assessment_id"`
	ClassID      uuid.UUID                    `json:"class_id"`
	SubjectID    uuid.UUID                    `json:"subject_id"`
	SubjectName  string                       `json:"subject_name"`
	ClassName    string                       `json:"class_name"`
	TotalMarks   float64                      `json:"total_marks"`
	Breakdowns   []TeacherReportBreakdownItem `json:"breakdowns,omitempty"`
	Students     []TeacherReportStudentMark   `json:"students"`
}

type TeacherReportMarksUpdateEntry struct {
	StudentID      string                                   `json:"student_id" binding:"required"`
	MarksObtained  float64                                  `json:"marks_obtained" binding:"required,gte=0"`
	Remarks        string                                   `json:"remarks,omitempty"`
	BreakdownMarks []TeacherReportMarksBreakdownUpdateEntry `json:"breakdown_marks,omitempty"`
}

type TeacherReportMarksBreakdownUpdateEntry struct {
	AssessmentMarkBreakdownID string  `json:"assessment_mark_breakdown_id" binding:"required"`
	MarksObtained             float64 `json:"marks_obtained" binding:"required,gte=0"`
}

type TeacherReportMarksUpdateRequest struct {
	AssessmentID string                          `json:"assessment_id" binding:"required"`
	ClassID      string                          `json:"class_id" binding:"required"`
	SubjectID    string                          `json:"subject_id" binding:"required"`
	Entries      []TeacherReportMarksUpdateEntry `json:"entries" binding:"required,min=1,dive"`
}

// CreateAnnouncementRequest for creating announcements
type CreateAnnouncementRequest struct {
	Title      string `json:"title" binding:"required"`
	Content    string `json:"content" binding:"required"`
	TargetType string `json:"target_type" binding:"required"` // all, class, grade, teachers
	TargetID   string `json:"target_id,omitempty"`
	Priority   string `json:"priority,omitempty"` // low, normal, high, urgent
	IsPinned   bool   `json:"is_pinned,omitempty"`
	ExpiresAt  string `json:"expires_at,omitempty"` // RFC3339
}

// SendMessageRequest for sending messages
type SendMessageRequest struct {
	RecipientID string `json:"recipient_id" binding:"required"`
	Subject     string `json:"subject,omitempty"`
	Content     string `json:"content" binding:"required"`
	ParentID    string `json:"parent_id,omitempty"` // For replies
}

type ClassMessageGroup struct {
	ClassID        uuid.UUID  `json:"class_id"`
	ClassName      string     `json:"class_name"`
	Grade          int        `json:"grade"`
	Section        *string    `json:"section,omitempty"`
	LastMessage    string     `json:"last_message,omitempty"`
	LastMessageAt  *time.Time `json:"last_message_at,omitempty"`
	LastSenderName string     `json:"last_sender_name,omitempty"`
	LastSenderRole string     `json:"last_sender_role,omitempty"`
}

type ClassGroupMessage struct {
	ID         uuid.UUID `json:"id"`
	ClassID    uuid.UUID `json:"class_id"`
	SenderID   uuid.UUID `json:"sender_id"`
	SenderName string    `json:"sender_name"`
	SenderRole string    `json:"sender_role"`
	Content    string    `json:"content"`
	CreatedAt  time.Time `json:"created_at"`
}

type SendClassGroupMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

// TimetableDayConfig represents a single day configuration
type TimetableDayConfig struct {
	DayOfWeek int    `json:"day_of_week"`
	DayName   string `json:"day_name"`
	IsActive  bool   `json:"is_active"`
}

// TimetablePeriodConfig represents a single period configuration
type TimetablePeriodConfig struct {
	PeriodNumber int     `json:"period_number"`
	StartTime    string  `json:"start_time"`
	EndTime      string  `json:"end_time"`
	IsBreak      bool    `json:"is_break"`
	BreakName    *string `json:"break_name,omitempty"`
}

// TimetableConfig groups day and period configurations
type TimetableConfig struct {
	Days    []TimetableDayConfig    `json:"days"`
	Periods []TimetablePeriodConfig `json:"periods"`
}

// TimetableEntry represents a timetable slot entry for teacher view
type TimetableEntry struct {
	ID           uuid.UUID  `json:"id"`
	ClassID      uuid.UUID  `json:"class_id"`
	DayOfWeek    int        `json:"day_of_week"`
	PeriodNumber int        `json:"period_number"`
	SubjectID    *uuid.UUID `json:"subject_id,omitempty"`
	TeacherID    *uuid.UUID `json:"teacher_id,omitempty"`
	StartTime    string     `json:"start_time"`
	EndTime      string     `json:"end_time"`
	RoomNumber   *string    `json:"room_number,omitempty"`
	AcademicYear string     `json:"academic_year"`

	SubjectName string `json:"subject_name,omitempty"`
	TeacherName string `json:"teacher_name,omitempty"`
	ClassName   string `json:"class_name,omitempty"`
}

// TeacherStudentFeeItem is a single fee demand row visible to a teacher.
type TeacherStudentFeeItem struct {
	ID          uuid.UUID  `json:"id"`
	PurposeID   *uuid.UUID `json:"purpose_id,omitempty"`
	PurposeName string     `json:"purpose_name"`
	Amount      float64    `json:"amount"`
	PaidAmount  float64    `json:"paid_amount"`
	Status      string     `json:"status"` // paid | partial | pending | overdue
	DueDate     *time.Time `json:"due_date,omitempty"`
}

// TeacherStudentPaymentItem is a single payment record visible to a teacher.
type TeacherStudentPaymentItem struct {
	ID            uuid.UUID `json:"id"`
	Amount        float64   `json:"amount"`
	PaymentMethod string    `json:"payment_method"`
	PaymentDate   time.Time `json:"payment_date"`
	Status        string    `json:"status"`
	ReceiptNumber string    `json:"receipt_number"`
	Purpose       *string   `json:"purpose,omitempty"`
}

// TeacherStudentFeeResponse is returned from GET /teacher/fees/student/:studentId
type TeacherStudentFeeResponse struct {
	StudentID      uuid.UUID                   `json:"student_id"`
	StudentName    string                      `json:"student_name"`
	ClassName      string                      `json:"class_name"`
	AcademicYear   string                      `json:"academic_year"`
	TotalAmount    float64                     `json:"total_amount"`
	PaidAmount     float64                     `json:"paid_amount"`
	PendingAmount  float64                     `json:"pending_amount"`
	Breakdown      []TeacherStudentFeeItem     `json:"breakdown"`
	PaymentHistory []TeacherStudentPaymentItem `json:"payment_history"`
}
