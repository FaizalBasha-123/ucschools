package database

import (
	"context"
	"log"
)

// RunAdminMigrations creates admin/finance related tables
func (db *PostgresDB) RunAdminMigrations(ctx context.Context) error {
	log.Println("Running admin/finance migrations...")

	// Fee structures table
	feeStructuresTable := `
		CREATE TABLE IF NOT EXISTS fee_structures (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			applicable_grades INT[],
			academic_year VARCHAR(20) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_fee_structures_academic_year ON fee_structures(academic_year);
	`
	if err := db.Exec(ctx, feeStructuresTable); err != nil {
		return err
	}
	// Backward-compatible: add school_id if older schema exists.
	db.Exec(ctx, "ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_fee_structures_school_id ON fee_structures(school_id);")
	log.Println("✓ fee_structures table ready")

	// Fee items table
	feeItemsTable := `
		CREATE TABLE IF NOT EXISTS fee_items (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			fee_structure_id UUID NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			amount DECIMAL(10,2) NOT NULL,
			frequency VARCHAR(20) DEFAULT 'monthly' CHECK (frequency IN ('one_time', 'monthly', 'quarterly', 'yearly')),
			is_optional BOOLEAN DEFAULT FALSE,
			due_day INT DEFAULT 10,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_fee_items_structure_id ON fee_items(fee_structure_id);
	`
	if err := db.Exec(ctx, feeItemsTable); err != nil {
		return err
	}
	log.Println("✓ fee_items table ready")

	// Student fees table (assigned fees)
	studentFeesTable := `
		CREATE TABLE IF NOT EXISTS student_fees (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID,
			student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
			fee_item_id UUID NOT NULL REFERENCES fee_items(id),
			amount DECIMAL(10,2) NOT NULL,
			due_date DATE NOT NULL,
			status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partial', 'overdue', 'waived')),
			paid_amount DECIMAL(10,2) DEFAULT 0,
			waiver_amount DECIMAL(10,2) DEFAULT 0,
			waiver_reason TEXT,
			academic_year VARCHAR(20) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_student_fees_student_id ON student_fees(student_id);
		CREATE INDEX IF NOT EXISTS idx_student_fees_status ON student_fees(status);
		CREATE INDEX IF NOT EXISTS idx_student_fees_due_date ON student_fees(due_date);
	`
	if err := db.Exec(ctx, studentFeesTable); err != nil {
		return err
	}
	db.Exec(ctx, "ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_student_fees_school_id ON student_fees(school_id);")
	log.Println("✓ student_fees table ready")

	// Payments table
	paymentsTable := `
		CREATE TABLE IF NOT EXISTS payments (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID,
			student_id UUID NOT NULL REFERENCES students(id),
			student_fee_id UUID REFERENCES student_fees(id),
			amount DECIMAL(10,2) NOT NULL,
			payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('cash', 'card', 'upi', 'bank_transfer', 'cheque', 'online')),
			transaction_id VARCHAR(255),
			receipt_number VARCHAR(100) UNIQUE,
			payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
			notes TEXT,
			collected_by UUID REFERENCES users(id),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);
		CREATE INDEX IF NOT EXISTS idx_payments_receipt ON payments(receipt_number);
		CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
	`
	if err := db.Exec(ctx, paymentsTable); err != nil {
		return err
	}
	db.Exec(ctx, "ALTER TABLE payments ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_payments_school_id ON payments(school_id);")
	log.Println("✓ payments table ready")

	// Audit logs table
	auditLogsTable := `
		CREATE TABLE IF NOT EXISTS audit_logs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID,
			user_id UUID REFERENCES users(id),
			action VARCHAR(100) NOT NULL,
			entity_type VARCHAR(100) NOT NULL,
			entity_id UUID,
			old_values JSONB,
			new_values JSONB,
			ip_address VARCHAR(50),
			user_agent TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
		CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
	`
	if err := db.Exec(ctx, auditLogsTable); err != nil {
		return err
	}
	db.Exec(ctx, "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_audit_logs_school_id ON audit_logs(school_id);")
	log.Println("✓ audit_logs table ready")

	// Settings table
	settingsTable := `
		CREATE TABLE IF NOT EXISTS settings (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			school_id UUID,
			key VARCHAR(255) UNIQUE NOT NULL,
			value TEXT NOT NULL,
			description TEXT,
			category VARCHAR(100),
			is_public BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
		CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
	`
	if err := db.Exec(ctx, settingsTable); err != nil {
		return err
	}
	db.Exec(ctx, "ALTER TABLE settings ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;")
	db.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_settings_school_id ON settings(school_id);")
	log.Println("✓ settings table ready")

	log.Println("All admin/finance migrations completed!")
	return nil
}
