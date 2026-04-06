package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
)

// CreateSchoolSchema creates a new isolated schema for a school
func (db *PostgresDB) CreateSchoolSchema(ctx context.Context, schoolID uuid.UUID) error {
	schemaName := fmt.Sprintf("school_%s", schoolID.String())
	// Sanitize schema name to prevent SQL injection (though UUID is safe)
	safeSchemaName := "\"" + schemaName + "\""

	query := fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s", safeSchemaName)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		return fmt.Errorf("failed to create schema %s: %w", schemaName, err)
	}

	// Run tenant migrations on this new schema
	return db.RunTenantMigrations(ctx, schemaName)
}

// EnsureAllTenantMigrations runs RunTenantMigrations for every school that exists in
// public.schools. It is safe to call on startup — schema_migrations tracks which SQL
// files have already been applied so nothing is re-run. This ensures schemas created
// before a new migration file was added pick up the new tables/columns.
func (db *PostgresDB) EnsureAllTenantMigrations(ctx context.Context) error {
	rows, err := db.Pool.Query(ctx, "SELECT id FROM public.schools WHERE deleted_at IS NULL")
	if err != nil {
		return fmt.Errorf("EnsureAllTenantMigrations: fetch schools: %w", err)
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			log.Printf("EnsureAllTenantMigrations: scan error: %v", err)
			continue
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("EnsureAllTenantMigrations: rows error: %w", err)
	}

	log.Printf("EnsureAllTenantMigrations: applying pending tenant migrations to %d school(s)", len(ids))
	for _, id := range ids {
		schemaName := fmt.Sprintf("school_%s", id.String())
		if err := db.RunTenantMigrations(ctx, schemaName); err != nil {
			// Non-fatal: log and continue so one bad schema doesn\'t block others.
			log.Printf("EnsureAllTenantMigrations: WARNING schema %s: %v", schemaName, err)
		} // Always run column-width repair directly on the pool — no search_path,
		// no migration tracking, fully schema-qualified. This is idempotent and
		// fixes schools where migration 053 was recorded as applied but the ALTER
		// TABLE actually never ran (silent EXCEPTION WHEN OTHERS swallowed it).
		if err := db.widenAdmissionColumnsDirectly(ctx, schemaName); err != nil {
			log.Printf("EnsureAllTenantMigrations: WARNING widen columns for %s: %v", schemaName, err)
		}
	}
	return nil
}

// widenAdmissionColumnsDirectly runs ALTER TABLE directly on the pool using
// fully schema-qualified names — no search_path, no migration tracking, no
// tenant-aware wrapper. Safe to call repeatedly: widening a column that is
// already the target type is a no-op in PostgreSQL.
func (db *PostgresDB) widenAdmissionColumnsDirectly(ctx context.Context, schemaName string) error {
	// Quoted schema identifier safe for use as a SQL identifier.
	quotedSchema := `"` + schemaName + `"`
	sql := fmt.Sprintf(`
ALTER TABLE IF EXISTS %s.admission_applications
    ALTER COLUMN academic_year  TYPE TEXT,
    ALTER COLUMN blood_group    TYPE VARCHAR(20),
    ALTER COLUMN aadhaar_number TYPE VARCHAR(50),
    ALTER COLUMN pincode        TYPE VARCHAR(20);
`, quotedSchema)
	// Use Pool.Exec directly — NOT the tenant-aware Exec wrapper — so there
	// is NO search_path SET before the statement. The schema-qualified table
	// name resolves without search_path.
	_, err := db.Pool.Exec(ctx, sql)
	if err != nil {
		return fmt.Errorf("widen admission columns in %s: %w", schemaName, err)
	}
	return nil
}

// RunTenantMigrations applies migrations from 'migrations/tenant' to a specific schema
func (db *PostgresDB) RunTenantMigrations(ctx context.Context, schemaName string) error {
	log.Printf("Running tenant migrations for schema: %s", schemaName)

	// Set search_path for the migration transaction
	// Note: We need to be careful. The migration library might not support dynamic schemas easily.
	// We might need to manually execute the SQL files for now or use a migration tool that supports this.
	// Given the simplicity, we'll read SQL files and execute them.

	migrationDir := "migrations/tenant"
	files, err := os.ReadDir(migrationDir)
	if err != nil {
		return fmt.Errorf("failed to read tenant migrations directory: %w", err)
	}

	var sqlFiles []string
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".sql") {
			sqlFiles = append(sqlFiles, f.Name())
		}
	}
	sort.Strings(sqlFiles)

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Set search_path for this transaction.
	// IMPORTANT: Use SET LOCAL (not SET) so the scope is limited to this transaction.
	// With Neon's PgBouncer in transaction-pooling mode, a session-scoped SET would
	// persist on the connection after commit and affect the next tenant that reuses it.
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL search_path TO \"%s\", public", schemaName)); err != nil {
		return fmt.Errorf("failed to set search_path: %w", err)
	}

	// Create schema_migrations table in this schema if not exists
	_, err = tx.Exec(ctx, `
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	// Bootstrap tenant users table before file-based migrations.
	// Some older tenant migrations reference users before 014_create_users_tenant.sql.
	_, err = tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			role VARCHAR(50) NOT NULL,
			full_name VARCHAR(255) NOT NULL,
			phone VARCHAR(20),
			profile_picture_url TEXT,
			is_active BOOLEAN DEFAULT true,
			email_verified BOOLEAN DEFAULT false,
			last_login_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			school_id UUID,
			CONSTRAINT users_role_check CHECK (role IN ('admin', 'teacher', 'student', 'staff', 'parent'))
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to bootstrap tenant users table: %w", err)
	}

	_, err = tx.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users(lower(email));
		CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
		CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
		CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
	`)
	if err != nil {
		return fmt.Errorf("failed to bootstrap tenant users indexes: %w", err)
	}

	// Iterate and apply
	for _, file := range sqlFiles {
		// Check if applied
		var exists bool
		err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", file).Scan(&exists)
		if err != nil {
			return err
		}
		if exists {
			continue
		}

		content, err := os.ReadFile(filepath.Join(migrationDir, file))
		if err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, string(content)); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", file, err)
		}

		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", file); err != nil {
			return err
		}
		log.Printf("Applied tenant migration: %s to schema %s", file, schemaName)
	}

	return tx.Commit(ctx)
}

// DropSchoolSchema drops a school's tenant schema and all its data
// WARNING: This is a destructive operation that cannot be undone
func (db *PostgresDB) DropSchoolSchema(ctx context.Context, schoolID uuid.UUID) error {
	schemaName := fmt.Sprintf("school_%s", schoolID.String())
	safeSchemaName := "\"" + schemaName + "\""

	query := fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", safeSchemaName)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		return fmt.Errorf("failed to drop schema %s: %w", schemaName, err)
	}

	log.Printf("Dropped tenant schema: %s", schemaName)
	return nil
}
