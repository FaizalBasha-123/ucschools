package main

import (
	"context"
	"log"

	"github.com/google/uuid"
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

	// Get all schools
	rows, err := db.Pool.Query(ctx, "SELECT id, name FROM schools")
	if err != nil {
		log.Fatalf("Failed to query schools: %v", err)
	}
	defer rows.Close()

	// Scan into slice first to release connection for rows?
	// pgx handles it, but safer.
	type School struct {
		ID   string // scan as string then parse
		Name string
	}
	var schools []School

	for rows.Next() {
		var s School
		if err := rows.Scan(&s.ID, &s.Name); err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}
		schools = append(schools, s)
	}
	rows.Close()

	for _, s := range schools {
		sid, err := uuid.Parse(s.ID)
		if err != nil {
			log.Printf("Invalid UUID for school %s: %v", s.Name, err)
			continue
		}

		log.Printf("Syncing schema for school: %s (%s)", s.Name, sid)
		if err := db.CreateSchoolSchema(ctx, sid); err != nil {
			log.Printf("Failed to create schema for %s: %v", s.Name, err)
		} else {
			log.Printf("Schema synced successfully for %s", s.Name)
		}
	}
}
