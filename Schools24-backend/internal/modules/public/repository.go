package public

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/schools24/backend/internal/shared/database"
	"github.com/schools24/backend/internal/shared/objectstore"
)

// ErrSchoolNotFound is returned when no school matches the given slug.
var ErrSchoolNotFound = errors.New("school_not_found")

// ErrAdmissionsClosed is returned when a school is not accepting applications.
var ErrAdmissionsClosed = errors.New("admissions_closed")

// ErrTeacherAppointmentsClosed is returned when teacher applications are closed for a school.
var ErrTeacherAppointmentsClosed = errors.New("teacher_appointments_closed")

// Repository handles data persistence for public admission.
type Repository struct {
	db    *database.PostgresDB
	store objectstore.Store
}

// NewRepository creates a new public repository.
func NewRepository(db *database.PostgresDB, store objectstore.Store) *Repository {
	return &Repository{db: db, store: store}
}

// GetSchoolBySlug looks up a school in public.schools by its slug.
// Returns ErrSchoolNotFound if no school matches.
func (r *Repository) GetSchoolBySlug(ctx context.Context, slug string) (*SchoolAdmissionInfo, error) {
	row := r.db.QueryRow(ctx, `
		SELECT s.id, s.name, s.admissions_open,
		       COALESCE(s.teacher_appointments_open, true) AS teacher_appointments_open,
		       COALESCE(g.value, s.admission_academic_year) AS academic_year,
		       s.phone, s.email, s.website
		FROM public.schools s
		LEFT JOIN public.global_settings g ON g.key = 'current_academic_year'
		WHERE s.slug = $1 AND s.deleted_at IS NULL
		LIMIT 1
	`, strings.TrimSpace(slug))

	var info SchoolAdmissionInfo
	var academicYear *string
	if err := row.Scan(&info.SchoolID, &info.SchoolName, &info.AdmissionsOpen, &info.TeacherAppointmentsOpen, &academicYear, &info.Phone, &info.Email, &info.Website); err != nil {
		if isNoRows(err) {
			return nil, ErrSchoolNotFound
		}
		return nil, fmt.Errorf("get school by slug: %w", err)
	}
	info.AdmissionAcademicYear = academicYear
	return &info, nil
}

// InsertApplication inserts a new admission_applications row inside the tenant schema.
// ctx must already have "tenant_schema" set.
func (r *Repository) InsertApplication(ctx context.Context, schoolID uuid.UUID, req *SubmitAdmissionRequest, docFlags map[string]bool, docCount int) (uuid.UUID, time.Time, error) {
	var id uuid.UUID
	var submittedAt time.Time

	academicYear := strings.TrimSpace(req.AcademicYear)
	var academicYearParam *string
	if academicYear != "" {
		academicYearParam = &academicYear
	}

	nullStr := func(s string) *string {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		return &s
	}

	insertOnce := func() error {
		row := r.db.QueryRow(ctx, `
		INSERT INTO admission_applications (
			school_id, academic_year,
			student_name, date_of_birth, mother_phone,
			gender, religion, caste_category, nationality, mother_tongue,
			blood_group, aadhaar_number, applying_for_class,
			previous_school_name, previous_class, previous_school_address, tc_number,
			father_name, father_phone, father_occupation,
			mother_name, mother_occupation,
			guardian_name, guardian_phone, guardian_relation,
			address_line1, address_line2, city, state, pincode,
			has_birth_certificate, has_aadhaar_card, has_transfer_certificate,
			has_caste_certificate, has_income_certificate, has_passport_photo,
			document_count, status, email
		) VALUES (
			$1, $2,
			$3, $4::date, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13,
			$14, $15, $16, $17,
			$18, $19, $20,
			$21, $22,
			$23, $24, $25,
			$26, $27, $28, $29, $30,
			$31, $32, $33,
			$34, $35, $36,
			$37, 'pending', $38
		)
		RETURNING id, submitted_at
	`,
			schoolID,
			academicYearParam,
			strings.TrimSpace(req.StudentName),
			strings.TrimSpace(req.DateOfBirth),
			strings.TrimSpace(req.MotherPhone),
			nullStr(req.Gender), nullStr(req.Religion), nullStr(req.CasteCategory),
			func() string {
				if n := strings.TrimSpace(req.Nationality); n != "" {
					return n
				}
				return "Indian"
			}(),
			nullStr(req.MotherTongue),
			nullStr(req.BloodGroup), nullStr(req.AadhaarNumber), nullStr(req.ApplyingForClass),
			nullStr(req.PreviousSchoolName), nullStr(req.PreviousClass),
			nullStr(req.PreviousSchoolAddress), nullStr(req.TCNumber),
			nullStr(req.FatherName), nullStr(req.FatherPhone), nullStr(req.FatherOccupation),
			nullStr(req.MotherName), nullStr(req.MotherOccupation),
			nullStr(req.GuardianName), nullStr(req.GuardianPhone), nullStr(req.GuardianRelation),
			nullStr(req.AddressLine1), nullStr(req.AddressLine2),
			nullStr(req.City), nullStr(req.State), nullStr(req.Pincode),
			docFlags["birth_certificate"],
			docFlags["aadhaar_card"],
			docFlags["transfer_certificate"],
			docFlags["caste_certificate"],
			docFlags["income_certificate"],
			docFlags["passport_photo"],
			docCount,
			nullStr(req.Email),
		)
		return row.Scan(&id, &submittedAt)
	}

	if err := insertOnce(); err != nil {
		if isAdmissionTableSchemaError(err) {
			// Self-heal: create table if missing, widen narrow columns if they exist.
			if repairErr := r.ensureAdmissionApplicationsTable(ctx); repairErr != nil {
				return uuid.Nil, time.Time{}, fmt.Errorf("insert admission application: %w (self-heal failed: %v)", err, repairErr)
			}
			if retryErr := insertOnce(); retryErr != nil {
				return uuid.Nil, time.Time{}, fmt.Errorf("insert admission application after self-heal: %w", retryErr)
			}
			return id, submittedAt, nil
		}
		return uuid.Nil, time.Time{}, fmt.Errorf("insert admission application: %w", err)
	}
	return id, submittedAt, nil
}

// SaveAdmissionDocument stores a single admission document metadata row in Postgres.
func (r *Repository) SaveAdmissionDocument(ctx context.Context, schoolID, applicationID uuid.UUID, doc *AdmissionDocumentUpload) (string, error) {
	if r.db == nil {
		return "", errors.New("database not configured")
	}
	sum := sha256.Sum256(doc.Content)
	hash := hex.EncodeToString(sum[:])

	// Store content in R2 only
	storageKey, err := objectstore.PutAdmissionDocument(ctx, r.store, schoolID.String(), applicationID.String(), "", doc.FileName, doc.Content)
	if err != nil {
		return "", fmt.Errorf("upload admission document to r2 failed school_id=%s app_id=%s file=%s: %w", schoolID.String(), applicationID.String(), doc.FileName, err)
	}
	if strings.TrimSpace(storageKey) == "" {
		return "", errors.New("r2 storage key missing for admission document")
	}

	var id string
	err = r.db.QueryRow(ctx, `
		INSERT INTO admission_documents (
			school_id, application_id, document_type,
			file_name, file_size, mime_type, file_sha256,
			storage_key, uploaded_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		RETURNING id::text
	`, schoolID.String(), applicationID.String(), strings.TrimSpace(doc.DocumentType), doc.FileName, doc.FileSize, doc.MimeType, hash, storageKey).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("save admission document: %w", err)
	}
	return id, nil
}

// GetAdmissionDocument retrieves a document's content from R2/Postgres by document ID,
// scoped to school and application for authorization.
func (r *Repository) GetAdmissionDocument(ctx context.Context, schoolID, applicationID, docObjectID string) (string, string, []byte, error) {
	if r.db == nil {
		return "", "", nil, errors.New("database not configured")
	}
	docObjectID = strings.TrimSpace(docObjectID)
	var raw struct {
		FileName   string
		MimeType   string
		StorageKey string
	}
	err := r.db.QueryRow(ctx, `
		SELECT file_name, mime_type, storage_key
		FROM admission_documents
		WHERE id::text = $1 AND school_id = $2 AND application_id = $3
		LIMIT 1
	`, docObjectID, schoolID, applicationID).Scan(&raw.FileName, &raw.MimeType, &raw.StorageKey)
	if err != nil {
		return "", "", nil, fmt.Errorf("get admission document: %w", err)
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return "", "", nil, fmt.Errorf("get document content: %w", err)
	}

	return raw.FileName, raw.MimeType, content, nil
}

// DeleteAdmissionDocuments removes all document metadata rows for a given application on rejection.
func (r *Repository) DeleteAdmissionDocuments(ctx context.Context, schoolID, applicationID string) error {
	if r.db == nil {
		return nil // non-fatal if database is absent
	}
	if err := r.db.Exec(ctx, `
		DELETE FROM admission_documents
		WHERE school_id = $1 AND application_id = $2
	`, schoolID, applicationID); err != nil {
		return fmt.Errorf("delete admission documents: %w", err)
	}
	return nil
}

// isNoRows returns true if the error is a pgx no-rows error.
func isNoRows(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no rows")
}

func isAdmissionTableSchemaError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	// Missing table or schema
	if strings.Contains(msg, "relation \"admission_applications\" does not exist") {
		return true
	}
	if strings.Contains(msg, "schema \"school_") && strings.Contains(msg, "does not exist") {
		return true
	}
	// Column type too narrow (SQLSTATE 22001) — self-heal by widening columns
	if strings.Contains(msg, "value too long for type") || strings.Contains(msg, "22001") {
		return true
	}
	return false
}

func (r *Repository) ensureAdmissionApplicationsTable(ctx context.Context) error {
	// Step 1: Create the table with correct wide types for schools that never had it.
	ddl := `
CREATE TABLE IF NOT EXISTS admission_applications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id         UUID NOT NULL,
    academic_year     TEXT,
    student_name      VARCHAR(200) NOT NULL,
    date_of_birth     DATE NOT NULL,
    gender            VARCHAR(20),
    religion          VARCHAR(100),
    caste_category    VARCHAR(50),
    nationality       VARCHAR(100) DEFAULT 'Indian',
    mother_tongue     VARCHAR(100),
    blood_group       VARCHAR(20),
    aadhaar_number    VARCHAR(50),
    applying_for_class VARCHAR(100),
    previous_school_name    VARCHAR(300),
    previous_class          VARCHAR(100),
    previous_school_address TEXT,
    tc_number               VARCHAR(100),
    father_name       VARCHAR(200),
    father_phone      VARCHAR(20),
    father_occupation VARCHAR(200),
    mother_name       VARCHAR(200),
    mother_phone      VARCHAR(20) NOT NULL,
    mother_occupation VARCHAR(200),
    guardian_name     VARCHAR(200),
    guardian_phone    VARCHAR(20),
    guardian_relation VARCHAR(100),
    address_line1     VARCHAR(300),
    address_line2     VARCHAR(300),
    city              VARCHAR(100),
    state             VARCHAR(100),
    pincode           VARCHAR(20),
    has_birth_certificate     BOOLEAN NOT NULL DEFAULT false,
    has_aadhaar_card          BOOLEAN NOT NULL DEFAULT false,
    has_transfer_certificate  BOOLEAN NOT NULL DEFAULT false,
    has_caste_certificate     BOOLEAN NOT NULL DEFAULT false,
    has_income_certificate    BOOLEAN NOT NULL DEFAULT false,
    has_passport_photo        BOOLEAN NOT NULL DEFAULT false,
    document_count            INT NOT NULL DEFAULT 0,
    status            VARCHAR(30) NOT NULL DEFAULT 'pending',
    rejection_reason  TEXT,
    reviewed_by       UUID,
    reviewed_at       TIMESTAMPTZ,
    created_user_id   UUID,
    created_student_id UUID,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admission_applications_school_status_idx
    ON admission_applications(school_id, status);
CREATE INDEX IF NOT EXISTS admission_applications_school_submitted_idx
    ON admission_applications(school_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS admission_applications_mother_phone_idx
    ON admission_applications(school_id, mother_phone);
CREATE OR REPLACE FUNCTION update_admission_applications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS set_admission_applications_updated_at ON admission_applications;
CREATE TRIGGER set_admission_applications_updated_at
    BEFORE UPDATE ON admission_applications
    FOR EACH ROW EXECUTE FUNCTION update_admission_applications_updated_at();
`
	if err := r.db.Exec(ctx, ddl); err != nil {
		return err
	}

	// Step 2: Widen columns that may have been created with narrow VARCHAR types
	// by migration 052 (academic_year VARCHAR(20), blood_group VARCHAR(10), etc.).
	//
	// Use db.Pool.Exec DIRECTLY (not r.db.Exec) so there is NO search_path SET
	// before the statement. The schema-qualified table name resolves without
	// search_path — this eliminates any PgBouncer/connection-pool ambiguity.
	quotedSchema, _ := ctx.Value("tenant_schema").(string)
	if quotedSchema == "" {
		// No tenant schema in context: table was just created with correct types.
		return nil
	}

	widen := fmt.Sprintf(`
ALTER TABLE IF EXISTS %s.admission_applications
    ALTER COLUMN academic_year  TYPE TEXT,
    ALTER COLUMN blood_group    TYPE VARCHAR(20),
    ALTER COLUMN aadhaar_number TYPE VARCHAR(50),
    ALTER COLUMN pincode        TYPE VARCHAR(20);
`, quotedSchema)

	// db.Pool.Exec directly — bypasses the tenant-aware wrapper entirely.
	if _, err := r.db.Pool.Exec(ctx, widen); err != nil {
		log.Printf("ERROR ensureAdmissionApplicationsTable: widen columns in %s: %v", quotedSchema, err)
		return fmt.Errorf("widen admission columns: %w", err)
	}
	return nil
}
