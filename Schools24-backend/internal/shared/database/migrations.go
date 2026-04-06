package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RunGlobalMigrations applies migrations from 'migrations/global' to the public schema
func (db *PostgresDB) RunGlobalMigrations(ctx context.Context) error {
	log.Println("Running global migrations...")

	migrationDir := "migrations/global"

	// Ensure directory exists
	if _, err := os.Stat(migrationDir); os.IsNotExist(err) {
		return fmt.Errorf("global migration directory %s does not exist", migrationDir)
	}

	files, err := os.ReadDir(migrationDir)
	if err != nil {
		return fmt.Errorf("failed to read global migrations directory: %w", err)
	}

	var sqlFiles []string
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".sql") {
			sqlFiles = append(sqlFiles, f.Name())
		}
	}
	sort.Strings(sqlFiles)

	// Ensure migration table exists in public schema
	createTableQuery := `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
	`
	if err := db.Exec(ctx, createTableQuery); err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	for _, file := range sqlFiles {
		var exists bool
		query := "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)"
		if err := db.QueryRow(ctx, query, file).Scan(&exists); err != nil {
			return fmt.Errorf("failed to check migration status for %s: %w", file, err)
		}

		if exists {
			continue // Skip applied migrations
		}

		log.Printf("Applying global migration: %s", file)
		content, err := os.ReadFile(filepath.Join(migrationDir, file))
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", file, err)
		}

		// Execute migration in a transaction
		if err := db.WithTx(ctx, func(tx Tx) error {
			if _, err := tx.Exec(ctx, string(content)); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", file); err != nil {
				return err
			}
			return nil
		}); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", file, err)
		}
	}

	log.Println("Global migrations completed successfully!")
	return nil
}

// Deprecated: Use RunGlobalMigrations or RunTenantMigrations
func (db *PostgresDB) RunMigrations(ctx context.Context) error {
	return db.RunGlobalMigrations(ctx) // Redirect for backward compatibility if missed call sites
}

// Helper to check if file exists
func fileExists(filename string) bool {
	info, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}
