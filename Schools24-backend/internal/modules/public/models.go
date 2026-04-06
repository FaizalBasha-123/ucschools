package public

import (
	"time"

	"github.com/google/uuid"
)

// SchoolAdmissionInfo is the public response for a school's admission status.
type SchoolAdmissionInfo struct {
	SchoolID                uuid.UUID `json:"school_id"`
	SchoolName              string    `json:"school_name"`
	AdmissionsOpen          bool      `json:"admissions_open"`
	TeacherAppointmentsOpen bool      `json:"teacher_appointments_open"`
	AdmissionAcademicYear   *string   `json:"admission_academic_year"`
	// Contact info shown on the closed-admissions page
	Phone   *string `json:"phone"`
	Email   *string `json:"email"`
	Website *string `json:"website"`
}

// SubmitAdmissionRequest contains all fields from the admission form.
type SubmitAdmissionRequest struct {
	// Required
	StudentName string `form:"student_name"`
	DateOfBirth string `form:"date_of_birth"` // YYYY-MM-DD
	MotherPhone string `form:"mother_phone"`

	// Personal details
	Gender        string `form:"gender"`
	Religion      string `form:"religion"`
	CasteCategory string `form:"caste_category"`
	Nationality   string `form:"nationality"`
	MotherTongue  string `form:"mother_tongue"`
	BloodGroup    string `form:"blood_group"`
	AadhaarNumber string `form:"aadhaar_number"`

	// Applying for
	ApplyingForClass string `form:"applying_for_class"`

	// Previous school
	PreviousSchoolName    string `form:"previous_school_name"`
	PreviousClass         string `form:"previous_class"`
	PreviousSchoolAddress string `form:"previous_school_address"`
	TCNumber              string `form:"tc_number"`

	// Parents
	FatherName       string `form:"father_name"`
	FatherPhone      string `form:"father_phone"`
	FatherOccupation string `form:"father_occupation"`
	MotherName       string `form:"mother_name"`
	MotherOccupation string `form:"mother_occupation"`
	GuardianName     string `form:"guardian_name"`
	GuardianPhone    string `form:"guardian_phone"`
	GuardianRelation string `form:"guardian_relation"`

	// Address
	AddressLine1 string `form:"address_line1"`
	AddressLine2 string `form:"address_line2"`
	City         string `form:"city"`
	State        string `form:"state"`
	Pincode      string `form:"pincode"`

	// Academic year (optional override)
	AcademicYear string `form:"academic_year"`

	// Login email — stored and used when the student account is created
	Email string `form:"email"`
}

// AdmissionDocumentUpload holds a single document to be stored in R2.
type AdmissionDocumentUpload struct {
	DocumentType string // e.g. "birth_certificate"
	FileName     string
	FileSize     int64
	MimeType     string
	Content      []byte
}

// AdmissionSubmitResponse is the success response after form submission.
type AdmissionSubmitResponse struct {
	ApplicationID string    `json:"application_id"`
	StudentName   string    `json:"student_name"`
	SubmittedAt   time.Time `json:"submitted_at"`
	Message       string    `json:"message"`
	// SchoolID is internal-only (not marshalled to JSON) used for hub broadcast.
	SchoolID uuid.UUID `json:"-"`
}

// ValidDocumentTypes lists all accepted document field names.
var ValidDocumentTypes = []string{
	"birth_certificate",
	"aadhaar_card",
	"transfer_certificate",
	"caste_certificate",
	"income_certificate",
	"passport_photo",
}
