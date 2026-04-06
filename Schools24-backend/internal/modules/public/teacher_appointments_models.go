package public

import "time"

var ValidTeacherAppointmentDocumentTypes = []string{
	"aadhaar_card",
	"pan_card",
	"voter_or_passport",
	"marksheets_10_12",
	"degree_certificates",
	"bed_med_certificate",
	"ctet_stet_result",
	"relieving_letter",
	"experience_certificate",
	"salary_slips",
	"epf_uan_number",
	"police_verification",
	"medical_fitness_cert",
	"character_certificate",
	"passport_photos",
}

type SubmitTeacherAppointmentRequest struct {
	FullName             string `form:"full_name"`
	Email                string `form:"email"`
	Phone                string `form:"phone"`
	DateOfBirth          string `form:"date_of_birth"`
	Gender               string `form:"gender"`
	Address              string `form:"address"`
	HighestQualification string `form:"highest_qualification"`
	ProfessionalDegree   string `form:"professional_degree"`
	EligibilityTest      string `form:"eligibility_test"`
	SubjectExpertise     string `form:"subject_expertise"`
	ExperienceYears      int    `form:"experience_years"`
	CurrentSchool        string `form:"current_school"`
	ExpectedSalary       string `form:"expected_salary"`
	NoticePeriodDays     int    `form:"notice_period_days"`
	CoverLetter          string `form:"cover_letter"`
	AcademicYear         string `form:"academic_year"`
}

type TeacherAppointmentDocumentUpload struct {
	DocumentType string
	FileName     string
	FileSize     int64
	MimeType     string
	Content      []byte
}

type TeacherAppointmentSubmitResponse struct {
	ApplicationID string    `json:"application_id"`
	FullName      string    `json:"full_name"`
	SchoolID      string    `json:"school_id"`
	SubmittedAt   time.Time `json:"submitted_at"`
	Message       string    `json:"message"`
}

type SchoolTeacherAppointmentInfo struct {
	SchoolID         string  `json:"school_id"`
	SchoolName       string  `json:"school_name"`
	SchoolSlug       string  `json:"school_slug"`
	Phone            *string `json:"phone,omitempty"`
	Email            *string `json:"email,omitempty"`
	Website          *string `json:"website,omitempty"`
	AcademicYear     *string `json:"academic_year,omitempty"`
	AppointmentsOpen bool    `json:"appointments_open"`
}
