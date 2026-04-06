package database

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
)

// MigrateDataToTenantSchema copies school-specific data from public schema to tenant schema
func (db *PostgresDB) MigrateDataToTenantSchema(ctx context.Context, schoolID uuid.UUID) error {
	schemaName := fmt.Sprintf("school_%s", schoolID)
	safeSchema := "\"" + schemaName + "\""

	log.Printf("Starting data migration to tenant schema: %s", schemaName)

	// Ensure search_path is set for this connection
	_, err := db.Pool.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", safeSchema))
	if err != nil {
		return fmt.Errorf("failed to set search_path: %w", err)
	}

	// Begin transaction
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	columnExistsInSchema := func(schema, tableName, columnName string) bool {
		var exists bool
		err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = $1
				  AND table_name = $2
				  AND column_name = $3
			)
		`, schema, tableName, columnName).Scan(&exists)
		if err != nil {
			return false
		}
		return exists
	}

	tableExistsInSchema := func(schema, tableName string) bool {
		var exists bool
		err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.tables
				WHERE table_schema = $1
				  AND table_name = $2
			)
		`, schema, tableName).Scan(&exists)
		if err != nil {
			return false
		}
		return exists
	}

	// 1. Keep tenant users isolated to the current school
	log.Printf("Ensuring tenant users isolation for school: %s", schoolID)
	_, err = tx.Exec(ctx, fmt.Sprintf(`
		DELETE FROM %s.users
		WHERE school_id IS DISTINCT FROM $1
	`, safeSchema), schoolID)
	if err != nil {
		return fmt.Errorf("failed to enforce tenant users isolation: %w", err)
	}

	// 2. Migrate Teachers
	log.Printf("Migrating teachers for school: %s", schoolID)
	_, err = tx.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s.teachers (
			id, school_id, user_id, employee_id, designation,
			qualification, qualifications, experience_years, salary,
			hire_date, subjects, subjects_taught, rating, status, created_at, updated_at
		)
		SELECT
			id, school_id, user_id, employee_id, NULL,
			qualification,
			CASE WHEN qualification IS NULL THEN NULL ELSE ARRAY[qualification] END,
			experience_years, salary,
			hire_date, subjects, subjects, rating, COALESCE(status, 'active'), created_at, updated_at
		FROM public.teachers
		WHERE school_id = $1
		ON CONFLICT (id) DO UPDATE SET
			designation = EXCLUDED.designation,
			qualification = EXCLUDED.qualification,
			qualifications = EXCLUDED.qualifications,
			subjects_taught = EXCLUDED.subjects_taught,
			salary = EXCLUDED.salary,
			rating = EXCLUDED.rating,
			status = EXCLUDED.status,
			updated_at = EXCLUDED.updated_at
	`, safeSchema), schoolID)
	if err != nil {
		return fmt.Errorf("failed to migrate teachers: %w", err)
	}

	// 3. Migrate Non-teaching Staff
	log.Printf("Migrating staff for school: %s", schoolID)
	_, _ = tx.Exec(ctx, "SAVEPOINT sp_staff")
	targetHasDepartment := columnExistsInSchema(schemaName, "non_teaching_staff", "department")
	sourceHasDepartment := columnExistsInSchema("public", "non_teaching_staff", "department")
	if targetHasDepartment && sourceHasDepartment {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.non_teaching_staff (id, school_id, user_id, employee_id, department, designation, qualification, experience_years, salary, hire_date, created_at, updated_at)
			SELECT id, school_id, user_id, employee_id, department, designation, qualification, experience_years, salary, hire_date, created_at, updated_at
			FROM public.non_teaching_staff
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				department = EXCLUDED.department,
				designation = EXCLUDED.designation,
				salary = EXCLUDED.salary,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	} else {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.non_teaching_staff (id, school_id, user_id, employee_id, designation, qualification, experience_years, salary, hire_date, created_at, updated_at)
			SELECT id, school_id, user_id, employee_id, designation, qualification, experience_years, salary, hire_date, created_at, updated_at
			FROM public.non_teaching_staff
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				designation = EXCLUDED.designation,
				salary = EXCLUDED.salary,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	}
	if err != nil {
		log.Printf("Warning: Failed to migrate staff for school %s: %v", schoolID, err)
		_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_staff")
	} else {
		_, _ = tx.Exec(ctx, "RELEASE SAVEPOINT sp_staff")
	}

	// 4. Migrate Classes
	log.Printf("Migrating classes for school: %s", schoolID)
	_, err = tx.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s.classes (
			id, school_id, name, grade, section, academic_year,
			total_students, room_number, class_teacher_id, created_at, updated_at
		)
		SELECT DISTINCT ON (school_id, grade, section, academic_year)
			id, school_id, name, grade, section, academic_year,
			total_students, room_number, class_teacher_id, created_at, updated_at
		FROM public.classes
		WHERE school_id = $1
		ORDER BY school_id, grade, section, academic_year, updated_at DESC NULLS LAST, created_at DESC
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			total_students = EXCLUDED.total_students,
			room_number = EXCLUDED.room_number,
			class_teacher_id = EXCLUDED.class_teacher_id,
			updated_at = EXCLUDED.updated_at
	`, safeSchema), schoolID)
	if err != nil {
		return fmt.Errorf("failed to migrate classes: %w", err)
	}

	// 5. Migrate Students
	if tableExistsInSchema("public", "students") {
		log.Printf("Migrating students for school: %s", schoolID)
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.students (id, school_id, user_id, admission_number, roll_number, class_id, section, date_of_birth, gender, blood_group, address, parent_name, parent_email, parent_phone, emergency_contact, admission_date, academic_year, created_at, updated_at)
			SELECT id, school_id, user_id, admission_number, roll_number, class_id, section, date_of_birth, gender, blood_group, address, parent_name, parent_email, parent_phone, emergency_contact, admission_date, academic_year, created_at, updated_at
			FROM public.students
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				class_id = EXCLUDED.class_id,
				section = EXCLUDED.section,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
		if err != nil {
			return fmt.Errorf("failed to migrate students: %w", err)
		}
	} else {
		log.Printf("Skipping legacy public.students migration for school %s: source table no longer exists", schoolID)
	}

	// 6. Migrate Subjects
	log.Printf("Migrating subjects for school: %s", schoolID)
	_, _ = tx.Exec(ctx, "SAVEPOINT sp_subjects")
	_, err = tx.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s.subjects (id, school_id, name, code, description, created_at, updated_at)
		SELECT id, school_id, name, code, description, created_at, updated_at
		FROM public.subjects
		WHERE school_id = $1
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			code = EXCLUDED.code,
			updated_at = EXCLUDED.updated_at
	`, safeSchema), schoolID)
	if err != nil {
		log.Printf("Warning: Failed to migrate subjects (table may not exist): %v", err)
		_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_subjects")
	} else {
		_, _ = tx.Exec(ctx, "RELEASE SAVEPOINT sp_subjects")
	}

	// 7. Migrate Attendance
	log.Printf("Migrating attendance for school: %s", schoolID)
	_, _ = tx.Exec(ctx, "SAVEPOINT sp_attendance")
	_, err = tx.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s.attendance (id, school_id, student_id, date, status, marked_by, remarks, created_at)
		SELECT id, school_id, student_id, date, status, marked_by, remarks, created_at
		FROM public.attendance
		WHERE school_id = $1
		ON CONFLICT (id) DO NOTHING
	`, safeSchema), schoolID)
	if err != nil {
		log.Printf("Warning: Failed to migrate attendance (table may not exist): %v", err)
		_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_attendance")
	} else {
		_, _ = tx.Exec(ctx, "RELEASE SAVEPOINT sp_attendance")
	}

	// 8. Migrate Fee Structures
	log.Printf("Migrating fee structures for school: %s", schoolID)
	_, _ = tx.Exec(ctx, "SAVEPOINT sp_fee_structures")
	if columnExistsInSchema("public", "fee_structures", "class_id") {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.fee_structures (id, school_id, class_id, fee_type, amount, frequency, academic_year, created_at, updated_at)
			SELECT id, school_id, class_id, fee_type, amount, frequency, academic_year, created_at, updated_at
			FROM public.fee_structures
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				amount = EXCLUDED.amount,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	} else {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.fee_structures (id, school_id, class_id, fee_type, amount, frequency, academic_year, created_at, updated_at)
			SELECT id, school_id, NULL::uuid, 'tuition', 0::numeric, 'yearly', academic_year, created_at, updated_at
			FROM public.fee_structures
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	}
	if err != nil {
		log.Printf("Warning: Failed to migrate fee structures: %v", err)
		_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_fee_structures")
	} else {
		_, _ = tx.Exec(ctx, "RELEASE SAVEPOINT sp_fee_structures")
	}

	// 9. Migrate Student Fees
	log.Printf("Migrating student fees for school: %s", schoolID)
	_, _ = tx.Exec(ctx, "SAVEPOINT sp_student_fees")
	if columnExistsInSchema("public", "student_fees", "fee_structure_id") {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.student_fees (id, school_id, student_id, fee_structure_id, amount, paid_amount, status, due_date, created_at, updated_at)
			SELECT id, school_id, student_id, fee_structure_id, amount, paid_amount, status, due_date, created_at, updated_at
			FROM public.student_fees
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				paid_amount = EXCLUDED.paid_amount,
				status = EXCLUDED.status,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	} else {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.student_fees (id, school_id, student_id, fee_structure_id, amount, paid_amount, status, due_date, created_at, updated_at)
			SELECT sf.id, sf.school_id, sf.student_id, fi.fee_structure_id, sf.amount, sf.paid_amount, sf.status, sf.due_date, sf.created_at, sf.updated_at
			FROM public.student_fees sf
			JOIN public.fee_items fi ON fi.id = sf.fee_item_id
			WHERE sf.school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				paid_amount = EXCLUDED.paid_amount,
				status = EXCLUDED.status,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	}
	if err != nil {
		log.Printf("Warning: Failed to migrate student fees: %v", err)
		_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_student_fees")
	} else {
		_, _ = tx.Exec(ctx, "RELEASE SAVEPOINT sp_student_fees")
	}

	// 10. Migrate Bus Routes
	log.Printf("Migrating bus routes for school: %s", schoolID)
	_, _ = tx.Exec(ctx, "SAVEPOINT sp_bus_routes")
	sourceHasBusRouteStatus := columnExistsInSchema("public", "bus_routes", "status")
	targetHasBusRouteStatus := columnExistsInSchema(schemaName, "bus_routes", "status")
	if targetHasBusRouteStatus && sourceHasBusRouteStatus {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.bus_routes (id, school_id, route_number, driver_name, driver_phone, vehicle_number, capacity, status, created_at, updated_at)
			SELECT id, school_id, route_number, driver_name, driver_phone, vehicle_number, capacity, status, created_at, updated_at
			FROM public.bus_routes
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				route_number = EXCLUDED.route_number,
				driver_name = EXCLUDED.driver_name,
				driver_phone = EXCLUDED.driver_phone,
				vehicle_number = EXCLUDED.vehicle_number,
				capacity = EXCLUDED.capacity,
				status = EXCLUDED.status,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	} else if targetHasBusRouteStatus {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.bus_routes (id, school_id, route_number, driver_name, driver_phone, vehicle_number, capacity, status, created_at, updated_at)
			SELECT id, school_id, route_number, driver_name, driver_phone, vehicle_number, capacity, 'active', created_at, updated_at
			FROM public.bus_routes
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				route_number = EXCLUDED.route_number,
				driver_name = EXCLUDED.driver_name,
				driver_phone = EXCLUDED.driver_phone,
				vehicle_number = EXCLUDED.vehicle_number,
				capacity = EXCLUDED.capacity,
				status = EXCLUDED.status,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	} else {
		_, err = tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %s.bus_routes (id, school_id, route_number, driver_name, driver_phone, vehicle_number, capacity, created_at, updated_at)
			SELECT id, school_id, route_number, driver_name, driver_phone, vehicle_number, capacity, created_at, updated_at
			FROM public.bus_routes
			WHERE school_id = $1
			ON CONFLICT (id) DO UPDATE SET
				route_number = EXCLUDED.route_number,
				driver_name = EXCLUDED.driver_name,
				driver_phone = EXCLUDED.driver_phone,
				vehicle_number = EXCLUDED.vehicle_number,
				capacity = EXCLUDED.capacity,
				updated_at = EXCLUDED.updated_at
		`, safeSchema), schoolID)
	}
	if err != nil {
		log.Printf("Warning: Failed to migrate bus routes: %v", err)
		_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_bus_routes")
	} else {
		_, _ = tx.Exec(ctx, "RELEASE SAVEPOINT sp_bus_routes")
	}

	// 11. Migrate Bus Stops
	log.Printf("Migrating bus stops for school: %s", schoolID)
	_, _ = tx.Exec(ctx, "SAVEPOINT sp_bus_stops")
	_, err = tx.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s.bus_stops (id, route_id, name, arrival_time, stop_order, created_at)
		SELECT bs.id, bs.route_id, bs.name, bs.arrival_time, bs.stop_order, bs.created_at
		FROM public.bus_stops bs
		JOIN public.bus_routes br ON bs.route_id = br.id
		JOIN %s.bus_routes tbr ON tbr.id = bs.route_id
		WHERE br.school_id = $1
		ON CONFLICT (id) DO NOTHING
	`, safeSchema, safeSchema), schoolID)
	if err != nil {
		log.Printf("Warning: Failed to migrate bus stops: %v", err)
		_, _ = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_bus_stops")
	} else {
		_, _ = tx.Exec(ctx, "RELEASE SAVEPOINT sp_bus_stops")
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit migration: %w", err)
	}

	log.Printf("✓ Data migration completed for school: %s", schoolID)
	return nil
}

// MigrateAllSchoolsData migrates data for all existing schools
func (db *PostgresDB) MigrateAllSchoolsData(ctx context.Context) error {
	// Get all school IDs
	rows, err := db.Pool.Query(ctx, "SELECT id FROM public.schools WHERE id IS NOT NULL")
	if err != nil {
		return fmt.Errorf("failed to fetch schools: %w", err)
	}
	defer rows.Close()

	var schoolIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			log.Printf("Error scanning school ID: %v", err)
			continue
		}
		schoolIDs = append(schoolIDs, id)
	}

	log.Printf("Found %d schools to migrate", len(schoolIDs))

	// Migrate each school
	for _, schoolID := range schoolIDs {
		if err := db.MigrateDataToTenantSchema(ctx, schoolID); err != nil {
			log.Printf("ERROR migrating school %s: %v", schoolID, err)
			// Continue with other schools
		}
	}

	return nil
}
