package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type User struct {
	ID        uuid.UUID
	Email     string
	Password  string
	FullName  string
	Role      string
	SchoolID  uuid.NullUUID
	CreatedAt time.Time
}

type School struct {
	ID           uuid.UUID
	Name         string
	Slug         sql.NullString
	Address      sql.NullString
	ContactEmail sql.NullString
	CreatedAt    time.Time
}

func main() {
	// ... (rest same until fetchSchools) ...
	log.Println("🚀 Starting Data Migration: Neon -> Local Docker")
	sourceDSN := os.Getenv("SOURCE_DATABASE_URL")
	if sourceDSN == "" {
		log.Fatal("SOURCE_DATABASE_URL must be set")
	}
	destDSN := os.Getenv("DEST_DATABASE_URL")
	if destDSN == "" {
		destDSN = "postgres://postgres:password@localhost:5432/schools24?sslmode=disable"
	}

	// 1. Connect to Source
	sourceDB, err := sql.Open("pgx", sourceDSN)
	if err != nil {
		log.Fatal("Failed to connect to Source DB:", err)
	}
	defer sourceDB.Close()
	if err := sourceDB.Ping(); err != nil {
		log.Fatal("Failed to ping Source DB:", err)
	}
	log.Println("✅ Connected to Source (Neon)")

	// 2. Connect to Destination
	destDB, err := sql.Open("pgx", destDSN)
	if err != nil {
		log.Fatal("Failed to connect to Dest DB:", err)
	}
	defer destDB.Close()
	if err := destDB.Ping(); err != nil {
		log.Fatal("Failed to ping Dest DB:", err)
	}
	log.Println("✅ Connected to Destination (Local Docker)")

	// 3. Migrate Schools
	log.Println("\n📦 Migrating Schools...")
	schools, err := fetchSchools(sourceDB)
	if err != nil {
		log.Fatal("Failed to fetch schools:", err)
	}
	log.Printf("Found %d schools in Source.\n", len(schools))

	for _, s := range schools {
		if err := insertSchool(destDB, s); err != nil {
			log.Printf("⚠️ Failed to insert school %s: %v\n", s.Name, err)
		} else {
			log.Printf("   Synced School: %s\n", s.Name)
		}
	}

	// 4. Migrate Users
	log.Println("\n📦 Migrating Users...")
	users, err := fetchUsers(sourceDB)
	if err != nil {
		log.Fatal("Failed to fetch users:", err)
	}
	log.Printf("Found %d users in Source.\n", len(users))

	fmt.Println("\n==========================================")
	fmt.Println("       🔑 CREDENTIALS FOUND (Neon)        ")
	fmt.Println("==========================================")
	for _, u := range users {
		fmt.Printf("User: %-25s | Role: '%s' | SchoolID: %v\n", u.Email, u.Role, u.SchoolID.UUID)

		// Normalize role to lowercase to avoid check constraint violations (e.g. 'Super Admin' -> 'super_admin')
		u.Role = strings.ToLower(u.Role)

		if err := insertUser(destDB, u); err != nil {
			log.Printf("⚠️ Failed to insert user %s (Role: %s): %v\n", u.Email, u.Role, err)
		}
	}
	fmt.Println("==========================================")
	fmt.Println()

	log.Println("✨ Migration Complete!")
}

func fetchSchools(db *sql.DB) ([]School, error) {
	rows, err := db.Query("SELECT id, name, slug, address, contact_email, created_at FROM schools")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schools []School
	for rows.Next() {
		var s School
		if err := rows.Scan(&s.ID, &s.Name, &s.Slug, &s.Address, &s.ContactEmail, &s.CreatedAt); err != nil {
			return nil, err
		}
		schools = append(schools, s)
	}
	return schools, nil
}

func insertSchool(db *sql.DB, s School) error {
	_, err := db.Exec(`
		INSERT INTO schools (id, name, slug, address, contact_email, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			slug = EXCLUDED.slug,
			address = EXCLUDED.address,
			contact_email = EXCLUDED.contact_email,
	`, s.ID, s.Name, s.Slug, s.Address, s.ContactEmail, s.CreatedAt)
	return err
}

func fetchUsers(db *sql.DB) ([]User, error) {
	rows, err := db.Query("SELECT id, email, password_hash, full_name, role, school_id, created_at FROM users")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Password, &u.FullName, &u.Role, &u.SchoolID, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

func insertUser(db *sql.DB, u User) error {
	_, err := db.Exec(`
		INSERT INTO users (id, email, password_hash, full_name, role, school_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (id) DO UPDATE SET
			email = EXCLUDED.email,
			password_hash = EXCLUDED.password_hash,
			full_name = EXCLUDED.full_name,
			role = EXCLUDED.role,
			school_id = EXCLUDED.school_id,
			role = EXCLUDED.role,
			updated_at = NOW();
	`, u.ID, u.Email, u.Password, u.FullName, u.Role, u.SchoolID, u.CreatedAt)
	return err
}
