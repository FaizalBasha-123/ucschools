package admin

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

func (r *Repository) RefreshStudentLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string) error {
	deleteQuery := `
		DELETE FROM student_leaderboard_entries
		WHERE school_id = $1 AND academic_year = $2
	`
	if err := r.db.Exec(ctx, deleteQuery, schoolID, academicYear); err != nil {
		return fmt.Errorf("failed to clear student leaderboard: %w", err)
	}

	insertQuery := `
		WITH student_metrics AS (
			SELECT
				s.id AS student_id,
				s.class_id,
				COALESCE(AVG((g.marks_obtained * 100.0) / NULLIF(g.max_marks, 0)), 0) AS average_score,
				COUNT(g.id) AS exams_taken,
				COALESCE(
					AVG(
						CASE
							WHEN a.status = 'present' THEN 100
							WHEN a.status = 'late' THEN 60
							ELSE 0
						END
					),
					0
				) AS attendance_percent
			FROM students s
			LEFT JOIN grades g
				ON g.student_id = s.id
				AND ($2 = '' OR g.academic_year = $2)
			LEFT JOIN attendance a
				ON a.student_id = s.id
				AND a.date >= CURRENT_DATE - INTERVAL '180 days'
			WHERE s.school_id = $1
			GROUP BY s.id, s.class_id
		),
		scored AS (
			SELECT
				student_id,
				class_id,
				average_score,
				exams_taken,
				attendance_percent,
				ROUND((average_score * 0.80 + attendance_percent * 0.20)::numeric, 2) AS composite_score,
				CASE
					WHEN average_score >= 85 AND attendance_percent >= 92 THEN 'up'
					WHEN average_score < 65 THEN 'down'
					ELSE 'stable'
				END AS trend
			FROM student_metrics
		),
		ranked AS (
			SELECT
				student_id,
				class_id,
				average_score,
				attendance_percent,
				exams_taken,
				trend,
				composite_score,
				ROW_NUMBER() OVER (
					ORDER BY composite_score DESC, average_score DESC, attendance_percent DESC, student_id
				) AS rank
			FROM scored
		)
		INSERT INTO student_leaderboard_entries (
			school_id,
			student_id,
			class_id,
			academic_year,
			average_score,
			attendance_percent,
			exams_taken,
			trend,
			composite_score,
			rank,
			last_calculated_at,
			created_at,
			updated_at
		)
		SELECT
			$1,
			student_id,
			class_id,
			$2,
			ROUND(average_score::numeric, 2),
			ROUND(attendance_percent::numeric, 2),
			exams_taken,
			trend,
			composite_score,
			rank,
			NOW(),
			NOW(),
			NOW()
		FROM ranked
	`
	if err := r.db.Exec(ctx, insertQuery, schoolID, academicYear); err != nil {
		return fmt.Errorf("failed to populate student leaderboard: %w", err)
	}

	return nil
}

func (r *Repository) RefreshTeacherLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string) error {
	deleteQuery := `
		DELETE FROM teacher_leaderboard_entries
		WHERE school_id = $1 AND academic_year = $2
	`
	if err := r.db.Exec(ctx, deleteQuery, schoolID, academicYear); err != nil {
		return fmt.Errorf("failed to clear teacher leaderboard: %w", err)
	}

	insertQuery := `
		WITH grading_stats AS (
			SELECT
				g.graded_by AS teacher_id,
				COUNT(g.id) AS graded_records_count,
				COUNT(DISTINCT g.student_id) AS students_count,
				COALESCE(AVG((g.marks_obtained * 100.0) / NULLIF(g.max_marks, 0)), 0) AS average_student_score
			FROM grades g
			WHERE g.graded_by IS NOT NULL
				AND ($2 = '' OR g.academic_year = $2)
			GROUP BY g.graded_by
		),
		homework_stats AS (
			SELECT
				h.teacher_id,
				COUNT(h.id) AS assignments_count
			FROM homework h
			WHERE h.teacher_id IS NOT NULL
			GROUP BY h.teacher_id
		),
		teacher_metrics AS (
			SELECT
				t.id AS teacher_id,
				COALESCE(t.rating, 0) AS rating,
				COALESCE(gs.students_count, 0) AS students_count,
				COALESCE(hs.assignments_count, 0) AS assignments_count,
				COALESCE(gs.graded_records_count, 0) AS graded_records_count,
				COALESCE(gs.average_student_score, 0) AS average_student_score
			FROM teachers t
			LEFT JOIN grading_stats gs ON gs.teacher_id = t.id
			LEFT JOIN homework_stats hs ON hs.teacher_id = t.id
			WHERE t.school_id = $1
		),
		scored AS (
			SELECT
				teacher_id,
				rating,
				students_count,
				assignments_count,
				graded_records_count,
				average_student_score,
				ROUND((
					(rating * 20.0) * 0.35 +
					average_student_score * 0.45 +
					(LEAST(graded_records_count, 60) * 100.0 / 60.0) * 0.20
				)::numeric, 2) AS composite_score,
				CASE
					WHEN rating >= 4.5 AND average_student_score >= 80 THEN 'up'
					WHEN rating < 3.5 OR average_student_score < 60 THEN 'down'
					ELSE 'stable'
				END AS trend
			FROM teacher_metrics
		),
		ranked AS (
			SELECT
				teacher_id,
				rating,
				students_count,
				assignments_count,
				graded_records_count,
				average_student_score,
				trend,
				composite_score,
				ROW_NUMBER() OVER (
					ORDER BY composite_score DESC, rating DESC, average_student_score DESC, teacher_id
				) AS rank
			FROM scored
		)
		INSERT INTO teacher_leaderboard_entries (
			school_id,
			teacher_id,
			academic_year,
			rating,
			students_count,
			assignments_count,
			graded_records_count,
			average_student_score,
			trend,
			composite_score,
			rank,
			last_calculated_at,
			created_at,
			updated_at
		)
		SELECT
			$1,
			teacher_id,
			$2,
			ROUND(rating::numeric, 1),
			students_count,
			assignments_count,
			graded_records_count,
			ROUND(average_student_score::numeric, 2),
			trend,
			composite_score,
			rank,
			NOW(),
			NOW(),
			NOW()
		FROM ranked
	`
	if err := r.db.Exec(ctx, insertQuery, schoolID, academicYear); err != nil {
		return fmt.Errorf("failed to populate teacher leaderboard: %w", err)
	}

	return nil
}

// GetStudentLeaderboard ranks all students in the school using a combined score:
// assessment average and quiz average blended into one 0-100 metric.
// School isolation is enforced by s.school_id = $1 and the tenant search path.
func (r *Repository) GetStudentLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string, classID *uuid.UUID, search string, limit int) ([]StudentLeaderboardItem, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	// $1 = schoolID, $2 = academicYear ('' means all years), subsequent args built dynamically.
	args := []interface{}{schoolID, strings.TrimSpace(academicYear)}
	argNum := 3

	// Optional filters appended to the outer WHERE.
	extraWhere := ""
	if classID != nil {
		extraWhere += " AND s.class_id = $" + strconv.Itoa(argNum)
		args = append(args, *classID)
		argNum++
	}
	if search != "" {
		extraWhere += " AND (u.full_name ILIKE $" + strconv.Itoa(argNum) +
			" OR s.admission_number ILIKE $" + strconv.Itoa(argNum) + ")"
		args = append(args, "%"+search+"%")
		argNum++
	}

	query := `
WITH student_base AS (
    SELECT
        s.id AS student_id,
        s.class_id,
        COALESCE(u.full_name, 'Student')             AS name,
        COALESCE(s.admission_number, '')             AS admission_number,
        COALESCE(s.roll_number, '')                  AS roll_number,
        COALESCE(c.name, '')                         AS class_name,
        COALESCE(s.section, COALESCE(c.section, '')) AS section
    FROM students s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE s.school_id = $1` + extraWhere + `
),
student_assessment_relevance AS (
    SELECT sb.student_id, a.id AS assessment_id
    FROM student_base sb
    JOIN assessments a
      ON sb.class_id IS NOT NULL
     AND sb.class_id = ANY(COALESCE(a.class_ids, '{}'::UUID[]))
    WHERE ($2 = '' OR a.academic_year = $2)
),
per_assessment_avg AS (
    SELECT
        sar.student_id,
        sar.assessment_id,
        AVG(COALESCE(sg.percentage, 0)) AS assessment_avg_pct
    FROM student_assessment_relevance sar
    JOIN student_grades sg
      ON sg.assessment_id = sar.assessment_id
     AND sg.student_id = sar.student_id
     AND sg.subject_id IS NOT NULL
    GROUP BY sar.student_id, sar.assessment_id
),
assessment_scores AS (
    SELECT
        student_id,
        COUNT(DISTINCT assessment_id)               AS assessments_with_scores,
        ROUND(AVG(assessment_avg_pct)::numeric, 2)  AS avg_assessment_pct
    FROM per_assessment_avg
    GROUP BY student_id
),
class_info AS (
    SELECT id, name
    FROM classes
),
tenant_quiz_scores AS (
    SELECT
        sb.student_id,
        q.id AS quiz_id,
        COALESCE(MAX(CASE WHEN qa.is_completed THEN qa.percentage END), 0) AS best_pct
    FROM student_base sb
    JOIN quizzes q
      ON q.class_id = sb.class_id
    LEFT JOIN quiz_attempts qa
      ON qa.quiz_id = q.id
     AND qa.student_id = sb.student_id
    GROUP BY sb.student_id, q.id
),
global_quiz_scores AS (
    SELECT
        sb.student_id,
        gq.id AS quiz_id,
        COALESCE(MAX(CASE WHEN gqa.is_completed THEN gqa.percentage END), 0) AS best_pct
    FROM student_base sb
    JOIN class_info ci ON ci.id = sb.class_id
    JOIN public.global_quizzes gq ON TRUE
    JOIN public.global_classes gc
      ON gc.id = gq.class_id
     AND LOWER(TRIM(gc.name)) = LOWER(TRIM(
        COALESCE(NULLIF(split_part(ci.name, '-', 1), ''), ci.name)
     ))
    LEFT JOIN global_quiz_attempts gqa
      ON gqa.quiz_id = gq.id
     AND gqa.student_id = sb.student_id
    GROUP BY sb.student_id, gq.id
),
all_quiz_scores AS (
    SELECT * FROM tenant_quiz_scores
    UNION ALL
    SELECT * FROM global_quiz_scores
),
quiz_scores AS (
    SELECT
        student_id,
        COUNT(DISTINCT quiz_id) AS total_quizzes,
        COUNT(DISTINCT CASE WHEN best_pct > 0 THEN quiz_id END) AS quizzes_attempted,
        CASE
            WHEN COUNT(DISTINCT quiz_id) = 0 THEN 0::numeric
            ELSE ROUND((SUM(COALESCE(best_pct, 0)) / COUNT(DISTINCT quiz_id))::numeric, 2)
        END AS avg_quiz_pct
    FROM all_quiz_scores
    GROUP BY student_id
),
ranked AS (
    SELECT
        ROW_NUMBER() OVER (
            ORDER BY
                CASE
                    WHEN COALESCE(a.assessments_with_scores, 0) > 0 AND COALESCE(q.total_quizzes, 0) > 0
                        THEN ROUND(((COALESCE(a.avg_assessment_pct, 0) + COALESCE(q.avg_quiz_pct, 0)) / 2.0)::numeric, 2)
                    WHEN COALESCE(a.assessments_with_scores, 0) > 0
                        THEN COALESCE(a.avg_assessment_pct, 0)::numeric
                    ELSE COALESCE(q.avg_quiz_pct, 0)::numeric
                END DESC,
                COALESCE(a.avg_assessment_pct, 0) DESC,
                COALESCE(q.avg_quiz_pct, 0) DESC,
                sb.name ASC
        )::int AS rank,
        sb.student_id::text AS student_id,
        sb.name,
        sb.admission_number,
        sb.roll_number,
        sb.class_name,
        sb.section,
        CASE
            WHEN COALESCE(a.assessments_with_scores, 0) > 0 AND COALESCE(q.total_quizzes, 0) > 0
                THEN ROUND(((COALESCE(a.avg_assessment_pct, 0) + COALESCE(q.avg_quiz_pct, 0)) / 2.0)::numeric, 2)::float8
            WHEN COALESCE(a.assessments_with_scores, 0) > 0
                THEN COALESCE(a.avg_assessment_pct, 0)::float8
            ELSE COALESCE(q.avg_quiz_pct, 0)::float8
        END AS combined_score_pct,
        COALESCE(a.avg_assessment_pct, 0)::float8 AS avg_assessment_pct,
        COALESCE(a.assessments_with_scores, 0)::int AS assessments_with_scores,
        COALESCE(q.avg_quiz_pct, 0)::float8 AS avg_quiz_pct,
        COALESCE(q.quizzes_attempted, 0)::int AS quizzes_attempted,
        COALESCE(q.total_quizzes, 0)::int AS total_quizzes
    FROM student_base sb
    LEFT JOIN assessment_scores a ON a.student_id = sb.student_id
    LEFT JOIN quiz_scores q ON q.student_id = sb.student_id
)
SELECT rank, student_id, name, admission_number, roll_number, class_name, section,
       combined_score_pct, avg_assessment_pct, assessments_with_scores,
       avg_quiz_pct, quizzes_attempted, total_quizzes
FROM ranked
ORDER BY rank ASC
LIMIT $` + strconv.Itoa(argNum)

	args = append(args, limit)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("GetStudentLeaderboard: %w", err)
	}
	defer rows.Close()

	items := make([]StudentLeaderboardItem, 0)
	for rows.Next() {
		var item StudentLeaderboardItem
		if err := rows.Scan(
			&item.Rank,
			&item.StudentID,
			&item.Name,
			&item.AdmissionNumber,
			&item.RollNumber,
			&item.ClassName,
			&item.Section,
			&item.CombinedScorePct,
			&item.AvgAssessmentPct,
			&item.AssessmentsWithScores,
			&item.AvgQuizPct,
			&item.QuizzesAttempted,
			&item.TotalQuizzes,
		); err != nil {
			return nil, fmt.Errorf("GetStudentLeaderboard scan: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetStudentLeaderboard rows: %w", err)
	}

	return items, nil
}

// GetTeacherLeaderboard computes teacher rankings live from the source tables so
// that any school — including a brand-new one — always shows correct data without
// requiring a manual cache refresh.
//
// Ranking formula (matches RefreshTeacherLeaderboard):
//
//	composite_score = (rating × 20%) × 35% + avg_student_score × 45% + (graded_records/60) × 20%
func (r *Repository) GetTeacherLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string, search string, limit int) ([]TeacherLeaderboardItem, error) {
	// $1 = schoolID, $2 = academicYear, $3 = limit  (search appended if provided)
	args := []interface{}{schoolID, academicYear}
	argNum := 3

	searchFilter := ""
	if search != "" {
		searchFilter = fmt.Sprintf(
			" AND (u.full_name ILIKE $%d OR t.employee_id ILIKE $%d)",
			argNum, argNum,
		)
		args = append(args, "%"+search+"%")
		argNum++
	}

	query := fmt.Sprintf(`
		WITH grading_stats AS (
			SELECT
				g.graded_by                                          AS teacher_id,
				COUNT(g.id)                                          AS graded_records_count,
				COUNT(DISTINCT g.student_id)                         AS graded_students,
				COALESCE(AVG((g.marks_obtained * 100.0) / NULLIF(g.max_marks, 0)), 0) AS average_student_score
			FROM grades g
			WHERE g.graded_by IS NOT NULL
				AND ($2 = '' OR g.academic_year = $2)
			GROUP BY g.graded_by
		),
		homework_stats AS (
			SELECT teacher_id, COUNT(id) AS assignments_count
			FROM homework
			GROUP BY teacher_id
		),
		student_counts AS (
			SELECT tt.teacher_id, COUNT(DISTINCT s.id) AS students_count
			FROM timetables tt
			JOIN students s ON s.class_id = tt.class_id
			GROUP BY tt.teacher_id
		),
		teacher_metrics AS (
			SELECT
				t.id                                                    AS teacher_id,
				COALESCE(u.full_name, 'Teacher')                        AS name,
				COALESCE(t.employee_id, '')                             AS employee_id,
				''::text                                                AS department,
				COALESCE(t.rating, 0)::float8                           AS rating,
				COALESCE(u.is_active, true)                             AS is_active,
				COALESCE(sc.students_count, 0)                          AS students_count,
				COALESCE(hs.assignments_count, 0)                       AS assignments_count,
				COALESCE(gs.graded_records_count, 0)                    AS graded_records_count,
				COALESCE(gs.average_student_score, 0)                   AS average_student_score
			FROM teachers t
			LEFT JOIN users u           ON u.id  = t.user_id
			LEFT JOIN grading_stats gs  ON gs.teacher_id = t.id
			LEFT JOIN homework_stats hs ON hs.teacher_id = t.id
			LEFT JOIN student_counts sc ON sc.teacher_id = t.id
			WHERE (t.school_id = $1 OR t.school_id IS NULL)
			%s
		),
		scored AS (
			SELECT
				teacher_id, name, employee_id, department, rating, is_active,
				students_count, assignments_count, graded_records_count, average_student_score,
				ROUND((
					(rating * 20.0) * 0.35
					+ average_student_score * 0.45
					+ (LEAST(graded_records_count, 60) * 100.0 / 60.0) * 0.20
				)::numeric, 2)                                          AS composite_score,
				CASE
					WHEN rating >= 4.5 AND average_student_score >= 80 THEN 'up'
					WHEN rating < 3.5  OR  average_student_score < 60  THEN 'down'
					ELSE 'stable'
				END                                                     AS trend
			FROM teacher_metrics
		),
		ranked AS (
			SELECT
				ROW_NUMBER() OVER (
					ORDER BY rating DESC, composite_score DESC, average_student_score DESC, teacher_id
				)::int AS rank,
				teacher_id, name, employee_id, department, rating,
				CASE WHEN is_active THEN 'active' ELSE 'inactive' END   AS status,
				students_count, assignments_count, graded_records_count,
				average_student_score, trend, composite_score
			FROM scored
		)
		SELECT
			rank,
			teacher_id::text,
			name,
			employee_id,
			department,
			rating,
			students_count::int,
			status,
			assignments_count::int,
			graded_records_count::int,
			average_student_score::float8,
			trend,
			composite_score::float8,
			NOW() AS last_calculated_at
		FROM ranked
		ORDER BY rank ASC
		LIMIT $%d
	`, searchFilter, argNum)

	args = append(args, limit)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch teacher leaderboard: %w", err)
	}
	defer rows.Close()

	items := make([]TeacherLeaderboardItem, 0)
	for rows.Next() {
		var item TeacherLeaderboardItem
		if err := rows.Scan(
			&item.Rank,
			&item.TeacherID,
			&item.Name,
			&item.EmployeeID,
			&item.Department,
			&item.Rating,
			&item.StudentsCount,
			&item.Status,
			&item.AssignmentsCount,
			&item.GradedRecordsCount,
			&item.AverageStudentScore,
			&item.Trend,
			&item.CompositeScore,
			&item.LastCalculatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

// GetAllStudentsAssessmentLeaderboard returns a school-wide student ranking based
// on completed assessments. Only students with at least one graded assessment appear.
//
// Ranking formula (mirrors student-module class leaderboard, extended to all classes):
//  1. Per student per assessment: AVG(student_grades.percentage) across all subjects.
//  2. Student overall score   : AVG of those per-assessment averages.
func (r *Repository) GetAllStudentsAssessmentLeaderboard(ctx context.Context, schoolID uuid.UUID, academicYear string, limit int) ([]AdminAssessmentLeaderboardItem, error) {
	query := `
WITH student_classes AS (
    -- Map every enrolled student to their class grade for assessment scoping.
    SELECT s.id AS student_id, c.grade AS class_grade
    FROM students s
    JOIN classes c ON c.id = s.class_id
    WHERE s.school_id = $1
),
student_assessment_relevance AS (
    -- Assessments whose class_grades array includes the student's class grade.
    SELECT sc.student_id, a.id AS assessment_id
    FROM student_classes sc
    JOIN assessments a ON sc.class_grade = ANY(COALESCE(a.class_grades, '{}'::INT[]))
    WHERE ($2 = '' OR a.academic_year = $2)
),
per_assessment_avg AS (
    -- Step 1: For each (student, assessment), average the subject percentages.
    SELECT
        sar.student_id,
        sar.assessment_id,
        AVG(COALESCE(sg.percentage, 0)) AS assessment_avg_pct
    FROM student_assessment_relevance sar
    JOIN student_grades sg
        ON sg.assessment_id = sar.assessment_id
       AND sg.student_id    = sar.student_id
       AND sg.subject_id IS NOT NULL
    GROUP BY sar.student_id, sar.assessment_id
),
student_overall AS (
    -- Step 2: Average the per-assessment averages per student.
    SELECT
        student_id,
        COUNT(DISTINCT assessment_id)        AS assessments_with_scores,
        ROUND(AVG(assessment_avg_pct)::numeric, 2) AS avg_assessment_pct
    FROM per_assessment_avg
    GROUP BY student_id
    HAVING COUNT(DISTINCT assessment_id) > 0
)
SELECT
    s.id::text                           AS student_id,
    COALESCE(u.full_name, 'Student')     AS student_name,
    COALESCE(c.name, '')                 AS class_name,
    so.assessments_with_scores,
    so.avg_assessment_pct::float8        AS avg_assessment_pct
FROM student_overall so
JOIN students s  ON s.id  = so.student_id
JOIN users    u  ON u.id  = s.user_id
LEFT JOIN classes c ON c.id = s.class_id
ORDER BY avg_assessment_pct DESC, assessments_with_scores DESC, u.full_name ASC
LIMIT $3
`
	rows, err := r.db.Query(ctx, query, schoolID, strings.TrimSpace(academicYear), limit)
	if err != nil {
		return nil, fmt.Errorf("GetAllStudentsAssessmentLeaderboard: %w", err)
	}
	defer rows.Close()

	items := make([]AdminAssessmentLeaderboardItem, 0, limit)
	rank := 1
	for rows.Next() {
		var item AdminAssessmentLeaderboardItem
		if err := rows.Scan(
			&item.StudentID,
			&item.Name,
			&item.ClassName,
			&item.AssessmentsWithScores,
			&item.AvgAssessmentPct,
		); err != nil {
			return nil, fmt.Errorf("GetAllStudentsAssessmentLeaderboard scan: %w", err)
		}
		item.Rank = rank
		rank++
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetAllStudentsAssessmentLeaderboard rows: %w", err)
	}
	return items, nil
}
