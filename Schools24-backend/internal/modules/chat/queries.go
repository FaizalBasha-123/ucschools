package chat

import (
	"context"
	"fmt"
	"math"

	"github.com/schools24/backend/internal/shared/database"
)

// tenantCtx returns a context carrying the tenant schema key so that
// db.Query / db.QueryRow automatically set:
//
//	SET search_path TO "school_<id>", public
//
// before executing the query. This ensures all queries stay inside the
// correct school's schema — no cross-tenant leakage is possible.
func tenantCtx(ctx context.Context, schoolID string) context.Context {
	schema := fmt.Sprintf(`"school_%s"`, schoolID)
	return context.WithValue(ctx, "tenant_schema", schema)
}

// ── Argument helpers ──────────────────────────────────────────────────────────

// safeLimitInt extracts a numeric arg, clamps it to [1, max], returning def if absent.
func safeLimitInt(args map[string]any, key string, def, max int) int {
	v, ok := args[key]
	if !ok {
		return def
	}
	if f, ok := v.(float64); ok { // JSON numbers decode as float64
		i := int(f)
		if i < 1 {
			return def
		}
		if i > max {
			return max
		}
		return i
	}
	return def
}

// safeString returns a string arg value, or "" if absent or wrong type.
func safeString(args map[string]any, key string) string {
	v, ok := args[key]
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}

// safeFloat returns a float64 arg value, or 0 if absent or wrong type.
func safeFloat(args map[string]any, key string) float64 {
	v, ok := args[key]
	if !ok {
		return 0
	}
	f, _ := v.(float64)
	return f
}

// roundMoney rounds to 2 decimal places.
func roundMoney(v float64) float64 { return math.Round(v*100) / 100 }

// ── Tool: pending_fees ────────────────────────────────────────────────────────

func executePendingFees(ctx context.Context, db *database.PostgresDB, schoolID string, args map[string]any) (*DataPayload, error) {
	limit := safeLimitInt(args, "limit", 50, 200)
	minAmount := safeFloat(args, "min_amount")
	maxAmount := safeFloat(args, "max_amount")
	statusFilter := safeString(args, "status")
	classFilter := safeString(args, "class_name")

	if statusFilter == "all" {
		statusFilter = ""
	}

	tCtx := tenantCtx(ctx, schoolID)

	// Derived status expression (matches the admin repo logic exactly)
	statusExpr := `CASE
		WHEN COALESCE(sf.paid_amount, 0) >= sf.amount - COALESCE(sf.waiver_amount, 0) THEN 'paid'
		WHEN COALESCE(sf.paid_amount, 0) > 0 THEN 'partial'
		WHEN sf.due_date IS NOT NULL AND sf.due_date < CURRENT_DATE THEN 'overdue'
		ELSE 'pending'
	END`

	// Build WHERE clauses and args dynamically — using $N placeholders
	var whereParts []string
	var queryArgs []any
	argIdx := 1

	// Always exclude fully-paid records
	whereParts = append(whereParts,
		fmt.Sprintf(`(%s) IN ('pending', 'partial', 'overdue')`, statusExpr),
	)

	if minAmount > 0 {
		whereParts = append(whereParts,
			fmt.Sprintf("(sf.amount - COALESCE(sf.paid_amount,0) - COALESCE(sf.waiver_amount,0)) >= $%d", argIdx),
		)
		queryArgs = append(queryArgs, minAmount)
		argIdx++
	}
	if maxAmount > 0 {
		whereParts = append(whereParts,
			fmt.Sprintf("(sf.amount - COALESCE(sf.paid_amount,0) - COALESCE(sf.waiver_amount,0)) <= $%d", argIdx),
		)
		queryArgs = append(queryArgs, maxAmount)
		argIdx++
	}
	if classFilter != "" {
		whereParts = append(whereParts,
			fmt.Sprintf("LOWER(COALESCE(c.name,'')) LIKE LOWER($%d)", argIdx),
		)
		queryArgs = append(queryArgs, "%"+classFilter+"%")
		argIdx++
	}
	if statusFilter != "" {
		whereParts = append(whereParts,
			fmt.Sprintf(`(%s) = $%d`, statusExpr, argIdx),
		)
		queryArgs = append(queryArgs, statusFilter)
		argIdx++
	}

	whereSQL := "WHERE " + joinAnd(whereParts)
	queryArgs = append(queryArgs, limit)

	q := fmt.Sprintf(`
		SELECT
			u.full_name                                                                    AS student_name,
			COALESCE(c.name, '')                                                           AS class,
			s.admission_number                                                             AS admission_no,
			sf.amount                                                                      AS total_amount,
			COALESCE(sf.paid_amount, 0)                                                    AS paid,
			sf.amount - COALESCE(sf.paid_amount,0) - COALESCE(sf.waiver_amount,0)         AS outstanding,
			(%s)                                                                           AS status,
			COALESCE(sf.due_date::text, '')                                                AS due_date
		FROM student_fees sf
		JOIN  students s ON s.id = sf.student_id
		JOIN  users    u ON u.id = s.user_id
		LEFT JOIN classes c ON c.id = s.class_id
		%s
		ORDER BY outstanding DESC, u.full_name ASC
		LIMIT $%d
	`, statusExpr, whereSQL, argIdx)

	rows, err := db.Query(tCtx, q, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("pending_fees query failed: %w", err)
	}
	defer rows.Close()

	var result []map[string]any
	for rows.Next() {
		var name, cls, admNo, status, dueDate string
		var total, paid, outstanding float64
		if err := rows.Scan(&name, &cls, &admNo, &total, &paid, &outstanding, &status, &dueDate); err != nil {
			continue
		}
		result = append(result, map[string]any{
			"Student":         name,
			"Class":           cls,
			"Admission No":    admNo,
			"Total (₹)":       roundMoney(total),
			"Paid (₹)":        roundMoney(paid),
			"Outstanding (₹)": roundMoney(outstanding),
			"Status":          status,
			"Due Date":        dueDate,
		})
	}

	summary := fmt.Sprintf("%d student(s) with pending/outstanding fees", len(result))
	if minAmount > 0 {
		summary += fmt.Sprintf(" (outstanding ≥ ₹%.0f)", minAmount)
	}
	if classFilter != "" {
		summary += fmt.Sprintf(" in class '%s'", classFilter)
	}

	return &DataPayload{
		Columns: []string{"Student", "Class", "Admission No", "Total (₹)", "Paid (₹)", "Outstanding (₹)", "Status", "Due Date"},
		Rows:    result,
		Summary: summary,
		Tool:    "pending_fees",
	}, nil
}

// ── Tool: fee_stats ───────────────────────────────────────────────────────────

func executeFeeStats(ctx context.Context, db *database.PostgresDB, schoolID string, _ map[string]any) (*DataPayload, error) {
	tCtx := tenantCtx(ctx, schoolID)

	q := `
		SELECT
			COUNT(*)                                                                                           AS total_records,
			COALESCE(SUM(sf.amount), 0)                                                                        AS total_demanded,
			COALESCE(SUM(sf.paid_amount), 0)                                                                   AS total_collected,
			COALESCE(SUM(sf.amount - COALESCE(sf.paid_amount,0) - COALESCE(sf.waiver_amount,0)), 0)            AS total_outstanding,
			COUNT(*) FILTER (WHERE COALESCE(sf.paid_amount,0) >= sf.amount - COALESCE(sf.waiver_amount,0))     AS paid_count,
			COUNT(*) FILTER (WHERE COALESCE(sf.paid_amount,0) = 0
			                   AND (sf.due_date IS NULL OR sf.due_date >= CURRENT_DATE))                       AS pending_count,
			COUNT(*) FILTER (WHERE COALESCE(sf.paid_amount,0) > 0
			                   AND COALESCE(sf.paid_amount,0) < sf.amount - COALESCE(sf.waiver_amount,0))      AS partial_count,
			COUNT(*) FILTER (WHERE COALESCE(sf.paid_amount,0) = 0
			                   AND sf.due_date IS NOT NULL AND sf.due_date < CURRENT_DATE)                     AS overdue_count
		FROM student_fees sf
	`

	var totalRecords, paidCount, pendingCount, partialCount, overdueCount int
	var totalDemanded, totalCollected, totalOutstanding float64

	if err := db.QueryRow(tCtx, q).Scan(
		&totalRecords, &totalDemanded, &totalCollected, &totalOutstanding,
		&paidCount, &pendingCount, &partialCount, &overdueCount,
	); err != nil {
		return nil, fmt.Errorf("fee_stats query failed: %w", err)
	}

	pct := 0.0
	if totalDemanded > 0 {
		pct = math.Round(totalCollected/totalDemanded*10000) / 100
	}

	rows := []map[string]any{
		{"Metric": "Total Demanded", "Amount (₹)": roundMoney(totalDemanded), "Students": totalRecords},
		{"Metric": "Fully Paid", "Amount (₹)": roundMoney(totalCollected), "Students": paidCount},
		{"Metric": "Total Outstanding", "Amount (₹)": roundMoney(totalOutstanding), "Students": pendingCount + partialCount + overdueCount},
		{"Metric": "Overdue", "Amount (₹)": 0.0, "Students": overdueCount},
		{"Metric": "Partial Payment", "Amount (₹)": 0.0, "Students": partialCount},
		{"Metric": "Pending", "Amount (₹)": 0.0, "Students": pendingCount},
	}

	return &DataPayload{
		Columns: []string{"Metric", "Amount (₹)", "Students"},
		Rows:    rows,
		Summary: fmt.Sprintf("Collection rate: %.1f%% — ₹%.0f collected out of ₹%.0f demanded", pct, totalCollected, totalDemanded),
		Tool:    "fee_stats",
	}, nil
}

// ── Tool: student_list ────────────────────────────────────────────────────────

func executeStudentList(ctx context.Context, db *database.PostgresDB, schoolID string, args map[string]any) (*DataPayload, error) {
	limit := safeLimitInt(args, "limit", 50, 200)
	classFilter := safeString(args, "class_name")

	tCtx := tenantCtx(ctx, schoolID)

	var whereSQL string
	var queryArgs []any
	if classFilter != "" {
		whereSQL = "WHERE LOWER(COALESCE(c.name,'')) LIKE LOWER($1)"
		queryArgs = append(queryArgs, "%"+classFilter+"%")
	}
	queryArgs = append(queryArgs, limit)
	limitArg := len(queryArgs)

	q := fmt.Sprintf(`
		SELECT
			u.full_name          AS student_name,
			COALESCE(c.name,'')  AS class,
			s.admission_number   AS admission_no,
			u.email,
			COALESCE(u.phone,'') AS phone
		FROM students s
		JOIN  users    u ON u.id = s.user_id
		LEFT JOIN classes c ON c.id = s.class_id
		%s
		ORDER BY c.name ASC, u.full_name ASC
		LIMIT $%d
	`, whereSQL, limitArg)

	rows, err := db.Query(tCtx, q, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("student_list query failed: %w", err)
	}
	defer rows.Close()

	var result []map[string]any
	for rows.Next() {
		var name, cls, admNo, email, phone string
		if err := rows.Scan(&name, &cls, &admNo, &email, &phone); err != nil {
			continue
		}
		result = append(result, map[string]any{
			"Student":      name,
			"Class":        cls,
			"Admission No": admNo,
			"Email":        email,
			"Phone":        phone,
		})
	}

	summary := fmt.Sprintf("%d student(s) found", len(result))
	if classFilter != "" {
		summary += fmt.Sprintf(" in class '%s'", classFilter)
	}

	return &DataPayload{
		Columns: []string{"Student", "Class", "Admission No", "Email", "Phone"},
		Rows:    result,
		Summary: summary,
		Tool:    "student_list",
	}, nil
}

// ── Tool: teacher_list ───────────────────────────────────────────────────────

func executeTeacherList(ctx context.Context, db *database.PostgresDB, schoolID string, args map[string]any) (*DataPayload, error) {
	limit := safeLimitInt(args, "limit", 50, 200)
	subjectFilter := safeString(args, "subject")

	tCtx := tenantCtx(ctx, schoolID)

	where := []string{}
	params := []any{}
	i := 1

	if subjectFilter != "" {
		where = append(where, fmt.Sprintf("EXISTS (SELECT 1 FROM unnest(t.subjects) s WHERE s ILIKE $%d)", i))
		params = append(params, "%"+subjectFilter+"%")
		i++
	}

	whereSql := ""
	if len(where) > 0 {
		whereSql = "WHERE " + joinAnd(where)
	}

	params = append(params, limit)
	limitParam := i

	query := fmt.Sprintf(`
		SELECT
			u.full_name,
			u.email,
			u.phone,
			t.employee_id,
			COALESCE(t.qualification, '') AS qualification,
			t.experience_years,
			array_to_string(COALESCE(t.subjects, '{}'), ', ') AS subjects
		FROM teachers t
		JOIN users u ON u.id = t.user_id
		%s
		ORDER BY u.full_name
		LIMIT $%d
	`, whereSql, limitParam)

	rows, err := db.Query(tCtx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("teacher_list query: %w", err)
	}
	defer rows.Close()

	var result []map[string]any
	for rows.Next() {
		var name, email, phone, empID, qual, subjects string
		var expYears int
		if err := rows.Scan(&name, &email, &phone, &empID, &qual, &expYears, &subjects); err != nil {
			return nil, fmt.Errorf("teacher_list scan: %w", err)
		}
		result = append(result, map[string]any{
			"Name":        name,
			"Email":       email,
			"Phone":       phone,
			"Employee ID": empID,
			"Subjects":    subjects,
			"Experience":  fmt.Sprintf("%d yrs", expYears),
		})
	}

	summary := fmt.Sprintf("%d teacher(s) found", len(result))
	if subjectFilter != "" {
		summary += fmt.Sprintf(" teaching '%s'", subjectFilter)
	}

	return &DataPayload{
		Columns: []string{"Name", "Email", "Phone", "Employee ID", "Subjects", "Experience"},
		Rows:    result,
		Summary: summary,
		Tool:    "teacher_list",
	}, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func joinAnd(parts []string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += " AND "
		}
		result += p
	}
	return result
}
