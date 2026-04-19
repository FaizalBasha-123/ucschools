//! Structured response parser for interleaved JSON Array output.
//!
//! Ported from OpenMAIC's `stateless-generate.ts` — implements the same
//! incremental parsing strategy:
//!
//!   1. Accumulate stream chunks into a buffer
//!   2. Skip any prefix before `[` (markdown fences, explanatory text)
//!   3. Extract complete JSON objects from the growing array
//!   4. Separate `type:"text"` (speech) from `type:"action"` (whiteboard/spotlight)
//!   5. Handle plain-text fallback when the LLM ignores JSON instructions
//!
//! Unlike OpenMAIC's TypeScript version which uses `partial-json` + `jsonrepair`,
//! this Rust port uses `serde_json` with manual brace-depth tracking that correctly
//! handles escaped characters inside strings (including LaTeX `\frac{a}{b}`).

use serde_json::Value;
use tracing::warn;

/// A parsed action from the LLM's JSON array output.
#[derive(Debug, Clone)]
pub struct ParsedAction {
    pub action_name: String,
    pub params: Value,
}

/// Result from parsing a complete LLM response.
#[derive(Debug, Clone)]
pub struct ParsedResponse {
    /// Speech text segments extracted from `type:"text"` items.
    pub text_segments: Vec<String>,
    /// Action objects extracted from `type:"action"` items.
    pub actions: Vec<ParsedAction>,
    /// Whether the response was plain text (no JSON array found).
    pub was_plain_text: bool,
}

/// Incremental parser state for streamed structured output.
#[derive(Debug, Clone, Default)]
pub struct StreamParserState {
    buffer: String,
    json_started: bool,
    emitted_item_count: usize,
    last_partial_text_length: usize,
    is_done: bool,
}

/// Incremental parse result from a streamed chunk.
#[derive(Debug, Clone, Default)]
pub struct StreamParseResult {
    pub text_chunks: Vec<String>,
    pub actions: Vec<ParsedAction>,
    pub emissions: Vec<StreamEmission>,
    pub is_done: bool,
}

#[derive(Debug, Clone)]
pub enum StreamEmission {
    Text(String),
    Action(ParsedAction),
}

pub fn create_stream_parser_state() -> StreamParserState {
    StreamParserState::default()
}

/// Strip markdown code fences from a response string.
/// Matches OpenMAIC's `stripCodeFences()` in `action-parser.ts:23-26`.
fn strip_code_fences(text: &str) -> &str {
    let trimmed = text.trim();

    // Remove opening ```json or ```
    let without_open = if let Some(stripped) = trimmed.strip_prefix("```json") {
        stripped.trim_start()
    } else if let Some(stripped) = trimmed.strip_prefix("```") {
        stripped.trim_start()
    } else {
        trimmed
    };

    // Remove closing ```
    if let Some(stripped) = without_open.strip_suffix("```") {
        stripped.trim_end()
    } else {
        without_open
    }
}

/// Extract the JSON array substring from a raw LLM response.
/// Matches OpenMAIC's `action-parser.ts:50-59` bracket finding.
fn extract_json_array(text: &str) -> Option<&str> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;

    if end > start {
        Some(&text[start..=end])
    } else {
        // Unclosed array — take from `[` to end
        Some(&text[start..])
    }
}

fn parse_item(item: &Value) -> Option<ResultItem> {
    let item_type = item
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match item_type {
        value if value == "text" || value == "message" => {
            let content = item
                .get("content")
                .or_else(|| item.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if content.is_empty() {
                None
            } else {
                Some(ResultItem::Text(content.to_string()))
            }
        }
        value if value == "action" || value == "tool" => {
            let action_name = item
                .get("name")
                .or_else(|| item.get("tool_name"))
                .or_else(|| item.get("action_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let mut params = item
                .get("params")
                .or_else(|| item.get("parameters"))
                .cloned()
                .unwrap_or(Value::Object(serde_json::Map::new()));
            if let Some(decoded) = decode_stringified_json_value(&params) {
                params = decoded;
            }

            if action_name.is_empty() {
                None
            } else {
                Some(ResultItem::Action(ParsedAction {
                    action_name,
                    params,
                }))
            }
        }
        _ => infer_item_without_explicit_type(item),
    }
}

enum ResultItem {
    Text(String),
    Action(ParsedAction),
}

fn infer_item_without_explicit_type(item: &Value) -> Option<ResultItem> {
    if let Some(action_name) = item
        .get("name")
        .or_else(|| item.get("tool_name"))
        .or_else(|| item.get("action_name"))
        .and_then(|v| v.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let mut params = item
            .get("params")
            .or_else(|| item.get("parameters"))
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));
        if let Some(decoded) = decode_stringified_json_value(&params) {
            params = decoded;
        }
        return Some(ResultItem::Action(ParsedAction {
            action_name: action_name.to_string(),
            params,
        }));
    }

    let text = item
        .get("content")
        .or_else(|| item.get("text"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(ResultItem::Text(text.to_string()))
}

fn decode_stringified_json_value(value: &Value) -> Option<Value> {
    let raw = value.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(raw).ok()
}

/// Parse a complete LLM response into structured text + actions.
///
/// This is the main entry point — called after the full response is
/// accumulated. Mirrors OpenMAIC's `parseActionsFromStructuredOutput()`
/// with the addition of the `finalizeParser()` plain-text fallback.
pub fn parse_response(raw: &str) -> ParsedResponse {
    let cleaned = strip_code_fences(raw);

    // Step 1: Try to find and extract the JSON array
    let json_str = match extract_json_array(cleaned) {
        Some(s) => s,
        None => {
            // No JSON array found — plain text fallback
            // Matches OpenMAIC's finalizeParser() lines 282-285
            let content = cleaned.trim();
            if content.is_empty() {
                return ParsedResponse {
                    text_segments: vec![],
                    actions: vec![],
                    was_plain_text: true,
                };
            }
            return ParsedResponse {
                text_segments: vec![content.to_string()],
                actions: vec![],
                was_plain_text: true,
            };
        }
    };

    // Step 2: Parse the JSON array
    // Try serde_json first. If it fails (malformed JSON), attempt repair.
    let items: Vec<Value> = match serde_json::from_str(json_str) {
        Ok(Value::Array(arr)) => arr,
        Ok(_) => {
            warn!("Parsed JSON is not an array, treating as plain text");
            return ParsedResponse {
                text_segments: vec![cleaned.trim().to_string()],
                actions: vec![],
                was_plain_text: true,
            };
        }
        Err(_) => {
            // Attempt repair: try adding closing brackets
            let repaired = format!("{}]", json_str);
            match serde_json::from_str::<Value>(&repaired) {
                Ok(Value::Array(arr)) => arr,
                _ => {
                    // Last resort: extract what we can character by character
                    warn!("Failed to parse JSON array, attempting object extraction");
                    match extract_objects_manually(json_str) {
                        objects if !objects.is_empty() => objects,
                        _ => {
                            // Complete failure — fallback to raw text after `[`
                            let raw_text = json_str
                                .trim_start_matches('[')
                                .trim_end_matches(']')
                                .trim();
                            if raw_text.is_empty() {
                                return ParsedResponse {
                                    text_segments: vec![],
                                    actions: vec![],
                                    was_plain_text: true,
                                };
                            }
                            return ParsedResponse {
                                text_segments: vec![raw_text.to_string()],
                                actions: vec![],
                                was_plain_text: true,
                            };
                        }
                    }
                }
            }
        }
    };

    // Step 3: Convert items to text segments and actions
    // Matches OpenMAIC's action-parser.ts lines 91-121
    let mut text_segments = Vec::new();
    let mut actions = Vec::new();

    for item in &items {
        match parse_item(item) {
            Some(ResultItem::Text(text)) => text_segments.push(text),
            Some(ResultItem::Action(action)) => actions.push(action),
            None => {}
        }
    }

    ParsedResponse {
        text_segments,
        actions,
        was_plain_text: false,
    }
}

/// Parse a streamed chunk of structured output and emit newly completed items.
///
/// This is a first Rust equivalent of OpenMAIC's streamed parser. It emits
/// complete text/action items as soon as they can be parsed from the growing
/// JSON array buffer.
pub fn parse_stream_chunk(chunk: &str, state: &mut StreamParserState) -> StreamParseResult {
    let mut result = StreamParseResult::default();
    if state.is_done {
        return result;
    }

    state.buffer.push_str(chunk);

    if !state.json_started {
        if let Some(bracket_index) = state.buffer.find('[') {
            state.buffer = state.buffer[bracket_index..].to_string();
            state.json_started = true;
        } else {
            return result;
        }
    }

    let trimmed = state.buffer.trim_end();
    let is_array_closed = trimmed.ends_with(']') && trimmed.len() > 1;
    let json_str = extract_json_array(&state.buffer).unwrap_or(state.buffer.as_str());
    let parsed_items = extract_objects_manually(json_str);

    // OpenMAIC parity note:
    // `stateless-generate.ts::parseStructuredChunk` treats the trailing in-flight
    // array item separately from completed items so text can stream before full
    // JSON closure. This Rust parser mirrors that intent by emitting completed
    // items from `parsed_items` and then streaming deltas from an unclosed
    // trailing text item directly from the raw buffer.
    let complete_up_to = parsed_items.len();
    for (index, item) in parsed_items.iter().enumerate().skip(state.emitted_item_count) {
        match parse_item(item) {
            Some(ResultItem::Text(text)) => {
                let emitted_text = if index == state.emitted_item_count
                    && state.last_partial_text_length > 0
                {
                    let remaining = text
                        .get(state.last_partial_text_length..)
                        .unwrap_or_default()
                        .to_string();
                    state.last_partial_text_length = 0;
                    remaining
                } else {
                    text
                };

                if !emitted_text.is_empty() {
                    result.text_chunks.push(emitted_text.clone());
                    result.emissions.push(StreamEmission::Text(emitted_text));
                }
            }
            Some(ResultItem::Action(action)) => {
                result.actions.push(action.clone());
                result.emissions.push(StreamEmission::Action(action));
            }
            None => {}
        }
    }

    state.emitted_item_count = complete_up_to;

    if !is_array_closed {
        if let Some(partial_text) = extract_partial_text_from_unclosed_trailing_item(json_str) {
            if partial_text.len() > state.last_partial_text_length {
                let delta = &partial_text[state.last_partial_text_length..];
                let delta = delta.to_string();
                result.text_chunks.push(delta.clone());
                result.emissions.push(StreamEmission::Text(delta));
                state.last_partial_text_length = partial_text.len();
            }
        }
    }

    if is_array_closed {
        state.is_done = true;
        result.is_done = true;
        state.last_partial_text_length = 0;
    }
    
    result
}

fn extract_partial_text_from_unclosed_trailing_item(input: &str) -> Option<String> {
    let object = extract_unclosed_trailing_object(input)?;
    let item_type = extract_json_string_field(object, "type")
        .or_else(|| extract_json_string_field(object, "kind"))?;
    let normalized = item_type.trim().to_ascii_lowercase();
    if normalized != "text" && normalized != "message" {
        return None;
    }

    extract_json_string_field(object, "content")
        .or_else(|| extract_json_string_field(object, "text"))
}

fn extract_unclosed_trailing_object(input: &str) -> Option<&str> {
    let start = input.rfind('{')?;
    let candidate = &input[start..];

    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape_next = false;
    for byte in candidate.bytes() {
        if escape_next {
            escape_next = false;
            continue;
        }

        match byte {
            b'\\' if in_string => escape_next = true,
            b'"' => in_string = !in_string,
            b'{' if !in_string => depth += 1,
            b'}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return None;
                }
            }
            _ => {}
        }
    }

    if depth > 0 { Some(candidate) } else { None }
}

fn extract_json_string_field(input: &str, field_name: &str) -> Option<String> {
    let key = format!("\"{}\"", field_name);
    let key_index = input.find(&key)?;
    let after_key = &input[key_index + key.len()..];
    let colon_index = after_key.find(':')?;
    let mut rest = after_key[colon_index + 1..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    rest = &rest[1..];

    let mut output = String::new();
    let mut escape_next = false;
    for ch in rest.chars() {
        if escape_next {
            match ch {
                '"' => output.push('"'),
                '\\' => output.push('\\'),
                'n' => output.push('\n'),
                'r' => output.push('\r'),
                't' => output.push('\t'),
                other => output.push(other),
            }
            escape_next = false;
            continue;
        }

        match ch {
            '\\' => escape_next = true,
            '"' => return Some(output),
            other => output.push(other),
        }
    }

    Some(output)
}

/// Finalize the incremental parser after the stream ends.
pub fn finalize_stream_parser(state: &mut StreamParserState) -> StreamParseResult {
    if state.is_done {
        return StreamParseResult {
            is_done: true,
            ..Default::default()
        };
    }

    let mut result = StreamParseResult {
        is_done: true,
        ..Default::default()
    };

    let cleaned = strip_code_fences(&state.buffer);
    if !state.json_started {
        let content = cleaned.trim();
        if !content.is_empty() && state.emitted_item_count == 0 {
            result.text_chunks.push(content.to_string());
            result
                .emissions
                .push(StreamEmission::Text(content.to_string()));
        }
        state.is_done = true;
        return result;
    }

    let json_str = extract_json_array(cleaned).unwrap_or(cleaned);
    let parsed_items = extract_objects_manually(json_str);
    for item in parsed_items.iter().skip(state.emitted_item_count) {
        match parse_item(item) {
            Some(ResultItem::Text(text)) => {
                result.text_chunks.push(text.clone());
                result.emissions.push(StreamEmission::Text(text));
            }
            Some(ResultItem::Action(action)) => {
                result.actions.push(action.clone());
                result.emissions.push(StreamEmission::Action(action));
            }
            None => {}
        }
    }

    state.is_done = true;
    result
}

/// Extract JSON objects manually from a potentially malformed array string.
/// This is the Rust equivalent of OpenMAIC's `jsonrepair` + `partial-json` fallback.
fn extract_objects_manually(input: &str) -> Vec<Value> {
    let mut objects = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'{' {
            // Find matching closing brace using depth tracking
            let mut depth = 0i32;
            let mut in_string = false;
            let mut escape_next = false;
            let start = i;
            let mut found_complete_object = false;
            let mut next_index = i;

            for j in i..bytes.len() {
                if escape_next {
                    escape_next = false;
                    continue;
                }

                match bytes[j] {
                    b'\\' if in_string => {
                        escape_next = true;
                    }
                    b'"' => {
                        in_string = !in_string;
                    }
                    b'{' if !in_string => {
                        depth += 1;
                    }
                    b'}' if !in_string => {
                        depth -= 1;
                        if depth == 0 {
                            let obj_str = &input[start..=j];
                            if let Ok(val) = serde_json::from_str::<Value>(obj_str) {
                                objects.push(val);
                            }
                            next_index = j + 1;
                            found_complete_object = true;
                            break;
                        }
                    }
                    _ => {}
                }
            }

            if found_complete_object {
                i = next_index;
            } else {
                // Reached end without closing brace
                i = bytes.len();
            }
        } else {
            i += 1;
        }
    }

    objects
}

// ── Action Validation ─────────────────────────────────────────────────
// Ported from OpenMAIC's `action-parser.ts:129-150`

/// Slide-only actions that should be stripped from non-slide scenes.
const SLIDE_ONLY_ACTIONS: &[&str] = &["spotlight", "laser"];

/// Validate and filter actions based on role and scene context.
/// Matches OpenMAIC's action-parser.ts steps 6-7.
pub fn validate_actions(
    actions: Vec<ParsedAction>,
    scene_type: Option<&str>,
    allowed_actions: &[String],
) -> Vec<ParsedAction> {
    let mut result = actions;

    // Step 1: Strip slide-only actions from non-slide scenes
    if let Some(st) = scene_type {
        if st != "slide" {
            let before = result.len();
            result.retain(|a| !SLIDE_ONLY_ACTIONS.contains(&a.action_name.as_str()));
            let stripped = before - result.len();
            if stripped > 0 {
                tracing::info!(
                    "Stripped {} slide-only action(s) from {} scene",
                    stripped,
                    st
                );
            }
        }
    }

    // Step 2: Filter by allowed_actions whitelist (role-based isolation)
    // Catches hallucinated actions not in the agent's permitted set
    if !allowed_actions.is_empty() {
        let before = result.len();
        result.retain(|a| {
            // Speech-equivalent text is always allowed
            allowed_actions.contains(&a.action_name)
                || a.action_name.starts_with("wb_")
                    && allowed_actions.iter().any(|aa| aa == "whiteboard")
        });
        let stripped = before - result.len();
        if stripped > 0 {
            tracing::info!(
                "Stripped {} disallowed action(s) by allowedActions whitelist",
                stripped
            );
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_json_array() {
        let input = r#"[{"type":"text","content":"Hello students!"},{"type":"action","name":"wb_open","params":{}},{"type":"text","content":"Let me show you."}]"#;
        let result = parse_response(input);
        assert!(!result.was_plain_text);
        assert_eq!(result.text_segments.len(), 2);
        assert_eq!(result.text_segments[0], "Hello students!");
        assert_eq!(result.text_segments[1], "Let me show you.");
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action_name, "wb_open");
    }

    #[test]
    fn test_parse_plain_text_fallback() {
        let input = "I'm sorry, I can't format as JSON. Let me explain normally.";
        let result = parse_response(input);
        assert!(result.was_plain_text);
        assert_eq!(result.text_segments.len(), 1);
        assert_eq!(result.text_segments[0], input);
        assert!(result.actions.is_empty());
    }

    #[test]
    fn test_parse_with_code_fences() {
        let input = r#"```json
[{"type":"text","content":"Fenced response"}]
```"#;
        let result = parse_response(input);
        assert!(!result.was_plain_text);
        assert_eq!(result.text_segments.len(), 1);
        assert_eq!(result.text_segments[0], "Fenced response");
    }

    #[test]
    fn test_parse_latex_in_params() {
        let input = r#"[{"type":"action","name":"wb_draw_latex","params":{"latex":"\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}","x":100,"y":80}},{"type":"text","content":"The quadratic formula."}]"#;
        let result = parse_response(input);
        assert!(!result.was_plain_text);
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action_name, "wb_draw_latex");
        assert_eq!(result.text_segments.len(), 1);
    }

    #[test]
    fn test_validate_strips_slide_actions_from_quiz() {
        let actions = vec![
            ParsedAction {
                action_name: "spotlight".to_string(),
                params: Value::Null,
            },
            ParsedAction {
                action_name: "wb_draw_text".to_string(),
                params: Value::Null,
            },
        ];
        let result = validate_actions(actions, Some("quiz"), &[]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].action_name, "wb_draw_text");
    }

    #[test]
    fn test_empty_response() {
        let result = parse_response("");
        assert!(result.was_plain_text);
        assert!(result.text_segments.is_empty());
    }

    #[test]
    fn test_stream_parser_emits_complete_items_incrementally() {
        let mut state = create_stream_parser_state();
        let first = parse_stream_chunk(
            r#"[{"type":"text","content":"Hello"},{"type":"action","name":"wb_open","params":{}"#,
            &mut state,
        );
        assert_eq!(first.text_chunks, vec!["Hello".to_string()]);
        assert!(first.actions.is_empty());
        assert!(matches!(
            first.emissions.as_slice(),
            [StreamEmission::Text(text)] if text == "Hello"
        ));
        assert!(!first.is_done);

        let second = parse_stream_chunk(r#"}}]"#, &mut state);
        assert_eq!(second.actions.len(), 1);
        assert_eq!(second.actions[0].action_name, "wb_open");
        assert!(matches!(
            second.emissions.as_slice(),
            [StreamEmission::Action(action)] if action.action_name == "wb_open"
        ));
        assert!(second.is_done);
    }

    #[test]
    fn test_stream_parser_finalizes_plain_text() {
        let mut state = create_stream_parser_state();
        let mid = parse_stream_chunk("Plain response", &mut state);
        assert!(mid.text_chunks.is_empty());

        let final_result = finalize_stream_parser(&mut state);
        assert_eq!(final_result.text_chunks, vec!["Plain response".to_string()]);
        assert!(final_result.is_done);
    }

    #[test]
    fn test_stream_parser_emits_partial_text_for_unclosed_trailing_item() {
        let mut state = create_stream_parser_state();
        let first = parse_stream_chunk(r#"[{"type":"text","content":"Hello wo"#, &mut state);
        assert_eq!(first.text_chunks, vec!["Hello wo".to_string()]);
        assert!(matches!(
            first.emissions.as_slice(),
            [StreamEmission::Text(text)] if text == "Hello wo"
        ));
        assert!(!first.is_done);

        let second = parse_stream_chunk(r#"rld"}]"#, &mut state);
        assert_eq!(second.text_chunks, vec!["rld".to_string()]);
        assert!(matches!(
            second.emissions.as_slice(),
            [StreamEmission::Text(text)] if text == "rld"
        ));
        assert!(second.is_done);
    }

    #[test]
    fn test_stream_parser_preserves_text_action_text_emission_order() {
        let mut state = create_stream_parser_state();
        let result = parse_stream_chunk(
            r#"[{"type":"text","content":"Hello"},{"type":"action","name":"wb_open","params":{}},{"type":"text","content":"par"#,
            &mut state,
        );

        assert_eq!(result.text_chunks, vec!["Hello".to_string(), "par".to_string()]);
        assert_eq!(result.actions.len(), 1);
        assert!(matches!(
            result.emissions.as_slice(),
            [
                StreamEmission::Text(first),
                StreamEmission::Action(action),
                StreamEmission::Text(last)
            ] if first == "Hello" && action.action_name == "wb_open" && last == "par"
        ));
    }

    #[test]
    fn test_stream_parser_finalize_does_not_replay_partial_text() {
        let mut state = create_stream_parser_state();
        let first = parse_stream_chunk(r#"[{"type":"text","content":"Hello"#, &mut state);
        assert_eq!(first.text_chunks, vec!["Hello".to_string()]);

        let second = parse_stream_chunk(r#" world"}]"#, &mut state);
        assert_eq!(second.text_chunks, vec![" world".to_string()]);

        let final_result = finalize_stream_parser(&mut state);
        assert!(final_result.text_chunks.is_empty());
        assert!(final_result.actions.is_empty());
        assert!(final_result.emissions.is_empty());
    }

    #[test]
    fn test_parse_infers_action_without_explicit_type() {
        let input = r#"[{"name":"wb_open","params":{}}]"#;
        let result = parse_response(input);
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action_name, "wb_open");
    }

    #[test]
    fn test_parse_infers_text_without_explicit_type() {
        let input = r#"[{"content":"Plain inferred text item"}]"#;
        let result = parse_response(input);
        assert_eq!(
            result.text_segments,
            vec!["Plain inferred text item".to_string()]
        );
    }

    #[test]
    fn test_parse_decodes_stringified_action_params() {
        let input = r#"[{"type":"action","name":"wb_draw_text","params":"{\"elementId\":\"n1\",\"content\":\"hello\"}"}]"#;
        let result = parse_response(input);
        assert_eq!(result.actions.len(), 1);
        assert_eq!(
            result.actions[0]
                .params
                .get("elementId")
                .and_then(|v| v.as_str()),
            Some("n1")
        );
    }
}
