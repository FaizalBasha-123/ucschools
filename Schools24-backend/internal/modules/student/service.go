package student

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/schools24/backend/internal/config"
)

// Service handles student business logic
type Service struct {
	repo   *Repository
	config *config.Config
}

// Common errors
var (
	ErrStudentNotFound         = errors.New("student not found")
	ErrClassNotFound           = errors.New("class not found")
	ErrInvalidClass            = errors.New("invalid class")
	ErrInvalidInput            = errors.New("invalid input")
	ErrClassHasStudents        = errors.New("class has assigned students")
	ErrTeacherNotFound         = errors.New("teacher not found")
	ErrInvalidFeedback         = errors.New("invalid feedback payload")
	ErrInvalidApaarID          = errors.New("invalid apaar id")
	ErrInvalidAbcID            = errors.New("invalid abc id")
	ErrApaarIDExists           = errors.New("apaar id already exists")
	ErrAbcIDExists             = errors.New("abc id already exists")
	ErrFederatedIDConflict     = errors.New("federated id conflict")
	ErrEmptyMessageContent     = errors.New("message content cannot be empty")
	ErrStudyMaterialNotFound   = errors.New("study material not found")
	ErrReportDocNotFound       = errors.New("report document not found")
	ErrQuizNotFound            = errors.New("quiz not found")
	ErrQuizNotActive           = errors.New("quiz is not available for attempts")
	ErrQuizExpired             = errors.New("quiz timer has expired")
	ErrAttemptNotFound         = errors.New("attempt not found")
	ErrAttemptAlreadyCompleted = errors.New("attempt already completed")
)

var apaarIDRegex = regexp.MustCompile(`^[0-9]{12}$`)
var abcIDRegex = regexp.MustCompile(`^[0-9]{12}$`)

func normalizeFederatedID(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func normalizeAndValidateFederatedIDs(apaar, abc string) (string, string, error) {
	normalizedApaar := normalizeFederatedID(apaar)
	normalizedAbc := normalizeFederatedID(abc)

	if normalizedApaar != "" && !apaarIDRegex.MatchString(normalizedApaar) {
		return "", "", fmt.Errorf("%w: APAAR must be exactly 12 digits", ErrInvalidApaarID)
	}
	if normalizedAbc != "" && !abcIDRegex.MatchString(normalizedAbc) {
		return "", "", fmt.Errorf("%w: ABC must be exactly 12 digits", ErrInvalidAbcID)
	}

	return normalizedApaar, normalizedAbc, nil
}

func mapFederatedIDUniqueViolation(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return err
	}
	if pgErr.ConstraintName == "idx_students_apaar_id_unique" {
		return ErrApaarIDExists
	}
	if pgErr.ConstraintName == "idx_students_abc_id_unique" {
		return ErrAbcIDExists
	}
	if strings.Contains(strings.ToLower(pgErr.Detail), "apaar_id") {
		return ErrApaarIDExists
	}
	if strings.Contains(strings.ToLower(pgErr.Detail), "abc_id") {
		return ErrAbcIDExists
	}
	return err
}

// NewService creates a new student service
func NewService(repo *Repository, cfg *config.Config) *Service {
	return &Service{
		repo:   repo,
		config: cfg,
	}
}

// GetDashboard returns dashboard data for a student
func (s *Service) GetDashboard(ctx context.Context, userID uuid.UUID) (*StudentDashboard, error) {
	// Get student profile
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}

	dashboard := &StudentDashboard{
		Student: student,
	}

	// Get class info if assigned
	if student.ClassID != nil {
		class, err := s.repo.GetClassByID(ctx, *student.ClassID)
		if err == nil {
			dashboard.Class = class
		}
	}

	// Get attendance stats for current month
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	endOfMonth := startOfMonth.AddDate(0, 1, -1)

	stats, err := s.repo.GetAttendanceStats(ctx, student.ID, startOfMonth, endOfMonth)
	if err == nil {
		dashboard.AttendanceStats = stats
	}

	// Get recent attendance (last 7 days)
	recentAttendance, err := s.repo.GetRecentAttendance(ctx, student.ID, 7)
	if err == nil {
		dashboard.RecentAttendance = recentAttendance
	}

	// Placeholder for quizzes/homework (will be implemented in later phases)
	dashboard.UpcomingQuizzes = []UpcomingQuiz{}
	dashboard.PendingHomework = []PendingHomework{}

	return dashboard, nil
}

func (s *Service) GetClassSubjects(ctx context.Context, userID uuid.UUID) ([]StudentClassSubject, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	return s.repo.GetStudentClassSubjects(ctx, *student.ClassID)
}

// GetProfile returns the student profile
func (s *Service) GetProfile(ctx context.Context, userID uuid.UUID) (*Student, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}
	return student, nil
}

// GetStudentByID returns student by ID
func (s *Service) GetStudentByID(ctx context.Context, id uuid.UUID) (*Student, error) {
	student, err := s.repo.GetStudentByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}
	return student, nil
}

func (s *Service) CreateProfileForExistingUser(ctx context.Context, req *CreateStudentProfileForUserRequest) (*Student, error) {
	userID, err := uuid.Parse(strings.TrimSpace(req.UserID))
	if err != nil {
		return nil, ErrInvalidInput
	}

	existing, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	isStudentUser, err := s.repo.IsStudentUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !isStudentUser {
		return nil, ErrStudentNotFound
	}

	var classID *uuid.UUID
	var section *string
	if raw := strings.TrimSpace(req.ClassID); raw != "" {
		parsedClassID, parseErr := uuid.Parse(raw)
		if parseErr != nil {
			return nil, ErrInvalidClass
		}
		classRecord, getErr := s.repo.GetClassByID(ctx, parsedClassID)
		if getErr != nil {
			return nil, getErr
		}
		if classRecord == nil {
			return nil, ErrClassNotFound
		}
		classID = &parsedClassID
		section = classRecord.Section
	}

	dob := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	if raw := strings.TrimSpace(req.DateOfBirth); raw != "" {
		parsedDOB, parseErr := time.Parse("2006-01-02", raw)
		if parseErr != nil {
			return nil, ErrInvalidInput
		}
		dob = parsedDOB
	}

	gender := strings.TrimSpace(strings.ToLower(req.Gender))
	if gender == "" {
		gender = "other"
	}
	if gender != "male" && gender != "female" && gender != "other" {
		return nil, ErrInvalidInput
	}

	academicYear := strings.TrimSpace(req.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	admissionNumber := strings.TrimSpace(req.AdmissionNumber)
	if admissionNumber == "" {
		admissionNumber = "ADM-" + strings.ToUpper(userID.String()[:8])
	}

	var busRouteID *uuid.UUID
	if raw := strings.TrimSpace(req.BusRouteID); raw != "" {
		parsedBusRouteID, parseErr := uuid.Parse(raw)
		if parseErr != nil {
			return nil, ErrInvalidInput
		}
		busRouteID = &parsedBusRouteID
	}

	student := &Student{
		UserID:           userID,
		AdmissionNumber:  admissionNumber,
		ApaarID:          nil,
		AbcID:            nil,
		DateOfBirth:      dob,
		Gender:           gender,
		AcademicYear:     academicYear,
		ClassID:          classID,
		Section:          section,
		RollNumber:       stringPtr(strings.TrimSpace(req.RollNumber)),
		BloodGroup:       stringPtr(strings.TrimSpace(req.BloodGroup)),
		Address:          stringPtr(strings.TrimSpace(req.Address)),
		ParentName:       stringPtr(strings.TrimSpace(req.ParentName)),
		ParentEmail:      stringPtr(strings.TrimSpace(req.ParentEmail)),
		ParentPhone:      stringPtr(strings.TrimSpace(req.ParentPhone)),
		EmergencyContact: stringPtr(strings.TrimSpace(req.EmergencyContact)),
		BusRouteID:       busRouteID,
		TransportMode:    stringPtr(strings.TrimSpace(req.TransportMode)),
	}

	normalizedApaar, normalizedAbc, err := normalizeAndValidateFederatedIDs(req.ApaarID, req.AbcID)
	if err != nil {
		return nil, err
	}
	student.ApaarID = stringPtr(normalizedApaar)
	student.AbcID = stringPtr(normalizedAbc)
	student.LearnerID, err = s.repo.ResolveLearnerID(ctx, "", &dob, student.ApaarID, student.AbcID)
	if err != nil {
		return nil, err
	}
	if student.LearnerID != nil {
		if err := s.repo.EnsureLearnerEnrollment(ctx, *student.LearnerID, "profile_create"); err != nil {
			return nil, err
		}
	}

	apaarExists, abcExists, err := s.repo.FederatedIDExists(ctx, normalizedApaar, normalizedAbc, nil)
	if err != nil {
		return nil, err
	}
	if apaarExists {
		return nil, ErrApaarIDExists
	}
	if abcExists {
		return nil, ErrAbcIDExists
	}

	if err := s.repo.CreateStudent(ctx, student); err != nil {
		return nil, mapFederatedIDUniqueViolation(err)
	}
	return s.repo.GetStudentByUserID(ctx, userID)
}

func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// GetAttendance returns attendance records for the student

// GetAttendance returns attendance records for the student
func (s *Service) GetAttendance(ctx context.Context, userID uuid.UUID, startDate, endDate time.Time) ([]Attendance, *AttendanceStats, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if student == nil {
		return nil, nil, ErrStudentNotFound
	}

	// If no dates provided, default to current academic year window.
	if startDate.IsZero() {
		now := time.Now()
		if now.Month() < time.April {
			startDate = time.Date(now.Year()-1, time.April, 1, 0, 0, 0, 0, time.Local)
		} else {
			startDate = time.Date(now.Year(), time.April, 1, 0, 0, 0, 0, time.Local)
		}
		endDate = now
	}
	if endDate.IsZero() {
		endDate = time.Now()
	}

	records, err := s.repo.GetAttendanceRecords(ctx, student.ID, startDate, endDate)
	if err != nil {
		return nil, nil, err
	}

	stats, err := s.repo.GetAttendanceStats(ctx, student.ID, startDate, endDate)
	if err != nil {
		return nil, nil, err
	}

	return records, stats, nil
}

func (s *Service) GetFees(ctx context.Context, userID uuid.UUID) (*StudentFeesResponse, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}

	breakdown, err := s.repo.GetStudentFeeBreakdown(ctx, student.ID)
	if err != nil {
		return nil, err
	}

	paymentHistory, err := s.repo.GetStudentPaymentHistory(ctx, student.ID, 50)
	if err != nil {
		return nil, err
	}

	var totalAmount float64
	var paidAmount float64
	for _, item := range breakdown {
		totalAmount += item.Amount
		paidAmount += item.PaidAmount
	}

	pending := totalAmount - paidAmount
	if pending < 0 {
		pending = 0
	}

	academicYear := student.AcademicYear
	if strings.TrimSpace(academicYear) == "" {
		academicYear = getCurrentAcademicYear()
	}

	return &StudentFeesResponse{
		StudentID:      student.ID,
		AcademicYear:   academicYear,
		TotalAmount:    totalAmount,
		PaidAmount:     paidAmount,
		PendingAmount:  pending,
		Breakdown:      breakdown,
		PaymentHistory: paymentHistory,
	}, nil
}

func (s *Service) GetFeedbackTeacherOptions(ctx context.Context, userID uuid.UUID) ([]FeedbackTeacherOption, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}
	academicYear := strings.TrimSpace(student.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}
	return s.repo.GetFeedbackTeacherOptions(ctx, student.ID, academicYear)
}

func (s *Service) ListFeedback(ctx context.Context, userID uuid.UUID, limit int) ([]StudentFeedback, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.ListStudentFeedback(ctx, student.ID, limit)
}

func (s *Service) SubmitFeedback(ctx context.Context, userID uuid.UUID, req *CreateStudentFeedbackRequest) (uuid.UUID, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if student == nil {
		return uuid.Nil, ErrStudentNotFound
	}

	req.FeedbackType = strings.ToLower(strings.TrimSpace(req.FeedbackType))
	req.Message = strings.TrimSpace(req.Message)
	if req.FeedbackType != "teacher" || req.Rating < 1 || req.Rating > 5 || req.Message == "" {
		return uuid.Nil, ErrInvalidFeedback
	}

	teacherID, parseErr := uuid.Parse(strings.TrimSpace(req.TeacherID))
	if parseErr != nil {
		return uuid.Nil, ErrInvalidFeedback
	}

	academicYear := strings.TrimSpace(student.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}
	allowed, err := s.repo.IsTeacherInStudentTimetable(ctx, student.ID, teacherID, academicYear)
	if err != nil {
		return uuid.Nil, err
	}
	if !allowed {
		return uuid.Nil, ErrTeacherNotFound
	}

	var schoolID uuid.UUID
	if student.ClassID != nil {
		classData, classErr := s.repo.GetClassByID(ctx, *student.ClassID)
		if classErr == nil && classData != nil && classData.SchoolID != nil {
			schoolID = *classData.SchoolID
		}
	}
	if schoolID == uuid.Nil {
		return uuid.Nil, ErrInvalidFeedback
	}

	return s.repo.CreateStudentFeedback(ctx, schoolID, student.ID, req, teacherID)
}

type studentMaterialScope struct {
	schoolID    string
	classKey    string
	subjectKeys []string
	studentID   string // UUID string of the student row
}

func (s *Service) resolveStudentMaterialScope(ctx context.Context, userID uuid.UUID) (*studentMaterialScope, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}
	if student.ClassID == nil {
		return nil, ErrClassNotFound
	}

	classData, err := s.repo.GetClassByID(ctx, *student.ClassID)
	if err != nil {
		return nil, err
	}
	if classData == nil || classData.SchoolID == nil {
		return nil, ErrClassNotFound
	}

	academicYear := strings.TrimSpace(student.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	subjectKeys, err := s.repo.GetStudentSubjectKeysFromTimetable(ctx, *student.ClassID, academicYear)
	if err != nil {
		return nil, err
	}

	return &studentMaterialScope{
		schoolID:    classData.SchoolID.String(),
		classKey:    normalizeStudentClassKey(classData.Name),
		subjectKeys: subjectKeys,
		studentID:   student.ID.String(),
	}, nil
}

func (s *Service) ListStudyMaterialsPaged(ctx context.Context, userID uuid.UUID, page, pageSize int64, ascending bool, subject, search string) ([]StudentStudyMaterial, bool, error) {
	scope, err := s.resolveStudentMaterialScope(ctx, userID)
	if err != nil {
		log.Printf("[STUDENT-MATERIALS] resolveStudentMaterialScope FAILED for userID=%s: %v", userID, err)
		return nil, false, err
	}

	log.Printf("[STUDENT-MATERIALS] Scope resolved for userID=%s: schoolID=%s classKey=%q subjectKeys=%v",
		userID, scope.schoolID, scope.classKey, scope.subjectKeys)

	fetchSize := page * pageSize
	if fetchSize < pageSize {
		fetchSize = pageSize
	}
	if fetchSize > 200 {
		fetchSize = 200
	}

	teacherDocs, err := s.repo.ListStudentTeacherStudyMaterials(
		ctx,
		scope.schoolID,
		scope.classKey,
		scope.subjectKeys,
		ascending,
		subject,
		search,
		fetchSize,
	)
	if err != nil {
		return nil, false, err
	}
	globalDocs, err := s.repo.ListStudentGlobalStudyMaterials(
		ctx,
		scope.classKey,
		scope.subjectKeys,
		ascending,
		subject,
		search,
		fetchSize,
	)
	if err != nil {
		return nil, false, err
	}

	log.Printf("[STUDENT-MATERIALS] ListStudyMaterialsPaged: teacherDocs=%d globalDocs=%d", len(teacherDocs), len(globalDocs))

	merged := append(teacherDocs, globalDocs...)
	sort.SliceStable(merged, func(i, j int) bool {
		if ascending {
			return merged[i].UploadedAt.Before(merged[j].UploadedAt)
		}
		return merged[i].UploadedAt.After(merged[j].UploadedAt)
	})

	start := (page - 1) * pageSize
	if start >= int64(len(merged)) {
		return []StudentStudyMaterial{}, false, nil
	}
	end := start + pageSize
	if end > int64(len(merged)) {
		end = int64(len(merged))
	}
	hasMore := end < int64(len(merged))
	return merged[start:end], hasMore, nil
}

func (s *Service) GetStudyMaterialByID(ctx context.Context, userID uuid.UUID, materialID string) (*StudentStudyMaterial, error) {
	scope, err := s.resolveStudentMaterialScope(ctx, userID)
	if err != nil {
		return nil, err
	}

	if strings.HasPrefix(materialID, "sa:") {
		doc, getErr := s.repo.GetStudentGlobalStudyMaterialByID(ctx, scope.classKey, strings.TrimPrefix(materialID, "sa:"), scope.subjectKeys)
		if getErr != nil {
			if errors.Is(getErr, pgx.ErrNoRows) {
				return nil, ErrStudyMaterialNotFound
			}
			return nil, getErr
		}
		return doc, nil
	}

	doc, getErr := s.repo.GetStudentTeacherStudyMaterialByID(ctx, scope.schoolID, scope.classKey, materialID, scope.subjectKeys)
	if getErr != nil {
		if errors.Is(getErr, pgx.ErrNoRows) {
			return nil, ErrStudyMaterialNotFound
		}
		return nil, getErr
	}
	return doc, nil
}

func (s *Service) ListReportDocumentsPaged(ctx context.Context, userID uuid.UUID, page, pageSize int64, ascending bool, search string) ([]StudentReportDocument, bool, error) {
	scope, err := s.resolveStudentMaterialScope(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	configuredYear := strings.TrimSpace(getCurrentAcademicYear())
	if schoolUUID, parseErr := uuid.Parse(scope.schoolID); parseErr == nil {
		if resolved, resolveErr := s.repo.GetConfiguredAcademicYear(ctx, schoolUUID); resolveErr == nil && strings.TrimSpace(resolved) != "" {
			configuredYear = strings.TrimSpace(resolved)
		}
	}

	fetchSize := page * pageSize
	if fetchSize < pageSize {
		fetchSize = pageSize
	}
	if fetchSize > 200 {
		fetchSize = 200
	}

	// Use the new per-student collection — fully isolated by school_id + student_id
	docs, err := s.repo.ListStudentIndividualReportDocuments(
		ctx,
		scope.schoolID,
		scope.studentID,
		ascending,
		search,
		fetchSize,
	)
	if err != nil {
		return nil, false, err
	}
	filtered := make([]StudentReportDocument, 0, len(docs))
	for _, doc := range docs {
		if strings.TrimSpace(doc.AcademicYear) != configuredYear {
			continue
		}
		filtered = append(filtered, doc)
	}
	docs = filtered

	start := (page - 1) * pageSize
	if start >= int64(len(docs)) {
		return []StudentReportDocument{}, false, nil
	}
	end := start + pageSize
	if end > int64(len(docs)) {
		end = int64(len(docs))
	}
	hasMore := end < int64(len(docs))
	return docs[start:end], hasMore, nil
}

func (s *Service) GetReportDocumentByID(ctx context.Context, userID uuid.UUID, documentID string) (*StudentReportDocument, error) {
	scope, err := s.resolveStudentMaterialScope(ctx, userID)
	if err != nil {
		return nil, err
	}
	configuredYear := strings.TrimSpace(getCurrentAcademicYear())
	if schoolUUID, parseErr := uuid.Parse(scope.schoolID); parseErr == nil {
		if resolved, resolveErr := s.repo.GetConfiguredAcademicYear(ctx, schoolUUID); resolveErr == nil && strings.TrimSpace(resolved) != "" {
			configuredYear = strings.TrimSpace(resolved)
		}
	}

	// Enforce school_id + student_id — no cross-school or cross-student access.
	doc, getErr := s.repo.GetStudentIndividualReportDocumentByID(ctx, scope.schoolID, scope.studentID, documentID)
	if getErr != nil {
		if errors.Is(getErr, pgx.ErrNoRows) {
			return nil, ErrReportDocNotFound
		}
		return nil, getErr
	}
	if strings.TrimSpace(doc.AcademicYear) != configuredYear {
		return nil, ErrReportDocNotFound
	}
	return doc, nil
}

// GetClasses returns all available classes
func (s *Service) GetClasses(ctx context.Context, academicYear string) ([]Class, error) {
	if strings.EqualFold(strings.TrimSpace(academicYear), "all") {
		return s.repo.GetAllClasses(ctx, "")
	}
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}
	return s.repo.GetAllClasses(ctx, academicYear)
}

// GetClassByID returns class by ID
func (s *Service) GetClassByID(ctx context.Context, id uuid.UUID) (*Class, error) {
	class, err := s.repo.GetClassByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if class == nil {
		return nil, ErrClassNotFound
	}
	return class, nil
}

// GetAllStudents returns all students for a school with pagination
func (s *Service) GetAllStudents(ctx context.Context, schoolID uuid.UUID, search string, classIDs []uuid.UUID, page, pageSize int) ([]Student, int, error) {
	limit := pageSize
	offset := (page - 1) * pageSize
	return s.repo.GetAllStudents(ctx, schoolID, search, classIDs, limit, offset)
}

// CreateClass creates a new class (admin only)
func (s *Service) CreateClass(ctx context.Context, class *Class) error {
	return s.repo.CreateClass(ctx, class)
}

// UpdateClass updates an existing class
func (s *Service) UpdateClass(ctx context.Context, class *Class) error {
	if class.ClassTeacherID != nil && class.SchoolID != nil {
		ok, err := s.repo.IsTeacherInSchool(ctx, *class.ClassTeacherID, *class.SchoolID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrTeacherNotFound
		}
	}
	return s.repo.UpdateClass(ctx, class)
}

// DeleteClass deletes a class if no students are assigned
func (s *Service) DeleteClass(ctx context.Context, id uuid.UUID) error {
	count, err := s.repo.CountStudentsInClass(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrClassHasStudents
	}
	return s.repo.DeleteClass(ctx, id)
}

// UpdateStudent updates a student profile
func (s *Service) UpdateStudent(ctx context.Context, student *Student) error {
	apaarRaw := ""
	abcRaw := ""
	if student.ApaarID != nil {
		apaarRaw = *student.ApaarID
	}
	if student.AbcID != nil {
		abcRaw = *student.AbcID
	}

	normalizedApaar, normalizedAbc, err := normalizeAndValidateFederatedIDs(apaarRaw, abcRaw)
	if err != nil {
		return err
	}
	student.ApaarID = stringPtr(normalizedApaar)
	student.AbcID = stringPtr(normalizedAbc)

	var dobPtr *time.Time
	if !student.DateOfBirth.IsZero() {
		dobPtr = &student.DateOfBirth
	}
	student.LearnerID, err = s.repo.ResolveLearnerID(ctx, student.FullName, dobPtr, student.ApaarID, student.AbcID)
	if err != nil {
		return err
	}
	if student.LearnerID != nil {
		if err := s.repo.EnsureLearnerEnrollment(ctx, *student.LearnerID, "profile_update"); err != nil {
			return err
		}
	}

	apaarExists, abcExists, err := s.repo.FederatedIDExists(ctx, normalizedApaar, normalizedAbc, &student.ID)
	if err != nil {
		return err
	}
	if apaarExists {
		return ErrApaarIDExists
	}
	if abcExists {
		return ErrAbcIDExists
	}

	if err := s.repo.UpdateStudent(ctx, student); err != nil {
		return mapFederatedIDUniqueViolation(err)
	}
	return nil
}

// DeleteStudent deletes a student profile
func (s *Service) DeleteStudent(ctx context.Context, id uuid.UUID) error {
	return s.repo.DeleteStudent(ctx, id)
}

// getCurrentAcademicYear returns current academic year (e.g., "2025-2026")
func getCurrentAcademicYear() string {
	now := time.Now()
	year := now.Year()
	month := now.Month()

	// Academic year starts in April (for Indian schools)
	if month < time.April {
		return time.Date(year-1, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006") + "-" + time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006")
	}
	return time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006") + "-" + time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC).Format("2006")
}

// ─── Quiz service methods ─────────────────────────────────────────────────────

// ListAvailableQuizzes returns all quizzes for the student's class.
func (s *Service) ListAvailableQuizzes(ctx context.Context, userID uuid.UUID) ([]StudentQuizListItem, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}
	return s.repo.GetStudentQuizList(ctx, student.ID, *student.ClassID)
}

// StartOrResumeQuiz starts a new attempt or resumes an existing open one.
// Returns StartAttemptResponse ready to send to the frontend.
func (s *Service) StartOrResumeQuiz(ctx context.Context, userID, quizID uuid.UUID) (*StartAttemptResponse, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	// Fetch quiz header + questions (no is_correct)
	resp, err := s.repo.GetQuizForAttempt(ctx, quizID, *student.ClassID)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, ErrQuizNotFound
	}

	// Check for an already-open attempt
	open, err := s.repo.GetOpenAttempt(ctx, quizID, student.ID)
	if err != nil {
		return nil, err
	}

	var attemptID uuid.UUID
	var startedAt time.Time

	if open != nil {
		// Resume — check timer hasn't already expired on the server
		deadline := open.StartedAt.Add(time.Duration(resp.DurationMinutes) * time.Minute)
		if time.Now().After(deadline.Add(30 * time.Second)) {
			// Expire this attempt gracefully
			_ = s.repo.MarkAttemptExpired(ctx, open.AttemptID)
			// Fall through to create a new attempt below
		} else {
			attemptID = open.AttemptID
			startedAt = open.StartedAt
		}
	}

	if attemptID == uuid.Nil {
		// Create fresh attempt
		attemptID, startedAt, err = s.repo.CreateQuizAttempt(ctx, quizID, student.ID, resp.TotalMarks)
		if err != nil {
			return nil, err
		}
	}

	resp.AttemptID = attemptID.String()
	resp.StartedAt = startedAt
	resp.DeadlineAt = startedAt.Add(time.Duration(resp.DurationMinutes) * time.Minute)
	return resp, nil
}

// SubmitQuiz scores and persists a student's answers.
func (s *Service) SubmitQuiz(ctx context.Context, userID, quizID uuid.UUID, req SubmitQuizRequest) (*StudentQuizResult, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}

	attemptID, parseErr := uuid.Parse(req.AttemptID)
	if parseErr != nil {
		return nil, ErrAttemptNotFound
	}

	// Validate open attempt belongs to this student + quiz
	open, err := s.repo.GetOpenAttempt(ctx, quizID, student.ID)
	if err != nil {
		return nil, err
	}
	if open == nil || open.AttemptID != attemptID {
		// Could be already completed — check for result directly
		result, err2 := s.repo.GetAttemptResult(ctx, attemptID, student.ID)
		if err2 != nil {
			return nil, err2
		}
		if result != nil {
			return nil, ErrAttemptAlreadyCompleted
		}
		return nil, ErrAttemptNotFound
	}

	// Server-side timer enforcement
	deadline := open.StartedAt.Add(time.Duration(open.TotalMarks)*time.Minute + 30*time.Second)
	// Use quiz duration from the DB rather than total_marks field
	// Re-fetch quiz header for duration_minutes
	if student.ClassID != nil {
		quizHeader, fetchErr := s.repo.GetQuizForAttempt(ctx, quizID, *student.ClassID)
		if fetchErr == nil && quizHeader != nil {
			deadline = open.StartedAt.Add(time.Duration(quizHeader.DurationMinutes)*time.Minute + 30*time.Second)
		}
	}
	if time.Now().After(deadline) {
		_ = s.repo.MarkAttemptExpired(ctx, attemptID)
		return nil, ErrQuizExpired
	}

	// Score and save
	_, _, _, err = s.repo.ScoreAndSaveAttempt(ctx, attemptID, req.Answers)
	if err != nil {
		return nil, err
	}

	// Return full result
	result, err := s.repo.GetAttemptResult(ctx, attemptID, student.ID)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, ErrAttemptNotFound
	}
	return result, nil
}

// GetAttemptResult returns the result of a completed attempt (for "View Result" button).
func (s *Service) GetAttemptResult(ctx context.Context, userID uuid.UUID, attemptID uuid.UUID) (*StudentQuizResult, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}

	result, err := s.repo.GetAttemptResult(ctx, attemptID, student.ID)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, ErrAttemptNotFound
	}
	return result, nil
}

// ─── Quiz Leaderboard ─────────────────────────────────────────────────────────

// GetQuizLeaderboard returns the quiz-rating leaderboard for the calling student's class.
// Rankings are isolated per class per school (tenant schema).
func (s *Service) GetQuizLeaderboard(ctx context.Context, userID uuid.UUID) (*QuizLeaderboardResponse, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	entries, err := s.repo.GetClassQuizLeaderboard(ctx, *student.ClassID)
	if err != nil {
		return nil, err
	}

	// Assign display ranks based on ordered row position.
	// The query already sorts by rating, avg_best_pct, and name, so rank should
	// remain unique and deterministic for the UI instead of sharing rank 1 on ties.
	for i := range entries {
		entries[i].Rank = i + 1
		if entries[i].StudentID == student.ID.String() {
			entries[i].IsCurrentStudent = true
		}
	}

	totalQuizzes := 0
	if len(entries) > 0 {
		totalQuizzes = entries[0].TotalQuizzes
	}

	resp := &QuizLeaderboardResponse{
		ClassID:       student.ClassID.String(),
		ClassName:     student.ClassName,
		TotalQuizzes:  totalQuizzes,
		TotalStudents: len(entries),
		Entries:       entries,
	}

	for i := range entries {
		if entries[i].IsCurrentStudent {
			e := entries[i]
			resp.MyEntry = &e
			break
		}
	}

	return resp, nil
}

// GetAssessmentLeaderboard returns assessment leaderboard for the calling student's class.
// Ranking is based on average of per-assessment subject averages.
func (s *Service) GetAssessmentLeaderboard(ctx context.Context, userID uuid.UUID) (*AssessmentLeaderboardResponse, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	academicYear := strings.TrimSpace(student.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	classInfo, err := s.repo.GetClassByID(ctx, *student.ClassID)
	if err != nil {
		return nil, err
	}
	if classInfo == nil {
		return nil, ErrInvalidClass
	}

	entries, err := s.repo.GetClassAssessmentLeaderboard(ctx, *student.ClassID, academicYear)
	if err != nil {
		return nil, err
	}

	prevScore := -1.0
	prevRank := 0
	for i := range entries {
		if entries[i].AvgAssessmentPct != prevScore {
			prevRank = i + 1
			prevScore = entries[i].AvgAssessmentPct
		}
		entries[i].Rank = prevRank
		if entries[i].StudentID == student.ID.String() {
			entries[i].IsCurrentStudent = true
		}
	}

	totalAssessments := 0
	if len(entries) > 0 {
		totalAssessments = entries[0].TotalAssessments
	}

	resp := &AssessmentLeaderboardResponse{
		ClassID:          student.ClassID.String(),
		ClassName:        student.ClassName,
		TotalAssessments: totalAssessments,
		TotalStudents:    len(entries),
		Entries:          entries,
	}
	for i := range entries {
		if entries[i].IsCurrentStudent {
			e := entries[i]
			resp.MyEntry = &e
			break
		}
	}

	return resp, nil
}

func (s *Service) GetAssessmentStages(ctx context.Context, userID uuid.UUID) (*StudentAssessmentStagesResponse, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	academicYear := strings.TrimSpace(student.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	classInfo, err := s.repo.GetClassByID(ctx, *student.ClassID)
	if err != nil {
		return nil, err
	}
	if classInfo == nil {
		return nil, ErrInvalidClass
	}

	stages, err := s.repo.GetStudentAssessmentStages(ctx, *student.ClassID, academicYear)
	if err != nil {
		return nil, err
	}

	completed := 0
	for _, item := range stages {
		if item.Completed {
			completed++
		}
	}

	return &StudentAssessmentStagesResponse{
		ClassID:        student.ClassID.String(),
		ClassName:      student.ClassName,
		AcademicYear:   academicYear,
		CompletedCount: completed,
		TotalCount:     len(stages),
		Stages:         stages,
	}, nil
}

// ListMyClassMessages returns paginated messages for the authenticated student's class.
func (s *Service) ListMyClassMessages(ctx context.Context, userID uuid.UUID, page, pageSize int64) (*StudentClassMessagesPage, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	classInfo, err := s.repo.GetClassByID(ctx, *student.ClassID)
	if err != nil {
		return nil, err
	}
	if classInfo == nil {
		return nil, ErrInvalidClass
	}

	items, hasMore, err := s.repo.ListStudentClassMessages(ctx, *student.ClassID, page, pageSize)
	if err != nil {
		return nil, err
	}

	nextPage := int64(0)
	if hasMore {
		nextPage = page + 1
	}

	return &StudentClassMessagesPage{
		ClassID:    classInfo.ID.String(),
		ClassName:  classInfo.Name,
		Messages:   items,
		Page:       page,
		PageSize:   pageSize,
		HasMore:    hasMore,
		NextPage:   nextPage,
		TotalCount: len(items),
	}, nil
}

// SendMyClassMessage posts a message to the authenticated student's class group.
func (s *Service) SendMyClassMessage(ctx context.Context, userID uuid.UUID, content string) (*StudentClassMessage, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return nil, ErrEmptyMessageContent
	}

	return s.repo.CreateStudentClassMessage(ctx, *student.ClassID, userID, trimmed)
}

// ─── Subject Performance ─────────────────────────────────────────────────────

// GetSubjectPerformance returns the calling student's marks aggregated per
// subject from teacher-uploaded assessment marks.
func (s *Service) GetSubjectPerformance(ctx context.Context, userID uuid.UUID) (*StudentSubjectPerformanceResponse, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil || student.ClassID == nil {
		return nil, ErrStudentNotFound
	}

	academicYear := strings.TrimSpace(student.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	classInfo, err := s.repo.GetClassByID(ctx, *student.ClassID)
	if err != nil {
		return nil, err
	}
	if classInfo == nil {
		return nil, ErrInvalidClass
	}

	entries, err := s.repo.GetStudentSubjectPerformance(ctx, student.ID, *student.ClassID, academicYear)
	if err != nil {
		return nil, err
	}

	return &StudentSubjectPerformanceResponse{
		AcademicYear: academicYear,
		ClassName:    student.ClassName,
		Subjects:     entries,
	}, nil
}

// GetSchoolAssessmentLeaderboard returns ALL students in the school ranked by
// their assessment performance. Each student's score is computed from THEIR OWN
// assessments (scoped to their class grade), so comparisons are fair.
func (s *Service) GetSchoolAssessmentLeaderboard(ctx context.Context, userID uuid.UUID) (*SchoolAssessmentLeaderboardResponse, error) {
	student, err := s.repo.GetStudentByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if student == nil {
		return nil, ErrStudentNotFound
	}

	// Resolve school_id via the student's class (same pattern as CreateStudentFeedback).
	var schoolID uuid.UUID
	if student.ClassID != nil {
		classData, classErr := s.repo.GetClassByID(ctx, *student.ClassID)
		if classErr == nil && classData != nil && classData.SchoolID != nil {
			schoolID = *classData.SchoolID
		}
	}
	if schoolID == uuid.Nil {
		return nil, ErrInvalidClass
	}

	academicYear := strings.TrimSpace(student.AcademicYear)
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	entries, err := s.repo.GetSchoolAssessmentLeaderboard(ctx, schoolID, academicYear)
	if err != nil {
		return nil, err
	}

	// Assign ranks (dense rank: same score → same rank).
	prevScore := -1.0
	prevRank := 0
	for i := range entries {
		if entries[i].AvgAssessmentPct != prevScore {
			prevRank = i + 1
			prevScore = entries[i].AvgAssessmentPct
		}
		entries[i].Rank = prevRank
		if entries[i].StudentID == student.ID.String() {
			entries[i].IsCurrentStudent = true
		}
	}

	resp := &SchoolAssessmentLeaderboardResponse{
		TotalStudents: len(entries),
		Entries:       entries,
	}
	for i := range entries {
		if entries[i].IsCurrentStudent {
			e := entries[i]
			resp.MyEntry = &e
			break
		}
	}
	return resp, nil
}
