package main

import (
	"context"
	"fmt"
	"log"

	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/shared/database"
)

func main() {
	cfg := config.Load()
	db, err := database.NewPostgresDB(cfg.Database.URL)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	rows, err := db.Pool.Query(ctx, "SELECT id, name FROM public.schools ORDER BY name")
	if err != nil {
		log.Fatalf("Failed to list schools: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var schoolID string
		var schoolName string
		if err := rows.Scan(&schoolID, &schoolName); err != nil {
			log.Printf("Failed to scan school: %v", err)
			continue
		}

		schema := fmt.Sprintf("\"school_%s\"", schoolID)
		_, err := db.Pool.Exec(ctx, fmt.Sprintf(`
            INSERT INTO %s.users (id, email, password_hash, role, full_name, phone, profile_picture_url, school_id, email_verified, last_login_at, is_active, created_at, updated_at)
            SELECT id, email, password_hash, role, full_name, phone, profile_picture_url, school_id, email_verified, last_login_at, is_active, created_at, updated_at
            FROM public.users
            WHERE school_id = $1 AND role != 'super_admin'
            ON CONFLICT (id) DO UPDATE SET
                email = EXCLUDED.email,
                full_name = EXCLUDED.full_name,
                phone = EXCLUDED.phone,
                last_login_at = EXCLUDED.last_login_at,
                updated_at = EXCLUDED.updated_at
        `, schema), schoolID)
		if err != nil {
			log.Printf("%s: failed to sync tenant users: %v", schoolName, err)
			continue
		}

		log.Printf("Synced tenant users for %s (%s)", schoolName, schoolID)
	}
}
