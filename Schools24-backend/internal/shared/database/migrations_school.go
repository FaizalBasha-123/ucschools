package database

import (
	"context"
	"log"
)

// RunSchoolMigrations creates school related tables and alters users table
func (db *PostgresDB) RunSchoolMigrations(ctx context.Context) error {
	log.Println("Running school migrations...")

	// Schools table
	schoolsTable := `
		CREATE TABLE IF NOT EXISTS schools (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) UNIQUE NOT NULL,
			address TEXT,
			contact_email VARCHAR(255),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_schools_name ON schools(name);
	`
	if err := db.Exec(ctx, schoolsTable); err != nil {
		return err
	}
	log.Println("✓ schools table ready")

	// Add school_id to users if not exists
	alterUsers := `
		ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
		CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
	`
	if err := db.Exec(ctx, alterUsers); err != nil {
		return err
	}
	log.Println("✓ users table altered with school_id")

	log.Println("All school migrations completed!")
	return nil
}
