package academic

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/shared/database"
	"github.com/schools24/backend/internal/shared/objectstore"
)

// Repository handles database operations for academic module
type Repository struct {
	db    *database.PostgresDB
	store objectstore.Store
}

// NewRepository creates a new academic repository
func NewRepository(db *database.PostgresDB, store objectstore.Store) *Repository {
	return &Repository{db: db, store: store}
}

// GetTimetableByClassID retrieves the single live timetable for a class.
// Academic year is kept in the signature for compatibility, but timetable
// identity is no longer year-versioned.
func (r *Repository) GetTimetableByClassID(ctx context.Context, classID uuid.UUID, academicYear string) ([]Timetable, error) {
	query := `
		SELECT DISTINCT ON (t.day_of_week, t.period_number)
		       t.id, t.class_id, t.day_of_week, t.period_number, t.subject_id, t.teacher_id,
		       t.start_time::text, t.end_time::text, t.room_number, t.academic_year,
		       t.created_at, t.updated_at,
		       COALESCE(s.name, gs.name, '') as subject_name,
		       COALESCE(u.full_name, '') as teacher_name,
		       COALESCE(c.name, '') as class_name
		FROM timetables t
		LEFT JOIN subjects s ON t.subject_id = s.id
		LEFT JOIN public.global_subjects gs ON (s.id IS NULL AND t.subject_id = gs.id)
		LEFT JOIN teachers te ON t.teacher_id = te.id
		LEFT JOIN users u ON te.user_id = u.id
		LEFT JOIN classes c ON t.class_id = c.id
		WHERE t.class_id = $1
		ORDER BY t.day_of_week, t.period_number, t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
	`

	rows, err := r.db.Query(ctx, query, classID)
	if err != nil {
		return nil, fmt.Errorf("failed to get timetable: %w", err)
	}
	defer rows.Close()

	timetables := make([]Timetable, 0)
	for rows.Next() {
		var t Timetable
		err := rows.Scan(
			&t.ID, &t.ClassID, &t.DayOfWeek, &t.PeriodNumber, &t.SubjectID, &t.TeacherID,
			&t.StartTime, &t.EndTime, &t.RoomNumber, &t.AcademicYear,
			&t.CreatedAt, &t.UpdatedAt,
			&t.SubjectName, &t.TeacherName, &t.ClassName,
		)
		if err != nil {
			return nil, err
		}
		timetables = append(timetables, t)
	}

	return timetables, nil
}

// GetTimetableConfig retrieves timetable configuration (days and periods)
func (r *Repository) GetTimetableConfig(ctx context.Context) (*TimetableConfig, error) {
	daysQuery := `
		SELECT day_of_week, day_name, is_active
		FROM timetable_days
		ORDER BY day_of_week
	`

	dayRows, err := r.db.Query(ctx, daysQuery)
	if err != nil {
		return nil, err
	}
	defer dayRows.Close()

	var days []TimetableDayConfig
	for dayRows.Next() {
		var d TimetableDayConfig
		if err := dayRows.Scan(&d.DayOfWeek, &d.DayName, &d.IsActive); err != nil {
			return nil, err
		}
		days = append(days, d)
	}

	periodsQuery := `
		SELECT period_number, start_time::text, end_time::text, is_break, break_name
		FROM timetable_periods
		ORDER BY period_number
	`

	periodRows, err := r.db.Query(ctx, periodsQuery)
	if err != nil {
		return nil, err
	}
	defer periodRows.Close()

	var periods []TimetablePeriodConfig
	for periodRows.Next() {
		var p TimetablePeriodConfig
		var breakName *string
		if err := periodRows.Scan(&p.PeriodNumber, &p.StartTime, &p.EndTime, &p.IsBreak, &breakName); err != nil {
			return nil, err
		}
		p.BreakName = breakName
		periods = append(periods, p)
	}

	return &TimetableConfig{Days: days, Periods: periods}, nil
}

// CreateTimetableEntry creates a new timetable entry
func (r *Repository) CreateTimetableEntry(ctx context.Context, entry *Timetable) error {
	query := `
		INSERT INTO timetables (id, class_id, day_of_week, period_number, subject_id, teacher_id,
		                        start_time, end_time, room_number, academic_year, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10, $11, $12)
		RETURNING id
	`

	now := time.Now()
	entry.ID = uuid.New()
	entry.CreatedAt = now
	entry.UpdatedAt = now

	return r.db.QueryRow(ctx, query,
		entry.ID, entry.ClassID, entry.DayOfWeek, entry.PeriodNumber,
		entry.SubjectID, entry.TeacherID, entry.StartTime, entry.EndTime,
		entry.RoomNumber, entry.AcademicYear, entry.CreatedAt, entry.UpdatedAt,
	).Scan(&entry.ID)
}

// GetHomeworkByClassID retrieves homework for a class
func (r *Repository) GetHomeworkByClassID(ctx context.Context, classID uuid.UUID, studentID uuid.UUID, search, subjectID string) ([]Homework, error) {
	query := `
		SELECT h.id, h.title, h.description, h.class_id, h.subject_id, h.teacher_id,
		       h.due_date, h.max_marks, h.attachments, h.created_at, h.updated_at,
		       COALESCE(s.name, '') as subject_name,
		       COALESCE(u.full_name, '') as teacher_name,
		       COALESCE(c.name, '') as class_name,
		       hs.id as submission_id,
		       hs.submission_text,
		       COALESCE(hs.attachments, ARRAY[]::text[]) as submission_attachments,
		       hs.submitted_at,
		       hs.marks_obtained,
		       hs.feedback,
		       hs.graded_by,
		       hs.graded_at,
		       hs.status as submission_status
		FROM homework h
		LEFT JOIN subjects s ON h.subject_id = s.id
		LEFT JOIN teachers te ON h.teacher_id = te.id
		LEFT JOIN users u ON te.user_id = u.id
		LEFT JOIN classes c ON h.class_id = c.id
		LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = $2
		WHERE h.class_id = $1
		  AND ($3 = '' OR h.subject_id::text = $3)
		  AND ($4 = '' OR h.title ILIKE '%' || $4 || '%' OR COALESCE(h.description, '') ILIKE '%' || $4 || '%' OR COALESCE(s.name, '') ILIKE '%' || $4 || '%')
		ORDER BY h.due_date DESC
	`

	rows, err := r.db.Query(ctx, query, classID, studentID, strings.TrimSpace(subjectID), strings.TrimSpace(search))
	if err != nil {
		return nil, fmt.Errorf("failed to get homework: %w", err)
	}
	defer rows.Close()

	var homeworks []Homework
	for rows.Next() {
		var h Homework
		var submissionID *uuid.UUID
		var submissionText *string
		var submissionAttachments []string
		var submittedAt *time.Time
		var marksObtained *int
		var feedback *string
		var gradedBy *uuid.UUID
		var gradedAt *time.Time
		var submissionStatus *string
		err := rows.Scan(
			&h.ID, &h.Title, &h.Description, &h.ClassID, &h.SubjectID, &h.TeacherID,
			&h.DueDate, &h.MaxMarks, &h.Attachments, &h.CreatedAt, &h.UpdatedAt,
			&h.SubjectName, &h.TeacherName, &h.ClassName,
			&submissionID, &submissionText, &submissionAttachments, &submittedAt, &marksObtained, &feedback, &gradedBy, &gradedAt, &submissionStatus,
		)
		if err != nil {
			return nil, err
		}
		if submissionID != nil {
			h.IsSubmitted = true
			h.Submission = &HomeworkSubmission{
				ID:             *submissionID,
				HomeworkID:     h.ID,
				StudentID:      studentID,
				SubmissionText: submissionText,
				Attachments:    submissionAttachments,
				SubmittedAt:    *submittedAt,
				MarksObtained:  marksObtained,
				Feedback:       feedback,
				GradedBy:       gradedBy,
				GradedAt:       gradedAt,
				Status:         valueOrDefault(submissionStatus, "submitted"),
			}
		}
		homeworks = append(homeworks, h)
	}

	return homeworks, nil
}

func valueOrDefault(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	trimmed := strings.TrimSpace(*v)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

// CreateHomework creates a new homework assignment
func (r *Repository) CreateHomework(ctx context.Context, hw *Homework) error {
	query := `
		INSERT INTO homework (id, title, description, class_id, subject_id, teacher_id,
		                      due_date, max_marks, attachments, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id
	`

	now := time.Now()
	hw.ID = uuid.New()
	hw.CreatedAt = now
	hw.UpdatedAt = now

	return r.db.QueryRow(ctx, query,
		hw.ID, hw.Title, hw.Description, hw.ClassID, hw.SubjectID, hw.TeacherID,
		hw.DueDate, hw.MaxMarks, hw.Attachments, hw.CreatedAt, hw.UpdatedAt,
	).Scan(&hw.ID)
}

// GetHomeworkByID retrieves a single homework by ID
func (r *Repository) GetHomeworkByID(ctx context.Context, homeworkID uuid.UUID) (*Homework, error) {
	query := `
		SELECT h.id, h.title, h.description, h.class_id, h.subject_id, h.teacher_id,
		       h.due_date, h.max_marks, h.attachments, h.created_at, h.updated_at,
		       COALESCE(s.name, '') as subject_name,
		       COALESCE(u.full_name, '') as teacher_name,
		       COALESCE(c.name, '') as class_name
		FROM homework h
		LEFT JOIN subjects s ON h.subject_id = s.id
		LEFT JOIN teachers te ON h.teacher_id = te.id
		LEFT JOIN users u ON te.user_id = u.id
		LEFT JOIN classes c ON h.class_id = c.id
		WHERE h.id = $1
	`

	var h Homework
	err := r.db.QueryRow(ctx, query, homeworkID).Scan(
		&h.ID, &h.Title, &h.Description, &h.ClassID, &h.SubjectID, &h.TeacherID,
		&h.DueDate, &h.MaxMarks, &h.Attachments, &h.CreatedAt, &h.UpdatedAt,
		&h.SubjectName, &h.TeacherName, &h.ClassName,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &h, nil
}

func (r *Repository) StudentCanAccessHomework(ctx context.Context, studentID, homeworkID uuid.UUID) (bool, error) {
	query := `
		SELECT EXISTS(
			SELECT 1
			FROM homework h
			JOIN students s ON s.class_id = h.class_id
			WHERE h.id = $1 AND s.id = $2
		)
	`
	var allowed bool
	if err := r.db.QueryRow(ctx, query, homeworkID, studentID).Scan(&allowed); err != nil {
		return false, err
	}
	return allowed, nil
}

func (r *Repository) GetStudentHomeworkSubjectOptions(ctx context.Context, classID uuid.UUID, academicYear string) ([]StudentHomeworkSubjectOption, error) {
	query := `
		SELECT DISTINCT s.id::text, s.name
		FROM timetables t
		JOIN subjects s ON s.id = t.subject_id
		WHERE t.class_id = $1
		  AND ($2 = '' OR t.academic_year = $2)
		  AND t.subject_id IS NOT NULL
		ORDER BY s.name
	`
	rows, err := r.db.Query(ctx, query, classID, strings.TrimSpace(academicYear))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]StudentHomeworkSubjectOption, 0, 16)
	for rows.Next() {
		var item StudentHomeworkSubjectOption
		if err := rows.Scan(&item.SubjectID, &item.SubjectName); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) GetHomeworkAttachmentByIDForStudent(ctx context.Context, schoolID string, homeworkID uuid.UUID, attachmentID string) (*HomeworkAttachmentMeta, []byte, error) {
	var raw struct {
		ID         string
		FileName   string
		FileSize   int64
		MimeType   string
		FileSHA256 string
		UploadedAt time.Time
		StorageKey string
	}

	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			uploaded_at,
			storage_key
		FROM teacher_homework_attachments
		WHERE id::text = $1
		  AND school_id = $2
		  AND homework_id = $3
	`, strings.TrimSpace(attachmentID), strings.TrimSpace(schoolID), homeworkID.String()).Scan(
		&raw.ID,
		&raw.FileName,
		&raw.FileSize,
		&raw.MimeType,
		&raw.FileSHA256,
		&raw.UploadedAt,
		&raw.StorageKey,
	)
	if err != nil {
		return nil, nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to retrieve attachment content: %w", err)
	}

	return &HomeworkAttachmentMeta{
		ID:         raw.ID,
		FileName:   raw.FileName,
		FileSize:   raw.FileSize,
		MimeType:   raw.MimeType,
		FileSHA256: raw.FileSHA256,
		UploadedAt: raw.UploadedAt,
	}, content, nil
}

func (r *Repository) ResolveHomeworkAttachmentMetasForStudent(ctx context.Context, schoolID string, hw *Homework) []HomeworkAttachmentMeta {
	if hw == nil || len(hw.Attachments) == 0 {
		return []HomeworkAttachmentMeta{}
	}
	metas := make([]HomeworkAttachmentMeta, 0, len(hw.Attachments))
	for _, attachmentID := range hw.Attachments {
		trimmed := strings.TrimSpace(attachmentID)
		if trimmed == "" {
			continue
		}
		meta, _, err := r.GetHomeworkAttachmentByIDForStudent(ctx, schoolID, hw.ID, trimmed)
		if err != nil || meta == nil {
			// fallback for legacy metadata entries that may not exist in SQL table
			metas = append(metas, HomeworkAttachmentMeta{
				ID:         trimmed,
				FileName:   trimmed,
				FileSHA256: hex.EncodeToString([]byte(trimmed)),
			})
			continue
		}
		metas = append(metas, *meta)
	}
	return metas
}

func (r *Repository) GetHomeworkSubmissionStatus(ctx context.Context, homeworkID, studentID uuid.UUID) (*string, error) {
	var status string
	err := r.db.QueryRow(ctx, `
		SELECT status
		FROM homework_submissions
		WHERE homework_id = $1 AND student_id = $2
	`, homeworkID, studentID).Scan(&status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get homework submission status: %w", err)
	}
	return &status, nil
}

// SubmitHomework creates a homework submission
func (r *Repository) SubmitHomework(ctx context.Context, sub *HomeworkSubmission) error {
	query := `
		INSERT INTO homework_submissions (id, homework_id, student_id, submission_text, attachments, submitted_at, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (homework_id, student_id) DO UPDATE
		SET submission_text = EXCLUDED.submission_text,
		    attachments = EXCLUDED.attachments,
		    submitted_at = EXCLUDED.submitted_at,
		    status = EXCLUDED.status
		RETURNING id
	`

	sub.ID = uuid.New()
	sub.SubmittedAt = time.Now()
	sub.Status = "submitted"

	return r.db.QueryRow(ctx, query,
		sub.ID, sub.HomeworkID, sub.StudentID, sub.SubmissionText,
		sub.Attachments, sub.SubmittedAt, sub.Status,
	).Scan(&sub.ID)
}

// GetStudentGrades retrieves grades for a student
func (r *Repository) GetStudentGrades(ctx context.Context, studentID uuid.UUID, academicYear string) ([]Grade, error) {
	query := `
		SELECT g.id, g.student_id, g.subject_id, g.exam_type, g.exam_name,
		       g.max_marks, g.marks_obtained, g.grade, g.remarks, g.graded_by,
		       g.exam_date, g.academic_year, g.created_at, g.updated_at,
		       COALESCE(s.name, '') as subject_name
		FROM grades g
		LEFT JOIN subjects s ON g.subject_id = s.id
		WHERE g.student_id = $1 AND g.academic_year = $2
		ORDER BY g.exam_date DESC, g.subject_id
	`

	rows, err := r.db.Query(ctx, query, studentID, academicYear)
	if err != nil {
		return nil, fmt.Errorf("failed to get grades: %w", err)
	}
	defer rows.Close()

	var grades []Grade
	for rows.Next() {
		var g Grade
		err := rows.Scan(
			&g.ID, &g.StudentID, &g.SubjectID, &g.ExamType, &g.ExamName,
			&g.MaxMarks, &g.MarksObtained, &g.Grade, &g.Remarks, &g.GradedBy,
			&g.ExamDate, &g.AcademicYear, &g.CreatedAt, &g.UpdatedAt,
			&g.SubjectName,
		)
		if err != nil {
			return nil, err
		}
		grades = append(grades, g)
	}

	return grades, nil
}

// GetAllSubjects retrieves all subjects
func (r *Repository) GetAllSubjects(ctx context.Context) ([]Subject, error) {
	query := `
		SELECT id, name, code, description, grade_levels, credits, is_optional, created_at
		FROM subjects
		ORDER BY name
	`

	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subjects []Subject
	for rows.Next() {
		var s Subject
		err := rows.Scan(&s.ID, &s.Name, &s.Code, &s.Description, &s.GradeLevels, &s.Credits, &s.IsOptional, &s.CreatedAt)
		if err != nil {
			return nil, err
		}
		subjects = append(subjects, s)
	}

	return subjects, nil
}

// CreateSubject creates a new subject
func (r *Repository) CreateSubject(ctx context.Context, subject *Subject) error {
	query := `
		INSERT INTO subjects (id, name, code, description, grade_levels, credits, is_optional, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`

	subject.ID = uuid.New()
	subject.CreatedAt = time.Now()

	return r.db.QueryRow(ctx, query,
		subject.ID, subject.Name, subject.Code, subject.Description,
		subject.GradeLevels, subject.Credits, subject.IsOptional, subject.CreatedAt,
	).Scan(&subject.ID)
}
