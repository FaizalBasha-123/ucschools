package main

import (
	"context"
	"fmt"
	"hash/crc32"
	"log"
	"math"
	"math/rand"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/schools24/backend/internal/config"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	cfg := config.Load()
	dbPool, err := pgxpool.New(context.Background(), cfg.Database.URL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer dbPool.Close()

	ctx := context.Background()

	// 0. Run Migrations
	migrationFiles := []string{
		"migrations/global/001_users.sql",
		"migrations/global/002_admin_init.sql",
		"migrations/global/003_add_school_id_to_users.sql",
		"migrations/global/004_fix_schools_schema.sql",
		"migrations/global/005_separate_super_admins.sql",
		"migrations/global/006_add_soft_delete_to_schools.sql",
	}
	for _, file := range migrationFiles {
		content, err := os.ReadFile(file)
		if err != nil {
			log.Fatalf("Failed to read migration %s: %v", file, err)
		}
		_, err = dbPool.Exec(ctx, string(content))
		if err != nil {
			log.Printf("Migration warning %s: %v", file, err)
		} else {
			log.Printf("Executed migration: %s", file)
		}
	}

	// 1. Ensure School Exists
	schoolID := uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")
	var exists bool
	_ = dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schools WHERE id=$1)", schoolID).Scan(&exists)

	if !exists {
		_, err = dbPool.Exec(ctx, `
			INSERT INTO schools (id, name, address, phone, email, website, code, created_at, updated_at)
			VALUES ($1, 'School24 Demo', '123 Education Lane', '+1234567890', 'admin@schools24.com', 'https://schools24.com', 'SCH001', NOW(), NOW())
		`, schoolID)
		if err != nil {
			log.Fatalf("Failed to create school: %v", err)
		}
	}

	// 1.5 Link Admin Users AND Reset Passwords (to ensure known state)
	adminPasswordHash, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	_, err = dbPool.Exec(ctx, `
		UPDATE users 
		SET school_id = $1, password_hash = $2
		WHERE email IN ('admin@schools24.com', 'admin@school24.in')
	`, schoolID, string(adminPasswordHash))
	if err != nil {
		log.Printf("Error linking admins: %v", err)
	}

	// 2. Insert Staff Members (Users + Specific Table)
	staffMembers := []struct {
		Name          string
		Email         string
		Role          string
		Phone         string
		EmployeeID    string
		StaffType     string
		Department    string
		Designation   string
		Qualification string
		Experience    int
		Salary        float64
		Rating        float64
		JoinDate      time.Time
		Subjects      []string
	}{
		{
			Name: "Rajesh Kumar", Email: "rajesh.kumar@School24.com", Role: "teacher", Phone: "+91 9876543221",
			EmployeeID: "TCH001", StaffType: "teaching", Department: "Mathematics", Designation: "Senior Mathematics Teacher",
			Qualification: "M.Sc. Mathematics, B.Ed", Experience: 12, Salary: 65000, Rating: 4.8, JoinDate: time.Date(2012, 6, 15, 0, 0, 0, 0, time.UTC),
			Subjects: []string{"Mathematics", "Physics"},
		},
		{
			Name: "Priya Sharma", Email: "priya.sharma@School24.com", Role: "teacher", Phone: "+91 9876543222",
			EmployeeID: "TCH002", StaffType: "teaching", Department: "Science", Designation: "Chemistry Teacher",
			Qualification: "M.Sc. Chemistry, B.Ed", Experience: 8, Salary: 55000, Rating: 4.6, JoinDate: time.Date(2016, 4, 1, 0, 0, 0, 0, time.UTC),
			Subjects: []string{"Chemistry", "Biology"},
		},
		{
			Name: "Ramesh Gupta", Email: "ramesh.gupta@School24.com", Role: "staff", Phone: "+91 9876543226",
			EmployeeID: "ADM001", StaffType: "non-teaching", Department: "Administration", Designation: "Accountant",
			Qualification: "B.Com, M.Com", Experience: 10, Salary: 45000, Rating: 4.5, JoinDate: time.Date(2014, 2, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			Name: "Suresh Singh", Email: "suresh.singh@School24.com", Role: "staff", Phone: "+91 9876543227",
			EmployeeID: "ADM002", StaffType: "non-teaching", Department: "Security", Designation: "Head Security Guard",
			Qualification: "10th Pass", Experience: 15, Salary: 25000, Rating: 4.2, JoinDate: time.Date(2009, 8, 10, 0, 0, 0, 0, time.UTC),
		},
	}

	for _, s := range staffMembers {
		// A. Create/Get User
		var userID uuid.UUID
		err := dbPool.QueryRow(ctx, "SELECT id FROM users WHERE email=$1", strings.ToLower(s.Email)).Scan(&userID)
		if err != nil {
			// Create User
			userID = uuid.New()
			hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
			_, err = dbPool.Exec(ctx, `
				INSERT INTO users (id, email, password_hash, role, full_name, phone, school_id, email_verified, created_at, updated_at)
				VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, true, NOW(), NOW())
			`, userID, s.Email, string(hashedPassword), s.Role, s.Name, s.Phone, schoolID)
			if err != nil {
				log.Printf("Failed to create user %s: %v", s.Email, err)
				continue
			}
		}

		// B. Insert into specific table
		if s.StaffType == "teaching" {
			_, err = dbPool.Exec(ctx, `
				INSERT INTO teachers (school_id, user_id, employee_id, qualification, experience_years, salary, hire_date, subjects)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT DO NOTHING
			`, schoolID, userID, s.EmployeeID, s.Qualification, s.Experience, s.Salary, s.JoinDate, s.Subjects)
		} else {
			_, err = dbPool.Exec(ctx, `
				INSERT INTO non_teaching_staff (school_id, user_id, employee_id, department, designation, qualification, experience_years, salary, hire_date)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT DO NOTHING
			`, schoolID, userID, s.EmployeeID, s.Department, s.Designation, s.Qualification, s.Experience, s.Salary, s.JoinDate)
		}

		if err != nil {
			log.Printf("Failed to insert details for %s: %v", s.Name, err)
		} else {
			log.Printf("Upserted staff %s", s.Name)
		}
	}

	// 3. Seed teacher leaderboard entries for all schools
	if err := seedTeacherLeaderboards(ctx, dbPool); err != nil {
		log.Printf("Failed to seed teacher leaderboards: %v", err)
	} else {
		log.Println("Teacher leaderboards seeded successfully.")
	}

	log.Println("Seeding completed successfully.")
}

type teacherLeaderboardSeed struct {
	TeacherID          uuid.UUID
	Rating             float64
	StudentsCount      int
	AssignmentsCount   int
	GradedRecordsCount int
	AverageScore       float64
	Trend              string
	CompositeScore     float64
}

func seedTeacherLeaderboards(ctx context.Context, dbPool *pgxpool.Pool) error {
	rows, err := dbPool.Query(ctx, "SELECT id FROM schools")
	if err != nil {
		return err
	}
	defer rows.Close()

	academicYear := currentAcademicYear()

	for rows.Next() {
		var schoolID uuid.UUID
		if err := rows.Scan(&schoolID); err != nil {
			return err
		}
		if err := seedTeacherLeaderboardForSchool(ctx, dbPool, schoolID, academicYear); err != nil {
			log.Printf("Failed to seed leaderboard for school %s: %v", schoolID, err)
		}
	}

	return nil
}

func seedTeacherLeaderboardForSchool(ctx context.Context, dbPool *pgxpool.Pool, schoolID uuid.UUID, academicYear string) error {
	tx, err := dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	schemaName := "school_" + schoolID.String()
	_, err = tx.Exec(ctx, "SET LOCAL search_path TO \""+schemaName+"\", public")
	if err != nil {
		return err
	}

	teachersRows, err := tx.Query(ctx, "SELECT id, COALESCE(rating, 0) FROM teachers")
	if err != nil {
		return err
	}
	defer teachersRows.Close()

	seeds := make([]teacherLeaderboardSeed, 0)
	for teachersRows.Next() {
		var teacherID uuid.UUID
		var existingRating float64
		if err := teachersRows.Scan(&teacherID, &existingRating); err != nil {
			return err
		}

		seed := int64(crc32.ChecksumIEEE([]byte(teacherID.String())))
		r := rand.New(rand.NewSource(seed))

		rating := existingRating
		if rating <= 0 {
			rating = roundTo(3.8+r.Float64()*1.1, 1)
		}
		students := 80 + r.Intn(141)
		assignments := 5 + r.Intn(21)
		graded := 20 + r.Intn(41)
		avgScore := roundTo(65+r.Float64()*30, 2)

		trend := "stable"
		if rating >= 4.5 && avgScore >= 80 {
			trend = "up"
		} else if rating < 3.5 || avgScore < 60 {
			trend = "down"
		}

		composite := roundTo(((rating*20.0)*0.35)+(avgScore*0.45)+((math.Min(float64(graded), 60)*100.0/60.0)*0.20), 2)

		seeds = append(seeds, teacherLeaderboardSeed{
			TeacherID:          teacherID,
			Rating:             rating,
			StudentsCount:      students,
			AssignmentsCount:   assignments,
			GradedRecordsCount: graded,
			AverageScore:       avgScore,
			Trend:              trend,
			CompositeScore:     composite,
		})
	}

	if len(seeds) == 0 {
		return tx.Commit(ctx)
	}

	sort.Slice(seeds, func(i, j int) bool {
		if seeds[i].CompositeScore == seeds[j].CompositeScore {
			if seeds[i].Rating == seeds[j].Rating {
				return seeds[i].TeacherID.String() < seeds[j].TeacherID.String()
			}
			return seeds[i].Rating > seeds[j].Rating
		}
		return seeds[i].CompositeScore > seeds[j].CompositeScore
	})

	for idx, entry := range seeds {
		rank := idx + 1
		_, err := tx.Exec(ctx, `
			INSERT INTO teacher_leaderboard_entries (
				school_id, teacher_id, academic_year, rating, students_count,
				assignments_count, graded_records_count, average_student_score,
				trend, composite_score, rank, last_calculated_at, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW(),NOW())
			ON CONFLICT (school_id, teacher_id, academic_year)
			DO UPDATE SET
				rating = EXCLUDED.rating,
				students_count = EXCLUDED.students_count,
				assignments_count = EXCLUDED.assignments_count,
				graded_records_count = EXCLUDED.graded_records_count,
				average_student_score = EXCLUDED.average_student_score,
				trend = EXCLUDED.trend,
				composite_score = EXCLUDED.composite_score,
				rank = EXCLUDED.rank,
				last_calculated_at = NOW(),
				updated_at = NOW()
		`, schoolID, entry.TeacherID, academicYear, entry.Rating, entry.StudentsCount,
			entry.AssignmentsCount, entry.GradedRecordsCount, entry.AverageScore,
			entry.Trend, entry.CompositeScore, rank)
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, "UPDATE teachers SET rating = $1 WHERE id = $2", entry.Rating, entry.TeacherID)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func roundTo(value float64, decimals int) float64 {
	factor := math.Pow(10, float64(decimals))
	return math.Round(value*factor) / factor
}

func currentAcademicYear() string {
	now := time.Now()
	year := now.Year()
	if now.Month() < time.April {
		return fmt.Sprintf("%d-%d", year-1, year)
	}
	return fmt.Sprintf("%d-%d", year, year+1)
}
