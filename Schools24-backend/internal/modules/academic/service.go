package academic

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/modules/student"
)

// Service handles academic business logic
type Service struct {
	repo        *Repository
	studentRepo *student.Repository
	config      *config.Config
}

// Common errors
var (
	ErrHomeworkNotFound   = errors.New("homework not found")
	ErrNotAuthorized      = errors.New("not authorized for this action")
	ErrAlreadySubmitted   = errors.New("already submitted")
	ErrAttachmentNotFound = errors.New("attachment not found")
	ErrSubmissionLocked   = errors.New("submission already graded and cannot be edited")
	ErrEmptySubmission    = errors.New("submission text or attachment is required")
)

// NewService creates a new academic service
func NewService(repo *Repository, studentRepo *student.Repository, cfg *config.Config) *Service {
	return &Service{
		repo:        repo,
		studentRepo: studentRepo,
		config:      cfg,
	}
}

// GetTimetable returns the timetable for a student's class
func (s *Service) GetTimetable(ctx context.Context, userID uuid.UUID) ([]DaySchedule, error) {
	// Get student info
	studentProfile, err := s.studentRepo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if studentProfile == nil || studentProfile.ClassID == nil {
		return nil, student.ErrStudentNotFound
	}

	academicYear := strings.TrimSpace(studentProfile.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	timetables, err := s.repo.GetTimetableByClassID(ctx, *studentProfile.ClassID, academicYear)
	if err != nil {
		return nil, err
	}

	// Fallback to current academic year when student's stored year has no rows.
	currentAcademicYear := getCurrentAcademicYear()
	if len(timetables) == 0 && academicYear != currentAcademicYear {
		timetables, err = s.repo.GetTimetableByClassID(ctx, *studentProfile.ClassID, currentAcademicYear)
		if err != nil {
			return nil, err
		}
	}

	// Group by day of week
	dayMap := make(map[int][]Timetable)
	for _, t := range timetables {
		dayMap[t.DayOfWeek] = append(dayMap[t.DayOfWeek], t)
	}

	config, err := s.repo.GetTimetableConfig(ctx)
	if err != nil {
		return nil, err
	}

	activeDays := make([]TimetableDayConfig, 0)
	for _, day := range config.Days {
		if day.IsActive {
			activeDays = append(activeDays, day)
		}
	}

	// Create day schedules based on active days
	var schedules []DaySchedule
	for _, day := range activeDays {
		schedule := DaySchedule{
			DayOfWeek: day.DayOfWeek,
			DayName:   day.DayName,
			Periods:   dayMap[day.DayOfWeek],
		}
		if schedule.Periods == nil {
			schedule.Periods = []Timetable{}
		}
		schedules = append(schedules, schedule)
	}

	return schedules, nil
}

// GetTimetableConfig returns timetable configuration for student view
func (s *Service) GetTimetableConfig(ctx context.Context) (*TimetableConfig, error) {
	return s.repo.GetTimetableConfig(ctx)
}

// GetHomework returns homework for a student's class
func (s *Service) GetHomework(ctx context.Context, userID uuid.UUID, _ string, subjectID, search string) ([]Homework, error) {
	studentProfile, err := s.studentRepo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if studentProfile == nil || studentProfile.ClassID == nil {
		return nil, student.ErrStudentNotFound
	}

	items, err := s.repo.GetHomeworkByClassID(ctx, *studentProfile.ClassID, studentProfile.ID, search, subjectID)
	if err != nil {
		return nil, err
	}

	schoolID := ""
	if studentProfile.ClassID != nil {
		classData, classErr := s.studentRepo.GetClassByID(ctx, *studentProfile.ClassID)
		if classErr == nil && classData != nil && classData.SchoolID != nil {
			schoolID = classData.SchoolID.String()
		}
	}
	for i := range items {
		items[i].AttachmentDetails = s.repo.ResolveHomeworkAttachmentMetasForStudent(ctx, schoolID, &items[i])
	}

	return items, nil
}

// GetHomeworkByID returns a single homework
func (s *Service) GetHomeworkByID(ctx context.Context, homeworkID uuid.UUID) (*Homework, error) {
	hw, err := s.repo.GetHomeworkByID(ctx, homeworkID)
	if err != nil {
		return nil, err
	}
	if hw == nil {
		return nil, ErrHomeworkNotFound
	}
	return hw, nil
}

// SubmitHomework submits homework for a student
func (s *Service) SubmitHomework(ctx context.Context, userID uuid.UUID, homeworkID uuid.UUID, req *SubmitHomeworkRequest) error {
	studentProfile, err := s.studentRepo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if studentProfile == nil {
		return student.ErrStudentNotFound
	}

	// Check if homework exists
	hw, err := s.repo.GetHomeworkByID(ctx, homeworkID)
	if err != nil {
		return err
	}
	if hw == nil {
		return ErrHomeworkNotFound
	}
	if strings.TrimSpace(req.SubmissionText) == "" && len(req.Attachments) == 0 {
		return ErrEmptySubmission
	}

	existing, err := s.repo.GetHomeworkSubmissionStatus(ctx, homeworkID, studentProfile.ID)
	if err != nil {
		return err
	}
	if existing != nil && strings.EqualFold(strings.TrimSpace(*existing), "graded") {
		return ErrSubmissionLocked
	}

	submission := &HomeworkSubmission{
		HomeworkID:     homeworkID,
		StudentID:      studentProfile.ID,
		SubmissionText: &req.SubmissionText,
		Attachments:    req.Attachments,
	}

	return s.repo.SubmitHomework(ctx, submission)
}

func (s *Service) GetHomeworkSubjectOptions(ctx context.Context, userID uuid.UUID) ([]StudentHomeworkSubjectOption, error) {
	studentProfile, err := s.studentRepo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if studentProfile == nil || studentProfile.ClassID == nil {
		return nil, student.ErrStudentNotFound
	}
	academicYear := strings.TrimSpace(studentProfile.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}
	return s.repo.GetStudentHomeworkSubjectOptions(ctx, *studentProfile.ClassID, academicYear)
}

func (s *Service) GetHomeworkAttachmentByID(ctx context.Context, userID uuid.UUID, schoolID, homeworkID, attachmentID string) (*HomeworkAttachmentMeta, []byte, error) {
	studentProfile, err := s.studentRepo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if studentProfile == nil {
		return nil, nil, student.ErrStudentNotFound
	}
	homeworkUUID, err := uuid.Parse(strings.TrimSpace(homeworkID))
	if err != nil {
		return nil, nil, fmt.Errorf("invalid homework id: %w", err)
	}
	allowed, err := s.repo.StudentCanAccessHomework(ctx, studentProfile.ID, homeworkUUID)
	if err != nil {
		return nil, nil, err
	}
	if !allowed {
		return nil, nil, ErrNotAuthorized
	}

	meta, content, err := s.repo.GetHomeworkAttachmentByIDForStudent(ctx, schoolID, homeworkUUID, attachmentID)
	if err != nil {
		return nil, nil, err
	}
	return meta, content, nil
}

// GetGrades returns grades for a student
func (s *Service) GetGrades(ctx context.Context, userID uuid.UUID, academicYear string) ([]Grade, error) {
	studentProfile, err := s.studentRepo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if studentProfile == nil {
		return nil, student.ErrStudentNotFound
	}

	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	return s.repo.GetStudentGrades(ctx, studentProfile.ID, academicYear)
}

// GetSubjects returns all subjects
func (s *Service) GetSubjects(ctx context.Context) ([]Subject, error) {
	return s.repo.GetAllSubjects(ctx)
}

// CreateSubject creates a new subject (admin only)
func (s *Service) CreateSubject(ctx context.Context, subject *Subject) error {
	return s.repo.CreateSubject(ctx, subject)
}

// getCurrentAcademicYear returns current academic year
func getCurrentAcademicYear() string {
	now := time.Now()
	year := now.Year()
	month := now.Month()

	if month < time.April {
		return time.Date(year-1, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006") + "-" + time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006")
	}
	return time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006") + "-" + time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006")
}
