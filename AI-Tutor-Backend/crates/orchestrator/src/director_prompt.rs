//! Director prompt builder and decision parser.
//!
//! Ported from OpenMAIC's `director-prompt.ts` — constructs the same
//! system prompt for LLM-based multi-agent routing and parses the
//! structured JSON decision output.

use ai_tutor_domain::runtime::{
    AgentTurnSummary, GeneratedChatAgentConfig, StatelessChatRequest, WhiteboardActionRecord,
};
use ai_tutor_providers::traits::ProviderRuntimeStatus;

/// Parsed director decision from LLM output.
#[derive(Debug, Clone)]
pub struct DirectorDecision {
    pub next_agent_id: Option<String>,
    pub should_end: bool,
}

/// Build the system prompt for the LLM-based director.
///
/// This mirrors OpenMAIC's `buildDirectorPrompt()` — giving the LLM
/// full awareness of available agents, conversation context, whiteboard
/// state, and routing quality rules.
pub fn build_director_prompt(
    agents: &[GeneratedChatAgentConfig],
    agent_responses: &[AgentTurnSummary],
    turn_count: i32,
    discussion_context: Option<(&str, Option<&str>)>,
    trigger_agent_id: Option<&str>,
    whiteboard_ledger: &[WhiteboardActionRecord],
    user_profile: Option<(&str, Option<&str>)>,
    whiteboard_open: bool,
    conversation_summary: &str,
    provider_runtime: &[ProviderRuntimeStatus],
) -> String {
    // Agent list
    let agent_list: String = agents
        .iter()
        .map(|a| {
            format!(
                "- id: \"{}\", name: \"{}\", role: {}, priority: {}",
                a.id, a.name, a.role, a.priority
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    // Already responded this round
    let responded_list = if agent_responses.is_empty() {
        "None yet.".to_string()
    } else {
        agent_responses
            .iter()
            .map(|r| {
                let wb_summary = summarize_agent_wb_actions(&r.whiteboard_actions);
                let wb_part = if wb_summary.is_empty() {
                    String::new()
                } else {
                    format!(" | Whiteboard: {}", wb_summary)
                };
                format!(
                    "- {} ({}): \"{}\" [{} actions{}]",
                    r.agent_name, r.agent_id, r.content_preview, r.action_count, wb_part
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let is_discussion = discussion_context.is_some();

    // Discussion section
    let discussion_section = if let Some((topic, prompt)) = discussion_context {
        let prompt_part = prompt
            .map(|p| format!("\nPrompt: \"{}\"", p))
            .unwrap_or_default();
        let trigger_part = trigger_agent_id
            .map(|t| format!("\nInitiator: \"{}\"", t))
            .unwrap_or_default();
        format!(
            "\n# Discussion Mode\nTopic: \"{}\"{}{}\nThis is a student-initiated discussion, not a Q&A session.\n",
            topic, prompt_part, trigger_part
        )
    } else {
        String::new()
    };

    // Rule 1 depends on discussion mode
    let rule1 = if is_discussion {
        let trigger_hint = trigger_agent_id
            .map(|t| format!(" (\"{}\")", t))
            .unwrap_or_default();
        format!(
            "1. The discussion initiator{} should speak first to kick off the topic. Then the teacher responds to guide the discussion. After that, other students may add their perspectives.",
            trigger_hint
        )
    } else {
        "1. The teacher (role: teacher, highest priority) should usually speak first to address the user's question or topic.".to_string()
    };

    // Whiteboard state
    let whiteboard_section = build_whiteboard_state_for_director(whiteboard_ledger);

    // Student profile
    let student_section = if let Some((nickname, bio)) = user_profile {
        let bio_part = bio
            .map(|b| format!("\nBackground: {}", b))
            .unwrap_or_default();
        format!(
            "\n# Student Profile\nStudent name: {}{}\n",
            nickname, bio_part
        )
    } else {
        String::new()
    };

    let wb_status = if whiteboard_open {
        "OPEN (slide canvas is hidden — spotlight/laser will not work)"
    } else {
        "CLOSED (slide canvas is visible)"
    };

    let provider_runtime_section = if provider_runtime.is_empty() {
        String::new()
    } else {
        let status_lines = provider_runtime
            .iter()
            .map(|status| {
                format!(
                    "- {}: {} (recent_failures={})",
                    status.label,
                    if status.available {
                        "available"
                    } else {
                        "cooling_down"
                    },
                    status.consecutive_failures
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "\n# Model Runtime Health\n{}\nIf runtime health is degraded, prefer short teacher-led routing and avoid long multi-agent detours.\n",
            status_lines
        )
    };

    format!(
        r#"You are the Director of a multi-agent classroom. Your job is to decide which agent should speak next based on the conversation context.

# Available Agents
{agent_list}

# Agents Who Already Spoke This Round
{responded_list}

# Conversation Context
{conversation_summary}
{discussion_section}{whiteboard_section}{student_section}{provider_runtime_section}
# Rules
{rule1}
2. After the teacher, consider whether a student agent would add value (ask a follow-up question, crack a joke, take notes, offer a different perspective).
3. Do NOT repeat an agent who already spoke this round unless absolutely necessary.
4. If the conversation seems complete (question answered, topic covered), output END.
5. Current turn: {turn}. Consider conversation length — don't let discussions drag on unnecessarily.
6. Prefer brevity — 1-2 agents responding is usually enough. Don't force every agent to speak.
7. You can output {{"next_agent":"USER"}} to cue the user to speak. Use this when a student asks the user a direct question or when the topic naturally calls for user input.
8. Consider whiteboard state when routing: if the whiteboard is already crowded, avoid dispatching agents that are likely to add more whiteboard content unless they would clear or organize it.
9. Whiteboard is currently {wb_status}. When the whiteboard is open, do not expect spotlight or laser actions to have visible effect.

# Routing Quality (CRITICAL)
- ROLE DIVERSITY: Do NOT dispatch two agents of the same role consecutively.
- CONTENT DEDUP: Read the "Agents Who Already Spoke" previews carefully. If an agent already explained a concept thoroughly, do NOT dispatch another agent to explain the same concept.
- DISCUSSION PROGRESSION: Each new agent should advance the conversation. Good progression: explain → question → deeper explanation → different perspective → summary.
- GREETING RULE: If any agent has already greeted the students, no subsequent agent should greet again.

# Output Format
You MUST output ONLY a JSON object, nothing else:
{{"next_agent":"<agent_id>"}}
or
{{"next_agent":"USER"}}
or
{{"next_agent":"END"}}"#,
        turn = turn_count + 1,
    )
}

/// Parse the director's LLM response into a routing decision.
///
/// Mirrors OpenMAIC's `parseDirectorDecision()` — extracts `next_agent`
/// from JSON, falls back to END if unparseable.
pub fn parse_director_decision(content: &str) -> DirectorDecision {
    // Try to find JSON with "next_agent" key
    if let Some(start) = content.find('{') {
        if let Some(end) = content[start..].find('}') {
            let json_str = &content[start..=start + end];
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(next_agent) = parsed.get("next_agent").and_then(|v| v.as_str()) {
                    if next_agent == "END" || next_agent.is_empty() {
                        return DirectorDecision {
                            next_agent_id: None,
                            should_end: true,
                        };
                    }

                    return DirectorDecision {
                        next_agent_id: Some(next_agent.to_string()),
                        should_end: next_agent == "USER",
                    };
                }
            }
        }
    }

    // Default: end the round if we can't parse
    tracing::warn!(
        raw_output = &content[..content.len().min(200)],
        "Failed to parse director decision, defaulting to END"
    );
    DirectorDecision {
        next_agent_id: None,
        should_end: true,
    }
}

/// Summarize a single agent's whiteboard actions into a compact description.
fn summarize_agent_wb_actions(actions: &[WhiteboardActionRecord]) -> String {
    if actions.is_empty() {
        return String::new();
    }

    let parts: Vec<String> = actions
        .iter()
        .filter_map(|a| {
            let name = a.action_name.as_str();
            match name {
                "wb_draw_text" => Some("drew text".to_string()),
                "wb_draw_shape" => Some("drew shape".to_string()),
                "wb_draw_chart" => Some("drew chart".to_string()),
                "wb_draw_latex" => Some("drew formula".to_string()),
                "wb_draw_table" => Some("drew table".to_string()),
                "wb_draw_line" => Some("drew line".to_string()),
                "wb_clear" => Some("CLEARED whiteboard".to_string()),
                "wb_delete" => Some("deleted element".to_string()),
                _ => None, // Skip wb_open/wb_close
            }
        })
        .collect();

    parts.join(", ")
}

/// Build the whiteboard state section for the director prompt.
fn build_whiteboard_state_for_director(ledger: &[WhiteboardActionRecord]) -> String {
    if ledger.is_empty() {
        return String::new();
    }

    let mut element_count: i32 = 0;
    let mut contributors = Vec::new();

    for record in ledger {
        let name = record.action_name.as_str();
        if name == "wb_clear" {
            element_count = 0;
        } else if name == "wb_delete" {
            element_count = (element_count - 1).max(0);
        } else if name.starts_with("wb_draw_") {
            element_count += 1;
            if !contributors.contains(&record.agent_name) {
                contributors.push(record.agent_name.clone());
            }
        }
    }

    let crowded_warning = if element_count > 5 {
        "\n⚠ The whiteboard is getting crowded. Consider routing to an agent that will organize or clear it rather than adding more."
    } else {
        ""
    };

    let contributor_str = if contributors.is_empty() {
        "none".to_string()
    } else {
        contributors.join(", ")
    };

    format!(
        "\n# Whiteboard State\nElements on whiteboard: {}\nContributors: {}{}\n",
        element_count, contributor_str, crowded_warning
    )
}

/// Build a compact conversation summary from the chat request messages.
pub fn summarize_conversation(payload: &StatelessChatRequest) -> String {
    let recent: Vec<String> = payload
        .messages
        .iter()
        .rev()
        .take(6)
        .rev()
        .map(|m| {
            let preview: String = m.content.chars().take(100).collect();
            format!("[{}]: {}", m.role, preview)
        })
        .collect();

    if recent.is_empty() {
        "No conversation history.".to_string()
    } else {
        recent.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_agent_decision() {
        let decision = parse_director_decision(r#"{"next_agent":"teacher-1"}"#);
        assert_eq!(decision.next_agent_id.as_deref(), Some("teacher-1"));
        assert!(!decision.should_end);
    }

    #[test]
    fn parse_user_cue() {
        let decision = parse_director_decision(r#"{"next_agent":"USER"}"#);
        assert_eq!(decision.next_agent_id.as_deref(), Some("USER"));
        assert!(decision.should_end);
    }

    #[test]
    fn parse_end_decision() {
        let decision = parse_director_decision(r#"{"next_agent":"END"}"#);
        assert!(decision.next_agent_id.is_none());
        assert!(decision.should_end);
    }

    #[test]
    fn parse_json_embedded_in_text() {
        let decision = parse_director_decision(
            r#"I think the next agent should be {"next_agent":"student-2"}"#,
        );
        assert_eq!(decision.next_agent_id.as_deref(), Some("student-2"));
        assert!(!decision.should_end);
    }

    #[test]
    fn parse_garbage_defaults_to_end() {
        let decision = parse_director_decision("I don't know what to do");
        assert!(decision.next_agent_id.is_none());
        assert!(decision.should_end);
    }
}
