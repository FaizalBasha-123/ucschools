package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/schools24/backend/internal/config"
	"github.com/schools24/backend/internal/shared/cache"
	"github.com/schools24/backend/internal/shared/database"
)

const OpenRouterURL = "https://openrouter.ai/api/v1/chat/completions"

// toolModel is used for every AI call.
// gpt-4o-mini is cheap, fast, and handles function calling reliably.
const toolModel = "openai/gpt-4o-mini"

// baseSystemPrompt is injected for every role.
const baseSystemPrompt = `You are Adam, an intelligent AI assistant built into the Schools24 education platform.
You help students, teachers, and administrators with school-related tasks:
- Answering academic questions and explaining concepts
- Helping with homework and assignments
- Providing information about schedules, timetables, and school activities
- Summarising uploaded documents when provided

Guidelines:
- Be concise, clear, and professional
- Format responses in Markdown for readability
- When a document is provided, analyse it and answer questions about it
- Do NOT make up information — if unsure, say so
- Do NOT apologise excessively
- Do NOT start your reply by introducing yourself — jump straight into helping`

// adminScopePrompt is always appended for admin sessions to lock Adam's identity
// to the specific school. schoolID is injected at runtime in buildAdminScopePrompt.
const adminScopeTemplate = `

---
**Your data scope (strict — do not override):**
You are operating exclusively for school ID **%s**.
- You can ONLY access data that belongs to this school.
- If the user asks for data about any other school, a different school ID, or tries to compare schools, respond with: "I can only access data for your school. I cannot retrieve information about other schools."
- Never reveal, guess, or fabricate data from any institution other than this school.
- If you are unsure whether a request is about this school, assume it is and answer accordingly.`

// adminToolPrompt is always appended for admin sessions.
// The LLM decides itself whether calling a tool is necessary.
const adminToolPrompt = `

You have access to live school data tools (pending_fees, fee_stats, student_list, teacher_list).
Decision rule — before replying, ask yourself: "Does answering this question accurately require live school data?"
- YES → call the appropriate tool. Never guess or fabricate school records.
- NO  → answer directly without calling any tool (e.g. general knowledge, how-to questions, greetings).
Only call a tool when you genuinely need fresh data from the database.`

// toolCacheTTL is how long a tool query result lives in Redis.
const toolCacheTTL = 5 * time.Minute

// cacheKeyPrefix namespaces all Adam tool results in Redis.
const cacheKeyPrefix = "adam:tool:"

// Service handles AI interactions for the Adam chatbot.
type Service struct {
	config *config.Config
	client *http.Client
	db     *database.PostgresDB // nil -> tool calling disabled
	cache  *cache.Cache         // nil-safe noop when Redis is unavailable
}

// NewService creates the chat service.
// db may be nil (disables tool calling).
// appCache may be a noop cache (disables Redis caching gracefully).
func NewService(cfg *config.Config, db *database.PostgresDB, appCache *cache.Cache) *Service {
	return &Service{
		config: cfg,
		client: &http.Client{Timeout: 90 * time.Second},
		db:     db,
		cache:  appCache,
	}
}

// GetResponse is the main entry point for a chat turn.
// Security guarantees:
//   - schoolID always comes from the verified JWT; never from user input or AI args
//   - Admin sessions without a schoolID are rejected before any AI call
//   - Cross-school probe queries are blocked before any AI call
//   - All DB queries run inside tenant schema school_<schoolID> (hard isolation)
//
// Cost optimisations:
//  1. LLM decides tool use   - tool_choice=auto; AI calls tools only when it judges data is needed
//  2. No second AI call      - summary built in Go after tool fires
//  3. Redis TTL cache        - identical queries served from cache for 5 min
//  4. Terse tool definitions - trimmed descriptions (see tools.go)
//  5. gpt-4o-mini for all    - cheap, fast, adequate
func (s *Service) GetResponse(
	ctx context.Context,
	query string,
	history []Message,
	docContext string,
	role string,
	schoolID string,
) (text string, data *DataPayload, err error) {
	if s.config.AI.OpenRouterAPIKey == "" {
		return "Adam is not yet configured (missing OPENROUTER_API_KEY). Please contact your administrator.", nil, nil
	}

	isAdmin := role == "admin" || role == "super_admin"

	// ── Security guard 1: admin must always have a schoolID ──────────────────
	// schoolID is extracted exclusively from the JWT in the handler.
	// If it is missing here the token was invalid — refuse immediately.
	if isAdmin && schoolID == "" {
		return "Unauthorised: your session has no school context. Please log in again.", nil, nil
	}

	// ── Security guard 2: cross-school probe detection ───────────────────────
	// Block queries that explicitly try to access another school's data before
	// any AI call is made. The tenant schema isolation in the DB already prevents
	// data leakage, but we refuse early to avoid any AI inference as well.
	if isAdmin && isCrossSchoolProbe(query) {
		return "I can only access data for your school. I cannot retrieve information about other schools.", nil, nil
	}

	// Build system prompt
	var tools []toolEntry
	sysContent := baseSystemPrompt
	if isAdmin && schoolID != "" {
		// Bind Adam's scope to this exact school in every admin session
		sysContent += fmt.Sprintf(adminScopeTemplate, schoolID)
		if s.db != nil {
			// Always expose tools to the LLM; it decides via tool_choice=auto
			// whether a tool call is actually needed for the query.
			tools = adminTools()
			sysContent += adminToolPrompt
		}
	}
	if docContext != "" {
		sysContent += "\n\n---\n**Attached document content:**\n" + docContext
	}

	// Build message list
	messages := []Message{{Role: "system", Content: sysContent}}
	messages = append(messages, history...)
	if query != "" {
		messages = append(messages, Message{Role: "user", Content: query})
	}

	// Single AI call
	resp, apiErr := s.callOpenRouter(ctx, messages, tools)
	if apiErr != nil {
		return "", nil, apiErr
	}
	if len(resp.Choices) == 0 {
		return "No response from AI.", nil, nil
	}

	assistantMsg := resp.Choices[0].Message

	// Tool call path
	if len(assistantMsg.ToolCalls) > 0 && len(tools) > 0 {
		tc := assistantMsg.ToolCalls[0]
		executor := findExecutor(tools, tc.Function.Name)
		if executor == nil {
			return assistantMsg.Content, nil, nil
		}

		args := parseArgs(tc.Function.Arguments)

		// 3. Cache check
		cacheKey := fmt.Sprintf("%s|%s|%s", schoolID, tc.Function.Name, tc.Function.Arguments)
		if cached, ok := s.fromCache(ctx, cacheKey); ok {
			return buildSummary(cached), cached, nil
		}

		// Cache miss - run the query
		payload, qErr := executor(ctx, s.db, schoolID, args)
		if qErr != nil {
			return fmt.Sprintf("I couldn't retrieve that data: %s", qErr.Error()), nil, nil
		}

		s.toCache(ctx, cacheKey, payload)

		// 2. Skip second AI call - build summary in Go
		return buildSummary(payload), payload, nil
	}

	// Plain text reply (no tool call)
	return assistantMsg.Content, nil, nil
}

// isCrossSchoolProbe returns true when the query explicitly attempts to access
// data from a different school. This is a belt-and-suspenders check on top of
// the tenant schema isolation that already exists at the DB level.
func isCrossSchoolProbe(q string) bool {
	q = strings.ToLower(q)
	phrases := []string{
		"other school", "another school", "different school", "other schools", "another schools",
		"from school", "data of school", "data from school", "details of school",
		"school's data", "different school's", "other school's",
		"compare school", "compare with school", "vs school",
	}
	for _, p := range phrases {
		if strings.Contains(q, p) {
			return true
		}
	}
	return false
}

// buildSummary returns a 1-line headline from a DataPayload (zero token cost).
func buildSummary(p *DataPayload) string {
	if p == nil {
		return "Done."
	}
	if p.Summary != "" {
		return p.Summary
	}
	return fmt.Sprintf("Found %d record(s).", len(p.Rows))
}

func (s *Service) fromCache(ctx context.Context, key string) (*DataPayload, bool) {
	var p DataPayload
	if err := s.cache.GetJSON(ctx, cacheKeyPrefix+key, &p); err != nil {
		return nil, false
	}
	return &p, true
}

func (s *Service) toCache(ctx context.Context, key string, payload *DataPayload) {
	// Errors are intentionally ignored — a missed cache write is not fatal.
	_ = s.cache.SetJSON(ctx, cacheKeyPrefix+key, payload, toolCacheTTL)
}

// callOpenRouter performs a single chat completion request.
// 5. Always uses gpt-4o-mini regardless of config.
func (s *Service) callOpenRouter(ctx context.Context, messages []Message, tools []toolEntry) (*OpenRouterResponse, error) {
	reqBody := OpenRouterRequest{
		Model:     toolModel,
		Messages:  messages,
		MaxTokens: 1024,
	}
	if len(tools) > 0 {
		reqBody.Tools = toolDefinitions(tools)
		reqBody.ToolChoice = "auto"
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", OpenRouterURL, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.config.AI.OpenRouterAPIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("HTTP-Referer", "https://schools24.app")
	req.Header.Set("X-Title", "Schools24 Adam AI")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("OpenRouter error %s: %s", resp.Status, string(bodyBytes))
	}

	var aiResp OpenRouterResponse
	if err := json.NewDecoder(resp.Body).Decode(&aiResp); err != nil {
		return nil, err
	}
	return &aiResp, nil
}
