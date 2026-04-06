package main

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/schools24/backend/internal/config"
)

func main() {
	cfg := config.Load()
	dbPool, err := pgxpool.New(context.Background(), cfg.Database.URL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer dbPool.Close()

	ctx := context.Background()

	// 1. Check Schools
	fmt.Println("--- SCHOOLS ---")
	rows, _ := dbPool.Query(ctx, "SELECT id, name, code FROM schools")
	for rows.Next() {
		var id, name, code string
		rows.Scan(&id, &name, &code)
		fmt.Printf("ID: %s | Name: %s | Code: %s\n", id, name, code)
	}
	rows.Close()

	// 2. Check Admin User
	fmt.Println("\n--- USERS (Admin) ---")
	rows, _ = dbPool.Query(ctx, "SELECT id, email, role, school_id FROM users WHERE email='admin@schools24.com'")
	for rows.Next() {
		var id, email, role string
		var schoolID *string
		rows.Scan(&id, &email, &role, &schoolID)
		sid := "NULL"
		if schoolID != nil {
			sid = *schoolID
		}
		fmt.Printf("User: %s | Role: %s | SchoolID: %s\n", email, role, sid)
	}
	rows.Close()

	// 3. Check Staff (Teachers + NonActions)
	fmt.Println("\n--- TEACHERS ---")
	rows, _ = dbPool.Query(ctx, "SELECT t.id, u.full_name, t.school_id FROM teachers t JOIN users u ON t.user_id = u.id")
	for rows.Next() {
		var id, name, schoolID string
		rows.Scan(&id, &name, &schoolID)
		fmt.Printf("Teacher: %s | SchoolID: %s\n", name, schoolID)
	}
	rows.Close()

	fmt.Println("\n--- NON-TEACHING ---")
	rows, _ = dbPool.Query(ctx, "SELECT s.id, u.full_name, s.school_id FROM non_teaching_staff s JOIN users u ON s.user_id = u.id")
	for rows.Next() {
		var id, name, schoolID string
		rows.Scan(&id, &name, &schoolID)
		fmt.Printf("Staff: %s | SchoolID: %s\n", name, schoolID)
	}
	rows.Close()
}
