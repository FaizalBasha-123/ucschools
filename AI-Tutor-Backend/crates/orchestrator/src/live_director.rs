use anyhow::Result;
use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::info;

use ai_tutor_domain::runtime::{
    AgentTurnSummary, ChatMessage, ClientStageState, GeneratedChatAgentConfig,
    StatelessEvent, UserProfile, WhiteboardActionRecord,
};
use ai_tutor_providers::traits::LlmProvider;

use crate::prompt_builder::build_prompt;
use crate::response_parser::{create_stream_parser_state, parse_stream_chunk};

pub struct OrchestratorState {
    pub messages: Vec<ChatMessage>,
    pub store_state: ClientStageState,
    pub available_agent_ids: Vec<String>,
    pub discussion_context: Option<DiscussionContext>,
    pub trigger_agent_id: Option<String>,
    pub user_profile: Option<UserProfile>,
    pub agent_config_overrides: HashMap<String, GeneratedChatAgentConfig>,

    // Mutable
    pub current_agent_id: Option<String>,
    pub turn_count: i32,
    pub agent_responses: Vec<AgentTurnSummary>,
    pub whiteboard_ledger: Vec<WhiteboardActionRecord>,
    pub should_end: bool,
    pub total_actions: i32,
}

#[derive(Debug, Clone)]
pub struct DiscussionContext {
    pub topic: String,
    pub prompt: Option<String>,
}

fn resolve_agent<'a>(
    state: &'a OrchestratorState,
    agent_id: &str,
) -> Option<&'a GeneratedChatAgentConfig> {
    state.agent_config_overrides.get(agent_id)
}

pub async fn run_director_graph(
    mut state: OrchestratorState,
    llm: &(dyn LlmProvider + Send + Sync),
    tx: mpsc::Sender<StatelessEvent>,
) -> Result<OrchestratorState> {
    loop {
        state = director_node(state, llm, tx.clone()).await?;

        if state.should_end {
            break;
        }

        if let Some(agent_id) = state.current_agent_id.clone() {
            state = agent_generate_node(state, &agent_id, llm, tx.clone()).await?;
        } else {
            break;
        }
    }

    Ok(state)
}

async fn director_node(
    mut state: OrchestratorState,
    llm: &(dyn LlmProvider + Send + Sync),
    tx: mpsc::Sender<StatelessEvent>,
) -> Result<OrchestratorState> {
    let _ = tx
        .send(StatelessEvent::Thinking {
            stage: "director".to_string(),
            agent_id: None,
        })
        .await;

    // Build the director prompt
    let mut vars = HashMap::new();
    vars.insert("agentList", "Agents available: ...".to_string());
    vars.insert("respondedList", "None".to_string());
    vars.insert("conversationSummary", "Summary".to_string());
    vars.insert("discussionSection", "".to_string());
    vars.insert("whiteboardSection", "".to_string());
    vars.insert("studentProfileSection", "".to_string());
    vars.insert("rule1", "1. Choose the best agent.".to_string());
    vars.insert("turnCountPlusOne", format!("{}", state.turn_count + 1));
    vars.insert(
        "whiteboardOpenText",
        if state.store_state.whiteboard_open {
            "OPEN"
        } else {
            "CLOSED"
        }
        .to_string(),
    );

    let (system_prompt, _) = build_prompt("director", &vars).unwrap_or_default();

    let (response_text, _) = llm
        .generate_text_with_params(&system_prompt, "Decide which agent should speak next.", &Default::default())
        .await?;

    info!(provider = "director", "Director raw decision: {}", response_text);

    // Naive parsing for now
    if response_text.contains("\"END\"") {
        state.should_end = true;
    } else if response_text.contains("\"USER\"") {
        state.should_end = true;
        let _ = tx
            .send(StatelessEvent::CueUser {
                from_agent_id: state.current_agent_id.clone(),
            })
            .await;
    } else if let Some(agent_id) = extract_agent_id(&response_text) {
        state.current_agent_id = Some(agent_id.clone());
        state.should_end = false;
        let _ = tx
            .send(StatelessEvent::Thinking {
                stage: "agent_loading".to_string(),
                agent_id: Some(agent_id),
            })
            .await;
    } else {
        state.should_end = true;
    }

    Ok(state)
}

fn extract_agent_id(json_str: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;
    parsed
        .get("next_agent")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

async fn agent_generate_node(
    mut state: OrchestratorState,
    agent_id: &str,
    llm: &(dyn LlmProvider + Send + Sync),
    tx: mpsc::Sender<StatelessEvent>,
) -> Result<OrchestratorState> {
    let agent_config = resolve_agent(&state, agent_id).cloned();
    let agent_name = agent_config.as_ref().map(|a| a.name.clone()).unwrap_or_default();
    
    let message_id = format!("assistant-{}-{}", agent_id, chrono::Utc::now().timestamp_millis());

    let _ = tx
        .send(StatelessEvent::AgentStart {
            message_id: message_id.clone(),
            agent_id: agent_id.to_string(),
            agent_name: agent_name.clone(),
            agent_avatar: agent_config.as_ref().map(|a| a.avatar.clone()),
            agent_color: agent_config.as_ref().map(|a| a.color.clone()),
        })
        .await;

    // The Massive "OpenMAIC" Pedagogical System Prompt
    let system_prompt = r#"You are an elite, emotionally intelligent AI Tutor orchestrating an interactive learning session.
Your goal is to guide the student towards deep mastery using Socratic questioning, scaffolding, and active recall.

CORE BEHAVIORS:
1. NEVER just give the answer directly. Always guide the student to discover it.
2. Use SSML tags for emotional pacing! Use <break time="0.5s"/> for pauses, <prosody rate="fast"> for excitement, or <voice name="af_heart"> for warmth.
3. Be concise and conversational.
4. Adapt to the student's learning state (Confused, Understanding, Mastered).
5. Output ONLY a JSON array of actions.

AVAILABLE ACTIONS:
- { "action": "speak", "text": "<SSML formatted speech>" }
- { "action": "show_slide", "slide_id": "slide_123" }
- { "action": "wait_for_input" }

You must respond in strict JSON array format. Example:
[
  { "action": "speak", "text": "<voice name=\"af_heart\">Hello there! <break time=\"0.5s\"/> Are you ready to dive into today's topic?</voice>" },
  { "action": "wait_for_input" }
]
"#.to_string();
    
    // Flatten messages
    let mut history = vec![("system".to_string(), system_prompt)];
    for msg in &state.messages {
        history.push((msg.role.clone(), msg.content.clone()));
    }
    history.push(("user".to_string(), "Please begin.".to_string()));

    let tx_clone = tx.clone();
    let mut parser_state = create_stream_parser_state();
    let message_id_clone = message_id.clone();
    let agent_id_clone = agent_id.to_string();

    let mut action_count = 0;
    let mut full_text = String::new();

    let mut on_delta = |chunk: String| {
        let result = parse_stream_chunk(&chunk, &mut parser_state);
        
        for emission in result.emissions {
            match emission {
                crate::response_parser::StreamEmission::Text(text) => {
                    full_text.push_str(&text);
                    let _ = tx_clone.blocking_send(StatelessEvent::TextDelta {
                        content: text,
                        message_id: message_id_clone.clone(),
                    });
                }
                crate::response_parser::StreamEmission::Action(action) => {
                    action_count += 1;
                    let _ = tx_clone.blocking_send(StatelessEvent::Action {
                        action_id: format!("act-{}", chrono::Utc::now().timestamp_millis()),
                        action_name: action.action_name,
                        params: action.params,
                        agent_id: agent_id_clone.clone(),
                        message_id: message_id_clone.clone(),
                    });
                }
            }
        }
    };

    let _generated = llm.generate_text_stream_with_history(&history, &mut on_delta).await?;

    // Record turn summary
    state.agent_responses.push(AgentTurnSummary {
        agent_id: agent_id.to_string(),
        agent_name,
        content_preview: full_text.chars().take(100).collect(),
        action_count,
        whiteboard_actions: vec![],
    });

    state.turn_count += 1;
    state.total_actions += action_count;

    Ok(state)
}
