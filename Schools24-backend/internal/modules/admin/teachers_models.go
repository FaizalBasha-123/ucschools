package admin

import (
	"time"

	"github.com/google/uuid"
)

// TeacherDetail represents admin view of a teacher
// (Joined from tenant teachers + tenant users)
type TeacherDetail struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"userId"`
	Name           string     `json:"name"`
	Email          string     `json:"email"`
	Phone          *string    `json:"phone,omitempty"`
	Avatar         *string    `json:"avatar,omitempty"`
	EmployeeID     string     `json:"employeeId"`
	Department     string     `json:"department"`
	Designation    *string    `json:"designation,omitempty"`
	Qualifications []string   `json:"qualifications,omitempty"`
	SubjectsTaught []string   `json:"subjects"`
	SubjectIDs     []string   `json:"subject_ids,omitempty"`
	Classes        []string   `json:"classes"`
	Experience     *int       `json:"experience,omitempty"`
	JoinDate       *time.Time `json:"joinDate,omitempty"`
	Salary         *float64   `json:"salary,omitempty"`
	Rating         *float64   `json:"rating,omitempty"`
	Status         *string    `json:"status,omitempty"`
}

// TeachersListResponse represents paginated response
// for admin teachers list
// GET /api/v1/admin/teachers
type TeachersListResponse struct {
	Teachers []TeacherDetail `json:"teachers"`
	Total    int             `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"page_size"`
}

// CreateTeacherDetailRequest for admin teachers details page
// reuse CreateTeacherRequest when appropriate
type CreateTeacherDetailRequest struct {
	Email          string   `json:"email" binding:"required,email"`
	Password       string   `json:"password" binding:"required,min=6"`
	FullName       string   `json:"full_name" binding:"required"`
	Phone          string   `json:"phone,omitempty"`
	EmployeeID     string   `json:"employee_id"`
	Department     string   `json:"department,omitempty"`
	Designation    string   `json:"designation,omitempty"`
	Qualifications []string `json:"qualifications,omitempty"`
	SubjectsTaught []string `json:"subjects_taught,omitempty"`
	Experience     int      `json:"experience_years,omitempty"`
	HireDate       string   `json:"hire_date,omitempty"`
	Salary         float64  `json:"salary,omitempty"`
	Status         string   `json:"status,omitempty"`
	SchoolID       string   `json:"school_id,omitempty"`
}

// UpdateTeacherDetailRequest for admin teachers details page
type UpdateTeacherDetailRequest struct {
	FullName       string   `json:"full_name,omitempty"`
	Phone          string   `json:"phone,omitempty"`
	Avatar         string   `json:"avatar,omitempty"`
	EmployeeID     string   `json:"employee_id,omitempty"`
	Department     string   `json:"department,omitempty"`
	Designation    string   `json:"designation,omitempty"`
	Qualifications []string `json:"qualifications,omitempty"`
	SubjectsTaught []string `json:"subjects_taught,omitempty"`
	Experience     int      `json:"experience_years,omitempty"`
	HireDate       string   `json:"hire_date,omitempty"`
	Salary         float64  `json:"salary,omitempty"`
	Status         string   `json:"status,omitempty"`
}
