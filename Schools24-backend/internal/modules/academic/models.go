package academic

import (
	"time"

	"github.com/google/uuid"
)

// Timetable represents a class period schedule
type Timetable struct {
	ID           uuid.UUID  `json:"id" db:"id"`
	ClassID      uuid.UUID  `json:"class_id" db:"class_id"`
	DayOfWeek    int        `json:"day_of_week" db:"day_of_week"` // 0=Sunday, 1=Monday...
	PeriodNumber int        `json:"period_number" db:"period_number"`
	SubjectID    *uuid.UUID `json:"subject_id,omitempty" db:"subject_id"`
	TeacherID    *uuid.UUID `json:"teacher_id,omitempty" db:"teacher_id"`
	StartTime    string     `json:"start_time" db:"start_time"`
	EndTime      string     `json:"end_time" db:"end_time"`
	RoomNumber   *string    `json:"room_number,omitempty" db:"room_number"`
	AcademicYear string     `json:"academic_year" db:"academic_year"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	SubjectName string `json:"subject_name,omitempty"`
	TeacherName string `json:"teacher_name,omitempty"`
	ClassName   string `json:"class_name,omitempty"`
}

// DaySchedule groups timetable entries by day
type DaySchedule struct {
	DayOfWeek int         `json:"day_of_week"`
	DayName   string      `json:"day_name"`
	Periods   []Timetable `json:"periods"`
}

// Homework represents a homework assignment
type Homework struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	Title       string     `json:"title" db:"title"`
	Description *string    `json:"description,omitempty" db:"description"`
	ClassID     uuid.UUID  `json:"class_id" db:"class_id"`
	SubjectID   *uuid.UUID `json:"subject_id,omitempty" db:"subject_id"`
	TeacherID   uuid.UUID  `json:"teacher_id" db:"teacher_id"`
	DueDate     time.Time  `json:"due_date" db:"due_date"`
	MaxMarks    int        `json:"max_marks" db:"max_marks"`
	Attachments []string   `json:"attachments,omitempty" db:"attachments"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	SubjectName string `json:"subject_name,omitempty"`
	TeacherName string `json:"teacher_name,omitempty"`
	ClassName   string `json:"class_name,omitempty"`

	// For student view
	IsSubmitted       bool                     `json:"is_submitted,omitempty"`
	Submission        *HomeworkSubmission      `json:"submission,omitempty"`
	AttachmentDetails []HomeworkAttachmentMeta `json:"attachment_details,omitempty"`
}

type HomeworkAttachmentMeta struct {
	ID         string    `json:"id"`
	FileName   string    `json:"file_name"`
	FileSize   int64     `json:"file_size"`
	MimeType   string    `json:"mime_type"`
	FileSHA256 string    `json:"file_sha256,omitempty"`
	UploadedAt time.Time `json:"uploaded_at"`
}

type StudentHomeworkSubjectOption struct {
	SubjectID   string `json:"subject_id"`
	SubjectName string `json:"subject_name"`
}

// HomeworkSubmission represents a student's homework submission
type HomeworkSubmission struct {
	ID             uuid.UUID  `json:"id" db:"id"`
	HomeworkID     uuid.UUID  `json:"homework_id" db:"homework_id"`
	StudentID      uuid.UUID  `json:"student_id" db:"student_id"`
	SubmissionText *string    `json:"submission_text,omitempty" db:"submission_text"`
	Attachments    []string   `json:"attachments,omitempty" db:"attachments"`
	SubmittedAt    time.Time  `json:"submitted_at" db:"submitted_at"`
	MarksObtained  *int       `json:"marks_obtained,omitempty" db:"marks_obtained"`
	Feedback       *string    `json:"feedback,omitempty" db:"feedback"`
	GradedBy       *uuid.UUID `json:"graded_by,omitempty" db:"graded_by"`
	GradedAt       *time.Time `json:"graded_at,omitempty" db:"graded_at"`
	Status         string     `json:"status" db:"status"` // submitted, graded, late, returned
}

// Grade represents a student's grade/mark
type Grade struct {
	ID            uuid.UUID  `json:"id" db:"id"`
	StudentID     uuid.UUID  `json:"student_id" db:"student_id"`
	SubjectID     *uuid.UUID `json:"subject_id,omitempty" db:"subject_id"`
	ExamType      string     `json:"exam_type" db:"exam_type"` // FA1, FA2, SA1, SA2, Quiz, etc.
	ExamName      string     `json:"exam_name" db:"exam_name"`
	MaxMarks      int        `json:"max_marks" db:"max_marks"`
	MarksObtained float64    `json:"marks_obtained" db:"marks_obtained"`
	Grade         *string    `json:"grade,omitempty" db:"grade"`
	Remarks       *string    `json:"remarks,omitempty" db:"remarks"`
	GradedBy      *uuid.UUID `json:"graded_by,omitempty" db:"graded_by"`
	ExamDate      *time.Time `json:"exam_date,omitempty" db:"exam_date"`
	AcademicYear  string     `json:"academic_year" db:"academic_year"`
	CreatedAt     time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at" db:"updated_at"`

	// Joined fields
	SubjectName string `json:"subject_name,omitempty"`
	StudentName string `json:"student_name,omitempty"`
}

// Subject represents a school subject
type Subject struct {
	ID          uuid.UUID `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Code        string    `json:"code" db:"code"`
	Description *string   `json:"description,omitempty" db:"description"`
	GradeLevels []int     `json:"grade_levels,omitempty" db:"grade_levels"`
	Credits     int       `json:"credits" db:"credits"`
	IsOptional  bool      `json:"is_optional" db:"is_optional"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// Request/Response types

// CreateHomeworkRequest for creating homework
type CreateHomeworkRequest struct {
	Title       string   `json:"title" binding:"required"`
	Description string   `json:"description,omitempty"`
	ClassID     string   `json:"class_id" binding:"required"`
	SubjectID   string   `json:"subject_id,omitempty"`
	DueDate     string   `json:"due_date" binding:"required"` // RFC3339
	MaxMarks    int      `json:"max_marks"`
	Attachments []string `json:"attachments,omitempty"`
}

// SubmitHomeworkRequest for submitting homework
type SubmitHomeworkRequest struct {
	SubmissionText string   `json:"submission_text,omitempty"`
	Attachments    []string `json:"attachments,omitempty"`
}

// GradeHomeworkRequest for grading homework
type GradeHomeworkRequest struct {
	MarksObtained int    `json:"marks_obtained" binding:"required"`
	Feedback      string `json:"feedback,omitempty"`
}

// CreateTimetableRequest for creating timetable entry
type CreateTimetableRequest struct {
	ClassID      string `json:"class_id" binding:"required"`
	DayOfWeek    int    `json:"day_of_week" binding:"min=0,max=6"`
	PeriodNumber int    `json:"period_number" binding:"required,min=1,max=10"`
	SubjectID    string `json:"subject_id,omitempty"`
	TeacherID    string `json:"teacher_id,omitempty"`
	StartTime    string `json:"start_time" binding:"required"` // HH:MM
	EndTime      string `json:"end_time" binding:"required"`   // HH:MM
	RoomNumber   string `json:"room_number,omitempty"`
	AcademicYear string `json:"academic_year" binding:"required"`
}

// TimetableDayConfig represents a single day configuration (student view)
type TimetableDayConfig struct {
	DayOfWeek int    `json:"day_of_week"`
	DayName   string `json:"day_name"`
	IsActive  bool   `json:"is_active"`
}

// TimetablePeriodConfig represents a single period configuration (student view)
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

// Day name helper
var DayNames = []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

func GetDayName(day int) string {
	if day >= 0 && day < len(DayNames) {
		return DayNames[day]
	}
	return ""
}
