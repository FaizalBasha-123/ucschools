package chat

// WebSocket Message Types
const (
	MsgTypeUser  = "user"
	MsgTypeBot   = "bot"
	MsgTypeError = "error"
	MsgTypeDoc   = "doc"  // client sends a document for context
	MsgTypeData  = "data" // server sends structured query results (table/cards)
)

// WSMessage represents a WebSocket message exchanged with the frontend.
type WSMessage struct {
	Type    string   `json:"type"`              // user | bot | error | doc | data
	Content string   `json:"content"`           // text / Markdown content
	Sources []string `json:"sources,omitempty"` // citations
	// Doc upload fields (type=="doc" only)
	Filename string `json:"filename,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	FileData string `json:"fileData,omitempty"` // base64-encoded bytes
	// Structured data payload (type=="data" only — produced by tool queries)
	DataPayload *DataPayload `json:"data,omitempty"`
}

// DataPayload carries structured query results so the frontend can render
// them as a table, cards, or summary rather than plain text.
type DataPayload struct {
	Columns []string         `json:"columns"` // ordered column names
	Rows    []map[string]any `json:"rows"`    // each row is column→value
	Summary string           `json:"summary"` // human-readable sentence
	Tool    string           `json:"tool"`    // which tool produced this
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter / OpenAI-compatible request & response types
// ─────────────────────────────────────────────────────────────────────────────

// Message is a single turn in the conversation (OpenAI format).
// Supports the extended fields needed for function/tool calling.
type Message struct {
	Role       string     `json:"role"`                   // system | user | assistant | tool
	Content    string     `json:"content"`                // may be empty when tool_calls is set
	ToolCallID string     `json:"tool_call_id,omitempty"` // required when role == "tool"
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`   // set by assistant when invoking a tool
}

// Tool is a callable function exposed to the AI model.
type Tool struct {
	Type     string       `json:"type"` // always "function"
	Function ToolFunction `json:"function"`
}

// ToolFunction describes the function signature shown to the AI.
type ToolFunction struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"` // JSON Schema object
}

// ToolCall is the tool invocation emitted by the AI in its response.
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"` // "function"
	Function FunctionCall `json:"function"`
}

// FunctionCall holds the AI-chosen function name and its JSON-encoded arguments.
type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string e.g. `{"min_amount":20000}`
}

// OpenRouterRequest is the OpenAI-compatible chat completion request.
type OpenRouterRequest struct {
	Model      string    `json:"model"`
	Messages   []Message `json:"messages"`
	MaxTokens  int       `json:"max_tokens,omitempty"`
	Tools      []Tool    `json:"tools,omitempty"`
	ToolChoice string    `json:"tool_choice,omitempty"` // "auto" | "none" | "required"
}

// OpenRouterResponse is the OpenAI-compatible completion response.
type OpenRouterResponse struct {
	ID      string   `json:"id"`
	Model   string   `json:"model"`
	Created int64    `json:"created"`
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage"`
}

type Choice struct {
	Index        int     `json:"index"`
	FinishReason string  `json:"finish_reason"`
	Message      Message `json:"message"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}
