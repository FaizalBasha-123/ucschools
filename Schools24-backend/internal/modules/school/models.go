package school

import (
	"time"

	"github.com/google/uuid"
)

// School represents a school entity
type School struct {
	ID            uuid.UUID  `json:"id" db:"id"`
	Name          string     `json:"name" db:"name"`
	Slug          *string    `json:"slug" db:"slug"`
	Code          *string    `json:"code,omitempty" db:"code"`
	Address       *string    `json:"address,omitempty" db:"address"`
	ContactEmail  *string    `json:"contact_email,omitempty" db:"email"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty" db:"deleted_at"`
	DeletedBy     *uuid.UUID `json:"deleted_by,omitempty" db:"deleted_by"`
	DeletedByName *string    `json:"deleted_by_name,omitempty" db:"deleted_by_name"`
	CreatedAt     time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at" db:"updated_at"`
}

// CreateSchoolRequest represents payload for creating a school
type AdminRequest struct {
	Name     string `json:"name" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

// CreateSchoolRequest represents payload for creating a school
type CreateSchoolRequest struct {
	Name         string         `json:"name" binding:"required"`
	Code         string         `json:"code,omitempty"`
	Address      string         `json:"address"`
	ContactEmail string         `json:"contact_email"`
	Admins       []AdminRequest `json:"admins" binding:"required,dive"`
}

// SchoolResponse includes school details and admin info (optional)
type SchoolResponse struct {
	*School
	Stats UserStats `json:"stats"`
}

type StorageCollectionUsage struct {
	Collection string `json:"collection"`
	Bytes      int64  `json:"bytes"`
	Documents  int64  `json:"documents"`
}

type SchoolStorageUsage struct {
	SchoolID      string                   `json:"school_id"`
	SchoolName    string                   `json:"school_name"`
	SchemaName    string                   `json:"schema_name"`
	NeonBytes     int64                    `json:"neon_bytes"`
	R2Bytes       int64                    `json:"r2_bytes"`
	TotalBytes    int64                    `json:"total_bytes"`
	R2Documents   int64                    `json:"r2_documents"`
	R2Collections []StorageCollectionUsage `json:"r2_collections"`
}

type PlatformStorageUsage struct {
	SchemaName    string                   `json:"schema_name"`
	NeonBytes     int64                    `json:"neon_bytes"`
	R2Bytes       int64                    `json:"r2_bytes"`
	TotalBytes    int64                    `json:"total_bytes"`
	R2Documents   int64                    `json:"r2_documents"`
	R2Collections []StorageCollectionUsage `json:"r2_collections"`
}

type StorageOverviewSummary struct {
	TotalSchoolNeonBytes int64 `json:"total_school_neon_bytes"`
	TotalSchoolR2Bytes   int64 `json:"total_school_r2_bytes"`
	TotalSchoolBytes     int64 `json:"total_school_bytes"`
	PlatformNeonBytes    int64 `json:"platform_neon_bytes"`
	PlatformR2Bytes      int64 `json:"platform_r2_bytes"`
	PlatformBytes        int64 `json:"platform_bytes"`
	GrandTotalBytes      int64 `json:"grand_total_bytes"`
	SchoolCount          int   `json:"school_count"`
}

type StorageIntegrityCollection struct {
	Collection     string   `json:"collection"`
	MetadataRows   int64    `json:"metadata_rows"`
	MissingObjects int64    `json:"missing_objects"`
	MissingSamples []string `json:"missing_samples,omitempty"`
}

type StorageIntegrityReport struct {
	CheckedMetadataRows int64                        `json:"checked_metadata_rows"`
	MissingObjects      int64                        `json:"missing_objects"`
	Collections         []StorageIntegrityCollection `json:"collections"`
}

type StorageOverviewResponse struct {
	Summary   StorageOverviewSummary `json:"summary"`
	Platform  PlatformStorageUsage   `json:"platform"`
	Schools   []SchoolStorageUsage   `json:"schools"`
	Integrity StorageIntegrityReport `json:"integrity"`
}

// UserStats represents user statistics for a school
type UserStats struct {
	Students int `json:"students"`
	Teachers int `json:"teachers"`
	Staff    int `json:"staff"`
	Admins   int `json:"admins"`
}

// PasswordVerificationRequest represents password verification for sensitive operations
type PasswordVerificationRequest struct {
	Password string `json:"password" binding:"required"`
}

type GlobalClass struct {
	ID        uuid.UUID `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	SortOrder int       `json:"sort_order" db:"sort_order"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type GlobalSubject struct {
	ID        uuid.UUID `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	Code      string    `json:"code" db:"code"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type GlobalClassWithSubjects struct {
	Class    GlobalClass     `json:"class"`
	Subjects []GlobalSubject `json:"subjects"`
}

type UpsertGlobalClassRequest struct {
	Name      string `json:"name" binding:"required"`
	SortOrder int    `json:"sort_order"`
}

type ReorderClassItem struct {
	ID        uuid.UUID `json:"id"`
	SortOrder int       `json:"sort_order"`
}

type ReorderGlobalClassesRequest struct {
	Items []ReorderClassItem `json:"items" binding:"required"`
}

type UpsertGlobalSubjectRequest struct {
	Name string `json:"name" binding:"required"`
	Code string `json:"code"`
}

type AssignSubjectsToClassRequest struct {
	SubjectIDs []string `json:"subject_ids"`
}

// MonthlyUserStat holds new-user counts for a single month
type MonthlyUserStat struct {
	MonthNum    int `json:"month_num"` // 1–12
	Total       int `json:"total"`
	Students    int `json:"students"`
	Teachers    int `json:"teachers"`
	Admins      int `json:"admins"`
	SuperAdmins int `json:"super_admins"`
}

// MonthlyUsersSummary is the aggregate summary over a full year
type MonthlyUsersSummary struct {
	TotalNewUsers    int `json:"total_new_users"`
	TotalStudents    int `json:"total_students"`
	TotalTeachers    int `json:"total_teachers"`
	TotalAdmins      int `json:"total_admins"`
	TotalSuperAdmins int `json:"total_super_admins"`
	PeakMonth        int `json:"peak_month"`
	PeakCount        int `json:"peak_count"`
}

// MonthlyUsersResponse is the API response for monthly new-user analytics
type MonthlyUsersResponse struct {
	Year    int                 `json:"year"`
	Months  []MonthlyUserStat   `json:"months"`
	Summary MonthlyUsersSummary `json:"summary"`
}

// Schema introspection types
type SchemaColumn struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	IsPK     bool   `json:"is_pk"`
}

type SchemaFK struct {
	ConstraintName string `json:"constraint_name"`
	SourceTable    string `json:"source_table"`
	SourceColumn   string `json:"source_column"`
	TargetSchema   string `json:"target_schema"` // may differ from source schema for cross-schema FKs
	TargetTable    string `json:"target_table"`
	TargetColumn   string `json:"target_column"`
}

type SchemaTable struct {
	Name    string         `json:"name"`
	Columns []SchemaColumn `json:"columns"`
}

type SchemaResponse struct {
	SchemaName  string        `json:"schema_name"`
	SchoolName  string        `json:"school_name,omitempty"` // populated for tenant schemas
	Tables      []SchemaTable `json:"tables"`
	ForeignKeys []SchemaFK    `json:"foreign_keys"`
}

type AllSchemasResponse struct {
	Schemas []SchemaResponse `json:"schemas"`
}
