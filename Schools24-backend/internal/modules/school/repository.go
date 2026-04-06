package school

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/schools24/backend/internal/shared/database"
)

type storageKeyRecord struct {
	Collection string
	StorageKey string
}

type Repository struct {
	db *database.PostgresDB
}

func NewRepository(db *database.PostgresDB) *Repository {
	return &Repository{db: db}
}

// Create creates a school
func (r *Repository) Create(ctx context.Context, school *School) error {
	query := `
		INSERT INTO schools (id, name, address, email, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	return r.db.Exec(ctx, query,
		school.ID,
		school.Name,
		school.Address,
		school.ContactEmail,
		school.CreatedAt,
		school.UpdatedAt,
	)
}

// GetAll returns all schools
func (r *Repository) GetAll(ctx context.Context) ([]School, error) {
	query := `
		SELECT id, name, slug, code, address, email, created_at, updated_at 
		FROM schools 
		WHERE deleted_at IS NULL
		ORDER BY created_at DESC
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schools []School
	for rows.Next() {
		var s School
		if err := rows.Scan(
			&s.ID, &s.Name, &s.Slug, &s.Code, &s.Address, &s.ContactEmail, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		schools = append(schools, s)
	}
	return schools, nil
}

// GetAllWithAdminCounts returns all schools with their admin counts
func (r *Repository) GetAllWithAdminCounts(ctx context.Context) ([]School, map[uuid.UUID]int, error) {
	query := `
		SELECT id, name, slug, code, address, email, created_at, updated_at
		FROM schools
		WHERE deleted_at IS NULL
		ORDER BY created_at DESC
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var schools []School
	adminCounts := make(map[uuid.UUID]int)

	for rows.Next() {
		var s School
		if err := rows.Scan(
			&s.ID, &s.Name, &s.Slug, &s.Code, &s.Address, &s.ContactEmail,
			&s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, nil, err
		}
		schools = append(schools, s)

		schema := fmt.Sprintf("\"school_%s\"", s.ID)
		countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM %s.users WHERE role = 'admin'`, schema)
		var adminCount int
		if err := r.db.QueryRow(ctx, countQuery).Scan(&adminCount); err != nil {
			adminCount = 0
		}
		adminCounts[s.ID] = adminCount
	}
	return schools, adminCounts, nil
}

// GetPagedWithStats returns a page of schools with full role-based user stats and the total count.
func (r *Repository) GetPagedWithStats(ctx context.Context, page, pageSize int64) ([]School, map[uuid.UUID]*UserStats, int64, error) {
	var total int64
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM schools WHERE deleted_at IS NULL`).Scan(&total); err != nil {
		return nil, nil, 0, err
	}

	offset := (page - 1) * pageSize
	query := `
		SELECT id, name, slug, code, address, email, created_at, updated_at
		FROM schools
		WHERE deleted_at IS NULL
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	rows, err := r.db.Query(ctx, query, pageSize, offset)
	if err != nil {
		return nil, nil, 0, err
	}
	defer rows.Close()

	var schools []School
	statsMap := make(map[uuid.UUID]*UserStats)
	for rows.Next() {
		var s School
		if err := rows.Scan(&s.ID, &s.Name, &s.Slug, &s.Code, &s.Address, &s.ContactEmail, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, nil, 0, err
		}
		schools = append(schools, s)

		// Fetch per-role counts from the school's tenant schema
		schema := fmt.Sprintf("\"school_%s\"", s.ID)
		roleQuery := fmt.Sprintf(`
			SELECT role, COUNT(*)
			FROM %s.users
			GROUP BY role
		`, schema)
		roleRows, qErr := r.db.Query(ctx, roleQuery)
		stats := &UserStats{}
		if qErr == nil {
			for roleRows.Next() {
				var role string
				var count int
				if scanErr := roleRows.Scan(&role, &count); scanErr != nil {
					continue
				}
				switch role {
				case "admin":
					stats.Admins = count
				case "teacher":
					stats.Teachers = count
				case "student":
					stats.Students = count
				case "staff":
					stats.Staff = count
				}
			}
			roleRows.Close()
		}
		statsMap[s.ID] = stats
	}
	return schools, statsMap, total, nil
}

// GetByID returns a school by ID
func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*School, error) {
	query := `
		SELECT id, name, slug, code, address, email, created_at, updated_at 
		FROM schools WHERE id = $1
	`
	row := r.db.QueryRow(ctx, query, id)

	var s School
	if err := row.Scan(
		&s.ID, &s.Name, &s.Slug, &s.Code, &s.Address, &s.ContactEmail, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &s, nil
}

// GetBySlug returns a school by Slug
func (r *Repository) GetBySlug(ctx context.Context, slug string) (*School, error) {
	query := `
		SELECT id, name, slug, code, address, email, created_at, updated_at 
		FROM schools WHERE slug = $1
	`
	row := r.db.QueryRow(ctx, query, slug)

	var s School
	if err := row.Scan(
		&s.ID, &s.Name, &s.Slug, &s.Code, &s.Address, &s.ContactEmail, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *Repository) SchoolCodeExists(ctx context.Context, code string, excludeSchoolID *uuid.UUID) (bool, error) {
	if excludeSchoolID != nil {
		var exists bool
		err := r.db.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM schools
				WHERE UPPER(code) = UPPER($1)
				  AND id <> $2
			)
		`, code, *excludeSchoolID).Scan(&exists)
		return exists, err
	}

	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM schools
			WHERE UPPER(code) = UPPER($1)
		)
	`, code).Scan(&exists)
	return exists, err
}

// Helper to run transaction
func (r *Repository) WithTx(ctx context.Context, fn func(tx database.Tx) error) error {
	return r.db.WithTx(ctx, fn)
}

// Update updates the mutable fields of a school (name, address, email)
func (r *Repository) Update(ctx context.Context, id uuid.UUID, name, code, address, contactEmail string) (*School, error) {
	query := `
		UPDATE schools
		SET name        = $2,
		    code        = $3,
		    address     = $4,
		    email       = $5,
		    updated_at  = NOW()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, name, slug, code, address, email, created_at, updated_at
	`
	row := r.db.QueryRow(ctx, query, id, name, code, address, contactEmail)
	var s School
	if err := row.Scan(
		&s.ID, &s.Name, &s.Slug, &s.Code, &s.Address, &s.ContactEmail, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &s, nil
}

// Delete deletes a school by ID
func (r *Repository) Delete(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM schools WHERE id = $1`
	return r.db.Exec(ctx, query, id)
}

// DeleteUsersBySchoolID deletes all users associated with a school
func (r *Repository) DeleteUsersBySchoolID(ctx context.Context, schoolID uuid.UUID) error {
	schema := fmt.Sprintf("\"school_%s\"", schoolID)
	query := fmt.Sprintf(`DELETE FROM %s.users WHERE school_id = $1`, schema)
	return r.db.Exec(ctx, query, schoolID)
}

// SoftDelete marks a school as deleted without removing data
func (r *Repository) SoftDelete(ctx context.Context, schoolID, deletedBy uuid.UUID) error {
	query := `
		UPDATE schools 
		SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	return r.db.Exec(ctx, query, schoolID, deletedBy)
}

// Restore removes the soft delete marker from a school
func (r *Repository) Restore(ctx context.Context, schoolID uuid.UUID) error {
	query := `
		UPDATE schools 
		SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NOT NULL
	`
	return r.db.Exec(ctx, query, schoolID)
}

// GetDeletedSchools returns all soft-deleted schools
func (r *Repository) GetDeletedSchools(ctx context.Context) ([]School, error) {
	query := `
		SELECT 
			s.id, s.name, s.slug, s.address, s.email, 
			s.created_at, s.updated_at, s.deleted_at, s.deleted_by,
			sa.full_name as deleted_by_name
		FROM schools s
		LEFT JOIN super_admins sa ON s.deleted_by = sa.id
		WHERE s.deleted_at IS NOT NULL
		ORDER BY s.deleted_at DESC
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schools []School
	for rows.Next() {
		var s School
		var deletedByName *string
		if err := rows.Scan(
			&s.ID, &s.Name, &s.Slug, &s.Address, &s.ContactEmail,
			&s.CreatedAt, &s.UpdatedAt, &s.DeletedAt, &s.DeletedBy, &deletedByName,
		); err != nil {
			return nil, err
		}
		s.DeletedByName = deletedByName
		schools = append(schools, s)
	}
	return schools, nil
}

// GetSchoolsToCleanup returns schools deleted more than 24 hours ago
func (r *Repository) GetSchoolsToCleanup(ctx context.Context) ([]uuid.UUID, error) {
	query := `
		SELECT id 
		FROM schools 
		WHERE deleted_at IS NOT NULL 
		AND deleted_at < NOW() - INTERVAL '24 hours'
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GetStats returns user counts by role for a school
func (r *Repository) GetStats(ctx context.Context, schoolID uuid.UUID) (*UserStats, error) {
	schema := fmt.Sprintf("\"school_%s\"", schoolID)
	query := fmt.Sprintf(`
		SELECT role, COUNT(*)
		FROM %s.users
		WHERE school_id = $1
		GROUP BY role
	`, schema)
	rows, err := r.db.Query(ctx, query, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := &UserStats{}
	for rows.Next() {
		var role string
		var count int
		if err := rows.Scan(&role, &count); err != nil {
			continue
		}
		switch role {
		case "student":
			stats.Students = count
		case "teacher":
			stats.Teachers = count
		case "admin":
			stats.Admins = count
		case "staff":
			stats.Staff = count
		}
	}

	// Align staff count with staff profiles (non_teaching_staff) in tenant schema, if available
	staffCountQuery := fmt.Sprintf(`SELECT COUNT(*) FROM %s.non_teaching_staff`, schema)
	if err := r.db.QueryRow(ctx, staffCountQuery).Scan(&stats.Staff); err != nil {
		// If tenant schema/table isn't available, fallback to user role count already computed
	}
	return stats, nil
}

func (r *Repository) ListGlobalClasses(ctx context.Context) ([]GlobalClass, error) {
	query := `
		SELECT id, name, sort_order, created_at, updated_at
		FROM global_classes
		ORDER BY sort_order ASC, name ASC
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	classes := make([]GlobalClass, 0)
	for rows.Next() {
		var c GlobalClass
		if err := rows.Scan(&c.ID, &c.Name, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		classes = append(classes, c)
	}
	return classes, nil
}

func (r *Repository) CreateGlobalClass(ctx context.Context, c *GlobalClass) error {
	query := `
		INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW())
		RETURNING created_at, updated_at
	`
	return r.db.QueryRow(ctx, query, c.ID, c.Name, c.SortOrder).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *Repository) UpdateGlobalClass(ctx context.Context, classID uuid.UUID, c *GlobalClass) error {
	query := `
		UPDATE global_classes
		SET name = $2,
		    sort_order = $3,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING created_at, updated_at
	`
	return r.db.QueryRow(ctx, query, classID, c.Name, c.SortOrder).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *Repository) DeleteGlobalClass(ctx context.Context, classID uuid.UUID) error {
	return r.db.Exec(ctx, `DELETE FROM global_classes WHERE id = $1`, classID)
}

func (r *Repository) ReorderGlobalClasses(ctx context.Context, items []ReorderClassItem) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, item := range items {
		if _, err := tx.Exec(ctx,
			`UPDATE global_classes SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
			item.ID, item.SortOrder,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) ListGlobalSubjects(ctx context.Context) ([]GlobalSubject, error) {
	query := `
		SELECT id, name, code, created_at, updated_at
		FROM global_subjects
		ORDER BY name ASC
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	subjects := make([]GlobalSubject, 0)
	for rows.Next() {
		var s GlobalSubject
		if err := rows.Scan(&s.ID, &s.Name, &s.Code, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		subjects = append(subjects, s)
	}
	return subjects, nil
}

func (r *Repository) CreateGlobalSubject(ctx context.Context, s *GlobalSubject) error {
	query := `
		INSERT INTO global_subjects (id, name, code, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW())
		RETURNING created_at, updated_at
	`
	return r.db.QueryRow(ctx, query, s.ID, s.Name, s.Code).Scan(&s.CreatedAt, &s.UpdatedAt)
}

func (r *Repository) UpdateGlobalSubject(ctx context.Context, subjectID uuid.UUID, s *GlobalSubject) error {
	query := `
		UPDATE global_subjects
		SET name = $2,
		    code = $3,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING created_at, updated_at
	`
	return r.db.QueryRow(ctx, query, subjectID, s.Name, s.Code).Scan(&s.CreatedAt, &s.UpdatedAt)
}

func (r *Repository) DeleteGlobalSubject(ctx context.Context, subjectID uuid.UUID) error {
	return r.db.Exec(ctx, `DELETE FROM global_subjects WHERE id = $1`, subjectID)
}

func (r *Repository) ReplaceGlobalClassSubjects(ctx context.Context, classID uuid.UUID, subjectIDs []uuid.UUID) error {
	return r.db.WithTx(ctx, func(tx database.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM global_class_subjects WHERE class_id = $1`, classID); err != nil {
			return err
		}

		if len(subjectIDs) == 0 {
			return nil
		}

		insertQ := `
			INSERT INTO global_class_subjects (class_id, subject_id, created_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (class_id, subject_id) DO NOTHING
		`
		for _, subjectID := range subjectIDs {
			if _, err := tx.Exec(ctx, insertQ, classID, subjectID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) ListGlobalCatalogAssignments(ctx context.Context) ([]GlobalClassWithSubjects, error) {
	query := `
		SELECT
			c.id, c.name, c.sort_order, c.created_at, c.updated_at,
			s.id, s.name, s.code, s.created_at, s.updated_at
		FROM global_classes c
		LEFT JOIN global_class_subjects cs ON cs.class_id = c.id
		LEFT JOIN global_subjects s ON s.id = cs.subject_id
		ORDER BY c.sort_order ASC, c.name ASC, s.name ASC
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]GlobalClassWithSubjects, 0)
	indexByClass := make(map[uuid.UUID]int)

	for rows.Next() {
		var classRow GlobalClass
		var subjID *uuid.UUID
		var subjName *string
		var subjCode *string
		var subjCreatedAt *time.Time
		var subjUpdatedAt *time.Time

		if err := rows.Scan(
			&classRow.ID, &classRow.Name, &classRow.SortOrder, &classRow.CreatedAt, &classRow.UpdatedAt,
			&subjID, &subjName, &subjCode, &subjCreatedAt, &subjUpdatedAt,
		); err != nil {
			return nil, err
		}

		pos, exists := indexByClass[classRow.ID]
		if !exists {
			result = append(result, GlobalClassWithSubjects{
				Class:    classRow,
				Subjects: make([]GlobalSubject, 0),
			})
			pos = len(result) - 1
			indexByClass[classRow.ID] = pos
		}

		if subjID != nil && subjName != nil {
			subject := GlobalSubject{
				ID:   *subjID,
				Name: strings.TrimSpace(*subjName),
			}
			if subjCode != nil {
				subject.Code = strings.TrimSpace(*subjCode)
			}
			if subjCreatedAt != nil {
				subject.CreatedAt = *subjCreatedAt
			}
			if subjUpdatedAt != nil {
				subject.UpdatedAt = *subjUpdatedAt
			}
			result[pos].Subjects = append(result[pos].Subjects, subject)
		}
	}

	return result, nil
}

// GetMonthlyNewUsers aggregates new user counts (by role) per month across all tenant schemas.
func (r *Repository) GetMonthlyNewUsers(ctx context.Context, year int) ([]MonthlyUserStat, error) {
	// Initialise all 12 months with zeros so the caller always gets a full year
	stats := make([]MonthlyUserStat, 12)
	for i := range stats {
		stats[i] = MonthlyUserStat{MonthNum: i + 1}
	}

	schools, err := r.GetAll(ctx)
	if err != nil {
		return nil, err
	}

	// Aggregate tenant users (students, teachers, admins)
	if len(schools) > 0 {
		var parts []string
		for _, s := range schools {
			schema := fmt.Sprintf(`"school_%s"`, s.ID)
			parts = append(parts, fmt.Sprintf(`SELECT created_at, role FROM %s.users`, schema))
		}
		union := strings.Join(parts, " UNION ALL ")

		query := fmt.Sprintf(`
			SELECT
				EXTRACT(MONTH FROM created_at)::int AS month_num,
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE role = 'student') AS students,
				COUNT(*) FILTER (WHERE role = 'teacher') AS teachers,
				COUNT(*) FILTER (WHERE role = 'admin') AS admins
			FROM (%s) t
			WHERE EXTRACT(YEAR FROM created_at) = $1
			GROUP BY month_num
			ORDER BY month_num
		`, union)

		rows, err := r.db.Query(ctx, query, year)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		for rows.Next() {
			var monthNum, total, students, teachers, admins int
			if err := rows.Scan(&monthNum, &total, &students, &teachers, &admins); err != nil {
				return nil, err
			}
			if monthNum >= 1 && monthNum <= 12 {
				stats[monthNum-1].MonthNum = monthNum
				stats[monthNum-1].Students = students
				stats[monthNum-1].Teachers = teachers
				stats[monthNum-1].Admins = admins
				stats[monthNum-1].Total += total
			}
		}
	}

	// Aggregate super admins from public.super_admins
	superQuery := `
		SELECT
			EXTRACT(MONTH FROM created_at)::int AS month_num,
			COUNT(*) AS cnt
		FROM public.super_admins
		WHERE EXTRACT(YEAR FROM created_at) = $1
		GROUP BY month_num
	`
	superRows, err := r.db.Query(ctx, superQuery, year)
	if err != nil {
		return nil, err
	}
	defer superRows.Close()

	for superRows.Next() {
		var monthNum, cnt int
		if err := superRows.Scan(&monthNum, &cnt); err != nil {
			return nil, err
		}
		if monthNum >= 1 && monthNum <= 12 {
			stats[monthNum-1].SuperAdmins += cnt
			stats[monthNum-1].Total += cnt
		}
	}

	return stats, nil
}

// GetGlobalSetting returns the value for a key from public.global_settings.
func (r *Repository) GetGlobalSetting(ctx context.Context, key string) (string, error) {
	var value string
	if err := r.db.QueryRow(ctx, `SELECT value FROM public.global_settings WHERE key = $1`, key).Scan(&value); err != nil {
		return "", fmt.Errorf("GetGlobalSetting(%q): %w", key, err)
	}
	return value, nil
}

// SetGlobalSetting upserts a value in public.global_settings.
func (r *Repository) GetAllSchemaNames(ctx context.Context) ([]string, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT schema_name FROM information_schema.schemata
		WHERE schema_name = 'public'
		   OR schema_name ~ '^school_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		ORDER BY CASE WHEN schema_name = 'public' THEN 0 ELSE 1 END, schema_name`)
	if err != nil {
		return nil, fmt.Errorf("query schema names: %w", err)
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, nil
}

func (r *Repository) GetSchemaIntrospection(ctx context.Context, schemaName string) (*SchemaResponse, error) {
	result := &SchemaResponse{SchemaName: schemaName}

	// Get all tables
	tableRows, err := r.db.Pool.Query(ctx, `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = $1 AND table_type = 'BASE TABLE'
		ORDER BY table_name`, schemaName)
	if err != nil {
		return nil, fmt.Errorf("query tables: %w", err)
	}
	defer tableRows.Close()

	var tableNames []string
	for tableRows.Next() {
		var name string
		if err := tableRows.Scan(&name); err != nil {
			return nil, err
		}
		tableNames = append(tableNames, name)
	}

	// Get columns + PK info for all tables in one query
	colRows, err := r.db.Pool.Query(ctx, `
		SELECT
			c.table_name,
			c.column_name,
			c.data_type,
			c.is_nullable = 'YES' AS nullable,
			EXISTS (
				SELECT 1 FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu
					ON tc.constraint_name = kcu.constraint_name
					AND tc.table_schema = kcu.table_schema
				WHERE tc.constraint_type = 'PRIMARY KEY'
				AND tc.table_schema = $1
				AND tc.table_name = c.table_name
				AND kcu.column_name = c.column_name
			) AS is_pk
		FROM information_schema.columns c
		WHERE c.table_schema = $1
		ORDER BY c.table_name, c.ordinal_position`, schemaName)
	if err != nil {
		return nil, fmt.Errorf("query columns: %w", err)
	}
	defer colRows.Close()

	colsByTable := make(map[string][]SchemaColumn)
	for colRows.Next() {
		var tableName string
		var col SchemaColumn
		if err := colRows.Scan(&tableName, &col.Name, &col.Type, &col.Nullable, &col.IsPK); err != nil {
			return nil, err
		}
		colsByTable[tableName] = append(colsByTable[tableName], col)
	}

	for _, tn := range tableNames {
		result.Tables = append(result.Tables, SchemaTable{
			Name:    tn,
			Columns: colsByTable[tn],
		})
	}

	// Get FK relationships via pg_catalog — more reliable than information_schema for
	// cross-schema FKs (information_schema.constraint_column_usage requires REFERENCES
	// privilege on the referenced table; pg_catalog has no such restriction).
	// Un-nesting conkey/confkey handles composite FKs correctly.
	fkRows, err := r.db.Pool.Query(ctx, `
		SELECT
			c.conname                                      AS constraint_name,
			src.relname                                    AS source_table,
			att_src.attname                                AS source_column,
			ns_tgt.nspname                                 AS target_schema,
			tgt.relname                                    AS target_table,
			att_tgt.attname                                AS target_column
		FROM   pg_catalog.pg_constraint c
		JOIN   pg_catalog.pg_namespace  ns     ON ns.oid     = c.connamespace
		JOIN   pg_catalog.pg_class      src    ON src.oid    = c.conrelid
		JOIN   pg_catalog.pg_class      tgt    ON tgt.oid    = c.confrelid
		JOIN   pg_catalog.pg_namespace  ns_tgt ON ns_tgt.oid = tgt.relnamespace
		-- unnest parallel arrays of key column positions in one lateral step
		JOIN   LATERAL unnest(c.conkey, c.confkey) AS k(sk, tk) ON true
		JOIN   pg_catalog.pg_attribute  att_src
			   ON att_src.attrelid = c.conrelid  AND att_src.attnum = k.sk
		JOIN   pg_catalog.pg_attribute  att_tgt
			   ON att_tgt.attrelid = c.confrelid AND att_tgt.attnum = k.tk
		WHERE  c.contype  = 'f'
		AND    ns.nspname = $1
		ORDER  BY c.conname, k.sk`, schemaName)
	if err != nil {
		return nil, fmt.Errorf("query foreign keys: %w", err)
	}
	defer fkRows.Close()

	for fkRows.Next() {
		var fk SchemaFK
		if err := fkRows.Scan(&fk.ConstraintName, &fk.SourceTable, &fk.SourceColumn, &fk.TargetSchema, &fk.TargetTable, &fk.TargetColumn); err != nil {
			return nil, err
		}
		result.ForeignKeys = append(result.ForeignKeys, fk)
	}

	return result, nil
}

// GetSchoolNamesMap returns a map of school UUID string → school name for all active schools.
func (r *Repository) GetSchoolNamesMap(ctx context.Context) (map[string]string, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT id::text, name FROM public.schools WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := make(map[string]string)
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			continue
		}
		m[id] = name
	}
	return m, nil
}

func (r *Repository) GetSchemaSizes(ctx context.Context) (map[string]int64, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT
			n.nspname AS schema_name,
			COALESCE(
				SUM(
					CASE
						WHEN c.relkind IN ('r', 'm', 't') THEN pg_total_relation_size(c.oid)
						ELSE 0
					END
				),
				0
			)::bigint AS total_bytes
		FROM pg_namespace n
		LEFT JOIN pg_class c
			ON c.relnamespace = n.oid
		WHERE n.nspname = 'public'
		   OR n.nspname ~ '^school_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		GROUP BY n.nspname
		ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, n.nspname
	`)
	if err != nil {
		return nil, fmt.Errorf("query schema sizes: %w", err)
	}
	defer rows.Close()

	result := make(map[string]int64)
	for rows.Next() {
		var schemaName string
		var totalBytes int64
		if err := rows.Scan(&schemaName, &totalBytes); err != nil {
			return nil, err
		}
		result[schemaName] = totalBytes
	}
	return result, nil
}

func (r *Repository) SetGlobalSetting(ctx context.Context, key, value string) error {
	if err := r.db.Exec(ctx, `
		INSERT INTO public.global_settings (key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
	`, key, value); err != nil {
		return fmt.Errorf("SetGlobalSetting(%q): %w", key, err)
	}
	return nil
}

func (r *Repository) ListDocumentStorageKeys(ctx context.Context, schools []School) ([]storageKeyRecord, error) {
	records := make([]storageKeyRecord, 0, 1024)

	platformMaterialRows, err := r.db.Pool.Query(ctx, `
		SELECT storage_key
		FROM public.super_admin_study_materials
		WHERE COALESCE(TRIM(storage_key), '') <> ''
	`)
	if err != nil {
		return nil, fmt.Errorf("list platform study material storage keys: %w", err)
	}
	defer platformMaterialRows.Close()
	for platformMaterialRows.Next() {
		var key string
		if scanErr := platformMaterialRows.Scan(&key); scanErr != nil {
			return nil, fmt.Errorf("scan platform study material storage key: %w", scanErr)
		}
		records = append(records, storageKeyRecord{Collection: "superadmin/materials", StorageKey: strings.TrimSpace(key)})
	}
	if err := platformMaterialRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate platform study material storage keys: %w", err)
	}

	platformQuestionRows, err := r.db.Pool.Query(ctx, `
		SELECT storage_key
		FROM public.super_admin_question_documents
		WHERE COALESCE(TRIM(storage_key), '') <> ''
	`)
	if err != nil {
		return nil, fmt.Errorf("list platform question document storage keys: %w", err)
	}
	defer platformQuestionRows.Close()
	for platformQuestionRows.Next() {
		var key string
		if scanErr := platformQuestionRows.Scan(&key); scanErr != nil {
			return nil, fmt.Errorf("scan platform question document storage key: %w", scanErr)
		}
		records = append(records, storageKeyRecord{Collection: "superadmin/questions", StorageKey: strings.TrimSpace(key)})
	}
	if err := platformQuestionRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate platform question document storage keys: %w", err)
	}

	for _, school := range schools {
		schema := fmt.Sprintf("\"school_%s\"", school.ID.String())
		materialsQuery := fmt.Sprintf(`
			SELECT storage_key
			FROM %s.study_materials
			WHERE COALESCE(TRIM(storage_key), '') <> ''
		`, schema)
		rows, qErr := r.db.Pool.Query(ctx, materialsQuery)
		if qErr != nil {
			var pgErr *pgconn.PgError
			if (errors.As(qErr, &pgErr) && pgErr.Code == "42P01") || strings.Contains(strings.ToLower(qErr.Error()), "does not exist") {
			} else {
				return nil, fmt.Errorf("list tenant study material storage keys for %s: %w", school.ID.String(), qErr)
			}
		} else {
			for rows.Next() {
				var key string
				if scanErr := rows.Scan(&key); scanErr != nil {
					rows.Close()
					return nil, fmt.Errorf("scan tenant study material storage key for %s: %w", school.ID.String(), scanErr)
				}
				records = append(records, storageKeyRecord{Collection: "schools/materials", StorageKey: strings.TrimSpace(key)})
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return nil, fmt.Errorf("iterate tenant study material storage keys for %s: %w", school.ID.String(), err)
			}
			rows.Close()
		}

		questionsQuery := fmt.Sprintf(`
			SELECT storage_key
			FROM %s.question_documents
			WHERE COALESCE(TRIM(storage_key), '') <> ''
		`, schema)
		questionRows, qErr := r.db.Pool.Query(ctx, questionsQuery)
		if qErr != nil {
			var pgErr *pgconn.PgError
			if (errors.As(qErr, &pgErr) && pgErr.Code == "42P01") || strings.Contains(strings.ToLower(qErr.Error()), "does not exist") {
				continue
			}
			return nil, fmt.Errorf("list tenant question document storage keys for %s: %w", school.ID.String(), qErr)
		}
		for questionRows.Next() {
			var key string
			if scanErr := questionRows.Scan(&key); scanErr != nil {
				questionRows.Close()
				return nil, fmt.Errorf("scan tenant question document storage key for %s: %w", school.ID.String(), scanErr)
			}
			records = append(records, storageKeyRecord{Collection: "schools/questions", StorageKey: strings.TrimSpace(key)})
		}
		if err := questionRows.Err(); err != nil {
			questionRows.Close()
			return nil, fmt.Errorf("iterate tenant question document storage keys for %s: %w", school.ID.String(), err)
		}
		questionRows.Close()
	}

	return records, nil
}
