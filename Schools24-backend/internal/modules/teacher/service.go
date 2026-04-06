package teacher

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/config"
)

// Service handles teacher business logic
type Service struct {
	repo   *Repository
	config *config.Config
}

// Common errors
var (
	ErrTeacherNotFound       = errors.New("teacher not found")
	ErrNotAuthorized         = errors.New("not authorized for this action")
	ErrInvalidInput          = errors.New("invalid input")
	ErrInvalidClass          = errors.New("invalid or unauthorized class")
	ErrInvalidAttendance     = errors.New("invalid attendance payload")
	ErrInvalidQuestionType   = errors.New("invalid question type")
	ErrQuestionDocNotFound   = errors.New("question document not found")
	ErrStudyMaterialNotFound = errors.New("study material not found")
	ErrReportDocNotFound     = errors.New("report document not found")

	ErrHomeworkNotFound        = errors.New("homework not found")
	ErrInvalidQuizPayload      = errors.New("invalid quiz payload")
	ErrUnauthorizedUploadScope = errors.New("teacher not allowed for selected class/subject")
	ErrEmptyMessageContent     = errors.New("message content cannot be empty")
	ErrQuizChapterNotFound     = errors.New("quiz chapter not found")
	ErrNotFound                = errors.New("not found")
)

// NewService creates a new teacher service
func NewService(repo *Repository, cfg *config.Config) *Service {
	return &Service{
		repo:   repo,
		config: cfg,
	}
}

func isDocumentNotFoundErr(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}

// GetDashboard returns the teacher's dashboard data
func (s *Service) GetDashboard(ctx context.Context, userID uuid.UUID) (*TeacherDashboard, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	academicYear := getCurrentAcademicYear()

	// Get assigned classes
	assignments, err := s.repo.GetTeacherAssignments(ctx, teacher.ID, academicYear)
	if err != nil {
		return nil, err
	}

	// Get today's schedule
	dayOfWeek := int(time.Now().Weekday())
	todaySchedule, err := s.repo.GetTodaySchedule(ctx, teacher.ID, dayOfWeek, academicYear)
	if err != nil {
		return nil, err
	}

	// Compute unique class count for today (deduplicate by class_id)
	uniqueClassIDs := make(map[string]struct{})
	for _, p := range todaySchedule {
		if p.ClassID != "" {
			uniqueClassIDs[p.ClassID] = struct{}{}
		}
	}
	todayUniqueClasses := len(uniqueClassIDs)

	// Get total assigned class count (timetables + teacher_assignments + class_teacher)
	assignedClassCount, err := s.repo.GetAssignedClassCount(ctx, teacher.ID, academicYear)
	if err != nil {
		assignedClassCount = 0
	}

	// Get student count across all assigned classes
	studentCount, err := s.repo.GetStudentCountByClasses(ctx, teacher.ID, academicYear)
	if err != nil {
		studentCount = 0
	}

	// Get submissions for previous-day homework pending review
	pendingHomework, err := s.repo.GetPendingHomeworkCount(ctx, teacher.ID)
	if err != nil {
		pendingHomework = 0
	}

	// Get total homework submissions received
	homeworkSubmitted, err := s.repo.GetHomeworkSubmittedCount(ctx, teacher.ID)
	if err != nil {
		homeworkSubmitted = 0
	}

	classPerformance, err := s.repo.GetClassPerformance(ctx, teacher.ID, academicYear)
	if err != nil {
		classPerformance = []ClassPerformance{}
	}

	upcomingQuizzes, err := s.repo.GetUpcomingTeacherQuizzes(ctx, teacher.ID, 3)
	if err != nil {
		upcomingQuizzes = []DashboardQuizItem{}
	}

	recentStudentActivity, err := s.repo.GetRecentHomeworkActivity(ctx, teacher.ID, 4)
	if err != nil {
		recentStudentActivity = []StudentActivityItem{}
	}

	// Get teacher rank from leaderboard
	teacherRank := 0
	if teacher.SchoolID != nil {
		entry, rankErr := s.repo.GetTeacherLeaderboardEntry(ctx, *teacher.SchoolID, academicYear, teacher.ID)
		if rankErr == nil && entry != nil {
			teacherRank = entry.Rank
		}
	}

	// Get announcements
	announcements, err := s.repo.GetRecentAnnouncements(ctx, 5)
	if err != nil {
		announcements = []Announcement{}
	}

	return &TeacherDashboard{
		Teacher:               teacher,
		AssignedClasses:       assignments,
		TodaySchedule:         todaySchedule,
		TodayUniqueClasses:    todayUniqueClasses,
		AssignedClassCount:    assignedClassCount,
		PendingHomework:       pendingHomework,
		HomeworkSubmitted:     homeworkSubmitted,
		TeacherRank:           teacherRank,
		TotalStudents:         studentCount,
		ClassPerformance:      classPerformance,
		UpcomingQuizzes:       upcomingQuizzes,
		RecentStudentActivity: recentStudentActivity,
		AttendanceToday:       nil,
		RecentAnnouncements:   announcements,
	}, nil
}

// GetProfile returns the teacher's profile
func (s *Service) GetProfile(ctx context.Context, userID uuid.UUID) (*Teacher, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	return teacher, nil
}

// GetAssignedClasses returns classes assigned to the teacher
func (s *Service) GetAssignedClasses(ctx context.Context, userID uuid.UUID) ([]TeacherAssignment, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	academicYear := getCurrentAcademicYear()
	return s.repo.GetTeacherAssignments(ctx, teacher.ID, academicYear)
}

// GetTimetableConfig returns timetable configuration for the school
func (s *Service) GetTimetableConfig(ctx context.Context) (*TimetableConfig, error) {
	return s.repo.GetTimetableConfig(ctx)
}

// GetTeacherTimetable returns timetable entries for the teacher
func (s *Service) GetTeacherTimetable(ctx context.Context, userID uuid.UUID, academicYear string) ([]TimetableEntry, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}
	return s.repo.GetTeacherTimetable(ctx, teacher.ID, academicYear)
}

// GetLeaderboard returns leaderboard data for teachers.
func (s *Service) GetLeaderboard(ctx context.Context, userID uuid.UUID, schoolID uuid.UUID, academicYear string) (*TeacherLeaderboardResponse, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	items, err := s.repo.GetTeacherLeaderboard(ctx, schoolID, academicYear, 100)
	if err != nil {
		return nil, err
	}

	var top3 []TeacherLeaderboardEntry
	if len(items) <= 3 {
		top3 = items
	} else {
		top3 = items[:3]
	}

	entry, err := s.repo.GetTeacherLeaderboardEntry(ctx, schoolID, academicYear, teacher.ID)
	if err != nil {
		return nil, err
	}

	resp := &TeacherLeaderboardResponse{
		AcademicYear: academicYear,
		Items:        items,
		Top3:         top3,
		MyTeacherID:  teacher.ID.String(),
	}
	if entry != nil {
		resp.MyRank = entry.Rank
		resp.MyRating = entry.Rating
		resp.MyStudents = entry.StudentsCount
		resp.MyTrend = entry.Trend
	}

	return resp, nil
}

// GetClassTimetable returns timetable entries for a class (teacher view)
func (s *Service) GetClassTimetable(ctx context.Context, userID, classID uuid.UUID, academicYear string) ([]TimetableEntry, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	assignments, err := s.repo.GetTeacherAssignments(ctx, teacher.ID, academicYear)
	if err != nil {
		return nil, err
	}
	allowed := false
	for _, a := range assignments {
		if a.ClassID == classID {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, ErrInvalidClass
	}

	return s.repo.GetClassTimetable(ctx, classID, academicYear)
}

// GetStudentsByClass returns students in a class
func (s *Service) GetStudentsByClass(ctx context.Context, userID, classID uuid.UUID) ([]StudentInfo, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	academicYear := getCurrentAcademicYear()
	allowed, err := s.repo.CanTeacherMarkAttendance(ctx, teacher.ID, classID, academicYear)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrNotAuthorized
	}

	return s.repo.GetStudentsByClass(ctx, classID)
}

// GetStudentFeeData returns fee info for a student in one of the teacher's assigned classes.
func (s *Service) GetStudentFeeData(ctx context.Context, userID, studentID uuid.UUID) (*TeacherStudentFeeResponse, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	return s.repo.GetStudentFeeData(ctx, teacher.ID, studentID)
}

// MarkAttendance marks attendance for a class
func (s *Service) MarkAttendance(ctx context.Context, userID uuid.UUID, req *MarkAttendanceRequest, attendanceData []StudentAttendance, photoURL string) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}

	classID, err := uuid.Parse(req.ClassID)
	if err != nil {
		return ErrInvalidClass
	}

	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		return errors.New("invalid date format, use YYYY-MM-DD")
	}

	academicYear := academicYearForDate(date)
	allowed, err := s.repo.CanTeacherMarkAttendance(ctx, teacher.ID, classID, academicYear)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrNotAuthorized
	}

	if len(attendanceData) == 0 {
		return ErrInvalidAttendance
	}

	seen := make(map[uuid.UUID]struct{}, len(attendanceData))
	studentIDs := make([]uuid.UUID, 0, len(attendanceData))
	for _, row := range attendanceData {
		if row.Status != "present" && row.Status != "absent" && row.Status != "late" {
			return ErrInvalidAttendance
		}

		sid, parseErr := uuid.Parse(row.StudentID)
		if parseErr != nil {
			return ErrInvalidAttendance
		}

		if _, ok := seen[sid]; ok {
			continue
		}
		seen[sid] = struct{}{}
		studentIDs = append(studentIDs, sid)
	}

	validStudents, err := s.repo.ValidateStudentsInClass(ctx, classID, studentIDs)
	if err != nil {
		return err
	}
	if !validStudents {
		return ErrInvalidAttendance
	}

	return s.repo.MarkAttendance(ctx, teacher.ID, userID, classID, date, attendanceData, photoURL)
}

// GetAttendanceByDate returns existing attendance for a class and date after authorization.
func (s *Service) GetAttendanceByDate(ctx context.Context, userID, classID uuid.UUID, date time.Time) ([]AttendanceStudentRecord, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	academicYear := academicYearForDate(date)
	allowed, err := s.repo.CanTeacherMarkAttendance(ctx, teacher.ID, classID, academicYear)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrNotAuthorized
	}

	return s.repo.GetAttendanceByClassAndDate(ctx, classID, date)
}

// CreateHomework creates a new homework assignment
func (s *Service) CreateHomework(ctx context.Context, userID uuid.UUID, schoolID string, req *CreateHomeworkRequest, attachments []HomeworkAttachmentUpload) (uuid.UUID, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if teacher == nil {
		return uuid.Nil, ErrTeacherNotFound
	}

	classID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return uuid.Nil, ErrInvalidClass
	}
	subjectID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return uuid.Nil, errors.New("invalid subject_id")
	}

	dueDate, err := time.Parse(time.RFC3339, strings.TrimSpace(req.DueDate))
	if err != nil {
		dueDate, err = time.Parse("2006-01-02", strings.TrimSpace(req.DueDate))
		if err != nil {
			return uuid.Nil, errors.New("invalid due_date format")
		}
	}
	academicYear := academicYearForDate(dueDate)
	allowed, err := s.repo.CanTeacherAssignHomework(ctx, teacher.ID, classID, subjectID, academicYear)
	if err != nil {
		return uuid.Nil, err
	}
	if !allowed {
		return uuid.Nil, ErrUnauthorizedUploadScope
	}
	if len(attachments) == 0 {
		return uuid.Nil, ErrInvalidInput
	}

	homeworkID, err := s.repo.CreateHomework(ctx, teacher.ID, req)
	if err != nil {
		return uuid.Nil, err
	}

	attachmentIDs := make([]string, 0, len(attachments))
	for i := range attachments {
		meta, attachErr := s.repo.CreateHomeworkAttachment(ctx, schoolID, teacher.ID, homeworkID, &attachments[i])
		if attachErr != nil {
			_ = s.repo.DeleteHomeworkByIDForTeacher(ctx, teacher.ID, homeworkID)
			return uuid.Nil, attachErr
		}
		attachmentIDs = append(attachmentIDs, meta.ID)
	}
	if err := s.repo.UpdateHomeworkAttachments(ctx, teacher.ID, homeworkID, attachmentIDs); err != nil {
		_ = s.repo.DeleteHomeworkByIDForTeacher(ctx, teacher.ID, homeworkID)
		return uuid.Nil, err
	}
	return homeworkID, nil
}

func (s *Service) GetHomeworkOptions(ctx context.Context, userID uuid.UUID, academicYear string) ([]HomeworkClassOption, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	if strings.TrimSpace(academicYear) == "" {
		academicYear = getCurrentAcademicYear()
	}
	classOptions, err := s.repo.GetTeacherQuestionUploaderClasses(ctx, teacher.ID, academicYear)
	if err != nil {
		return nil, err
	}
	finalOptions := make([]HomeworkClassOption, 0, len(classOptions))
	for _, classOpt := range classOptions {
		classUUID, parseErr := uuid.Parse(classOpt.ClassID)
		if parseErr != nil {
			continue
		}
		taughtSubjects, err := s.repo.GetTeacherTaughtSubjectOptionsForClass(ctx, teacher.ID, classUUID, academicYear)
		if err != nil {
			return nil, err
		}
		if len(taughtSubjects) == 0 {
			continue
		}
		globalSubjects, err := s.repo.GetGlobalSubjectsByClassLevel(ctx, classOpt.ClassLevel)
		if err != nil {
			return nil, err
		}
		allowedSet := make(map[string]struct{}, len(globalSubjects))
		for _, gs := range globalSubjects {
			allowedSet[normalizeSubjectKey(gs)] = struct{}{}
		}

		subjectOptions := make([]HomeworkSubjectOption, 0, len(taughtSubjects))
		for _, subj := range taughtSubjects {
			if _, ok := allowedSet[normalizeSubjectKey(subj.SubjectName)]; !ok {
				continue
			}
			subjectOptions = append(subjectOptions, subj)
		}
		if len(subjectOptions) == 0 {
			continue
		}
		sort.Slice(subjectOptions, func(i, j int) bool {
			return strings.ToLower(subjectOptions[i].SubjectName) < strings.ToLower(subjectOptions[j].SubjectName)
		})
		finalOptions = append(finalOptions, HomeworkClassOption{
			ClassID:    classOpt.ClassID,
			ClassName:  classOpt.ClassName,
			ClassLevel: classOpt.ClassLevel,
			Subjects:   subjectOptions,
		})
	}
	return finalOptions, nil
}

func (s *Service) ListTeacherHomeworkPaged(ctx context.Context, userID uuid.UUID, page, pageSize int64, classID, subjectID, search, schoolID string) ([]TeacherHomeworkItem, bool, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if teacher == nil {
		return nil, false, ErrTeacherNotFound
	}
	items, hasMore, err := s.repo.ListTeacherHomeworkPaged(ctx, teacher.ID, page, pageSize, classID, subjectID, search)
	if err != nil {
		return nil, false, err
	}
	for i := range items {
		if len(items[i].Attachments) == 0 {
			continue
		}
		metas := make([]HomeworkAttachmentMeta, 0, len(items[i].Attachments))
		homeworkUUID, parseErr := uuid.Parse(items[i].ID)
		if parseErr != nil {
			items[i].Attachments = []HomeworkAttachmentMeta{}
			continue
		}
		for _, stub := range items[i].Attachments {
			meta, _, attachErr := s.repo.GetHomeworkAttachmentByIDForTeacher(ctx, schoolID, teacher.ID, homeworkUUID, stub.ID)
			if attachErr != nil {
				continue
			}
			metas = append(metas, *meta)
		}
		items[i].Attachments = metas
	}
	return items, hasMore, nil
}

func (s *Service) GetHomeworkAttachmentByID(ctx context.Context, userID uuid.UUID, schoolID, homeworkID, attachmentID string) (*HomeworkAttachmentMeta, []byte, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if teacher == nil {
		return nil, nil, ErrTeacherNotFound
	}
	if teacher.SchoolID == nil {
		return nil, nil, ErrNotAuthorized
	}
	resolvedSchoolID := teacher.SchoolID.String()
	if scoped := strings.TrimSpace(schoolID); scoped != "" && scoped != resolvedSchoolID {
		return nil, nil, ErrNotAuthorized
	}
	homeworkUUID, err := uuid.Parse(strings.TrimSpace(homeworkID))
	if err != nil {
		return nil, nil, ErrHomeworkNotFound
	}
	if _, err := s.repo.GetHomeworkByIDForTeacher(ctx, teacher.ID, homeworkUUID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrHomeworkNotFound
		}
		return nil, nil, err
	}
	meta, content, err := s.repo.GetHomeworkAttachmentByIDForTeacher(ctx, resolvedSchoolID, teacher.ID, homeworkUUID, attachmentID)
	if err != nil {
		if isDocumentNotFoundErr(err) {
			return nil, nil, ErrHomeworkNotFound
		}
		return nil, nil, err
	}
	return meta, content, nil
}

func (s *Service) GetQuizOptions(ctx context.Context, userID uuid.UUID, academicYear string) ([]HomeworkClassOption, error) {
	return s.GetHomeworkOptions(ctx, userID, academicYear)
}

func (s *Service) CreateQuiz(ctx context.Context, userID uuid.UUID, req *CreateQuizRequest) (uuid.UUID, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if teacher == nil {
		return uuid.Nil, ErrTeacherNotFound
	}

	classID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	subjectID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	scheduledAt := time.Now()
	if !req.IsAnytime {
		parsed, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt))
		if parseErr != nil {
			if d, fallbackErr := time.Parse("2006-01-02", strings.TrimSpace(req.ScheduledAt)); fallbackErr == nil {
				parsed = d
			} else {
				return uuid.Nil, ErrInvalidQuizPayload
			}
		}
		scheduledAt = parsed
	}

	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.ChapterName) == "" || len(req.Questions) == 0 {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	for _, q := range req.Questions {
		if strings.TrimSpace(q.QuestionText) == "" || len(q.Options) < 2 {
			return uuid.Nil, ErrInvalidQuizPayload
		}
		correctCount := 0
		for _, opt := range q.Options {
			if strings.TrimSpace(opt.OptionText) == "" {
				return uuid.Nil, ErrInvalidQuizPayload
			}
			if opt.IsCorrect {
				correctCount++
			}
		}
		if correctCount != 1 {
			return uuid.Nil, ErrInvalidQuizPayload
		}
	}

	academicYear := academicYearForDate(scheduledAt)
	allowed, err := s.repo.CanTeacherAssignHomework(ctx, teacher.ID, classID, subjectID, academicYear)
	if err != nil {
		return uuid.Nil, err
	}
	if !allowed {
		return uuid.Nil, ErrUnauthorizedUploadScope
	}
	chapterExists, err := s.repo.HasQuizChapter(ctx, teacher.ID, classID, subjectID, strings.TrimSpace(req.ChapterName))
	if err != nil {
		return uuid.Nil, err
	}
	if !chapterExists {
		return uuid.Nil, ErrInvalidQuizPayload
	}

	return s.repo.CreateQuiz(ctx, teacher.ID, req)
}

func (s *Service) GetSuperAdminQuizOptions(ctx context.Context, academicYear string) ([]HomeworkClassOption, error) {
	if strings.TrimSpace(academicYear) == "" {
		academicYear = getCurrentAcademicYear()
	}
	return s.repo.GetSuperAdminQuizOptions(ctx, academicYear)
}

func (s *Service) ListSuperAdminQuizzes(ctx context.Context, superAdminID uuid.UUID, page, pageSize int64, classID, subjectID, search string) ([]TeacherQuizItem, bool, error) {
	return s.repo.ListSuperAdminQuizzes(ctx, superAdminID, page, pageSize, classID, subjectID, search)
}

func (s *Service) CreateQuizAsSuperAdmin(ctx context.Context, superAdminID uuid.UUID, req *CreateQuizRequest) (uuid.UUID, error) {
	classUUID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	subjectUUID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return uuid.Nil, ErrInvalidQuizPayload
	}

	if !req.IsAnytime {
		if _, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt)); parseErr != nil {
			if _, fallbackErr := time.Parse("2006-01-02", strings.TrimSpace(req.ScheduledAt)); fallbackErr != nil {
				return uuid.Nil, ErrInvalidQuizPayload
			}
		}
	}

	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.ChapterName) == "" || len(req.Questions) == 0 {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	for _, q := range req.Questions {
		if strings.TrimSpace(q.QuestionText) == "" || len(q.Options) < 2 {
			return uuid.Nil, ErrInvalidQuizPayload
		}
		correctCount := 0
		for _, opt := range q.Options {
			if strings.TrimSpace(opt.OptionText) == "" {
				return uuid.Nil, ErrInvalidQuizPayload
			}
			if opt.IsCorrect {
				correctCount++
			}
		}
		if correctCount != 1 {
			return uuid.Nil, ErrInvalidQuizPayload
		}
	}

	var mapped bool
	if err := s.repo.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM public.global_class_subjects
			WHERE class_id = $1 AND subject_id = $2
		)
	`, classUUID, subjectUUID).Scan(&mapped); err != nil {
		return uuid.Nil, err
	}
	if !mapped {
		return uuid.Nil, ErrUnauthorizedUploadScope
	}

	return s.repo.CreateGlobalQuiz(ctx, superAdminID, req)
}

func (s *Service) GetQuizDetailForSuperAdmin(ctx context.Context, superAdminID uuid.UUID, quizID string) (*TeacherQuizItem, error) {
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.repo.GetQuizDetailForSuperAdmin(ctx, superAdminID, parsed)
}

func (s *Service) UpdateQuizForSuperAdmin(ctx context.Context, superAdminID uuid.UUID, quizID string, req *UpdateQuizRequest) error {
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return ErrNotFound
	}
	return s.repo.UpdateQuizForSuperAdmin(ctx, superAdminID, parsed, req)
}

func (s *Service) DeleteQuizForSuperAdmin(ctx context.Context, superAdminID uuid.UUID, quizID string) error {
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return ErrNotFound
	}
	return s.repo.DeleteQuizForSuperAdmin(ctx, superAdminID, parsed)
}

func (s *Service) AddQuizQuestionForSuperAdmin(ctx context.Context, superAdminID uuid.UUID, quizID string, req *AddQuizQuestionRequest) (uuid.UUID, error) {
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return uuid.Nil, ErrNotFound
	}
	if len(req.Options) < 2 {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	hasCorrect := false
	for _, o := range req.Options {
		if o.IsCorrect {
			hasCorrect = true
			break
		}
	}
	if !hasCorrect {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	return s.repo.AddQuizQuestionForSuperAdmin(ctx, superAdminID, parsed, req)
}

func (s *Service) ListQuizChapters(ctx context.Context, userID uuid.UUID, classID, subjectID string, includePlatform bool) ([]QuizChapter, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	return s.repo.ListQuizChapters(ctx, teacher.ID, classID, subjectID, includePlatform)
}

func (s *Service) CreateQuizChapter(ctx context.Context, userID uuid.UUID, req *CreateQuizChapterRequest) (*QuizChapter, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	classUUID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return nil, ErrInvalidQuizPayload
	}
	subjectUUID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return nil, ErrInvalidQuizPayload
	}
	chapterName := strings.TrimSpace(req.ChapterName)
	if chapterName == "" {
		return nil, ErrInvalidQuizPayload
	}

	academicYear := getCurrentAcademicYear()
	allowed, err := s.repo.CanTeacherAssignHomework(ctx, teacher.ID, classUUID, subjectUUID, academicYear)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrUnauthorizedUploadScope
	}

	return s.repo.CreateQuizChapter(ctx, teacher.ID, classUUID, subjectUUID, chapterName)
}

func (s *Service) UpdateQuizChapter(ctx context.Context, userID uuid.UUID, chapterID string, req *UpdateQuizChapterRequest) (*QuizChapter, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	chapterUUID, err := uuid.Parse(strings.TrimSpace(chapterID))
	if err != nil {
		return nil, ErrInvalidQuizPayload
	}
	chapterName := strings.TrimSpace(req.ChapterName)
	if chapterName == "" {
		return nil, ErrInvalidQuizPayload
	}

	updated, err := s.repo.UpdateQuizChapter(ctx, teacher.ID, chapterUUID, chapterName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrQuizChapterNotFound
		}
		return nil, err
	}
	return updated, nil
}

func (s *Service) DeleteQuizChapter(ctx context.Context, userID uuid.UUID, chapterID string) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}

	chapterUUID, err := uuid.Parse(strings.TrimSpace(chapterID))
	if err != nil {
		return ErrInvalidQuizPayload
	}
	if err := s.repo.DeleteQuizChapter(ctx, teacher.ID, chapterUUID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrQuizChapterNotFound
		}
		return err
	}
	return nil
}

func (s *Service) ListSuperAdminQuizChapters(ctx context.Context, superAdminID uuid.UUID, classID, subjectID string) ([]QuizChapter, error) {
	return s.repo.ListSuperAdminQuizChapters(ctx, superAdminID, classID, subjectID)
}

func (s *Service) CreateSuperAdminQuizChapter(ctx context.Context, superAdminID uuid.UUID, req *CreateQuizChapterRequest) (*QuizChapter, error) {
	classUUID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return nil, ErrInvalidQuizPayload
	}
	subjectUUID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return nil, ErrInvalidQuizPayload
	}
	chapterName := strings.TrimSpace(req.ChapterName)
	if chapterName == "" {
		return nil, ErrInvalidQuizPayload
	}

	var mapped bool
	if err := s.repo.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM public.global_class_subjects
			WHERE class_id = $1 AND subject_id = $2
		)
	`, classUUID, subjectUUID).Scan(&mapped); err != nil {
		return nil, err
	}
	if !mapped {
		return nil, ErrUnauthorizedUploadScope
	}

	return s.repo.CreateSuperAdminQuizChapter(ctx, superAdminID, classUUID, subjectUUID, chapterName)
}

func (s *Service) UpdateSuperAdminQuizChapter(ctx context.Context, superAdminID uuid.UUID, chapterID string, req *UpdateQuizChapterRequest) (*QuizChapter, error) {
	chapterUUID, err := uuid.Parse(strings.TrimSpace(chapterID))
	if err != nil {
		return nil, ErrInvalidQuizPayload
	}
	chapterName := strings.TrimSpace(req.ChapterName)
	if chapterName == "" {
		return nil, ErrInvalidQuizPayload
	}

	updated, err := s.repo.UpdateSuperAdminQuizChapter(ctx, superAdminID, chapterUUID, chapterName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrQuizChapterNotFound
		}
		return nil, err
	}
	return updated, nil
}

func (s *Service) DeleteSuperAdminQuizChapter(ctx context.Context, superAdminID uuid.UUID, chapterID string) error {
	chapterUUID, err := uuid.Parse(strings.TrimSpace(chapterID))
	if err != nil {
		return ErrInvalidQuizPayload
	}
	if err := s.repo.DeleteSuperAdminQuizChapter(ctx, superAdminID, chapterUUID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrQuizChapterNotFound
		}
		return err
	}
	return nil
}

func (s *Service) ListTeacherQuizzes(ctx context.Context, userID uuid.UUID, page, pageSize int64, classID, subjectID, search string) ([]TeacherQuizItem, bool, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if teacher == nil {
		return nil, false, ErrTeacherNotFound
	}
	return s.repo.ListTeacherQuizzes(ctx, teacher.ID, page, pageSize, classID, subjectID, search)
}

func (s *Service) GetQuizDetail(ctx context.Context, userID uuid.UUID, quizID string) (*TeacherQuizItem, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil || teacher == nil {
		return nil, ErrTeacherNotFound
	}
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.repo.GetQuizDetail(ctx, teacher.ID, parsed)
}

func (s *Service) DeleteQuiz(ctx context.Context, userID uuid.UUID, quizID string) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil || teacher == nil {
		return ErrTeacherNotFound
	}
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return ErrNotFound
	}
	return s.repo.DeleteQuiz(ctx, teacher.ID, parsed)
}

func (s *Service) UpdateQuiz(ctx context.Context, userID uuid.UUID, quizID string, req *UpdateQuizRequest) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil || teacher == nil {
		return ErrTeacherNotFound
	}
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return ErrNotFound
	}
	return s.repo.UpdateQuiz(ctx, teacher.ID, parsed, req)
}

func (s *Service) AddQuizQuestion(ctx context.Context, userID uuid.UUID, quizID string, req *AddQuizQuestionRequest) (uuid.UUID, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil || teacher == nil {
		return uuid.Nil, ErrTeacherNotFound
	}
	parsed, err := uuid.Parse(quizID)
	if err != nil {
		return uuid.Nil, ErrNotFound
	}
	if len(req.Options) < 2 {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	hasCorrect := false
	for _, o := range req.Options {
		if o.IsCorrect {
			hasCorrect = true
			break
		}
	}
	if !hasCorrect {
		return uuid.Nil, ErrInvalidQuizPayload
	}
	return s.repo.AddQuizQuestion(ctx, teacher.ID, parsed, req)
}

// EnterGrade enters a grade for a student
func (s *Service) EnterGrade(ctx context.Context, userID uuid.UUID, req *EnterGradeRequest) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}

	return s.repo.EnterGrade(ctx, teacher.ID, req)
}

func (s *Service) GetReportOptions(ctx context.Context, userID uuid.UUID, academicYear string) (*TeacherReportOptionsResponse, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	configuredYear := getCurrentAcademicYear()
	if teacher.SchoolID != nil {
		configuredYear = s.resolveConfiguredAcademicYear(ctx, *teacher.SchoolID)
	}
	if strings.TrimSpace(academicYear) == "" {
		academicYear = configuredYear
	}
	resp, err := s.repo.GetTeacherReportOptions(ctx, teacher.ID, academicYear)
	if err != nil {
		return nil, err
	}
	resp.CurrentAcademicYear = configuredYear
	return resp, nil
}

func (s *Service) GetReportMarksSheet(ctx context.Context, userID uuid.UUID, assessmentID, classID, subjectID uuid.UUID) (*TeacherReportMarksSheet, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	return s.repo.GetTeacherReportMarksSheet(ctx, teacher.ID, assessmentID, classID, subjectID)
}

func (s *Service) UpsertReportMarks(ctx context.Context, userID uuid.UUID, req *TeacherReportMarksUpdateRequest) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}

	assessmentID, err := uuid.Parse(strings.TrimSpace(req.AssessmentID))
	if err != nil {
		return ErrInvalidInput
	}
	classID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return ErrInvalidInput
	}
	subjectID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return ErrInvalidInput
	}
	if len(req.Entries) == 0 {
		return ErrInvalidInput
	}
	return s.repo.UpsertTeacherReportMarks(ctx, teacher.ID, userID, assessmentID, classID, subjectID, req.Entries)
}

// CreateAnnouncement creates a new announcement
func (s *Service) CreateAnnouncement(ctx context.Context, userID uuid.UUID, req *CreateAnnouncementRequest) (uuid.UUID, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if teacher == nil {
		return uuid.Nil, ErrTeacherNotFound
	}

	return s.repo.CreateAnnouncement(ctx, userID, req)
}

// GetAnnouncements returns recent announcements
func (s *Service) GetAnnouncements(ctx context.Context, limit int) ([]Announcement, error) {
	if limit <= 0 {
		limit = 20
	}
	return s.repo.GetRecentAnnouncements(ctx, limit)
}

func (s *Service) UploadQuestionDocument(ctx context.Context, userID uuid.UUID, doc *QuestionDocument) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}

	doc.QuestionType = strings.ToLower(strings.TrimSpace(doc.QuestionType))
	doc.Difficulty = strings.ToLower(strings.TrimSpace(doc.Difficulty))

	switch doc.QuestionType {
	case "mcq", "short", "long", "truefalse", "fillblank", "model_question_paper":
	default:
		return ErrInvalidQuestionType
	}
	if doc.Difficulty != "" && doc.Difficulty != "easy" && doc.Difficulty != "medium" && doc.Difficulty != "hard" {
		return errors.New("invalid difficulty")
	}
	doc.Subject = strings.TrimSpace(doc.Subject)
	doc.ClassLevel = strings.TrimSpace(doc.ClassLevel)
	if doc.Subject == "" || doc.ClassLevel == "" {
		return errors.New("subject and class_level are required")
	}

	if ok, err := s.isTeacherAllowedForClassSubject(ctx, userID, doc.ClassLevel, doc.Subject); err != nil {
		return err
	} else if !ok {
		return ErrUnauthorizedUploadScope
	}

	doc.TeacherID = teacher.ID.String()
	doc.TeacherName = teacher.FullName
	// Ensure school_id is always set — fall back to the teacher's DB record if the JWT claim was empty.
	if doc.SchoolID == "" && teacher.SchoolID != nil {
		doc.SchoolID = teacher.SchoolID.String()
	}
	return s.repo.CreateQuestionDocument(ctx, doc)
}

func (s *Service) UploadStudyMaterial(ctx context.Context, userID uuid.UUID, doc *StudyMaterial) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}

	doc.Subject = strings.TrimSpace(doc.Subject)
	doc.ClassLevel = strings.TrimSpace(doc.ClassLevel)
	if doc.Subject == "" || doc.ClassLevel == "" {
		return errors.New("subject and class_level are required")
	}

	if ok, err := s.isTeacherAllowedForClassSubject(ctx, userID, doc.ClassLevel, doc.Subject); err != nil {
		return err
	} else if !ok {
		return ErrUnauthorizedUploadScope
	}

	doc.TeacherID = teacher.ID.String()
	doc.TeacherName = teacher.FullName
	doc.UploaderID = teacher.ID.String()
	doc.UploaderName = teacher.FullName
	doc.UploaderRole = "teacher"
	// Ensure school_id is always set — fall back to the teacher's DB record if the JWT claim was empty.
	if doc.SchoolID == "" && teacher.SchoolID != nil {
		doc.SchoolID = teacher.SchoolID.String()
	}
	return s.repo.CreateStudyMaterial(ctx, doc)
}

func (s *Service) GetQuestionUploaderOptions(ctx context.Context, userID uuid.UUID, academicYear string) ([]QuestionUploaderClassOption, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	if strings.TrimSpace(academicYear) == "" {
		academicYear = getCurrentAcademicYear()
	}

	classOptions, err := s.repo.GetTeacherQuestionUploaderClasses(ctx, teacher.ID, academicYear)
	if err != nil {
		return nil, err
	}

	for idx := range classOptions {
		classID, parseErr := uuid.Parse(classOptions[idx].ClassID)
		if parseErr != nil {
			continue
		}

		taughtSubjects, err := s.repo.GetTeacherTaughtSubjectsForClass(ctx, teacher.ID, classID, academicYear)
		if err != nil {
			return nil, err
		}
		globalSubjects, err := s.repo.GetGlobalSubjectsByClassLevel(ctx, classOptions[idx].ClassLevel)
		if err != nil {
			return nil, err
		}

		taughtSet := make(map[string]string, len(taughtSubjects))
		for _, subj := range taughtSubjects {
			key := strings.ToLower(strings.TrimSpace(subj))
			if key == "" {
				continue
			}
			if _, exists := taughtSet[key]; !exists {
				taughtSet[key] = strings.TrimSpace(subj)
			}
		}

		finalSubjects := make([]string, 0)
		for _, globalSubj := range globalSubjects {
			key := strings.ToLower(strings.TrimSpace(globalSubj))
			if key == "" {
				continue
			}
			if canonical, ok := taughtSet[key]; ok {
				finalSubjects = append(finalSubjects, canonical)
			}
		}
		sort.Strings(finalSubjects)
		classOptions[idx].Subjects = finalSubjects
	}

	filtered := make([]QuestionUploaderClassOption, 0, len(classOptions))
	for _, opt := range classOptions {
		if len(opt.Subjects) == 0 {
			continue
		}
		filtered = append(filtered, opt)
	}

	return filtered, nil
}

func (s *Service) ListQuestionDocuments(ctx context.Context, userID uuid.UUID, limit int64) ([]QuestionDocument, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	return s.repo.ListQuestionDocuments(ctx, teacher.ID.String(), limit)
}

func (s *Service) ListQuestionDocumentsPaged(ctx context.Context, userID uuid.UUID, page, pageSize int64, ascending bool, subject, classLevel, search string) ([]QuestionDocument, bool, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if teacher == nil {
		return nil, false, ErrTeacherNotFound
	}

	fetchSize := page * pageSize
	if fetchSize < pageSize {
		fetchSize = pageSize
	}
	if fetchSize > 200 {
		fetchSize = 200
	}

	teacherDocs, _, err := s.repo.ListQuestionDocumentsPaged(ctx, teacher.ID.String(), 1, fetchSize, ascending, subject, classLevel, search)
	if err != nil {
		return nil, false, err
	}

	classKeys, subjectKeys, err := s.getTeacherScopeKeys(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	globalDocs, err := s.repo.ListSuperAdminQuestionDocumentsForTeacher(ctx, classKeys, subjectKeys, ascending, subject, classLevel, search, fetchSize)
	if err != nil {
		return nil, false, err
	}

	merged := append(teacherDocs, globalDocs...)
	sort.SliceStable(merged, func(i, j int) bool {
		if ascending {
			return merged[i].UploadedAt.Before(merged[j].UploadedAt)
		}
		return merged[i].UploadedAt.After(merged[j].UploadedAt)
	})

	start := (page - 1) * pageSize
	if start >= int64(len(merged)) {
		return []QuestionDocument{}, false, nil
	}
	end := start + pageSize
	if end > int64(len(merged)) {
		end = int64(len(merged))
	}
	hasMore := end < int64(len(merged))
	return merged[start:end], hasMore, nil
}

func (s *Service) GetQuestionDocumentFilterValues(ctx context.Context, userID uuid.UUID) ([]string, []string, bool, bool, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, nil, false, false, err
	}
	if teacher == nil {
		return nil, nil, false, false, ErrTeacherNotFound
	}
	return s.repo.GetQuestionDocumentFilterValues(ctx, teacher.ID.String())
}

func (s *Service) GetQuestionDocumentByID(ctx context.Context, userID uuid.UUID, documentID string) (*QuestionDocument, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	if strings.HasPrefix(documentID, "sa:") {
		classKeys, subjectKeys, scopeErr := s.getTeacherScopeKeys(ctx, userID)
		if scopeErr != nil {
			return nil, scopeErr
		}
		doc, err := s.repo.GetSuperAdminQuestionDocumentForTeacherByID(ctx, strings.TrimPrefix(documentID, "sa:"), classKeys, subjectKeys)
		if err != nil {
			if isDocumentNotFoundErr(err) {
				return nil, ErrQuestionDocNotFound
			}
			return nil, err
		}
		return doc, nil
	}

	doc, err := s.repo.GetQuestionDocumentByID(ctx, teacher.ID.String(), documentID)
	if err != nil {
		if isDocumentNotFoundErr(err) {
			return nil, ErrQuestionDocNotFound
		}
		return nil, err
	}
	return doc, nil
}

func (s *Service) ListStudyMaterialsPaged(ctx context.Context, userID uuid.UUID, page, pageSize int64, ascending bool, subject, classLevel, search string) ([]StudyMaterial, bool, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if teacher == nil {
		return nil, false, ErrTeacherNotFound
	}

	fetchSize := page * pageSize
	if fetchSize < pageSize {
		fetchSize = pageSize
	}
	if fetchSize > 200 {
		fetchSize = 200
	}

	teacherDocs, _, err := s.repo.ListStudyMaterialsPaged(ctx, teacher.ID.String(), 1, fetchSize, ascending, subject, classLevel, search)
	if err != nil {
		return nil, false, err
	}
	classKeys, subjectKeys, err := s.getTeacherScopeKeys(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	globalDocs, err := s.repo.ListSuperAdminStudyMaterialsForTeacher(ctx, classKeys, subjectKeys, ascending, subject, classLevel, search, fetchSize)
	if err != nil {
		return nil, false, err
	}
	if len(globalDocs) == 0 && strings.TrimSpace(subject) == "" && strings.TrimSpace(classLevel) == "" {
		// Fallback for legacy metadata drift: keep All Classes/All Subjects usable
		// by loading platform materials directly when strict scope matching yields none.
		relaxedDocs, _, relaxedErr := s.repo.ListSuperAdminStudyMaterialsPaged(ctx, "", 1, fetchSize, ascending, subject, classLevel, search)
		if relaxedErr == nil {
			globalDocs = make([]StudyMaterial, 0, len(relaxedDocs))
			for _, d := range relaxedDocs {
				d.ID = "sa:" + strings.TrimPrefix(d.ID, "sa:")
				globalDocs = append(globalDocs, d)
			}
		}
	}

	merged := append(teacherDocs, globalDocs...)
	sort.SliceStable(merged, func(i, j int) bool {
		if ascending {
			return merged[i].UploadedAt.Before(merged[j].UploadedAt)
		}
		return merged[i].UploadedAt.After(merged[j].UploadedAt)
	})

	start := (page - 1) * pageSize
	if start >= int64(len(merged)) {
		return []StudyMaterial{}, false, nil
	}
	end := start + pageSize
	if end > int64(len(merged)) {
		end = int64(len(merged))
	}
	hasMore := end < int64(len(merged))
	return merged[start:end], hasMore, nil
}

func (s *Service) GetStudyMaterialByID(ctx context.Context, userID uuid.UUID, materialID string) (*StudyMaterial, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	if strings.HasPrefix(materialID, "sa:") {
		classKeys, subjectKeys, scopeErr := s.getTeacherScopeKeys(ctx, userID)
		if scopeErr != nil {
			return nil, scopeErr
		}
		doc, err := s.repo.GetSuperAdminStudyMaterialForTeacherByID(ctx, strings.TrimPrefix(materialID, "sa:"), classKeys, subjectKeys)
		if err != nil {
			if isDocumentNotFoundErr(err) {
				fallbackDoc, fallbackErr := s.repo.GetSuperAdminStudyMaterialByID(ctx, "", strings.TrimPrefix(materialID, "sa:"))
				if fallbackErr != nil {
					if isDocumentNotFoundErr(fallbackErr) {
						return nil, ErrStudyMaterialNotFound
					}
					return nil, fallbackErr
				}
				fallbackDoc.ID = "sa:" + strings.TrimPrefix(fallbackDoc.ID, "sa:")
				return fallbackDoc, nil
			}
			return nil, err
		}
		return doc, nil
	}

	doc, err := s.repo.GetStudyMaterialByID(ctx, teacher.ID.String(), materialID)
	if err != nil {
		if isDocumentNotFoundErr(err) {
			return nil, ErrStudyMaterialNotFound
		}
		return nil, err
	}
	return doc, nil
}

func (s *Service) DeleteStudyMaterialByID(ctx context.Context, userID uuid.UUID, materialID string) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}

	if err := s.repo.DeleteStudyMaterialByID(ctx, teacher.ID.String(), materialID); err != nil {
		if isDocumentNotFoundErr(err) {
			return ErrStudyMaterialNotFound
		}
		return err
	}
	return nil
}

func (s *Service) resolveConfiguredAcademicYear(ctx context.Context, schoolID uuid.UUID) string {
	configured, err := s.repo.GetConfiguredAcademicYear(ctx, schoolID)
	if err == nil && strings.TrimSpace(configured) != "" {
		return strings.TrimSpace(configured)
	}
	return getCurrentAcademicYear()
}

// ─── Student Individual Reports ───────────────────────────────────────────────

// UploadStudentIndividualReport validates the teacher's access to the student's class
// and stores the report metadata in Postgres under "student_individual_reports".
func (s *Service) UploadStudentIndividualReport(ctx context.Context, userID uuid.UUID, doc *StudentIndividualReport) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return err
	}
	if teacher == nil {
		return ErrTeacherNotFound
	}
	if teacher.SchoolID == nil {
		return ErrNotAuthorized
	}
	configuredYear := s.resolveConfiguredAcademicYear(ctx, *teacher.SchoolID)

	// Verify the class_id is in the teacher's timetable/assignment scope
	classID, err := uuid.Parse(doc.ClassID)
	if err != nil {
		return errors.New("invalid class_id")
	}
	allowed, err := s.repo.CanTeacherMarkAttendance(ctx, teacher.ID, classID, configuredYear)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrNotAuthorized
	}

	// Verify the student is actually in that class
	students, err := s.repo.GetStudentsByClass(ctx, classID)
	if err != nil {
		return err
	}
	found := false
	for _, st := range students {
		if st.ID.String() == doc.StudentID {
			found = true
			if doc.StudentName == "" {
				doc.StudentName = st.FullName
			}
			break
		}
	}
	if !found {
		return errors.New("student_not_in_class")
	}

	// Fetch class name if missing
	if doc.ClassName == "" {
		assignments, _ := s.repo.GetTeacherAssignments(ctx, teacher.ID, configuredYear)
		for _, a := range assignments {
			if a.ClassID.String() == doc.ClassID {
				doc.ClassName = a.ClassName
				break
			}
		}
	}

	doc.AcademicYear = configuredYear
	doc.ReportType = strings.TrimSpace(strings.ToLower(doc.ReportType))
	doc.TeacherID = teacher.ID.String()
	doc.TeacherName = teacher.FullName
	if doc.SchoolID == "" && teacher.SchoolID != nil {
		doc.SchoolID = teacher.SchoolID.String()
	}
	return s.repo.CreateStudentIndividualReport(ctx, doc)
}

// ListStudentIndividualReportsPaged returns paged list of student-specific reports by this teacher.
func (s *Service) ListStudentIndividualReportsPaged(ctx context.Context, userID uuid.UUID, page, pageSize int64, ascending bool, classID, studentID, academicYear string) ([]StudentIndividualReport, bool, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if teacher == nil {
		return nil, false, ErrTeacherNotFound
	}
	if teacher.SchoolID == nil {
		return nil, false, ErrNotAuthorized
	}
	academicYear = s.resolveConfiguredAcademicYear(ctx, *teacher.SchoolID)
	return s.repo.ListStudentIndividualReports(ctx, teacher.ID.String(), page, pageSize, ascending, classID, studentID, academicYear)
}

// GetStudentIndividualReportByID fetches a single student report, asserting teacher ownership.
func (s *Service) GetStudentIndividualReportByID(ctx context.Context, userID uuid.UUID, reportID string) (*StudentIndividualReport, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	if teacher.SchoolID == nil {
		return nil, ErrNotAuthorized
	}
	doc, err := s.repo.GetStudentIndividualReportByID(ctx, teacher.ID.String(), reportID)
	if err != nil {
		if isDocumentNotFoundErr(err) {
			return nil, ErrReportDocNotFound
		}
		return nil, err
	}
	if doc.AcademicYear != s.resolveConfiguredAcademicYear(ctx, *teacher.SchoolID) {
		return nil, ErrReportDocNotFound
	}
	return doc, nil
}

func (s *Service) ListQuestionDocumentsBySchoolPaged(ctx context.Context, schoolID string, page, pageSize int64, ascending bool) ([]QuestionDocument, bool, error) {
	return s.repo.ListQuestionDocumentsBySchoolPaged(ctx, schoolID, page, pageSize, ascending)
}

func (s *Service) GetQuestionDocumentBySchoolAndID(ctx context.Context, schoolID, documentID string) (*QuestionDocument, error) {
	doc, err := s.repo.GetQuestionDocumentBySchoolAndID(ctx, schoolID, documentID)
	if err != nil {
		if isDocumentNotFoundErr(err) {
			return nil, ErrQuestionDocNotFound
		}
		return nil, err
	}
	return doc, nil
}

func (s *Service) ListClassMessageGroups(ctx context.Context, userID uuid.UUID, academicYear string) ([]ClassMessageGroup, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}
	if strings.TrimSpace(academicYear) == "" {
		academicYear = getCurrentAcademicYear()
	}
	return s.repo.GetTeacherClassMessageGroups(ctx, teacher.ID, academicYear)
}

func (s *Service) ListClassGroupMessages(ctx context.Context, userID uuid.UUID, classID uuid.UUID, page, pageSize int64) ([]ClassGroupMessage, bool, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if teacher == nil {
		return nil, false, ErrTeacherNotFound
	}

	allowed, err := s.repo.CanTeacherMarkAttendance(ctx, teacher.ID, classID, getCurrentAcademicYear())
	if err != nil {
		return nil, false, err
	}
	if !allowed {
		return nil, false, ErrInvalidClass
	}

	return s.repo.ListClassGroupMessages(ctx, classID, page, pageSize)
}

func (s *Service) SendClassGroupMessage(ctx context.Context, userID uuid.UUID, classID uuid.UUID, content string) (*ClassGroupMessage, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if teacher == nil {
		return nil, ErrTeacherNotFound
	}

	allowed, err := s.repo.CanTeacherMarkAttendance(ctx, teacher.ID, classID, getCurrentAcademicYear())
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrInvalidClass
	}

	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, ErrEmptyMessageContent
	}
	return s.repo.CreateClassGroupMessage(ctx, classID, userID, trimmed)
}

func (s *Service) UploadSuperAdminQuestionDocument(ctx context.Context, userID uuid.UUID, ownerEmail string, doc *QuestionDocument) error {
	doc.QuestionType = strings.ToLower(strings.TrimSpace(doc.QuestionType))
	doc.Difficulty = strings.ToLower(strings.TrimSpace(doc.Difficulty))

	switch doc.QuestionType {
	case "mcq", "short", "long", "truefalse", "fillblank", "model_question_paper":
	default:
		return ErrInvalidQuestionType
	}
	if doc.Difficulty != "" && doc.Difficulty != "easy" && doc.Difficulty != "medium" && doc.Difficulty != "hard" {
		return errors.New("invalid difficulty")
	}

	return s.repo.CreateSuperAdminQuestionDocument(ctx, userID.String(), ownerEmail, doc)
}

func (s *Service) ListSuperAdminQuestionDocumentsPaged(ctx context.Context, page, pageSize int64, ascending bool) ([]QuestionDocument, bool, error) {
	return s.repo.ListSuperAdminQuestionDocumentsPaged(ctx, page, pageSize, ascending)
}

func (s *Service) GetSuperAdminQuestionDocumentByID(ctx context.Context, documentID string) (*QuestionDocument, error) {
	doc, err := s.repo.GetSuperAdminQuestionDocumentByID(ctx, documentID)
	if err != nil {
		if isDocumentNotFoundErr(err) {
			return nil, ErrQuestionDocNotFound
		}
		return nil, err
	}
	return doc, nil
}

func (s *Service) DeleteSuperAdminQuestionDocumentByID(ctx context.Context, documentID string) error {
	if err := s.repo.DeleteSuperAdminQuestionDocumentByID(ctx, documentID); err != nil {
		if isDocumentNotFoundErr(err) {
			return ErrQuestionDocNotFound
		}
		return err
	}
	return nil
}

func (s *Service) UploadSuperAdminStudyMaterial(ctx context.Context, userID uuid.UUID, doc *StudyMaterial) error {
	doc.Subject = strings.TrimSpace(doc.Subject)
	doc.ClassLevel = strings.TrimSpace(doc.ClassLevel)
	if doc.Subject == "" || doc.ClassLevel == "" {
		return errors.New("subject and class_level are required")
	}
	doc.UploaderID = userID.String()
	if strings.TrimSpace(doc.UploaderName) == "" {
		doc.UploaderName = "Super Admin"
	}
	doc.UploaderRole = "super_admin"
	return s.repo.CreateSuperAdminStudyMaterial(ctx, userID.String(), doc)
}

func (s *Service) ListSuperAdminStudyMaterialsPaged(ctx context.Context, userID uuid.UUID, page, pageSize int64, ascending bool, subject, classLevel, search string) ([]StudyMaterial, bool, error) {
	return s.repo.ListSuperAdminStudyMaterialsPaged(ctx, userID.String(), page, pageSize, ascending, subject, classLevel, search)
}

func (s *Service) GetSuperAdminStudyMaterialByID(ctx context.Context, userID uuid.UUID, materialID string) (*StudyMaterial, error) {
	doc, err := s.repo.GetSuperAdminStudyMaterialByID(ctx, userID.String(), materialID)
	if err != nil {
		if isDocumentNotFoundErr(err) {
			return nil, ErrStudyMaterialNotFound
		}
		return nil, err
	}
	return doc, nil
}

func (s *Service) DeleteSuperAdminStudyMaterialByID(ctx context.Context, userID uuid.UUID, materialID string) error {
	if err := s.repo.DeleteSuperAdminStudyMaterialByID(ctx, userID.String(), materialID); err != nil {
		if isDocumentNotFoundErr(err) {
			return ErrStudyMaterialNotFound
		}
		return err
	}
	return nil
}

func (s *Service) getTeacherScopeKeys(ctx context.Context, userID uuid.UUID) ([]string, []string, error) {
	options, err := s.GetQuestionUploaderOptions(ctx, userID, getCurrentAcademicYear())
	if err != nil {
		return nil, nil, err
	}

	classSet := make(map[string]struct{})
	subjectSet := make(map[string]struct{})
	for _, opt := range options {
		key := normalizeClassKey(opt.ClassLevel)
		if key != "" {
			classSet[key] = struct{}{}
		}
		for _, subject := range opt.Subjects {
			sk := normalizeSubjectKey(subject)
			if sk != "" {
				subjectSet[sk] = struct{}{}
			}
		}
	}

	classKeys := make([]string, 0, len(classSet))
	for k := range classSet {
		classKeys = append(classKeys, k)
	}
	sort.Strings(classKeys)

	subjectKeys := make([]string, 0, len(subjectSet))
	for k := range subjectSet {
		subjectKeys = append(subjectKeys, k)
	}
	sort.Strings(subjectKeys)
	return classKeys, subjectKeys, nil
}

func (s *Service) isTeacherAllowedForClassSubject(ctx context.Context, userID uuid.UUID, classLevel, subject string) (bool, error) {
	globalMapped, err := s.repo.IsGlobalClassSubjectMapped(ctx, classLevel, subject)
	if err != nil {
		return false, err
	}
	if !globalMapped {
		return false, nil
	}

	options, err := s.GetQuestionUploaderOptions(ctx, userID, getCurrentAcademicYear())
	if err != nil {
		return false, err
	}
	classKey := normalizeClassKey(classLevel)
	subjectKey := normalizeSubjectKey(subject)
	if classKey == "" || subjectKey == "" {
		return false, nil
	}
	for _, opt := range options {
		if normalizeClassKey(opt.ClassLevel) != classKey {
			continue
		}
		for _, subj := range opt.Subjects {
			if normalizeSubjectKey(subj) == subjectKey {
				return true, nil
			}
		}
	}
	return false, nil
}

func academicYearForDate(date time.Time) string {
	year := date.Year()
	if date.Month() < time.April {
		return fmt.Sprintf("%d-%d", year-1, year)
	}
	return fmt.Sprintf("%d-%d", year, year+1)
}

// ─── Homework management ──────────────────────────────────────────────────────

// UpdateHomework updates editable fields of a teacher's homework.
func (s *Service) UpdateHomework(ctx context.Context, userID uuid.UUID, homeworkIDStr string, req *UpdateHomeworkRequest, schoolID string, attachments []HomeworkAttachmentUpload) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil || teacher == nil {
		return ErrTeacherNotFound
	}
	homeworkID, err := uuid.Parse(strings.TrimSpace(homeworkIDStr))
	if err != nil {
		return ErrInvalidInput
	}
	if strings.TrimSpace(req.Title) == "" {
		return ErrInvalidInput
	}
	if req.MaxMarks <= 0 {
		req.MaxMarks = 100
	}
	existingHomework, err := s.repo.GetHomeworkByIDForTeacher(ctx, teacher.ID, homeworkID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrHomeworkNotFound
	}
	if err != nil {
		return err
	}
	err = s.repo.UpdateHomeworkForTeacher(ctx, teacher.ID, homeworkID, req)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrHomeworkNotFound
	}
	if err != nil {
		return err
	}

	if len(attachments) == 0 {
		return nil
	}
	if teacher.SchoolID == nil {
		return ErrNotAuthorized
	}
	resolvedSchoolID := teacher.SchoolID.String()
	if scoped := strings.TrimSpace(schoolID); scoped != "" && scoped != resolvedSchoolID {
		return ErrNotAuthorized
	}

	newAttachmentIDs := make([]string, 0, len(attachments))
	for i := range attachments {
		meta, attachErr := s.repo.CreateHomeworkAttachment(ctx, resolvedSchoolID, teacher.ID, homeworkID, &attachments[i])
		if attachErr != nil {
			_ = s.repo.DeleteHomeworkAttachmentsByIDs(ctx, resolvedSchoolID, teacher.ID, homeworkID, newAttachmentIDs)
			return attachErr
		}
		newAttachmentIDs = append(newAttachmentIDs, meta.ID)
	}
	if err := s.repo.UpdateHomeworkAttachments(ctx, teacher.ID, homeworkID, newAttachmentIDs); err != nil {
		_ = s.repo.DeleteHomeworkAttachmentsByIDs(ctx, resolvedSchoolID, teacher.ID, homeworkID, newAttachmentIDs)
		return err
	}

	oldAttachmentIDs := make([]string, 0, len(existingHomework.Attachments))
	for _, att := range existingHomework.Attachments {
		if strings.TrimSpace(att.ID) == "" {
			continue
		}
		oldAttachmentIDs = append(oldAttachmentIDs, att.ID)
	}
	if err := s.repo.DeleteHomeworkAttachmentsByIDs(ctx, resolvedSchoolID, teacher.ID, homeworkID, oldAttachmentIDs); err != nil {
		return err
	}

	return nil
}

// DeleteHomework deletes a teacher's homework (only works for homework they own).
func (s *Service) DeleteHomework(ctx context.Context, userID uuid.UUID, homeworkIDStr string) error {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil || teacher == nil {
		return ErrTeacherNotFound
	}
	homeworkID, err := uuid.Parse(strings.TrimSpace(homeworkIDStr))
	if err != nil {
		return ErrInvalidInput
	}
	err = s.repo.DeleteHomeworkByIDForTeacher(ctx, teacher.ID, homeworkID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrHomeworkNotFound
	}
	return err
}

// GetHomeworkSubmissions returns submission records for a specific homework owned by the teacher.
func (s *Service) GetHomeworkSubmissions(ctx context.Context, userID uuid.UUID, homeworkIDStr string) (*HomeworkSubmissionsResponse, error) {
	teacher, err := s.repo.GetTeacherByUserID(ctx, userID)
	if err != nil || teacher == nil {
		return nil, ErrTeacherNotFound
	}
	homeworkID, err := uuid.Parse(strings.TrimSpace(homeworkIDStr))
	if err != nil {
		return nil, ErrInvalidInput
	}
	resp, err := s.repo.GetHomeworkSubmissions(ctx, teacher.ID, homeworkID)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrHomeworkNotFound
	}
	return resp, err
}
