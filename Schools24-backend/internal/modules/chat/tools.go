package chat

import (
	"context"
	"encoding/json"

	"github.com/schools24/backend/internal/shared/database"
)

// ToolExecutor is a function that runs a pre-written, read-only query for a tool
// and returns a structured DataPayload to be forwarded to the AI for formatting.
type ToolExecutor func(ctx context.Context, db *database.PostgresDB, schoolID string, args map[string]any) (*DataPayload, error)

// toolEntry pairs the AI-visible Tool definition with the Go executor function.
type toolEntry struct {
	Tool    Tool
	Execute ToolExecutor
}

// adminTools returns the fixed list of data tools available ONLY to admin users.
func adminTools() []toolEntry {
	return []toolEntry{
		{
			Tool: Tool{
				Type: "function",
				Function: ToolFunction{
					Name:        "pending_fees",
					Description: "List students with unpaid/overdue/partial fees. Use for questions about fee defaulters or outstanding balances.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"min_amount": map[string]any{
								"type":        "number",
								"description": "Minimum outstanding balance in INR.",
							},
							"max_amount": map[string]any{
								"type":        "number",
								"description": "Maximum outstanding balance in INR.",
							},
							"status": map[string]any{
								"type": "string",
								"enum": []string{"pending", "overdue", "partial", "all"},
							},
							"class_name": map[string]any{
								"type":        "string",
								"description": "Filter by class name (partial match).",
							},
							"limit": map[string]any{
								"type":        "integer",
								"description": "Max rows (default 50, max 200).",
							},
						},
						"required": []string{},
					},
				},
			},
			Execute: executePendingFees,
		},
		{
			Tool: Tool{
				Type: "function",
				Function: ToolFunction{
					Name:        "fee_stats",
					Description: "School-wide fee collection summary: total demanded, collected, outstanding, and counts by status.",
					Parameters: map[string]any{
						"type":       "object",
						"properties": map[string]any{},
						"required":   []string{},
					},
				},
			},
			Execute: executeFeeStats,
		},
		{
			Tool: Tool{
				Type: "function",
				Function: ToolFunction{
					Name:        "student_list",
					Description: "List enrolled students, optionally filtered by class name.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"class_name": map[string]any{
								"type":        "string",
								"description": "Optional class name filter (partial match).",
							},
							"limit": map[string]any{
								"type":        "integer",
								"description": "Max rows (default 50, max 200).",
							},
						},
						"required": []string{},
					},
				},
			},
			Execute: executeStudentList,
		},
		{
			Tool: Tool{
				Type: "function",
				Function: ToolFunction{
					Name:        "teacher_list",
					Description: "List teachers at this school with their subjects and contact details.",
					Parameters: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"subject": map[string]any{
								"type":        "string",
								"description": "Filter by subject name (partial match).",
							},
							"limit": map[string]any{
								"type":        "integer",
								"description": "Max rows (default 50, max 200).",
							},
						},
						"required": []string{},
					},
				},
			},
			Execute: executeTeacherList,
		},
	}
}

// toolDefinitions extracts the []Tool slice used in the OpenRouter request body.
func toolDefinitions(entries []toolEntry) []Tool {
	tools := make([]Tool, len(entries))
	for i, e := range entries {
		tools[i] = e.Tool
	}
	return tools
}

// findExecutor returns the ToolExecutor for the given function name, or nil.
func findExecutor(entries []toolEntry, name string) ToolExecutor {
	for _, e := range entries {
		if e.Tool.Function.Name == name {
			return e.Execute
		}
	}
	return nil
}

// parseArgs decodes the AI-supplied JSON argument string into a map.
// Returns an empty map on any parse error so callers never receive nil.
func parseArgs(rawJSON string) map[string]any {
	args := make(map[string]any)
	if rawJSON == "" {
		return args
	}
	_ = json.Unmarshal([]byte(rawJSON), &args)
	return args
}
