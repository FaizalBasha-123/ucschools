package school

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/modules/auth"
	"github.com/schools24/backend/internal/shared/database"
	"github.com/schools24/backend/internal/shared/objectstore"
	"golang.org/x/crypto/bcrypt"
)

func generateSlug(name string) string {
	reg, _ := regexp.Compile("[^a-zA-Z0-9]+")
	slug := reg.ReplaceAllString(name, "-")
	slug = strings.Trim(slug, "-")
	return strings.ToLower(slug)
}

func normalizeSchoolCode(raw string) string {
	trimmed := strings.TrimSpace(strings.ToUpper(raw))
	if trimmed == "" {
		return ""
	}
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	trimmed = regexp.MustCompile(`[^A-Z0-9_-]`).ReplaceAllString(trimmed, "")
	return strings.Trim(trimmed, "-")
}

type Service struct {
	repo        *Repository
	userRepo    *auth.Repository // Need access to User repo for transaction
	authService *auth.Service    // For password verification
	config      *config.Config
	store       objectstore.Store
}

var (
	ErrEmailExists       = errors.New("email already exists")
	ErrInvalidSchoolCode = errors.New("invalid school code")
	ErrSchoolCodeExists  = errors.New("school code already exists")
)

var udiseCodeRegex = regexp.MustCompile(`^UDISE[0-9]{6,14}$`)
var internalCodeRegex = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_-]{0,29}$`)

func validateSchoolCode(code string) error {
	if code == "" {
		return nil
	}
	if strings.HasPrefix(code, "UDISE") {
		if !udiseCodeRegex.MatchString(code) {
			return fmt.Errorf("%w: UDISE codes must be in format UDISE followed by 6-14 digits", ErrInvalidSchoolCode)
		}
		return nil
	}
	if !internalCodeRegex.MatchString(code) {
		return fmt.Errorf("%w: internal code must be 1-30 chars using A-Z, 0-9, underscore, or hyphen", ErrInvalidSchoolCode)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

func NewService(repo *Repository, userRepo *auth.Repository, authService *auth.Service, cfg *config.Config, store objectstore.Store) *Service {
	return &Service{
		repo:        repo,
		userRepo:    userRepo,
		authService: authService,
		config:      cfg,
		store:       store,
	}
}

// CreateSchoolWithAdmin creates a school and its default admin transactionally
// Requires super admin password verification for security
func (s *Service) CreateSchoolWithAdmin(ctx context.Context, superAdminID uuid.UUID, password string, req *CreateSchoolRequest) (*School, error) {
	// 1. Verify super admin password for security
	if err := s.authService.VerifySuperAdminPassword(ctx, superAdminID, password); err != nil {
		return nil, err
	}

	if len(req.Admins) == 0 {
		return nil, fmt.Errorf("at least one admin is required")
	}

	seenEmails := make(map[string]struct{}, len(req.Admins))
	for _, adminReq := range req.Admins {
		normalizedEmail := strings.ToLower(strings.TrimSpace(adminReq.Email))
		if normalizedEmail == "" {
			return nil, fmt.Errorf("admin email is required")
		}
		if _, alreadySeen := seenEmails[normalizedEmail]; alreadySeen {
			return nil, ErrEmailExists
		}
		seenEmails[normalizedEmail] = struct{}{}

		exists, err := s.userRepo.EmailExists(ctx, normalizedEmail)
		if err != nil {
			return nil, fmt.Errorf("failed to validate admin email uniqueness: %w", err)
		}
		if exists {
			return nil, ErrEmailExists
		}
	}

	// 2. Generate School ID
	schoolID := uuid.New()
	slug := generateSlug(req.Name)

	address := req.Address
	contactEmail := req.ContactEmail
	code := normalizeSchoolCode(req.Code)
	if code == "" {
		code = normalizeSchoolCode("SCH-" + slug)
	}
	if err := validateSchoolCode(code); err != nil {
		return nil, err
	}
	codeExists, err := s.repo.SchoolCodeExists(ctx, code, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to validate school code uniqueness: %w", err)
	}
	if codeExists {
		return nil, ErrSchoolCodeExists
	}

	school := &School{
		ID:           schoolID,
		Name:         req.Name,
		Slug:         &slug,
		Code:         &code,
		Address:      &address,
		ContactEmail: &contactEmail,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	// 2. Perform Transaction (school row only)
	err = s.repo.WithTx(ctx, func(tx database.Tx) error {
		// Create School
		schoolQuery := `
			INSERT INTO schools (id, name, slug, code, address, email, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`
		if _, err := tx.Exec(ctx, schoolQuery,
			school.ID, school.Name, school.Slug, code, school.Address, school.ContactEmail, school.CreatedAt, school.UpdatedAt,
		); err != nil {
			if isUniqueViolation(err) {
				return ErrSchoolCodeExists
			}
			return err
		}

		return nil
	})

	if err != nil {
		if errors.Is(err, ErrSchoolCodeExists) {
			return nil, ErrSchoolCodeExists
		}
		return nil, err
	}

	// 3. Provision Tenant Schema
	// We access the underlying DB from the repo.
	// Ideally Repository should expose a method or we assume s.repo.DB access.
	// Looking at repository.go, it usually embeds *database.PostgresDB as 'db'.
	// Use a type assertion or getter if needed, but 's.repo.db' is likely unexported.
	// I should check repository.go content from previous step.
	// It has `db *database.PostgresDB`.
	// I cannot access unexported field 'db' from 'school' package if Repository is in same package?
	// Yes, 'Service' and 'Repository' are in 'school' package. So 's.repo.db' IS accessible.

	if err := s.repo.db.CreateSchoolSchema(ctx, schoolID); err != nil {
		_ = s.repo.Delete(ctx, schoolID)
		return nil, fmt.Errorf("school created but failed to provision schema: %w", err)
	}

	// 4. Create admin users directly in tenant schema
	schemaName := fmt.Sprintf("school_%s", schoolID)
	safeSchema := "\"" + schemaName + "\""
	userQuery := fmt.Sprintf(`
		INSERT INTO %s.users (id, email, password_hash, role, full_name, school_id, email_verified, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, safeSchema)

	for _, adminReq := range req.Admins {
		adminID := uuid.New()
		hashedPassword, hashErr := bcrypt.GenerateFromPassword([]byte(adminReq.Password), bcrypt.DefaultCost)
		if hashErr != nil {
			_ = s.repo.db.DropSchoolSchema(ctx, schoolID)
			_ = s.repo.Delete(ctx, schoolID)
			return nil, hashErr
		}
		now := time.Now()
		if execErr := s.repo.db.Exec(ctx, userQuery,
			adminID, strings.ToLower(adminReq.Email), string(hashedPassword), "admin", adminReq.Name, schoolID, true, true, now, now,
		); execErr != nil {
			_ = s.repo.db.DropSchoolSchema(ctx, schoolID)
			_ = s.repo.Delete(ctx, schoolID)
			return nil, fmt.Errorf("failed to create school admin in tenant schema: %w", execErr)
		}
	}

	return school, nil
}

func (s *Service) GetAllSchools(ctx context.Context) ([]SchoolResponse, error) {
	schools, adminCounts, err := s.repo.GetAllWithAdminCounts(ctx)
	if err != nil {
		return nil, err
	}

	// Construct SchoolResponse array with admin counts
	responses := make([]SchoolResponse, len(schools))
	for i, school := range schools {
		schoolCopy := school // Create a copy to avoid pointer issues
		responses[i] = SchoolResponse{
			School: &schoolCopy,
			Stats: UserStats{
				Admins: adminCounts[school.ID],
			},
		}
	}

	return responses, nil
}

// GetSchoolsPaged returns a paginated list of schools with full role-based stats and the total count.
func (s *Service) GetSchoolsPaged(ctx context.Context, page, pageSize int64) ([]SchoolResponse, int64, error) {
	schools, statsMap, total, err := s.repo.GetPagedWithStats(ctx, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	responses := make([]SchoolResponse, len(schools))
	for i, school := range schools {
		schoolCopy := school
		stats := UserStats{}
		if s, ok := statsMap[school.ID]; ok && s != nil {
			stats = *s
		}
		responses[i] = SchoolResponse{
			School: &schoolCopy,
			Stats:  stats,
		}
	}
	return responses, total, nil
}

func (s *Service) GetSchool(ctx context.Context, idOrSlug string) (*SchoolResponse, error) {
	var school *School
	var err error

	// Try parsing as UUID
	if id, parseErr := uuid.Parse(idOrSlug); parseErr == nil {
		school, err = s.repo.GetByID(ctx, id)
	} else {
		// Fallback to Slug
		school, err = s.repo.GetBySlug(ctx, idOrSlug)
	}

	if err != nil {
		return nil, err
	}

	// Fetch Stats
	stats, err := s.repo.GetStats(ctx, school.ID)
	if err != nil {
		// Log error but don't fail the request? Or return empty stats?
		// Valid strategy: Return error if critical, or zero stats.
		// For now, let's treat it as non-fatal but log (if logging available) or just empty.
		stats = &UserStats{}
	}

	return &SchoolResponse{
		School: school,
		Stats:  *stats,
	}, nil
}

// UpdateSchool updates the public metadata of a school (name, address, contact_email).
// No password required — this is a non-destructive operation restricted to super_admins via role middleware.
func (s *Service) UpdateSchool(ctx context.Context, schoolID uuid.UUID, name, code, address, contactEmail string) (*School, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("school name is required")
	}
	normalizedCode := normalizeSchoolCode(code)
	if normalizedCode == "" {
		normalizedCode = normalizeSchoolCode("SCH-" + generateSlug(name))
	}
	if err := validateSchoolCode(normalizedCode); err != nil {
		return nil, err
	}
	codeExists, err := s.repo.SchoolCodeExists(ctx, normalizedCode, &schoolID)
	if err != nil {
		return nil, fmt.Errorf("failed to validate school code uniqueness: %w", err)
	}
	if codeExists {
		return nil, ErrSchoolCodeExists
	}
	updated, err := s.repo.Update(ctx, schoolID, strings.TrimSpace(name), normalizedCode, strings.TrimSpace(address), strings.TrimSpace(contactEmail))
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrSchoolCodeExists
		}
		return nil, fmt.Errorf("failed to update school: %w", err)
	}
	return updated, nil
}

// SoftDeleteSchool marks a school as deleted (trash bin) with password verification
// School can be restored within 24 hours by any super admin
func (s *Service) SoftDeleteSchool(ctx context.Context, schoolID, superAdminID uuid.UUID, password string) error {
	// 1. Verify super admin password for security
	if err := s.authService.VerifySuperAdminPassword(ctx, superAdminID, password); err != nil {
		return err
	}

	// 2. Verify school exists and is not already deleted
	school, err := s.repo.GetByID(ctx, schoolID)
	if err != nil {
		return fmt.Errorf("school not found: %w", err)
	}
	if school.DeletedAt != nil {
		return fmt.Errorf("school is already deleted")
	}

	// 3. Soft delete the school
	if err := s.repo.SoftDelete(ctx, schoolID, superAdminID); err != nil {
		return fmt.Errorf("failed to delete school: %w", err)
	}

	fmt.Printf("School soft-deleted: %s (ID: %s) by super admin %s\n", school.Name, schoolID, superAdminID)
	return nil
}

// RestoreSchool restores a soft-deleted school with password verification
// Only works within 24 hours of deletion
func (s *Service) RestoreSchool(ctx context.Context, schoolID, superAdminID uuid.UUID, password string) error {
	// 1. Verify super admin password
	if err := s.authService.VerifySuperAdminPassword(ctx, superAdminID, password); err != nil {
		return err
	}

	// 2. Verify school exists and is deleted
	schools, err := s.repo.GetDeletedSchools(ctx)
	if err != nil {
		return err
	}

	var targetSchool *School
	for _, school := range schools {
		if school.ID == schoolID {
			targetSchool = &school
			break
		}
	}

	if targetSchool == nil {
		return fmt.Errorf("school not found in trash")
	}

	// 3. Check if deletion is within 24 hours
	if targetSchool.DeletedAt != nil {
		hoursSinceDeletion := time.Since(*targetSchool.DeletedAt).Hours()
		if hoursSinceDeletion > 24 {
			return fmt.Errorf("school cannot be restored (deleted more than 24 hours ago)")
		}
	}

	// 4. Restore the school
	if err := s.repo.Restore(ctx, schoolID); err != nil {
		return fmt.Errorf("failed to restore school: %w", err)
	}

	fmt.Printf("School restored: %s (ID: %s) by super admin %s\n", targetSchool.Name, schoolID, superAdminID)
	return nil
}

// GetDeletedSchools returns all soft-deleted schools (trash bin)
func (s *Service) GetDeletedSchools(ctx context.Context) ([]School, error) {
	return s.repo.GetDeletedSchools(ctx)
}

// PermanentlyDeleteSchool permanently deletes a school and all associated data
// This is used by the cleanup job for schools deleted > 24 hours ago
// This operation is irreversible
func (s *Service) PermanentlyDeleteSchool(ctx context.Context, schoolID uuid.UUID) error {
	// Verify school exists
	school, err := s.repo.GetByID(ctx, schoolID)
	if err != nil {
		return fmt.Errorf("school not found: %w", err)
	}

	// Perform deletion in transaction for global data
	err = s.repo.WithTx(ctx, func(tx database.Tx) error {
		// Delete the school record; tenant users are removed when schema is dropped.
		deleteSchoolQuery := `DELETE FROM schools WHERE id = $1`
		if _, err := tx.Exec(ctx, deleteSchoolQuery, schoolID); err != nil {
			return fmt.Errorf("failed to delete school: %w", err)
		}

		return nil
	})

	if err != nil {
		return err
	}

	// 3. Drop the tenant schema (cannot be done inside transaction)
	if err := s.repo.db.DropSchoolSchema(ctx, schoolID); err != nil {
		// Log error but don't fail the operation since main data is deleted
		fmt.Printf("Warning: Failed to drop tenant schema for school %s: %v\n", school.Name, err)
	}

	fmt.Printf("School permanently deleted: %s (ID: %s)\n", school.Name, schoolID)
	return nil
}

// CleanupOldDeletedSchools permanently deletes schools that have been in trash for > 24 hours
// This is called by a background job
func (s *Service) CleanupOldDeletedSchools(ctx context.Context) error {
	schoolIDs, err := s.repo.GetSchoolsToCleanup(ctx)
	if err != nil {
		return err
	}

	for _, schoolID := range schoolIDs {
		if err := s.PermanentlyDeleteSchool(ctx, schoolID); err != nil {
			fmt.Printf("Error permanently deleting school %s: %v\n", schoolID, err)
			continue
		}
	}

	if len(schoolIDs) > 0 {
		fmt.Printf("Cleanup completed: %d schools permanently deleted\n", len(schoolIDs))
	}

	return nil
}

// DeleteSchool is deprecated - use SoftDeleteSchool instead
// Kept for backward compatibility during migration
func (s *Service) DeleteSchool(ctx context.Context, schoolID uuid.UUID) error {
	// Verify school exists
	school, err := s.repo.GetByID(ctx, schoolID)
	if err != nil {
		return fmt.Errorf("school not found: %w", err)
	}

	// Perform deletion in transaction for global data
	err = s.repo.WithTx(ctx, func(tx database.Tx) error {
		// Delete the school record; tenant users are removed when schema is dropped.
		deleteSchoolQuery := `DELETE FROM schools WHERE id = $1`
		if _, err := tx.Exec(ctx, deleteSchoolQuery, schoolID); err != nil {
			return fmt.Errorf("failed to delete school: %w", err)
		}

		return nil
	})

	if err != nil {
		return err
	}

	// 3. Drop the tenant schema (cannot be done inside transaction)
	if err := s.repo.db.DropSchoolSchema(ctx, schoolID); err != nil {
		// Log error but don't fail the operation since main data is deleted
		fmt.Printf("Warning: Failed to drop tenant schema for school %s: %v\n", school.Name, err)
	}

	fmt.Printf("Successfully deleted school: %s (ID: %s)\n", school.Name, schoolID)
	return nil
}

func (s *Service) ListGlobalClasses(ctx context.Context) ([]GlobalClass, error) {
	return s.repo.ListGlobalClasses(ctx)
}

func (s *Service) CreateGlobalClass(ctx context.Context, req *UpsertGlobalClassRequest) (*GlobalClass, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("class name is required")
	}
	item := &GlobalClass{
		ID:        uuid.New(),
		Name:      name,
		SortOrder: req.SortOrder,
	}
	if err := s.repo.CreateGlobalClass(ctx, item); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) UpdateGlobalClass(ctx context.Context, classID uuid.UUID, req *UpsertGlobalClassRequest) (*GlobalClass, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("class name is required")
	}
	item := &GlobalClass{
		ID:        classID,
		Name:      name,
		SortOrder: req.SortOrder,
	}
	if err := s.repo.UpdateGlobalClass(ctx, classID, item); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) DeleteGlobalClass(ctx context.Context, classID uuid.UUID) error {
	return s.repo.DeleteGlobalClass(ctx, classID)
}

func (s *Service) ReorderGlobalClasses(ctx context.Context, req *ReorderGlobalClassesRequest) error {
	if len(req.Items) == 0 {
		return nil
	}
	return s.repo.ReorderGlobalClasses(ctx, req.Items)
}

func (s *Service) ListGlobalSubjects(ctx context.Context) ([]GlobalSubject, error) {
	return s.repo.ListGlobalSubjects(ctx)
}

func (s *Service) CreateGlobalSubject(ctx context.Context, req *UpsertGlobalSubjectRequest) (*GlobalSubject, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("subject name is required")
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	item := &GlobalSubject{
		ID:   uuid.New(),
		Name: name,
		Code: code,
	}
	if err := s.repo.CreateGlobalSubject(ctx, item); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) UpdateGlobalSubject(ctx context.Context, subjectID uuid.UUID, req *UpsertGlobalSubjectRequest) (*GlobalSubject, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("subject name is required")
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	item := &GlobalSubject{
		ID:   subjectID,
		Name: name,
		Code: code,
	}
	if err := s.repo.UpdateGlobalSubject(ctx, subjectID, item); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) DeleteGlobalSubject(ctx context.Context, subjectID uuid.UUID) error {
	return s.repo.DeleteGlobalSubject(ctx, subjectID)
}

func (s *Service) ReplaceGlobalClassSubjects(ctx context.Context, classID uuid.UUID, subjectIDs []string) error {
	ids := make([]uuid.UUID, 0, len(subjectIDs))
	seen := make(map[uuid.UUID]struct{}, len(subjectIDs))
	for _, rawID := range subjectIDs {
		id, err := uuid.Parse(strings.TrimSpace(rawID))
		if err != nil {
			return fmt.Errorf("invalid subject id: %s", rawID)
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return s.repo.ReplaceGlobalClassSubjects(ctx, classID, ids)
}

func (s *Service) ListGlobalCatalogAssignments(ctx context.Context) ([]GlobalClassWithSubjects, error) {
	return s.repo.ListGlobalCatalogAssignments(ctx)
}

// GetMonthlyNewUsers returns aggregated new-user counts per month for the given year.
func (s *Service) GetMonthlyNewUsers(ctx context.Context, year int) (*MonthlyUsersResponse, error) {
	months, err := s.repo.GetMonthlyNewUsers(ctx, year)
	if err != nil {
		return nil, err
	}
	resp := &MonthlyUsersResponse{
		Year:   year,
		Months: months,
	}
	for _, m := range months {
		resp.Summary.TotalNewUsers += m.Total
		resp.Summary.TotalStudents += m.Students
		resp.Summary.TotalTeachers += m.Teachers
		resp.Summary.TotalAdmins += m.Admins
		resp.Summary.TotalSuperAdmins += m.SuperAdmins
		if m.Total > resp.Summary.PeakCount {
			resp.Summary.PeakCount = m.Total
			resp.Summary.PeakMonth = m.MonthNum
		}
	}
	return resp, nil
}

// GetCurrentAcademicYear returns the platform-wide current academic year.
func (s *Service) GetCurrentAcademicYear(ctx context.Context) (string, error) {
	return s.repo.GetGlobalSetting(ctx, "current_academic_year")
}

// SetCurrentAcademicYear updates the global current academic year.
func (s *Service) SetCurrentAcademicYear(ctx context.Context, year string) error {
	year = strings.TrimSpace(year)
	if len(year) < 4 {
		return errors.New("academic year must be a valid value (e.g. 2025-2026)")
	}
	return s.repo.SetGlobalSetting(ctx, "current_academic_year", year)
}

// GetGlobalSettings returns all global platform settings as a map.
func (s *Service) GetGlobalSettings(ctx context.Context) (map[string]string, error) {
	year, err := s.repo.GetGlobalSetting(ctx, "current_academic_year")
	if err != nil {
		year = ""
	}
	return map[string]string{"current_academic_year": year}, nil
}

func (s *Service) GetDatabaseSchema(ctx context.Context, superAdminID uuid.UUID, password, schemaName string) (interface{}, error) {
	if err := s.authService.VerifySuperAdminPassword(ctx, superAdminID, password); err != nil {
		return nil, err
	}

	if schemaName == "all" {
		names, err := s.repo.GetAllSchemaNames(ctx)
		if err != nil {
			return nil, err
		}
		// Batch-fetch all school names so we can label each tenant schema.
		schoolNames, _ := s.repo.GetSchoolNamesMap(ctx)

		result := &AllSchemasResponse{}
		for _, name := range names {
			sr, err := s.repo.GetSchemaIntrospection(ctx, name)
			if err != nil {
				return nil, fmt.Errorf("introspect %s: %w", name, err)
			}
			if strings.HasPrefix(name, "school_") {
				uuidStr := strings.TrimPrefix(name, "school_")
				if n, ok := schoolNames[uuidStr]; ok {
					sr.SchoolName = n
				}
			}
			result.Schemas = append(result.Schemas, *sr)
		}
		return result, nil
	}

	// Validate schema name: only allow 'public' or 'school_<uuid>' pattern
	if schemaName != "public" {
		if !regexp.MustCompile(`^school_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).MatchString(schemaName) {
			return nil, fmt.Errorf("invalid schema name")
		}
	}

	sr, err := s.repo.GetSchemaIntrospection(ctx, schemaName)
	if err != nil {
		return nil, err
	}
	// Attach school name for tenant schemas.
	if strings.HasPrefix(schemaName, "school_") {
		uuidStr := strings.TrimPrefix(schemaName, "school_")
		if schoolID, parseErr := uuid.Parse(uuidStr); parseErr == nil {
			if school, getErr := s.repo.GetByID(ctx, schoolID); getErr == nil {
				sr.SchoolName = school.Name
			}
		}
	}
	return sr, nil
}

func (s *Service) GetStorageOverview(ctx context.Context) (*StorageOverviewResponse, error) {
	schools, err := s.repo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("list schools for storage overview: %w", err)
	}

	schemaSizes, err := s.repo.GetSchemaSizes(ctx)
	if err != nil {
		return nil, fmt.Errorf("load postgres schema sizes: %w", err)
	}

	r2BySchool, platformR2Collections, r2KeySet, err := s.collectR2Storage(ctx)
	if err != nil {
		return nil, err
	}

	resp := &StorageOverviewResponse{
		Schools: make([]SchoolStorageUsage, 0, len(schools)),
	}

	resp.Platform = PlatformStorageUsage{
		SchemaName:    "public",
		NeonBytes:     schemaSizes["public"],
		R2Collections: platformR2Collections,
	}
	for _, item := range platformR2Collections {
		resp.Platform.R2Bytes += item.Bytes
		resp.Platform.R2Documents += item.Documents
	}
	resp.Platform.TotalBytes = resp.Platform.NeonBytes + resp.Platform.R2Bytes

	for _, school := range schools {
		schemaName := fmt.Sprintf("school_%s", school.ID.String())
		r2Usage := r2BySchool[school.ID.String()]
		r2Collections := []StorageCollectionUsage{}
		var r2Documents int64
		var r2Bytes int64
		if r2Usage != nil {
			r2Collections = r2Usage.R2Collections
			r2Documents = r2Usage.R2Documents
			r2Bytes = r2Usage.R2Bytes
		}
		usage := SchoolStorageUsage{
			SchoolID:      school.ID.String(),
			SchoolName:    school.Name,
			SchemaName:    schemaName,
			NeonBytes:     schemaSizes[schemaName],
			R2Collections: r2Collections,
			R2Documents:   r2Documents,
			R2Bytes:       r2Bytes,
		}
		usage.TotalBytes = usage.NeonBytes + usage.R2Bytes
		resp.Schools = append(resp.Schools, usage)

		resp.Summary.TotalSchoolNeonBytes += usage.NeonBytes
		resp.Summary.TotalSchoolR2Bytes += usage.R2Bytes
		resp.Summary.TotalSchoolBytes += usage.TotalBytes
	}

	resp.Summary.PlatformNeonBytes = resp.Platform.NeonBytes
	resp.Summary.PlatformR2Bytes = resp.Platform.R2Bytes
	resp.Summary.PlatformBytes = resp.Platform.TotalBytes
	resp.Summary.SchoolCount = len(resp.Schools)
	resp.Summary.GrandTotalBytes = resp.Summary.TotalSchoolBytes + resp.Platform.TotalBytes

	integrity, integrityErr := s.buildStorageIntegrityReport(ctx, schools, r2KeySet)
	if integrityErr != nil {
		return nil, integrityErr
	}
	resp.Integrity = integrity

	return resp, nil
}

type schoolR2Usage struct {
	R2Bytes       int64
	R2Documents   int64
	R2Collections []StorageCollectionUsage
}

func (s *Service) collectR2Storage(ctx context.Context) (map[string]*schoolR2Usage, []StorageCollectionUsage, map[string]struct{}, error) {
	result := make(map[string]*schoolR2Usage)
	if s.store == nil {
		return result, nil, nil, errors.New("r2 object store not configured")
	}
	r2KeySet := make(map[string]struct{})

	listPrefixes := []string{"schools/", "superadmin/"}
	itemsByPrefix := make(map[string][]objectstore.ObjectInfo, len(listPrefixes))
	for _, prefix := range listPrefixes {
		items, err := s.store.List(ctx, prefix)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("list r2 objects with prefix %s: %w", prefix, err)
		}
		itemsByPrefix[prefix] = items
		for _, item := range items {
			key := strings.TrimSpace(item.Key)
			if key != "" {
				r2KeySet[key] = struct{}{}
			}
		}
	}

	platform := make(map[string]*StorageCollectionUsage)
	for _, object := range itemsByPrefix["superadmin/"] {
		category, ok := parseR2Category(object.Key, "superadmin")
		if !ok {
			continue
		}
		usage := platform[category]
		if usage == nil {
			usage = &StorageCollectionUsage{Collection: category}
			platform[category] = usage
		}
		usage.Bytes += object.Size
		usage.Documents++
	}

	for _, object := range itemsByPrefix["schools/"] {
		schoolID, category, ok := parseR2SchoolObject(object.Key)
		if !ok {
			continue
		}
		schoolUsage := result[schoolID]
		if schoolUsage == nil {
			schoolUsage = &schoolR2Usage{}
			result[schoolID] = schoolUsage
		}
		schoolUsage.R2Bytes += object.Size
		schoolUsage.R2Documents++
		found := false
		for i := range schoolUsage.R2Collections {
			if schoolUsage.R2Collections[i].Collection == category {
				schoolUsage.R2Collections[i].Bytes += object.Size
				schoolUsage.R2Collections[i].Documents++
				found = true
				break
			}
		}
		if !found {
			schoolUsage.R2Collections = append(schoolUsage.R2Collections, StorageCollectionUsage{
				Collection: category,
				Bytes:      object.Size,
				Documents:  1,
			})
		}
	}

	platformCollections := make([]StorageCollectionUsage, 0, len(platform))
	for _, item := range platform {
		platformCollections = append(platformCollections, *item)
	}

	return result, platformCollections, r2KeySet, nil
}

func (s *Service) buildStorageIntegrityReport(ctx context.Context, schools []School, r2KeySet map[string]struct{}) (StorageIntegrityReport, error) {
	report := StorageIntegrityReport{Collections: make([]StorageIntegrityCollection, 0, 2)}
	if len(r2KeySet) == 0 {
		r2KeySet = make(map[string]struct{})
	}

	records, err := s.repo.ListDocumentStorageKeys(ctx, schools)
	if err != nil {
		return report, fmt.Errorf("build storage integrity report: %w", err)
	}

	byCollection := make(map[string]*StorageIntegrityCollection)
	for _, rec := range records {
		key := strings.TrimSpace(rec.StorageKey)
		if key == "" {
			continue
		}
		report.CheckedMetadataRows++
		item := byCollection[rec.Collection]
		if item == nil {
			item = &StorageIntegrityCollection{Collection: rec.Collection, MissingSamples: make([]string, 0, 5)}
			byCollection[rec.Collection] = item
		}
		item.MetadataRows++
		if _, ok := r2KeySet[key]; !ok {
			report.MissingObjects++
			item.MissingObjects++
			if len(item.MissingSamples) < 5 {
				item.MissingSamples = append(item.MissingSamples, key)
			}
		}
	}

	keys := make([]string, 0, len(byCollection))
	for k := range byCollection {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		report.Collections = append(report.Collections, *byCollection[k])
	}

	return report, nil
}

func parseR2SchoolObject(key string) (string, string, bool) {
	parts := strings.Split(strings.Trim(key, "/"), "/")
	if len(parts) < 5 || parts[0] != "schools" || parts[2] != "docs" {
		return "", "", false
	}
	return parts[1], parts[3], true
}

func parseR2Category(key string, scope string) (string, bool) {
	parts := strings.Split(strings.Trim(key, "/"), "/")
	switch scope {
	case "superadmin":
		if len(parts) < 4 || parts[0] != "superadmin" || parts[1] != "docs" {
			return "", false
		}
		return parts[2], true
	default:
		return "", false
	}
}
