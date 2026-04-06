package student

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/schools24/backend/internal/shared/database"
	"github.com/schools24/backend/internal/shared/objectstore"
)

// Repository handles database operations for students
type Repository struct {
	db    *database.PostgresDB
	store objectstore.Store
}

// NewRepository creates a new student repository
func NewRepository(db *database.PostgresDB, stores ...objectstore.Store) *Repository {
	var store objectstore.Store
	if len(stores) > 0 {
		store = stores[0]
	}
	return &Repository{db: db, store: store}
}

func normalizeStudentSubjectKey(subject string) string {
	return strings.ToLower(strings.TrimSpace(subject))
}

func normalizeStudentClassKey(classLevel string) string {
	raw := strings.ToLower(strings.TrimSpace(classLevel))
	if raw == "" {
		return ""
	}
	raw = strings.Join(strings.Fields(raw), " ")

	if raw == "lkg" || raw == "ukg" || raw == "kg" || raw == "nursery" || raw == "pre-kg" || raw == "pre kg" {
		return raw
	}

	if m := regexp.MustCompile(`class\s*([0-9]{1,2})`).FindStringSubmatch(raw); len(m) == 2 {
		n, err := strconv.Atoi(m[1])
		if err == nil {
			return fmt.Sprintf("class %d", n)
		}
	}
	if m := regexp.MustCompile(`^([0-9]{1,2})\b`).FindStringSubmatch(raw); len(m) == 2 {
		n, err := strconv.Atoi(m[1])
		if err == nil {
			return fmt.Sprintf("class %d", n)
		}
	}

	if idx := strings.Index(raw, "-"); idx > 0 {
		raw = strings.TrimSpace(raw[:idx])
	}
	return raw
}

func (r *Repository) GetConfiguredAcademicYear(ctx context.Context, schoolID uuid.UUID) (string, error) {
	if r.db == nil {
		return "", errors.New("database not configured")
	}
	var academicYear string
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(g.value, '')
		FROM public.schools s
		LEFT JOIN public.settings_global g
		  ON g.key = 'global_academic_year'
		WHERE s.id = $1
		LIMIT 1
	`, schoolID).Scan(&academicYear)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(academicYear), nil
}

// GetStudentByUserID retrieves a student profile by user ID
func (r *Repository) GetStudentByUserID(ctx context.Context, userID uuid.UUID) (*Student, error) {
	query := `
		SELECT s.id, s.user_id, s.admission_number, s.apaar_id, s.abc_id, s.learner_id, s.roll_number, s.class_id, s.section,
		       s.date_of_birth, s.gender, s.blood_group, s.address, s.parent_name,
		       s.parent_email, s.parent_phone, s.emergency_contact, s.admission_date,
		       s.academic_year, s.bus_route_id, s.transport_mode, s.created_at, s.updated_at,
		       u.full_name, u.email, COALESCE(c.name, '') as class_name,
		       COALESCE((SELECT grade_letter FROM student_overall_grades WHERE student_id = s.id AND term = 'Annual' ORDER BY updated_at DESC LIMIT 1), 'X') as current_grade
		FROM students s
		JOIN users u ON s.user_id = u.id
		LEFT JOIN classes c ON s.class_id = c.id
		WHERE s.user_id = $1
	`

	var student Student
	err := r.db.QueryRow(ctx, query, userID).Scan(
		&student.ID, &student.UserID, &student.AdmissionNumber, &student.ApaarID, &student.AbcID, &student.LearnerID, &student.RollNumber,
		&student.ClassID, &student.Section, &student.DateOfBirth, &student.Gender,
		&student.BloodGroup, &student.Address, &student.ParentName, &student.ParentEmail,
		&student.ParentPhone, &student.EmergencyContact, &student.AdmissionDate,
		&student.AcademicYear, &student.BusRouteID, &student.TransportMode, &student.CreatedAt, &student.UpdatedAt,
		&student.FullName, &student.Email, &student.ClassName, &student.CurrentGrade,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get student: %w", err)
	}

	return &student, nil
}

func (r *Repository) GetStudentClassSubjects(ctx context.Context, classID uuid.UUID) ([]StudentClassSubject, error) {
	query := `
		SELECT gs.id, gs.name, COALESCE(gs.code, '')
		FROM classes c
		JOIN public.global_classes gc ON (
			(c.grade = -1 AND LOWER(gc.name) = 'lkg')
			OR (c.grade = 0 AND LOWER(gc.name) = 'ukg')
			OR (c.grade > 0 AND LOWER(gc.name) = LOWER('Class ' || c.grade::text))
		)
		JOIN public.global_class_subjects gcs ON gcs.class_id = gc.id
		JOIN public.global_subjects gs ON gs.id = gcs.subject_id
		WHERE c.id = $1
		ORDER BY gs.name
	`

	rows, err := r.db.Query(ctx, query, classID)
	if err != nil {
		return nil, fmt.Errorf("failed to get student class subjects: %w", err)
	}
	defer rows.Close()

	subjects := make([]StudentClassSubject, 0, 16)
	for rows.Next() {
		var s StudentClassSubject
		if scanErr := rows.Scan(&s.SubjectID, &s.Name, &s.Code); scanErr != nil {
			return nil, fmt.Errorf("failed to scan student class subject: %w", scanErr)
		}
		subjects = append(subjects, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while iterating student class subjects: %w", err)
	}

	return subjects, nil
}

func (r *Repository) IsStudentUser(ctx context.Context, userID uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND role = 'student')`, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to verify student user: %w", err)
	}
	return exists, nil
}

// GetStudentByID retrieves a student profile by ID
func (r *Repository) GetStudentByID(ctx context.Context, id uuid.UUID) (*Student, error) {
	query := `
		SELECT s.id, s.user_id, s.admission_number, s.apaar_id, s.abc_id, s.learner_id, s.roll_number, s.class_id, s.section,
		       s.date_of_birth, s.gender, s.blood_group, s.address, s.parent_name,
		       s.parent_email, s.parent_phone, s.emergency_contact, s.admission_date,
		       s.academic_year, s.bus_route_id, s.transport_mode, s.created_at, s.updated_at,
		       u.full_name, u.email, COALESCE(c.name, '') as class_name
		FROM students s
		JOIN users u ON s.user_id = u.id
		LEFT JOIN classes c ON s.class_id = c.id
		WHERE s.id = $1
	`

	var student Student
	err := r.db.QueryRow(ctx, query, id).Scan(
		&student.ID, &student.UserID, &student.AdmissionNumber, &student.ApaarID, &student.AbcID, &student.LearnerID, &student.RollNumber,
		&student.ClassID, &student.Section, &student.DateOfBirth, &student.Gender,
		&student.BloodGroup, &student.Address, &student.ParentName, &student.ParentEmail,
		&student.ParentPhone, &student.EmergencyContact, &student.AdmissionDate,
		&student.AcademicYear, &student.BusRouteID, &student.TransportMode, &student.CreatedAt, &student.UpdatedAt,
		&student.FullName, &student.Email, &student.ClassName,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get student: %w", err)
	}

	return &student, nil
}

// CreateStudent creates a new student profile
func (r *Repository) CreateStudent(ctx context.Context, student *Student) error {
	query := `
		INSERT INTO students (id, school_id, user_id, admission_number, apaar_id, abc_id, learner_id, roll_number, class_id, section,
		                      date_of_birth, gender, blood_group, address, parent_name,
		                      parent_email, parent_phone, emergency_contact, admission_date,
		                      academic_year, created_at, updated_at, bus_route_id, transport_mode)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
		RETURNING id, created_at, updated_at
	`

	now := time.Now()
	student.ID = uuid.New()
	student.AdmissionDate = now
	student.CreatedAt = now
	student.UpdatedAt = now
	var schoolID *uuid.UUID
	if sid, ok := ctx.Value("school_id").(string); ok && sid != "" {
		if parsed, parseErr := uuid.Parse(sid); parseErr == nil {
			schoolID = &parsed
		}
	}

	return r.db.QueryRow(ctx, query,
		student.ID, schoolID, student.UserID, student.AdmissionNumber, student.ApaarID, student.AbcID, student.LearnerID, student.RollNumber,
		student.ClassID, student.Section, student.DateOfBirth, student.Gender,
		student.BloodGroup, student.Address, student.ParentName, student.ParentEmail,
		student.ParentPhone, student.EmergencyContact, student.AdmissionDate,
		student.AcademicYear, student.CreatedAt, student.UpdatedAt, student.BusRouteID, student.TransportMode,
	).Scan(&student.ID, &student.CreatedAt, &student.UpdatedAt)
}

// GetClassByID retrieves a class by ID
func (r *Repository) GetClassByID(ctx context.Context, classID uuid.UUID) (*Class, error) {
	query := `
		SELECT c.id, c.school_id, c.name, c.grade, c.section, c.class_teacher_id, c.academic_year,
		       c.total_students, c.room_number, c.created_at, c.updated_at,
		       COALESCE(u.full_name, '') as class_teacher_name
		FROM classes c
		LEFT JOIN teachers t ON c.class_teacher_id = t.id
		LEFT JOIN users u ON t.user_id = u.id
		WHERE c.id = $1
	`

	var class Class
	err := r.db.QueryRow(ctx, query, classID).Scan(
		&class.ID, &class.SchoolID, &class.Name, &class.Grade, &class.Section, &class.ClassTeacherID,
		&class.AcademicYear, &class.TotalStudents, &class.RoomNumber,
		&class.CreatedAt, &class.UpdatedAt, &class.ClassTeacherName, // Grade is *int: pgx scans NULL → nil
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get class: %w", err)
	}

	return &class, nil
}

// GetAllClasses retrieves all classes
func (r *Repository) GetAllClasses(ctx context.Context, academicYear string) ([]Class, error) {
	baseQuery := `
		SELECT c.id, c.school_id, c.name, c.grade, c.section, c.class_teacher_id, c.academic_year,
		       c.total_students, c.room_number, c.created_at, c.updated_at,
		       COALESCE(u.full_name, '') as class_teacher_name
		FROM classes c
		LEFT JOIN teachers t ON c.class_teacher_id = t.id
		LEFT JOIN users u ON t.user_id = u.id
	`

	var rows pgx.Rows
	var err error
	if academicYear == "" {
		query := baseQuery + `
			ORDER BY c.name, c.section
		`
		rows, err = r.db.Query(ctx, query)
	} else {
		query := baseQuery + `
			WHERE c.academic_year = $1
			ORDER BY c.name, c.section
		`
		rows, err = r.db.Query(ctx, query, academicYear)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get classes: %w", err)
	}
	defer rows.Close()

	var classes []Class
	for rows.Next() {
		var class Class
		err := rows.Scan(
			&class.ID, &class.SchoolID, &class.Name, &class.Grade, &class.Section, &class.ClassTeacherID,
			&class.AcademicYear, &class.TotalStudents, &class.RoomNumber,
			&class.CreatedAt, &class.UpdatedAt, &class.ClassTeacherName,
		)
		if err != nil {
			return nil, err
		}
		classes = append(classes, class)
	}

	return classes, nil
}

// GetAttendanceStats gets attendance statistics for a student
func (r *Repository) GetAttendanceStats(ctx context.Context, studentID uuid.UUID, startDate, endDate time.Time) (*AttendanceStats, error) {
	query := `
		SELECT 
			COUNT(*) as total_days,
			COUNT(*) FILTER (WHERE status = 'present') as present_days,
			COUNT(*) FILTER (WHERE status = 'absent') as absent_days,
			COUNT(*) FILTER (WHERE status = 'late') as late_days
		FROM attendance
		WHERE student_id = $1 AND date BETWEEN $2 AND $3
	`

	var stats AttendanceStats
	err := r.db.QueryRow(ctx, query, studentID, startDate, endDate).Scan(
		&stats.TotalDays, &stats.PresentDays, &stats.AbsentDays, &stats.LateDays,
	)
	if err != nil {
		return nil, err
	}

	if stats.TotalDays > 0 {
		stats.AttendancePercent = float64(stats.PresentDays) / float64(stats.TotalDays) * 100
	}

	return &stats, nil
}

// GetRecentAttendance gets recent attendance records for a student
func (r *Repository) GetRecentAttendance(ctx context.Context, studentID uuid.UUID, limit int) ([]Attendance, error) {
	query := `
		SELECT id, student_id, class_id, date, status, marked_by, remarks, created_at
		FROM attendance
		WHERE student_id = $1
		ORDER BY date DESC
		LIMIT $2
	`

	rows, err := r.db.Query(ctx, query, studentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []Attendance
	for rows.Next() {
		var a Attendance
		err := rows.Scan(&a.ID, &a.StudentID, &a.ClassID, &a.Date, &a.Status, &a.MarkedBy, &a.Remarks, &a.CreatedAt)
		if err != nil {
			return nil, err
		}
		records = append(records, a)
	}

	return records, nil
}

// GetAttendanceRecords gets attendance records for a student within a date range.
func (r *Repository) GetAttendanceRecords(ctx context.Context, studentID uuid.UUID, startDate, endDate time.Time) ([]Attendance, error) {
	query := `
		SELECT id, student_id, class_id, date, status, marked_by, remarks, created_at
		FROM attendance
		WHERE student_id = $1 AND date BETWEEN $2 AND $3
		ORDER BY date DESC
	`

	rows, err := r.db.Query(ctx, query, studentID, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []Attendance
	for rows.Next() {
		var a Attendance
		err := rows.Scan(&a.ID, &a.StudentID, &a.ClassID, &a.Date, &a.Status, &a.MarkedBy, &a.Remarks, &a.CreatedAt)
		if err != nil {
			return nil, err
		}
		records = append(records, a)
	}

	return records, nil
}

func (r *Repository) GetFeedbackTeacherOptions(ctx context.Context, studentID uuid.UUID, academicYear string) ([]FeedbackTeacherOption, error) {
	query := `
		WITH candidate_teachers AS (
			SELECT tt.teacher_id, tt.subject_id
			FROM students s
			JOIN timetables tt ON tt.class_id = s.class_id
			WHERE s.id = $1
			  AND tt.teacher_id IS NOT NULL
			  AND ($2 = '' OR tt.academic_year = $2)

			UNION ALL

			SELECT ta.teacher_id, ta.subject_id
			FROM students s
			JOIN teacher_assignments ta ON ta.class_id = s.class_id
			WHERE s.id = $1
			  AND ($2 = '' OR ta.academic_year = $2)

			UNION ALL

			SELECT c.class_teacher_id AS teacher_id, NULL::uuid AS subject_id
			FROM students s
			JOIN classes c ON c.id = s.class_id
			WHERE s.id = $1
			  AND c.class_teacher_id IS NOT NULL
		)
		SELECT
			ct.teacher_id,
			COALESCE(u.full_name, '') AS teacher_name,
			COALESCE(
				NULLIF(
					string_agg(DISTINCT NULLIF(sub.name, ''), ', '),
					''
				),
				''
			) AS subject_name
		FROM candidate_teachers ct
		JOIN teachers t ON t.id = ct.teacher_id
		JOIN users u ON u.id = t.user_id
		LEFT JOIN subjects sub ON sub.id = ct.subject_id
		GROUP BY ct.teacher_id, u.full_name
		ORDER BY teacher_name ASC, subject_name ASC
	`

	rows, err := r.db.Query(ctx, query, studentID, academicYear)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch feedback teacher options: %w", err)
	}
	defer rows.Close()

	options := make([]FeedbackTeacherOption, 0, 16)
	for rows.Next() {
		var item FeedbackTeacherOption
		if err := rows.Scan(&item.TeacherID, &item.TeacherName, &item.SubjectName); err != nil {
			return nil, err
		}
		if item.SubjectName != "" {
			item.Label = fmt.Sprintf("%s - %s", item.SubjectName, item.TeacherName)
		} else {
			item.Label = item.TeacherName
		}
		options = append(options, item)
	}
	return options, nil
}

func (r *Repository) IsTeacherInStudentTimetable(ctx context.Context, studentID, teacherID uuid.UUID, academicYear string) (bool, error) {
	query := `
		SELECT EXISTS(
			SELECT 1
			FROM students s
			WHERE s.id = $1
			  AND (
				EXISTS (
					SELECT 1
					FROM timetables tt
					WHERE tt.class_id = s.class_id
					  AND tt.teacher_id = $2
					  AND ($3 = '' OR tt.academic_year = $3)
				)
				OR EXISTS (
					SELECT 1
					FROM teacher_assignments ta
					WHERE ta.class_id = s.class_id
					  AND ta.teacher_id = $2
					  AND ($3 = '' OR ta.academic_year = $3)
				)
				OR EXISTS (
					SELECT 1
					FROM classes c
					WHERE c.id = s.class_id
					  AND c.class_teacher_id = $2
				)
			  )
		)
	`
	var exists bool
	if err := r.db.QueryRow(ctx, query, studentID, teacherID, academicYear).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func (r *Repository) CreateStudentFeedback(ctx context.Context, schoolID, studentID uuid.UUID, req *CreateStudentFeedbackRequest, teacherID uuid.UUID) (uuid.UUID, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var insertedID uuid.UUID
	insertQuery := `
		INSERT INTO student_feedback (
			school_id, student_id, feedback_type, teacher_id, subject_name, rating, message, is_anonymous
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`
	if err := tx.QueryRow(
		ctx,
		insertQuery,
		schoolID,
		studentID,
		req.FeedbackType,
		teacherID,
		req.SubjectName,
		req.Rating,
		req.Message,
		req.IsAnonymous,
	).Scan(&insertedID); err != nil {
		return uuid.Nil, err
	}

	if teacherID != uuid.Nil {
		// Recalculate the average rating from all feedback for this teacher.
		updateRatingQuery := `
			UPDATE teachers t
			SET rating = COALESCE(avg_data.avg_rating, 0.0),
			    updated_at = CURRENT_TIMESTAMP
			FROM (
				SELECT ROUND(AVG(sf.rating)::numeric, 1)::float8 AS avg_rating
				FROM student_feedback sf
				WHERE sf.teacher_id = $1 AND sf.feedback_type = 'teacher'
			) avg_data
			WHERE t.id = $1
		`
		if _, err := tx.Exec(ctx, updateRatingQuery, teacherID); err != nil {
			return uuid.Nil, err
		}

		// Sync the new rating into teacher_leaderboard_entries so the teacher leaderboard
		// and dashboard reflect the updated rating immediately, without waiting for an admin
		// to trigger a full leaderboard refresh.
		syncLeaderboardQuery := `
			UPDATE teacher_leaderboard_entries tle
			SET rating          = ROUND(avg_calc.new_rating::numeric, 1),
			    composite_score = ROUND((
			        (avg_calc.new_rating * 20.0) * 0.35
			        + tle.average_student_score * 0.45
			        + (LEAST(tle.graded_records_count, 60) * 100.0 / 60.0) * 0.20
			    )::numeric, 2),
			    trend = CASE
			        WHEN avg_calc.new_rating >= 4.5 AND tle.average_student_score >= 80 THEN 'up'
			        WHEN avg_calc.new_rating < 3.5  OR  tle.average_student_score < 60  THEN 'down'
			        ELSE 'stable'
		    END,
			    updated_at = CURRENT_TIMESTAMP
			FROM (
				SELECT ROUND(AVG(sf.rating)::numeric, 1)::float8 AS new_rating
				FROM student_feedback sf
				WHERE sf.teacher_id = $1 AND sf.feedback_type = 'teacher'
			) avg_calc
			WHERE tle.teacher_id = $1
		`
		if _, err := tx.Exec(ctx, syncLeaderboardQuery, teacherID); err != nil {
			return uuid.Nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return insertedID, nil
}

func (r *Repository) ListStudentFeedback(ctx context.Context, studentID uuid.UUID, limit int) ([]StudentFeedback, error) {
	query := `
		SELECT
			sf.id,
			sf.feedback_type,
			sf.teacher_id,
			COALESCE(u.full_name, '') AS teacher_name,
			sf.subject_name,
			sf.rating,
			sf.message,
			sf.is_anonymous,
			sf.status,
			sf.response_text,
			sf.responded_at,
			sf.created_at
		FROM student_feedback sf
		LEFT JOIN teachers t ON t.id = sf.teacher_id
		LEFT JOIN users u ON u.id = t.user_id
		WHERE sf.student_id = $1
		ORDER BY sf.created_at DESC
		LIMIT $2
	`

	rows, err := r.db.Query(ctx, query, studentID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch student feedback: %w", err)
	}
	defer rows.Close()

	items := make([]StudentFeedback, 0, limit)
	for rows.Next() {
		var item StudentFeedback
		if err := rows.Scan(
			&item.ID,
			&item.FeedbackType,
			&item.TeacherID,
			&item.TeacherName,
			&item.SubjectName,
			&item.Rating,
			&item.Message,
			&item.IsAnonymous,
			&item.Status,
			&item.ResponseText,
			&item.RespondedAt,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// CreateClass creates a new class
func (r *Repository) CreateClass(ctx context.Context, class *Class) error {
	query := `
		INSERT INTO classes (id, school_id, name, grade, section, academic_year, total_students, room_number, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id
	`

	now := time.Now()
	class.ID = uuid.New()
	class.CreatedAt = now
	class.UpdatedAt = now

	return r.db.QueryRow(ctx, query,
		class.ID, class.SchoolID, class.Name, class.Grade, class.Section, class.AcademicYear,
		class.TotalStudents, class.RoomNumber, class.CreatedAt, class.UpdatedAt,
	).Scan(&class.ID)
}

func (r *Repository) IsGlobalClassNameExists(ctx context.Context, className string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM public.global_classes
			WHERE LOWER(name) = LOWER($1)
		)
	`, className).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to validate global class name: %w", err)
	}
	return exists, nil
}

// UpdateClass updates an existing class
func (r *Repository) UpdateClass(ctx context.Context, class *Class) error {
	query := `
		UPDATE classes
		SET name = $2,
			grade = $3,
			section = $4,
			academic_year = $5,
			room_number = $6,
			class_teacher_id = $7,
			updated_at = $8
		WHERE id = $1
	`

	result, err := r.db.ExecResult(ctx, query,
		class.ID,
		class.Name,
		class.Grade,
		class.Section,
		class.AcademicYear,
		class.RoomNumber,
		class.ClassTeacherID,
		time.Now(),
	)
	if err != nil {
		return fmt.Errorf("failed to update class: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrClassNotFound
	}
	return nil
}

// IsTeacherInSchool checks if a teacher exists in the given school.
func (r *Repository) IsTeacherInSchool(ctx context.Context, teacherID, schoolID uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM teachers
			WHERE id = $1 AND school_id = $2
		)
	`, teacherID, schoolID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to validate teacher in school: %w", err)
	}
	return exists, nil
}

// CountStudentsInClass returns number of students assigned to a class
func (r *Repository) CountStudentsInClass(ctx context.Context, classID uuid.UUID) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM students WHERE class_id = $1", classID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count students in class: %w", err)
	}
	return count, nil
}

// DeleteClass deletes a class
func (r *Repository) DeleteClass(ctx context.Context, classID uuid.UUID) error {
	result, err := r.db.ExecResult(ctx, "DELETE FROM classes WHERE id = $1", classID)
	if err != nil {
		return fmt.Errorf("failed to delete class: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrClassNotFound
	}
	return nil
}

// GetAllStudents retrieves all students with filters
func (r *Repository) GetAllStudents(ctx context.Context, schoolID uuid.UUID, search string, classIDs []uuid.UUID, limit, offset int) ([]Student, int, error) {
	var students []Student
	var args []interface{}
	argNum := 1

	// Base query is FROM users, LEFT JOIN students so that student users who were
	// created via the User Management page (without a full student profile row) still
	// appear in the list. Tenant scoping is handled by the DB search_path already.
	whereClause := "WHERE u.role = 'student'"

	if search != "" {
		whereClause += fmt.Sprintf(" AND (u.full_name ILIKE $%d OR u.email ILIKE $%d OR COALESCE(s.admission_number,'') ILIKE $%d)", argNum, argNum, argNum)
		args = append(args, "%"+search+"%")
		argNum++
	}
	if len(classIDs) > 0 {
		whereClause += " AND s.class_id = ANY($" + fmt.Sprint(argNum) + ")"
		args = append(args, classIDs)
		argNum++
	}

	// Count is now over users (not students) so orphaned users are counted too
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM users u
		LEFT JOIN students s ON s.user_id = u.id
		%s
	`, whereClause)
	var total int
	err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count students: %w", err)
	}

	// Fetch students — COALESCE ensures non-nullable Go fields get a safe default
	// when the student profile row is missing (LEFT JOIN returns NULLs).
	query := fmt.Sprintf(`
		SELECT
			COALESCE(s.id, u.id)                                    AS id,
			u.id                                                    AS user_id,
			COALESCE(s.admission_number, '')                        AS admission_number,
			s.apaar_id,
			s.abc_id,
			s.roll_number,
			s.class_id,
			s.section,
			COALESCE(s.date_of_birth, '2000-01-01'::date)           AS date_of_birth,
			COALESCE(s.gender, '')                                  AS gender,
			s.blood_group,
			s.address,
			s.parent_name,
			s.parent_email,
			s.parent_phone,
			s.emergency_contact,
			COALESCE(s.admission_date, u.created_at::date)          AS admission_date,
			COALESCE(s.academic_year, '')                           AS academic_year,
			s.bus_route_id,
			s.transport_mode,
			COALESCE(s.created_at, u.created_at)                   AS created_at,
			COALESCE(s.updated_at, u.updated_at)                   AS updated_at,
			u.full_name,
			u.email,
			COALESCE(c.name, '')                                    AS class_name,
			(SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.status = 'present') AS present_days,
			(SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id)                           AS total_attendance_days,
			(SELECT status     FROM student_fees f WHERE f.student_id = s.id LIMIT 1) AS fee_status,
			(SELECT paid_amount FROM student_fees f WHERE f.student_id = s.id LIMIT 1) AS fee_paid,
			(SELECT amount     FROM student_fees f WHERE f.student_id = s.id LIMIT 1) AS fee_total,
			COALESCE((SELECT grade_letter FROM student_overall_grades
			          WHERE student_id = s.id AND term = 'Annual'
			          ORDER BY updated_at DESC LIMIT 1), 'X')      AS current_grade
		FROM users u
		LEFT JOIN students s ON s.user_id = u.id
		LEFT JOIN classes  c ON s.class_id = c.id
		%s
		ORDER BY u.full_name ASC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to fetch students: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var s Student
		var feeStatus sql.NullString
		var feePaid, feeTotal sql.NullFloat64
		var presentDays, totalDays int

		err := rows.Scan(
			&s.ID, &s.UserID, &s.AdmissionNumber, &s.ApaarID, &s.AbcID, &s.RollNumber, &s.ClassID, &s.Section,
			&s.DateOfBirth, &s.Gender, &s.BloodGroup, &s.Address, &s.ParentName,
			&s.ParentEmail, &s.ParentPhone, &s.EmergencyContact, &s.AdmissionDate,
			&s.AcademicYear, &s.BusRouteID, &s.TransportMode, &s.CreatedAt, &s.UpdatedAt,
			&s.FullName, &s.Email, &s.ClassName,
			&presentDays, &totalDays, &feeStatus, &feePaid, &feeTotal, &s.CurrentGrade,
		)
		if err != nil {
			log.Printf("WARN: failed to scan student row: %v", err)
			continue
		}

		if totalDays > 0 {
			percent := float64(presentDays) / float64(totalDays) * 100
			s.AttendanceStats = &AttendanceStats{
				AttendancePercent: percent,
			}
		}

		if feeStatus.Valid {
			s.Fees = &Fees{
				Status: feeStatus.String,
				Paid:   feePaid.Float64,
				Total:  feeTotal.Float64,
			}
		}
		students = append(students, s)
	}

	return students, total, nil
}

// UpdateStudent updates an existing student profile
func (r *Repository) UpdateStudent(ctx context.Context, student *Student) error {
	return r.db.WithTx(ctx, func(tx database.Tx) error {
		// 1. Update Students Table
		studentQuery := `
			UPDATE students
			SET admission_number = $2, apaar_id = $3, abc_id = $4, learner_id = $5, roll_number = $6, class_id = $7, section = $8,
				date_of_birth = $9, gender = $10, blood_group = $11, address = $12,
				parent_name = $13, parent_email = $14, parent_phone = $15, emergency_contact = $16,
				academic_year = $17, admission_date = $18, updated_at = $19, bus_route_id = $20, transport_mode = $21
			WHERE id = $1
		`
		if _, err := tx.Exec(ctx, studentQuery,
			student.ID, student.AdmissionNumber, student.ApaarID, student.AbcID, student.LearnerID, student.RollNumber, student.ClassID, student.Section,
			student.DateOfBirth, student.Gender, student.BloodGroup, student.Address,
			student.ParentName, student.ParentEmail, student.ParentPhone, student.EmergencyContact,
			student.AcademicYear, student.AdmissionDate, time.Now(), student.BusRouteID, student.TransportMode,
		); err != nil {
			return fmt.Errorf("failed to update student record: %w", err)
		}

		// 2. Update Users Table (Name, Email)
		if student.UserID != uuid.Nil {
			userQuery := `UPDATE users SET full_name = $2, email = $3, updated_at = $4 WHERE id = $1`
			if _, err := tx.Exec(ctx, userQuery, student.UserID, student.FullName, student.Email, time.Now()); err != nil {
				return fmt.Errorf("failed to update user record: %w", err)
			}
		}

		return nil
	})
}

func (r *Repository) FederatedIDExists(ctx context.Context, apaarID, abcID string, excludeStudentID *uuid.UUID) (bool, bool, error) {
	apaarExists := false
	abcExists := false

	if apaarID != "" {
		query := `
			SELECT EXISTS(
				SELECT 1
				FROM students
				WHERE UPPER(COALESCE(apaar_id, '')) = UPPER($1)
			)
		`
		args := []interface{}{apaarID}
		if excludeStudentID != nil {
			query = `
				SELECT EXISTS(
					SELECT 1
					FROM students
					WHERE UPPER(COALESCE(apaar_id, '')) = UPPER($1)
					  AND id <> $2
				)
			`
			args = append(args, *excludeStudentID)
		}
		if err := r.db.QueryRow(ctx, query, args...).Scan(&apaarExists); err != nil {
			return false, false, err
		}
	}

	if abcID != "" {
		query := `
			SELECT EXISTS(
				SELECT 1
				FROM students
				WHERE UPPER(COALESCE(abc_id, '')) = UPPER($1)
			)
		`
		args := []interface{}{abcID}
		if excludeStudentID != nil {
			query = `
				SELECT EXISTS(
					SELECT 1
					FROM students
					WHERE UPPER(COALESCE(abc_id, '')) = UPPER($1)
					  AND id <> $2
				)
			`
			args = append(args, *excludeStudentID)
		}
		if err := r.db.QueryRow(ctx, query, args...).Scan(&abcExists); err != nil {
			return false, false, err
		}
	}

	return apaarExists, abcExists, nil
}

func (r *Repository) ResolveLearnerID(ctx context.Context, fullName string, dateOfBirth *time.Time, apaarID, abcID *string) (*uuid.UUID, error) {
	normalizedName := strings.TrimSpace(fullName)
	normalizedApaar := ""
	normalizedAbc := ""
	if apaarID != nil {
		normalizedApaar = strings.ToUpper(strings.TrimSpace(*apaarID))
	}
	if abcID != nil {
		normalizedAbc = strings.ToUpper(strings.TrimSpace(*abcID))
	}

	if normalizedApaar == "" && normalizedAbc == "" {
		return nil, nil
	}

	type learnerHit struct {
		ID      uuid.UUID
		ApaarID sql.NullString
		AbcID   sql.NullString
	}

	rows, err := r.db.Query(ctx, `
		SELECT id, apaar_id, abc_id
		FROM public.learners
		WHERE ($1 <> '' AND UPPER(COALESCE(apaar_id, '')) = UPPER($1))
		   OR ($2 <> '' AND UPPER(COALESCE(abc_id, '')) = UPPER($2))
	`, normalizedApaar, normalizedAbc)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	hits := make([]learnerHit, 0, 2)
	for rows.Next() {
		var hit learnerHit
		if err := rows.Scan(&hit.ID, &hit.ApaarID, &hit.AbcID); err != nil {
			return nil, err
		}
		hits = append(hits, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(hits) > 1 {
		return nil, ErrFederatedIDConflict
	}

	if len(hits) == 0 {
		learnerID := uuid.New()
		err := r.db.QueryRow(ctx, `
			INSERT INTO public.learners (id, full_name, date_of_birth, apaar_id, abc_id, created_at, updated_at)
			VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NOW(), NOW())
			RETURNING id
		`, learnerID, normalizedName, dateOfBirth, normalizedApaar, normalizedAbc).Scan(&learnerID)
		if err != nil {
			return nil, err
		}
		return &learnerID, nil
	}

	resolved := hits[0].ID
	if err := r.db.Exec(ctx, `
		UPDATE public.learners
		SET
			full_name = CASE WHEN NULLIF($2, '') IS NOT NULL THEN $2 ELSE full_name END,
			date_of_birth = COALESCE($3, date_of_birth),
			apaar_id = CASE WHEN apaar_id IS NULL OR apaar_id = '' THEN NULLIF($4, '') ELSE apaar_id END,
			abc_id = CASE WHEN abc_id IS NULL OR abc_id = '' THEN NULLIF($5, '') ELSE abc_id END,
			updated_at = NOW()
		WHERE id = $1
	`, resolved, normalizedName, dateOfBirth, normalizedApaar, normalizedAbc); err != nil {
		return nil, err
	}

	return &resolved, nil
}

func (r *Repository) EnsureLearnerEnrollment(ctx context.Context, learnerID uuid.UUID, source string) error {
	schoolIDStr, ok := ctx.Value("school_id").(string)
	if !ok || strings.TrimSpace(schoolIDStr) == "" {
		return nil
	}

	schoolID, err := uuid.Parse(strings.TrimSpace(schoolIDStr))
	if err != nil {
		return nil
	}

	normalizedSource := strings.TrimSpace(source)
	if normalizedSource == "" {
		normalizedSource = "schools24"
	}

	if err := r.db.Exec(ctx, `
		WITH existing AS (
			UPDATE public.learner_enrollments
			SET status = 'active', exited_at = NULL, updated_at = NOW(), source = $3
			WHERE learner_id = $1 AND school_id = $2
			RETURNING id
		)
		INSERT INTO public.learner_enrollments (
			id, learner_id, school_id, status, joined_at, source, created_at, updated_at
		)
		SELECT gen_random_uuid(), $1, $2, 'active', NOW(), $3, NOW(), NOW()
		WHERE NOT EXISTS (SELECT 1 FROM existing)
	`, learnerID, schoolID, normalizedSource); err != nil {
		return err
	}

	return nil
}

// DeleteStudent deletes a student profile and the associated user account.
//
// The caller passes the `id` field returned by GetAllStudents, which is:
//   - students.id  – when the student has a full profile row
//   - users.id     – when the user was created via User Management without a
//     student profile row (COALESCE(s.id, u.id) in the list query)
//
// We therefore resolve to the correct user_id first, then wipe both the profile
// row (if any) and the user account.
func (r *Repository) DeleteStudent(ctx context.Context, id uuid.UUID) error {
	var userID uuid.UUID

	// Step 1: try to find by student profile PK
	err := r.db.QueryRow(ctx, `SELECT user_id FROM students WHERE id = $1`, id).Scan(&userID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("failed to find student: %w", err)
		}
		// No student profile row – check for a bare user with the student role
		err2 := r.db.QueryRow(ctx, `SELECT id FROM users WHERE id = $1 AND role = 'student'`, id).Scan(&userID)
		if err2 != nil {
			if errors.Is(err2, pgx.ErrNoRows) {
				return errors.New("student not found")
			}
			return fmt.Errorf("failed to find student user: %w", err2)
		}
	}

	// Step 2: delete student profile row first (child FK), ignore if already absent
	_, _ = r.db.ExecResult(ctx, `DELETE FROM students WHERE user_id = $1`, userID)

	// Step 3: delete the user account (cascade covers remaining child rows)
	result, err := r.db.ExecResult(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("failed to delete student user: %w", err)
	}
	if result.RowsAffected() == 0 {
		return errors.New("student not found")
	}

	return nil
}

func (r *Repository) GetStudentFeeBreakdown(ctx context.Context, studentID uuid.UUID) ([]StudentFeeBreakdownItem, error) {
	query := `
		SELECT
			sf.id,
			sf.purpose_id,
			COALESCE(fdp.name, sf.purpose, 'Fee') AS purpose_name,
			sf.amount,
			COALESCE(sf.paid_amount, 0) AS paid_amount,
			CASE
				WHEN COALESCE(sf.paid_amount, 0) >= sf.amount - COALESCE(sf.waiver_amount, 0) THEN 'paid'
				WHEN COALESCE(sf.paid_amount, 0) > 0 THEN 'partial'
				WHEN sf.due_date IS NOT NULL AND sf.due_date < CURRENT_DATE THEN 'overdue'
				ELSE 'pending'
			END AS status,
			sf.due_date
		FROM student_fees sf
		LEFT JOIN fee_demand_purposes fdp ON fdp.id = sf.purpose_id
		WHERE sf.student_id = $1
		ORDER BY sf.created_at DESC
	`

	rows, err := r.db.Query(ctx, query, studentID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch student fee breakdown: %w", err)
	}
	defer rows.Close()

	items := make([]StudentFeeBreakdownItem, 0)
	for rows.Next() {
		var item StudentFeeBreakdownItem
		if scanErr := rows.Scan(
			&item.ID,
			&item.PurposeID,
			&item.PurposeName,
			&item.Amount,
			&item.PaidAmount,
			&item.Status,
			&item.DueDate,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan fee breakdown row: %w", scanErr)
		}
		items = append(items, item)
	}

	return items, nil
}

func (r *Repository) GetStudentPaymentHistory(ctx context.Context, studentID uuid.UUID, limit int) ([]StudentPaymentHistoryItem, error) {
	query := `
		SELECT
			p.id,
			p.amount,
			p.payment_method,
			p.payment_date,
			p.status,
			p.receipt_number,
			p.transaction_id,
			p.purpose,
			p.student_fee_id
		FROM payments p
		WHERE p.student_id = $1
		ORDER BY p.payment_date DESC
		LIMIT $2
	`

	rows, err := r.db.Query(ctx, query, studentID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch student payment history: %w", err)
	}
	defer rows.Close()

	items := make([]StudentPaymentHistoryItem, 0)
	for rows.Next() {
		var item StudentPaymentHistoryItem
		if scanErr := rows.Scan(
			&item.ID,
			&item.Amount,
			&item.PaymentMethod,
			&item.PaymentDate,
			&item.Status,
			&item.ReceiptNumber,
			&item.TransactionID,
			&item.Purpose,
			&item.StudentFeeID,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan payment history row: %w", scanErr)
		}
		items = append(items, item)
	}

	return items, nil
}

func (r *Repository) GetStudentSubjectKeysFromTimetable(ctx context.Context, classID uuid.UUID, academicYear string) ([]string, error) {
	query := `
		SELECT DISTINCT COALESCE(NULLIF(TRIM(s.name), ''), '')
		FROM timetables t
		LEFT JOIN subjects s ON s.id = t.subject_id
		WHERE t.class_id = $1
		  AND t.subject_id IS NOT NULL
		  AND ($2 = '' OR t.academic_year = $2)
		  AND COALESCE(NULLIF(TRIM(s.name), ''), '') <> ''
	`
	rows, err := r.db.Query(ctx, query, classID, strings.TrimSpace(academicYear))
	if err != nil {
		return nil, fmt.Errorf("failed to fetch student subject scope: %w", err)
	}
	defer rows.Close()

	set := make(map[string]struct{})
	for rows.Next() {
		var subjectName string
		if scanErr := rows.Scan(&subjectName); scanErr != nil {
			return nil, scanErr
		}
		key := normalizeStudentSubjectKey(subjectName)
		if key != "" {
			set[key] = struct{}{}
		}
	}

	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys, nil
}

func (r *Repository) ListStudentTeacherStudyMaterials(
	ctx context.Context,
	schoolID string,
	classKey string,
	subjectKeys []string,
	ascending bool,
	subject string,
	search string,
	limit int64,
) ([]StudentStudyMaterial, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	sortDirection := "DESC"
	if ascending {
		sortDirection = "ASC"
	}

	subject = strings.TrimSpace(subject)
	search = strings.TrimSpace(search)
	subjectKey := ""
	if subject = strings.TrimSpace(subject); subject != "" {
		subjectKey = normalizeStudentSubjectKey(subject)
	}
	searchLike := "%" + search + "%"

	log.Printf("[STUDENT-MATERIALS] ListTeacherMaterials: schoolID=%s classKey=%q subject=%q search=%q",
		schoolID, classKey, subject, search)

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT
			id::text,
			uploader_id,
			uploader_name,
			uploader_role,
			teacher_id,
			teacher_name,
			school_id,
			title,
			subject,
			class_level,
			description,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			uploaded_at
		FROM study_materials
		WHERE (school_id = $1 OR school_id = '')
		  AND class_key = $2
		  AND ($3 = '' OR subject_key = $3)
		  AND ($4 = '' OR title ILIKE $5 OR file_name ILIKE $5 OR description ILIKE $5)
		ORDER BY uploaded_at %s
		LIMIT $6
	`, sortDirection), strings.TrimSpace(schoolID), classKey, subjectKey, search, searchLike, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list student teacher materials: %w", err)
	}
	defer rows.Close()

	items := make([]StudentStudyMaterial, 0, limit)
	for rows.Next() {
		var raw StudentStudyMaterial
		if err := rows.Scan(
			&raw.ID,
			&raw.UploaderID,
			&raw.UploaderName,
			&raw.UploaderRole,
			&raw.TeacherID,
			&raw.TeacherName,
			&raw.SchoolID,
			&raw.Title,
			&raw.Subject,
			&raw.ClassLevel,
			&raw.Description,
			&raw.FileName,
			&raw.FileSize,
			&raw.MimeType,
			&raw.FileSHA256,
			&raw.UploadedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to decode student teacher material: %w", err)
		}
		items = append(items, raw)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while iterating student teacher materials: %w", err)
	}
	log.Printf("[STUDENT-MATERIALS] ListTeacherMaterials: found %d documents", len(items))
	return items, nil
}

func (r *Repository) ListStudentGlobalStudyMaterials(
	ctx context.Context,
	classKey string,
	subjectKeys []string,
	ascending bool,
	subject string,
	search string,
	limit int64,
) ([]StudentStudyMaterial, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	sortDirection := "DESC"
	if ascending {
		sortDirection = "ASC"
	}

	// Keep in-memory class/subject matching for compatibility with legacy rows.
	subjectFilterKey := ""
	subject = strings.TrimSpace(subject)
	search = strings.TrimSpace(search)
	if subject != "" {
		subjectFilterKey = normalizeStudentSubjectKey(subject)
	}
	searchLike := "%" + search + "%"

	log.Printf("[STUDENT-MATERIALS] ListGlobalMaterials: classKey=%q subjectFilter=%q search=%q",
		classKey, subjectFilterKey, search)

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT
			id::text,
			uploader_id,
			uploader_name,
			uploader_role,
			title,
			subject,
			class_level,
			description,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			uploaded_at
		FROM public.super_admin_study_materials
		WHERE ($1 = '' OR title ILIKE $2 OR file_name ILIKE $2 OR description ILIKE $2)
		ORDER BY uploaded_at %s
		LIMIT $3
	`, sortDirection), search, searchLike, limit*10)
	if err != nil {
		return nil, fmt.Errorf("failed to list student global materials: %w", err)
	}
	defer rows.Close()

	items := make([]StudentStudyMaterial, 0, limit)
	for rows.Next() {
		var raw StudentStudyMaterial
		if err := rows.Scan(
			&raw.ID,
			&raw.UploaderID,
			&raw.UploaderName,
			&raw.UploaderRole,
			&raw.Title,
			&raw.Subject,
			&raw.ClassLevel,
			&raw.Description,
			&raw.FileName,
			&raw.FileSize,
			&raw.MimeType,
			&raw.FileSHA256,
			&raw.UploadedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to decode student global material: %w", err)
		}

		// In-memory class filter — handles both current (class_key stored) and
		// legacy (only class_level stored) documents uniformly.
		if normalizeStudentClassKey(raw.ClassLevel) != classKey {
			continue
		}
		// In-memory subject filter (if requested)
		if subjectFilterKey != "" && normalizeStudentSubjectKey(raw.Subject) != subjectFilterKey {
			continue
		}

		items = append(items, StudentStudyMaterial{
			ID:           "sa:" + raw.ID,
			UploaderID:   raw.UploaderID,
			UploaderName: raw.UploaderName,
			UploaderRole: raw.UploaderRole,
			Title:        raw.Title,
			Subject:      raw.Subject,
			ClassLevel:   raw.ClassLevel,
			Description:  raw.Description,
			FileName:     raw.FileName,
			FileSize:     raw.FileSize,
			MimeType:     raw.MimeType,
			FileSHA256:   raw.FileSHA256,
			UploadedAt:   raw.UploadedAt,
		})
		if int64(len(items)) >= limit {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while iterating student global materials: %w", err)
	}
	log.Printf("[STUDENT-MATERIALS] ListGlobalMaterials: found %d documents", len(items))
	return items, nil
}

// ─── Quiz repository functions ────────────────────────────────────────────────

// GetStudentQuizList returns all quizzes for the student's class with attempt stats.
func (r *Repository) GetStudentQuizList(ctx context.Context, studentID, classID uuid.UUID) ([]StudentQuizListItem, error) {
	tenantRows, err := r.db.Query(ctx, `
		SELECT
			q.id,
			'tenant' AS quiz_source,
			q.title,
			q.chapter_name,
			c.name          AS class_name,
			s.name          AS subject_name,
			COALESCE(q.scheduled_at, q.created_at) AS scheduled_at,
			q.is_anytime,
			q.duration_minutes,
			q.total_marks,
			q.question_count,
			CASE
				WHEN COUNT(a.id) > 0 THEN 'completed'
				WHEN q.status = 'completed' THEN 'completed'
				WHEN q.is_anytime THEN 'active'
				WHEN q.scheduled_at > NOW() THEN 'upcoming'
				ELSE 'active'
			END AS effective_status,
			'teacher' AS creator_role,
			COALESCE(u.full_name, 'Teacher') AS creator_name,
			COUNT(a.id)                                              AS attempt_count,
			MAX(CASE WHEN a.is_completed THEN a.score END)::INT      AS best_score,
			MAX(CASE WHEN a.is_completed THEN a.percentage END)      AS best_percentage,
			(SELECT a2.id::TEXT FROM quiz_attempts a2
			  WHERE a2.quiz_id = q.id AND a2.student_id = $1
			    AND a2.is_completed = true
			    AND a2.score = MAX(CASE WHEN a.is_completed THEN a.score END)
			  ORDER BY a2.submitted_at DESC LIMIT 1)                  AS best_attempt_id
		FROM quizzes q
		JOIN classes c ON c.id = q.class_id
		JOIN subjects s ON s.id = q.subject_id
		JOIN teachers t ON t.id = q.teacher_id
		JOIN users u ON u.id = t.user_id
		LEFT JOIN quiz_attempts a
			ON a.quiz_id = q.id AND a.student_id = $1 AND a.is_completed = true
		WHERE q.class_id = $2
		GROUP BY q.id, c.name, s.name, u.full_name
	`, studentID, classID)
	if err != nil {
		return nil, fmt.Errorf("GetStudentQuizList tenant query: %w", err)
	}
	defer tenantRows.Close()

	list := make([]StudentQuizListItem, 0, 64)
	for tenantRows.Next() {
		var item StudentQuizListItem
		var bestScore *int
		var bestPct *float64
		var bestAttempt *string
		if err := tenantRows.Scan(
			&item.ID,
			&item.QuizSource,
			&item.Title,
			&item.ChapterName,
			&item.ClassName,
			&item.SubjectName,
			&item.ScheduledAt,
			&item.IsAnytime,
			&item.DurationMinutes,
			&item.TotalMarks,
			&item.QuestionCount,
			&item.Status,
			&item.CreatorRole,
			&item.CreatorName,
			&item.AttemptCount,
			&bestScore,
			&bestPct,
			&bestAttempt,
		); err != nil {
			return nil, fmt.Errorf("GetStudentQuizList tenant scan: %w", err)
		}
		item.BestScore = bestScore
		item.BestPercentage = bestPct
		item.BestAttemptID = bestAttempt
		list = append(list, item)
	}
	if err := tenantRows.Err(); err != nil {
		return nil, err
	}

	globalRows, err := r.db.Query(ctx, `
		SELECT
			gq.id::text,
			'global' AS quiz_source,
			gq.title,
			gq.chapter_name,
			gc.name AS class_name,
			gs.name AS subject_name,
			COALESCE(gq.scheduled_at, gq.created_at) AS scheduled_at,
			gq.is_anytime,
			gq.duration_minutes,
			gq.total_marks,
			gq.question_count,
			CASE
				WHEN COUNT(a.id) > 0 THEN 'completed'
				WHEN gq.status = 'completed' THEN 'completed'
				WHEN gq.is_anytime THEN 'active'
				WHEN gq.scheduled_at > NOW() THEN 'upcoming'
				ELSE 'active'
			END AS effective_status,
			'super_admin' AS creator_role,
			COALESCE(sa.full_name, 'Super Admin') AS creator_name,
			COUNT(a.id)                                              AS attempt_count,
			MAX(CASE WHEN a.is_completed THEN a.score END)::INT      AS best_score,
			MAX(CASE WHEN a.is_completed THEN a.percentage END)      AS best_percentage,
			(SELECT a2.id::TEXT FROM global_quiz_attempts a2
			  WHERE a2.quiz_id = gq.id AND a2.student_id = $1
			    AND a2.is_completed = true
			    AND a2.score = MAX(CASE WHEN a.is_completed THEN a.score END)
			  ORDER BY a2.submitted_at DESC LIMIT 1)                  AS best_attempt_id
		FROM public.global_quizzes gq
		JOIN public.global_classes gc ON gc.id = gq.class_id
		JOIN public.global_subjects gs ON gs.id = gq.subject_id
		JOIN public.super_admins sa ON sa.id = gq.super_admin_id
		JOIN classes c ON c.id = $2
		LEFT JOIN global_quiz_attempts a
			ON a.quiz_id = gq.id AND a.student_id = $1 AND a.is_completed = true
		WHERE LOWER(TRIM(gc.name)) = LOWER(TRIM(COALESCE(NULLIF(split_part(c.name, '-', 1), ''), c.name)))
		GROUP BY gq.id, gc.name, gs.name, sa.full_name
	`, studentID, classID)
	if err != nil {
		return nil, fmt.Errorf("GetStudentQuizList global query: %w", err)
	}
	defer globalRows.Close()

	for globalRows.Next() {
		var item StudentQuizListItem
		var bestScore *int
		var bestPct *float64
		var bestAttempt *string
		if err := globalRows.Scan(
			&item.ID,
			&item.QuizSource,
			&item.Title,
			&item.ChapterName,
			&item.ClassName,
			&item.SubjectName,
			&item.ScheduledAt,
			&item.IsAnytime,
			&item.DurationMinutes,
			&item.TotalMarks,
			&item.QuestionCount,
			&item.Status,
			&item.CreatorRole,
			&item.CreatorName,
			&item.AttemptCount,
			&bestScore,
			&bestPct,
			&bestAttempt,
		); err != nil {
			return nil, fmt.Errorf("GetStudentQuizList global scan: %w", err)
		}
		item.BestScore = bestScore
		item.BestPercentage = bestPct
		item.BestAttemptID = bestAttempt
		list = append(list, item)
	}
	if err := globalRows.Err(); err != nil {
		return nil, err
	}

	sort.Slice(list, func(i, j int) bool {
		return list[i].ScheduledAt.After(list[j].ScheduledAt)
	})

	return list, nil
}

// GetQuizForAttempt returns quiz header + questions + options (no is_correct).
func (r *Repository) GetQuizForAttempt(ctx context.Context, quizID, classID uuid.UUID) (*StartAttemptResponse, error) {
	// Quiz header
	var resp StartAttemptResponse
	err := r.db.QueryRow(ctx, `
		SELECT q.id, q.title, s.name, q.duration_minutes, q.total_marks
		FROM quizzes q
		JOIN subjects s ON s.id = q.subject_id
		WHERE q.id = $1 AND q.class_id = $2
	`, quizID, classID).Scan(
		&resp.QuizID,
		&resp.QuizTitle,
		&resp.SubjectName,
		&resp.DurationMinutes,
		&resp.TotalMarks,
	)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("GetQuizForAttempt header: %w", err)
		}

		err = r.db.QueryRow(ctx, `
			SELECT gq.id, gq.title, gs.name, gq.duration_minutes, gq.total_marks
			FROM public.global_quizzes gq
			JOIN public.global_classes gc ON gc.id = gq.class_id
			JOIN public.global_subjects gs ON gs.id = gq.subject_id
			JOIN classes c ON c.id = $2
			WHERE gq.id = $1
			  AND LOWER(TRIM(gc.name)) = LOWER(TRIM(COALESCE(NULLIF(split_part(c.name, '-', 1), ''), c.name)))
		`, quizID, classID).Scan(
			&resp.QuizID,
			&resp.QuizTitle,
			&resp.SubjectName,
			&resp.DurationMinutes,
			&resp.TotalMarks,
		)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) || errors.Is(err, pgx.ErrNoRows) {
				return nil, nil
			}
			return nil, fmt.Errorf("GetQuizForAttempt global header: %w", err)
		}
		resp.QuizSource = "global"
	} else {
		resp.QuizSource = "tenant"
	}

	// Questions without revealing is_correct
	questionTable := "quiz_questions"
	optionTable := "quiz_options"
	if resp.QuizSource == "global" {
		questionTable = "public.global_quiz_questions"
		optionTable = "public.global_quiz_options"
	}

	qrows, err := r.db.Query(ctx, `
		SELECT id, question_text, marks, order_index
		FROM `+questionTable+`
		WHERE quiz_id = $1
		ORDER BY order_index
	`, quizID)
	if err != nil {
		return nil, fmt.Errorf("GetQuizForAttempt questions: %w", err)
	}
	defer qrows.Close()

	var questions []StudentQuizQuestion
	for qrows.Next() {
		var q StudentQuizQuestion
		if err := qrows.Scan(&q.ID, &q.QuestionText, &q.Marks, &q.OrderIndex); err != nil {
			return nil, fmt.Errorf("GetQuizForAttempt question scan: %w", err)
		}
		questions = append(questions, q)
	}
	if err := qrows.Err(); err != nil {
		return nil, err
	}

	// Options per question
	for i, q := range questions {
		orows, err := r.db.Query(ctx, `
			SELECT id, option_text, order_index
			FROM `+optionTable+`
			WHERE question_id = $1
			ORDER BY order_index
		`, q.ID)
		if err != nil {
			return nil, fmt.Errorf("GetQuizForAttempt options: %w", err)
		}
		var opts []StudentQuizOption
		for orows.Next() {
			var o StudentQuizOption
			if err := orows.Scan(&o.ID, &o.OptionText, &o.OrderIndex); err != nil {
				orows.Close()
				return nil, fmt.Errorf("GetQuizForAttempt option scan: %w", err)
			}
			opts = append(opts, o)
		}
		orows.Close()
		if err := orows.Err(); err != nil {
			return nil, err
		}
		questions[i].Options = opts
	}

	resp.Questions = questions
	return &resp, nil
}

// GetOpenAttempt returns a non-completed, non-expired attempt for (quizID, studentID) if any.
func (r *Repository) GetOpenAttempt(ctx context.Context, quizID, studentID uuid.UUID) (*struct {
	AttemptID  uuid.UUID
	StartedAt  time.Time
	TotalMarks int
}, error) {
	var res struct {
		AttemptID  uuid.UUID
		StartedAt  time.Time
		TotalMarks int
	}
	err := r.db.QueryRow(ctx, `
		SELECT a.id, a.started_at, a.total_marks
		FROM quiz_attempts a
		WHERE a.quiz_id = $1 AND a.student_id = $2
		  AND a.is_completed = false AND a.is_expired = false
		ORDER BY a.created_at DESC
		LIMIT 1
	`, quizID, studentID).Scan(&res.AttemptID, &res.StartedAt, &res.TotalMarks)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("GetOpenAttempt: %w", err)
		}
		err = r.db.QueryRow(ctx, `
			SELECT a.id, a.started_at, a.total_marks
			FROM global_quiz_attempts a
			WHERE a.quiz_id = $1 AND a.student_id = $2
			  AND a.is_completed = false AND a.is_expired = false
			ORDER BY a.created_at DESC
			LIMIT 1
		`, quizID, studentID).Scan(&res.AttemptID, &res.StartedAt, &res.TotalMarks)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) || errors.Is(err, pgx.ErrNoRows) {
				return nil, nil
			}
			return nil, fmt.Errorf("GetOpenAttempt global: %w", err)
		}
	}
	return &res, nil
}

// CreateQuizAttempt inserts a new attempt and returns its ID + started_at.
func (r *Repository) CreateQuizAttempt(ctx context.Context, quizID, studentID uuid.UUID, totalMarks int) (uuid.UUID, time.Time, error) {
	id := uuid.New()
	now := time.Now()
	var isGlobal bool
	_ = r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.global_quizzes WHERE id = $1)`, quizID).Scan(&isGlobal)

	insertTable := "quiz_attempts"
	if isGlobal {
		insertTable = "global_quiz_attempts"
	}
	err := r.db.Exec(ctx, `
		INSERT INTO `+insertTable+`
			(id, quiz_id, student_id, started_at, total_marks, score, percentage, is_completed, is_expired)
		VALUES ($1, $2, $3, $4, $5, 0, 0, false, false)
	`, id, quizID, studentID, now, totalMarks)
	if err != nil {
		return uuid.Nil, time.Time{}, fmt.Errorf("CreateQuizAttempt: %w", err)
	}
	return id, now, nil
}

// ScoreAndSaveAttempt scores answers inside a transaction and persists the results.
func (r *Repository) ScoreAndSaveAttempt(ctx context.Context, attemptID uuid.UUID, answers []SubmitQuizAnswer) (int, int, float64, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("ScoreAndSaveAttempt begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Detect attempt source and fetch total_marks
	attemptTable := "quiz_attempts"
	answerTable := "quiz_attempt_answers"
	optionTable := "quiz_options"
	questionTable := "quiz_questions"

	var totalMarks int
	err = tx.QueryRow(ctx, `SELECT total_marks FROM quiz_attempts WHERE id = $1`, attemptID).Scan(&totalMarks)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, pgx.ErrNoRows) {
			return 0, 0, 0, fmt.Errorf("ScoreAndSaveAttempt fetch total_marks: %w", err)
		}
		attemptTable = "global_quiz_attempts"
		answerTable = "global_quiz_attempt_answers"
		optionTable = "public.global_quiz_options"
		questionTable = "public.global_quiz_questions"
		err = tx.QueryRow(ctx, `SELECT total_marks FROM global_quiz_attempts WHERE id = $1`, attemptID).Scan(&totalMarks)
		if err != nil {
			return 0, 0, 0, fmt.Errorf("ScoreAndSaveAttempt fetch global total_marks: %w", err)
		}
	}

	score := 0
	now := time.Now()

	for _, ans := range answers {
		qID, parseErr := uuid.Parse(ans.QuestionID)
		if parseErr != nil {
			continue
		}

		var optMarks int
		var isCorrect bool
		var optionID *uuid.UUID

		if ans.SelectedOptionID != "" {
			oID, parseErr2 := uuid.Parse(ans.SelectedOptionID)
			if parseErr2 == nil {
				optionID = &oID
				// Look up correctness + marks for the selected option's question
				err2 := tx.QueryRow(ctx, `
					SELECT o.is_correct, qq.marks
					FROM `+optionTable+` o
					JOIN `+questionTable+` qq ON qq.id = o.question_id
					WHERE o.id = $1 AND qq.id = $2
				`, oID, qID).Scan(&isCorrect, &optMarks)
				if err2 != nil {
					// Unknown option or question mismatch — treat as wrong
					isCorrect = false
					optMarks = 0
				}
			}
		}

		marksObtained := 0
		if isCorrect {
			marksObtained = optMarks
			score += marksObtained
		}

		if optionID != nil {
			_, err3 := tx.Exec(ctx, `
				INSERT INTO `+answerTable+`
					(id, attempt_id, question_id, selected_option_id, is_correct, marks_obtained)
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
				ON CONFLICT (attempt_id, question_id) DO UPDATE
					SET selected_option_id = $3, is_correct = $4, marks_obtained = $5
			`, attemptID, qID, optionID, isCorrect, marksObtained)
			if err3 != nil {
				return 0, 0, 0, fmt.Errorf("ScoreAndSaveAttempt insert answer: %w", err3)
			}
		} else {
			_, err3 := tx.Exec(ctx, `
				INSERT INTO `+answerTable+`
					(id, attempt_id, question_id, selected_option_id, is_correct, marks_obtained)
				VALUES (gen_random_uuid(), $1, $2, NULL, false, 0)
				ON CONFLICT (attempt_id, question_id) DO UPDATE
					SET selected_option_id = NULL, is_correct = false, marks_obtained = 0
			`, attemptID, qID)
			if err3 != nil {
				return 0, 0, 0, fmt.Errorf("ScoreAndSaveAttempt insert skipped answer: %w", err3)
			}
		}
	}

	pct := 0.0
	if totalMarks > 0 {
		pct = float64(score) / float64(totalMarks) * 100.0
		// Round to 2 decimals
		pct = float64(int(pct*100)) / 100
	}

	_, err = tx.Exec(ctx, `
		UPDATE `+attemptTable+`
		SET score = $1, percentage = $2, is_completed = true, submitted_at = $3, updated_at = $3
		WHERE id = $4
	`, score, pct, now, attemptID)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("ScoreAndSaveAttempt update attempt: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, 0, fmt.Errorf("ScoreAndSaveAttempt commit: %w", err)
	}
	return score, totalMarks, pct, nil
}

// GetAttemptResult returns the full scored quiz result for display.
func (r *Repository) GetAttemptResult(ctx context.Context, attemptID, studentID uuid.UUID) (*StudentQuizResult, error) {
	var res StudentQuizResult
	err := r.db.QueryRow(ctx, `
		SELECT
			a.id, a.quiz_id, q.title, s.name,
			a.score, a.total_marks, a.percentage, a.submitted_at
		FROM quiz_attempts a
		JOIN quizzes  q ON q.id = a.quiz_id
		JOIN subjects s ON s.id = q.subject_id
		WHERE a.id = $1 AND a.student_id = $2 AND a.is_completed = true
	`, attemptID, studentID).Scan(
		&res.AttemptID,
		&res.QuizID,
		&res.QuizTitle,
		&res.SubjectName,
		&res.Score,
		&res.TotalMarks,
		&res.Percentage,
		&res.SubmittedAt,
	)
	res.QuizSource = "tenant"
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("GetAttemptResult header: %w", err)
		}
		err = r.db.QueryRow(ctx, `
			SELECT
				a.id, a.quiz_id, gq.title, gs.name,
				a.score, a.total_marks, a.percentage, a.submitted_at
			FROM global_quiz_attempts a
			JOIN public.global_quizzes gq ON gq.id = a.quiz_id
			JOIN public.global_subjects gs ON gs.id = gq.subject_id
			WHERE a.id = $1 AND a.student_id = $2 AND a.is_completed = true
		`, attemptID, studentID).Scan(
			&res.AttemptID,
			&res.QuizID,
			&res.QuizTitle,
			&res.SubjectName,
			&res.Score,
			&res.TotalMarks,
			&res.Percentage,
			&res.SubmittedAt,
		)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) || errors.Is(err, pgx.ErrNoRows) {
				return nil, nil
			}
			return nil, fmt.Errorf("GetAttemptResult global header: %w", err)
		}
		res.QuizSource = "global"
	}

	// Best score across all completed attempts for this student + quiz
	attemptTable := "quiz_attempts"
	questionTable := "quiz_questions"
	optionTable := "quiz_options"
	answerTable := "quiz_attempt_answers"
	if res.QuizSource == "global" {
		attemptTable = "global_quiz_attempts"
		questionTable = "public.global_quiz_questions"
		optionTable = "public.global_quiz_options"
		answerTable = "global_quiz_attempt_answers"
	}

	err = r.db.QueryRow(ctx, `
		SELECT COALESCE(MAX(score),0), COALESCE(MAX(percentage),0)
		FROM `+attemptTable+`
		WHERE quiz_id = $1 AND student_id = $2 AND is_completed = true
	`, res.QuizID, studentID).Scan(&res.BestScore, &res.BestPercentage)
	if err != nil {
		return nil, fmt.Errorf("GetAttemptResult best score: %w", err)
	}
	res.IsNewBest = (res.Score == res.BestScore)

	// Questions with options + answer overlay
	qrows, err := r.db.Query(ctx, `
		SELECT qq.id, qq.question_text, qq.marks, qq.order_index,
		       COALESCE(aa.marks_obtained,0)
		FROM `+questionTable+` qq
		LEFT JOIN `+answerTable+` aa ON aa.question_id = qq.id AND aa.attempt_id = $1
		WHERE qq.quiz_id = $2
		ORDER BY qq.order_index
	`, attemptID, res.QuizID)
	if err != nil {
		return nil, fmt.Errorf("GetAttemptResult questions: %w", err)
	}
	defer qrows.Close()

	var questions []ReviewQuestion
	for qrows.Next() {
		var q ReviewQuestion
		if err := qrows.Scan(&q.ID, &q.QuestionText, &q.Marks, &q.OrderIndex, &q.MarksObtained); err != nil {
			return nil, fmt.Errorf("GetAttemptResult question scan: %w", err)
		}
		questions = append(questions, q)
	}
	if err := qrows.Err(); err != nil {
		return nil, err
	}

	for i, q := range questions {
		orows, err := r.db.Query(ctx, `
			SELECT o.id, o.option_text, o.is_correct, o.order_index,
			       (aa.selected_option_id = o.id) AS is_selected
			FROM `+optionTable+` o
			LEFT JOIN `+answerTable+` aa
				ON aa.attempt_id = $1 AND aa.question_id = $2
			WHERE o.question_id = $2
			ORDER BY o.order_index
		`, attemptID, q.ID)
		if err != nil {
			return nil, fmt.Errorf("GetAttemptResult options: %w", err)
		}
		var opts []ReviewOption
		for orows.Next() {
			var o ReviewOption
			var isSelected *bool
			if err := orows.Scan(&o.ID, &o.OptionText, &o.IsCorrect, &o.OrderIndex, &isSelected); err != nil {
				orows.Close()
				return nil, fmt.Errorf("GetAttemptResult option scan: %w", err)
			}
			if isSelected != nil {
				o.IsSelected = *isSelected
			}
			opts = append(opts, o)
		}
		orows.Close()
		if err := orows.Err(); err != nil {
			return nil, err
		}
		questions[i].Options = opts
	}

	res.Questions = questions
	return &res, nil
}

// MarkAttemptExpired marks an open attempt as expired (called when timer enforcement detects overrun).
func (r *Repository) MarkAttemptExpired(ctx context.Context, attemptID uuid.UUID) error {
	result, err := r.db.ExecResult(ctx, `
		UPDATE quiz_attempts
		SET is_expired = true, is_completed = true, submitted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND is_completed = false
	`, attemptID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		_, err = r.db.ExecResult(ctx, `
			UPDATE global_quiz_attempts
			SET is_expired = true, is_completed = true, submitted_at = NOW(), updated_at = NOW()
			WHERE id = $1 AND is_completed = false
		`, attemptID)
		return err
	}
	return nil
}

func (r *Repository) GetStudentTeacherStudyMaterialByID(ctx context.Context, schoolID, classKey, materialID string, subjectKeys []string) (*StudentStudyMaterial, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}
	_ = subjectKeys

	var raw struct {
		ID           string
		UploaderID   string
		UploaderName string
		UploaderRole string
		TeacherID    string
		TeacherName  string
		SchoolID     string
		Title        string
		Subject      string
		ClassLevel   string
		Description  string
		FileName     string
		FileSize     int64
		MimeType     string
		FileSHA256   string
		UploadedAt   time.Time
		StorageKey   string
	}
	if err := r.db.QueryRow(ctx, `
		SELECT id::text, uploader_id, uploader_name, uploader_role, teacher_id, teacher_name,
		       school_id, title, subject, class_level, description, file_name, file_size,
		       mime_type, file_sha256, uploaded_at, storage_key
		FROM study_materials
		WHERE id::text = $1 AND class_key = $2 AND school_id = $3
		LIMIT 1
	`, strings.TrimSpace(materialID), classKey, schoolID).Scan(&raw.ID, &raw.UploaderID, &raw.UploaderName, &raw.UploaderRole, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.Title, &raw.Subject, &raw.ClassLevel, &raw.Description, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt, &raw.StorageKey); err != nil {
		return nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve student teacher material content: %w", err)
	}

	return &StudentStudyMaterial{
		ID:           raw.ID,
		UploaderID:   raw.UploaderID,
		UploaderName: raw.UploaderName,
		UploaderRole: raw.UploaderRole,
		TeacherID:    raw.TeacherID,
		TeacherName:  raw.TeacherName,
		SchoolID:     raw.SchoolID,
		Title:        raw.Title,
		Subject:      raw.Subject,
		ClassLevel:   raw.ClassLevel,
		Description:  raw.Description,
		FileName:     raw.FileName,
		FileSize:     raw.FileSize,
		MimeType:     raw.MimeType,
		FileSHA256:   raw.FileSHA256,
		UploadedAt:   raw.UploadedAt,
		Content:      content,
	}, nil
}

func (r *Repository) GetStudentGlobalStudyMaterialByID(ctx context.Context, classKey, materialID string, subjectKeys []string) (*StudentStudyMaterial, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}

	var raw struct {
		ID           string
		UploaderID   string
		UploaderName string
		UploaderRole string
		Title        string
		Subject      string
		ClassLevel   string
		Description  string
		FileName     string
		FileSize     int64
		MimeType     string
		FileSHA256   string
		UploadedAt   time.Time
		StorageKey   string
	}
	if err := r.db.QueryRow(ctx, `
		SELECT id::text, uploader_id, uploader_name, uploader_role, title, subject, class_level,
		       description, file_name, file_size, mime_type, file_sha256, uploaded_at, storage_key
		FROM public.super_admin_study_materials
		WHERE id::text = $1
		LIMIT 1
	`, strings.TrimSpace(materialID)).Scan(&raw.ID, &raw.UploaderID, &raw.UploaderName, &raw.UploaderRole, &raw.Title, &raw.Subject, &raw.ClassLevel, &raw.Description, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt, &raw.StorageKey); err != nil {
		return nil, err
	}

	if normalizeStudentClassKey(raw.ClassLevel) != classKey {
		return nil, errors.New("not found")
	}
	if len(subjectKeys) > 0 {
		docSubjectKey := normalizeStudentSubjectKey(raw.Subject)
		allowed := false
		for _, key := range subjectKeys {
			if key == docSubjectKey {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, errors.New("not found")
		}
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve student global material content: %w", err)
	}

	return &StudentStudyMaterial{
		ID:           "sa:" + raw.ID,
		UploaderID:   raw.UploaderID,
		UploaderName: raw.UploaderName,
		UploaderRole: raw.UploaderRole,
		Title:        raw.Title,
		Subject:      raw.Subject,
		ClassLevel:   raw.ClassLevel,
		Description:  raw.Description,
		FileName:     raw.FileName,
		FileSize:     raw.FileSize,
		MimeType:     raw.MimeType,
		FileSHA256:   raw.FileSHA256,
		UploadedAt:   raw.UploadedAt,
		Content:      content,
	}, nil
}

// ListStudentIndividualReportDocuments queries the tenant student_individual_reports table
// and returns only documents that belong to this specific student in this specific school.
func (r *Repository) ListStudentIndividualReportDocuments(ctx context.Context, schoolID, studentID string, ascending bool, search string, limit int64) ([]StudentReportDocument, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	sortDir := "DESC"
	if ascending {
		sortDir = "ASC"
	}
	args := []any{schoolID, studentID, limit}
	where := "school_id = $1 AND student_id = $2"
	if search = strings.TrimSpace(search); search != "" {
		where += " AND (title ILIKE $4 OR file_name ILIKE $4 OR description ILIKE $4 OR report_type ILIKE $4)"
		args = append(args, "%"+search+"%")
	}
	query := fmt.Sprintf(`
		SELECT id::text, teacher_id, teacher_name, school_id, student_id, student_name, class_name,
		       title, report_type, academic_year, description, file_name, file_size, mime_type,
		       file_sha256, uploaded_at
		FROM student_individual_reports
		WHERE %s
		ORDER BY uploaded_at %s
		LIMIT $3
	`, where, sortDir)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list student individual report documents: %w", err)
	}
	defer rows.Close()

	items := make([]StudentReportDocument, 0, limit)
	for rows.Next() {
		var raw StudentReportDocument
		if err := rows.Scan(&raw.ID, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.StudentID, &raw.StudentName, &raw.ClassName, &raw.Title, &raw.ReportType, &raw.AcademicYear, &raw.Description, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt); err != nil {
			return nil, fmt.Errorf("failed to scan student individual report document: %w", err)
		}
		items = append(items, StudentReportDocument{
			ID:          raw.ID,
			TeacherID:   raw.TeacherID,
			TeacherName: raw.TeacherName,
			SchoolID:    raw.SchoolID,
			StudentID:   raw.StudentID,
			StudentName: raw.StudentName,
			ClassName:   raw.ClassName,
			// ClassLevel kept empty — per-student reports don't use class_level
			Title:        raw.Title,
			ReportType:   raw.ReportType,
			AcademicYear: raw.AcademicYear,
			Description:  raw.Description,
			FileName:     raw.FileName,
			FileSize:     raw.FileSize,
			MimeType:     raw.MimeType,
			FileSHA256:   raw.FileSHA256,
			UploadedAt:   raw.UploadedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// GetStudentIndividualReportDocumentByID fetches a single document from student_individual_reports
// and enforces school + student ownership so no cross-school leak is possible.
func (r *Repository) GetStudentIndividualReportDocumentByID(ctx context.Context, schoolID, studentID, documentID string) (*StudentReportDocument, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}

	var raw struct {
		ID           string
		TeacherID    string
		TeacherName  string
		SchoolID     string
		StudentID    string
		StudentName  string
		ClassName    string
		Title        string
		ReportType   string
		AcademicYear string
		Description  string
		FileName     string
		FileSize     int64
		MimeType     string
		FileSHA256   string
		UploadedAt   time.Time
		StorageKey   string
	}
	if err := r.db.QueryRow(ctx, `
		SELECT id::text, teacher_id, teacher_name, school_id, student_id, student_name,
		       class_name, title, report_type, academic_year, description, file_name, file_size,
		       mime_type, file_sha256, uploaded_at, storage_key
		FROM student_individual_reports
		WHERE id::text = $1 AND school_id = $2 AND student_id = $3
		LIMIT 1
	`, strings.TrimSpace(documentID), schoolID, studentID).Scan(&raw.ID, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.StudentID, &raw.StudentName, &raw.ClassName, &raw.Title, &raw.ReportType, &raw.AcademicYear, &raw.Description, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt, &raw.StorageKey); err != nil {
		return nil, err
	}
	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve student report content: %w", err)
	}

	return &StudentReportDocument{
		ID:           raw.ID,
		TeacherID:    raw.TeacherID,
		TeacherName:  raw.TeacherName,
		SchoolID:     raw.SchoolID,
		StudentID:    raw.StudentID,
		StudentName:  raw.StudentName,
		ClassName:    raw.ClassName,
		Title:        raw.Title,
		ReportType:   raw.ReportType,
		AcademicYear: raw.AcademicYear,
		Description:  raw.Description,
		FileName:     raw.FileName,
		FileSize:     raw.FileSize,
		MimeType:     raw.MimeType,
		FileSHA256:   raw.FileSHA256,
		UploadedAt:   raw.UploadedAt,
		Content:      content,
	}, nil
}

// ─── Quiz Leaderboard ─────────────────────────────────────────────────────────

// GetClassQuizLeaderboard returns all students in the class ranked by their quiz rating.
//
// Rating formula (0–5):
//
//	For each student: average of best-attempt percentages across ALL quizzes in the class,
//	then divide by 20 to normalise to a 0–5 scale.
//	Quizzes the student has never attempted count as 0%.
//	Consequence: when a teacher/super-admin adds a new quiz, every student's rating
//	decreases until they complete it.
func (r *Repository) GetClassQuizLeaderboard(ctx context.Context, classID uuid.UUID) ([]QuizLeaderboardEntry, error) {
	query := `
WITH class_info AS (
    SELECT id, name FROM classes WHERE id = $1
),
-- tenant quizzes for the class × every student in the class
tenant_scores AS (
    SELECT
        q.id   AS quiz_id,
        s.id   AS student_id,
        COALESCE(MAX(CASE WHEN a.is_completed THEN a.percentage END), 0) AS best_pct
    FROM quizzes q
    CROSS JOIN students s
    LEFT JOIN quiz_attempts a
        ON a.quiz_id = q.id AND a.student_id = s.id
    WHERE q.class_id = $1
      AND s.class_id = $1
    GROUP BY q.id, s.id
),
-- global quizzes matching the class name × every student in the class
global_scores AS (
    SELECT
        gq.id  AS quiz_id,
        s.id   AS student_id,
        COALESCE(MAX(CASE WHEN ga.is_completed THEN ga.percentage END), 0) AS best_pct
    FROM public.global_quizzes gq
    JOIN public.global_classes gc ON gc.id = gq.class_id
    JOIN class_info ci
        ON LOWER(TRIM(gc.name)) = LOWER(TRIM(
            COALESCE(NULLIF(split_part(ci.name, '-', 1), ''), ci.name)
        ))
    CROSS JOIN students s
    LEFT JOIN global_quiz_attempts ga
        ON ga.quiz_id = gq.id AND ga.student_id = s.id
    WHERE s.class_id = $1
    GROUP BY gq.id, s.id
),
all_scores AS (
    SELECT * FROM tenant_scores
    UNION ALL
    SELECT * FROM global_scores
),
total_quizzes AS (
    SELECT COUNT(DISTINCT quiz_id) AS cnt FROM all_scores
)
SELECT
    s.id::text                         AS student_id,
    u.full_name                        AS student_name,
    (SELECT cnt FROM total_quizzes)    AS total_quizzes,
    COUNT(DISTINCT CASE WHEN aqs.best_pct > 0 THEN aqs.quiz_id END)  AS quizzes_attempted,
    CASE
        WHEN (SELECT cnt FROM total_quizzes) = 0 THEN 0::numeric
        ELSE ROUND(
            (SUM(COALESCE(aqs.best_pct, 0)) / (SELECT cnt FROM total_quizzes))::numeric,
            2
        )
    END AS avg_best_pct,
    CASE
        WHEN (SELECT cnt FROM total_quizzes) = 0 THEN 0::numeric
        ELSE ROUND(
            (SUM(COALESCE(aqs.best_pct, 0)) / (SELECT cnt FROM total_quizzes) / 20.0)::numeric,
            2
        )
    END AS rating
FROM students s
JOIN users u ON u.id = s.user_id
LEFT JOIN all_scores aqs ON aqs.student_id = s.id
WHERE s.class_id = $1
GROUP BY s.id, u.full_name
ORDER BY rating DESC, avg_best_pct DESC, u.full_name ASC
`

	rows, err := r.db.Query(ctx, query, classID)
	if err != nil {
		return nil, fmt.Errorf("GetClassQuizLeaderboard: %w", err)
	}
	defer rows.Close()

	entries := make([]QuizLeaderboardEntry, 0, 64)
	for rows.Next() {
		var e QuizLeaderboardEntry
		var avgBestPct, rating float64
		if err := rows.Scan(
			&e.StudentID,
			&e.StudentName,
			&e.TotalQuizzes,
			&e.QuizzesAttempted,
			&avgBestPct,
			&rating,
		); err != nil {
			return nil, fmt.Errorf("GetClassQuizLeaderboard scan: %w", err)
		}
		e.AvgBestPct = avgBestPct
		e.Rating = rating
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetClassQuizLeaderboard rows: %w", err)
	}
	return entries, nil
}

// GetClassAssessmentLeaderboard returns class-wise leaderboard using assessment averages.
//
// Formula:
// 1) For each student and each assessment: average of subject percentages for that assessment.
// 2) Final score: average of those per-assessment averages across all assessments with scores.
func (r *Repository) GetClassAssessmentLeaderboard(ctx context.Context, classID uuid.UUID, academicYear string) ([]AssessmentLeaderboardEntry, error) {
	query := `
WITH relevant_assessments AS (
	SELECT a.id
	FROM assessments a
	WHERE ($2 = '' OR a.academic_year = $2)
	  AND $1 = ANY(COALESCE(a.class_ids, '{}'::UUID[]))
),
per_assessment_student_avg AS (
	SELECT
		sg.student_id,
		sg.assessment_id,
		AVG(COALESCE(sg.percentage, 0)) AS assessment_avg_pct
	FROM student_grades sg
	JOIN relevant_assessments ra ON ra.id = sg.assessment_id
	WHERE sg.subject_id IS NOT NULL
	GROUP BY sg.student_id, sg.assessment_id
),
total_assessments AS (
	SELECT COUNT(*) AS cnt FROM relevant_assessments
)
SELECT
	s.id::text AS student_id,
	u.full_name AS student_name,
	(SELECT cnt FROM total_assessments) AS total_assessments,
	COUNT(pasa.assessment_id) AS assessments_with_scores,
	CASE
		WHEN COUNT(pasa.assessment_id) = 0 THEN 0::numeric
		ELSE ROUND(AVG(pasa.assessment_avg_pct)::numeric, 2)
	END AS avg_assessment_pct
FROM students s
JOIN users u ON u.id = s.user_id
LEFT JOIN per_assessment_student_avg pasa ON pasa.student_id = s.id
WHERE s.class_id = $1
GROUP BY s.id, u.full_name
ORDER BY avg_assessment_pct DESC, assessments_with_scores DESC, u.full_name ASC
`

	rows, err := r.db.Query(ctx, query, classID, strings.TrimSpace(academicYear))
	if err != nil {
		return nil, fmt.Errorf("GetClassAssessmentLeaderboard: %w", err)
	}
	defer rows.Close()

	entries := make([]AssessmentLeaderboardEntry, 0, 64)
	for rows.Next() {
		var e AssessmentLeaderboardEntry
		if err := rows.Scan(
			&e.StudentID,
			&e.StudentName,
			&e.TotalAssessments,
			&e.AssessmentsWithScores,
			&e.AvgAssessmentPct,
		); err != nil {
			return nil, fmt.Errorf("GetClassAssessmentLeaderboard scan: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetClassAssessmentLeaderboard rows: %w", err)
	}
	return entries, nil
}

func (r *Repository) GetStudentAssessmentStages(ctx context.Context, classID uuid.UUID, academicYear string) ([]StudentAssessmentStage, error) {
	query := `
WITH class_meta AS (
	SELECT
		c.id AS class_id,
		c.grade AS class_grade,
		CASE
			WHEN c.grade = -1 THEN 'lkg'
			WHEN c.grade = 0 THEN 'ukg'
			ELSE LOWER('Class ' || c.grade::text)
		END AS global_class_name
	FROM classes c
	WHERE c.id = $2
),
required_subjects AS (
	SELECT
		COUNT(DISTINCT gcs.subject_id) AS subject_count
	FROM class_meta cm
	JOIN public.global_classes gc
	  ON LOWER(gc.name) = cm.global_class_name
	JOIN public.global_class_subjects gcs
	  ON gcs.class_id = gc.id
),
assessment_schedule AS (
	SELECT
		a.id,
		COALESCE(NULLIF(TRIM(a.name), ''), 'Assessment') AS name,
		COALESCE(NULLIF(TRIM(a.assessment_type), ''), NULLIF(TRIM(a.type), ''), 'Assessment') AS assessment_type,
		MIN(aet.exam_date) AS first_exam_date,
		MAX(aet.exam_date) AS last_exam_date,
		COUNT(DISTINCT aet.subject_id) AS scheduled_subjects,
		rs.subject_count AS required_subject_count,
		a.created_at
	FROM assessments a
	JOIN class_meta cm
	  ON a.id IS NOT NULL
	 AND cm.class_id = ANY(COALESCE(a.class_ids, '{}'::UUID[]))
	JOIN required_subjects rs ON TRUE
	JOIN assessment_exam_timetable aet
	  ON aet.assessment_id = a.id
	 AND aet.class_grade = cm.class_grade
	WHERE ($1 = '' OR a.academic_year = $1)
	GROUP BY a.id, a.name, a.assessment_type, a.type, rs.subject_count, a.created_at
	HAVING rs.subject_count > 0
	   AND COUNT(DISTINCT aet.subject_id) >= rs.subject_count
)
SELECT
	asch.id,
	asch.name,
	asch.assessment_type,
	asch.first_exam_date AS scheduled_date,
	(asch.last_exam_date < CURRENT_DATE) AS completed
FROM assessment_schedule asch
ORDER BY asch.first_exam_date ASC NULLS LAST, asch.last_exam_date ASC NULLS LAST, asch.created_at ASC, asch.name ASC
`

	rows, err := r.db.Query(ctx, query, strings.TrimSpace(academicYear), classID)
	if err != nil {
		return nil, fmt.Errorf("GetStudentAssessmentStages: %w", err)
	}
	defer rows.Close()

	items := make([]StudentAssessmentStage, 0, 16)
	for rows.Next() {
		var item StudentAssessmentStage
		if err := rows.Scan(
			&item.AssessmentID,
			&item.Name,
			&item.AssessmentType,
			&item.ScheduledDate,
			&item.Completed,
		); err != nil {
			return nil, fmt.Errorf("GetStudentAssessmentStages scan: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetStudentAssessmentStages rows: %w", err)
	}
	return items, nil
}

// ListStudentClassMessages returns paginated class-group messages for a student's class.
func (r *Repository) ListStudentClassMessages(ctx context.Context, classID uuid.UUID, page, pageSize int64) ([]StudentClassMessage, bool, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	rows, err := r.db.Query(ctx, `
		SELECT
			m.id,
			m.class_id,
			m.sender_id,
			COALESCE(u.full_name, '') AS sender_name,
			COALESCE(u.role, '') AS sender_role,
			COALESCE(m.content, '') AS content,
			m.created_at
		FROM class_group_messages m
		JOIN users u ON u.id = m.sender_id
		WHERE m.class_id = $1
		ORDER BY m.created_at ASC
		LIMIT $2 OFFSET $3
	`, classID, pageSize+1, offset)
	if err != nil {
		return nil, false, fmt.Errorf("ListStudentClassMessages: %w", err)
	}
	defer rows.Close()

	items := make([]StudentClassMessage, 0, pageSize+1)
	for rows.Next() {
		var msg StudentClassMessage
		if err := rows.Scan(
			&msg.ID,
			&msg.ClassID,
			&msg.SenderID,
			&msg.SenderName,
			&msg.SenderRole,
			&msg.Content,
			&msg.CreatedAt,
		); err != nil {
			return nil, false, fmt.Errorf("ListStudentClassMessages scan: %w", err)
		}
		items = append(items, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("ListStudentClassMessages rows: %w", err)
	}

	hasMore := int64(len(items)) > pageSize
	if hasMore {
		items = items[:pageSize]
	}
	return items, hasMore, nil
}

// CreateStudentClassMessage inserts a student message into class_group_messages.
func (r *Repository) CreateStudentClassMessage(ctx context.Context, classID, senderID uuid.UUID, content string) (*StudentClassMessage, error) {
	var msg StudentClassMessage
	if err := r.db.QueryRow(ctx, `
		INSERT INTO class_group_messages (class_id, sender_id, content)
		VALUES ($1, $2, $3)
		RETURNING id, class_id, sender_id, content, created_at
	`, classID, senderID, content).Scan(
		&msg.ID,
		&msg.ClassID,
		&msg.SenderID,
		&msg.Content,
		&msg.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("CreateStudentClassMessage: %w", err)
	}

	if err := r.db.QueryRow(ctx, `SELECT COALESCE(full_name, ''), COALESCE(role, '') FROM users WHERE id = $1`, senderID).Scan(
		&msg.SenderName,
		&msg.SenderRole,
	); err != nil {
		return nil, fmt.Errorf("CreateStudentClassMessage sender lookup: %w", err)
	}

	return &msg, nil
}

// ─── Subject Performance ─────────────────────────────────────────────────────

// GetStudentSubjectPerformance aggregates the student's marks per subject from
// the teacher-uploaded assessment marks stored in student_grades.
//
// Filters:
//   - academic_year: matched against assessments.academic_year (skipped when empty)
//   - classID:       matched against assessments.class_ids UUID[]
//
// Returns one entry per subject, ordered by subject name.
func (r *Repository) GetStudentSubjectPerformance(ctx context.Context, studentID uuid.UUID, classID uuid.UUID, academicYear string) ([]SubjectPerformanceEntry, error) {
	query := `
SELECT
    s.id::text                                                   AS subject_id,
    COALESCE(NULLIF(TRIM(s.name), ''), 'Unknown')               AS subject_name,
    ROUND(AVG(sg.percentage)::numeric, 1)                       AS avg_pct,
    SUM(sg.marks_obtained)                                      AS total_obtained,
    SUM(COALESCE(asm.max_marks, a.max_marks, 0))                AS total_max,
    COUNT(sg.assessment_id)                                     AS assessment_count
FROM student_grades sg
JOIN subjects  s ON s.id  = sg.subject_id
JOIN assessments a ON a.id = sg.assessment_id
LEFT JOIN LATERAL (
    SELECT COALESCE(asm2.max_marks, a.max_marks, 0) AS max_marks
    FROM assessment_subject_marks asm2
    WHERE asm2.assessment_id = a.id
      AND (asm2.subject_id = sg.subject_id OR asm2.subject_id IS NULL)
    ORDER BY (asm2.subject_id IS NULL) ASC, asm2.created_at ASC
    LIMIT 1
) asm ON TRUE
WHERE sg.student_id   = $1
  AND sg.marks_obtained IS NOT NULL
  AND sg.percentage    IS NOT NULL
  AND ($2 = '' OR a.academic_year = $2)
  AND $3 = ANY(COALESCE(a.class_ids, '{}'::UUID[]))
GROUP BY s.id, s.name
ORDER BY s.name ASC
`
	rows, err := r.db.Query(ctx, query, studentID, strings.TrimSpace(academicYear), classID)
	if err != nil {
		return nil, fmt.Errorf("GetStudentSubjectPerformance: %w", err)
	}
	defer rows.Close()

	entries := make([]SubjectPerformanceEntry, 0, 16)
	for rows.Next() {
		var e SubjectPerformanceEntry
		if err := rows.Scan(
			&e.SubjectID,
			&e.SubjectName,
			&e.AvgPercentage,
			&e.TotalObtained,
			&e.TotalMax,
			&e.AssessmentCount,
		); err != nil {
			return nil, fmt.Errorf("GetStudentSubjectPerformance scan: %w", err)
		}
		e.GradeLetter = calculateSubjectGradeLetter(e.AvgPercentage)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetStudentSubjectPerformance rows: %w", err)
	}
	return entries, nil
}

func calculateSubjectGradeLetter(pct float64) string {
	switch {
	case pct >= 90:
		return "A+"
	case pct >= 80:
		return "A"
	case pct >= 70:
		return "B+"
	case pct >= 60:
		return "B"
	case pct >= 50:
		return "C"
	case pct >= 40:
		return "D"
	default:
		return "F"
	}
}

// GetSchoolAssessmentLeaderboard returns ALL students in the school ranked by
// assessment performance across their respective class assessments.
//
// Formula (identical to class leaderboard, but school-wide):
//  1. Per student per assessment: AVG(student_grades.percentage) across subjects.
//  2. Student overall: AVG of those per-assessment averages.
//
// Only students with ≥1 graded assessment are included.
func (r *Repository) GetSchoolAssessmentLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string) ([]SchoolAssessmentLeaderboardEntry, error) {
	query := `
WITH student_classes AS (
    SELECT s.id AS student_id, s.class_id, COALESCE(c.name, '') AS class_name
    FROM students s
    JOIN classes c ON c.id = s.class_id
    WHERE s.school_id = $1
),
student_assessment_relevance AS (
    -- For each student, find assessments that include their class by UUID.
    SELECT sc.student_id, sc.class_name, a.id AS assessment_id
    FROM student_classes sc
    JOIN assessments a ON sc.class_id = ANY(COALESCE(a.class_ids, '{}'::UUID[]))
    WHERE ($2 = '' OR a.academic_year = $2)
),
per_assessment_avg AS (
    -- Step 1: Per (student, assessment) average of subject percentages.
    SELECT
        sar.student_id,
        sar.class_name,
        sar.assessment_id,
        AVG(COALESCE(sg.percentage, 0)) AS assessment_avg_pct
    FROM student_assessment_relevance sar
    JOIN student_grades sg
        ON sg.assessment_id = sar.assessment_id
       AND sg.student_id    = sar.student_id
       AND sg.subject_id IS NOT NULL
    GROUP BY sar.student_id, sar.class_name, sar.assessment_id
),
student_overall AS (
    -- Step 2: Average the per-assessment averages per student.
    SELECT
        student_id,
        class_name,
        COUNT(DISTINCT assessment_id)              AS assessments_with_scores,
        ROUND(AVG(assessment_avg_pct)::numeric, 2) AS avg_assessment_pct
    FROM per_assessment_avg
    GROUP BY student_id, class_name
    HAVING COUNT(DISTINCT assessment_id) > 0
)
SELECT
    s.id::text                           AS student_id,
    COALESCE(u.full_name, 'Student')     AS student_name,
    so.class_name,
    so.assessments_with_scores,
    so.avg_assessment_pct::float8        AS avg_assessment_pct
FROM student_overall so
JOIN students s ON s.id = so.student_id
JOIN users    u ON u.id = s.user_id
ORDER BY avg_assessment_pct DESC, assessments_with_scores DESC, u.full_name ASC
`
	rows, err := r.db.Query(ctx, query, schoolID, strings.TrimSpace(academicYear))
	if err != nil {
		return nil, fmt.Errorf("GetSchoolAssessmentLeaderboard: %w", err)
	}
	defer rows.Close()

	entries := make([]SchoolAssessmentLeaderboardEntry, 0, 64)
	for rows.Next() {
		var e SchoolAssessmentLeaderboardEntry
		if err := rows.Scan(
			&e.StudentID,
			&e.StudentName,
			&e.ClassName,
			&e.AssessmentsWithScores,
			&e.AvgAssessmentPct,
		); err != nil {
			return nil, fmt.Errorf("GetSchoolAssessmentLeaderboard scan: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetSchoolAssessmentLeaderboard rows: %w", err)
	}
	return entries, nil
}
