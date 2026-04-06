package teacher

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/schools24/backend/internal/shared/database"
	"github.com/schools24/backend/internal/shared/objectstore"
)

// Repository handles database operations for teacher module
type Repository struct {
	db    *database.PostgresDB
	store objectstore.Store
}

// NewRepository creates a new teacher repository
func NewRepository(db *database.PostgresDB, store objectstore.Store) *Repository {
	return &Repository{db: db, store: store}
}

func normalizeSubjectKey(subject string) string {
	return strings.ToLower(strings.TrimSpace(subject))
}

func normalizeClassKey(classLevel string) string {
	raw := strings.ToLower(strings.TrimSpace(classLevel))
	if raw == "" {
		return ""
	}
	raw = strings.Join(strings.Fields(raw), " ")

	if raw == "lkg" || raw == "ukg" || raw == "kg" || raw == "nursery" || raw == "pre-kg" || raw == "pre kg" {
		return raw
	}

	if m := regexp.MustCompile(`(?:class|grade|std|standard)\s*([0-9]{1,2})`).FindStringSubmatch(raw); len(m) == 2 {
		n, err := strconv.Atoi(m[1])
		if err == nil {
			return fmt.Sprintf("class %d", n)
		}
	}
	if m := regexp.MustCompile(`\b([0-9]{1,2})(?:st|nd|rd|th)?\b`).FindStringSubmatch(raw); len(m) == 2 {
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

func isUndefinedTableErr(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
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

// ensureTenantDocumentMetadataTables self-heals old tenant schemas that missed
// document metadata migrations by creating only the tables required for runtime
// document flows. Statements are idempotent.
func (r *Repository) ensureTenantDocumentMetadataTables(ctx context.Context) error {
	if r.db == nil {
		return errors.New("database not configured")
	}

	return r.db.Exec(ctx, `
CREATE TABLE IF NOT EXISTS question_documents (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	teacher_id TEXT NOT NULL,
	teacher_name TEXT NOT NULL DEFAULT '',
	school_id TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL,
	topic TEXT NOT NULL DEFAULT '',
	subject TEXT NOT NULL DEFAULT '',
	class_level TEXT NOT NULL DEFAULT '',
	question_type TEXT NOT NULL DEFAULT '',
	difficulty TEXT NOT NULL DEFAULT '',
	num_questions INTEGER NOT NULL DEFAULT 0,
	context TEXT NOT NULL DEFAULT '',
	file_name TEXT NOT NULL,
	file_size BIGINT NOT NULL DEFAULT 0,
	mime_type TEXT NOT NULL DEFAULT '',
	file_sha256 TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_materials (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	uploader_id TEXT NOT NULL DEFAULT '',
	uploader_name TEXT NOT NULL DEFAULT '',
	uploader_role TEXT NOT NULL DEFAULT '',
	teacher_id TEXT NOT NULL DEFAULT '',
	teacher_name TEXT NOT NULL DEFAULT '',
	school_id TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL,
	subject TEXT NOT NULL DEFAULT '',
	subject_key TEXT NOT NULL DEFAULT '',
	class_level TEXT NOT NULL DEFAULT '',
	class_key TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	file_name TEXT NOT NULL,
	file_size BIGINT NOT NULL DEFAULT 0,
	mime_type TEXT NOT NULL DEFAULT '',
	file_sha256 TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_individual_reports (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	school_id TEXT NOT NULL,
	class_id TEXT NOT NULL DEFAULT '',
	class_name TEXT NOT NULL DEFAULT '',
	student_id TEXT NOT NULL,
	student_name TEXT NOT NULL DEFAULT '',
	teacher_id TEXT NOT NULL,
	teacher_name TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL,
	report_type TEXT NOT NULL DEFAULT 'report',
	academic_year TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	file_name TEXT NOT NULL,
	file_size BIGINT NOT NULL DEFAULT 0,
	mime_type TEXT NOT NULL DEFAULT '',
	file_sha256 TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_homework_attachments (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	school_id TEXT NOT NULL,
	teacher_id TEXT NOT NULL,
	homework_id TEXT NOT NULL,
	file_name TEXT NOT NULL,
	file_size BIGINT NOT NULL DEFAULT 0,
	mime_type TEXT NOT NULL DEFAULT '',
	file_sha256 TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admission_documents (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	school_id TEXT NOT NULL,
	application_id TEXT NOT NULL,
	document_type TEXT NOT NULL,
	file_name TEXT NOT NULL,
	file_size BIGINT NOT NULL DEFAULT 0,
	mime_type TEXT NOT NULL DEFAULT '',
	file_sha256 TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_appointment_documents (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	school_id TEXT NOT NULL,
	application_id TEXT NOT NULL,
	document_type TEXT NOT NULL,
	file_name TEXT NOT NULL,
	file_size BIGINT NOT NULL DEFAULT 0,
	mime_type TEXT NOT NULL DEFAULT '',
	file_sha256 TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_study_materials_dedupe
	ON study_materials(school_id, teacher_id, file_sha256, subject, class_level);
CREATE INDEX IF NOT EXISTS idx_study_materials_teacher_uploaded_at
	ON study_materials(school_id, teacher_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_materials_teacher_subject_class_uploaded
	ON study_materials(school_id, teacher_id, subject, class_level, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_materials_school_class_subject_uploaded
	ON study_materials(school_id, class_level, subject, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_materials_school_class_key_subject_key_uploaded
	ON study_materials(school_id, class_key, subject_key, uploaded_at DESC);
`)
}

// GetTeacherByUserID retrieves a teacher by their user ID
func (r *Repository) GetTeacherByUserID(ctx context.Context, userID uuid.UUID) (*Teacher, error) {
	query := `
		SELECT t.id, t.user_id, t.school_id, t.employee_id, ''::text AS department, t.designation,
		       t.qualifications, t.subjects_taught, t.experience_years,
		       t.rating, t.status,
		       t.created_at, t.updated_at,
		       u.full_name, u.email, u.phone, COALESCE(u.profile_picture_url, '') as avatar
		FROM teachers t
		JOIN users u ON t.user_id = u.id
		WHERE t.user_id = $1
	`

	var t Teacher
	err := r.db.QueryRow(ctx, query, userID).Scan(
		&t.ID, &t.UserID, &t.SchoolID, &t.EmployeeID, &t.Department, &t.Designation,
		&t.Qualifications, &t.SubjectsTaught, &t.Experience,
		&t.Rating, &t.Status,
		&t.CreatedAt, &t.UpdatedAt,
		&t.FullName, &t.Email, &t.Phone, &t.Avatar,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Fallback for partially migrated tenants where teacher rows still live in public schema.
			publicQuery := `
				SELECT t.id, t.user_id, t.school_id, t.employee_id, ''::text AS department, t.designation,
				       t.qualifications, t.subjects_taught, t.experience_years,
				       t.rating, t.status,
				       t.created_at, t.updated_at,
				       u.full_name, u.email, u.phone, COALESCE(u.profile_picture_url, '') as avatar
				FROM public.teachers t
				JOIN users u ON t.user_id = u.id
				WHERE t.user_id = $1
			`
			if err2 := r.db.QueryRow(ctx, publicQuery, userID).Scan(
				&t.ID, &t.UserID, &t.SchoolID, &t.EmployeeID, &t.Department, &t.Designation,
				&t.Qualifications, &t.SubjectsTaught, &t.Experience,
				&t.Rating, &t.Status,
				&t.CreatedAt, &t.UpdatedAt,
				&t.FullName, &t.Email, &t.Phone, &t.Avatar,
			); err2 != nil {
				if errors.Is(err2, pgx.ErrNoRows) {
					return nil, nil
				}
				return nil, err2
			}
			return &t, nil
		}
		return nil, err
	}
	return &t, nil
}

// GetTeacherAssignments retrieves classes assigned to a teacher
func (r *Repository) GetTeacherAssignments(ctx context.Context, teacherID uuid.UUID, academicYear string) ([]TeacherAssignment, error) {
	query := `
		WITH timetable_classes AS (
			SELECT DISTINCT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1
		),
		assignment_classes AS (
			SELECT DISTINCT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1 AND ta.academic_year = $2
		),
		direct_classes AS (
			SELECT class_id FROM timetable_classes
			UNION
			SELECT class_id FROM assignment_classes
		),
		has_direct_classes AS (
			SELECT EXISTS (SELECT 1 FROM direct_classes) AS has_rows
		),
		eligible_classes AS (
			SELECT
				c.id AS class_id,
				(COALESCE(c.class_teacher_id = $1, false) AND NOT h.has_rows) AS is_class_teacher,
				(
					EXISTS (SELECT 1 FROM direct_classes dc WHERE dc.class_id = c.id)
				) AS is_subject_teacher
			FROM classes c
			CROSS JOIN has_direct_classes h
			WHERE EXISTS (SELECT 1 FROM direct_classes dc WHERE dc.class_id = c.id)
			   OR (NOT h.has_rows AND c.class_teacher_id = $1)
		),
		class_years AS (
			SELECT
				c.id AS class_id,
				COALESCE(
					(
						SELECT t.academic_year
						FROM timetables t
						WHERE t.teacher_id = $1
						  AND t.class_id = c.id
						ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
						LIMIT 1
					),
					(
						SELECT ta.academic_year
						FROM teacher_assignments ta
						WHERE ta.teacher_id = $1
						  AND ta.class_id = c.id
						ORDER BY ta.created_at DESC NULLS LAST, ta.id DESC
						LIMIT 1
					),
					$2::text
				) AS academic_year
			FROM classes c
			WHERE EXISTS (SELECT 1 FROM eligible_classes ec WHERE ec.class_id = c.id)
		)
		SELECT
			ec.class_id AS id,
			$1::uuid AS teacher_id,
			ec.class_id,
			NULL::uuid AS subject_id,
			ec.is_class_teacher,
			cy.academic_year,
			c.created_at,
			c.updated_at,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			CASE
				WHEN ec.is_class_teacher AND ec.is_subject_teacher THEN 'Class Incharge, Subject Teacher'
				WHEN ec.is_class_teacher THEN 'Class Incharge'
				ELSE 'Subject Teacher'
			END AS subject_name
		FROM eligible_classes ec
		JOIN classes c ON c.id = ec.class_id
		JOIN class_years cy ON cy.class_id = ec.class_id
		ORDER BY c.grade, c.section NULLS FIRST, c.name
	`

	rows, err := r.db.Query(ctx, query, teacherID, academicYear)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assignments []TeacherAssignment
	for rows.Next() {
		var a TeacherAssignment
		err := rows.Scan(
			&a.ID, &a.TeacherID, &a.ClassID, &a.SubjectID, &a.IsClassTeacher,
			&a.AcademicYear, &a.CreatedAt, &a.UpdatedAt,
			&a.ClassName, &a.SubjectName,
		)
		if err != nil {
			return nil, err
		}
		assignments = append(assignments, a)
	}
	return assignments, nil
}

// CanTeacherMarkAttendance verifies whether a teacher is allowed to mark attendance for a class.
// Direct teaching scope comes first: live timetable rows are year-agnostic, while
// teacher_assignments remain year-scoped. We only fall back to class_teacher_id
// when the teacher has no direct classes at all.
func (r *Repository) CanTeacherMarkAttendance(ctx context.Context, teacherID, classID uuid.UUID, academicYear string) (bool, error) {
	var allowed bool
	query := `
		WITH timetable_classes AS (
			SELECT DISTINCT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1
		),
		assignment_classes AS (
			SELECT DISTINCT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1
			  AND ta.academic_year = $3
		),
		direct_classes AS (
			SELECT class_id FROM timetable_classes
			UNION
			SELECT class_id FROM assignment_classes
		),
		has_direct_classes AS (
			SELECT EXISTS (SELECT 1 FROM direct_classes) AS has_rows
		)
		SELECT
			EXISTS (SELECT 1 FROM direct_classes dc WHERE dc.class_id = $2)
			OR EXISTS (
				SELECT 1
				FROM classes c
				CROSS JOIN has_direct_classes h
				WHERE c.id = $2
				  AND NOT h.has_rows
				  AND c.class_teacher_id = $1
			)
	`
	if err := r.db.QueryRow(ctx, query, teacherID, classID, academicYear).Scan(&allowed); err != nil {
		return false, fmt.Errorf("failed to validate attendance permission: %w", err)
	}
	return allowed, nil
}

func (r *Repository) GetTeacherClassMessageGroups(ctx context.Context, teacherID uuid.UUID, academicYear string) ([]ClassMessageGroup, error) {
	query := `
		WITH timetable_classes AS (
			SELECT DISTINCT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1
		),
		assignment_classes AS (
			SELECT DISTINCT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1 AND ta.academic_year = $2
		),
		direct_classes AS (
			SELECT class_id FROM timetable_classes
			UNION
			SELECT class_id FROM assignment_classes
		),
		has_direct_classes AS (
			SELECT EXISTS (SELECT 1 FROM direct_classes) AS has_rows
		),
		eligible_classes AS (
			SELECT c.id, c.name, c.grade, c.section
			FROM classes c
			CROSS JOIN has_direct_classes h
			WHERE EXISTS (SELECT 1 FROM direct_classes dc WHERE dc.class_id = c.id)
			   OR (NOT h.has_rows AND c.class_teacher_id = $1)
		),
		last_messages AS (
			SELECT DISTINCT ON (m.class_id)
				m.class_id,
				m.content,
				m.created_at,
				u.full_name AS sender_name,
				u.role AS sender_role
			FROM class_group_messages m
			JOIN users u ON u.id = m.sender_id
			ORDER BY m.class_id, m.created_at DESC
		)
		SELECT
			ec.id,
			ec.name,
			COALESCE(ec.grade, 0) AS grade,
			ec.section,
			COALESCE(lm.content, '') AS last_message,
			lm.created_at,
			COALESCE(lm.sender_name, '') AS last_sender_name,
			COALESCE(lm.sender_role, '') AS last_sender_role
		FROM eligible_classes ec
		LEFT JOIN last_messages lm ON lm.class_id = ec.id
		ORDER BY
			COALESCE(lm.created_at, TIMESTAMP '1970-01-01') DESC,
			ec.grade ASC,
			ec.section ASC,
			ec.name ASC
	`

	rows, err := r.db.Query(ctx, query, teacherID, academicYear)
	if err != nil {
		return nil, fmt.Errorf("failed to list class message groups: %w", err)
	}
	defer rows.Close()

	groups := make([]ClassMessageGroup, 0)
	for rows.Next() {
		var group ClassMessageGroup
		if err := rows.Scan(
			&group.ClassID,
			&group.ClassName,
			&group.Grade,
			&group.Section,
			&group.LastMessage,
			&group.LastMessageAt,
			&group.LastSenderName,
			&group.LastSenderRole,
		); err != nil {
			return nil, fmt.Errorf("failed to scan class message group: %w", err)
		}
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate class message groups: %w", err)
	}
	return groups, nil
}

func (r *Repository) ListClassGroupMessages(ctx context.Context, classID uuid.UUID, page, pageSize int64) ([]ClassGroupMessage, bool, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	query := `
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
	`

	rows, err := r.db.Query(ctx, query, classID, pageSize+1, offset)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list class group messages: %w", err)
	}
	defer rows.Close()

	items := make([]ClassGroupMessage, 0, pageSize+1)
	for rows.Next() {
		var msg ClassGroupMessage
		if err := rows.Scan(
			&msg.ID,
			&msg.ClassID,
			&msg.SenderID,
			&msg.SenderName,
			&msg.SenderRole,
			&msg.Content,
			&msg.CreatedAt,
		); err != nil {
			return nil, false, fmt.Errorf("failed to scan class group message: %w", err)
		}
		items = append(items, msg)
	}

	hasMore := int64(len(items)) > pageSize
	if hasMore {
		items = items[:pageSize]
	}
	return items, hasMore, nil
}

func (r *Repository) CreateClassGroupMessage(ctx context.Context, classID, senderID uuid.UUID, content string) (*ClassGroupMessage, error) {
	var msg ClassGroupMessage
	insertQuery := `
		INSERT INTO class_group_messages (class_id, sender_id, content)
		VALUES ($1, $2, $3)
		RETURNING id, class_id, sender_id, content, created_at
	`
	if err := r.db.QueryRow(ctx, insertQuery, classID, senderID, content).Scan(
		&msg.ID,
		&msg.ClassID,
		&msg.SenderID,
		&msg.Content,
		&msg.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("failed to create class group message: %w", err)
	}

	if err := r.db.QueryRow(ctx, `SELECT COALESCE(full_name, ''), COALESCE(role, '') FROM users WHERE id = $1`, senderID).Scan(
		&msg.SenderName,
		&msg.SenderRole,
	); err != nil {
		return nil, fmt.Errorf("failed to resolve sender details: %w", err)
	}

	return &msg, nil
}

// ValidateStudentsInClass ensures all provided students are assigned to the class.
func (r *Repository) ValidateStudentsInClass(ctx context.Context, classID uuid.UUID, studentIDs []uuid.UUID) (bool, error) {
	if len(studentIDs) == 0 {
		return false, nil
	}

	var count int
	query := `
		SELECT COUNT(DISTINCT s.id)
		FROM students s
		WHERE s.class_id = $1
		  AND s.id = ANY($2::uuid[])
	`
	if err := r.db.QueryRow(ctx, query, classID, studentIDs).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to validate students in class: %w", err)
	}
	return count == len(studentIDs), nil
}

// GetTodaySchedule retrieves teacher's schedule for today
func (r *Repository) GetTodaySchedule(ctx context.Context, teacherID uuid.UUID, dayOfWeek int, academicYear string) ([]TodayPeriod, error) {
	query := `
		SELECT t.period_number, t.start_time::text, t.end_time::text,
		       t.class_id::text,
		       c.name as class_name, COALESCE(s.name, gs.name, '') as subject_name,
		       COALESCE(t.room_number, '') as room_number
		FROM timetables t
		JOIN classes c ON t.class_id = c.id
		LEFT JOIN subjects s ON t.subject_id = s.id
		LEFT JOIN public.global_subjects gs ON (s.id IS NULL AND t.subject_id = gs.id)
		WHERE t.teacher_id = $1 AND t.day_of_week = $2 AND t.academic_year = $3
		ORDER BY t.period_number
	`

	rows, err := r.db.Query(ctx, query, teacherID, dayOfWeek, academicYear)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	periods := make([]TodayPeriod, 0)
	for rows.Next() {
		var p TodayPeriod
		err := rows.Scan(&p.PeriodNumber, &p.StartTime, &p.EndTime, &p.ClassID, &p.ClassName, &p.SubjectName, &p.RoomNumber)
		if err != nil {
			return nil, err
		}
		periods = append(periods, p)
	}
	return periods, nil
}

// GetTimetableConfig retrieves timetable configuration
func (r *Repository) GetTimetableConfig(ctx context.Context) (*TimetableConfig, error) {
	daysQuery := `
		SELECT day_of_week, day_name, is_active
		FROM timetable_days
		ORDER BY day_of_week
	`

	dayRows, err := r.db.Query(ctx, daysQuery)
	if err != nil {
		return nil, err
	}
	defer dayRows.Close()

	var days []TimetableDayConfig
	for dayRows.Next() {
		var d TimetableDayConfig
		if err := dayRows.Scan(&d.DayOfWeek, &d.DayName, &d.IsActive); err != nil {
			return nil, err
		}
		days = append(days, d)
	}

	periodsQuery := `
		SELECT period_number, start_time::text, end_time::text, is_break, break_name
		FROM timetable_periods
		ORDER BY period_number
	`

	periodRows, err := r.db.Query(ctx, periodsQuery)
	if err != nil {
		return nil, err
	}
	defer periodRows.Close()

	var periods []TimetablePeriodConfig
	for periodRows.Next() {
		var p TimetablePeriodConfig
		var breakName *string
		if err := periodRows.Scan(&p.PeriodNumber, &p.StartTime, &p.EndTime, &p.IsBreak, &breakName); err != nil {
			return nil, err
		}
		p.BreakName = breakName
		periods = append(periods, p)
	}

	return &TimetableConfig{Days: days, Periods: periods}, nil
}

// GetTeacherLeaderboard returns leaderboard entries for the school and academic year.
func (r *Repository) GetTeacherLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string, limit int) ([]TeacherLeaderboardEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	// Compute rankings live from the teachers table so that ranks always reflect
	// the current ratings, regardless of whether the cache table has been refreshed.
	// students_count = distinct students in classes the teacher is assigned to for
	// the given academic year (via timetable).
	query := `
		WITH teacher_stats AS (
			SELECT
				t.id                                       AS teacher_id,
				COALESCE(u.full_name, 'Teacher')           AS name,
				''::text                                   AS department,
				COALESCE(t.rating, 0)::float8              AS rating,
				COALESCE(u.is_active, true)                AS is_active,
				COUNT(DISTINCT s.id)                       AS students_count
			FROM teachers t
			LEFT JOIN users u ON u.id = t.user_id
			LEFT JOIN timetables tt
				ON tt.teacher_id = t.id
			LEFT JOIN students s ON s.class_id = tt.class_id
			WHERE (t.school_id = $1 OR t.school_id IS NULL)
			GROUP BY t.id, u.full_name, t.rating, u.is_active
		),
		ranked AS (
			SELECT
				ROW_NUMBER() OVER (ORDER BY rating DESC, teacher_id)::int AS rank,
				teacher_id,
				name,
				department,
				rating,
				students_count::int,
				CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
				CASE
					WHEN rating >= 4.5 THEN 'up'
					WHEN rating < 3.0  THEN 'down'
					ELSE 'stable'
				END AS trend
			FROM teacher_stats
		)
		SELECT rank, teacher_id::text, name, department, rating, students_count, status, trend
		FROM ranked
		ORDER BY rank ASC
		LIMIT $2
	`

	rows, err := r.db.Query(ctx, query, schoolID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch teacher leaderboard: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherLeaderboardEntry, 0)
	for rows.Next() {
		var item TeacherLeaderboardEntry
		if err := rows.Scan(
			&item.Rank,
			&item.TeacherID,
			&item.Name,
			&item.Department,
			&item.Rating,
			&item.StudentsCount,
			&item.Status,
			&item.Trend,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

// GetTeacherLeaderboardEntry returns the leaderboard entry for a single teacher.
// Rank is computed live so it always reflects current ratings.
func (r *Repository) GetTeacherLeaderboardEntry(ctx context.Context, schoolID uuid.UUID, academicYear string, teacherID uuid.UUID) (*TeacherLeaderboardEntry, error) {
	query := `
		WITH teacher_stats AS (
			SELECT
				t.id                                       AS teacher_id,
				COALESCE(u.full_name, 'Teacher')           AS name,
				''::text                                   AS department,
				COALESCE(t.rating, 0)::float8              AS rating,
				COALESCE(u.is_active, true)                AS is_active,
				COUNT(DISTINCT s.id)                       AS students_count
			FROM teachers t
			LEFT JOIN users u ON u.id = t.user_id
			LEFT JOIN timetables tt
				ON tt.teacher_id = t.id
			LEFT JOIN students s ON s.class_id = tt.class_id
			WHERE (t.school_id = $1 OR t.school_id IS NULL)
			GROUP BY t.id, u.full_name, t.rating, u.is_active
		),
		ranked AS (
			SELECT
				ROW_NUMBER() OVER (ORDER BY rating DESC, teacher_id)::int AS rank,
				teacher_id,
				name,
				department,
				rating,
				students_count::int,
				CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
				CASE
					WHEN rating >= 4.5 THEN 'up'
					WHEN rating < 3.0  THEN 'down'
					ELSE 'stable'
				END AS trend
			FROM teacher_stats
		)
		SELECT rank, teacher_id::text, name, department, rating, students_count, status, trend
		FROM ranked
		WHERE teacher_id = $2
	`

	var item TeacherLeaderboardEntry
	if err := r.db.QueryRow(ctx, query, schoolID, teacherID).Scan(
		&item.Rank,
		&item.TeacherID,
		&item.Name,
		&item.Department,
		&item.Rating,
		&item.StudentsCount,
		&item.Status,
		&item.Trend,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	return &item, nil
}

// GetTeacherTimetable returns timetable entries for a teacher.
// Academic year filtering is intentionally omitted: schools operate one live
// timetable across years, so we always pick the newest row per (day, period)
// using update/create timestamps rather than academic year text ordering.
func (r *Repository) GetTeacherTimetable(ctx context.Context, teacherID uuid.UUID, academicYear string) ([]TimetableEntry, error) {
	query := `
		SELECT DISTINCT ON (t.day_of_week, t.period_number)
		       t.id, t.class_id, t.day_of_week, t.period_number, t.subject_id, t.teacher_id,
		       t.start_time::text, t.end_time::text, t.room_number, t.academic_year,
		       COALESCE(s.name, gs.name, '') as subject_name,
		       COALESCE(u.full_name, '') as teacher_name,
		       COALESCE(c.name, '') as class_name
		FROM timetables t
		LEFT JOIN subjects s ON t.subject_id = s.id
		LEFT JOIN public.global_subjects gs ON (s.id IS NULL AND t.subject_id = gs.id)
		LEFT JOIN teachers te ON t.teacher_id = te.id
		LEFT JOIN users u ON te.user_id = u.id
		LEFT JOIN classes c ON t.class_id = c.id
		WHERE t.teacher_id = $1
		ORDER BY t.day_of_week, t.period_number, t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
	`

	rows, err := r.db.Query(ctx, query, teacherID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]TimetableEntry, 0)
	for rows.Next() {
		var t TimetableEntry
		if err := rows.Scan(
			&t.ID, &t.ClassID, &t.DayOfWeek, &t.PeriodNumber, &t.SubjectID, &t.TeacherID,
			&t.StartTime, &t.EndTime, &t.RoomNumber, &t.AcademicYear,
			&t.SubjectName, &t.TeacherName, &t.ClassName,
		); err != nil {
			return nil, err
		}
		entries = append(entries, t)
	}

	return entries, nil
}

// GetClassTimetable returns timetable entries for a class (teacher view).
// Academic year filtering is intentionally omitted: schools operate one live
// timetable across years, so we always pick the newest row per (day, period)
// using update/create timestamps rather than academic year text ordering.
func (r *Repository) GetClassTimetable(ctx context.Context, classID uuid.UUID, academicYear string) ([]TimetableEntry, error) {
	query := `
		SELECT DISTINCT ON (t.day_of_week, t.period_number)
		       t.id, t.class_id, t.day_of_week, t.period_number, t.subject_id, t.teacher_id,
		       t.start_time::text, t.end_time::text, t.room_number, t.academic_year,
		       COALESCE(s.name, gs.name, '') as subject_name,
		       COALESCE(u.full_name, '') as teacher_name,
		       COALESCE(c.name, '') as class_name
		FROM timetables t
		LEFT JOIN subjects s ON t.subject_id = s.id
		LEFT JOIN public.global_subjects gs ON (s.id IS NULL AND t.subject_id = gs.id)
		LEFT JOIN teachers te ON t.teacher_id = te.id
		LEFT JOIN users u ON te.user_id = u.id
		LEFT JOIN classes c ON t.class_id = c.id
		WHERE t.class_id = $1
		ORDER BY t.day_of_week, t.period_number, t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
	`

	rows, err := r.db.Query(ctx, query, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]TimetableEntry, 0)
	for rows.Next() {
		var t TimetableEntry
		if err := rows.Scan(
			&t.ID, &t.ClassID, &t.DayOfWeek, &t.PeriodNumber, &t.SubjectID, &t.TeacherID,
			&t.StartTime, &t.EndTime, &t.RoomNumber, &t.AcademicYear,
			&t.SubjectName, &t.TeacherName, &t.ClassName,
		); err != nil {
			return nil, err
		}
		entries = append(entries, t)
	}

	return entries, nil
}

func (r *Repository) GetTeacherQuestionUploaderClasses(ctx context.Context, teacherID uuid.UUID, academicYear string) ([]QuestionUploaderClassOption, error) {
	query := `
		WITH timetable_classes AS (
			SELECT DISTINCT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1 AND t.academic_year = $2
		),
		assignment_classes AS (
			SELECT DISTINCT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1 AND ta.academic_year = $2
		),
		eligible_classes AS (
			SELECT
				c.id AS class_id,
				COALESCE(c.class_teacher_id = $1, false) AS is_class_teacher,
				(
					EXISTS (SELECT 1 FROM timetable_classes tc WHERE tc.class_id = c.id)
					OR EXISTS (SELECT 1 FROM assignment_classes ac WHERE ac.class_id = c.id)
				) AS is_subject_teacher
			FROM classes c
			WHERE c.class_teacher_id = $1
			   OR EXISTS (SELECT 1 FROM timetable_classes tc WHERE tc.class_id = c.id)
			   OR EXISTS (SELECT 1 FROM assignment_classes ac WHERE ac.class_id = c.id)
		)
		SELECT
			ec.class_id,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			c.name AS class_level
		FROM eligible_classes ec
		JOIN classes c ON c.id = ec.class_id
		ORDER BY c.grade, c.section NULLS FIRST, c.name
	`

	rows, err := r.db.Query(ctx, query, teacherID, academicYear)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	options := make([]QuestionUploaderClassOption, 0)
	for rows.Next() {
		var classID uuid.UUID
		var className string
		var classLevel string
		if err := rows.Scan(&classID, &className, &classLevel); err != nil {
			return nil, err
		}
		options = append(options, QuestionUploaderClassOption{
			ClassID:    classID.String(),
			ClassName:  className,
			ClassLevel: classLevel,
			Subjects:   []string{},
		})
	}
	return options, nil
}

func (r *Repository) GetTeacherTaughtSubjectsForClass(ctx context.Context, teacherID, classID uuid.UUID, academicYear string) ([]string, error) {
	query := `
		WITH src AS (
			SELECT t.subject_id
			FROM timetables t
			WHERE t.teacher_id = $1
			  AND t.class_id = $2
			  AND t.academic_year = $3
			  AND t.subject_id IS NOT NULL
			UNION
			SELECT ta.subject_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1
			  AND ta.class_id = $2
			  AND ta.academic_year = $3
			  AND ta.subject_id IS NOT NULL
		)
		SELECT DISTINCT TRIM(s.name) AS subject_name
		FROM src
		JOIN subjects s ON s.id = src.subject_id
		WHERE COALESCE(TRIM(s.name), '') <> ''
		ORDER BY subject_name
	`

	rows, err := r.db.Query(ctx, query, teacherID, classID, academicYear)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	subjects := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		subjects = append(subjects, name)
	}
	return subjects, nil
}

func (r *Repository) GetTeacherTaughtSubjectOptionsForClass(ctx context.Context, teacherID, classID uuid.UUID, academicYear string) ([]HomeworkSubjectOption, error) {
	query := `
		WITH src AS (
			SELECT t.subject_id
			FROM timetables t
			WHERE t.teacher_id = $1
			  AND t.class_id = $2
			  AND t.academic_year = $3
			  AND t.subject_id IS NOT NULL
			UNION
			SELECT ta.subject_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1
			  AND ta.class_id = $2
			  AND ta.academic_year = $3
			  AND ta.subject_id IS NOT NULL
		)
		SELECT DISTINCT s.id::text, TRIM(s.name) AS subject_name
		FROM src
		JOIN subjects s ON s.id = src.subject_id
		WHERE COALESCE(TRIM(s.name), '') <> ''
		ORDER BY subject_name
	`

	rows, err := r.db.Query(ctx, query, teacherID, classID, academicYear)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	options := make([]HomeworkSubjectOption, 0)
	for rows.Next() {
		var opt HomeworkSubjectOption
		if err := rows.Scan(&opt.SubjectID, &opt.SubjectName); err != nil {
			return nil, err
		}
		options = append(options, opt)
	}
	return options, nil
}

func (r *Repository) GetGlobalSubjectsByClassLevel(ctx context.Context, classLevel string) ([]string, error) {
	query := `
		SELECT gc.name, gs.name
		FROM public.global_classes gc
		JOIN public.global_class_subjects gcs ON gcs.class_id = gc.id
		JOIN public.global_subjects gs ON gs.id = gcs.subject_id
		ORDER BY gc.name, gs.name
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	classKey := normalizeClassKey(classLevel)
	subjectSet := make(map[string]string)
	for rows.Next() {
		var gcName string
		var name string
		if err := rows.Scan(&gcName, &name); err != nil {
			return nil, err
		}
		if classKey == "" || normalizeClassKey(gcName) != classKey {
			continue
		}
		key := normalizeSubjectKey(name)
		if key == "" {
			continue
		}
		if _, exists := subjectSet[key]; !exists {
			subjectSet[key] = strings.TrimSpace(name)
		}
	}
	subjects := make([]string, 0, len(subjectSet))
	for _, name := range subjectSet {
		subjects = append(subjects, name)
	}
	sort.Strings(subjects)
	return subjects, nil
}

func (r *Repository) IsGlobalClassSubjectMapped(ctx context.Context, classLevel, subject string) (bool, error) {
	query := `
		SELECT gc.name, gs.name
		FROM public.global_classes gc
		JOIN public.global_class_subjects gcs ON gcs.class_id = gc.id
		JOIN public.global_subjects gs ON gs.id = gcs.subject_id
	`
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	classKey := normalizeClassKey(classLevel)
	subjectKey := normalizeSubjectKey(subject)
	if classKey == "" || subjectKey == "" {
		return false, nil
	}

	for rows.Next() {
		var gcName string
		var gsName string
		if err := rows.Scan(&gcName, &gsName); err != nil {
			return false, err
		}
		if normalizeClassKey(gcName) == classKey && normalizeSubjectKey(gsName) == subjectKey {
			return true, nil
		}
	}
	return false, nil
}

func (r *Repository) CanTeacherAssignHomework(ctx context.Context, teacherID, classID, subjectID uuid.UUID, academicYear string) (bool, error) {
	var allowed bool
	query := `
		SELECT EXISTS (
			SELECT 1
			FROM timetables t
			WHERE t.teacher_id = $1
			  AND t.class_id = $2
			  AND t.subject_id = $3
			  AND t.academic_year = $4
		) OR EXISTS (
			SELECT 1
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1
			  AND ta.class_id = $2
			  AND ta.subject_id = $3
			  AND ta.academic_year = $4
		)
	`
	if err := r.db.QueryRow(ctx, query, teacherID, classID, subjectID, academicYear).Scan(&allowed); err != nil {
		return false, fmt.Errorf("failed to validate homework permission: %w", err)
	}
	return allowed, nil
}

// GetStudentCountByClasses gets total students for teacher's classes
func (r *Repository) GetStudentCountByClasses(ctx context.Context, teacherID uuid.UUID, academicYear string) (int, error) {
	query := `
		WITH timetable_classes AS (
			SELECT DISTINCT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1
		),
		assignment_classes AS (
			SELECT DISTINCT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1 AND ta.academic_year = $2
		),
		homework_classes AS (
			SELECT DISTINCT h.class_id
			FROM homework h
			WHERE h.teacher_id = $1
			  AND h.class_id IS NOT NULL
		),
		direct_classes AS (
			SELECT class_id FROM timetable_classes
			UNION
			SELECT class_id FROM assignment_classes
			UNION
			SELECT class_id FROM homework_classes
		),
		has_direct_classes AS (
			SELECT EXISTS (SELECT 1 FROM direct_classes) AS has_rows
		),
		eligible_classes AS (
			SELECT c.id
			FROM classes c
			CROSS JOIN has_direct_classes h
			WHERE EXISTS (SELECT 1 FROM direct_classes dc WHERE dc.class_id = c.id)
			   OR (NOT h.has_rows AND c.class_teacher_id = $1)
		)
		SELECT COUNT(DISTINCT s.id)
		FROM students s
		WHERE s.class_id IN (SELECT id FROM eligible_classes)
	`

	var count int
	err := r.db.QueryRow(ctx, query, teacherID, academicYear).Scan(&count)
	return count, err
}

// GetPendingHomeworkCount gets count of homework pending grading
func (r *Repository) GetPendingHomeworkCount(ctx context.Context, teacherID uuid.UUID) (int, error) {
	query := `
		SELECT COUNT(hs.id)
		FROM homework_submissions hs
		JOIN homework h ON hs.homework_id = h.id
		WHERE h.teacher_id = $1
		  AND hs.status = 'submitted'
		  AND h.due_date::date < CURRENT_DATE
	`

	var count int
	err := r.db.QueryRow(ctx, query, teacherID).Scan(&count)
	return count, err
}

// GetAssignedClassCount returns the number of distinct classes a teacher is assigned to
// (from timetables + teacher_assignments + class_teacher_id) for the given academic year.
func (r *Repository) GetAssignedClassCount(ctx context.Context, teacherID uuid.UUID, academicYear string) (int, error) {
	query := `
		WITH timetable_classes AS (
			SELECT DISTINCT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1
		),
		assignment_classes AS (
			SELECT DISTINCT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1 AND ta.academic_year = $2
		),
		homework_classes AS (
			SELECT DISTINCT h.class_id
			FROM homework h
			WHERE h.teacher_id = $1
			  AND h.class_id IS NOT NULL
		),
		direct_classes AS (
			SELECT class_id FROM timetable_classes
			UNION
			SELECT class_id FROM assignment_classes
			UNION
			SELECT class_id FROM homework_classes
		),
		has_direct_classes AS (
			SELECT EXISTS (SELECT 1 FROM direct_classes) AS has_rows
		)
		SELECT COUNT(DISTINCT c.id)
		FROM classes c
		CROSS JOIN has_direct_classes h
		WHERE EXISTS (SELECT 1 FROM direct_classes dc WHERE dc.class_id = c.id)
		   OR (NOT h.has_rows AND c.class_teacher_id = $1)
	`

	var count int
	err := r.db.QueryRow(ctx, query, teacherID, academicYear).Scan(&count)
	return count, err
}

// GetHomeworkSubmittedCount returns the total number of homework submissions
// for all homework created by this teacher.
func (r *Repository) GetHomeworkSubmittedCount(ctx context.Context, teacherID uuid.UUID) (int, error) {
	query := `
		SELECT COUNT(hs.id)
		FROM homework_submissions hs
		JOIN homework h ON hs.homework_id = h.id
		WHERE h.teacher_id = $1
	`

	var count int
	err := r.db.QueryRow(ctx, query, teacherID).Scan(&count)
	return count, err
}

func (r *Repository) GetClassPerformance(ctx context.Context, teacherID uuid.UUID, academicYear string) ([]ClassPerformance, error) {
	query := `
		WITH timetable_classes AS (
			SELECT DISTINCT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1
		),
		assignment_classes AS (
			SELECT DISTINCT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1 AND ta.academic_year = $2
		),
		homework_classes AS (
			SELECT DISTINCT h.class_id
			FROM homework h
			WHERE h.teacher_id = $1
			  AND h.class_id IS NOT NULL
		),
		direct_classes AS (
			SELECT class_id FROM timetable_classes
			UNION
			SELECT class_id FROM assignment_classes
			UNION
			SELECT class_id FROM homework_classes
		),
		has_direct_classes AS (
			SELECT EXISTS (SELECT 1 FROM direct_classes) AS has_rows
		),
		eligible_classes AS (
			SELECT
				c.id AS class_id,
				CASE
					WHEN COALESCE(c.section, '') = '' THEN c.name
					WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
					ELSE c.name || '-' || c.section
				END AS class_name,
				c.grade AS class_grade
			FROM classes c
			CROSS JOIN has_direct_classes h
			WHERE EXISTS (SELECT 1 FROM direct_classes dc WHERE dc.class_id = c.id)
			   OR (NOT h.has_rows AND c.class_teacher_id = $1)
		),
		per_student_avg AS (
			SELECT
				st.class_id,
				sg.student_id,
				AVG(COALESCE(sg.percentage, 0)) AS student_avg_pct
			FROM student_grades sg
			JOIN students st ON st.id = sg.student_id
			JOIN assessments a ON a.id = sg.assessment_id
			WHERE st.class_id IN (SELECT class_id FROM eligible_classes)
			  AND ($2 = '' OR a.academic_year = $2)
			  AND sg.subject_id IS NOT NULL
			  AND sg.percentage IS NOT NULL
			GROUP BY st.class_id, sg.student_id
		),
		class_rollup AS (
			SELECT
				psa.class_id,
				ROUND(AVG(psa.student_avg_pct)::numeric, 2)::float8 AS class_avg_pct,
				COUNT(psa.student_id)::int AS assessed_student_count
			FROM per_student_avg psa
			GROUP BY psa.class_id
		)
		SELECT
			ec.class_id::text,
			ec.class_name,
			COALESCE(cr.class_avg_pct, 0)::float8 AS average_score,
			COALESCE(cr.assessed_student_count, 0)::int AS student_count
		FROM eligible_classes ec
		LEFT JOIN class_rollup cr ON cr.class_id = ec.class_id
		ORDER BY ec.class_grade ASC, ec.class_name ASC
	`

	rows, err := r.db.Query(ctx, query, teacherID, academicYear)
	if err != nil {
		return nil, fmt.Errorf("failed to get class performance: %w", err)
	}
	defer rows.Close()

	items := make([]ClassPerformance, 0, 16)
	for rows.Next() {
		var item ClassPerformance
		if err := rows.Scan(&item.ClassID, &item.ClassName, &item.AverageScore, &item.StudentCount); err != nil {
			return nil, fmt.Errorf("failed to scan class performance: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate class performance: %w", err)
	}
	return items, nil
}

func (r *Repository) GetUpcomingTeacherQuizzes(ctx context.Context, teacherID uuid.UUID, limit int) ([]DashboardQuizItem, error) {
	if limit <= 0 {
		limit = 3
	}
	if limit > 20 {
		limit = 20
	}

	// Show all non-completed quizzes for this teacher.
	// Order: future-scheduled first (ascending), then anytime/active (by creation desc).
	rows, err := r.db.Query(ctx, `
		SELECT
			q.id::text,
			q.title,
			COALESCE(s.name, '') AS subject_name,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			COALESCE(q.scheduled_at, q.created_at),
			q.duration_minutes,
			q.is_anytime
		FROM quizzes q
		JOIN classes c ON c.id = q.class_id
		LEFT JOIN subjects s ON s.id = q.subject_id
		WHERE q.teacher_id = $1
		  AND q.status <> 'completed'
		ORDER BY
			CASE WHEN q.is_anytime = false AND q.scheduled_at > NOW() THEN 0 ELSE 1 END ASC,
			q.scheduled_at ASC NULLS LAST,
			q.created_at DESC
		LIMIT $2
	`, teacherID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get upcoming quizzes: %w", err)
	}
	defer rows.Close()

	items := make([]DashboardQuizItem, 0, limit)
	for rows.Next() {
		var item DashboardQuizItem
		if err := rows.Scan(&item.ID, &item.Title, &item.SubjectName, &item.ClassName, &item.ScheduledAt, &item.DurationMinutes, &item.IsAnytime); err != nil {
			return nil, fmt.Errorf("failed to scan upcoming quiz: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate upcoming quizzes: %w", err)
	}
	return items, nil
}

func (r *Repository) GetRecentHomeworkActivity(ctx context.Context, teacherID uuid.UUID, limit int) ([]StudentActivityItem, error) {
	if limit <= 0 {
		limit = 4
	}
	if limit > 50 {
		limit = 50
	}

	rows, err := r.db.Query(ctx, `
		SELECT
			s.id::text AS student_id,
			COALESCE(u.full_name, '') AS student_name,
			h.id::text AS homework_id,
			COALESCE(h.title, '') AS homework_title,
			hs.submitted_at,
			COALESCE(hs.status, 'submitted') AS status
		FROM homework_submissions hs
		JOIN homework h ON h.id = hs.homework_id
		JOIN students s ON s.id = hs.student_id
		JOIN users u ON u.id = s.user_id
		WHERE h.teacher_id = $1
		  AND hs.status IN ('submitted', 'graded')
		ORDER BY hs.submitted_at DESC
		LIMIT $2
	`, teacherID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get recent homework activity: %w", err)
	}
	defer rows.Close()

	items := make([]StudentActivityItem, 0, limit)
	for rows.Next() {
		var item StudentActivityItem
		if err := rows.Scan(&item.StudentID, &item.StudentName, &item.HomeworkID, &item.HomeworkTitle, &item.SubmittedAt, &item.Status); err != nil {
			return nil, fmt.Errorf("failed to scan recent homework activity: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate recent homework activity: %w", err)
	}
	return items, nil
}

// MarkAttendance marks attendance for a class
func (r *Repository) MarkAttendance(ctx context.Context, teacherID uuid.UUID, markedByUserID uuid.UUID, classID uuid.UUID, date time.Time, records []StudentAttendance, photoURL string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var schoolID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT school_id FROM classes WHERE id = $1`, classID).Scan(&schoolID); err != nil {
		return fmt.Errorf("failed to resolve class school_id: %w", err)
	}

	// 1. Create/Update Attendance Session (Photo proof)
	if photoURL != "" {
		sessionQuery := `
			INSERT INTO attendance_sessions (class_id, teacher_id, date, photo_url, created_at)
			VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
			ON CONFLICT (class_id, date) 
			DO UPDATE SET photo_url = EXCLUDED.photo_url, teacher_id = EXCLUDED.teacher_id
		`
		if _, err := tx.Exec(ctx, sessionQuery, classID, teacherID, date, photoURL); err != nil {
			return err
		}
	}

	// 2. Insert/Update individual Student Records (batch upsert)
	// This avoids N round-trips for a class of N students.
	studentIDs := make([]uuid.UUID, 0, len(records))
	statuses := make([]string, 0, len(records))
	remarks := make([]*string, 0, len(records))

	for _, record := range records {
		studentID, err := uuid.Parse(record.StudentID)
		if err != nil {
			continue // Skip invalid uuid
		}
		studentIDs = append(studentIDs, studentID)
		statuses = append(statuses, record.Status)
		if strings.TrimSpace(record.Remarks) == "" {
			remarks = append(remarks, nil)
		} else {
			r := record.Remarks
			remarks = append(remarks, &r)
		}
	}

	if len(studentIDs) > 0 {
		query := `
			INSERT INTO attendance (school_id, student_id, class_id, date, status, remarks, marked_by)
			SELECT
				$1::uuid,
				unnest($2::uuid[]),
				$3::uuid,
				$4::date,
				unnest($5::text[]),
				unnest($6::text[]),
				$7::uuid
			ON CONFLICT (student_id, date)
			DO UPDATE SET
				status = EXCLUDED.status,
				remarks = EXCLUDED.remarks,
				marked_by = EXCLUDED.marked_by
		`

		// Note: We pass remarks as []string to align lengths; nil remarks become empty string.
		remarksText := make([]string, len(remarks))
		for i, rmk := range remarks {
			if rmk == nil {
				remarksText[i] = ""
			} else {
				remarksText[i] = *rmk
			}
		}

		if _, err := tx.Exec(ctx, query, schoolID, studentIDs, classID, date, statuses, remarksText, markedByUserID); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// CreateHomework creates a new homework assignment
func (r *Repository) CreateHomework(ctx context.Context, teacherID uuid.UUID, hw *CreateHomeworkRequest) (uuid.UUID, error) {
	classID, err := uuid.Parse(strings.TrimSpace(hw.ClassID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid class_id: %w", err)
	}
	subjectID, err := uuid.Parse(strings.TrimSpace(hw.SubjectID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid subject_id: %w", err)
	}

	dueDate, err := time.Parse(time.RFC3339, hw.DueDate)
	if err != nil {
		dueDate, err = time.Parse("2006-01-02", hw.DueDate)
		if err != nil {
			return uuid.Nil, fmt.Errorf("invalid due date format")
		}
	}

	query := `
		INSERT INTO homework (
			title, description, class_id, subject_id, teacher_id, due_date, max_marks,
			attachments, attachment_count, has_attachments
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE(array_length($8::text[], 1), 0), COALESCE(array_length($8::text[], 1), 0) > 0)
		RETURNING id
	`

	maxMarks := hw.MaxMarks
	if maxMarks == 0 {
		maxMarks = 100
	}

	var id uuid.UUID
	err = r.db.QueryRow(ctx, query,
		hw.Title, hw.Description, classID, subjectID, teacherID,
		dueDate, maxMarks, hw.Attachments,
	).Scan(&id)

	return id, err
}

func (r *Repository) UpdateHomeworkAttachments(ctx context.Context, teacherID, homeworkID uuid.UUID, attachmentIDs []string) error {
	query := `
		UPDATE homework
		SET attachments = $1,
		    attachment_count = COALESCE(array_length($1::text[], 1), 0),
		    has_attachments = COALESCE(array_length($1::text[], 1), 0) > 0
		WHERE id = $2 AND teacher_id = $3
	`
	tag, err := r.db.ExecResult(ctx, query, attachmentIDs, homeworkID, teacherID)
	if err != nil {
		return fmt.Errorf("failed to update homework attachments: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) DeleteHomeworkAttachmentsByIDs(ctx context.Context, schoolID string, teacherID, homeworkID uuid.UUID, attachmentIDs []string) error {
	if r.db == nil {
		return errors.New("database not configured")
	}
	filtered := make([]string, 0, len(attachmentIDs))
	for _, id := range attachmentIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	if len(filtered) == 0 {
		return nil
	}

	keys := make([]string, 0, len(filtered))
	rows, err := r.db.Query(ctx, `
		SELECT storage_key
		FROM teacher_homework_attachments
		WHERE school_id = $1 AND teacher_id = $2 AND homework_id = $3 AND id::text = ANY($4::text[])
	`, strings.TrimSpace(schoolID), teacherID.String(), homeworkID.String(), filtered)
	if err != nil {
		return fmt.Errorf("failed to load homework attachment storage keys: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if scanErr := rows.Scan(&key); scanErr != nil {
			return fmt.Errorf("failed to scan homework attachment storage key: %w", scanErr)
		}
		if strings.TrimSpace(key) != "" {
			keys = append(keys, key)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate homework attachment storage keys: %w", err)
	}

	_, err = r.db.ExecResult(ctx, `
		DELETE FROM teacher_homework_attachments
		WHERE school_id = $1 AND teacher_id = $2 AND homework_id = $3 AND id::text = ANY($4::text[])
	`, strings.TrimSpace(schoolID), teacherID.String(), homeworkID.String(), filtered)
	if err != nil {
		return fmt.Errorf("failed to delete homework attachments metadata: %w", err)
	}

	for _, key := range keys {
		if delErr := objectstore.DeleteDocumentWithFallback(ctx, r.store, key); delErr != nil {
			return fmt.Errorf("failed to delete homework attachment object from storage: %w", delErr)
		}
	}

	return nil
}

func (r *Repository) DeleteHomeworkByIDForTeacher(ctx context.Context, teacherID, homeworkID uuid.UUID) error {
	tag, err := r.db.ExecResult(ctx, `DELETE FROM homework WHERE id = $1 AND teacher_id = $2`, homeworkID, teacherID)
	if err != nil {
		return fmt.Errorf("failed to delete homework: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) ListTeacherHomeworkPaged(ctx context.Context, teacherID uuid.UUID, page, pageSize int64, classID, subjectID, search string) ([]TeacherHomeworkItem, bool, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	where := []string{"h.teacher_id = $1"}
	args := []any{teacherID}
	idx := 2

	if trimmed := strings.TrimSpace(classID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "h.class_id = $"+strconv.Itoa(idx))
			args = append(args, parsed)
			idx++
		}
	}
	if trimmed := strings.TrimSpace(subjectID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "h.subject_id = $"+strconv.Itoa(idx))
			args = append(args, parsed)
			idx++
		}
	}
	if trimmed := strings.TrimSpace(search); trimmed != "" {
		where = append(where, "(h.title ILIKE $"+strconv.Itoa(idx)+" OR COALESCE(h.description,'') ILIKE $"+strconv.Itoa(idx)+")")
		args = append(args, "%"+trimmed+"%")
		idx++
	}

	whereClause := strings.Join(where, " AND ")
	query := `
		SELECT
			h.id::text,
			h.title,
			COALESCE(h.description, ''),
			h.class_id::text,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			COALESCE(h.subject_id::text, ''),
			COALESCE(s.name, ''),
			h.due_date,
			h.max_marks,
			COALESCE(sub.submissions_count, 0),
			COALESCE(st.students_count, 0),
			COALESCE(h.attachment_count, COALESCE(array_length(h.attachments, 1), 0)),
			COALESCE(h.has_attachments, COALESCE(array_length(h.attachments, 1), 0) > 0),
			COALESCE(h.attachments, ARRAY[]::text[]),
			h.created_at
		FROM homework h
		JOIN classes c ON c.id = h.class_id
		LEFT JOIN subjects s ON s.id = h.subject_id
		LEFT JOIN LATERAL (
			SELECT COUNT(*)::int AS submissions_count
			FROM homework_submissions hs
			WHERE hs.homework_id = h.id
		) sub ON TRUE
		LEFT JOIN LATERAL (
			SELECT COUNT(*)::int AS students_count
			FROM students st
			WHERE st.class_id = h.class_id
		) st ON TRUE
		WHERE ` + whereClause + `
		ORDER BY h.created_at DESC
		LIMIT $` + strconv.Itoa(idx) + ` OFFSET $` + strconv.Itoa(idx+1)
	args = append(args, pageSize+1, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list teacher homework: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherHomeworkItem, 0, pageSize+1)
	for rows.Next() {
		var item TeacherHomeworkItem
		var attachments []string
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Description,
			&item.ClassID,
			&item.ClassName,
			&item.SubjectID,
			&item.SubjectName,
			&item.DueDate,
			&item.MaxMarks,
			&item.SubmissionsCount,
			&item.StudentsCount,
			&item.AttachmentCount,
			&item.HasAttachments,
			&attachments,
			&item.CreatedAt,
		); err != nil {
			return nil, false, fmt.Errorf("failed to scan teacher homework: %w", err)
		}
		item.Attachments = make([]HomeworkAttachmentMeta, 0, len(attachments))
		for _, attachmentID := range attachments {
			if strings.TrimSpace(attachmentID) == "" {
				continue
			}
			item.Attachments = append(item.Attachments, HomeworkAttachmentMeta{ID: attachmentID})
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("failed to iterate teacher homework: %w", err)
	}

	hasMore := int64(len(items)) > pageSize
	if hasMore {
		items = items[:pageSize]
	}
	return items, hasMore, nil
}

func (r *Repository) GetHomeworkByIDForTeacher(ctx context.Context, teacherID, homeworkID uuid.UUID) (*TeacherHomeworkItem, error) {
	query := `
		SELECT
			h.id::text,
			h.title,
			COALESCE(h.description, ''),
			h.class_id::text,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			COALESCE(h.subject_id::text, ''),
			COALESCE(s.name, ''),
			h.due_date,
			h.max_marks,
			COALESCE(sub.submissions_count, 0),
			COALESCE(st.students_count, 0),
			COALESCE(h.attachment_count, COALESCE(array_length(h.attachments, 1), 0)),
			COALESCE(h.has_attachments, COALESCE(array_length(h.attachments, 1), 0) > 0),
			COALESCE(h.attachments, ARRAY[]::text[]),
			h.created_at
		FROM homework h
		JOIN classes c ON c.id = h.class_id
		LEFT JOIN subjects s ON s.id = h.subject_id
		LEFT JOIN LATERAL (
			SELECT COUNT(*)::int AS submissions_count
			FROM homework_submissions hs
			WHERE hs.homework_id = h.id
		) sub ON TRUE
		LEFT JOIN LATERAL (
			SELECT COUNT(*)::int AS students_count
			FROM students st
			WHERE st.class_id = h.class_id
		) st ON TRUE
		WHERE h.id = $1 AND h.teacher_id = $2
	`
	var item TeacherHomeworkItem
	var attachments []string
	if err := r.db.QueryRow(ctx, query, homeworkID, teacherID).Scan(
		&item.ID,
		&item.Title,
		&item.Description,
		&item.ClassID,
		&item.ClassName,
		&item.SubjectID,
		&item.SubjectName,
		&item.DueDate,
		&item.MaxMarks,
		&item.SubmissionsCount,
		&item.StudentsCount,
		&item.AttachmentCount,
		&item.HasAttachments,
		&attachments,
		&item.CreatedAt,
	); err != nil {
		return nil, err
	}
	item.Attachments = make([]HomeworkAttachmentMeta, 0, len(attachments))
	for _, attachmentID := range attachments {
		if strings.TrimSpace(attachmentID) == "" {
			continue
		}
		item.Attachments = append(item.Attachments, HomeworkAttachmentMeta{ID: attachmentID})
	}
	return &item, nil
}

func (r *Repository) CreateQuiz(ctx context.Context, teacherID uuid.UUID, req *CreateQuizRequest) (uuid.UUID, error) {
	classID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid class_id: %w", err)
	}
	subjectID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid subject_id: %w", err)
	}

	var scheduledAt *time.Time
	if !req.IsAnytime {
		parsed, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt))
		if parseErr != nil {
			if d, fallbackErr := time.Parse("2006-01-02", strings.TrimSpace(req.ScheduledAt)); fallbackErr == nil {
				parsed = d
			} else {
				return uuid.Nil, fmt.Errorf("invalid scheduled_at format")
			}
		}
		scheduledAt = &parsed
	}

	duration := req.DurationMinutes
	if duration <= 0 {
		duration = 30
	}

	totalMarks := req.TotalMarks
	if totalMarks <= 0 {
		totalMarks = 0
		for _, q := range req.Questions {
			if q.Marks > 0 {
				totalMarks += q.Marks
			} else {
				totalMarks++
			}
		}
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var quizID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO quizzes (
			teacher_id, class_id, subject_id, title, chapter_name, scheduled_at, is_anytime, duration_minutes, total_marks,
			status, question_count, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'upcoming', $10, NOW(), NOW())
		RETURNING id
	`, teacherID, classID, subjectID, strings.TrimSpace(req.Title), strings.TrimSpace(req.ChapterName), scheduledAt, req.IsAnytime, duration, totalMarks, len(req.Questions)).Scan(&quizID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to create quiz: %w", err)
	}

	for qIdx, q := range req.Questions {
		marks := q.Marks
		if marks <= 0 {
			marks = 1
		}
		var questionID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO quiz_questions (quiz_id, question_text, marks, order_index, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
			RETURNING id
		`, quizID, strings.TrimSpace(q.QuestionText), marks, qIdx+1).Scan(&questionID); err != nil {
			return uuid.Nil, fmt.Errorf("failed to create quiz question: %w", err)
		}

		for oIdx, opt := range q.Options {
			if _, err := tx.Exec(ctx, `
				INSERT INTO quiz_options (question_id, option_text, is_correct, order_index, created_at, updated_at)
				VALUES ($1, $2, $3, $4, NOW(), NOW())
			`, questionID, strings.TrimSpace(opt.OptionText), opt.IsCorrect, oIdx+1); err != nil {
				return uuid.Nil, fmt.Errorf("failed to create quiz option: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return quizID, nil
}

func (r *Repository) ResolveTeacherForQuizScope(ctx context.Context, classID, subjectID uuid.UUID, academicYear string) (uuid.UUID, error) {
	var teacherID uuid.UUID
	err := r.db.QueryRow(ctx, `
		SELECT teacher_id
		FROM (
			SELECT ta.teacher_id, ta.updated_at
			FROM teacher_assignments ta
			WHERE ta.class_id = $1 AND ta.subject_id = $2 AND ta.academic_year = $3
			UNION ALL
			SELECT t.teacher_id, t.updated_at
			FROM timetables t
			WHERE t.class_id = $1 AND t.subject_id = $2 AND t.academic_year = $3
		) src
		ORDER BY updated_at DESC NULLS LAST
		LIMIT 1
	`, classID, subjectID, academicYear).Scan(&teacherID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("failed to resolve teacher for class/subject: %w", err)
	}
	return teacherID, nil
}

func (r *Repository) GetSuperAdminQuizOptions(ctx context.Context, academicYear string) ([]HomeworkClassOption, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			gc.id::text,
			gc.name AS class_name,
			gc.name AS class_level,
			gs.id::text,
			gs.name AS subject_name
		FROM public.global_class_subjects gcs
		JOIN public.global_classes gc ON gc.id = gcs.class_id
		JOIN public.global_subjects gs ON gs.id = gcs.subject_id
		ORDER BY class_name ASC, subject_name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list super admin quiz options: %w", err)
	}
	defer rows.Close()

	classMap := make(map[string]*HomeworkClassOption)
	ordered := make([]string, 0)

	for rows.Next() {
		var classID, className, classLevel, subjectID, subjectName string
		if err := rows.Scan(&classID, &className, &classLevel, &subjectID, &subjectName); err != nil {
			return nil, fmt.Errorf("failed to scan super admin quiz option: %w", err)
		}
		if _, ok := classMap[classID]; !ok {
			classMap[classID] = &HomeworkClassOption{
				ClassID:    classID,
				ClassName:  className,
				ClassLevel: classLevel,
				Subjects:   []HomeworkSubjectOption{},
			}
			ordered = append(ordered, classID)
		}
		classMap[classID].Subjects = append(classMap[classID].Subjects, HomeworkSubjectOption{
			SubjectID:   subjectID,
			SubjectName: subjectName,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate super admin quiz options: %w", err)
	}

	options := make([]HomeworkClassOption, 0, len(ordered))
	for _, classID := range ordered {
		opt := classMap[classID]
		sort.Slice(opt.Subjects, func(i, j int) bool {
			return strings.ToLower(opt.Subjects[i].SubjectName) < strings.ToLower(opt.Subjects[j].SubjectName)
		})
		options = append(options, *opt)
	}
	return options, nil
}

func (r *Repository) CreateGlobalQuiz(ctx context.Context, superAdminID uuid.UUID, req *CreateQuizRequest) (uuid.UUID, error) {
	classID, err := uuid.Parse(strings.TrimSpace(req.ClassID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid class_id: %w", err)
	}
	subjectID, err := uuid.Parse(strings.TrimSpace(req.SubjectID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid subject_id: %w", err)
	}

	var scheduledAt *time.Time
	if !req.IsAnytime {
		parsed, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt))
		if parseErr != nil {
			if d, fallbackErr := time.Parse("2006-01-02", strings.TrimSpace(req.ScheduledAt)); fallbackErr == nil {
				parsed = d
			} else {
				return uuid.Nil, fmt.Errorf("invalid scheduled_at format")
			}
		}
		scheduledAt = &parsed
	}

	duration := req.DurationMinutes
	if duration <= 0 {
		duration = 30
	}

	totalMarks := req.TotalMarks
	if totalMarks <= 0 {
		totalMarks = 0
		for _, q := range req.Questions {
			if q.Marks > 0 {
				totalMarks += q.Marks
			} else {
				totalMarks++
			}
		}
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var quizID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.global_quizzes (
			super_admin_id, class_id, subject_id, title, chapter_name, scheduled_at, is_anytime, duration_minutes, total_marks,
			status, question_count, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'upcoming', $10, NOW(), NOW())
		RETURNING id
	`, superAdminID, classID, subjectID, strings.TrimSpace(req.Title), strings.TrimSpace(req.ChapterName), scheduledAt, req.IsAnytime, duration, totalMarks, len(req.Questions)).Scan(&quizID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to create global quiz: %w", err)
	}

	for qIdx, q := range req.Questions {
		marks := q.Marks
		if marks <= 0 {
			marks = 1
		}
		var questionID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO public.global_quiz_questions (quiz_id, question_text, marks, order_index, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
			RETURNING id
		`, quizID, strings.TrimSpace(q.QuestionText), marks, qIdx+1).Scan(&questionID); err != nil {
			return uuid.Nil, fmt.Errorf("failed to create global quiz question: %w", err)
		}

		for oIdx, opt := range q.Options {
			if _, err := tx.Exec(ctx, `
				INSERT INTO public.global_quiz_options (question_id, option_text, is_correct, order_index, created_at, updated_at)
				VALUES ($1, $2, $3, $4, NOW(), NOW())
			`, questionID, strings.TrimSpace(opt.OptionText), opt.IsCorrect, oIdx+1); err != nil {
				return uuid.Nil, fmt.Errorf("failed to create global quiz option: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return quizID, nil
}

func (r *Repository) ListSuperAdminQuizzes(ctx context.Context, superAdminID uuid.UUID, page, pageSize int64, classID, subjectID, search string) ([]TeacherQuizItem, bool, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	args := []interface{}{superAdminID}
	where := []string{"1=1"}
	argIdx := 2

	if trimmed := strings.TrimSpace(classID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "gq.class_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}
	if trimmed := strings.TrimSpace(subjectID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "gq.subject_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}
	if trimmed := strings.TrimSpace(search); trimmed != "" {
		like := "%" + trimmed + "%"
		where = append(where, "(gq.title ILIKE $"+strconv.Itoa(argIdx)+" OR gs.name ILIKE $"+strconv.Itoa(argIdx)+" OR gc.name ILIKE $"+strconv.Itoa(argIdx)+")")
		args = append(args, like)
		argIdx++
	}

	limitArg := "$" + strconv.Itoa(argIdx)
	offsetArg := "$" + strconv.Itoa(argIdx+1)
	args = append(args, pageSize+1, offset)

	rows, err := r.db.Query(ctx, `
		SELECT
			gq.id::text,
			'global' AS quiz_source,
			gq.title,
			COALESCE(gq.chapter_name, ''),
			gq.class_id::text,
			gc.name AS class_name,
			gq.subject_id::text,
			gs.name AS subject_name,
			COALESCE(gq.scheduled_at, gq.created_at),
			gq.is_anytime,
			gq.duration_minutes,
			gq.total_marks,
			gq.question_count,
			CASE
				WHEN gq.status = 'completed' THEN 'completed'
				ELSE 'upcoming'
			END AS effective_status,
			'super_admin' AS creator_role,
			COALESCE(sa.full_name, 'Super Admin') AS creator_name,
			(gq.super_admin_id = $1) AS can_edit,
			gq.created_at
		FROM public.global_quizzes gq
		JOIN public.global_classes gc ON gc.id = gq.class_id
		JOIN public.global_subjects gs ON gs.id = gq.subject_id
		JOIN public.super_admins sa ON sa.id = gq.super_admin_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY COALESCE(gq.scheduled_at, gq.created_at) DESC, gq.created_at DESC
		LIMIT `+limitArg+` OFFSET `+offsetArg+`
	`, args...)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list quizzes: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherQuizItem, 0, pageSize+1)
	for rows.Next() {
		var item TeacherQuizItem
		if err := rows.Scan(
			&item.ID,
			&item.QuizSource,
			&item.Title,
			&item.ChapterName,
			&item.ClassID,
			&item.ClassName,
			&item.SubjectID,
			&item.SubjectName,
			&item.ScheduledAt,
			&item.IsAnytime,
			&item.DurationMinutes,
			&item.TotalMarks,
			&item.QuestionCount,
			&item.Status,
			&item.CreatorRole,
			&item.CreatorName,
			&item.CanEdit,
			&item.CreatedAt,
		); err != nil {
			return nil, false, fmt.Errorf("failed to scan quiz: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("failed to iterate quizzes: %w", err)
	}

	hasMore := int64(len(items)) > pageSize
	if hasMore {
		items = items[:pageSize]
	}
	return items, hasMore, nil
}

func (r *Repository) GetQuizDetailForSuperAdmin(ctx context.Context, superAdminID, quizID uuid.UUID) (*TeacherQuizItem, error) {
	var item TeacherQuizItem
	err := r.db.QueryRow(ctx, `
		SELECT
			gq.id::text,
			'global' AS quiz_source,
			gq.title,
			COALESCE(gq.chapter_name, ''),
			gq.class_id::text,
			gc.name AS class_name,
			gq.subject_id::text,
			gs.name AS subject_name,
			COALESCE(gq.scheduled_at, gq.created_at),
			gq.is_anytime,
			gq.duration_minutes,
			gq.total_marks,
			gq.question_count,
			CASE
				WHEN gq.status = 'completed' THEN 'completed'
				ELSE 'upcoming'
			END AS effective_status,
			'super_admin' AS creator_role,
			COALESCE(sa.full_name, 'Super Admin') AS creator_name,
			(gq.super_admin_id = $2) AS can_edit,
			gq.created_at
		FROM public.global_quizzes gq
		JOIN public.global_classes gc ON gc.id = gq.class_id
		JOIN public.global_subjects gs ON gs.id = gq.subject_id
		JOIN public.super_admins sa ON sa.id = gq.super_admin_id
		WHERE gq.id = $1
	`, quizID, superAdminID).Scan(
		&item.ID,
		&item.QuizSource,
		&item.Title,
		&item.ChapterName,
		&item.ClassID,
		&item.ClassName,
		&item.SubjectID,
		&item.SubjectName,
		&item.ScheduledAt,
		&item.IsAnytime,
		&item.DurationMinutes,
		&item.TotalMarks,
		&item.QuestionCount,
		&item.Status,
		&item.CreatorRole,
		&item.CreatorName,
		&item.CanEdit,
		&item.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get quiz: %w", err)
	}

	rows, err := r.db.Query(ctx, `
		SELECT qq.id::text, qq.question_text, qq.marks, qq.order_index
		FROM public.global_quiz_questions qq
		WHERE qq.quiz_id = $1
		ORDER BY qq.order_index ASC
	`, quizID)
	if err != nil {
		return nil, fmt.Errorf("failed to list questions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var q TeacherQuizQuestion
		if err := rows.Scan(&q.ID, &q.QuestionText, &q.Marks, &q.Order); err != nil {
			return nil, fmt.Errorf("scan question: %w", err)
		}
		item.Questions = append(item.Questions, q)
	}

	for i, q := range item.Questions {
		qID, _ := uuid.Parse(q.ID)
		optRows, err := r.db.Query(ctx, `
			SELECT id::text, option_text, is_correct, order_index
			FROM public.global_quiz_options
			WHERE question_id = $1
			ORDER BY order_index ASC
		`, qID)
		if err != nil {
			return nil, fmt.Errorf("failed to list options: %w", err)
		}
		for optRows.Next() {
			var o TeacherQuizOption
			if err := optRows.Scan(&o.ID, &o.OptionText, &o.IsCorrect, &o.Order); err != nil {
				optRows.Close()
				return nil, fmt.Errorf("scan option: %w", err)
			}
			item.Questions[i].Options = append(item.Questions[i].Options, o)
		}
		optRows.Close()
	}
	return &item, nil
}

func (r *Repository) DeleteQuizForSuperAdmin(ctx context.Context, superAdminID, quizID uuid.UUID) error {
	result, err := r.db.ExecResult(ctx, `DELETE FROM public.global_quizzes WHERE id = $1 AND super_admin_id = $2`, quizID, superAdminID)
	if err != nil {
		return fmt.Errorf("failed to delete quiz: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) UpdateQuizForSuperAdmin(ctx context.Context, superAdminID, quizID uuid.UUID, req *UpdateQuizRequest) error {
	sets := []string{"updated_at = NOW()"}
	args := []interface{}{quizID, superAdminID}
	argIdx := 3
	isAnytimeAssigned := false

	if strings.TrimSpace(req.Title) != "" {
		sets = append(sets, "title = $"+strconv.Itoa(argIdx))
		args = append(args, strings.TrimSpace(req.Title))
		argIdx++
	}
	if req.ChapterName != "" {
		sets = append(sets, "chapter_name = $"+strconv.Itoa(argIdx))
		args = append(args, strings.TrimSpace(req.ChapterName))
		argIdx++
	}
	if req.IsAnytime != nil {
		sets = append(sets, "is_anytime = $"+strconv.Itoa(argIdx))
		args = append(args, *req.IsAnytime)
		argIdx++
		isAnytimeAssigned = true
		if *req.IsAnytime {
			sets = append(sets, "scheduled_at = NULL")
		}
	}
	if strings.TrimSpace(req.ScheduledAt) != "" {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt))
		if err != nil {
			t2, err2 := time.Parse("2006-01-02", strings.TrimSpace(req.ScheduledAt))
			if err2 != nil {
				return fmt.Errorf("invalid scheduled_at format")
			}
			t = t2
		}
		sets = append(sets, "scheduled_at = $"+strconv.Itoa(argIdx))
		args = append(args, t)
		argIdx++
		if !isAnytimeAssigned {
			sets = append(sets, "is_anytime = false")
		}
	}
	if req.DurationMinutes > 0 {
		sets = append(sets, "duration_minutes = $"+strconv.Itoa(argIdx))
		args = append(args, req.DurationMinutes)
		argIdx++
	}
	if req.Status != "" {
		allowed := map[string]bool{"upcoming": true, "completed": true}
		if !allowed[req.Status] {
			return fmt.Errorf("invalid status")
		}
		sets = append(sets, "status = $"+strconv.Itoa(argIdx))
		args = append(args, req.Status)
		argIdx++
	}

	result, err := r.db.ExecResult(ctx,
		"UPDATE public.global_quizzes SET "+strings.Join(sets, ", ")+" WHERE id = $1 AND super_admin_id = $2",
		args...)
	if err != nil {
		return fmt.Errorf("failed to update quiz: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) AddQuizQuestionForSuperAdmin(ctx context.Context, superAdminID, quizID uuid.UUID, req *AddQuizQuestionRequest) (uuid.UUID, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.global_quizzes WHERE id = $1 AND super_admin_id = $2)`, quizID, superAdminID).Scan(&exists)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to verify quiz: %w", err)
	}
	if !exists {
		return uuid.Nil, ErrNotFound
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	marks := req.Marks
	if marks <= 0 {
		marks = 1
	}

	var nextOrder int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(order_index), 0) + 1 FROM public.global_quiz_questions WHERE quiz_id = $1`, quizID).Scan(&nextOrder); err != nil {
		return uuid.Nil, fmt.Errorf("failed to get next question order: %w", err)
	}

	var questionID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.global_quiz_questions (quiz_id, question_text, marks, order_index, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		RETURNING id
	`, quizID, strings.TrimSpace(req.QuestionText), marks, nextOrder).Scan(&questionID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to create question: %w", err)
	}

	for idx, opt := range req.Options {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.global_quiz_options (question_id, option_text, is_correct, order_index, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
		`, questionID, strings.TrimSpace(opt.OptionText), opt.IsCorrect, idx+1); err != nil {
			return uuid.Nil, fmt.Errorf("failed to insert option: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.global_quizzes
		SET question_count = question_count + 1,
		    total_marks = total_marks + $2,
		    updated_at = NOW()
		WHERE id = $1 AND super_admin_id = $3
	`, quizID, marks, superAdminID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to update quiz counters: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return questionID, nil
}

func (r *Repository) HasQuizChapter(ctx context.Context, teacherID, classID, subjectID uuid.UUID, chapterName string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM quiz_subject_chapters
			WHERE teacher_id = $1
			  AND class_id = $2
			  AND subject_id = $3
			  AND LOWER(chapter_name) = LOWER($4)
		)
	`, teacherID, classID, subjectID, strings.TrimSpace(chapterName)).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to validate quiz chapter: %w", err)
	}
	return exists, nil
}

func (r *Repository) ListQuizChapters(ctx context.Context, teacherID uuid.UUID, classID, subjectID string, includePlatform bool) ([]QuizChapter, error) {
	args := []interface{}{teacherID}
	where := []string{"teacher_id = $1"}
	argIdx := 2

	if trimmed := strings.TrimSpace(classID); trimmed != "" {
		parsed, err := uuid.Parse(trimmed)
		if err == nil {
			where = append(where, "class_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}
	if trimmed := strings.TrimSpace(subjectID); trimmed != "" {
		parsed, err := uuid.Parse(trimmed)
		if err == nil {
			where = append(where, "subject_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}

	rows, err := r.db.Query(ctx, `
		SELECT id::text, teacher_id::text, class_id::text, subject_id::text, chapter_name, created_at, updated_at
		FROM quiz_subject_chapters
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY chapter_name ASC, created_at ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list quiz chapters: %w", err)
	}
	defer rows.Close()

	items := make([]QuizChapter, 0, 32)
	for rows.Next() {
		var item QuizChapter
		if err := rows.Scan(
			&item.ID,
			&item.TeacherID,
			&item.ClassID,
			&item.SubjectID,
			&item.ChapterName,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan quiz chapter: %w", err)
		}
		item.ChapterSource = "teacher"
		item.CanEdit = true
		items = append(items, item)
	}

	if includePlatform {
		platformWhere := []string{"1=1"}
		platformArgs := make([]interface{}, 0, 2)
		platformArgIdx := 1

		if trimmed := strings.TrimSpace(classID); trimmed != "" {
			parsed, err := uuid.Parse(trimmed)
			if err == nil {
				platformWhere = append(platformWhere, "class_id = $"+strconv.Itoa(platformArgIdx))
				platformArgs = append(platformArgs, parsed)
				platformArgIdx++
			}
		}
		if trimmed := strings.TrimSpace(subjectID); trimmed != "" {
			parsed, err := uuid.Parse(trimmed)
			if err == nil {
				platformWhere = append(platformWhere, "subject_id = $"+strconv.Itoa(platformArgIdx))
				platformArgs = append(platformArgs, parsed)
				platformArgIdx++
			}
		}

		platformRows, platformErr := r.db.Query(ctx, `
			SELECT id::text, ''::text AS teacher_id, class_id::text, subject_id::text, chapter_name, created_at, updated_at
			FROM public.global_quiz_subject_chapters
			WHERE `+strings.Join(platformWhere, " AND ")+`
			ORDER BY chapter_name ASC, created_at ASC
		`, platformArgs...)
		if platformErr != nil {
			return nil, fmt.Errorf("failed to list platform quiz chapters: %w", platformErr)
		}
		defer platformRows.Close()

		for platformRows.Next() {
			var item QuizChapter
			if err := platformRows.Scan(
				&item.ID,
				&item.TeacherID,
				&item.ClassID,
				&item.SubjectID,
				&item.ChapterName,
				&item.CreatedAt,
				&item.UpdatedAt,
			); err != nil {
				return nil, fmt.Errorf("failed to scan platform quiz chapter: %w", err)
			}
			item.ChapterSource = "platform"
			item.CanEdit = false
			items = append(items, item)
		}
		if err := platformRows.Err(); err != nil {
			return nil, fmt.Errorf("failed to iterate platform quiz chapters: %w", err)
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		if strings.EqualFold(items[i].ChapterName, items[j].ChapterName) {
			if items[i].ChapterSource == items[j].ChapterSource {
				return items[i].CreatedAt.Before(items[j].CreatedAt)
			}
			return items[i].ChapterSource < items[j].ChapterSource
		}
		return strings.ToLower(items[i].ChapterName) < strings.ToLower(items[j].ChapterName)
	})

	return items, nil
}

func (r *Repository) CreateQuizChapter(ctx context.Context, teacherID, classID, subjectID uuid.UUID, chapterName string) (*QuizChapter, error) {
	var item QuizChapter
	err := r.db.QueryRow(ctx, `
		INSERT INTO quiz_subject_chapters (teacher_id, class_id, subject_id, chapter_name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (teacher_id, class_id, subject_id, chapter_name)
		DO UPDATE SET updated_at = NOW()
		RETURNING id::text, teacher_id::text, class_id::text, subject_id::text, chapter_name, created_at, updated_at
	`, teacherID, classID, subjectID, strings.TrimSpace(chapterName)).Scan(
		&item.ID,
		&item.TeacherID,
		&item.ClassID,
		&item.SubjectID,
		&item.ChapterName,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create quiz chapter: %w", err)
	}
	item.ChapterSource = "teacher"
	item.CanEdit = true
	return &item, nil
}

func (r *Repository) UpdateQuizChapter(ctx context.Context, teacherID, chapterID uuid.UUID, chapterName string) (*QuizChapter, error) {
	var item QuizChapter
	err := r.db.QueryRow(ctx, `
		UPDATE quiz_subject_chapters
		SET chapter_name = $3, updated_at = NOW()
		WHERE id = $1 AND teacher_id = $2
		RETURNING id::text, teacher_id::text, class_id::text, subject_id::text, chapter_name, created_at, updated_at
	`, chapterID, teacherID, strings.TrimSpace(chapterName)).Scan(
		&item.ID,
		&item.TeacherID,
		&item.ClassID,
		&item.SubjectID,
		&item.ChapterName,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	item.ChapterSource = "teacher"
	item.CanEdit = true
	return &item, nil
}

func (r *Repository) DeleteQuizChapter(ctx context.Context, teacherID, chapterID uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var classID uuid.UUID
	var subjectID uuid.UUID
	var chapterName string
	err = tx.QueryRow(ctx, `
		SELECT class_id, subject_id, chapter_name
		FROM quiz_subject_chapters
		WHERE id = $1 AND teacher_id = $2
	`, chapterID, teacherID).Scan(&classID, &subjectID, &chapterName)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM quizzes
		WHERE teacher_id = $1
		  AND class_id = $2
		  AND subject_id = $3
		  AND LOWER(COALESCE(chapter_name, '')) = LOWER($4)
	`, teacherID, classID, subjectID, strings.TrimSpace(chapterName)); err != nil {
		return err
	}

	var deletedID string
	err = tx.QueryRow(ctx, `
		DELETE FROM quiz_subject_chapters
		WHERE id = $1 AND teacher_id = $2
		RETURNING id::text
	`, chapterID, teacherID).Scan(&deletedID)
	if err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (r *Repository) ListSuperAdminQuizChapters(ctx context.Context, superAdminID uuid.UUID, classID, subjectID string) ([]QuizChapter, error) {
	args := []interface{}{superAdminID}
	where := []string{"super_admin_id = $1"}
	argIdx := 2

	if trimmed := strings.TrimSpace(classID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "class_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}
	if trimmed := strings.TrimSpace(subjectID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "subject_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}

	rows, err := r.db.Query(ctx, `
		SELECT id::text, super_admin_id::text AS teacher_id, class_id::text, subject_id::text, chapter_name, created_at, updated_at
		FROM public.global_quiz_subject_chapters
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY chapter_name ASC, created_at ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list super admin quiz chapters: %w", err)
	}
	defer rows.Close()

	items := make([]QuizChapter, 0, 32)
	for rows.Next() {
		var item QuizChapter
		if err := rows.Scan(
			&item.ID,
			&item.TeacherID,
			&item.ClassID,
			&item.SubjectID,
			&item.ChapterName,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan super admin quiz chapter: %w", err)
		}
		item.ChapterSource = "platform"
		item.CanEdit = true
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate super admin quiz chapters: %w", err)
	}

	return items, nil
}

func (r *Repository) CreateSuperAdminQuizChapter(ctx context.Context, superAdminID, classID, subjectID uuid.UUID, chapterName string) (*QuizChapter, error) {
	var item QuizChapter
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.global_quiz_subject_chapters (super_admin_id, class_id, subject_id, chapter_name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (super_admin_id, class_id, subject_id, chapter_name)
		DO UPDATE SET updated_at = NOW()
		RETURNING id::text, super_admin_id::text AS teacher_id, class_id::text, subject_id::text, chapter_name, created_at, updated_at
	`, superAdminID, classID, subjectID, strings.TrimSpace(chapterName)).Scan(
		&item.ID,
		&item.TeacherID,
		&item.ClassID,
		&item.SubjectID,
		&item.ChapterName,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create super admin quiz chapter: %w", err)
	}
	item.ChapterSource = "platform"
	item.CanEdit = true
	return &item, nil
}

func (r *Repository) UpdateSuperAdminQuizChapter(ctx context.Context, superAdminID, chapterID uuid.UUID, chapterName string) (*QuizChapter, error) {
	var item QuizChapter
	err := r.db.QueryRow(ctx, `
		UPDATE public.global_quiz_subject_chapters
		SET chapter_name = $3, updated_at = NOW()
		WHERE id = $1 AND super_admin_id = $2
		RETURNING id::text, super_admin_id::text AS teacher_id, class_id::text, subject_id::text, chapter_name, created_at, updated_at
	`, chapterID, superAdminID, strings.TrimSpace(chapterName)).Scan(
		&item.ID,
		&item.TeacherID,
		&item.ClassID,
		&item.SubjectID,
		&item.ChapterName,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	item.ChapterSource = "platform"
	item.CanEdit = true
	return &item, nil
}

func (r *Repository) DeleteSuperAdminQuizChapter(ctx context.Context, superAdminID, chapterID uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var classID uuid.UUID
	var subjectID uuid.UUID
	var chapterName string
	err = tx.QueryRow(ctx, `
		SELECT class_id, subject_id, chapter_name
		FROM public.global_quiz_subject_chapters
		WHERE id = $1 AND super_admin_id = $2
	`, chapterID, superAdminID).Scan(&classID, &subjectID, &chapterName)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM public.global_quizzes
		WHERE super_admin_id = $1
		  AND class_id = $2
		  AND subject_id = $3
		  AND LOWER(COALESCE(chapter_name, '')) = LOWER($4)
	`, superAdminID, classID, subjectID, strings.TrimSpace(chapterName)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM public.global_quiz_subject_chapters
		WHERE id = $1 AND super_admin_id = $2
	`, chapterID, superAdminID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (r *Repository) ListTeacherQuizzes(ctx context.Context, teacherID uuid.UUID, page, pageSize int64, classID, subjectID, search string) ([]TeacherQuizItem, bool, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	trimmedSearch := strings.TrimSpace(search)

	args := []interface{}{teacherID}
	where := []string{"q.teacher_id = $1"}
	argIdx := 2

	if trimmed := strings.TrimSpace(classID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "q.class_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}
	if trimmed := strings.TrimSpace(subjectID); trimmed != "" {
		if parsed, err := uuid.Parse(trimmed); err == nil {
			where = append(where, "q.subject_id = $"+strconv.Itoa(argIdx))
			args = append(args, parsed)
			argIdx++
		}
	}
	if trimmedSearch != "" {
		like := "%" + trimmedSearch + "%"
		where = append(where, "(q.title ILIKE $"+strconv.Itoa(argIdx)+" OR COALESCE(s.name, '') ILIKE $"+strconv.Itoa(argIdx)+" OR c.name ILIKE $"+strconv.Itoa(argIdx)+")")
		args = append(args, like)
		argIdx++
	}

	rows, err := r.db.Query(ctx, `
		SELECT
			q.id::text,
			'tenant' AS quiz_source,
			q.title,
			COALESCE(q.chapter_name, ''),
			q.class_id::text,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			q.subject_id::text,
			COALESCE(s.name, ''),
			COALESCE(q.scheduled_at, q.created_at),
			q.is_anytime,
			q.duration_minutes,
			q.total_marks,
			q.question_count,
			CASE
				WHEN q.status = 'completed' THEN 'completed'
				ELSE 'upcoming'
			END AS effective_status,
			'teacher' AS creator_role,
			COALESCE(u.full_name, 'Teacher') AS creator_name,
			true AS can_edit,
			q.created_at
		FROM quizzes q
		JOIN classes c ON c.id = q.class_id
		JOIN teachers t ON t.id = q.teacher_id
		JOIN users u ON u.id = t.user_id
		LEFT JOIN subjects s ON s.id = q.subject_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY COALESCE(q.scheduled_at, q.created_at) DESC, q.created_at DESC
	`, args...)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list quizzes: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherQuizItem, 0, pageSize+8)
	for rows.Next() {
		var item TeacherQuizItem
		if err := rows.Scan(
			&item.ID,
			&item.QuizSource,
			&item.Title,
			&item.ChapterName,
			&item.ClassID,
			&item.ClassName,
			&item.SubjectID,
			&item.SubjectName,
			&item.ScheduledAt,
			&item.IsAnytime,
			&item.DurationMinutes,
			&item.TotalMarks,
			&item.QuestionCount,
			&item.Status,
			&item.CreatorRole,
			&item.CreatorName,
			&item.CanEdit,
			&item.CreatedAt,
		); err != nil {
			return nil, false, fmt.Errorf("failed to scan quiz: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("failed to iterate quizzes: %w", err)
	}

	// Build teacher scope (class+subject) for including matching super-admin global quizzes.
	scopeRows, err := r.db.Query(ctx, `
		SELECT c.name, COALESCE(s.name, '')
		FROM teacher_assignments ta
		JOIN classes c ON c.id = ta.class_id
		LEFT JOIN subjects s ON s.id = ta.subject_id
		WHERE ta.teacher_id = $1
		UNION
		SELECT c.name, COALESCE(s.name, '')
		FROM timetables tt
		JOIN classes c ON c.id = tt.class_id
		LEFT JOIN subjects s ON s.id = tt.subject_id
		WHERE tt.teacher_id = $1
	`, teacherID)
	if err != nil {
		return nil, false, fmt.Errorf("failed to read teacher scope: %w", err)
	}
	defer scopeRows.Close()

	scopeKeys := make(map[string]struct{})
	for scopeRows.Next() {
		var className string
		var subjectName string
		if err := scopeRows.Scan(&className, &subjectName); err != nil {
			return nil, false, fmt.Errorf("failed to scan teacher scope: %w", err)
		}
		key := normalizeClassKey(className) + "::" + normalizeSubjectKey(subjectName)
		scopeKeys[key] = struct{}{}
	}

	if len(scopeKeys) > 0 {
		var filterClassKey string
		if trimmed := strings.TrimSpace(classID); trimmed != "" {
			parsed, parseErr := uuid.Parse(trimmed)
			if parseErr == nil {
				var className string
				if err := r.db.QueryRow(ctx, `SELECT name FROM classes WHERE id = $1`, parsed).Scan(&className); err == nil {
					filterClassKey = normalizeClassKey(className)
				}
			}
		}
		var filterSubjectKey string
		if trimmed := strings.TrimSpace(subjectID); trimmed != "" {
			parsed, parseErr := uuid.Parse(trimmed)
			if parseErr == nil {
				var subjectName string
				if err := r.db.QueryRow(ctx, `SELECT name FROM subjects WHERE id = $1`, parsed).Scan(&subjectName); err == nil {
					filterSubjectKey = normalizeSubjectKey(subjectName)
				}
			}
		}

		globalRows, err := r.db.Query(ctx, `
			SELECT
				gq.id::text,
				'global' AS quiz_source,
				gq.title,
				COALESCE(gq.chapter_name, ''),
				gq.class_id::text,
				gc.name,
				gq.subject_id::text,
				gs.name,
				COALESCE(gq.scheduled_at, gq.created_at),
				gq.is_anytime,
				gq.duration_minutes,
				gq.total_marks,
				gq.question_count,
				CASE
					WHEN gq.status = 'completed' THEN 'completed'
					ELSE 'upcoming'
				END AS effective_status,
				'super_admin' AS creator_role,
				COALESCE(sa.full_name, 'Super Admin') AS creator_name,
				false AS can_edit,
				gq.created_at
			FROM public.global_quizzes gq
			JOIN public.global_classes gc ON gc.id = gq.class_id
			JOIN public.global_subjects gs ON gs.id = gq.subject_id
			JOIN public.super_admins sa ON sa.id = gq.super_admin_id
		`)
		if err != nil {
			return nil, false, fmt.Errorf("failed to list global quizzes: %w", err)
		}
		defer globalRows.Close()

		for globalRows.Next() {
			var item TeacherQuizItem
			if err := globalRows.Scan(
				&item.ID,
				&item.QuizSource,
				&item.Title,
				&item.ChapterName,
				&item.ClassID,
				&item.ClassName,
				&item.SubjectID,
				&item.SubjectName,
				&item.ScheduledAt,
				&item.IsAnytime,
				&item.DurationMinutes,
				&item.TotalMarks,
				&item.QuestionCount,
				&item.Status,
				&item.CreatorRole,
				&item.CreatorName,
				&item.CanEdit,
				&item.CreatedAt,
			); err != nil {
				return nil, false, fmt.Errorf("failed to scan global quiz: %w", err)
			}

			itemKey := normalizeClassKey(item.ClassName) + "::" + normalizeSubjectKey(item.SubjectName)
			if _, ok := scopeKeys[itemKey]; !ok {
				continue
			}
			if filterClassKey != "" && normalizeClassKey(item.ClassName) != filterClassKey {
				continue
			}
			if filterSubjectKey != "" && normalizeSubjectKey(item.SubjectName) != filterSubjectKey {
				continue
			}
			if trimmedSearch != "" {
				candidate := strings.ToLower(item.Title + " " + item.ClassName + " " + item.SubjectName)
				if !strings.Contains(candidate, strings.ToLower(trimmedSearch)) {
					continue
				}
			}
			items = append(items, item)
		}
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].ScheduledAt.Equal(items[j].ScheduledAt) {
			return items[i].CreatedAt.After(items[j].CreatedAt)
		}
		return items[i].ScheduledAt.After(items[j].ScheduledAt)
	})

	if offset >= int64(len(items)) {
		return []TeacherQuizItem{}, false, nil
	}
	end := offset + pageSize
	hasMore := end < int64(len(items))
	if end > int64(len(items)) {
		end = int64(len(items))
	}
	return items[offset:end], hasMore, nil
}

func (r *Repository) GetQuizDetail(ctx context.Context, teacherID, quizID uuid.UUID) (*TeacherQuizItem, error) {
	var item TeacherQuizItem
	err := r.db.QueryRow(ctx, `
		SELECT
			q.id::text,
			q.title,
			COALESCE(q.chapter_name, ''),
			q.class_id::text,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			q.subject_id::text,
			COALESCE(s.name, ''),
			COALESCE(q.scheduled_at, q.created_at),
			q.is_anytime,
			q.duration_minutes,
			q.total_marks,
			q.question_count,
			CASE
				WHEN q.status = 'completed' THEN 'completed'
				ELSE 'upcoming'
			END AS effective_status,
			q.created_at
		FROM quizzes q
		JOIN classes c ON c.id = q.class_id
		LEFT JOIN subjects s ON s.id = q.subject_id
		WHERE q.id = $1 AND q.teacher_id = $2
	`, quizID, teacherID).Scan(
		&item.ID,
		&item.Title,
		&item.ChapterName,
		&item.ClassID,
		&item.ClassName,
		&item.SubjectID,
		&item.SubjectName,
		&item.ScheduledAt,
		&item.IsAnytime,
		&item.DurationMinutes,
		&item.TotalMarks,
		&item.QuestionCount,
		&item.Status,
		&item.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get quiz: %w", err)
	}

	// Load questions + options
	rows, err := r.db.Query(ctx, `
		SELECT qq.id::text, qq.question_text, qq.marks, qq.order_index
		FROM quiz_questions qq
		WHERE qq.quiz_id = $1
		ORDER BY qq.order_index ASC
	`, quizID)
	if err != nil {
		return nil, fmt.Errorf("failed to list questions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var q TeacherQuizQuestion
		if err := rows.Scan(&q.ID, &q.QuestionText, &q.Marks, &q.Order); err != nil {
			return nil, fmt.Errorf("scan question: %w", err)
		}
		item.Questions = append(item.Questions, q)
	}

	for i, q := range item.Questions {
		qID, _ := uuid.Parse(q.ID)
		optRows, err := r.db.Query(ctx, `
			SELECT id::text, option_text, is_correct, order_index
			FROM quiz_options
			WHERE question_id = $1
			ORDER BY order_index ASC
		`, qID)
		if err != nil {
			return nil, fmt.Errorf("failed to list options: %w", err)
		}
		for optRows.Next() {
			var o TeacherQuizOption
			if err := optRows.Scan(&o.ID, &o.OptionText, &o.IsCorrect, &o.Order); err != nil {
				optRows.Close()
				return nil, fmt.Errorf("scan option: %w", err)
			}
			item.Questions[i].Options = append(item.Questions[i].Options, o)
		}
		optRows.Close()
	}
	return &item, nil
}

func (r *Repository) DeleteQuiz(ctx context.Context, teacherID, quizID uuid.UUID) error {
	result, err := r.db.ExecResult(ctx, `
		DELETE FROM quizzes WHERE id = $1 AND teacher_id = $2
	`, quizID, teacherID)
	if err != nil {
		return fmt.Errorf("failed to delete quiz: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) UpdateQuiz(ctx context.Context, teacherID, quizID uuid.UUID, req *UpdateQuizRequest) error {
	sets := []string{"updated_at = NOW()"}
	args := []interface{}{quizID, teacherID}
	argIdx := 3
	isAnytimeAssigned := false

	if strings.TrimSpace(req.Title) != "" {
		sets = append(sets, "title = $"+strconv.Itoa(argIdx))
		args = append(args, strings.TrimSpace(req.Title))
		argIdx++
	}
	if req.ChapterName != "" {
		sets = append(sets, "chapter_name = $"+strconv.Itoa(argIdx))
		args = append(args, strings.TrimSpace(req.ChapterName))
		argIdx++
	}
	if req.IsAnytime != nil {
		sets = append(sets, "is_anytime = $"+strconv.Itoa(argIdx))
		args = append(args, *req.IsAnytime)
		argIdx++
		isAnytimeAssigned = true
		if *req.IsAnytime {
			sets = append(sets, "scheduled_at = NULL")
		}
	}

	if strings.TrimSpace(req.ScheduledAt) != "" {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ScheduledAt))
		if err != nil {
			t2, err2 := time.Parse("2006-01-02", strings.TrimSpace(req.ScheduledAt))
			if err2 != nil {
				return fmt.Errorf("invalid scheduled_at format")
			}
			t = t2
		}
		sets = append(sets, "scheduled_at = $"+strconv.Itoa(argIdx))
		args = append(args, t)
		argIdx++
		if !isAnytimeAssigned {
			sets = append(sets, "is_anytime = false")
		}
	}
	if req.DurationMinutes > 0 {
		sets = append(sets, "duration_minutes = $"+strconv.Itoa(argIdx))
		args = append(args, req.DurationMinutes)
		argIdx++
	}
	if req.Status != "" {
		allowed := map[string]bool{"upcoming": true, "completed": true}
		if !allowed[req.Status] {
			return fmt.Errorf("invalid status")
		}
		sets = append(sets, "status = $"+strconv.Itoa(argIdx))
		args = append(args, req.Status)
		argIdx++
	}

	result, err := r.db.ExecResult(ctx,
		"UPDATE quizzes SET "+strings.Join(sets, ", ")+" WHERE id = $1 AND teacher_id = $2",
		args...)
	if err != nil {
		return fmt.Errorf("failed to update quiz: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) AddQuizQuestion(ctx context.Context, teacherID, quizID uuid.UUID, req *AddQuizQuestionRequest) (uuid.UUID, error) {
	// verify ownership
	var ownerID uuid.UUID
	err := r.db.QueryRow(ctx, `SELECT teacher_id FROM quizzes WHERE id = $1`, quizID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, err
	}
	if ownerID != teacherID {
		return uuid.Nil, ErrUnauthorizedUploadScope
	}

	marks := req.Marks
	if marks <= 0 {
		marks = 1
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var orderIndex int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(order_index),0)+1 FROM quiz_questions WHERE quiz_id = $1`, quizID).Scan(&orderIndex); err != nil {
		return uuid.Nil, err
	}

	var questionID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO quiz_questions (quiz_id, question_text, marks, order_index, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		RETURNING id
	`, quizID, strings.TrimSpace(req.QuestionText), marks, orderIndex).Scan(&questionID); err != nil {
		return uuid.Nil, fmt.Errorf("failed to insert question: %w", err)
	}

	for oIdx, opt := range req.Options {
		if _, err := tx.Exec(ctx, `
			INSERT INTO quiz_options (question_id, option_text, is_correct, order_index, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
		`, questionID, strings.TrimSpace(opt.OptionText), opt.IsCorrect, oIdx+1); err != nil {
			return uuid.Nil, fmt.Errorf("failed to insert option: %w", err)
		}
	}

	// update question_count and total_marks on quiz
	if _, err := tx.Exec(ctx, `
		UPDATE quizzes SET
			question_count = question_count + 1,
			total_marks = total_marks + $1,
			updated_at = NOW()
		WHERE id = $2
	`, marks, quizID); err != nil {
		return uuid.Nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return questionID, nil
}

func (r *Repository) CreateHomeworkAttachment(ctx context.Context, schoolID string, teacherID, homeworkID uuid.UUID, attachment *HomeworkAttachmentUpload) (*HomeworkAttachmentMeta, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}
	sum := sha256.Sum256(attachment.Content)
	hash := hex.EncodeToString(sum[:])

	now := time.Now()
	attachmentID := uuid.New().String()

	// Store content in R2 only
	storageKey, err := objectstore.PutHomeworkAttachment(ctx, r.store, schoolID, teacherID.String(), homeworkID.String(), attachmentID, attachment.FileName, attachment.Content)
	if err != nil {
		return nil, fmt.Errorf("upload homework attachment to r2 failed school_id=%s teacher_id=%s homework_id=%s file=%s: %w", schoolID, teacherID.String(), homeworkID.String(), attachment.FileName, err)
	}
	if strings.TrimSpace(storageKey) == "" {
		return nil, errors.New("r2 storage key missing for homework attachment")
	}

	var id string
	err = r.db.QueryRow(ctx, `
		INSERT INTO teacher_homework_attachments (
			school_id, teacher_id, homework_id,
			file_name, file_size, mime_type, file_sha256,
			storage_key, uploaded_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id::text
	`, strings.TrimSpace(schoolID), teacherID.String(), homeworkID.String(), attachment.FileName, attachment.FileSize, attachment.MimeType, hash, storageKey, now).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("failed to save homework attachment: %w", err)
	}
	return &HomeworkAttachmentMeta{
		ID:         id,
		FileName:   attachment.FileName,
		FileSize:   attachment.FileSize,
		MimeType:   attachment.MimeType,
		FileSHA256: hash,
		UploadedAt: now,
	}, nil
}

func (r *Repository) GetHomeworkAttachmentByIDForTeacher(ctx context.Context, schoolID string, teacherID, homeworkID uuid.UUID, attachmentID string) (*HomeworkAttachmentMeta, []byte, error) {
	if r.db == nil {
		return nil, nil, errors.New("database not configured")
	}
	var raw struct {
		FileName   string
		FileSize   int64
		MimeType   string
		FileSHA256 string
		UploadedAt time.Time
		StorageKey string
	}
	if err := r.db.QueryRow(ctx, `
		SELECT file_name, file_size, mime_type, file_sha256, uploaded_at, storage_key
		FROM teacher_homework_attachments
		WHERE id::text = $1 AND school_id = $2 AND teacher_id = $3 AND homework_id = $4
		LIMIT 1
	`, strings.TrimSpace(attachmentID), strings.TrimSpace(schoolID), teacherID.String(), homeworkID.String()).Scan(&raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt, &raw.StorageKey); err != nil {
		return nil, nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to retrieve attachment content: %w", err)
	}

	return &HomeworkAttachmentMeta{
		ID:         attachmentID,
		FileName:   raw.FileName,
		FileSize:   raw.FileSize,
		MimeType:   raw.MimeType,
		FileSHA256: raw.FileSHA256,
		UploadedAt: raw.UploadedAt,
	}, content, nil
}

// EnterGrade enters a grade for a student
func (r *Repository) EnterGrade(ctx context.Context, teacherID uuid.UUID, req *EnterGradeRequest) error {
	studentID, _ := uuid.Parse(req.StudentID)
	var subjectID *uuid.UUID
	if req.SubjectID != "" {
		id, _ := uuid.Parse(req.SubjectID)
		subjectID = &id
	}

	var examDate *time.Time
	if req.ExamDate != "" {
		t, _ := time.Parse("2006-01-02", req.ExamDate)
		examDate = &t
	}

	academicYear := getCurrentAcademicYear()

	query := `
		INSERT INTO grades (student_id, subject_id, exam_type, exam_name, max_marks, marks_obtained, remarks, graded_by, exam_date, academic_year)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`

	return r.db.Exec(ctx, query,
		studentID, subjectID, req.ExamType, req.ExamName,
		req.MaxMarks, req.MarksObtained, req.Remarks, teacherID, examDate, academicYear,
	)
}

func (r *Repository) GetTeacherReportOptions(ctx context.Context, teacherID uuid.UUID, academicYear string) (*TeacherReportOptionsResponse, error) {
	classRows, err := r.db.Query(ctx, `
		WITH timetable_classes AS (
			SELECT t.class_id
			FROM timetables t
			WHERE t.teacher_id = $1 AND t.academic_year = $2
		),
		assignment_classes AS (
			SELECT ta.class_id
			FROM teacher_assignments ta
			WHERE ta.teacher_id = $1 AND ta.academic_year = $2
		),
		eligible_classes AS (
			SELECT c.id, c.name, c.grade, c.section
			FROM classes c
			WHERE c.class_teacher_id = $1
			   OR EXISTS (SELECT 1 FROM timetable_classes tc WHERE tc.class_id = c.id)
			   OR EXISTS (SELECT 1 FROM assignment_classes ac WHERE ac.class_id = c.id)
		)
		SELECT
			c.id,
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			c.grade
		FROM eligible_classes c
		ORDER BY c.name ASC, class_name ASC
	`, teacherID, academicYear)
	if err != nil {
		return nil, fmt.Errorf("failed to list teacher report classes: %w", err)
	}
	defer classRows.Close()

	classes := make([]TeacherReportClass, 0, 32)
	classIDSet := make([]uuid.UUID, 0, 32)
	for classRows.Next() {
		var item TeacherReportClass
		if err := classRows.Scan(&item.ClassID, &item.ClassName, &item.Grade); err != nil {
			return nil, fmt.Errorf("failed to scan teacher report class: %w", err)
		}
		item.Subjects = make([]TeacherReportSubject, 0, 8)
		classes = append(classes, item)
		classIDSet = append(classIDSet, item.ClassID)
	}
	// Populate subjects per class.
	for i, cls := range classes {
		subjectOpts, subjErr := r.GetTeacherTaughtSubjectOptionsForClass(ctx, teacherID, cls.ClassID, academicYear)
		if subjErr != nil {
			return nil, fmt.Errorf("failed to get subjects for class %s: %w", cls.ClassID, subjErr)
		}
		for _, opt := range subjectOpts {
			subjectUUID, parseErr := uuid.Parse(opt.SubjectID)
			if parseErr != nil {
				continue
			}
			classes[i].Subjects = append(classes[i].Subjects, TeacherReportSubject{
				SubjectID:   subjectUUID,
				SubjectName: opt.SubjectName,
			})
		}
	}

	if len(classIDSet) == 0 {
		return &TeacherReportOptionsResponse{
			Assessments: []TeacherReportAssessment{},
			Classes:     classes,
		}, nil
	}

	rows, err := r.db.Query(ctx, `
		SELECT
			a.id,
			a.name,
			COALESCE(NULLIF(a.assessment_type, ''), NULLIF(a.type, ''), 'Assessment') AS assessment_type,
			a.academic_year,
			COALESCE(a.max_marks, 0),
			COALESCE(a.class_ids, '{}'::UUID[]),
			COALESCE(a.scheduled_date, a.date) AS scheduled_date
		FROM assessments a
		WHERE a.academic_year = $1
		  AND EXISTS (
			  SELECT 1
			  FROM unnest(COALESCE(a.class_ids, '{}'::UUID[])) cid
			  WHERE cid = ANY($2::UUID[])
		  )
		ORDER BY COALESCE(a.scheduled_date, a.date) DESC NULLS LAST, a.created_at DESC
	`, academicYear, classIDSet)
	if err != nil {
		return nil, fmt.Errorf("failed to list teacher report assessments: %w", err)
	}
	defer rows.Close()

	assessments := make([]TeacherReportAssessment, 0, 32)
	for rows.Next() {
		var item TeacherReportAssessment
		var classIDs []uuid.UUID
		if err := rows.Scan(&item.ID, &item.Name, &item.AssessmentType, &item.AcademicYear, &item.TotalMarks, &classIDs, &item.ScheduledDate); err != nil {
			return nil, fmt.Errorf("failed to scan teacher report assessment: %w", err)
		}
		item.ClassIDs = make([]string, 0, len(classIDs))
		for _, cid := range classIDs {
			item.ClassIDs = append(item.ClassIDs, cid.String())
		}
		assessments = append(assessments, item)
	}

	return &TeacherReportOptionsResponse{
		Assessments: assessments,
		Classes:     classes,
	}, nil
}

func (r *Repository) GetTeacherReportMarksSheet(ctx context.Context, teacherID, assessmentID, classID, subjectID uuid.UUID) (*TeacherReportMarksSheet, error) {
	var className string
	var subjectTotal float64
	var classAllowed bool
	var classIDs []uuid.UUID
	var subjectName string
	// assessmentSubjectMarkID may be nil when the admin didn't configure
	// per-subject marks (assessment_subject_marks row may not exist yet).
	var assessmentSubjectMarkID *uuid.UUID

	if err := r.db.QueryRow(ctx, `
		SELECT
			CASE
				WHEN COALESCE(c.section, '') = '' THEN c.name
				WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
				ELSE c.name || '-' || c.section
			END AS class_name,
			COALESCE(asm.max_marks, a.max_marks, 0) AS total_marks,
			(
				c.class_teacher_id = $1
				OR EXISTS (
					SELECT 1 FROM timetables t
					WHERE t.class_id = c.id
					  AND t.teacher_id = $1
					  AND t.subject_id = $4
					  AND t.academic_year = a.academic_year
				)
				OR EXISTS (
					SELECT 1 FROM teacher_assignments ta
					WHERE ta.class_id = c.id
					  AND ta.teacher_id = $1
					  AND ta.subject_id = $4
					  AND ta.academic_year = a.academic_year
				)
			) AS class_allowed,
			COALESCE(a.class_ids, '{}'::UUID[]),
			COALESCE(NULLIF(TRIM(s.name), ''), ''),
			asm.id
		FROM classes c
		JOIN assessments a ON a.id = $2
		JOIN subjects s ON s.id = $4
		LEFT JOIN LATERAL (
			SELECT id, max_marks
			FROM assessment_subject_marks
			WHERE assessment_id = a.id
			  AND (subject_id = s.id OR subject_id IS NULL)
			ORDER BY (subject_id IS NULL) ASC, created_at ASC
			LIMIT 1
		) asm ON TRUE
		WHERE c.id = $3
	`, teacherID, assessmentID, classID, subjectID).Scan(&className, &subjectTotal, &classAllowed, &classIDs, &subjectName, &assessmentSubjectMarkID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to validate marks sheet scope: %w", err)
	}

	if !classAllowed {
		return nil, ErrNotAuthorized
	}
	// Verify that the assessment covers the requested class (via class_ids).
	classInAssessment := false
	for _, cid := range classIDs {
		if cid == classID {
			classInAssessment = true
			break
		}
	}
	if !classInAssessment {
		return nil, ErrNotAuthorized
	}

	breakdowns := make([]TeacherReportBreakdownItem, 0, 8)
	breakdownSet := make(map[uuid.UUID]float64, 8)
	// Only query breakdowns when the admin has configured per-subject marks.
	if assessmentSubjectMarkID != nil {
		breakdownRows, err := r.db.Query(ctx, `
			SELECT
				amb.id,
				COALESCE(NULLIF(TRIM(amb.title), ''), 'Untitled'),
				COALESCE(amb.marks, 0)
			FROM assessment_mark_breakdowns amb
			WHERE amb.assessment_subject_mark_id = $1
			ORDER BY amb.created_at ASC, amb.id ASC
		`, *assessmentSubjectMarkID)
		if err != nil {
			return nil, fmt.Errorf("failed to list marks breakdowns: %w", err)
		}
		defer breakdownRows.Close()

		for breakdownRows.Next() {
			var item TeacherReportBreakdownItem
			if err := breakdownRows.Scan(&item.AssessmentMarkBreakdownID, &item.Title, &item.MaxMarks); err != nil {
				return nil, fmt.Errorf("failed to scan marks breakdown: %w", err)
			}
			breakdowns = append(breakdowns, item)
			breakdownSet[item.AssessmentMarkBreakdownID] = item.MaxMarks
		}
	}

	rows, err := r.db.Query(ctx, `
		SELECT
			s.id,
			u.full_name,
			COALESCE(s.roll_number, ''),
			sg.marks_obtained,
			COALESCE(sg.remarks, ''),
			sg.id
		FROM students s
		JOIN users u ON u.id = s.user_id
		LEFT JOIN student_grades sg
			ON sg.student_id = s.id
		   AND sg.assessment_id = $2
		   AND sg.subject_id = $3
		WHERE s.class_id = $1
		ORDER BY s.roll_number NULLS LAST, u.full_name
	`, classID, assessmentID, subjectID)
	if err != nil {
		return nil, fmt.Errorf("failed to list marks sheet students: %w", err)
	}
	defer rows.Close()

	students := make([]TeacherReportStudentMark, 0, 64)
	gradeIDByStudent := make(map[uuid.UUID]uuid.UUID, 64)
	for rows.Next() {
		var student TeacherReportStudentMark
		var studentGradeID *uuid.UUID
		if err := rows.Scan(&student.StudentID, &student.FullName, &student.RollNumber, &student.MarksObtained, &student.Remarks, &studentGradeID); err != nil {
			return nil, fmt.Errorf("failed to scan marks sheet student: %w", err)
		}
		student.BreakdownMarks = make([]TeacherReportStudentBreakdownMark, 0, len(breakdowns))
		if studentGradeID != nil {
			gradeIDByStudent[student.StudentID] = *studentGradeID
		}
		students = append(students, student)
	}

	if len(breakdowns) > 0 && len(gradeIDByStudent) > 0 {
		gradeIDs := make([]uuid.UUID, 0, len(gradeIDByStudent))
		for _, gradeID := range gradeIDByStudent {
			gradeIDs = append(gradeIDs, gradeID)
		}

		breakdownMarksRows, marksErr := r.db.Query(ctx, `
			SELECT
				sgb.student_grade_id,
				sgb.assessment_mark_breakdown_id,
				sgb.marks_obtained
			FROM student_grade_breakdowns sgb
			WHERE sgb.student_grade_id = ANY($1)
		`, gradeIDs)
		if marksErr != nil {
			return nil, fmt.Errorf("failed to list student breakdown marks: %w", marksErr)
		}
		defer breakdownMarksRows.Close()

		perGrade := make(map[uuid.UUID]map[uuid.UUID]float64, len(gradeIDs))
		for breakdownMarksRows.Next() {
			var gradeID uuid.UUID
			var breakdownID uuid.UUID
			var marks float64
			if err := breakdownMarksRows.Scan(&gradeID, &breakdownID, &marks); err != nil {
				return nil, fmt.Errorf("failed to scan student breakdown mark: %w", err)
			}
			if _, ok := perGrade[gradeID]; !ok {
				perGrade[gradeID] = make(map[uuid.UUID]float64, len(breakdowns))
			}
			perGrade[gradeID][breakdownID] = marks
		}

		for i := range students {
			gradeID, ok := gradeIDByStudent[students[i].StudentID]
			if !ok {
				continue
			}
			rowMarks := perGrade[gradeID]
			for _, breakdown := range breakdowns {
				marks := 0.0
				if rowMarks != nil {
					if value, exists := rowMarks[breakdown.AssessmentMarkBreakdownID]; exists {
						marks = value
					}
				}
				students[i].BreakdownMarks = append(students[i].BreakdownMarks, TeacherReportStudentBreakdownMark{
					AssessmentMarkBreakdownID: breakdown.AssessmentMarkBreakdownID,
					MarksObtained:             marks,
				})
			}
		}
	}

	return &TeacherReportMarksSheet{
		AssessmentID: assessmentID,
		ClassID:      classID,
		SubjectID:    subjectID,
		SubjectName:  subjectName,
		ClassName:    className,
		TotalMarks:   subjectTotal,
		Breakdowns:   breakdowns,
		Students:     students,
	}, nil
}

func (r *Repository) UpsertTeacherReportMarks(ctx context.Context, teacherID, gradedByUserID, assessmentID, classID, subjectID uuid.UUID, entries []TeacherReportMarksUpdateEntry) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var classGrade int
	var schoolID uuid.UUID
	var academicYear string
	var subjectTotal float64
	var classAllowed bool
	var classGrades []int32
	var assessmentSubjectMarkID *uuid.UUID

	if err := tx.QueryRow(ctx, `
		SELECT
			c.grade,
			c.school_id,
			a.academic_year,
			COALESCE(asm.max_marks, a.max_marks, 0) AS total_marks,
			(
				c.class_teacher_id = $1
				OR EXISTS (
					SELECT 1 FROM timetables t
					WHERE t.class_id = c.id
					  AND t.teacher_id = $1
					  AND t.subject_id = $4
					  AND t.academic_year = a.academic_year
				)
				OR EXISTS (
					SELECT 1 FROM teacher_assignments ta
					WHERE ta.class_id = c.id
					  AND ta.teacher_id = $1
					  AND ta.subject_id = $4
					  AND ta.academic_year = a.academic_year
				)
			) AS class_allowed,
			COALESCE(a.class_grades, '{}'::INT[]),
			asm.id
		FROM classes c
		JOIN assessments a ON a.id = $2
		LEFT JOIN LATERAL (
			SELECT id, max_marks
			FROM assessment_subject_marks
			WHERE assessment_id = a.id
			  AND (subject_id = $4 OR subject_id IS NULL)
			ORDER BY (subject_id IS NULL) ASC, created_at ASC
			LIMIT 1
		) asm ON TRUE
		WHERE c.id = $3
	`, teacherID, assessmentID, classID, subjectID).Scan(&classGrade, &schoolID, &academicYear, &subjectTotal, &classAllowed, &classGrades, &assessmentSubjectMarkID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("failed to validate marks upsert scope: %w", err)
	}
	if !classAllowed {
		return ErrNotAuthorized
	}
	gradeAllowed := false
	for _, g := range classGrades {
		if int(g) == classGrade {
			gradeAllowed = true
			break
		}
	}
	if !gradeAllowed {
		return ErrNotAuthorized
	}

	breakdownMaxByID := make(map[uuid.UUID]float64, 8)
	if assessmentSubjectMarkID != nil {
		breakdownRows, err := tx.Query(ctx, `
			SELECT id, COALESCE(marks, 0)
			FROM assessment_mark_breakdowns
			WHERE assessment_subject_mark_id = $1
		`, *assessmentSubjectMarkID)
		if err != nil {
			return fmt.Errorf("failed to list breakdown config: %w", err)
		}
		defer breakdownRows.Close()

		for breakdownRows.Next() {
			var breakdownID uuid.UUID
			var breakdownMax float64
			if err := breakdownRows.Scan(&breakdownID, &breakdownMax); err != nil {
				return fmt.Errorf("failed to scan breakdown config: %w", err)
			}
			breakdownMaxByID[breakdownID] = breakdownMax
		}
	}

	seenStudents := make(map[uuid.UUID]struct{}, len(entries))

	for _, entry := range entries {
		studentID, parseErr := uuid.Parse(strings.TrimSpace(entry.StudentID))
		if parseErr != nil {
			return ErrInvalidInput
		}
		if _, exists := seenStudents[studentID]; exists {
			return ErrInvalidInput
		}
		seenStudents[studentID] = struct{}{}
		var belongs bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM students
				WHERE id = $1 AND class_id = $2
			)
		`, studentID, classID).Scan(&belongs); err != nil {
			return fmt.Errorf("failed to validate student class membership: %w", err)
		}
		if !belongs {
			return ErrInvalidInput
		}

		breakdownTotal := 0.0
		if len(breakdownMaxByID) > 0 {
			if len(entry.BreakdownMarks) != len(breakdownMaxByID) {
				return ErrInvalidInput
			}
			seen := make(map[uuid.UUID]struct{}, len(entry.BreakdownMarks))
			for _, component := range entry.BreakdownMarks {
				breakdownID, err := uuid.Parse(strings.TrimSpace(component.AssessmentMarkBreakdownID))
				if err != nil {
					return ErrInvalidInput
				}
				maxMarks, exists := breakdownMaxByID[breakdownID]
				if !exists {
					return ErrInvalidInput
				}
				if _, duplicated := seen[breakdownID]; duplicated {
					return ErrInvalidInput
				}
				seen[breakdownID] = struct{}{}
				if component.MarksObtained < 0 || component.MarksObtained > maxMarks {
					return ErrInvalidInput
				}
				breakdownTotal += component.MarksObtained
			}
			if len(seen) != len(breakdownMaxByID) {
				return ErrInvalidInput
			}
			if breakdownTotal > subjectTotal {
				return ErrInvalidInput
			}
		}

		marksObtained := entry.MarksObtained
		if len(breakdownMaxByID) > 0 {
			marksObtained = breakdownTotal
		}
		if marksObtained < 0 || marksObtained > subjectTotal {
			return ErrInvalidInput
		}

		percentage := 0.0
		if subjectTotal > 0 {
			percentage = (marksObtained / subjectTotal) * 100.0
		}
		gradeLetter := calculateGradeLetter(percentage)

		var studentGradeID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO student_grades (
				school_id, student_id, assessment_id, subject_id, marks_obtained, percentage, grade_letter, remarks,
				graded_by, graded_at, created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), $9, NOW(), NOW(), NOW())
			ON CONFLICT (assessment_id, student_id, subject_id)
			WHERE assessment_id IS NOT NULL AND subject_id IS NOT NULL
			DO UPDATE SET
				school_id = EXCLUDED.school_id,
				marks_obtained = EXCLUDED.marks_obtained,
				percentage = EXCLUDED.percentage,
				grade_letter = EXCLUDED.grade_letter,
				remarks = EXCLUDED.remarks,
				graded_by = EXCLUDED.graded_by,
				graded_at = NOW(),
				updated_at = NOW()
			RETURNING id
		`, schoolID, studentID, assessmentID, subjectID, marksObtained, percentage, gradeLetter, strings.TrimSpace(entry.Remarks), gradedByUserID).Scan(&studentGradeID); err != nil {
			return fmt.Errorf("failed to upsert student grade: %w", err)
		}

		if _, err := tx.Exec(ctx, `DELETE FROM student_grade_breakdowns WHERE student_grade_id = $1`, studentGradeID); err != nil {
			return fmt.Errorf("failed to clear student grade breakdowns: %w", err)
		}

		for _, component := range entry.BreakdownMarks {
			breakdownID, err := uuid.Parse(strings.TrimSpace(component.AssessmentMarkBreakdownID))
			if err != nil {
				return ErrInvalidInput
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO student_grade_breakdowns (student_grade_id, assessment_mark_breakdown_id, marks_obtained, created_at, updated_at)
				VALUES ($1, $2, $3, NOW(), NOW())
			`, studentGradeID, breakdownID, component.MarksObtained); err != nil {
				return fmt.Errorf("failed to insert student grade breakdown: %w", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func calculateGradeLetter(percentage float64) string {
	switch {
	case percentage >= 90:
		return "A+"
	case percentage >= 80:
		return "A"
	case percentage >= 70:
		return "B+"
	case percentage >= 60:
		return "B"
	case percentage >= 50:
		return "C"
	case percentage >= 40:
		return "D"
	default:
		return "F"
	}
}

// GetStudentsByClass retrieves students in a class
func (r *Repository) GetStudentsByClass(ctx context.Context, classID uuid.UUID) ([]StudentInfo, error) {
	query := `
		SELECT s.id, s.user_id, COALESCE(s.roll_number, ''), u.full_name, u.email
		FROM students s
		JOIN users u ON s.user_id = u.id
		WHERE s.class_id = $1
		ORDER BY s.roll_number
	`

	rows, err := r.db.Query(ctx, query, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var students []StudentInfo
	for rows.Next() {
		var s StudentInfo
		err := rows.Scan(&s.ID, &s.UserID, &s.RollNumber, &s.FullName, &s.Email)
		if err != nil {
			return nil, err
		}
		students = append(students, s)
	}
	return students, nil
}

// GetAttendanceByClassAndDate returns students in class with attendance status for the given date.
func (r *Repository) GetAttendanceByClassAndDate(ctx context.Context, classID uuid.UUID, date time.Time) ([]AttendanceStudentRecord, error) {
	query := `
		SELECT
			s.id AS student_id,
			s.user_id,
			u.full_name,
			COALESCE(s.roll_number, '') AS roll_number,
			u.email,
			COALESCE(a.status, '') AS status,
			COALESCE(a.remarks, '') AS remarks,
			a.marked_by
		FROM students s
		JOIN users u ON u.id = s.user_id
		LEFT JOIN attendance a
			ON a.student_id = s.id
			AND a.class_id = $1
			AND a.date = $2
		WHERE s.class_id = $1
		ORDER BY s.roll_number NULLS LAST, u.full_name
	`

	rows, err := r.db.Query(ctx, query, classID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]AttendanceStudentRecord, 0)
	for rows.Next() {
		var row AttendanceStudentRecord
		if err := rows.Scan(
			&row.StudentID,
			&row.UserID,
			&row.FullName,
			&row.RollNumber,
			&row.Email,
			&row.Status,
			&row.Remarks,
			&row.LastMarkedBy,
		); err != nil {
			return nil, err
		}
		records = append(records, row)
	}

	return records, nil
}

// CreateAnnouncement creates a new announcement
func (r *Repository) CreateAnnouncement(ctx context.Context, authorID uuid.UUID, req *CreateAnnouncementRequest) (uuid.UUID, error) {
	var targetID *uuid.UUID
	if req.TargetID != "" {
		id, _ := uuid.Parse(req.TargetID)
		targetID = &id
	}

	priority := req.Priority
	if priority == "" {
		priority = "normal"
	}

	var expiresAt *time.Time
	if req.ExpiresAt != "" {
		t, _ := time.Parse(time.RFC3339, req.ExpiresAt)
		expiresAt = &t
	}

	query := `
		INSERT INTO announcements (title, content, author_id, target_type, target_id, priority, is_pinned, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`

	var id uuid.UUID
	err := r.db.QueryRow(ctx, query,
		req.Title, req.Content, authorID, req.TargetType, targetID, priority, req.IsPinned, expiresAt,
	).Scan(&id)

	return id, err
}

// GetRecentAnnouncements gets recent announcements
func (r *Repository) GetRecentAnnouncements(ctx context.Context, limit int) ([]Announcement, error) {
	query := `
		SELECT a.id, a.title, a.content, a.author_id, a.target_type, a.target_id,
		       a.priority, a.is_pinned, a.expires_at, a.created_at, a.updated_at,
		       u.full_name as author_name
		FROM announcements a
		JOIN users u ON a.author_id = u.id
		WHERE (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
		ORDER BY a.is_pinned DESC, a.created_at DESC
		LIMIT $1
	`

	rows, err := r.db.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var announcements []Announcement
	for rows.Next() {
		var a Announcement
		err := rows.Scan(
			&a.ID, &a.Title, &a.Content, &a.AuthorID, &a.TargetType, &a.TargetID,
			&a.Priority, &a.IsPinned, &a.ExpiresAt, &a.CreatedAt, &a.UpdatedAt,
			&a.AuthorName,
		)
		if err != nil {
			return nil, err
		}
		announcements = append(announcements, a)
	}
	return announcements, nil
}

// GetStudentFeeData returns fee breakdown and payment history for a specific student,
// after verifying the requesting teacher is assigned to the student's class.
func (r *Repository) GetStudentFeeData(ctx context.Context, teacherID, studentID uuid.UUID) (*TeacherStudentFeeResponse, error) {
	// Verify teacher can see this student (timetable, class_teacher, or teacher_assignment)
	accessQuery := `
		SELECT EXISTS(
			SELECT 1 FROM students s
			WHERE s.id = $1
			  AND (
			      EXISTS (SELECT 1 FROM timetables tt WHERE tt.class_id = s.class_id AND tt.teacher_id = $2)
			   OR EXISTS (SELECT 1 FROM classes c   WHERE c.id = s.class_id AND c.class_teacher_id = $2)
			   OR EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = s.class_id AND ta.teacher_id = $2)
			  )
		)
	`
	var canAccess bool
	if err := r.db.QueryRow(ctx, accessQuery, studentID, teacherID).Scan(&canAccess); err != nil {
		return nil, fmt.Errorf("teacher fee access check failed: %w", err)
	}
	if !canAccess {
		return nil, ErrNotAuthorized
	}

	// Get student name and class info
	var studentName, className, academicYear string
	infoQuery := `
		SELECT u.full_name, COALESCE(c.name, ''), COALESCE(s.academic_year, '')
		FROM students s
		JOIN users u ON u.id = s.user_id
		LEFT JOIN classes c ON c.id = s.class_id
		WHERE s.id = $1
	`
	if err := r.db.QueryRow(ctx, infoQuery, studentID).Scan(&studentName, &className, &academicYear); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to fetch student info: %w", err)
	}
	if academicYear == "" {
		academicYear = getCurrentAcademicYear()
	}

	// Fee breakdown
	breakdownQuery := `
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

	bRows, err := r.db.Query(ctx, breakdownQuery, studentID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch fee breakdown: %w", err)
	}
	defer bRows.Close()

	breakdown := make([]TeacherStudentFeeItem, 0)
	var totalAmount, paidAmount float64
	for bRows.Next() {
		var item TeacherStudentFeeItem
		if err := bRows.Scan(
			&item.ID, &item.PurposeID, &item.PurposeName,
			&item.Amount, &item.PaidAmount, &item.Status, &item.DueDate,
		); err != nil {
			return nil, fmt.Errorf("failed to scan fee breakdown: %w", err)
		}
		totalAmount += item.Amount
		paidAmount += item.PaidAmount
		breakdown = append(breakdown, item)
	}
	bRows.Close()

	// Payment history
	paymentQuery := `
		SELECT p.id, p.amount, p.payment_method, p.payment_date, p.status, p.receipt_number, p.purpose
		FROM payments p
		WHERE p.student_id = $1
		ORDER BY p.payment_date DESC
		LIMIT 50
	`

	pRows, err := r.db.Query(ctx, paymentQuery, studentID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch payment history: %w", err)
	}
	defer pRows.Close()

	payments := make([]TeacherStudentPaymentItem, 0)
	for pRows.Next() {
		var item TeacherStudentPaymentItem
		if err := pRows.Scan(
			&item.ID, &item.Amount, &item.PaymentMethod, &item.PaymentDate,
			&item.Status, &item.ReceiptNumber, &item.Purpose,
		); err != nil {
			return nil, fmt.Errorf("failed to scan payment row: %w", err)
		}
		payments = append(payments, item)
	}

	pending := totalAmount - paidAmount
	if pending < 0 {
		pending = 0
	}

	return &TeacherStudentFeeResponse{
		StudentID:      studentID,
		StudentName:    studentName,
		ClassName:      className,
		AcademicYear:   academicYear,
		TotalAmount:    totalAmount,
		PaidAmount:     paidAmount,
		PendingAmount:  pending,
		Breakdown:      breakdown,
		PaymentHistory: payments,
	}, nil
}

// StudentInfo for listing students
type StudentInfo struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"user_id"`
	RollNumber string    `json:"roll_number"`
	FullName   string    `json:"full_name"`
	Email      string    `json:"email"`
}

// Helper function
func getCurrentAcademicYear() string {
	now := time.Now()
	year := now.Year()
	month := now.Month()

	if month < time.April {
		return fmt.Sprintf("%d-%d", year-1, year)
	}
	return fmt.Sprintf("%d-%d", year, year+1)
}

func (r *Repository) CreateQuestionDocument(ctx context.Context, doc *QuestionDocument) error {
	if r.db == nil {
		return errors.New("database not configured")
	}

	sum := sha256.Sum256(doc.Content)
	doc.FileSHA256 = hex.EncodeToString(sum[:])
	doc.UploadedAt = time.Now()

	// Store content in R2 only
	storageKey, err := objectstore.PutQuestionDocument(ctx, r.store, doc.SchoolID, doc.TeacherID, "", doc.FileName, doc.Content)
	if err != nil {
		return fmt.Errorf("upload question document to r2 failed school_id=%s teacher_id=%s file=%s: %w", doc.SchoolID, doc.TeacherID, doc.FileName, err)
	}
	if strings.TrimSpace(storageKey) == "" {
		return errors.New("r2 storage key missing for question document")
	}

	var id string
	err = r.db.QueryRow(ctx, `
		INSERT INTO question_documents (
			teacher_id, teacher_name, school_id,
			title, topic, subject, class_level, question_type,
			difficulty, num_questions, context,
			file_name, file_size, mime_type, file_sha256,
			storage_key, uploaded_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		ON CONFLICT (teacher_id, file_sha256, question_type) DO UPDATE
		SET uploaded_at = question_documents.uploaded_at
		RETURNING id::text
	`, doc.TeacherID, doc.TeacherName, doc.SchoolID, doc.Title, doc.Topic, doc.Subject, doc.ClassLevel, doc.QuestionType, doc.Difficulty, doc.NumQuestions, doc.Context, doc.FileName, doc.FileSize, doc.MimeType, doc.FileSHA256, storageKey, doc.UploadedAt).Scan(&id)
	if err != nil {
		return fmt.Errorf("failed to insert question document: %w", err)
	}
	doc.ID = id
	return nil
}

func (r *Repository) ListQuestionDocuments(ctx context.Context, teacherID string, limit int64) ([]QuestionDocument, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	rows, err := r.db.Query(ctx, `
		SELECT id::text, teacher_id, teacher_name, school_id, title, topic, subject, class_level,
		       question_type, difficulty, num_questions, context, file_name, file_size, mime_type,
		       file_sha256, uploaded_at
		FROM question_documents
		WHERE teacher_id = $1
		ORDER BY uploaded_at DESC
		LIMIT $2
	`, teacherID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list question documents: %w", err)
	}
	defer rows.Close()

	docs := make([]QuestionDocument, 0)
	for rows.Next() {
		var raw QuestionDocument
		if err := rows.Scan(&raw.ID, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.Title, &raw.Topic, &raw.Subject, &raw.ClassLevel, &raw.QuestionType, &raw.Difficulty, &raw.NumQuestions, &raw.Context, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt); err != nil {
			return nil, fmt.Errorf("failed to scan question document: %w", err)
		}
		docs = append(docs, QuestionDocument{
			ID:           raw.ID,
			TeacherID:    raw.TeacherID,
			TeacherName:  raw.TeacherName,
			SchoolID:     raw.SchoolID,
			Title:        raw.Title,
			Topic:        raw.Topic,
			Subject:      raw.Subject,
			ClassLevel:   raw.ClassLevel,
			QuestionType: raw.QuestionType,
			Difficulty:   raw.Difficulty,
			NumQuestions: raw.NumQuestions,
			Context:      raw.Context,
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
	return docs, nil
}

func (r *Repository) ListQuestionDocumentsPaged(ctx context.Context, teacherID string, page, pageSize int64, ascending bool, subject, classLevel, search string) ([]QuestionDocument, bool, error) {
	if r.db == nil {
		return nil, false, errors.New("database not configured")
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	skip := (page - 1) * pageSize
	limit := pageSize + 1
	sortDir := "DESC"
	if ascending {
		sortDir = "ASC"
	}
	where := []string{"teacher_id = $1"}
	args := []any{teacherID}
	argPos := 2
	if subject = strings.TrimSpace(subject); subject != "" {
		if subject == "__unspecified__" {
			where = append(where, "COALESCE(NULLIF(TRIM(subject), ''), '') = ''")
		} else {
			where = append(where, fmt.Sprintf("LOWER(TRIM(subject)) = LOWER(TRIM($%d))", argPos))
			args = append(args, subject)
			argPos++
		}
	}
	if classLevel = strings.TrimSpace(classLevel); classLevel != "" {
		if classLevel == "__unspecified__" {
			where = append(where, "COALESCE(NULLIF(TRIM(class_level), ''), '') = ''")
		} else {
			where = append(where, fmt.Sprintf("LOWER(TRIM(class_level)) = LOWER(TRIM($%d))", argPos))
			args = append(args, classLevel)
			argPos++
		}
	}
	if search = strings.TrimSpace(search); search != "" {
		where = append(where, fmt.Sprintf("(title ILIKE $%d OR file_name ILIKE $%d OR teacher_name ILIKE $%d)", argPos, argPos, argPos))
		args = append(args, "%"+search+"%")
		argPos++
	}
	query := fmt.Sprintf(`
		SELECT id::text, teacher_id, teacher_name, school_id, title, topic, subject, class_level,
		       question_type, difficulty, num_questions, context, file_name, file_size, mime_type,
		       file_sha256, uploaded_at
		FROM question_documents
		WHERE %s
		ORDER BY uploaded_at %s
		LIMIT $%d OFFSET $%d
	`, strings.Join(where, " AND "), sortDir, argPos, argPos+1)
	args = append(args, limit, skip)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list paged question documents: %w", err)
	}
	defer rows.Close()

	docs := make([]QuestionDocument, 0, pageSize+1)
	for rows.Next() {
		var raw QuestionDocument
		if err := rows.Scan(&raw.ID, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.Title, &raw.Topic, &raw.Subject, &raw.ClassLevel, &raw.QuestionType, &raw.Difficulty, &raw.NumQuestions, &raw.Context, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt); err != nil {
			return nil, false, fmt.Errorf("failed to scan paged question document: %w", err)
		}
		docs = append(docs, QuestionDocument{
			ID:           raw.ID,
			TeacherID:    raw.TeacherID,
			TeacherName:  raw.TeacherName,
			SchoolID:     raw.SchoolID,
			Title:        raw.Title,
			Topic:        raw.Topic,
			Subject:      raw.Subject,
			ClassLevel:   raw.ClassLevel,
			QuestionType: raw.QuestionType,
			Difficulty:   raw.Difficulty,
			NumQuestions: raw.NumQuestions,
			Context:      raw.Context,
			FileName:     raw.FileName,
			FileSize:     raw.FileSize,
			MimeType:     raw.MimeType,
			FileSHA256:   raw.FileSHA256,
			UploadedAt:   raw.UploadedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}

	hasMore := int64(len(docs)) > pageSize
	if hasMore {
		docs = docs[:pageSize]
	}

	return docs, hasMore, nil
}

func (r *Repository) GetQuestionDocumentFilterValues(ctx context.Context, teacherID string) ([]string, []string, bool, bool, error) {
	if r.db == nil {
		return nil, nil, false, false, errors.New("database not configured")
	}
	var subjects []string
	subjectRows, err := r.db.Query(ctx, `
		SELECT DISTINCT subject
		FROM question_documents
		WHERE teacher_id = $1 AND COALESCE(NULLIF(TRIM(subject), ''), '') <> ''
		ORDER BY LOWER(TRIM(subject))
	`, teacherID)
	if err != nil {
		return nil, nil, false, false, fmt.Errorf("failed to fetch subject filters: %w", err)
	}
	defer subjectRows.Close()
	for subjectRows.Next() {
		var subject string
		if err := subjectRows.Scan(&subject); err != nil {
			return nil, nil, false, false, fmt.Errorf("failed to scan subject filter: %w", err)
		}
		subjects = append(subjects, strings.TrimSpace(subject))
	}
	if err := subjectRows.Err(); err != nil {
		return nil, nil, false, false, err
	}

	var classes []string
	classRows, err := r.db.Query(ctx, `
		SELECT DISTINCT class_level
		FROM question_documents
		WHERE teacher_id = $1 AND COALESCE(NULLIF(TRIM(class_level), ''), '') <> ''
		ORDER BY LOWER(TRIM(class_level))
	`, teacherID)
	if err != nil {
		return nil, nil, false, false, fmt.Errorf("failed to fetch class filters: %w", err)
	}
	defer classRows.Close()
	for classRows.Next() {
		var classLevel string
		if err := classRows.Scan(&classLevel); err != nil {
			return nil, nil, false, false, fmt.Errorf("failed to scan class filter: %w", err)
		}
		classes = append(classes, strings.TrimSpace(classLevel))
	}
	if err := classRows.Err(); err != nil {
		return nil, nil, false, false, err
	}

	var unspecifiedSubjectCount int64
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM question_documents
		WHERE teacher_id = $1 AND COALESCE(NULLIF(TRIM(subject), ''), '') = ''
	`, teacherID).Scan(&unspecifiedSubjectCount); err != nil {
		return nil, nil, false, false, fmt.Errorf("failed to count unspecified subject docs: %w", err)
	}

	var unspecifiedClassCount int64
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM question_documents
		WHERE teacher_id = $1 AND COALESCE(NULLIF(TRIM(class_level), ''), '') = ''
	`, teacherID).Scan(&unspecifiedClassCount); err != nil {
		return nil, nil, false, false, fmt.Errorf("failed to count unspecified class docs: %w", err)
	}

	return subjects, classes, unspecifiedSubjectCount > 0, unspecifiedClassCount > 0, nil
}

func (r *Repository) GetQuestionDocumentByID(ctx context.Context, teacherID, documentID string) (*QuestionDocument, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}

	var raw struct {
		ID           string
		TeacherID    string
		TeacherName  string
		SchoolID     string
		Title        string
		Topic        string
		Subject      string
		ClassLevel   string
		QuestionType string
		Difficulty   string
		NumQuestions int
		Context      string
		FileName     string
		FileSize     int64
		MimeType     string
		FileSHA256   string
		UploadedAt   time.Time
		StorageKey   string
	}
	if err := r.db.QueryRow(ctx, `
		SELECT id::text, teacher_id, teacher_name, school_id, title, topic, subject, class_level,
		       question_type, difficulty, num_questions, context, file_name, file_size, mime_type,
		       file_sha256, uploaded_at, storage_key
		FROM question_documents
		WHERE id::text = $1 AND teacher_id = $2
		LIMIT 1
	`, strings.TrimSpace(documentID), teacherID).Scan(&raw.ID, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.Title, &raw.Topic, &raw.Subject, &raw.ClassLevel, &raw.QuestionType, &raw.Difficulty, &raw.NumQuestions, &raw.Context, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt, &raw.StorageKey); err != nil {
		return nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve document content: %w", err)
	}

	return &QuestionDocument{
		ID:           raw.ID,
		TeacherID:    raw.TeacherID,
		TeacherName:  raw.TeacherName,
		SchoolID:     raw.SchoolID,
		Title:        raw.Title,
		Topic:        raw.Topic,
		Subject:      raw.Subject,
		ClassLevel:   raw.ClassLevel,
		QuestionType: raw.QuestionType,
		Difficulty:   raw.Difficulty,
		NumQuestions: raw.NumQuestions,
		Context:      raw.Context,
		FileName:     raw.FileName,
		FileSize:     raw.FileSize,
		MimeType:     raw.MimeType,
		FileSHA256:   raw.FileSHA256,
		UploadedAt:   raw.UploadedAt,
		Content:      content,
	}, nil
}

func (r *Repository) CreateStudyMaterial(ctx context.Context, doc *StudyMaterial) error {
	if r.db == nil {
		return errors.New("database not configured")
	}

	sum := sha256.Sum256(doc.Content)
	doc.FileSHA256 = hex.EncodeToString(sum[:])
	doc.UploadedAt = time.Now()

	// Store content in R2 only
	storageKey, err := objectstore.PutStudyMaterial(ctx, r.store, doc.SchoolID, doc.UploaderID, "", doc.FileName, doc.Content)
	if err != nil {
		return fmt.Errorf("upload study material to r2 failed school_id=%s uploader_id=%s file=%s: %w", doc.SchoolID, doc.UploaderID, doc.FileName, err)
	}
	if strings.TrimSpace(storageKey) == "" {
		return errors.New("r2 storage key missing for study material")
	}

	insertSQL := `
		INSERT INTO study_materials (
			uploader_id, uploader_name, uploader_role, teacher_id, teacher_name, school_id,
			title, subject, subject_key, class_level, class_key, description,
			file_name, file_size, mime_type, file_sha256, storage_key, uploaded_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		ON CONFLICT (school_id, teacher_id, file_sha256, subject, class_level) DO UPDATE
		SET uploaded_at = study_materials.uploaded_at
		RETURNING id::text
	`

	var id string
	err = r.db.QueryRow(ctx, insertSQL,
		doc.UploaderID,
		doc.UploaderName,
		doc.UploaderRole,
		doc.TeacherID,
		doc.TeacherName,
		doc.SchoolID,
		doc.Title,
		doc.Subject,
		normalizeSubjectKey(doc.Subject),
		doc.ClassLevel,
		normalizeClassKey(doc.ClassLevel),
		doc.Description,
		doc.FileName,
		doc.FileSize,
		doc.MimeType,
		doc.FileSHA256,
		storageKey,
		doc.UploadedAt,
	).Scan(&id)
	if err != nil && isUndefinedTableErr(err) {
		if ensureErr := r.ensureTenantDocumentMetadataTables(ctx); ensureErr != nil {
			return fmt.Errorf("failed to self-heal missing document metadata tables after undefined table error: %w", ensureErr)
		}
		err = r.db.QueryRow(ctx, insertSQL,
			doc.UploaderID,
			doc.UploaderName,
			doc.UploaderRole,
			doc.TeacherID,
			doc.TeacherName,
			doc.SchoolID,
			doc.Title,
			doc.Subject,
			normalizeSubjectKey(doc.Subject),
			doc.ClassLevel,
			normalizeClassKey(doc.ClassLevel),
			doc.Description,
			doc.FileName,
			doc.FileSize,
			doc.MimeType,
			doc.FileSHA256,
			storageKey,
			doc.UploadedAt,
		).Scan(&id)
	}
	if err != nil {
		return fmt.Errorf("failed to insert study material: %w", err)
	}
	doc.ID = id
	return nil
}

// ─── Student Individual Reports (per-student, school-isolated) ────────────────

// CreateStudentIndividualReport stores a report for a specific student in R2.
func (r *Repository) CreateStudentIndividualReport(ctx context.Context, doc *StudentIndividualReport) error {
	if r.db == nil {
		return errors.New("database not configured")
	}
	sum := sha256.Sum256(doc.Content)
	doc.FileSHA256 = hex.EncodeToString(sum[:])
	doc.UploadedAt = time.Now()
	doc.ReportType = strings.TrimSpace(strings.ToLower(doc.ReportType))
	if doc.ReportType == "" {
		doc.ReportType = "report"
	}

	// Store content in R2 only
	storageKey, err := objectstore.PutStudentReport(ctx, r.store, doc.SchoolID, doc.TeacherID, "", doc.FileName, doc.Content)
	if err != nil {
		return fmt.Errorf("upload student report to r2 failed school_id=%s teacher_id=%s file=%s: %w", doc.SchoolID, doc.TeacherID, doc.FileName, err)
	}
	if strings.TrimSpace(storageKey) == "" {
		return errors.New("r2 storage key missing for student report")
	}

	var id string
	err = r.db.QueryRow(ctx, `
		INSERT INTO student_individual_reports (
			school_id, class_id, class_name, student_id, student_name, teacher_id, teacher_name,
			title, report_type, academic_year, description,
			file_name, file_size, mime_type, file_sha256, storage_key, uploaded_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		ON CONFLICT (school_id, teacher_id, student_id, class_id, file_sha256, academic_year, report_type) DO UPDATE
		SET uploaded_at = student_individual_reports.uploaded_at
		RETURNING id::text
	`, doc.SchoolID, doc.ClassID, doc.ClassName, doc.StudentID, doc.StudentName, doc.TeacherID, doc.TeacherName, doc.Title, doc.ReportType, doc.AcademicYear, doc.Description, doc.FileName, doc.FileSize, doc.MimeType, doc.FileSHA256, storageKey, doc.UploadedAt).Scan(&id)
	if err != nil {
		return fmt.Errorf("failed to insert student individual report: %w", err)
	}
	doc.ID = id
	return nil
}

// ListStudentIndividualReports returns paged per-student reports uploaded by a teacher.
func (r *Repository) ListStudentIndividualReports(ctx context.Context, teacherID string, page, pageSize int64, ascending bool, classID, studentID, academicYear string) ([]StudentIndividualReport, bool, error) {
	if r.db == nil {
		return nil, false, errors.New("database not configured")
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	skip := (page - 1) * pageSize
	limit := pageSize + 1
	sortDir := "DESC"
	if ascending {
		sortDir = "ASC"
	}
	where := []string{"teacher_id = $1"}
	args := []any{teacherID}
	argPos := 2
	if classID = strings.TrimSpace(classID); classID != "" {
		where = append(where, fmt.Sprintf("class_id = $%d", argPos))
		args = append(args, classID)
		argPos++
	}
	if studentID = strings.TrimSpace(studentID); studentID != "" {
		where = append(where, fmt.Sprintf("student_id = $%d", argPos))
		args = append(args, studentID)
		argPos++
	}
	if academicYear = strings.TrimSpace(academicYear); academicYear != "" {
		where = append(where, fmt.Sprintf("academic_year = $%d", argPos))
		args = append(args, academicYear)
		argPos++
	}
	query := fmt.Sprintf(`
		SELECT id::text, school_id, class_id, class_name, student_id, student_name, teacher_id, teacher_name,
		       title, report_type, academic_year, description, file_name, file_size, mime_type, file_sha256, uploaded_at
		FROM student_individual_reports
		WHERE %s
		ORDER BY uploaded_at %s
		LIMIT $%d OFFSET $%d
	`, strings.Join(where, " AND "), sortDir, argPos, argPos+1)
	args = append(args, limit, skip)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list student individual reports: %w", err)
	}
	defer rows.Close()

	docs := make([]StudentIndividualReport, 0, pageSize+1)
	for rows.Next() {
		var raw StudentIndividualReport
		if err := rows.Scan(&raw.ID, &raw.SchoolID, &raw.ClassID, &raw.ClassName, &raw.StudentID, &raw.StudentName, &raw.TeacherID, &raw.TeacherName, &raw.Title, &raw.ReportType, &raw.AcademicYear, &raw.Description, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt); err != nil {
			return nil, false, fmt.Errorf("failed to scan student individual report: %w", err)
		}
		docs = append(docs, StudentIndividualReport{
			ID:           raw.ID,
			SchoolID:     raw.SchoolID,
			ClassID:      raw.ClassID,
			ClassName:    raw.ClassName,
			StudentID:    raw.StudentID,
			StudentName:  raw.StudentName,
			TeacherID:    raw.TeacherID,
			TeacherName:  raw.TeacherName,
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
		return nil, false, err
	}

	hasMore := int64(len(docs)) > pageSize
	if hasMore {
		docs = docs[:pageSize]
	}
	return docs, hasMore, nil
}

// GetStudentIndividualReportByID fetches a single report, enforcing teacher ownership.
func (r *Repository) GetStudentIndividualReportByID(ctx context.Context, teacherID, reportID string) (*StudentIndividualReport, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}

	var raw struct {
		ID           string
		SchoolID     string
		ClassID      string
		ClassName    string
		StudentID    string
		StudentName  string
		TeacherID    string
		TeacherName  string
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
		SELECT id::text, school_id, class_id, class_name, student_id, student_name, teacher_id, teacher_name,
		       title, report_type, academic_year, description, file_name, file_size, mime_type, file_sha256, uploaded_at, storage_key
		FROM student_individual_reports
		WHERE id::text = $1 AND teacher_id = $2
		LIMIT 1
	`, strings.TrimSpace(reportID), teacherID).Scan(&raw.ID, &raw.SchoolID, &raw.ClassID, &raw.ClassName, &raw.StudentID, &raw.StudentName, &raw.TeacherID, &raw.TeacherName, &raw.Title, &raw.ReportType, &raw.AcademicYear, &raw.Description, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt, &raw.StorageKey); err != nil {
		return nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve report content: %w", err)
	}

	return &StudentIndividualReport{
		ID:           raw.ID,
		SchoolID:     raw.SchoolID,
		ClassID:      raw.ClassID,
		ClassName:    raw.ClassName,
		StudentID:    raw.StudentID,
		StudentName:  raw.StudentName,
		TeacherID:    raw.TeacherID,
		TeacherName:  raw.TeacherName,
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

func (r *Repository) ListStudyMaterialsPaged(ctx context.Context, teacherID string, page, pageSize int64, ascending bool, subject, classLevel, search string) ([]StudyMaterial, bool, error) {
	if r.db == nil {
		return nil, false, errors.New("database not configured")
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	skip := (page - 1) * pageSize
	limit := pageSize + 1
	sortDir := "DESC"
	if ascending {
		sortDir = "ASC"
	}
	where := []string{"(teacher_id = $1 OR uploader_id = $1)"}
	args := []any{teacherID}
	argPos := 2
	if subject = strings.TrimSpace(subject); subject != "" {
		where = append(where, fmt.Sprintf("LOWER(TRIM(subject)) = LOWER(TRIM($%d))", argPos))
		args = append(args, subject)
		argPos++
	}
	if classLevel = strings.TrimSpace(classLevel); classLevel != "" {
		where = append(where, fmt.Sprintf("LOWER(TRIM(class_level)) = LOWER(TRIM($%d))", argPos))
		args = append(args, classLevel)
		argPos++
	}
	if search = strings.TrimSpace(search); search != "" {
		where = append(where, fmt.Sprintf("(title ILIKE $%d OR file_name ILIKE $%d OR description ILIKE $%d)", argPos, argPos, argPos))
		args = append(args, "%"+search+"%")
		argPos++
	}
	query := fmt.Sprintf(`
		SELECT id::text, uploader_id, uploader_name, uploader_role, teacher_id, teacher_name, school_id, title,
		       subject, class_level, description, file_name, file_size, mime_type, file_sha256, uploaded_at
		FROM study_materials
		WHERE %s
		ORDER BY uploaded_at %s
		LIMIT $%d OFFSET $%d
	`, strings.Join(where, " AND "), sortDir, argPos, argPos+1)
	args = append(args, limit, skip)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		if isUndefinedTableErr(err) {
			if ensureErr := r.ensureTenantDocumentMetadataTables(ctx); ensureErr != nil {
				return nil, false, fmt.Errorf("failed to self-heal missing document metadata tables after undefined table error: %w", ensureErr)
			}
			rows, err = r.db.Query(ctx, query, args...)
			if err != nil {
				return nil, false, fmt.Errorf("failed to list paged study materials after self-heal retry: %w", err)
			}
		} else {
			return nil, false, fmt.Errorf("failed to list paged study materials: %w", err)
		}
	}
	defer rows.Close()

	docs := make([]StudyMaterial, 0, pageSize+1)
	for rows.Next() {
		var raw StudyMaterial
		if err := rows.Scan(&raw.ID, &raw.UploaderID, &raw.UploaderName, &raw.UploaderRole, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.Title, &raw.Subject, &raw.ClassLevel, &raw.Description, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt); err != nil {
			return nil, false, fmt.Errorf("failed to scan paged study material: %w", err)
		}
		docs = append(docs, StudyMaterial{
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
		})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}

	hasMore := int64(len(docs)) > pageSize
	if hasMore {
		docs = docs[:pageSize]
	}
	return docs, hasMore, nil
}

func (r *Repository) GetStudyMaterialByID(ctx context.Context, teacherID, materialID string) (*StudyMaterial, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}

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
	fetchSQL := `
		SELECT id::text, uploader_id, uploader_name, uploader_role, teacher_id, teacher_name, school_id, title,
		       subject, class_level, description, file_name, file_size, mime_type, file_sha256, uploaded_at, storage_key
		FROM study_materials
		WHERE id::text = $1 AND (teacher_id = $2 OR uploader_id = $2)
		LIMIT 1
	`

	err := r.db.QueryRow(ctx, fetchSQL, strings.TrimSpace(materialID), teacherID).Scan(
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
		&raw.StorageKey,
	)
	if err != nil && isUndefinedTableErr(err) {
		if ensureErr := r.ensureTenantDocumentMetadataTables(ctx); ensureErr != nil {
			return nil, fmt.Errorf("failed to self-heal missing document metadata tables after undefined table error: %w", ensureErr)
		}
		err = r.db.QueryRow(ctx, fetchSQL, strings.TrimSpace(materialID), teacherID).Scan(
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
			&raw.StorageKey,
		)
	}
	if err != nil {
		return nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve document content: %w", err)
	}

	return &StudyMaterial{
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

func (r *Repository) DeleteStudyMaterialByID(ctx context.Context, teacherID, materialID string) error {
	if r.db == nil {
		return errors.New("database not configured")
	}
	deleteSQL := `
		DELETE FROM study_materials
		WHERE id::text = $1 AND (teacher_id = $2 OR uploader_id = $2)
	`
	tag, err := r.db.ExecResult(ctx, deleteSQL, strings.TrimSpace(materialID), teacherID)
	if err != nil && isUndefinedTableErr(err) {
		if ensureErr := r.ensureTenantDocumentMetadataTables(ctx); ensureErr != nil {
			return fmt.Errorf("failed to self-heal missing document metadata tables after undefined table error: %w", ensureErr)
		}
		tag, err = r.db.ExecResult(ctx, deleteSQL, strings.TrimSpace(materialID), teacherID)
	}
	if err != nil {
		return fmt.Errorf("failed to delete study material: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) ListQuestionDocumentsBySchoolPaged(ctx context.Context, schoolID string, page, pageSize int64, ascending bool) ([]QuestionDocument, bool, error) {
	if r.db == nil {
		return nil, false, errors.New("database not configured")
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	sortDir := "DESC"
	if ascending {
		sortDir = "ASC"
	}
	skip := (page - 1) * pageSize
	limit := pageSize + 1

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT id::text, teacher_id, teacher_name, school_id, title, topic, subject, class_level,
		       question_type, difficulty, num_questions, context, file_name, file_size, mime_type,
		       file_sha256, uploaded_at
		FROM question_documents
		WHERE school_id = $1
		ORDER BY uploaded_at %s
		LIMIT $2 OFFSET $3
	`, sortDir), schoolID, limit, skip)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list paged school question documents: %w", err)
	}
	defer rows.Close()

	docs := make([]QuestionDocument, 0, pageSize+1)
	for rows.Next() {
		var raw QuestionDocument
		if err := rows.Scan(&raw.ID, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.Title, &raw.Topic, &raw.Subject, &raw.ClassLevel, &raw.QuestionType, &raw.Difficulty, &raw.NumQuestions, &raw.Context, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt); err != nil {
			return nil, false, fmt.Errorf("failed to scan paged school question document: %w", err)
		}
		docs = append(docs, QuestionDocument{
			ID:           raw.ID,
			TeacherID:    raw.TeacherID,
			TeacherName:  raw.TeacherName,
			SchoolID:     raw.SchoolID,
			Title:        raw.Title,
			Topic:        raw.Topic,
			Subject:      raw.Subject,
			ClassLevel:   raw.ClassLevel,
			QuestionType: raw.QuestionType,
			Difficulty:   raw.Difficulty,
			NumQuestions: raw.NumQuestions,
			Context:      raw.Context,
			FileName:     raw.FileName,
			FileSize:     raw.FileSize,
			MimeType:     raw.MimeType,
			FileSHA256:   raw.FileSHA256,
			UploadedAt:   raw.UploadedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}

	hasMore := int64(len(docs)) > pageSize
	if hasMore {
		docs = docs[:pageSize]
	}

	return docs, hasMore, nil
}

func (r *Repository) GetQuestionDocumentBySchoolAndID(ctx context.Context, schoolID, documentID string) (*QuestionDocument, error) {
	if r.db == nil {
		return nil, errors.New("database not configured")
	}

	var raw struct {
		ID           string
		TeacherID    string
		TeacherName  string
		SchoolID     string
		Title        string
		Topic        string
		Subject      string
		ClassLevel   string
		QuestionType string
		Difficulty   string
		NumQuestions int
		Context      string
		FileName     string
		FileSize     int64
		MimeType     string
		FileSHA256   string
		UploadedAt   time.Time
		StorageKey   string
	}

	err := r.db.QueryRow(ctx, `
		SELECT id::text, teacher_id, teacher_name, school_id, title, topic, subject, class_level,
		       question_type, difficulty, num_questions, context, file_name, file_size, mime_type,
		       file_sha256, uploaded_at, storage_key
		FROM question_documents
		WHERE id::text = $1 AND school_id = $2
		LIMIT 1
	`, strings.TrimSpace(documentID), schoolID).Scan(&raw.ID, &raw.TeacherID, &raw.TeacherName, &raw.SchoolID, &raw.Title, &raw.Topic, &raw.Subject, &raw.ClassLevel, &raw.QuestionType, &raw.Difficulty, &raw.NumQuestions, &raw.Context, &raw.FileName, &raw.FileSize, &raw.MimeType, &raw.FileSHA256, &raw.UploadedAt, &raw.StorageKey)
	if err != nil {
		return nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve question document content: %w", err)
	}

	return &QuestionDocument{
		ID:           raw.ID,
		TeacherID:    raw.TeacherID,
		TeacherName:  raw.TeacherName,
		SchoolID:     raw.SchoolID,
		Title:        raw.Title,
		Topic:        raw.Topic,
		Subject:      raw.Subject,
		ClassLevel:   raw.ClassLevel,
		QuestionType: raw.QuestionType,
		Difficulty:   raw.Difficulty,
		NumQuestions: raw.NumQuestions,
		Context:      raw.Context,
		FileName:     raw.FileName,
		FileSize:     raw.FileSize,
		MimeType:     raw.MimeType,
		FileSHA256:   raw.FileSHA256,
		UploadedAt:   raw.UploadedAt,
		Content:      content,
	}, nil
}

func (r *Repository) CreateSuperAdminQuestionDocument(ctx context.Context, ownerUserID, ownerEmail string, doc *QuestionDocument) error {
	sum := sha256.Sum256(doc.Content)
	doc.FileSHA256 = hex.EncodeToString(sum[:])
	doc.UploadedAt = time.Now()

	var existingID string
	err := r.db.QueryRow(ctx, `
		SELECT id::text
		FROM public.super_admin_question_documents
		WHERE owner_user_id = $1
		  AND file_sha256 = $2
		  AND question_type = $3
	`, ownerUserID, doc.FileSHA256, doc.QuestionType).Scan(&existingID)
	if err == nil {
		doc.ID = existingID
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("failed to check existing super admin question document: %w", err)
	}

	// Store content in R2 only
	storageKey, err := objectstore.PutSuperAdminDocument(ctx, r.store, ownerUserID, "questions", "", doc.FileName, doc.Content)
	if err != nil {
		return fmt.Errorf("upload super-admin question document to r2 failed owner=%s file=%s: %w", ownerUserID, doc.FileName, err)
	}
	if strings.TrimSpace(storageKey) == "" {
		return errors.New("r2 storage key missing for super-admin question document")
	}

	err = r.db.QueryRow(ctx, `
		INSERT INTO public.super_admin_question_documents (
			owner_user_id,
			owner_email,
			title,
			subject,
			subject_key,
			class_level,
			class_key,
			question_type,
			difficulty,
			context,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			storage_key,
			uploaded_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
		)
		RETURNING id::text
	`,
		ownerUserID,
		ownerEmail,
		doc.Title,
		doc.Subject,
		normalizeSubjectKey(doc.Subject),
		doc.ClassLevel,
		normalizeClassKey(doc.ClassLevel),
		doc.QuestionType,
		doc.Difficulty,
		doc.Context,
		doc.FileName,
		doc.FileSize,
		doc.MimeType,
		doc.FileSHA256,
		storageKey,
		doc.UploadedAt,
	).Scan(&doc.ID)
	if err != nil {
		return fmt.Errorf("failed to insert super admin question document: %w", err)
	}
	return nil
}

func (r *Repository) ListSuperAdminQuestionDocumentsPaged(ctx context.Context, page, pageSize int64, ascending bool) ([]QuestionDocument, bool, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	sortOrder := int32(-1)
	if ascending {
		sortOrder = 1
	}
	skip := (page - 1) * pageSize
	limit := pageSize + 1
	sortDirection := "DESC"
	if sortOrder == 1 {
		sortDirection = "ASC"
	}

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT
			id::text,
			owner_email,
			title,
			subject,
			class_level,
			question_type,
			difficulty,
			context,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			uploaded_at
		FROM public.super_admin_question_documents
		ORDER BY uploaded_at %s
		OFFSET $1
		LIMIT $2
	`, sortDirection), skip, limit)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list paged super admin question documents: %w", err)
	}
	defer rows.Close()

	docs := make([]QuestionDocument, 0, pageSize+1)
	for rows.Next() {
		var raw QuestionDocument
		if err := rows.Scan(
			&raw.ID,
			&raw.UploadedByName,
			&raw.Title,
			&raw.Subject,
			&raw.ClassLevel,
			&raw.QuestionType,
			&raw.Difficulty,
			&raw.Context,
			&raw.FileName,
			&raw.FileSize,
			&raw.MimeType,
			&raw.FileSHA256,
			&raw.UploadedAt,
		); err != nil {
			return nil, false, fmt.Errorf("failed to decode paged super admin question document: %w", err)
		}
		docs = append(docs, raw)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("failed while iterating paged super admin question documents: %w", err)
	}

	hasMore := int64(len(docs)) > pageSize
	if hasMore {
		docs = docs[:pageSize]
	}
	return docs, hasMore, nil
}

func (r *Repository) GetSuperAdminQuestionDocumentByID(ctx context.Context, documentID string) (*QuestionDocument, error) {
	var raw struct {
		ID           string
		Title        string
		Subject      string
		ClassLevel   string
		QuestionType string
		Difficulty   string
		Context      string
		FileName     string
		FileSize     int64
		MimeType     string
		FileSHA256   string
		UploadedAt   time.Time
		StorageKey   string
	}

	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			title,
			subject,
			class_level,
			question_type,
			difficulty,
			context,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			uploaded_at,
			storage_key
		FROM public.super_admin_question_documents
		WHERE id::text = $1
	`, documentID).Scan(
		&raw.ID,
		&raw.Title,
		&raw.Subject,
		&raw.ClassLevel,
		&raw.QuestionType,
		&raw.Difficulty,
		&raw.Context,
		&raw.FileName,
		&raw.FileSize,
		&raw.MimeType,
		&raw.FileSHA256,
		&raw.UploadedAt,
		&raw.StorageKey,
	)
	if err != nil {
		return nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve super admin question document content: %w", err)
	}

	return &QuestionDocument{
		ID:           raw.ID,
		Title:        raw.Title,
		Subject:      raw.Subject,
		ClassLevel:   raw.ClassLevel,
		QuestionType: raw.QuestionType,
		Difficulty:   raw.Difficulty,
		Context:      raw.Context,
		FileName:     raw.FileName,
		FileSize:     raw.FileSize,
		MimeType:     raw.MimeType,
		FileSHA256:   raw.FileSHA256,
		UploadedAt:   raw.UploadedAt,
		Content:      content,
	}, nil
}

func (r *Repository) DeleteSuperAdminQuestionDocumentByID(ctx context.Context, documentID string) error {
	tag, err := r.db.ExecResult(ctx, `
		DELETE FROM public.super_admin_question_documents
		WHERE id::text = $1
	`, documentID)
	if err != nil {
		return fmt.Errorf("failed to delete super admin question document: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) CreateSuperAdminStudyMaterial(ctx context.Context, ownerUserID string, doc *StudyMaterial) error {
	sum := sha256.Sum256(doc.Content)
	doc.FileSHA256 = hex.EncodeToString(sum[:])
	doc.UploadedAt = time.Now()

	var existingID string
	err := r.db.QueryRow(ctx, `
		SELECT id::text
		FROM public.super_admin_study_materials
		WHERE owner_user_id = $1
		  AND file_sha256 = $2
		  AND subject = $3
		  AND class_level = $4
	`, ownerUserID, doc.FileSHA256, doc.Subject, doc.ClassLevel).Scan(&existingID)
	if err == nil {
		doc.ID = existingID
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("failed to check existing super admin study material: %w", err)
	}

	// Store content in R2 only
	storageKey, err := objectstore.PutSuperAdminDocument(ctx, r.store, ownerUserID, "materials", "", doc.FileName, doc.Content)
	if err != nil {
		return fmt.Errorf("upload super-admin study material to r2 failed owner=%s file=%s: %w", ownerUserID, doc.FileName, err)
	}
	if strings.TrimSpace(storageKey) == "" {
		return errors.New("r2 storage key missing for super-admin study material")
	}

	err = r.db.QueryRow(ctx, `
		INSERT INTO public.super_admin_study_materials (
			owner_user_id,
			uploader_id,
			uploader_name,
			uploader_role,
			title,
			subject,
			subject_key,
			class_level,
			class_key,
			description,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			storage_key,
			uploaded_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
		)
		RETURNING id::text
	`,
		ownerUserID,
		doc.UploaderID,
		doc.UploaderName,
		doc.UploaderRole,
		doc.Title,
		doc.Subject,
		normalizeSubjectKey(doc.Subject),
		doc.ClassLevel,
		normalizeClassKey(doc.ClassLevel),
		doc.Description,
		doc.FileName,
		doc.FileSize,
		doc.MimeType,
		doc.FileSHA256,
		storageKey,
		doc.UploadedAt,
	).Scan(&doc.ID)
	if err != nil {
		return fmt.Errorf("failed to insert super admin study material: %w", err)
	}
	return nil
}

func (r *Repository) ListSuperAdminStudyMaterialsPaged(ctx context.Context, ownerUserID string, page, pageSize int64, ascending bool, subject, classLevel, search string) ([]StudyMaterial, bool, error) {
	_ = ownerUserID
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	sortOrder := int32(-1)
	if ascending {
		sortOrder = 1
	}
	subject = strings.TrimSpace(subject)
	classLevel = strings.TrimSpace(classLevel)
	search = strings.TrimSpace(search)
	searchLike := "%" + search + "%"
	skip := (page - 1) * pageSize
	limit := pageSize + 1
	sortDirection := "DESC"
	if sortOrder == 1 {
		sortDirection = "ASC"
	}

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
		WHERE ($1 = '' OR LOWER(subject) = LOWER($1))
		  AND ($2 = '' OR LOWER(class_level) = LOWER($2))
		  AND ($3 = '' OR title ILIKE $4 OR file_name ILIKE $4 OR description ILIKE $4)
		ORDER BY uploaded_at %s
		OFFSET $5
		LIMIT $6
	`, sortDirection), subject, classLevel, search, searchLike, skip, limit)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list paged super admin study materials: %w", err)
	}
	defer rows.Close()

	docs := make([]StudyMaterial, 0, pageSize+1)
	for rows.Next() {
		var raw StudyMaterial
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
			return nil, false, fmt.Errorf("failed to decode paged super admin study material: %w", err)
		}
		docs = append(docs, raw)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("failed while iterating paged super admin study materials: %w", err)
	}

	hasMore := int64(len(docs)) > pageSize
	if hasMore {
		docs = docs[:pageSize]
	}
	return docs, hasMore, nil
}

func (r *Repository) GetSuperAdminStudyMaterialByID(ctx context.Context, ownerUserID, materialID string) (*StudyMaterial, error) {
	_ = ownerUserID
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

	err := r.db.QueryRow(ctx, `
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
			uploaded_at,
			storage_key
		FROM public.super_admin_study_materials
		WHERE id::text = $1
	`, materialID).Scan(
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
		&raw.StorageKey,
	)
	if err != nil {
		return nil, err
	}

	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve super admin study material content: %w", err)
	}

	return &StudyMaterial{
		ID:           raw.ID,
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

func (r *Repository) DeleteSuperAdminStudyMaterialByID(ctx context.Context, ownerUserID, materialID string) error {
	tag, err := r.db.ExecResult(ctx, `
		DELETE FROM public.super_admin_study_materials
		WHERE id::text = $1
		  AND owner_user_id = $2
	`, materialID, ownerUserID)
	if err != nil {
		return fmt.Errorf("failed to delete super admin study material: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *Repository) ListSuperAdminStudyMaterialsForTeacher(ctx context.Context, classKeys, subjectKeys []string, ascending bool, subject, classLevel, search string, limit int64) ([]StudyMaterial, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	sortOrder := int32(-1)
	if ascending {
		sortOrder = 1
	}

	search = strings.TrimSpace(search)
	searchLike := "%" + search + "%"
	sortDirection := "DESC"
	if sortOrder == 1 {
		sortDirection = "ASC"
	}

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
	`, sortDirection), search, searchLike)
	if err != nil {
		return nil, fmt.Errorf("failed to list super admin study materials for teacher: %w", err)
	}
	defer rows.Close()

	items := make([]StudyMaterial, 0, limit)
	classFilterKey := normalizeClassKey(classLevel)
	subjectFilterKey := normalizeSubjectKey(subject)
	allowedClass := make(map[string]struct{}, len(classKeys))
	for _, k := range classKeys {
		allowedClass[k] = struct{}{}
	}
	allowedSubject := make(map[string]struct{}, len(subjectKeys))
	for _, k := range subjectKeys {
		allowedSubject[k] = struct{}{}
	}

	for rows.Next() {
		var raw StudyMaterial
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
			return nil, fmt.Errorf("failed to decode super admin study material for teacher: %w", err)
		}
		docClassKey := normalizeClassKey(raw.ClassLevel)
		docSubjectKey := normalizeSubjectKey(raw.Subject)
		if classFilterKey != "" {
			if docClassKey != classFilterKey {
				continue
			}
		} else if len(allowedClass) > 0 {
			if _, ok := allowedClass[docClassKey]; !ok {
				continue
			}
		}
		if subjectFilterKey != "" {
			if docSubjectKey != subjectFilterKey {
				continue
			}
		} else if len(allowedSubject) > 0 {
			if _, ok := allowedSubject[docSubjectKey]; !ok {
				continue
			}
		}
		items = append(items, StudyMaterial{
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
		return nil, fmt.Errorf("failed while iterating super admin study materials for teacher: %w", err)
	}
	return items, nil
}

func (r *Repository) GetSuperAdminStudyMaterialForTeacherByID(ctx context.Context, materialID string, classKeys, subjectKeys []string) (*StudyMaterial, error) {
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
	err := r.db.QueryRow(ctx, `
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
			uploaded_at,
			storage_key
		FROM public.super_admin_study_materials
		WHERE id::text = $1
	`, materialID).Scan(
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
		&raw.StorageKey,
	)
	if err != nil {
		return nil, err
	}
	docClassKey := normalizeClassKey(raw.ClassLevel)
	docSubjectKey := normalizeSubjectKey(raw.Subject)
	if len(classKeys) > 0 {
		ok := false
		for _, k := range classKeys {
			if k == docClassKey {
				ok = true
				break
			}
		}
		if !ok {
			return nil, pgx.ErrNoRows
		}
	}
	if len(subjectKeys) > 0 {
		ok := false
		for _, k := range subjectKeys {
			if k == docSubjectKey {
				ok = true
				break
			}
		}
		if !ok {
			return nil, pgx.ErrNoRows
		}
	}
	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve teacher-scope super admin material content: %w", err)
	}
	return &StudyMaterial{
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

func (r *Repository) ListSuperAdminQuestionDocumentsForTeacher(ctx context.Context, classKeys, subjectKeys []string, ascending bool, subject, classLevel, search string, limit int64) ([]QuestionDocument, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	sortOrder := int32(-1)
	if ascending {
		sortOrder = 1
	}

	search = strings.TrimSpace(search)
	searchLike := "%" + search + "%"
	sortDirection := "DESC"
	if sortOrder == 1 {
		sortDirection = "ASC"
	}

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT
			id::text,
			title,
			subject,
			class_level,
			question_type,
			difficulty,
			context,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			uploaded_at
		FROM public.super_admin_question_documents
		WHERE ($1 = '' OR title ILIKE $2 OR file_name ILIKE $2 OR context ILIKE $2)
		ORDER BY uploaded_at %s
	`, sortDirection), search, searchLike)
	if err != nil {
		return nil, fmt.Errorf("failed to list super admin question documents for teacher: %w", err)
	}
	defer rows.Close()

	items := make([]QuestionDocument, 0, limit)
	classFilterKey := normalizeClassKey(classLevel)
	subjectFilterKey := normalizeSubjectKey(subject)
	allowedClass := make(map[string]struct{}, len(classKeys))
	for _, k := range classKeys {
		allowedClass[k] = struct{}{}
	}
	allowedSubject := make(map[string]struct{}, len(subjectKeys))
	for _, k := range subjectKeys {
		allowedSubject[k] = struct{}{}
	}

	for rows.Next() {
		var raw QuestionDocument
		if err := rows.Scan(
			&raw.ID,
			&raw.Title,
			&raw.Subject,
			&raw.ClassLevel,
			&raw.QuestionType,
			&raw.Difficulty,
			&raw.Context,
			&raw.FileName,
			&raw.FileSize,
			&raw.MimeType,
			&raw.FileSHA256,
			&raw.UploadedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to decode super admin question document for teacher: %w", err)
		}
		docClassKey := normalizeClassKey(raw.ClassLevel)
		docSubjectKey := normalizeSubjectKey(raw.Subject)
		if classFilterKey != "" {
			if docClassKey != classFilterKey {
				continue
			}
		} else if len(allowedClass) > 0 {
			if _, ok := allowedClass[docClassKey]; !ok {
				continue
			}
		}
		if subjectFilterKey != "" {
			if docSubjectKey != subjectFilterKey {
				continue
			}
		} else if len(allowedSubject) > 0 {
			if _, ok := allowedSubject[docSubjectKey]; !ok {
				continue
			}
		}
		items = append(items, QuestionDocument{
			ID:           "sa:" + raw.ID,
			TeacherName:  "Super Admin",
			Title:        raw.Title,
			Subject:      raw.Subject,
			ClassLevel:   raw.ClassLevel,
			QuestionType: raw.QuestionType,
			Difficulty:   raw.Difficulty,
			Context:      raw.Context,
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
		return nil, fmt.Errorf("failed while iterating super admin question documents for teacher: %w", err)
	}
	return items, nil
}

func (r *Repository) GetSuperAdminQuestionDocumentForTeacherByID(ctx context.Context, documentID string, classKeys, subjectKeys []string) (*QuestionDocument, error) {
	var raw struct {
		ID           string
		Title        string
		Subject      string
		ClassLevel   string
		QuestionType string
		Difficulty   string
		Context      string
		FileName     string
		FileSize     int64
		MimeType     string
		FileSHA256   string
		UploadedAt   time.Time
		StorageKey   string
	}

	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			title,
			subject,
			class_level,
			question_type,
			difficulty,
			context,
			file_name,
			file_size,
			mime_type,
			file_sha256,
			uploaded_at,
			storage_key
		FROM public.super_admin_question_documents
		WHERE id::text = $1
	`, documentID).Scan(
		&raw.ID,
		&raw.Title,
		&raw.Subject,
		&raw.ClassLevel,
		&raw.QuestionType,
		&raw.Difficulty,
		&raw.Context,
		&raw.FileName,
		&raw.FileSize,
		&raw.MimeType,
		&raw.FileSHA256,
		&raw.UploadedAt,
		&raw.StorageKey,
	)

	if err != nil {
		return nil, err
	}
	docClassKey := normalizeClassKey(raw.ClassLevel)
	docSubjectKey := normalizeSubjectKey(raw.Subject)
	if len(classKeys) > 0 {
		ok := false
		for _, k := range classKeys {
			if k == docClassKey {
				ok = true
				break
			}
		}
		if !ok {
			return nil, pgx.ErrNoRows
		}
	}
	if len(subjectKeys) > 0 {
		ok := false
		for _, k := range subjectKeys {
			if k == docSubjectKey {
				ok = true
				break
			}
		}
		if !ok {
			return nil, pgx.ErrNoRows
		}
	}
	content, err := objectstore.GetDocumentRequired(ctx, r.store, raw.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve teacher-scope super admin question content: %w", err)
	}

	return &QuestionDocument{
		ID:           "sa:" + raw.ID,
		TeacherName:  "Super Admin",
		Title:        raw.Title,
		Subject:      raw.Subject,
		ClassLevel:   raw.ClassLevel,
		QuestionType: raw.QuestionType,
		Difficulty:   raw.Difficulty,
		Context:      raw.Context,
		FileName:     raw.FileName,
		FileSize:     raw.FileSize,
		MimeType:     raw.MimeType,
		FileSHA256:   raw.FileSHA256,
		UploadedAt:   raw.UploadedAt,
		Content:      content,
	}, nil
}

// UpdateHomeworkForTeacher updates editable fields of a homework record owned by the teacher.
func (r *Repository) UpdateHomeworkForTeacher(ctx context.Context, teacherID, homeworkID uuid.UUID, req *UpdateHomeworkRequest) error {
	tag, err := r.db.ExecResult(ctx, `
		UPDATE homework
		SET
			title       = $3,
			description = NULLIF($4, ''),
			due_date    = $5,
			max_marks   = $6,
			updated_at  = NOW()
		WHERE id = $1 AND teacher_id = $2
	`, homeworkID, teacherID, strings.TrimSpace(req.Title), strings.TrimSpace(req.Description), req.DueDate, req.MaxMarks)
	if err != nil {
		return fmt.Errorf("failed to update homework: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// GetHomeworkSubmissions returns students who submitted a given homework.
// Tenant schema isolation provides school-level security; teacher auth ensures role access.
func (r *Repository) GetHomeworkSubmissions(ctx context.Context, teacherID, homeworkID uuid.UUID) (*HomeworkSubmissionsResponse, error) {
	var resp HomeworkSubmissionsResponse
	var studentsCount int
	if err := r.db.QueryRow(ctx, `
		SELECT
			h.id::text,
			h.title,
			COALESCE((
				SELECT COUNT(*) FROM students s WHERE s.class_id = h.class_id
			), 0)::int
		FROM homework h
		WHERE h.id = $1
	`, homeworkID).Scan(&resp.HomeworkID, &resp.Title, &studentsCount); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("GetHomeworkSubmissions verify: %w", err)
	}
	resp.StudentsCount = studentsCount

	rows, err := r.db.Query(ctx, `
		SELECT
			s.id::text                                   AS student_id,
			u.full_name                                  AS student_name,
			COALESCE(s.roll_number, '')                  AS roll_number,
			hs.submitted_at,
			COALESCE(hs.status, 'submitted')             AS status,
			hs.marks_obtained,
			COALESCE(hs.feedback, '')                    AS feedback
		FROM homework_submissions hs
		JOIN students s ON s.id  = hs.student_id
		JOIN users   u ON u.id  = s.user_id
		WHERE hs.homework_id = $1
		ORDER BY u.full_name ASC
	`, homeworkID)
	if err != nil {
		return nil, fmt.Errorf("GetHomeworkSubmissions query: %w", err)
	}
	defer rows.Close()

	resp.Submissions = make([]HomeworkSubmissionEntry, 0, 32)
	for rows.Next() {
		var e HomeworkSubmissionEntry
		if err := rows.Scan(&e.StudentID, &e.StudentName, &e.RollNumber, &e.SubmittedAt, &e.Status, &e.MarksObtained, &e.Feedback); err != nil {
			return nil, fmt.Errorf("GetHomeworkSubmissions scan: %w", err)
		}
		resp.Submissions = append(resp.Submissions, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetHomeworkSubmissions rows: %w", err)
	}
	resp.SubmissionsCount = len(resp.Submissions)
	return &resp, nil
}
