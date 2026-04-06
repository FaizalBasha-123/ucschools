package database

import (
	"context"
	"log"
)

// RunTeacherMigrations creates teacher-related tables
func (db *PostgresDB) RunTeacherMigrations(ctx context.Context) error {
	log.Println("Running teacher-related migrations...")

	// Teacher-class assignments (which teacher teaches which class/subject)
	teacherAssignmentsTable := `
		CREATE TABLE IF NOT EXISTS teacher_assignments (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
			class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
			subject_id UUID REFERENCES subjects(id),
			is_class_teacher BOOLEAN DEFAULT FALSE,
			academic_year VARCHAR(20) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(teacher_id, class_id, subject_id, academic_year)
		);

		CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_id ON teacher_assignments(teacher_id);
		CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class_id ON teacher_assignments(class_id);
	`
	if err := db.Exec(ctx, teacherAssignmentsTable); err != nil {
		return err
	}
	log.Println("✓ teacher_assignments table ready")

	// Announcements table (teachers can post announcements)
	announcementsTable := `
		CREATE TABLE IF NOT EXISTS announcements (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			title VARCHAR(255) NOT NULL,
			content TEXT NOT NULL,
			author_id UUID NOT NULL REFERENCES users(id),
			target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('all', 'class', 'grade', 'teachers', 'parents')),
			target_id UUID,
			priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
			is_pinned BOOLEAN DEFAULT FALSE,
			expires_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_announcements_author_id ON announcements(author_id);
		CREATE INDEX IF NOT EXISTS idx_announcements_target_type ON announcements(target_type);
		CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);
	`
	if err := db.Exec(ctx, announcementsTable); err != nil {
		return err
	}
	log.Println("✓ announcements table ready")

	// Messages table (teacher-parent communication)
	messagesTable := `
		CREATE TABLE IF NOT EXISTS messages (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			sender_id UUID NOT NULL REFERENCES users(id),
			recipient_id UUID NOT NULL REFERENCES users(id),
			subject VARCHAR(255),
			content TEXT NOT NULL,
			is_read BOOLEAN DEFAULT FALSE,
			read_at TIMESTAMP,
			parent_id UUID REFERENCES messages(id),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
		CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
		CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
	`
	if err := db.Exec(ctx, messagesTable); err != nil {
		return err
	}
	log.Println("✓ messages table ready")

	log.Println("All teacher migrations completed!")
	return nil
}
