package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5"
)

func main() {
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		connStr = "postgres://postgres:password@localhost:5432/schools24?sslmode=disable"
	}

	conn, err := pgx.Connect(context.Background(), connStr)
	if err != nil {
		fmt.Println("connect error:", err)
		os.Exit(1)
	}
	defer conn.Close(context.Background())

	_, _ = conn.Exec(context.Background(), `SET search_path TO "school_550e8400-e29b-41d4-a716-446655440000", public`)

	quizID := "d9b586c9-18c7-453f-8caf-c00a15c1630d"

	// Check quiz counts
	var title string
	var qCount, totalMarks int
	err = conn.QueryRow(context.Background(),
		`SELECT title, question_count, total_marks FROM quizzes WHERE id = $1`, quizID,
	).Scan(&title, &qCount, &totalMarks)
	if err != nil {
		fmt.Println("quiz query error:", err)
	} else {
		fmt.Printf("Quiz: %q  question_count=%d  total_marks=%d\n", title, qCount, totalMarks)
	}

	// List questions
	rows, err := conn.Query(context.Background(),
		`SELECT id, question_text, marks FROM quiz_questions WHERE quiz_id = $1 ORDER BY created_at`, quizID)
	if err != nil {
		fmt.Println("questions query error:", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("\nQuestions:")
	for rows.Next() {
		var id, text string
		var marks int
		_ = rows.Scan(&id, &text, &marks)
		fmt.Printf("  [%s] %q  marks=%d\n", id[:8], text, marks)
	}
}
