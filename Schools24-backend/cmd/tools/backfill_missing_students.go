//go:build ignore
// +build ignore

// backfill_missing_students.go
// Finds every tenant schema in public.schools, then for each schema inserts a
// stub student profile for any user with role='student' that has no matching row
// in the students table.  Safe to run multiple times (INSERT ... WHERE NOT EXISTS).
//
// Run:
//   DATABASE_URL="<neon_url>" go run ./cmd/tools/backfill_missing_students.go

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// 1. Enumerate all live schools.
	rows, err := pool.Query(ctx, `SELECT id, name FROM public.schools WHERE deleted_at IS NULL ORDER BY name`)
	if err != nil {
		log.Fatalf("query schools: %v", err)
	}
	type school struct {
		id   string
		name string
	}
	var schools []school
	for rows.Next() {
		var s school
		if err := rows.Scan(&s.id, &s.name); err != nil {
			log.Printf("scan: %v", err)
			continue
		}
		schools = append(schools, s)
	}
	rows.Close()

	if len(schools) == 0 {
		fmt.Println("No schools found.")
		return
	}

	now := time.Now()
	y := now.Year()
	academicYear := fmt.Sprintf("%d-%d", y, y+1)

	for _, s := range schools {
		schemaName := fmt.Sprintf(`"school_%s"`, s.id)
		fmt.Printf("\n==== School: %s (id=%s) ====\n", s.name, s.id)
		fmt.Printf("     Schema: %s\n", schemaName)

		// 2. Find orphaned student users.
		orphanQuery := fmt.Sprintf(`
			SELECT u.id, u.email, u.full_name
			FROM %s.users u
			WHERE u.role = 'student'
			  AND NOT EXISTS (
			      SELECT 1 FROM %s.students st WHERE st.user_id = u.id
			  )
			ORDER BY u.created_at
		`, schemaName, schemaName)

		oRows, err := pool.Query(ctx, orphanQuery)
		if err != nil {
			fmt.Printf("  [SKIP] Could not query users: %v\n", err)
			continue
		}

		type orphan struct {
			userID   string
			email    string
			fullName string
		}
		var orphans []orphan
		for oRows.Next() {
			var o orphan
			if err := oRows.Scan(&o.userID, &o.email, &o.fullName); err != nil {
				log.Printf("  scan orphan: %v", err)
				continue
			}
			orphans = append(orphans, o)
		}
		oRows.Close()

		if len(orphans) == 0 {
			fmt.Println("  No orphaned student users. All good.")
			continue
		}

		fmt.Printf("  Found %d orphaned student user(s):\n", len(orphans))
		for _, o := range orphans {
			fmt.Printf("    - %s (%s)  user_id=%s\n", o.fullName, o.email, o.userID)
		}

		// 3. Insert stub student profile for each orphan.
		insertQuery := fmt.Sprintf(`
			INSERT INTO %s.students
				(school_id, user_id, admission_number, gender, academic_year, date_of_birth, admission_date)
			VALUES
				($1::uuid, $2::uuid, $3, 'other', $4, '2000-01-01'::date, CURRENT_DATE)
			ON CONFLICT DO NOTHING
		`, schemaName)

		for _, o := range orphans {
			admNumber := "ADM-" + upperStr(o.userID[:8])
			_, err := pool.Exec(ctx, insertQuery, s.id, o.userID, admNumber, academicYear)
			if err != nil {
				fmt.Printf("  [ERROR] Insert stub for %s: %v\n", o.email, err)
			} else {
				fmt.Printf("  [FIXED] Inserted stub student profile for %s (adm=%s)\n", o.email, admNumber)
			}
		}
	}

	fmt.Println("\nDone. Students with stub profiles (class_id=NULL) should now appear in the admin student list.")
	fmt.Println("A school admin must edit each backfilled student to assign the correct class and update their date_of_birth.")
}

func upperStr(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			result[i] = c - 32
		} else {
			result[i] = c
		}
	}
	return string(result)
}
