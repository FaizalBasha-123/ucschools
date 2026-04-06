package main

import (
	"context"
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
	if err := db.MigrateAllSchoolsData(ctx); err != nil {
		log.Fatalf("Failed to migrate tenant data: %v", err)
	}

	log.Println("Tenant data migration completed.")
}
