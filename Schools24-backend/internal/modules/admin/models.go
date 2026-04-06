package admin

import (
	"time"

	"github.com/google/uuid"
)

// AdminDashboard represents the admin dashboard data
type AdminDashboard struct {
	TotalUsers      int                 `json:"total_users"`
	TotalAdmins     int                 `json:"total_admins"`
	TotalStudents   int                 `json:"total_students"`
	TotalTeachers   int                 `json:"total_teachers"`
	TotalClasses    int                 `json:"total_classes"`
	FeeCollection   *FeeStats           `json:"fee_collection"`
	AttendanceStats *AttendanceOverview `json:"attendance_stats"`
	RecentActivity  []AuditLog          `json:"recent_activity"`
	UpcomingEvents  []Event             `json:"upcoming_events"`
	InventoryAlerts []InventoryItem     `json:"inventory_alerts"`
}

// UserSummary provides a breakdown of users by role
type UserSummary struct {
	Total    int `json:"total"`
	Admins   int `json:"admins"`
	Teachers int `json:"teachers"`
	Students int `json:"students"`
	Staff    int `json:"staff"`
}

// FeeStats summarizes fee collection
type FeeStats struct {
	TotalDue       float64 `json:"total_due"`
	TotalCollected float64 `json:"total_collected"`
	TotalPending   float64 `json:"total_pending"`
	TotalOverdue   float64 `json:"total_overdue"`
	CollectionRate float64 `json:"collection_rate_percent"`
}

// AttendanceOverview for admin dashboard
type AttendanceOverview struct {
	TodayPresent int        `json:"today_present"`
	TodayAbsent  int        `json:"today_absent"`
	TodayLate    int        `json:"today_late"`
	WeekAverage  float64    `json:"week_average_percent"`
	SchoolID     *uuid.UUID `json:"school_id,omitempty"`
	MonthAverage float64    `json:"month_average_percent"`
}

// FeeStructure represents a fee structure
type FeeStructure struct {
	ID               uuid.UUID `json:"id" db:"id"`
	Name             string    `json:"name" db:"name"`
	Description      *string   `json:"description,omitempty" db:"description"`
	ApplicableGrades []int     `json:"applicable_grades,omitempty" db:"applicable_grades"`
	AcademicYear     string    `json:"academic_year" db:"academic_year"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`

	// Nested
	Items []FeeItem `json:"items,omitempty"`
}

// FeeItem represents a fee item within a structure
type FeeItem struct {
	ID             uuid.UUID `json:"id" db:"id"`
	FeeStructureID uuid.UUID `json:"fee_structure_id" db:"fee_structure_id"`
	Name           string    `json:"name" db:"name"`
	Amount         float64   `json:"amount" db:"amount"`
	Frequency      string    `json:"frequency" db:"frequency"` // one_time, monthly, quarterly, yearly
	IsOptional     bool      `json:"is_optional" db:"is_optional"`
	DueDay         int       `json:"due_day" db:"due_day"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

// StudentFee represents an assigned fee for a student
type StudentFee struct {
	ID           uuid.UUID  `json:"id" db:"id"`
	StudentID    uuid.UUID  `json:"student_id" db:"student_id"`
	FeeItemID    uuid.UUID  `json:"fee_item_id" db:"fee_item_id"`
	Purpose      *string    `json:"purpose,omitempty" db:"purpose"`
	Amount       float64    `json:"amount" db:"amount"`
	DueDate      time.Time  `json:"due_date" db:"due_date"`
	Status       string     `json:"status" db:"status"` // pending, paid, partial, overdue, waived
	PaidAmount   float64    `json:"paid_amount" db:"paid_amount"`
	WaiverAmount float64    `json:"waiver_amount" db:"waiver_amount"`
	WaiverReason *string    `json:"waiver_reason,omitempty" db:"waiver_reason"`
	AcademicYear string     `json:"academic_year" db:"academic_year"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy    *uuid.UUID `json:"created_by,omitempty" db:"created_by"`
	UpdatedBy    *uuid.UUID `json:"updated_by,omitempty" db:"updated_by"`

	// Joined fields
	StudentName string `json:"student_name,omitempty"`
	FeeItemName string `json:"fee_item_name,omitempty"`
	ClassName   string `json:"class_name,omitempty"`
}

// FeeDemand represents a fee demand per student with payment summary
type FeeDemand struct {
	ID              uuid.UUID  `json:"id" db:"id"`
	StudentID       uuid.UUID  `json:"student_id" db:"student_id"`
	StudentName     string     `json:"student_name" db:"student_name"`
	AdmissionNumber string     `json:"admission_number" db:"admission_number"`
	ClassName       string     `json:"class_name" db:"class_name"`
	AcademicYear    string     `json:"academic_year" db:"academic_year"`
	PurposeID       *uuid.UUID `json:"purpose_id,omitempty" db:"purpose_id"`
	Purpose         string     `json:"purpose" db:"purpose"`
	Amount          float64    `json:"amount" db:"amount"`
	PaidAmount      float64    `json:"paid_amount" db:"paid_amount"`
	DueDate         *time.Time `json:"due_date,omitempty" db:"due_date"`
	LastPaymentDate *time.Time `json:"last_payment_date,omitempty" db:"last_payment_date"`
	Status          string     `json:"status" db:"status"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at" db:"updated_at"`
}

// Payment represents a payment transaction
type Payment struct {
	ID            uuid.UUID  `json:"id" db:"id"`
	StudentID     uuid.UUID  `json:"student_id" db:"student_id"`
	StudentFeeID  *uuid.UUID `json:"student_fee_id,omitempty" db:"student_fee_id"`
	Amount        float64    `json:"amount" db:"amount"`
	PaymentMethod string     `json:"payment_method" db:"payment_method"` // cash, card, upi, bank_transfer, cheque, online
	TransactionID *string    `json:"transaction_id,omitempty" db:"transaction_id"`
	ReceiptNumber string     `json:"receipt_number" db:"receipt_number"`
	PaymentDate   time.Time  `json:"payment_date" db:"payment_date"`
	Status        string     `json:"status" db:"status"` // pending, completed, failed, refunded
	Notes         *string    `json:"notes,omitempty" db:"notes"`
	Purpose       *string    `json:"purpose,omitempty" db:"purpose"`
	CollectedBy   *uuid.UUID `json:"collected_by,omitempty" db:"collected_by"`
	CreatedAt     time.Time  `json:"created_at" db:"created_at"`

	// Joined fields
	StudentName   string `json:"student_name,omitempty"`
	CollectorName string `json:"collector_name,omitempty"`
}

// AuditLog represents an audit log entry
type AuditLog struct {
	ID         uuid.UUID   `json:"id" db:"id"`
	UserID     *uuid.UUID  `json:"user_id,omitempty" db:"user_id"`
	Action     string      `json:"action" db:"action"`
	EntityType string      `json:"entity_type" db:"entity_type"`
	EntityID   *uuid.UUID  `json:"entity_id,omitempty" db:"entity_id"`
	OldValues  interface{} `json:"old_values,omitempty" db:"old_values"`
	NewValues  interface{} `json:"new_values,omitempty" db:"new_values"`
	IPAddress  *string     `json:"ip_address,omitempty" db:"ip_address"`
	UserAgent  *string     `json:"user_agent,omitempty" db:"user_agent"`
	CreatedAt  time.Time   `json:"created_at" db:"created_at"`

	// Joined fields
	UserName string `json:"user_name,omitempty"`
}

// Request types

// CreateUserRequest for admin creating users
type CreateUserRequest struct {
	// binding:"required" only — email format is validated manually after TrimSpace
	// so that copy-pasted addresses with leading/trailing whitespace don't get a
	// cryptic "failed on the 'email' tag" error.
	Email      string `json:"email" binding:"required"`
	Password   string `json:"password"` // Optional, will be generated if empty
	FullName   string `json:"full_name" binding:"required"`
	Role       string `json:"role" binding:"required"` // student, teacher, admin, staff, parent
	Phone      string `json:"phone,omitempty"`
	Department string `json:"department,omitempty"` // For teachers/staff
	SchoolID   string `json:"school_id,omitempty"`  // Optional, for Super Admins
	CreatedBy  string `json:"-"`                    // Internal field, populated from context
	ClassID    string `json:"class_id,omitempty"`   // For students: optional class assignment at creation time
}

// UpdateUserRequest for admin updating users
type UpdateUserRequest struct {
	Email    string `json:"email,omitempty"`
	FullName string `json:"full_name,omitempty"`
	Role     string `json:"role,omitempty"`
	Phone    string `json:"phone,omitempty"`
	Password string `json:"password,omitempty"` // New field
}

// CreateStudentRequest for creating student with profile
type CreateStudentRequest struct {
	Email           string `json:"email" binding:"required,email"`
	Password        string `json:"password" binding:"required,min=6"`
	FullName        string `json:"full_name" binding:"required"`
	Phone           string `json:"phone,omitempty"`
	ClassID         string `json:"class_id" binding:"required"`
	Section         string `json:"section,omitempty"`
	RollNumber      string `json:"roll_number,omitempty"`
	AdmissionNumber string `json:"admission_number,omitempty"`
	DateOfBirth     string `json:"date_of_birth,omitempty"` // YYYY-MM-DD
	Gender          string `json:"gender,omitempty"`        // male, female, other
	AcademicYear    string `json:"academic_year,omitempty"` // e.g. 2025-2026
	ParentName      string `json:"parent_name,omitempty"`
	ParentPhone     string `json:"parent_phone,omitempty"`
	ParentEmail     string `json:"parent_email,omitempty"`
	Address         string `json:"address,omitempty"`
}

// CreateTeacherRequest for creating teacher with profile
type CreateTeacherRequest struct {
	Email          string   `json:"email" binding:"required,email"`
	Password       string   `json:"password" binding:"required,min=6"`
	FullName       string   `json:"full_name" binding:"required"`
	Phone          string   `json:"phone,omitempty"`
	EmployeeID     string   `json:"employee_id" binding:"required"`
	Department     string   `json:"department,omitempty"`
	Designation    string   `json:"designation,omitempty"`
	Qualifications []string `json:"qualifications,omitempty"`
	SubjectsTaught []string `json:"subjects_taught,omitempty"`
	SchoolID       string   `json:"school_id,omitempty"`
	CreatedBy      string   `json:"-"` // Internal field, populated from context
}

// CreateFeeStructureRequest for creating fee structure
type CreateFeeStructureRequest struct {
	Name             string         `json:"name" binding:"required"`
	Description      string         `json:"description,omitempty"`
	ApplicableGrades []int          `json:"applicable_grades,omitempty"`
	AcademicYear     string         `json:"academic_year" binding:"required"`
	Items            []FeeItemInput `json:"items,omitempty"`
}

// FeeItemInput for creating fee items
type FeeItemInput struct {
	Name       string  `json:"name" binding:"required"`
	Amount     float64 `json:"amount" binding:"required"`
	Frequency  string  `json:"frequency"` // one_time, monthly, quarterly, yearly
	IsOptional bool    `json:"is_optional"`
	DueDay     int     `json:"due_day"`
}

// RecordPaymentRequest for recording a payment
type RecordPaymentRequest struct {
	StudentID     string  `json:"student_id" binding:"required"`
	StudentFeeID  string  `json:"student_fee_id,omitempty"`
	Amount        float64 `json:"amount" binding:"required,gt=0"`
	PaymentMethod string  `json:"payment_method" binding:"required"` // cash, card, upi, bank_transfer, cheque, online
	TransactionID string  `json:"transaction_id,omitempty"`
	Notes         string  `json:"notes,omitempty"`
	Purpose       string  `json:"purpose,omitempty"`
}

// CreateFeeDemandRequest represents a demand raised for a student
type CreateFeeDemandRequest struct {
	StudentID    string  `json:"student_id" binding:"required"`
	PurposeID    string  `json:"purpose_id,omitempty"`
	Purpose      string  `json:"purpose,omitempty"`
	Amount       float64 `json:"amount" binding:"required,gt=0"`
	DueDate      string  `json:"due_date,omitempty"` // YYYY-MM-DD
	AcademicYear string  `json:"academic_year,omitempty"`
}

type FeeDemandPurpose struct {
	ID        uuid.UUID `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type CreateFeeDemandPurposeRequest struct {
	Name string `json:"name" binding:"required"`
}

type UpdateFeeDemandPurposeRequest struct {
	Name string `json:"name" binding:"required"`
}

type AssessmentSubjectMark struct {
	ID           uuid.UUID                 `json:"id" db:"id"`
	AssessmentID uuid.UUID                 `json:"assessment_id" db:"assessment_id"`
	SubjectID    *uuid.UUID                `json:"subject_id,omitempty" db:"subject_id"`
	SubjectName  string                    `json:"subject_name,omitempty"`
	SubjectLabel string                    `json:"subject_label,omitempty" db:"subject_label"`
	MaxMarks     float64                   `json:"total_marks" db:"max_marks"`
	Breakdowns   []AssessmentMarkBreakdown `json:"breakdowns,omitempty"`
}

type AssessmentMarkBreakdown struct {
	ID                      uuid.UUID `json:"id" db:"id"`
	AssessmentSubjectMarkID uuid.UUID `json:"assessment_subject_mark_id" db:"assessment_subject_mark_id"`
	Title                   string    `json:"title" db:"title"`
	Marks                   float64   `json:"marks" db:"marks"`
}

type Assessment struct {
	ID             uuid.UUID               `json:"id" db:"id"`
	SchoolID       uuid.UUID               `json:"school_id" db:"school_id"`
	ClassID        *uuid.UUID              `json:"class_id,omitempty" db:"class_id"`
	ClassName      string                  `json:"class_name,omitempty"`
	ClassGrades    []int                   `json:"class_grades,omitempty"`
	ClassIDs       []string                `json:"class_ids,omitempty"`
	ClassLabels    []string                `json:"class_labels,omitempty"`
	Name           string                  `json:"name" db:"name"`
	AssessmentType string                  `json:"assessment_type" db:"assessment_type"`
	Description    *string                 `json:"description,omitempty" db:"description"`
	ScheduledDate  *time.Time              `json:"scheduled_date,omitempty" db:"scheduled_date"`
	AcademicYear   string                  `json:"academic_year" db:"academic_year"`
	TotalMarks     float64                 `json:"total_marks" db:"max_marks"`
	CreatedBy      *uuid.UUID              `json:"created_by,omitempty" db:"created_by"`
	CreatedAt      time.Time               `json:"created_at" db:"created_at"`
	UpdatedAt      *time.Time              `json:"updated_at,omitempty" db:"updated_at"`
	SubjectMarks   []AssessmentSubjectMark `json:"subject_marks,omitempty"`
}

type AssessmentMarkBreakdownInput struct {
	Title string  `json:"title" binding:"required"`
	Marks float64 `json:"marks" binding:"required,gt=0"`
}

type AssessmentSubjectMarkInput struct {
	TotalMarks float64                        `json:"total_marks" binding:"required,gt=0"`
	Breakdowns []AssessmentMarkBreakdownInput `json:"breakdowns,omitempty"`
}

type CreateAssessmentRequest struct {
	Name           string                       `json:"name" binding:"required"`
	AssessmentType string                       `json:"assessment_type" binding:"required"`
	ClassIDs       []string                     `json:"class_ids" binding:"required,min=1"`
	ScheduledDate  string                       `json:"scheduled_date,omitempty"` // YYYY-MM-DD
	AcademicYear   string                       `json:"academic_year,omitempty"`
	SubjectMarks   []AssessmentSubjectMarkInput `json:"subject_marks" binding:"required,min=1,dive"`
}

type UpdateAssessmentRequest struct {
	Name           string                       `json:"name" binding:"required"`
	AssessmentType string                       `json:"assessment_type" binding:"required"`
	ClassIDs       []string                     `json:"class_ids" binding:"required,min=1"`
	ScheduledDate  string                       `json:"scheduled_date,omitempty"` // YYYY-MM-DD
	AcademicYear   string                       `json:"academic_year,omitempty"`
	SubjectMarks   []AssessmentSubjectMarkInput `json:"subject_marks" binding:"required,min=1,dive"`
}

type ExamTimetableSubjectOption struct {
	ClassID   uuid.UUID `json:"class_id"`
	SubjectID uuid.UUID `json:"subject_id"`
	Name      string    `json:"name"`
	Code      string    `json:"code"`
}

type AssessmentExamTimetableEntry struct {
	SubjectID uuid.UUID `json:"subject_id"`
	ExamDate  string    `json:"exam_date"`
}

type AssessmentExamTimetableItem struct {
	ID        uuid.UUID `json:"id"`
	SubjectID uuid.UUID `json:"subject_id"`
	Subject   string    `json:"subject"`
	ExamDate  string    `json:"exam_date"`
}

type AssessmentExamTimetableUpdateRequest struct {
	ClassGrade int                                   `json:"class_grade" binding:"required"`
	Entries    []AssessmentExamTimetableEntryRequest `json:"entries" binding:"required,min=1,dive"`
}

type AssessmentExamTimetableEntryRequest struct {
	SubjectID string `json:"subject_id" binding:"required"`
	ExamDate  string `json:"exam_date" binding:"required"` // YYYY-MM-DD
}

// UserListItem for user listing
type UserListItem struct {
	ID            uuid.UUID  `json:"id"`
	Email         string     `json:"email"`
	FullName      string     `json:"full_name"`
	Role          string     `json:"role"`
	Phone         *string    `json:"phone,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	CreatedBy     *uuid.UUID `json:"created_by,omitempty"`
	CreatedByName *string    `json:"created_by_name,omitempty"`
	LastLogin     *time.Time `json:"last_login,omitempty"`
	Avatar        string     `json:"avatar"`
	Department    string     `json:"department"`
	SchoolID      *uuid.UUID `json:"school_id"`
	Rating        float64    `json:"rating"` // Added: Teacher rating
	Salary        float64    `json:"salary"` // Added: Teacher/staff salary
	IsSuspended   bool       `json:"is_suspended"`
	SuspendedAt   *time.Time `json:"suspended_at,omitempty"`
	ClassName     string     `json:"class_name"`
	RollNumber    string     `json:"roll_number"`
	ParentName    string     `json:"parent_name"`
	ParentPhone   string     `json:"parent_phone"`
}

// SuspendUserRequest carries the requester's password for verification
type SuspendUserRequest struct {
	Password string `json:"password" binding:"required"`
}

// InventoryItem represents an item in the school inventory
type InventoryItem struct {
	ID          uuid.UUID `json:"id" db:"id"`
	SchoolID    uuid.UUID `json:"school_id" db:"school_id"`
	Name        string    `json:"name" db:"name"`
	Category    string    `json:"category" db:"category"`
	Quantity    int       `json:"quantity" db:"quantity"`
	Unit        string    `json:"unit" db:"unit"`
	MinStock    int       `json:"min_stock" db:"min_stock"`
	Location    string    `json:"location" db:"location"`
	Status      string    `json:"status" db:"status"` // in-stock, low-stock, out-of-stock
	LastUpdated time.Time `json:"last_updated" db:"last_updated"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// Event represents a school event
type Event struct {
	ID          uuid.UUID `json:"id" db:"id"`
	SchoolID    uuid.UUID `json:"school_id" db:"school_id"`
	Title       string    `json:"title" db:"title"`
	Description *string   `json:"description,omitempty" db:"description"`
	EventDate   time.Time `json:"event_date" db:"event_date"`
	StartTime   *string   `json:"start_time,omitempty" db:"start_time"`
	EndTime     *string   `json:"end_time,omitempty" db:"end_time"`
	Type        string    `json:"type" db:"type"` // holiday, exam, event, meeting, sports, cultural
	Location    *string   `json:"location,omitempty" db:"location"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// BusRoute represents a transport route
type BusRoute struct {
	ID              uuid.UUID  `json:"id" db:"id"`
	SchoolID        uuid.UUID  `json:"schoolId" db:"school_id"`
	RouteNumber     string     `json:"routeNumber" db:"route_number"`
	DriverStaffID   *uuid.UUID `json:"driverStaffId,omitempty" db:"driver_staff_id"`
	DriverName      string     `json:"driverName" db:"driver_name"`
	DriverPhone     string     `json:"driverPhone" db:"driver_phone"`
	VehicleNumber   string     `json:"vehicleNumber" db:"vehicle_number"`
	Capacity        int        `json:"capacity" db:"capacity"`
	CurrentStudents int        `json:"currentStudents" db:"current_students"`
	Stops           []BusStop  `json:"stops,omitempty"`
}

// BusStop represents a stop on a bus route
type BusStop struct {
	ID        uuid.UUID `json:"id" db:"id"`
	RouteID   uuid.UUID `json:"routeId" db:"route_id"`
	Name      string    `json:"name" db:"name"`
	Time      string    `json:"time" db:"time"`
	StopOrder int       `json:"stopOrder" db:"stop_order"`
}

type BusStopInput struct {
	Name string `json:"name" binding:"required"`
	Time string `json:"time"`
}

type BusRouteStop struct {
	ID           uuid.UUID `json:"id" db:"id"`
	SchoolID     uuid.UUID `json:"school_id" db:"school_id"`
	RouteID      uuid.UUID `json:"route_id" db:"route_id"`
	Sequence     int       `json:"sequence" db:"sequence"`
	StopName     string    `json:"stop_name" db:"stop_name"`
	Address      *string   `json:"address,omitempty" db:"address"`
	Lat          float64   `json:"lat" db:"lat"`
	Lng          float64   `json:"lng" db:"lng"`
	RadiusMeters int       `json:"radius_meters" db:"radius_meters"`
	PlaceID      *string   `json:"place_id,omitempty" db:"place_id"`
	Notes        *string   `json:"notes,omitempty" db:"notes"`
}

type BusRouteShape struct {
	RouteID     uuid.UUID `json:"route_id" db:"route_id"`
	SchoolID    uuid.UUID `json:"school_id" db:"school_id"`
	Polyline    string    `json:"polyline" db:"polyline"`
	DistanceM   *int      `json:"distance_m,omitempty" db:"distance_m"`
	DurationEst *int      `json:"duration_est,omitempty" db:"duration_est"`
}

type BusRouteStopInput struct {
	Sequence     int     `json:"sequence"`
	StopName     string  `json:"stop_name" binding:"required"`
	Address      string  `json:"address"`
	Lat          float64 `json:"lat" binding:"required"`
	Lng          float64 `json:"lng" binding:"required"`
	RadiusMeters int     `json:"radius_meters"`
	PlaceID      string  `json:"place_id"`
	Notes        string  `json:"notes"`
}

type UpdateBusRouteStopsRequest struct {
	Stops []BusRouteStopInput `json:"stops" binding:"required,min=1,dive"`
}

type UpdateBusRouteShapeRequest struct {
	Polyline    string `json:"polyline" binding:"required"`
	DistanceM   *int   `json:"distance_m"`
	DurationEst *int   `json:"duration_est"`
}

type BusStopAssignment struct {
	ID           uuid.UUID `json:"id" db:"id"`
	SchoolID     uuid.UUID `json:"school_id" db:"school_id"`
	StudentID    uuid.UUID `json:"student_id" db:"student_id"`
	RouteID      uuid.UUID `json:"route_id" db:"route_id"`
	StopID       uuid.UUID `json:"stop_id" db:"stop_id"`
	PickupOrDrop string    `json:"pickup_or_drop" db:"pickup_or_drop"`
	StudentName  string    `json:"student_name,omitempty" db:"student_name"`
	StopName     string    `json:"stop_name,omitempty" db:"stop_name"`
	Sequence     int       `json:"sequence,omitempty" db:"sequence"`
}

type BusStopAssignmentInput struct {
	StudentID    string `json:"student_id" binding:"required"`
	StopID       string `json:"stop_id" binding:"required"`
	PickupOrDrop string `json:"pickup_or_drop"`
}

type UpdateBusStopAssignmentsRequest struct {
	Assignments []BusStopAssignmentInput `json:"assignments" binding:"required"`
}

type CreateBusRouteRequest struct {
	RouteNumber   string         `json:"route_number" binding:"required"`
	VehicleNumber string         `json:"vehicle_number" binding:"required"`
	DriverStaffID string         `json:"driver_staff_id" binding:"required"`
	Capacity      int            `json:"capacity"`
	Stops         []BusStopInput `json:"stops"`
}

type UpdateBusRouteRequest struct {
	RouteNumber   string         `json:"route_number" binding:"required"`
	VehicleNumber string         `json:"vehicle_number" binding:"required"`
	DriverStaffID string         `json:"driver_staff_id" binding:"required"`
	Capacity      int            `json:"capacity"`
	Stops         []BusStopInput `json:"stops"`
}

// Staff represents a teaching or non-teaching staff member (Unified View)
type Staff struct {
	ID               uuid.UUID  `json:"id"`
	UserID           uuid.UUID  `json:"userId"`
	Name             string     `json:"name"`
	Email            string     `json:"email"`
	Phone            *string    `json:"phone,omitempty"`
	Avatar           *string    `json:"avatar,omitempty"`
	EmployeeID       string     `json:"employeeId"` // Frontend expects camelCase 'employeeId'
	Department       string     `json:"department,omitempty"`
	Designation      string     `json:"designation"`
	StaffType        string     `json:"staffType"` // 'teaching' or 'non-teaching'
	Qualification    string     `json:"qualification,omitempty"`
	ExperienceYears  int        `json:"experience"`
	Salary           float64    `json:"salary"`
	Rating           float64    `json:"rating"` // Defaults to 0
	JoinDate         string     `json:"joinDate"`
	SchoolID         *uuid.UUID `json:"schoolId,omitempty"`
	Address          string     `json:"address,omitempty"`
	DateOfBirth      string     `json:"dateOfBirth,omitempty"`
	EmergencyContact string     `json:"emergencyContact,omitempty"`
	BloodGroup       string     `json:"bloodGroup,omitempty"`
	IsSuspended      bool       `json:"is_suspended"`
}

// CreateStaffRequest for creating staff
type CreateStaffRequest struct {
	Email      string `json:"email" binding:"required,email"`
	Password   string `json:"password"` // auto-generated if empty
	FullName   string `json:"full_name" binding:"required"`
	Phone      string `json:"phone"`
	EmployeeID string `json:"employeeId"` // Auto-gen if empty, but can be provided
	// StaffType is always "non-teaching" for admin/staff; kept for API compat but ignored by backend
	StaffType        string   `json:"staffType"`
	Designation      string   `json:"designation" binding:"required"`
	Qualification    string   `json:"qualification"`
	ExperienceYears  int      `json:"experience"`
	Salary           float64  `json:"salary"`
	Address          string   `json:"address"`
	DateOfBirth      string   `json:"dateOfBirth"`
	EmergencyContact string   `json:"emergencyContact"`
	BloodGroup       string   `json:"bloodGroup"`
	Subjects         []string `json:"subjects,omitempty"` // Only for teaching
	SchoolID         string   `json:"schoolId,omitempty"` // Optional, for Super Admins
}

// UpdateStaffRequest for updating staff
type UpdateStaffRequest struct {
	FullName        string   `json:"full_name"`
	Phone           string   `json:"phone"`
	Avatar          string   `json:"avatar"`
	Designation     string   `json:"designation"`
	Qualification   string   `json:"qualification"`
	ExperienceYears int      `json:"experience"`
	Salary          float64  `json:"salary"`
	Subjects        []string `json:"subjects"`
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

// Subject represents a school subject
type Subject struct {
	ID              uuid.UUID  `json:"id" db:"id"`
	GlobalSubjectID *uuid.UUID `json:"global_subject_id,omitempty" db:"global_subject_id"`
	Name            string     `json:"name" db:"name"`
	Code            string     `json:"code" db:"code"`
	Description     *string    `json:"description,omitempty" db:"description"`
	GradeLevels     []int      `json:"grade_levels,omitempty" db:"grade_levels"`
	Credits         int        `json:"credits" db:"credits"`
	IsOptional      bool       `json:"is_optional" db:"is_optional"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
}

// TimetableEntry represents a timetable slot entry
type TimetableEntry struct {
	ID              uuid.UUID  `json:"id"`
	ClassID         uuid.UUID  `json:"class_id"`
	DayOfWeek       int        `json:"day_of_week"`
	PeriodNumber    int        `json:"period_number"`
	SubjectID       *uuid.UUID `json:"subject_id,omitempty"`
	GlobalSubjectID *uuid.UUID `json:"global_subject_id,omitempty"`
	TeacherID       *uuid.UUID `json:"teacher_id,omitempty"`
	StartTime       string     `json:"start_time"`
	EndTime         string     `json:"end_time"`
	RoomNumber      *string    `json:"room_number,omitempty"`
	AcademicYear    string     `json:"academic_year"`

	SubjectName string `json:"subject_name,omitempty"`
	TeacherName string `json:"teacher_name,omitempty"`
	ClassName   string `json:"class_name,omitempty"`
}

// TimetableConflictEntry represents a single conflicting slot
type TimetableConflictEntry struct {
	ClassID     uuid.UUID `json:"class_id"`
	ClassName   string    `json:"class_name"`
	SubjectName string    `json:"subject_name"`
	RoomNumber  *string   `json:"room_number,omitempty"`
}

// TimetableConflict represents a conflict group for a teacher
type TimetableConflict struct {
	DayOfWeek    int                      `json:"day_of_week"`
	DayName      string                   `json:"day_name"`
	PeriodNumber int                      `json:"period_number"`
	StartTime    string                   `json:"start_time"`
	EndTime      string                   `json:"end_time"`
	Entries      []TimetableConflictEntry `json:"entries"`
}

// UpdateTimetableConfigRequest represents timetable config update request
type UpdateTimetableConfigRequest struct {
	Days    []TimetableDayConfig    `json:"days"`
	Periods []TimetablePeriodConfig `json:"periods"`
}

// UpsertTimetableSlotRequest represents upsert slot payload
type UpsertTimetableSlotRequest struct {
	ClassID      string  `json:"class_id" binding:"required"`
	DayOfWeek    int     `json:"day_of_week" binding:"min=0,max=6"`
	PeriodNumber int     `json:"period_number" binding:"required,min=1,max=10"`
	SubjectID    string  `json:"subject_id" binding:"required"`
	TeacherID    string  `json:"teacher_id" binding:"required"`
	StartTime    string  `json:"start_time" binding:"required"`
	EndTime      string  `json:"end_time" binding:"required"`
	RoomNumber   *string `json:"room_number,omitempty"`
	AcademicYear string  `json:"academic_year" binding:"required"`
}

// RevenueChartPoint represents one data point in the revenue chart
type RevenueChartPoint struct {
	Label   string  `json:"label"`
	Revenue float64 `json:"revenue"`
}

// FinanceChartResponse is the response for the finance chart endpoint
type FinanceChartResponse struct {
	Period string              `json:"period"`
	Data   []RevenueChartPoint `json:"data"`
}

// ClassDistributionItem represents student count for one class grade
type ClassDistributionItem struct {
	Name         string `json:"name"`  // human-readable, e.g. "Class 5" / "LKG"
	Grade        int    `json:"grade"` // -1=LKG, 0=UKG, 1-12 otherwise
	StudentCount int    `json:"student_count"`
}

// ClassDistributionResponse wraps the class distribution slice
type ClassDistributionResponse struct {
	Items []ClassDistributionItem `json:"items"`
}

// --------------------------------------------------------------------------
// Admission Application models
// --------------------------------------------------------------------------

// AdmissionApplication represents one submitted admission application.
type AdmissionApplication struct {
	ID               uuid.UUID `json:"id"`
	SchoolID         uuid.UUID `json:"school_id"`
	AcademicYear     *string   `json:"academic_year"`
	StudentName      string    `json:"student_name"`
	DateOfBirth      string    `json:"date_of_birth"`
	Gender           *string   `json:"gender"`
	Religion         *string   `json:"religion"`
	CasteCategory    *string   `json:"caste_category"`
	Nationality      *string   `json:"nationality"`
	MotherTongue     *string   `json:"mother_tongue"`
	BloodGroup       *string   `json:"blood_group"`
	AadhaarNumber    *string   `json:"aadhaar_number"`
	ApplyingForClass *string   `json:"applying_for_class"`

	PreviousSchoolName    *string `json:"previous_school_name"`
	PreviousClass         *string `json:"previous_class"`
	PreviousSchoolAddress *string `json:"previous_school_address"`
	TCNumber              *string `json:"tc_number"`

	FatherName       *string `json:"father_name"`
	FatherPhone      *string `json:"father_phone"`
	FatherOccupation *string `json:"father_occupation"`
	MotherName       *string `json:"mother_name"`
	MotherPhone      string  `json:"mother_phone"`
	MotherOccupation *string `json:"mother_occupation"`
	GuardianName     *string `json:"guardian_name"`
	GuardianPhone    *string `json:"guardian_phone"`
	GuardianRelation *string `json:"guardian_relation"`

	AddressLine1 *string `json:"address_line1"`
	AddressLine2 *string `json:"address_line2"`
	City         *string `json:"city"`
	State        *string `json:"state"`
	Pincode      *string `json:"pincode"`

	Email *string `json:"email"`

	HasBirthCertificate    bool `json:"has_birth_certificate"`
	HasAadhaarCard         bool `json:"has_aadhaar_card"`
	HasTransferCertificate bool `json:"has_transfer_certificate"`
	HasCasteCertificate    bool `json:"has_caste_certificate"`
	HasIncomeCertificate   bool `json:"has_income_certificate"`
	HasPassportPhoto       bool `json:"has_passport_photo"`
	DocumentCount          int  `json:"document_count"`

	Status          string     `json:"status"` // pending | under_review | approved | rejected
	RejectionReason *string    `json:"rejection_reason,omitempty"`
	ReviewedBy      *uuid.UUID `json:"reviewed_by,omitempty"`
	ReviewedAt      *time.Time `json:"reviewed_at,omitempty"`

	CreatedUserID    *uuid.UUID `json:"created_user_id,omitempty"`
	CreatedStudentID *uuid.UUID `json:"created_student_id,omitempty"`

	SubmittedAt time.Time `json:"submitted_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// AdmissionListItem is a lighter struct used for listing applications.
type AdmissionListItem struct {
	ID               uuid.UUID `json:"id"`
	StudentName      string    `json:"student_name"`
	DateOfBirth      string    `json:"date_of_birth"`
	MotherPhone      string    `json:"mother_phone"`
	ApplyingForClass *string   `json:"applying_for_class"`
	DocumentCount    int       `json:"document_count"`
	Status           string    `json:"status"`
	AcademicYear     *string   `json:"academic_year"`
	SubmittedAt      time.Time `json:"submitted_at"`
}

// ApproveAdmissionRequest is the request body for approving an application.
type ApproveAdmissionRequest struct {
	// Optionally override fields before creating the student account.
	// If omitted, application data is used.
	Username *string `json:"username"`
	Password *string `json:"password"` // if empty, auto-generated
	ClassID  *string `json:"class_id"`

	// Parental consent payload for minor applicants (<18).
	// For legal safety this should be provided from a verified guardian flow.
	GuardianName                *string `json:"guardian_name"`
	GuardianPhone               *string `json:"guardian_phone"`
	GuardianRelation            *string `json:"guardian_relation"`
	ConsentMethod               *string `json:"consent_method"` // otp | written | digital | in_person | other
	ConsentReference            *string `json:"consent_reference"`
	GuardianDeclarationAccepted bool    `json:"guardian_declaration_accepted"`
}

// RejectAdmissionRequest is the request body for rejecting an application.
type RejectAdmissionRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// AdmissionSettingsResponse is the response for GET /admin/settings/admissions
type AdmissionSettingsResponse struct {
	AdmissionsOpen              bool   `json:"admissions_open"`
	AutoApprove                 bool   `json:"auto_approve"`
	TeacherAppointmentsOpen     bool   `json:"teacher_appointments_open"`
	GlobalAcademicYear          string `json:"global_academic_year"` // set by super admin, read-only for admin
	SchoolSlug                  string `json:"school_slug"`
	SchoolName                  string `json:"school_name"`
	AdmissionPortalURL          string `json:"admission_portal_url,omitempty"`
	AdmissionEmbedURL           string `json:"admission_embed_url,omitempty"`
	TeacherAppointmentPortalURL string `json:"teacher_appointment_portal_url,omitempty"`
	TeacherAppointmentEmbedURL  string `json:"teacher_appointment_embed_url,omitempty"`
}

// UpdateAdmissionSettingsRequest is the request body for PUT /admin/settings/admissions
// Academic year is now global (managed by super admin).
type UpdateAdmissionSettingsRequest struct {
	AdmissionsOpen          bool `json:"admissions_open"`
	AutoApprove             bool `json:"auto_approve"`
	TeacherAppointmentsOpen bool `json:"teacher_appointments_open"`
}

type InitiateLearnerTransferRequest struct {
	StudentID           string  `json:"student_id" binding:"required"`
	DestinationSchoolID string  `json:"destination_school_id" binding:"required"`
	Reason              *string `json:"reason,omitempty"`
	EvidenceRef         *string `json:"evidence_ref,omitempty"`
	AutoGovSync         *bool   `json:"auto_gov_sync,omitempty"`
}

type ReviewLearnerTransferRequest struct {
	Action      string  `json:"action" binding:"required"` // approve | reject
	ReviewNote  *string `json:"review_note,omitempty"`
	AutoGovSync *bool   `json:"auto_gov_sync,omitempty"`
}

type CompleteLearnerTransferRequest struct {
	ReviewNote  *string `json:"review_note,omitempty"`
	AutoGovSync *bool   `json:"auto_gov_sync,omitempty"`
}

type TransferReviewResult struct {
	TransferID       uuid.UUID `json:"transfer_id"`
	Status           string    `json:"status"`
	GovSyncTriggered bool      `json:"gov_sync_triggered"`
	GovSyncMode      string    `json:"gov_sync_mode,omitempty"`
	GovSyncJobID     *string   `json:"gov_sync_job_id,omitempty"`
	GovSyncWarning   *string   `json:"gov_sync_warning,omitempty"`
	AutoGovSync      bool      `json:"auto_gov_sync"`
}

type TransferInteropContext struct {
	TransferID            uuid.UUID `json:"transfer_id"`
	LearnerID             uuid.UUID `json:"learner_id"`
	SourceSchoolCode      *string   `json:"source_school_code,omitempty"`
	DestinationSchoolCode *string   `json:"destination_school_code,omitempty"`
	EvidenceRef           *string   `json:"evidence_ref,omitempty"`
	TransferDate          time.Time `json:"transfer_date"`
}

type TransferGovSyncSnapshot struct {
	TransferID          uuid.UUID  `json:"transfer_id"`
	TransferStatus      string     `json:"transfer_status"`
	DestinationSchoolID uuid.UUID  `json:"destination_school_id"`
	GovSyncJobID        *string    `json:"gov_sync_job_id,omitempty"`
	GovSyncStatus       *string    `json:"gov_sync_status,omitempty"`
	GovSyncMode         *string    `json:"gov_sync_mode,omitempty"`
	GovSyncLastError    *string    `json:"gov_sync_last_error,omitempty"`
	GovSyncUpdatedAt    *time.Time `json:"gov_sync_updated_at,omitempty"`
}

type TransferGovSyncActionResult struct {
	TransferID       uuid.UUID `json:"transfer_id"`
	GovSyncTriggered bool      `json:"gov_sync_triggered"`
	GovSyncMode      string    `json:"gov_sync_mode,omitempty"`
	GovSyncJobID     *string   `json:"gov_sync_job_id,omitempty"`
	GovSyncStatus    *string   `json:"gov_sync_status,omitempty"`
	GovSyncWarning   *string   `json:"gov_sync_warning,omitempty"`
}

type LearnerTransferListItem struct {
	ID                  uuid.UUID  `json:"id"`
	LearnerID           uuid.UUID  `json:"learner_id"`
	SourceSchoolID      uuid.UUID  `json:"source_school_id"`
	DestinationSchoolID uuid.UUID  `json:"destination_school_id"`
	SourceStudentID     *uuid.UUID `json:"source_student_id,omitempty"`
	Status              string     `json:"status"`
	Reason              *string    `json:"reason,omitempty"`
	EvidenceRef         *string    `json:"evidence_ref,omitempty"`
	ReviewNote          *string    `json:"review_note,omitempty"`
	RequestedBy         uuid.UUID  `json:"requested_by"`
	ReviewedBy          *uuid.UUID `json:"reviewed_by,omitempty"`
	RequestedAt         time.Time  `json:"requested_at"`
	ReviewedAt          *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`

	LearnerName           *string    `json:"learner_name,omitempty"`
	SourceSchoolName      *string    `json:"source_school_name,omitempty"`
	DestinationSchoolName *string    `json:"destination_school_name,omitempty"`
	PreferredAutoGovSync  bool       `json:"preferred_auto_gov_sync"`
	GovSyncJobID          *string    `json:"gov_sync_job_id,omitempty"`
	GovSyncStatus         *string    `json:"gov_sync_status,omitempty"`
	GovSyncMode           *string    `json:"gov_sync_mode,omitempty"`
	GovSyncLastError      *string    `json:"gov_sync_last_error,omitempty"`
	GovSyncUpdatedAt      *time.Time `json:"gov_sync_updated_at,omitempty"`
}

type TransferDestinationSchoolOption struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Code *string   `json:"code,omitempty"`
}

type ReviewLearnerReconciliationRequest struct {
	Action            string  `json:"action" binding:"required"` // merge | dismiss
	SurvivorLearnerID *string `json:"survivor_learner_id,omitempty"`
	ReviewNote        *string `json:"review_note,omitempty"`
}

type UnmergeLearnerReconciliationRequest struct {
	ReviewNote *string `json:"review_note,omitempty"`
}

type LearnerReconciliationCaseItem struct {
	ID                  uuid.UUID  `json:"id"`
	PairKey             string     `json:"pair_key"`
	PrimaryLearnerID    uuid.UUID  `json:"primary_learner_id"`
	CandidateLearnerID  uuid.UUID  `json:"candidate_learner_id"`
	Status              string     `json:"status"`
	Resolution          *string    `json:"resolution,omitempty"`
	ReviewNote          *string    `json:"review_note,omitempty"`
	MergedFromLearnerID *uuid.UUID `json:"merged_from_learner_id,omitempty"`
	MergedIntoLearnerID *uuid.UUID `json:"merged_into_learner_id,omitempty"`
	ReviewedBy          *uuid.UUID `json:"reviewed_by,omitempty"`
	ReviewedAt          *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`

	PrimaryLearnerName   *string `json:"primary_learner_name,omitempty"`
	CandidateLearnerName *string `json:"candidate_learner_name,omitempty"`
	PrimaryApaarID       *string `json:"primary_apaar_id,omitempty"`
	CandidateApaarID     *string `json:"candidate_apaar_id,omitempty"`
	PrimaryAbcID         *string `json:"primary_abc_id,omitempty"`
	CandidateAbcID       *string `json:"candidate_abc_id,omitempty"`
	PrimaryDateOfBirth   *string `json:"primary_date_of_birth,omitempty"`
	CandidateDateOfBirth *string `json:"candidate_date_of_birth,omitempty"`
}
