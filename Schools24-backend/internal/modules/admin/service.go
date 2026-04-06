package admin

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/modules/interop"
	sharedsecurity "github.com/schools24/backend/internal/shared/security"
	"golang.org/x/crypto/bcrypt"
)

func trimmedOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// Service handles admin business logic
type Service struct {
	repo           *Repository
	config         *config.Config
	interopService *interop.Service
}

func (s *Service) resolveAcademicYearForSchool(ctx context.Context, schoolID uuid.UUID) string {
	settings, err := s.repo.GetAdmissionSettings(ctx, schoolID)
	if err == nil {
		configured := strings.TrimSpace(settings.GlobalAcademicYear)
		if configured != "" {
			return configured
		}
	}
	return getCurrentAcademicYear()
}

func (s *Service) resolveAcademicYearFromContext(ctx context.Context, fallbackSchoolID string) string {
	schoolIDStr := strings.TrimSpace(fallbackSchoolID)
	if schoolIDStr == "" {
		if ctxSchoolID, ok := ctx.Value("school_id").(string); ok {
			schoolIDStr = strings.TrimSpace(ctxSchoolID)
		}
	}

	if schoolIDStr != "" {
		if schoolID, err := uuid.Parse(schoolIDStr); err == nil {
			return s.resolveAcademicYearForSchool(ctx, schoolID)
		}
	}

	return getCurrentAcademicYear()
}

// Common errors
var (
	ErrUserNotFound           = errors.New("user not found")
	ErrEmailExists            = errors.New("email already exists")
	ErrNotAuthorized          = errors.New("not authorized for this action")
	ErrInvalidInput           = errors.New("invalid input")
	ErrLastAdmin              = errors.New("cannot delete the last admin of a school")
	ErrBusRouteNotFound       = errors.New("bus route not found")
	ErrFeePurposeNotFound     = errors.New("fee demand purpose not found")
	ErrAssessmentNotFound     = errors.New("assessment not found")
	ErrAssessmentLocked       = errors.New("assessment is locked because dependent report data already exists")
	ErrInvalidPassword        = errors.New("incorrect password")
	ErrCannotSuspendSelf      = errors.New("cannot suspend your own account")
	ErrTransferNotFound       = errors.New("transfer request not found")
	ErrTransferConflict       = errors.New("transfer request conflict")
	ErrReconciliationNotFound = errors.New("reconciliation case not found")
	ErrReconciliationConflict = errors.New("reconciliation case conflict")
)

// NewService creates a new admin service
func NewService(repo *Repository, cfg *config.Config, interopService *interop.Service) *Service {
	return &Service{
		repo:           repo,
		config:         cfg,
		interopService: interopService,
	}
}

// GetAllStaff returns staff members with optional school filter (super_admin may omit)
func (s *Service) GetAllStaff(ctx context.Context, schoolID *uuid.UUID, search string, designation string, page, pageSize int) ([]Staff, int, error) {
	limit := pageSize
	offset := (page - 1) * pageSize
	return s.repo.GetAllStaff(ctx, schoolID, search, designation, limit, offset)
}

// CreateStaff creates a new staff member
func (s *Service) CreateStaff(ctx context.Context, req CreateStaffRequest) error {
	var schoolID uuid.UUID
	var err error

	// 1. Try to get School ID from Context (Standard Admin flow)
	if val := ctx.Value("school_id"); val != nil {
		if id, ok := val.(uuid.UUID); ok {
			schoolID = id
		} else if str, ok := val.(string); ok {
			schoolID, err = uuid.Parse(str)
			if err != nil {
				return errors.New("invalid school_id in context")
			}
		}
	}

	// 2. If not found in context (Super Admin flow), try Request Payload
	if schoolID == uuid.Nil && req.SchoolID != "" {
		schoolID, err = uuid.Parse(req.SchoolID)
		if err != nil {
			return errors.New("invalid school_id in request")
		}
	}

	if schoolID == uuid.Nil {
		return errors.New("school_id is required")
	}

	// Auto-generate password if not supplied by caller
	if req.Password == "" {
		req.Password = uuid.New().String()[:10]
	}

	// Basic validation could go here
	return s.repo.CreateStaff(ctx, schoolID, req)
}

// UpdateStaff updates an existing staff member
func (s *Service) UpdateStaff(ctx context.Context, staffID uuid.UUID, req UpdateStaffRequest, requesterSchoolID *uuid.UUID, requesterRole string) error {
	staffSchoolID, err := s.repo.GetStaffSchoolID(ctx, staffID, "non-teaching")
	if err != nil {
		return err
	}
	if requesterRole != "super_admin" {
		if requesterSchoolID == nil || *requesterSchoolID != staffSchoolID {
			return ErrNotAuthorized
		}
	} else if requesterSchoolID != nil && *requesterSchoolID != staffSchoolID {
		return ErrNotAuthorized
	}
	return s.repo.UpdateStaff(ctx, staffID, req)
}

// GetStaffSchoolID retrieves the school_id for a staff member from public schema
func (s *Service) GetStaffSchoolID(ctx context.Context, staffID uuid.UUID, staffType string) (uuid.UUID, error) {
	return s.repo.GetStaffSchoolID(ctx, staffID, staffType)
}

// GetDashboard returns admin dashboard data for a school
func (s *Service) GetDashboard(ctx context.Context, schoolID uuid.UUID) (*AdminDashboard, error) {
	return s.repo.GetDashboardStats(ctx, schoolID)
}

// GetInventoryItems returns inventory items for a school with optional filters
func (s *Service) GetInventoryItems(ctx context.Context, schoolID uuid.UUID, search string, category string, page int, pageSize int) ([]InventoryItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	return s.repo.GetInventoryItems(ctx, schoolID, search, category, pageSize, offset)
}

// CreateInventoryItem creates a new inventory item
func (s *Service) CreateInventoryItem(ctx context.Context, item *InventoryItem, schoolID uuid.UUID) error {
	if item.Name == "" || item.Category == "" {
		return ErrInvalidInput
	}
	if item.Unit == "" {
		item.Unit = "pcs"
	}
	if item.MinStock < 0 || item.Quantity < 0 {
		return ErrInvalidInput
	}

	item.Status = computeInventoryStatus(item.Quantity, item.MinStock)
	return s.repo.CreateInventoryItem(ctx, item, schoolID)
}

// DeleteInventoryItem deletes an inventory item
func (s *Service) DeleteInventoryItem(ctx context.Context, itemID uuid.UUID, schoolID uuid.UUID) error {
	return s.repo.DeleteInventoryItem(ctx, itemID, schoolID)
}

// UpdateInventoryItem updates an existing inventory item
func (s *Service) UpdateInventoryItem(ctx context.Context, itemID uuid.UUID, item *InventoryItem, schoolID uuid.UUID) error {
	if item.Name == "" || item.Category == "" {
		return ErrInvalidInput
	}
	if item.Unit == "" {
		item.Unit = "pcs"
	}
	if item.MinStock < 0 || item.Quantity < 0 {
		return ErrInvalidInput
	}

	// Recompute status based on current quantity and min stock
	item.Status = computeInventoryStatus(item.Quantity, item.MinStock)
	return s.repo.UpdateInventoryItem(ctx, itemID, item, schoolID)
}

// GetUsers returns paginated list of users
func (s *Service) GetUsers(ctx context.Context, role, search string, schoolID *uuid.UUID, page, pageSize int) ([]UserListItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	return s.repo.GetAllUsers(ctx, role, search, schoolID, pageSize, offset)
}

// GetUserByID returns a user by ID
func (s *Service) GetUserByID(ctx context.Context, userID uuid.UUID, requesterSchoolID *uuid.UUID, requesterRole string) (*UserListItem, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}
	if requesterRole != "super_admin" {
		if requesterSchoolID == nil || user.SchoolID == nil || *requesterSchoolID != *user.SchoolID {
			return nil, ErrNotAuthorized
		}
	} else if requesterSchoolID != nil && user.SchoolID != nil && *requesterSchoolID != *user.SchoolID {
		return nil, ErrNotAuthorized
	}
	return user, nil
}

// CreateUser creates a new user
func (s *Service) CreateUser(ctx context.Context, req *CreateUserRequest) (uuid.UUID, error) {
	if req.Role != "student" && req.Role != "teacher" && req.Role != "admin" && req.Role != "staff" && req.Role != "parent" {
		return uuid.Nil, ErrInvalidInput
	}

	// 1. Auto-generate password if missing
	if req.Password == "" {
		req.Password = uuid.New().String()[:8] // Simple random password
	}

	// 2. If Teacher, create profile with subject-based mapping
	if req.Role == "teacher" {
		teacherReq := &CreateTeacherRequest{
			Email:       req.Email,
			Password:    req.Password,
			FullName:    req.FullName,
			Phone:       req.Phone,
			EmployeeID:  "EMP-" + uuid.New().String()[:6],
			Designation: "Teacher",
			SchoolID:    req.SchoolID,
			CreatedBy:   req.CreatedBy,
		}
		return s.repo.CreateTeacherWithProfile(ctx, teacherReq)
	}

	// 3. If Student, always create a students profile row so class-based queries work.
	//    ClassID may be empty (student will appear in unfiltered lists and can be
	//    assigned a class via the Edit dialog later).
	if req.Role == "student" {
		studentReq := &CreateStudentRequest{
			Email:        req.Email,
			Password:     req.Password,
			FullName:     req.FullName,
			Phone:        req.Phone,
			ClassID:      req.ClassID,
			AcademicYear: s.resolveAcademicYearFromContext(ctx, req.SchoolID),
		}
		return s.repo.CreateStudentWithProfile(ctx, studentReq)
	}

	id, err := s.repo.CreateUser(ctx, req)
	if err == nil {
		s.LogActivity(ctx, nil, "create", "user", &id, "", "Created user "+req.Email)
	}
	return id, err
}

// UpdateUser updates a user with authorization checks
func (s *Service) UpdateUser(ctx context.Context, userID uuid.UUID, req *UpdateUserRequest, requesterSchoolID *uuid.UUID, requesterRole string) error {
	existing, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if existing == nil {
		return ErrUserNotFound
	}

	// 1. Authorization Check (IDOR & Hierarchy Prevention)
	if requesterRole != "super_admin" {
		// Regular admins can NEVER touch Super Admins
		if existing.Role == "super_admin" {
			return ErrNotAuthorized
		}
		// Regular admins can only touch users in their own school
		if requesterSchoolID == nil || existing.SchoolID == nil || *requesterSchoolID != *existing.SchoolID {
			return ErrNotAuthorized
		}
	}

	err = s.repo.UpdateUser(ctx, userID, req)
	if err == nil {
		s.LogActivity(ctx, nil, "update", "user", &userID, "", "Updated user details")
	}
	return err
}

// DeleteUser hard deletes a user with safeguards
func (s *Service) DeleteUser(ctx context.Context, userID uuid.UUID, requesterSchoolID *uuid.UUID, requesterRole string) error {
	existing, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if existing == nil {
		return ErrUserNotFound
	}

	// 1. Authorization Check (IDOR & Hierarchy Prevention)
	if requesterRole != "super_admin" {
		// Regular admins can NEVER touch Super Admins
		if existing.Role == "super_admin" {
			return ErrNotAuthorized
		}
		// Regular admins can only touch users in their own school
		if requesterSchoolID == nil || existing.SchoolID == nil || *requesterSchoolID != *existing.SchoolID {
			return ErrNotAuthorized
		}
	}

	// 2. Safeguard: Cannot delete the last admin of a school
	if existing.Role == "admin" && existing.SchoolID != nil {
		count, err := s.repo.CountAdminsBySchool(ctx, *existing.SchoolID)
		if err != nil {
			return err
		}
		if count <= 1 {
			return ErrLastAdmin
		}
	}

	err = s.repo.DeleteUser(ctx, userID)
	if err == nil {
		s.LogActivity(ctx, nil, "delete", "user", &userID, "", "Permanently deleted user")
	}
	return err
}

func computeInventoryStatus(quantity int, minStock int) string {
	if quantity <= 0 {
		return "out-of-stock"
	}
	if quantity <= minStock {
		return "low-stock"
	}
	return "in-stock"
}

// DeleteStaff deletes a staff member with checks
func (s *Service) DeleteStaff(ctx context.Context, staffID uuid.UUID, staffType string, requesterSchoolID *uuid.UUID, requesterRole string) error {
	// Authorization is implicitly handled by Repository failing if record not in schema (Postgres isolation)
	// But we should also verify if needed.
	// The DB abstraction `DeleteStaff` needs to find the UserID first.
	// Since we are in Tenant Schema context (usually), we can only delete our own staff.

	err := s.repo.DeleteStaff(ctx, staffID, staffType)
	if err == nil {
		s.LogActivity(ctx, nil, "delete", "staff", &staffID, "", "Deleted staff member")
	}
	return err
}

// CreateStudent creates a student with profile
func (s *Service) CreateStudent(ctx context.Context, req *CreateStudentRequest) (uuid.UUID, error) {
	if strings.TrimSpace(req.AcademicYear) == "" {
		req.AcademicYear = s.resolveAcademicYearFromContext(ctx, "")
	}
	id, err := s.repo.CreateStudentWithProfile(ctx, req)
	if err == nil {
		s.LogActivity(ctx, nil, "create", "student", &id, "", "Created student "+req.Email)
	}
	return id, err
}

// CreateTeacher creates a teacher with profile
func (s *Service) CreateTeacher(ctx context.Context, req *CreateTeacherRequest) (uuid.UUID, error) {
	id, err := s.repo.CreateTeacherWithProfile(ctx, req)
	if err == nil {
		s.LogActivity(ctx, nil, "create", "teacher", &id, "", "Created teacher "+req.Email)
	}
	return id, err
}

// GetTeachers returns paginated teacher details
func (s *Service) GetTeachers(ctx context.Context, schoolID *uuid.UUID, search, status string, page, pageSize int) ([]TeacherDetail, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	return s.repo.GetTeachers(ctx, schoolID, search, status, pageSize, offset)
}

// GetTeacherByUserID returns a single teacher detail looked up by user_id
func (s *Service) GetTeacherByUserID(ctx context.Context, userID uuid.UUID, requesterSchoolID *uuid.UUID, requesterRole string) (*TeacherDetail, error) {
	teacherSchoolID, err := s.repo.GetTeacherSchoolIDByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if requesterRole != "super_admin" {
		if requesterSchoolID == nil || *requesterSchoolID != teacherSchoolID {
			return nil, ErrNotAuthorized
		}
	} else if requesterSchoolID != nil && *requesterSchoolID != teacherSchoolID {
		return nil, ErrNotAuthorized
	}
	return s.repo.GetTeacherByUserID(ctx, userID)
}

// GetTimetableConfig returns timetable configuration
func (s *Service) GetTimetableConfig(ctx context.Context) (*TimetableConfig, error) {
	return s.repo.GetTimetableConfig(ctx)
}

// UpdateTimetableConfig updates timetable configuration and prunes invalid timetable entries
func (s *Service) UpdateTimetableConfig(ctx context.Context, config *TimetableConfig) error {
	if len(config.Days) == 0 || len(config.Days) > 7 {
		return ErrInvalidInput
	}
	if len(config.Periods) == 0 || len(config.Periods) > 10 {
		return ErrInvalidInput
	}
	return s.repo.UpdateTimetableConfig(ctx, config)
}

// GetClassTimetable returns timetable entries for a class
func (s *Service) GetClassTimetable(ctx context.Context, classID uuid.UUID, academicYear string) ([]TimetableEntry, error) {
	return s.repo.GetClassTimetable(ctx, classID, academicYear)
}

// GetTeacherTimetable returns timetable entries and conflicts for a teacher
func (s *Service) GetTeacherTimetable(ctx context.Context, teacherID uuid.UUID, academicYear string) ([]TimetableEntry, []TimetableConflict, error) {
	entries, err := s.repo.GetTeacherTimetable(ctx, teacherID, academicYear)
	if err != nil {
		return nil, nil, err
	}

	conflicts := make([]TimetableConflict, 0)
	grouped := make(map[string][]TimetableEntry)
	for _, entry := range entries {
		key := fmt.Sprintf("%d-%d", entry.DayOfWeek, entry.PeriodNumber)
		grouped[key] = append(grouped[key], entry)
	}

	for _, group := range grouped {
		if len(group) <= 1 {
			continue
		}
		first := group[0]
		conflictEntries := make([]TimetableConflictEntry, 0, len(group))
		for _, entry := range group {
			conflictEntries = append(conflictEntries, TimetableConflictEntry{
				ClassID:     entry.ClassID,
				ClassName:   entry.ClassName,
				SubjectName: entry.SubjectName,
				RoomNumber:  entry.RoomNumber,
			})
		}
		conflicts = append(conflicts, TimetableConflict{
			DayOfWeek:    first.DayOfWeek,
			DayName:      dayNameFromNumber(first.DayOfWeek),
			PeriodNumber: first.PeriodNumber,
			StartTime:    first.StartTime,
			EndTime:      first.EndTime,
			Entries:      conflictEntries,
		})
	}

	return entries, conflicts, nil
}

// GetSubjectsByClass returns subjects filtered by class grade
func (s *Service) GetSubjectsByClass(ctx context.Context, classID uuid.UUID) ([]Subject, error) {
	return s.repo.GetSubjectsByClassID(ctx, classID)
}

// CreateSubject creates a new subject
func (s *Service) CreateSubject(ctx context.Context, subject *Subject, schoolID uuid.UUID) error {
	return s.repo.CreateSubject(ctx, subject, schoolID)
}

// UpdateSubject updates an existing subject
func (s *Service) UpdateSubject(ctx context.Context, subjectID uuid.UUID, subject *Subject, schoolID uuid.UUID) error {
	return s.repo.UpdateSubject(ctx, subjectID, subject, schoolID)
}

// DeleteSubject deletes a subject
func (s *Service) DeleteSubject(ctx context.Context, subjectID uuid.UUID, schoolID uuid.UUID) error {
	return s.repo.DeleteSubject(ctx, subjectID, schoolID)
}

// UpsertTimetableSlot creates or updates a timetable slot
func (s *Service) UpsertTimetableSlot(ctx context.Context, entry *TimetableEntry) error {
	return s.repo.UpsertTimetableSlot(ctx, entry)
}

// DeleteTimetableSlot deletes a timetable slot
func (s *Service) DeleteTimetableSlot(ctx context.Context, classID uuid.UUID, dayOfWeek, periodNumber int, academicYear string) error {
	return s.repo.DeleteTimetableSlot(ctx, classID, dayOfWeek, periodNumber, academicYear)
}

func dayNameFromNumber(day int) string {
	names := []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
	if day >= 0 && day < len(names) {
		return names[day]
	}
	return ""
}

// CreateTeacherDetail creates a teacher profile for admin teachers-details page
func (s *Service) CreateTeacherDetail(ctx context.Context, req *CreateTeacherDetailRequest, schoolID uuid.UUID) (uuid.UUID, error) {
	id, err := s.repo.CreateTeacherDetail(ctx, req, schoolID)
	if err == nil {
		s.LogActivity(ctx, nil, "create", "teacher", &id, "", "Created teacher "+req.Email)
	}
	return id, err
}

// UpdateTeacherDetail updates a teacher profile
func (s *Service) UpdateTeacherDetail(ctx context.Context, teacherID uuid.UUID, req *UpdateTeacherDetailRequest, requesterSchoolID *uuid.UUID, requesterRole string) error {
	teacherSchoolID, err := s.repo.GetTeacherSchoolID(ctx, teacherID)
	if err != nil {
		return err
	}
	if requesterRole != "super_admin" {
		if requesterSchoolID == nil || *requesterSchoolID != teacherSchoolID {
			return ErrNotAuthorized
		}
	} else if requesterSchoolID != nil && *requesterSchoolID != teacherSchoolID {
		return ErrNotAuthorized
	}

	if err := s.repo.UpdateTeacherDetail(ctx, teacherID, req); err != nil {
		return err
	}
	s.LogActivity(ctx, nil, "update", "teacher", &teacherID, "", "Updated teacher details")
	return nil
}

// DeleteTeacherDetail deletes a teacher profile
func (s *Service) DeleteTeacherDetail(ctx context.Context, teacherID uuid.UUID, requesterSchoolID *uuid.UUID, requesterRole string) error {
	teacherSchoolID, err := s.repo.GetTeacherSchoolID(ctx, teacherID)
	if err != nil {
		return err
	}
	if requesterRole != "super_admin" {
		if requesterSchoolID == nil || *requesterSchoolID != teacherSchoolID {
			return ErrNotAuthorized
		}
	} else if requesterSchoolID != nil && *requesterSchoolID != teacherSchoolID {
		return ErrNotAuthorized
	}

	if err := s.repo.DeleteTeacherDetail(ctx, teacherID); err != nil {
		return err
	}
	s.LogActivity(ctx, nil, "delete", "teacher", &teacherID, "", "Deleted teacher")
	return nil
}

// SuspendUser suspends a tenant user - prevents login, all content (materials, docs, quizzes) is preserved
// Requires requester's password for confirmation
func (s *Service) SuspendUser(ctx context.Context, targetID, requesterID uuid.UUID, requesterRole string, requesterSchoolID *uuid.UUID, password string) error {
	// 1. Verify requester's own password
	hash, err := s.repo.GetUserPasswordHash(ctx, requesterID)
	if err != nil {
		return ErrUserNotFound
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return ErrInvalidPassword
	}

	// 2. Cannot suspend self
	if requesterID == targetID {
		return ErrCannotSuspendSelf
	}

	// 3. Fetch target to check hierarchy and school isolation
	existing, err := s.repo.GetUserByID(ctx, targetID)
	if err != nil || existing == nil {
		return ErrUserNotFound
	}
	if requesterRole != "super_admin" {
		if existing.Role == "super_admin" || existing.Role == "admin" {
			return ErrNotAuthorized
		}
		if requesterSchoolID == nil || existing.SchoolID == nil || *requesterSchoolID != *existing.SchoolID {
			return ErrNotAuthorized
		}
	}

	if err := s.repo.SuspendUser(ctx, targetID, requesterID); err != nil {
		return err
	}
	s.LogActivity(ctx, nil, "suspend", "user", &targetID, "", "Suspended user account")
	return nil
}

// UnsuspendUser lifts a suspension - restores login access
// Requires requester's password for confirmation
func (s *Service) UnsuspendUser(ctx context.Context, targetID, requesterID uuid.UUID, requesterRole string, requesterSchoolID *uuid.UUID, password string) error {
	// 1. Verify requester's own password
	hash, err := s.repo.GetUserPasswordHash(ctx, requesterID)
	if err != nil {
		return ErrUserNotFound
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return ErrInvalidPassword
	}

	// 2. Fetch target to check school isolation
	existing, err := s.repo.GetUserByID(ctx, targetID)
	if err != nil || existing == nil {
		return ErrUserNotFound
	}
	if requesterRole != "super_admin" {
		if requesterSchoolID == nil || existing.SchoolID == nil || *requesterSchoolID != *existing.SchoolID {
			return ErrNotAuthorized
		}
	}

	if err := s.repo.UnsuspendUser(ctx, targetID); err != nil {
		return err
	}
	s.LogActivity(ctx, nil, "unsuspend", "user", &targetID, "", "Lifted suspension from user account")
	return nil
}

// GetFeeStructures returns fee structures
func (s *Service) GetFeeStructures(ctx context.Context, academicYear string) ([]FeeStructure, error) {
	return s.repo.GetFeeStructures(ctx, academicYear)
}

// CreateFeeStructure creates a fee structure
func (s *Service) CreateFeeStructure(ctx context.Context, req *CreateFeeStructureRequest) (uuid.UUID, error) {
	id, err := s.repo.CreateFeeStructure(ctx, req)
	if err == nil {
		s.LogActivity(ctx, nil, "create", "fee_structure", &id, "", "Created fee structure "+req.Name)
	}
	return id, err
}

// GetFeeDemands returns fee demands for a school
func (s *Service) GetFeeDemands(ctx context.Context, schoolID uuid.UUID, search string, status string, academicYear string, page int, pageSize int) ([]FeeDemand, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	return s.repo.GetFeeDemands(ctx, schoolID, search, status, academicYear, pageSize, offset)
}

// CreateFeeDemand creates a fee demand for a student
func (s *Service) CreateFeeDemand(ctx context.Context, schoolID uuid.UUID, req *CreateFeeDemandRequest, createdBy *uuid.UUID) (uuid.UUID, error) {
	if req.StudentID == "" || (req.PurposeID == "" && req.Purpose == "") || req.Amount <= 0 {
		return uuid.Nil, ErrInvalidInput
	}
	if strings.TrimSpace(req.AcademicYear) == "" {
		req.AcademicYear = s.resolveAcademicYearForSchool(ctx, schoolID)
	}
	return s.repo.CreateFeeDemand(ctx, schoolID, req, createdBy)
}

func (s *Service) ListFeeDemandPurposes(ctx context.Context) ([]FeeDemandPurpose, error) {
	return s.repo.ListFeeDemandPurposes(ctx)
}

func (s *Service) CreateFeeDemandPurpose(ctx context.Context, name string) (uuid.UUID, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return uuid.Nil, ErrInvalidInput
	}
	return s.repo.CreateFeeDemandPurpose(ctx, trimmed)
}

func (s *Service) UpdateFeeDemandPurpose(ctx context.Context, id uuid.UUID, name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ErrInvalidInput
	}
	return s.repo.UpdateFeeDemandPurpose(ctx, id, trimmed)
}

func (s *Service) DeleteFeeDemandPurpose(ctx context.Context, id uuid.UUID) error {
	return s.repo.DeleteFeeDemandPurpose(ctx, id)
}

func (s *Service) ListAssessments(ctx context.Context, schoolID uuid.UUID, academicYear string) ([]Assessment, error) {
	if strings.TrimSpace(academicYear) == "" {
		academicYear = getCurrentAcademicYear()
	}
	return s.repo.ListAssessments(ctx, schoolID, academicYear)
}

func (s *Service) CreateAssessment(ctx context.Context, schoolID uuid.UUID, createdBy *uuid.UUID, req *CreateAssessmentRequest) (uuid.UUID, error) {
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.AssessmentType) == "" || len(req.SubjectMarks) == 0 || len(req.ClassIDs) == 0 {
		return uuid.Nil, ErrInvalidInput
	}
	for _, subjectMark := range req.SubjectMarks {
		if subjectMark.TotalMarks <= 0 {
			return uuid.Nil, ErrInvalidInput
		}
		var breakdownSum float64
		for _, breakdown := range subjectMark.Breakdowns {
			if strings.TrimSpace(breakdown.Title) == "" || breakdown.Marks <= 0 {
				return uuid.Nil, ErrInvalidInput
			}
			breakdownSum += breakdown.Marks
		}
		if breakdownSum > subjectMark.TotalMarks {
			return uuid.Nil, ErrInvalidInput
		}
	}
	if strings.TrimSpace(req.AcademicYear) == "" {
		req.AcademicYear = getCurrentAcademicYear()
	}
	return s.repo.CreateAssessment(ctx, schoolID, createdBy, req)
}

func (s *Service) UpdateAssessment(ctx context.Context, schoolID uuid.UUID, assessmentID uuid.UUID, req *UpdateAssessmentRequest) error {
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.AssessmentType) == "" || len(req.SubjectMarks) == 0 || len(req.ClassIDs) == 0 {
		return ErrInvalidInput
	}
	locked, err := s.repo.AssessmentHasDependentReportData(ctx, schoolID, assessmentID)
	if err != nil {
		return err
	}
	if locked {
		return ErrAssessmentLocked
	}
	for _, subjectMark := range req.SubjectMarks {
		if subjectMark.TotalMarks <= 0 {
			return ErrInvalidInput
		}
		var breakdownSum float64
		for _, breakdown := range subjectMark.Breakdowns {
			if strings.TrimSpace(breakdown.Title) == "" || breakdown.Marks <= 0 {
				return ErrInvalidInput
			}
			breakdownSum += breakdown.Marks
		}
		if breakdownSum > subjectMark.TotalMarks {
			return ErrInvalidInput
		}
	}
	if strings.TrimSpace(req.AcademicYear) == "" {
		req.AcademicYear = getCurrentAcademicYear()
	}
	return s.repo.UpdateAssessment(ctx, schoolID, assessmentID, req)
}

func (s *Service) DeleteAssessment(ctx context.Context, schoolID uuid.UUID, assessmentID uuid.UUID) error {
	locked, err := s.repo.AssessmentHasDependentReportData(ctx, schoolID, assessmentID)
	if err != nil {
		return err
	}
	if locked {
		return ErrAssessmentLocked
	}
	return s.repo.DeleteAssessment(ctx, schoolID, assessmentID)
}

func (s *Service) GetAssessmentExamTimetableOptions(ctx context.Context, schoolID, assessmentID uuid.UUID, classGrade int) (string, []ExamTimetableSubjectOption, []AssessmentExamTimetableItem, error) {
	className, subjects, err := s.repo.GetAssessmentExamTimetableOptions(ctx, schoolID, assessmentID, classGrade)
	if err != nil {
		return "", nil, nil, err
	}
	items, err := s.repo.ListAssessmentExamTimetable(ctx, schoolID, assessmentID, classGrade)
	if err != nil {
		return "", nil, nil, err
	}
	return className, subjects, items, nil
}

func (s *Service) UpsertAssessmentExamTimetable(ctx context.Context, schoolID, assessmentID uuid.UUID, req *AssessmentExamTimetableUpdateRequest) error {
	if req.ClassGrade < -1 {
		return ErrInvalidInput
	}
	if len(req.Entries) == 0 {
		return ErrInvalidInput
	}

	entries := make([]AssessmentExamTimetableEntry, 0, len(req.Entries))
	seen := map[uuid.UUID]struct{}{}
	for _, entry := range req.Entries {
		subjectID, err := uuid.Parse(strings.TrimSpace(entry.SubjectID))
		if err != nil {
			return ErrInvalidInput
		}
		if strings.TrimSpace(entry.ExamDate) == "" {
			return ErrInvalidInput
		}
		if _, exists := seen[subjectID]; exists {
			continue
		}
		seen[subjectID] = struct{}{}
		entries = append(entries, AssessmentExamTimetableEntry{
			SubjectID: subjectID,
			ExamDate:  strings.TrimSpace(entry.ExamDate),
		})
	}
	if len(entries) == 0 {
		return ErrInvalidInput
	}
	return s.repo.UpsertAssessmentExamTimetable(ctx, schoolID, assessmentID, req.ClassGrade, entries)
}

// RecordPayment records a payment
func (s *Service) RecordPayment(ctx context.Context, schoolID uuid.UUID, collectorID uuid.UUID, req *RecordPaymentRequest) (uuid.UUID, string, error) {
	return s.repo.RecordPayment(ctx, schoolID, collectorID, req)
}

// GetRecentPayments returns recent payments
func (s *Service) GetRecentPayments(ctx context.Context, limit int) ([]Payment, error) {
	if limit <= 0 {
		limit = 20
	}
	return s.repo.GetRecentPayments(ctx, limit)
}

// GetRevenueChartData returns period-grouped payment totals for the revenue chart
func (s *Service) GetRevenueChartData(ctx context.Context, period string) (*FinanceChartResponse, error) {
	if period != "week" && period != "month" && period != "quarter" && period != "year" {
		period = "month"
	}
	data, err := s.repo.GetRevenueChartData(ctx, period)
	if err != nil {
		return nil, err
	}
	return &FinanceChartResponse{Period: period, Data: data}, nil
}

// GetClassStudentDistribution returns per-class-grade student counts
func (s *Service) GetClassStudentDistribution(ctx context.Context, schoolID uuid.UUID) (*ClassDistributionResponse, error) {
	items, err := s.repo.GetClassStudentDistribution(ctx, schoolID)
	if err != nil {
		return nil, err
	}
	return &ClassDistributionResponse{Items: items}, nil
}

// GetAuditLogs returns audit logs
func (s *Service) GetAuditLogs(ctx context.Context, limit int) ([]AuditLog, error) {
	if limit <= 0 {
		limit = 50
	}
	return s.repo.GetRecentAuditLogs(ctx, limit)
}

// LogActivity logs an activity
func (s *Service) LogActivity(ctx context.Context, userID *uuid.UUID, action, entityType string, entityID *uuid.UUID, ipAddress, userAgent string) {
	s.repo.LogAudit(ctx, userID, action, entityType, entityID, nil, nil, ipAddress, userAgent)
}
func (s *Service) GetUserStats(ctx context.Context) (*UserSummary, error) {
	schoolIDStr, _ := ctx.Value("school_id").(string)

	var schoolIDPtr *uuid.UUID
	if schoolIDStr != "" {
		if parsed, err := uuid.Parse(schoolIDStr); err == nil {
			schoolIDPtr = &parsed
		}
	}

	// Tenant-only model: all user stats are school-scoped.
	if schoolIDPtr == nil {
		return nil, errors.New("school_id_missing_in_token")
	}

	return s.repo.GetUserStats(ctx, schoolIDPtr)
}

func getCurrentAcademicYear() string {
	now := time.Now()
	year := now.Year()
	if int(now.Month()) < 4 {
		return fmt.Sprintf("%d-%d", year-1, year)
	}
	return fmt.Sprintf("%d-%d", year, year+1)
}

// GetWeeklyAttendanceSummary returns present/absent totals per day for the
// current calendar week (Mon → today, padded to Mon–Sun if week not finished).
func (s *Service) GetWeeklyAttendanceSummary(ctx context.Context, schoolID uuid.UUID) (*WeeklyAttendanceSummaryResponse, error) {
	now := time.Now()
	// Monday of the current week.
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7 // Sunday → day 7
	}
	weekStart := now.AddDate(0, 0, -(weekday - 1)).Truncate(24 * time.Hour)
	weekEnd := weekStart.AddDate(0, 0, 6) // Sunday

	days, err := s.repo.GetWeeklyAttendanceSummary(ctx, schoolID, weekStart, weekEnd)
	if err != nil {
		return nil, err
	}
	return &WeeklyAttendanceSummaryResponse{
		WeekStart: weekStart.Format("2006-01-02"),
		WeekEnd:   weekEnd.Format("2006-01-02"),
		Days:      days,
	}, nil
}

// --------------------------------------------------------------------------
// Admission Service Methods
// --------------------------------------------------------------------------

// ListAdmissionApplications returns paginated admission applications for the school.
func (s *Service) ListAdmissionApplications(ctx context.Context, schoolID uuid.UUID, status string, page, pageSize int) ([]AdmissionListItem, int, error) {
	return s.repo.ListAdmissionApplications(ctx, schoolID, status, page, pageSize)
}

// GetAdmissionApplication returns full detail for a single application.
func (s *Service) GetAdmissionApplication(ctx context.Context, schoolID, appID uuid.UUID) (*AdmissionApplication, error) {
	return s.repo.GetAdmissionApplication(ctx, schoolID, appID)
}

// RejectAdmission rejects an application and cleans up R2 documents.
func (s *Service) RejectAdmission(ctx context.Context, schoolID, appID, reviewerID uuid.UUID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return fmt.Errorf("%w: rejection reason is required", ErrInvalidInput)
	}
	if err := s.repo.RejectAdmission(ctx, schoolID, appID, reviewerID, reason); err != nil {
		return err
	}
	// Clean up R2 documents asynchronously (non-fatal)
	_ = s.repo.DeleteAdmissionDocuments(ctx, schoolID.String(), appID.String())
	return nil
}

// ApproveAdmission approves an application and auto-creates a student account.
func (s *Service) ApproveAdmission(ctx context.Context, schoolID, appID, reviewerID uuid.UUID, req *ApproveAdmissionRequest) error {
	// Fetch application data for the student name / DOB
	app, err := s.repo.GetAdmissionApplication(ctx, schoolID, appID)
	if err != nil {
		return err
	}
	if app.Status == "approved" || app.Status == "rejected" {
		return errors.New("application_already_actioned")
	}

	// Enforce verifiable parental consent for minors (<18 years).
	dob, dobErr := time.Parse("2006-01-02", strings.TrimSpace(app.DateOfBirth))
	if dobErr != nil {
		return fmt.Errorf("%w: invalid applicant date_of_birth", ErrInvalidInput)
	}
	ageYears := int(time.Since(dob).Hours() / 24 / 365.2425)
	if ageYears < 18 {
		reqGuardianName := ""
		reqGuardianPhone := ""
		reqGuardianRelation := ""
		reqConsentMethod := ""
		if req != nil {
			reqGuardianName = trimmedOrEmpty(req.GuardianName)
			reqGuardianPhone = trimmedOrEmpty(req.GuardianPhone)
			reqGuardianRelation = trimmedOrEmpty(req.GuardianRelation)
			reqConsentMethod = trimmedOrEmpty(req.ConsentMethod)
		}

		guardianName := firstNonEmpty(
			reqGuardianName,
			trimmedOrEmpty(app.GuardianName),
			trimmedOrEmpty(app.MotherName),
			trimmedOrEmpty(app.FatherName),
		)
		guardianPhone := firstNonEmpty(
			reqGuardianPhone,
			trimmedOrEmpty(app.GuardianPhone),
			strings.TrimSpace(app.MotherPhone),
			trimmedOrEmpty(app.FatherPhone),
		)
		guardianRelation := firstNonEmpty(
			reqGuardianRelation,
			trimmedOrEmpty(app.GuardianRelation),
			"parent",
		)
		consentMethod := firstNonEmpty(reqConsentMethod, "other")

		if req != nil && req.GuardianDeclarationAccepted {
			ip := ""
			if ipVal := ctx.Value("request_ip"); ipVal != nil {
				ip = fmt.Sprintf("%v", ipVal)
			}
			userAgent := ""
			if uaVal := ctx.Value("request_user_agent"); uaVal != nil {
				userAgent = fmt.Sprintf("%v", uaVal)
			}
			if err := s.repo.UpsertParentalConsentForAdmission(
				ctx,
				schoolID,
				appID,
				dob,
				guardianName,
				guardianPhone,
				guardianRelation,
				consentMethod,
				true,
				req.ConsentReference,
				&ip,
				&userAgent,
			); err != nil {
				return fmt.Errorf("%w: failed to persist parental consent (%v)", ErrInvalidInput, err)
			}
		}

		hasConsent, consentErr := s.repo.HasParentalConsentForAdmission(ctx, schoolID, appID)
		if consentErr != nil {
			return consentErr
		}
		if !hasConsent {
			return fmt.Errorf("%w: parental consent is required for applicants under 18", ErrInvalidInput)
		}
	}

	// Build username
	username := ""
	if req != nil && req.Username != nil {
		username = strings.TrimSpace(*req.Username)
	}
	if username == "" {
		// Auto-generate: initials of name + last4 of phone
		nameParts := strings.Fields(app.StudentName)
		for _, p := range nameParts {
			if len(p) > 0 {
				username += strings.ToLower(string(p[0]))
			}
		}
		phone := app.MotherPhone
		if len(phone) >= 4 {
			username += phone[len(phone)-4:]
		}
	}

	// Build password
	password := ""
	if req != nil && req.Password != nil {
		password = strings.TrimSpace(*req.Password)
	}
	if password == "" {
		// Default password for admission-created accounts
		password = "sCHOOLS24@123"
	}

	hashedBytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	hashedPwd := string(hashedBytes)

	// Create user + student records in a transaction
	createdUserID, createdStudentID, err := s.repo.CreateStudentFromAdmission(ctx, schoolID, app, username, hashedPwd, reviewerID, req)
	if err != nil {
		return fmt.Errorf("create student from admission: %w", err)
	}

	return s.repo.ApproveAdmission(ctx, schoolID, appID, reviewerID, createdUserID, createdStudentID)
}

// GetAdmissionSettings returns the current admission toggle, school slug, and global academic year.
func (s *Service) GetAdmissionSettings(ctx context.Context, schoolID uuid.UUID) (*AdmissionSettingsResponse, error) {
	resp, err := s.repo.GetAdmissionSettings(ctx, schoolID)
	if err != nil {
		return nil, err
	}

	resp.AdmissionPortalURL = s.buildPublicFormURL("admission", resp.SchoolSlug, false)
	resp.AdmissionEmbedURL = s.buildPublicFormURL("admission", resp.SchoolSlug, true)
	resp.TeacherAppointmentPortalURL = s.buildPublicFormURL("teacher-appointment", resp.SchoolSlug, false)
	resp.TeacherAppointmentEmbedURL = s.buildPublicFormURL("teacher-appointment", resp.SchoolSlug, true)

	return resp, nil
}

// UpdateAdmissionSettings updates the admissions open/closed flag and auto-approve setting.
func (s *Service) UpdateAdmissionSettings(ctx context.Context, schoolID uuid.UUID, req *UpdateAdmissionSettingsRequest) error {
	return s.repo.UpdateAdmissionSettings(ctx, schoolID, req.AdmissionsOpen, req.AutoApprove, req.TeacherAppointmentsOpen)
}

func (s *Service) buildPublicFormURL(formPath, slug string, embed bool) string {
	base := strings.TrimRight(strings.TrimSpace(s.config.App.FormsURL), "/")
	if base == "" || slug == "" {
		return ""
	}

	u, err := url.Parse(base)
	if err != nil {
		return ""
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/" + formPath + "/" + slug

	if embed {
		expiresUnix, signature := sharedsecurity.BuildEmbedSignature(
			s.config.App.EmbedSigningSecret,
			formPath,
			slug,
			time.Now().Add(365*24*time.Hour),
		)
		query := u.Query()
		query.Set("embed", "1")
		query.Set("expires", fmt.Sprintf("%d", expiresUnix))
		query.Set("signature", signature)
		u.RawQuery = query.Encode()
	}

	return u.String()
}

func (s *Service) InitiateLearnerTransfer(ctx context.Context, sourceSchoolID, requestedBy uuid.UUID, req *InitiateLearnerTransferRequest) (*LearnerTransferListItem, error) {
	studentID, err := uuid.Parse(strings.TrimSpace(req.StudentID))
	if err != nil {
		return nil, ErrInvalidInput
	}
	destinationSchoolID, err := uuid.Parse(strings.TrimSpace(req.DestinationSchoolID))
	if err != nil {
		return nil, ErrInvalidInput
	}
	if destinationSchoolID == sourceSchoolID {
		return nil, ErrInvalidInput
	}

	learnerID, err := s.repo.GetLearnerIDForStudent(ctx, sourceSchoolID, studentID)
	if err != nil {
		return nil, err
	}
	if learnerID == uuid.Nil {
		return nil, ErrInvalidInput
	}

	preferredAutoGovSync := true
	if req.AutoGovSync != nil {
		preferredAutoGovSync = *req.AutoGovSync
	}

	item, err := s.repo.CreateLearnerTransferRequest(ctx, learnerID, sourceSchoolID, destinationSchoolID, studentID, requestedBy, req.Reason, req.EvidenceRef, preferredAutoGovSync)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "source enrollment not active") {
			return nil, ErrInvalidInput
		}
		if strings.Contains(msg, "duplicate") || strings.Contains(msg, "destination enrollment already active") || strings.Contains(msg, "destination school not eligible") || strings.Contains(msg, "source school not eligible") {
			return nil, ErrTransferConflict
		}
		return nil, err
	}

	return item, nil
}

func (s *Service) ListLearnerTransfers(ctx context.Context, schoolID uuid.UUID, direction, status string, page, pageSize int) ([]LearnerTransferListItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if direction != "incoming" && direction != "outgoing" {
		direction = "all"
	}
	return s.repo.ListLearnerTransferRequests(ctx, schoolID, direction, strings.TrimSpace(status), page, pageSize)
}

func (s *Service) ListTransferDestinationSchools(ctx context.Context, sourceSchoolID uuid.UUID, search string, limit int) ([]TransferDestinationSchoolOption, error) {
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	items, err := s.repo.ListTransferDestinationSchools(ctx, sourceSchoolID, search, limit)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "source school not eligible") {
			return nil, ErrTransferConflict
		}
		return nil, err
	}
	return items, nil
}

func (s *Service) ReviewLearnerTransfer(ctx context.Context, schoolID, reviewerID, transferID uuid.UUID, action string, reviewNote *string, autoGovSync *bool) (*TransferReviewResult, error) {
	normalizedAction := strings.ToLower(strings.TrimSpace(action))
	if normalizedAction != "approve" && normalizedAction != "reject" {
		return nil, ErrInvalidInput
	}

	effectiveAutoGovSync := false
	if normalizedAction == "approve" {
		effectiveAutoGovSync = true
		if autoGovSync != nil {
			effectiveAutoGovSync = *autoGovSync
		}
	}

	result := &TransferReviewResult{
		TransferID:  transferID,
		Status:      normalizedAction,
		AutoGovSync: effectiveAutoGovSync,
	}

	preferredAutoGovSync, err := s.repo.ReviewLearnerTransferRequest(ctx, schoolID, reviewerID, transferID, normalizedAction, reviewNote)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "not found") {
			return nil, ErrTransferNotFound
		}
		if strings.Contains(msg, "already reviewed") || strings.Contains(msg, "source enrollment") {
			return nil, ErrTransferConflict
		}
		return nil, err
	}

	if normalizedAction == "approve" && autoGovSync == nil {
		result.AutoGovSync = preferredAutoGovSync
	}

	if normalizedAction != "approve" || !result.AutoGovSync {
		return result, nil
	}

	if s.interopService == nil {
		warning := "government sync service unavailable"
		result.GovSyncWarning = &warning
		return result, nil
	}

	interopCtx, err := s.repo.GetTransferInteropContext(ctx, transferID, schoolID)
	if err != nil {
		warning := "transfer approved but government sync context could not be prepared"
		result.GovSyncWarning = &warning
		return result, nil
	}

	sourceCode := strings.TrimSpace(trimmedOrEmpty(interopCtx.SourceSchoolCode))
	destinationCode := strings.TrimSpace(trimmedOrEmpty(interopCtx.DestinationSchoolCode))
	if sourceCode == "" || destinationCode == "" {
		warning := "transfer approved but source/destination school UDISE code is missing"
		result.GovSyncWarning = &warning
		return result, nil
	}

	consentReference := firstNonEmpty(trimmedOrEmpty(interopCtx.EvidenceRef), "transfer_request:"+transferID.String())
	job, err := s.interopService.CreateJob(ctx, interop.CreateJobRequest{
		System:    interop.SystemDIKSHA,
		Operation: interop.OperationTransferEventSync,
		DryRun:    false,
		Payload: map[string]any{
			"learner_id":               interopCtx.LearnerID.String(),
			"source_school_udise":      sourceCode,
			"destination_school_udise": destinationCode,
			"transfer_date":            interopCtx.TransferDate.Format("2006-01-02"),
			"consent_reference":        consentReference,
			"transfer_request_id":      transferID.String(),
		},
	}, reviewerID.String(), "admin", schoolID.String())
	if err != nil {
		if errors.Is(err, interop.ErrInteropDisabled) {
			warning := "transfer approved but government sync is disabled; set INTEROP_ENABLED=true"
			result.GovSyncWarning = &warning
			return result, nil
		}
		warning := "transfer approved but government sync job was not created"
		result.GovSyncWarning = &warning
		return result, nil
	}

	result.GovSyncTriggered = true
	result.GovSyncMode = "live"
	result.GovSyncJobID = &job.ID

	return result, nil
}

func (s *Service) CompleteLearnerTransfer(ctx context.Context, schoolID, reviewerID, transferID uuid.UUID, reviewNote *string, autoGovSync *bool) (*TransferReviewResult, error) {
	return s.ReviewLearnerTransfer(ctx, schoolID, reviewerID, transferID, "approve", reviewNote, autoGovSync)
}

func (s *Service) TriggerTransferGovSync(ctx context.Context, schoolID, actorID, transferID uuid.UUID) (*TransferGovSyncActionResult, error) {
	if s.interopService == nil {
		warning := "government sync service unavailable"
		return &TransferGovSyncActionResult{TransferID: transferID, GovSyncTriggered: false, GovSyncWarning: &warning}, nil
	}

	snapshot, err := s.repo.GetTransferGovSyncSnapshot(ctx, transferID, schoolID)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "not found") {
			return nil, ErrTransferNotFound
		}
		return nil, err
	}

	if snapshot.DestinationSchoolID != schoolID {
		return nil, ErrNotAuthorized
	}
	if snapshot.TransferStatus != "approved" {
		return nil, ErrTransferConflict
	}
	if snapshot.GovSyncStatus != nil {
		status := strings.TrimSpace(*snapshot.GovSyncStatus)
		if status == "pending" || status == "running" || status == "succeeded" {
			warning := "government sync already exists for this transfer"
			return &TransferGovSyncActionResult{
				TransferID:       transferID,
				GovSyncTriggered: false,
				GovSyncWarning:   &warning,
				GovSyncStatus:    snapshot.GovSyncStatus,
				GovSyncJobID:     snapshot.GovSyncJobID,
				GovSyncMode:      firstNonEmpty(trimmedOrEmpty(snapshot.GovSyncMode), ""),
			}, nil
		}
	}

	interopCtx, err := s.repo.GetTransferInteropContext(ctx, transferID, schoolID)
	if err != nil {
		return nil, ErrTransferConflict
	}

	sourceCode := strings.TrimSpace(trimmedOrEmpty(interopCtx.SourceSchoolCode))
	destinationCode := strings.TrimSpace(trimmedOrEmpty(interopCtx.DestinationSchoolCode))
	if sourceCode == "" || destinationCode == "" {
		warning := "source/destination school UDISE code is missing"
		return &TransferGovSyncActionResult{TransferID: transferID, GovSyncTriggered: false, GovSyncWarning: &warning}, nil
	}

	consentReference := firstNonEmpty(trimmedOrEmpty(interopCtx.EvidenceRef), "transfer_request:"+transferID.String())
	job, err := s.interopService.CreateJob(ctx, interop.CreateJobRequest{
		System:    interop.SystemDIKSHA,
		Operation: interop.OperationTransferEventSync,
		DryRun:    false,
		Payload: map[string]any{
			"learner_id":               interopCtx.LearnerID.String(),
			"source_school_udise":      sourceCode,
			"destination_school_udise": destinationCode,
			"transfer_date":            interopCtx.TransferDate.Format("2006-01-02"),
			"consent_reference":        consentReference,
			"transfer_request_id":      transferID.String(),
		},
	}, actorID.String(), "admin", schoolID.String())
	if err != nil {
		if errors.Is(err, interop.ErrInteropDisabled) {
			warning := "government sync is disabled; set INTEROP_ENABLED=true"
			return &TransferGovSyncActionResult{TransferID: transferID, GovSyncTriggered: false, GovSyncWarning: &warning}, nil
		}
		warning := "government sync job was not created"
		return &TransferGovSyncActionResult{TransferID: transferID, GovSyncTriggered: false, GovSyncWarning: &warning}, nil
	}

	mode := "live"
	status := string(job.Status)
	return &TransferGovSyncActionResult{
		TransferID:       transferID,
		GovSyncTriggered: true,
		GovSyncMode:      mode,
		GovSyncJobID:     &job.ID,
		GovSyncStatus:    &status,
	}, nil
}

func (s *Service) RetryTransferGovSync(ctx context.Context, schoolID, actorID, transferID uuid.UUID) (*TransferGovSyncActionResult, error) {
	_ = actorID
	if s.interopService == nil {
		warning := "government sync service unavailable"
		return &TransferGovSyncActionResult{TransferID: transferID, GovSyncTriggered: false, GovSyncWarning: &warning}, nil
	}

	snapshot, err := s.repo.GetTransferGovSyncSnapshot(ctx, transferID, schoolID)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "not found") {
			return nil, ErrTransferNotFound
		}
		return nil, err
	}

	if snapshot.DestinationSchoolID != schoolID {
		return nil, ErrNotAuthorized
	}
	if snapshot.GovSyncJobID == nil || snapshot.GovSyncStatus == nil {
		return nil, ErrTransferConflict
	}
	if strings.TrimSpace(*snapshot.GovSyncStatus) != "failed" {
		return nil, ErrTransferConflict
	}

	job, err := s.interopService.RetryJob(ctx, *snapshot.GovSyncJobID)
	if err != nil {
		warning := "retry could not be started"
		return &TransferGovSyncActionResult{
			TransferID:       transferID,
			GovSyncTriggered: false,
			GovSyncWarning:   &warning,
			GovSyncJobID:     snapshot.GovSyncJobID,
			GovSyncStatus:    snapshot.GovSyncStatus,
		}, nil
	}

	mode := "live"
	status := string(job.Status)
	return &TransferGovSyncActionResult{
		TransferID:       transferID,
		GovSyncTriggered: true,
		GovSyncMode:      mode,
		GovSyncJobID:     &job.ID,
		GovSyncStatus:    &status,
	}, nil
}

func (s *Service) ScanLearnerReconciliationCases(ctx context.Context) (int, error) {
	return s.repo.ScanLearnerReconciliationCases(ctx)
}

func (s *Service) ListLearnerReconciliationCases(ctx context.Context, status string, page, pageSize int) ([]LearnerReconciliationCaseItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	normalizedStatus := strings.ToLower(strings.TrimSpace(status))
	if normalizedStatus != "" && normalizedStatus != "pending" && normalizedStatus != "resolved" && normalizedStatus != "dismissed" {
		normalizedStatus = ""
	}
	return s.repo.ListLearnerReconciliationCases(ctx, normalizedStatus, page, pageSize)
}

func (s *Service) ReviewLearnerReconciliationCase(ctx context.Context, reviewerID, caseID uuid.UUID, action string, survivorLearnerID *string, reviewNote *string) error {
	normalizedAction := strings.ToLower(strings.TrimSpace(action))
	if normalizedAction != "merge" && normalizedAction != "dismiss" {
		return ErrInvalidInput
	}

	var survivorID *uuid.UUID
	if normalizedAction == "merge" {
		if survivorLearnerID != nil && strings.TrimSpace(*survivorLearnerID) != "" {
			parsedID, err := uuid.Parse(strings.TrimSpace(*survivorLearnerID))
			if err != nil {
				return ErrInvalidInput
			}
			survivorID = &parsedID
		}
	}

	err := s.repo.ReviewLearnerReconciliationCase(ctx, reviewerID, caseID, normalizedAction, survivorID, reviewNote)
	if err != nil {
		msg := strings.ToLower(err.Error())
		switch {
		case strings.Contains(msg, "not found"):
			return ErrReconciliationNotFound
		case strings.Contains(msg, "already") || strings.Contains(msg, "invalid survivor") || strings.Contains(msg, "merged"):
			return ErrReconciliationConflict
		default:
			return err
		}
	}

	return nil
}

func (s *Service) UnmergeLearnerReconciliationCase(ctx context.Context, reviewerID, caseID uuid.UUID, reviewNote *string) error {
	err := s.repo.UnmergeLearnerReconciliationCase(ctx, reviewerID, caseID, reviewNote)
	if err != nil {
		msg := strings.ToLower(err.Error())
		switch {
		case strings.Contains(msg, "not found"):
			return ErrReconciliationNotFound
		case strings.Contains(msg, "not merged") || strings.Contains(msg, "already unmerged") || strings.Contains(msg, "history"):
			return ErrReconciliationConflict
		default:
			return err
		}
	}

	return nil
}

// ViewAdmissionDocument fetches a document from R2 for admin.
func (s *Service) ViewAdmissionDocument(ctx context.Context, schoolID, appID uuid.UUID, docObjectID string) (string, string, []byte, error) {
	if _, err := s.repo.GetAdmissionApplication(ctx, schoolID, appID); err != nil {
		return "", "", nil, err
	}
	return s.repo.GetAdmissionDocument(ctx, schoolID.String(), appID.String(), docObjectID)
}

func (s *Service) ListTeacherAppointmentApplications(ctx context.Context, schoolID uuid.UUID, status string, page, pageSize int) ([]TeacherAppointmentListItem, int, error) {
	return s.repo.ListTeacherAppointmentApplications(ctx, schoolID, status, page, pageSize)
}

func (s *Service) GetTeacherAppointmentApplication(ctx context.Context, schoolID, appID uuid.UUID) (*TeacherAppointmentApplication, []TeacherAppointmentDocumentMeta, error) {
	app, err := s.repo.GetTeacherAppointmentApplication(ctx, schoolID, appID)
	if err != nil {
		return nil, nil, err
	}
	docs, err := s.repo.ListTeacherAppointmentDocuments(ctx, schoolID.String(), appID.String())
	if err != nil {
		return nil, nil, err
	}
	return app, docs, nil
}

func splitSubjectsFromExpertise(expertise string) []string {
	expertise = strings.TrimSpace(expertise)
	if expertise == "" {
		return []string{}
	}
	normalized := strings.NewReplacer("|", ",", ";", ",", "/", ",").Replace(expertise)
	parts := strings.Split(normalized, ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{})
	for _, p := range parts {
		subject := strings.TrimSpace(p)
		if subject == "" {
			continue
		}
		key := strings.ToLower(subject)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, subject)
	}
	return out
}

func (s *Service) ApproveTeacherAppointment(ctx context.Context, schoolID, appID, reviewerID uuid.UUID, req *ApproveTeacherAppointmentRequest) error {
	app, err := s.repo.GetTeacherAppointmentApplication(ctx, schoolID, appID)
	if err != nil {
		return err
	}

	subjects := splitSubjectsFromExpertise(func() string {
		if app.SubjectExpertise == nil {
			return ""
		}
		return *app.SubjectExpertise
	}())
	department := ""
	if len(subjects) > 0 {
		department = subjects[0]
	}
	password := "Teacher@123"
	if req != nil && req.Password != nil && strings.TrimSpace(*req.Password) != "" {
		password = strings.TrimSpace(*req.Password)
	}
	employeeID := "TCH-" + strings.ToUpper(app.ID.String()[:8])
	if req != nil && req.EmployeeID != nil && strings.TrimSpace(*req.EmployeeID) != "" {
		employeeID = strings.TrimSpace(*req.EmployeeID)
	}

	createReq := &CreateTeacherDetailRequest{
		Email:          strings.TrimSpace(strings.ToLower(app.Email)),
		Password:       password,
		FullName:       strings.TrimSpace(app.FullName),
		Phone:          strings.TrimSpace(app.Phone),
		EmployeeID:     employeeID,
		Department:     department,
		Designation:    "Teacher",
		SubjectsTaught: subjects,
		Status:         "active",
	}
	if app.ExperienceYears != nil {
		createReq.Experience = *app.ExperienceYears
	}

	teacherUserID, err := s.repo.CreateTeacherDetail(ctx, createReq, schoolID)
	if err != nil {
		return fmt.Errorf("create teacher from appointment: %w", err)
	}

	if err := s.repo.ApproveTeacherAppointmentApplication(ctx, schoolID, appID, reviewerID, teacherUserID); err != nil {
		return err
	}
	if err := s.repo.CreateTeacherAppointmentDecision(
		ctx,
		schoolID,
		app,
		"approved",
		nil,
		&reviewerID,
		&teacherUserID,
	); err != nil {
		return err
	}
	if err := s.repo.DeleteTeacherAppointmentDocuments(ctx, schoolID.String(), appID.String()); err != nil {
		return err
	}
	if err := s.repo.DeleteTeacherAppointmentApplication(ctx, schoolID, appID); err != nil {
		return err
	}
	s.LogActivity(ctx, &reviewerID, "approve", "teacher_appointment", &appID, "", "Approved teacher appointment and created teacher user")
	return nil
}

func (s *Service) RejectTeacherAppointment(ctx context.Context, schoolID, appID, reviewerID uuid.UUID, reason string) error {
	app, err := s.repo.GetTeacherAppointmentApplication(ctx, schoolID, appID)
	if err != nil {
		return err
	}
	var reasonPtr *string
	reason = strings.TrimSpace(reason)
	if reason != "" {
		reasonPtr = &reason
	}
	if err := s.repo.RejectTeacherAppointmentApplication(ctx, schoolID, appID, reviewerID, reasonPtr); err != nil {
		return err
	}
	if err := s.repo.CreateTeacherAppointmentDecision(
		ctx,
		schoolID,
		app,
		"rejected",
		reasonPtr,
		&reviewerID,
		nil,
	); err != nil {
		return err
	}
	if err := s.repo.DeleteTeacherAppointmentDocuments(ctx, schoolID.String(), appID.String()); err != nil {
		return err
	}
	if err := s.repo.DeleteTeacherAppointmentApplication(ctx, schoolID, appID); err != nil {
		return err
	}
	s.LogActivity(ctx, &reviewerID, "reject", "teacher_appointment", &appID, "", "Rejected teacher appointment and removed application")
	return nil
}

func (s *Service) ViewTeacherAppointmentDocument(ctx context.Context, schoolID, appID uuid.UUID, docID string) (string, string, []byte, error) {
	if _, err := s.repo.GetTeacherAppointmentApplication(ctx, schoolID, appID); err != nil {
		return "", "", nil, err
	}
	return s.repo.GetTeacherAppointmentDocument(ctx, schoolID.String(), appID.String(), docID)
}

func (s *Service) ListTeacherAppointmentDecisions(ctx context.Context, schoolID uuid.UUID, page, pageSize int) ([]TeacherAppointmentDecisionItem, int, error) {
	return s.repo.ListTeacherAppointmentDecisions(ctx, schoolID, page, pageSize)
}
