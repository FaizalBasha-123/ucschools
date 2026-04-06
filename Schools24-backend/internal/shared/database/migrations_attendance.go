package database

import (
	"context"
	"log"
)

// RunAttendanceMigrations creates attendance session table
func (db *PostgresDB) RunAttendanceMigrations(ctx context.Context) error {
	log.Println("Running attendance photo migrations...")

	// Attendance sessions table
	attendanceSessionsTable := `
		CREATE TABLE IF NOT EXISTS attendance_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
			teacher_id UUID NOT NULL REFERENCES teachers(id),
			date DATE NOT NULL,
			photo_url TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(class_id, date)
		);

		CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions(date);
	`
	if err := db.Exec(ctx, attendanceSessionsTable); err != nil {
		return err
	}
	log.Println("✓ attendance_sessions table ready")

	log.Println("All attendance migrations completed!")
	return nil
}
