package admin

import (
	"time"

	"github.com/google/uuid"
)

type TeacherAppointmentListItem struct {
	ID               uuid.UUID `json:"id"`
	FullName         string    `json:"full_name"`
	Email            string    `json:"email"`
	Phone            string    `json:"phone"`
	SubjectExpertise *string   `json:"subject_expertise"`
	ExperienceYears  *int      `json:"experience_years"`
	DocumentCount    int       `json:"document_count"`
	Status           string    `json:"status"`
	AcademicYear     *string   `json:"academic_year"`
	SubmittedAt      time.Time `json:"submitted_at"`
}

type TeacherAppointmentApplication struct {
	ID                    uuid.UUID  `json:"id"`
	SchoolID              uuid.UUID  `json:"school_id"`
	AcademicYear          *string    `json:"academic_year"`
	FullName              string     `json:"full_name"`
	Email                 string     `json:"email"`
	Phone                 string     `json:"phone"`
	DateOfBirth           *string    `json:"date_of_birth"`
	Gender                *string    `json:"gender"`
	Address               *string    `json:"address"`
	HighestQualification  *string    `json:"highest_qualification"`
	ProfessionalDegree    *string    `json:"professional_degree"`
	EligibilityTest       *string    `json:"eligibility_test"`
	SubjectExpertise      *string    `json:"subject_expertise"`
	ExperienceYears       *int       `json:"experience_years"`
	CurrentSchool         *string    `json:"current_school"`
	ExpectedSalary        *float64   `json:"expected_salary"`
	NoticePeriodDays      *int       `json:"notice_period_days"`
	CoverLetter           *string    `json:"cover_letter"`
	HasAadhaarCard        bool       `json:"has_aadhaar_card"`
	HasPanCard            bool       `json:"has_pan_card"`
	HasVoterOrPassport    bool       `json:"has_voter_or_passport"`
	HasMarksheets1012     bool       `json:"has_marksheets_10_12"`
	HasDegreeCertificates bool       `json:"has_degree_certificates"`
	HasBedMedCertificate  bool       `json:"has_bed_med_certificate"`
	HasCtetStetResult     bool       `json:"has_ctet_stet_result"`
	HasRelievingLetter    bool       `json:"has_relieving_letter"`
	HasExperienceCert     bool       `json:"has_experience_certificate"`
	HasSalarySlips        bool       `json:"has_salary_slips"`
	HasEpfUanNumber       bool       `json:"has_epf_uan_number"`
	HasPoliceVerification bool       `json:"has_police_verification"`
	HasMedicalFitnessCert bool       `json:"has_medical_fitness_cert"`
	HasCharacterCert      bool       `json:"has_character_certificate"`
	HasPassportPhotos     bool       `json:"has_passport_photos"`
	DocumentCount         int        `json:"document_count"`
	Status                string     `json:"status"`
	ReviewedBy            *uuid.UUID `json:"reviewed_by,omitempty"`
	ReviewedAt            *time.Time `json:"reviewed_at,omitempty"`
	RejectionReason       *string    `json:"rejection_reason,omitempty"`
	CreatedTeacherUserID  *uuid.UUID `json:"created_teacher_user_id,omitempty"`
	SubmittedAt           time.Time  `json:"submitted_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

type ApproveTeacherAppointmentRequest struct {
	Password   *string `json:"password"`
	EmployeeID *string `json:"employee_id"`
}

type RejectTeacherAppointmentRequest struct {
	Reason string `json:"reason,omitempty"`
}

type TeacherAppointmentDocumentMeta struct {
	ID           string    `json:"id"`
	DocumentType string    `json:"document_type"`
	FileName     string    `json:"file_name"`
	FileSize     int64     `json:"file_size"`
	MimeType     string    `json:"mime_type"`
	UploadedAt   time.Time `json:"uploaded_at"`
}

type TeacherAppointmentDecisionItem struct {
	ID                   uuid.UUID  `json:"id"`
	ApplicationID        uuid.UUID  `json:"application_id"`
	ApplicantName        string     `json:"applicant_name"`
	ApplicantEmail       string     `json:"applicant_email"`
	ApplicantPhone       *string    `json:"applicant_phone,omitempty"`
	SubjectExpertise     *string    `json:"subject_expertise,omitempty"`
	Decision             string     `json:"decision"`
	Reason               *string    `json:"reason,omitempty"`
	ReviewedBy           *uuid.UUID `json:"reviewed_by,omitempty"`
	ReviewedAt           time.Time  `json:"reviewed_at"`
	CreatedTeacherUserID *uuid.UUID `json:"created_teacher_user_id,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
}
