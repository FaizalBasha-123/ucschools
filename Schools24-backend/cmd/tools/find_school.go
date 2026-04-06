package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
)

func main() {
	connString := os.Getenv("DATABASE_URL")
	if connString == "" {
		connString = "postgres://postgres:password@localhost:5432/schools24?sslmode=disable"
	}

	conn, err := pgx.Connect(context.Background(), connString)
	if err != nil {
		log.Fatalf("Unable to connect: %v", err)
	}
	defer conn.Close(context.Background())

	schoolID := "0b826a22-3781-4dce-92f3-4241ded91c9b"
	// Only fetch columns we know exist: id and name
	query := `SELECT id, name FROM schools WHERE id = $1`

	var id, name string
	err = conn.QueryRow(context.Background(), query, schoolID).Scan(&id, &name)
	if err != nil {
		if err == pgx.ErrNoRows {
			fmt.Printf("❌ School ID %s NOT FOUND.\n", schoolID)
			return
		}
		log.Fatalf("Query failed: %v", err)
	}

	fmt.Printf("✅ School Found:\n")
	fmt.Printf("ID:   %s\n", id)
	fmt.Printf("Name: %s\n", name)
}
