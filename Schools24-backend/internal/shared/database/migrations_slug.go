package database

import (
	"context"
	"log"
)

func AddSlugColumn(ctx context.Context, db *PostgresDB) error {
	query := `
		ALTER TABLE schools ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
		
		-- Generate slugs for existing schools without slugs
		UPDATE schools 
		SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
		WHERE slug IS NULL;
	`
	_, err := db.Pool.Exec(ctx, query)
	if err != nil {
		log.Printf("Failed to add slug column: %v", err)
		return err
	}
	log.Println("Added slug column to schools table.")
	return nil
}
