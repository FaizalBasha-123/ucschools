package demo

import (
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/modules/school"
)

type DemoRequestAdminView struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type DemoRequest struct {
	ID                 uuid.UUID              `json:"id"`
	RequestNumber      int64                  `json:"request_number"`
	SchoolName         string                 `json:"school_name"`
	SchoolCode         *string                `json:"school_code,omitempty"`
	Address            *string                `json:"address,omitempty"`
	ContactEmail       *string                `json:"contact_email,omitempty"`
	Admins             []DemoRequestAdminView `json:"admins"`
	Status             string                 `json:"status"`
	AcceptedSchoolID   *uuid.UUID             `json:"accepted_school_id,omitempty"`
	AcceptedSchoolName *string                `json:"accepted_school_name,omitempty"`
	AcceptedAt         *time.Time             `json:"accepted_at,omitempty"`
	AcceptedByName     *string                `json:"accepted_by_name,omitempty"`
	TrashedAt          *time.Time             `json:"trashed_at,omitempty"`
	TrashedByName      *string                `json:"trashed_by_name,omitempty"`
	DeleteAfter        *time.Time             `json:"delete_after,omitempty"`
	SourceIP           *string                `json:"source_ip,omitempty"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
}

type createDemoRequestRecord struct {
	DemoRequest
	AdminsSecret []byte
}

type CreatePublicDemoRequest struct {
	school.CreateSchoolRequest
}

type PasswordVerificationRequest struct {
	Password string `json:"password" binding:"required"`
}

type DemoRequestListParams struct {
	Page     int    `form:"page"`
	PageSize int    `form:"page_size"`
	Search   string `form:"search"`
	Status   string `form:"status"`
	Year     int    `form:"year"`
	Month    int    `form:"month"`
}

type DemoRequestListResponse struct {
	Requests       []DemoRequest `json:"requests"`
	Total          int           `json:"total"`
	Page           int           `json:"page"`
	PageSize       int           `json:"page_size"`
	TotalPages     int           `json:"total_pages"`
	AvailableYears []int         `json:"available_years"`
}

type DemoRequestStatsMonth struct {
	Month int `json:"month"`
	Total int `json:"total"`
}

type DemoRequestStatsResponse struct {
	Year           int                     `json:"year"`
	Month          int                     `json:"month"`
	Total          int                     `json:"total"`
	Pending        int                     `json:"pending"`
	Accepted       int                     `json:"accepted"`
	Trashed        int                     `json:"trashed"`
	AvailableYears []int                   `json:"available_years"`
	Months         []DemoRequestStatsMonth `json:"months"`
}
