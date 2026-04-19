//! GraphBit-powered stateless chat orchestration.
//!
//! Replaces the flat `for` loop in `app.rs::stateless_chat` with a directed
//! workflow graph modelled after GraphBit's `WorkflowExecutor`:
//!
//!   ┌──────────┐      ┌───────────┐
//!   │ Director  │─────►│   Tutor   │
//!   │  (select  │      │ (generate │
//!   │   agent)  │      │  response)│
//!   └──────────┘      └─────┬─────┘
//!        ▲                  │
//!        │   Continue       │
//!        └──────────────────┤
//!                           │ CueUser / End
//!                           ▼
//!                        [END]

use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedSender;
use tokio_util::sync::CancellationToken;

use ai_tutor_domain::runtime::{
    AgentTurnSummary, DirectorState, StatelessChatRequest, WhiteboardActionRecord,
};
use crate::pedagogy_router::{resolve_chat_pedagogy_route, thinking_message_for_chat};
use ai_tutor_providers::traits::{
    LlmProvider, ProviderRuntimeStatus, ProviderStreamEvent, ProviderToolCall, StreamingPath,
};
use ai_tutor_runtime::session::canonical_runtime_action_params;
use ai_tutor_runtime::session::RuntimeInterruptionReason;
use ai_tutor_runtime::whiteboard::{
    persisted_whiteboard_state_from_runtime, runtime_whiteboard_state_from_persisted,
    whiteboard_action_from_runtime_parts, whiteboard_state_from_ledger, WhiteboardState,
};

use crate::workflow::{Node, Workflow};

// ── Shared workflow state ───────────────────────────────────────────────

/// Mutable state threaded through every node in the chat workflow.
pub struct ChatGraphState {
    /// The original request payload (immutable reference data).
    pub payload: StatelessChatRequest,
    /// Evolving director state tracking turns and agent history.
    pub director_state: DirectorState,
    /// Events accumulated during execution (returned to the caller).
    pub events: Vec<ChatGraphEvent>,
    /// The user's latest message extracted once at the start.
    pub user_message: String,
    /// Max agent turns allowed for this request.
    pub max_turns: usize,
    /// How many turns have been completed so far.
    pub turns_completed: usize,
    /// Routing decision set by the TutorNode after each generation.
    pub outcome: ChatGraphOutcome,
    /// LLM provider handle (shared across turns).
    pub llm: Arc<dyn LlmProvider>,
    /// Current provider/runtime health snapshot from the resilient provider layer.
    pub provider_runtime: Vec<ProviderRuntimeStatus>,
    /// Unique session identifier.
    pub session_id: String,
    /// Optional live event sink for stream-through execution.
    pub event_sender: Option<UnboundedSender<ChatGraphEvent>>,
    /// Backend-owned whiteboard runtime state for the live session.
    pub whiteboard_state: WhiteboardState,
    /// Optional cooperative cancellation token for in-flight streaming.
    pub cancellation_token: Option<CancellationToken>,
}

#[derive(Debug, Clone)]
pub struct ChatGraphEvent {
    pub kind: ChatGraphEventKind,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub action_name: Option<String>,
    pub action_params: Option<serde_json::Value>,
    pub content: Option<String>,
    pub message: Option<String>,
    pub director_state: Option<DirectorState>,
    pub whiteboard_state: Option<WhiteboardState>,
    pub interruption_reason: Option<RuntimeInterruptionReason>,
    pub resume_allowed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatGraphEventKind {
    Thinking,
    AgentSelected,
    TextDelta,
    ActionStarted,
    ActionProgress,
    ActionCompleted,
    Interrupted,
    CueUser,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatGraphOutcome {
    Continue,
    CueUser,
    End,
}

enum DirectorOverride {
    Select(SelectedAgent),
    End(String),
}

#[derive(Debug, Clone)]
pub struct SelectedAgent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub persona: String,
    pub reason: String,
}

fn emit_event(state: &mut ChatGraphState, event: ChatGraphEvent) {
    if let Some(sender) = &state.event_sender {
        let _ = sender.send(event.clone());
    }
    state.events.push(event);
}

// ── Director Node ───────────────────────────────────────────────────────
// Two-tier routing strategy matching OpenMAIC's director-graph.ts:
//   Single agent (≤1 candidate): Pure code logic, zero LLM calls.
//   Multi agent  (>1 candidate): LLM-based decision with code fast-paths
//     for turn 0 trigger agent. Falls back to scoring heuristic on LLM error.

pub struct DirectorNode;

#[async_trait]
impl Node<ChatGraphState> for DirectorNode {
    async fn execute(&self, state: &mut ChatGraphState) -> Result<()> {
        let mut working = state.payload.clone();
        working.director_state = Some(state.director_state.clone());

        let candidates = collect_candidates(&working);
        let is_single_agent = candidates.len() <= 1;

        // ── Turn limit check (applies to both single & multi) ──
        if state.turns_completed >= state.max_turns {
            tracing::info!(
                turns = state.turns_completed,
                max = state.max_turns,
                "Director: turn limit reached, ending"
            );
            state.outcome = ChatGraphOutcome::End;
            return Ok(());
        }

        if let Some(override_decision) =
            deterministic_director_override(&state.user_message, &state.director_state, &candidates)
        {
            match override_decision {
                DirectorOverride::End(reason) => {
                    tracing::info!("Director deterministic override: ending round ({})", reason);
                    state.outcome = ChatGraphOutcome::End;
                    return Ok(());
                }
                DirectorOverride::Select(selected) => {
                    emit_event(
                        state,
                        ChatGraphEvent {
                            kind: ChatGraphEventKind::AgentSelected,
                            agent_id: Some(selected.id.clone()),
                            agent_name: Some(selected.name.clone()),
                            action_name: None,
                            action_params: None,
                            content: None,
                            message: Some(selected.reason.clone()),
                            director_state: None,
                            whiteboard_state: Some(state.whiteboard_state.clone()),
                            interruption_reason: None,
                            resume_allowed: None,
                        },
                    );

                    working
                        .messages
                        .push(ai_tutor_domain::runtime::ChatMessage {
                            id: format!("director-selection-{}", state.turns_completed),
                            role: "system_director_selection".to_string(),
                            content: serde_json::to_string(&serde_json::json!({
                                "id": selected.id,
                                "name": selected.name,
                                "role": selected.role,
                                "persona": selected.persona,
                                "reason": selected.reason,
                            }))
                            .unwrap_or_default(),
                            metadata: None,
                        });

                    state.payload = working;
                    return Ok(());
                }
            }
        }

        let selected = if is_single_agent {
            // ── Single agent: code-only director ──
            let prior_turn_count = state.director_state.turn_count;

            if prior_turn_count == 0 {
                // First turn: dispatch the agent
                let agent = resolve_selected_agent(&working, &state.provider_runtime);
                tracing::info!(
                    agent_id = %agent.id,
                    "Director: single agent, dispatching"
                );
                agent
            } else {
                // Agent already responded: cue user for follow-up
                let last = state
                    .director_state
                    .agent_responses
                    .last()
                    .map(|r| r.agent_id.clone())
                    .unwrap_or_else(|| "default-1".to_string());
                tracing::info!(
                    last_agent = %last,
                    "Director: single agent, cueing user after response"
                );
                state.outcome = ChatGraphOutcome::CueUser;

                emit_event(
                    state,
                    ChatGraphEvent {
                        kind: ChatGraphEventKind::CueUser,
                        agent_id: Some(last.clone()),
                        agent_name: None,
                        action_name: None,
                        action_params: None,
                        content: None,
                        message: Some("Ready for your response.".to_string()),
                        director_state: None,
                        whiteboard_state: Some(state.whiteboard_state.clone()),
                        interruption_reason: None,
                        resume_allowed: None,
                    },
                );
                return Ok(());
            }
        } else {
            // ── Multi agent: fast-path for first turn with trigger ──
            let prior_turn_count = state.director_state.turn_count;

            if prior_turn_count == 0 {
                if let Some(trigger_id) = working.config.trigger_agent_id.as_ref() {
                    if let Some(agent) = candidates.iter().find(|a| &a.id == trigger_id) {
                        tracing::info!(
                            trigger_id = %trigger_id,
                            "Director: first turn, dispatching trigger agent (skip LLM)"
                        );
                        SelectedAgent {
                            id: agent.id.clone(),
                            name: agent.name.clone(),
                            role: agent.role.clone(),
                            persona: agent.persona.clone(),
                            reason: format!(
                                "Director dispatched {} as the trigger agent for the opening turn.",
                                agent.name
                            ),
                        }
                    } else {
                        // Trigger agent not in candidates, fall through to LLM
                        try_llm_director_or_fallback(state, &working).await?
                    }
                } else {
                    // No trigger agent, use LLM
                    try_llm_director_or_fallback(state, &working).await?
                }
            } else {
                // ── Multi agent: LLM-based decision ──
                try_llm_director_or_fallback(state, &working).await?
            }
        };

        // Emit the agent_selected event
        emit_event(
            state,
            ChatGraphEvent {
                kind: ChatGraphEventKind::AgentSelected,
                agent_id: Some(selected.id.clone()),
                agent_name: Some(selected.name.clone()),
                action_name: None,
                action_params: None,
                content: None,
                message: Some(selected.reason.clone()),
                director_state: None,
                whiteboard_state: Some(state.whiteboard_state.clone()),
                interruption_reason: None,
                resume_allowed: None,
            },
        );

        // Stash the selected agent in the payload for TutorNode
        working
            .messages
            .push(ai_tutor_domain::runtime::ChatMessage {
                id: format!("director-selection-{}", state.turns_completed),
                role: "system_director_selection".to_string(),
                content: serde_json::to_string(&serde_json::json!({
                    "id": selected.id,
                    "name": selected.name,
                    "role": selected.role,
                    "persona": selected.persona,
                    "reason": selected.reason,
                }))
                .unwrap_or_default(),
                metadata: None,
            });

        state.payload = working;
        Ok(())
    }
}

/// Try LLM-based director decision. On failure, fall back to scoring heuristic.
async fn try_llm_director_or_fallback(
    state: &mut ChatGraphState,
    payload: &StatelessChatRequest,
) -> Result<SelectedAgent> {
    use crate::director_prompt::{
        build_director_prompt, parse_director_decision, summarize_conversation,
    };

    let candidates = collect_candidates(payload);

    // Build the director prompt (matching OpenMAIC's buildDirectorPrompt)
    let agent_configs = &payload.config.agent_configs;
    let agent_responses = &state.director_state.agent_responses;
    let turn_count = state.director_state.turn_count;
    let whiteboard_ledger = &state.director_state.whiteboard_ledger;
    let whiteboard_open = payload.store_state.whiteboard_open;

    let discussion_context = payload
        .config
        .discussion_topic
        .as_ref()
        .map(|topic| (topic.as_str(), payload.config.discussion_prompt.as_deref()));

    let trigger_agent_id = payload.config.trigger_agent_id.as_deref();
    let user_profile = payload
        .user_profile
        .as_ref()
        .and_then(|p| p.nickname.as_ref().map(|n| (n.as_str(), p.bio.as_deref())));

    let conversation_summary = summarize_conversation(payload);

    let director_system_prompt = build_director_prompt(
        agent_configs,
        agent_responses,
        turn_count,
        discussion_context,
        trigger_agent_id,
        whiteboard_ledger,
        user_profile,
        whiteboard_open,
        &conversation_summary,
        &state.provider_runtime,
    );

    let director_user_prompt = "Decide which agent should speak next.";

    // Call LLM for director decision
    match state
        .llm
        .generate_text(&director_system_prompt, director_user_prompt)
        .await
    {
        Ok(llm_response) => {
            tracing::info!(
                raw_decision = %llm_response,
                "Director LLM decision received"
            );
            let decision = parse_director_decision(&llm_response);

            if decision.should_end && decision.next_agent_id.is_none() {
                // LLM says END
                state.outcome = ChatGraphOutcome::End;
                return Ok(SelectedAgent {
                    id: "END".to_string(),
                    name: "END".to_string(),
                    role: "".to_string(),
                    persona: "".to_string(),
                    reason: "Director LLM decided to end the round.".to_string(),
                });
            }

            if let Some(ref agent_id) = decision.next_agent_id {
                if agent_id == "USER" {
                    // Cue user
                    state.outcome = ChatGraphOutcome::CueUser;
                    let last_agent = state
                        .director_state
                        .agent_responses
                        .last()
                        .map(|r| r.agent_id.clone())
                        .unwrap_or_default();

                    emit_event(
                        state,
                        ChatGraphEvent {
                            kind: ChatGraphEventKind::CueUser,
                            agent_id: Some(last_agent),
                            agent_name: None,
                            action_name: None,
                            action_params: None,
                            content: None,
                            message: Some("The director is cueing you to speak.".to_string()),
                            director_state: None,
                            whiteboard_state: Some(state.whiteboard_state.clone()),
                            interruption_reason: None,
                            resume_allowed: None,
                        },
                    );

                    return Ok(SelectedAgent {
                        id: "USER".to_string(),
                        name: "USER".to_string(),
                        role: "".to_string(),
                        persona: "".to_string(),
                        reason: "Director LLM decided to cue the user.".to_string(),
                    });
                }

                // Find the agent in candidates
                if let Some(agent) = candidates.iter().find(|a| a.id == *agent_id) {
                    return Ok(SelectedAgent {
                        id: agent.id.clone(),
                        name: agent.name.clone(),
                        role: agent.role.clone(),
                        persona: agent.persona.clone(),
                        reason: format!("Director LLM selected {} for this turn.", agent.name),
                    });
                }

                tracing::warn!(
                    agent_id = %agent_id,
                    "Director LLM selected unknown agent, falling back to heuristic"
                );
            }

            // Fall through to heuristic
            Ok(resolve_selected_agent(payload, &state.provider_runtime))
        }
        Err(e) => {
            // LLM call failed — graceful degradation to scoring heuristic
            tracing::warn!(
                error = %e,
                "Director LLM call failed, falling back to scoring heuristic"
            );
            Ok(resolve_selected_agent(payload, &state.provider_runtime))
        }
    }
}

// ── Tutor Node ──────────────────────────────────────────────────────────
// Generates a response using the LLM provider for the selected agent,
// chunks the output into TextDelta events, updates director state, and
// evaluates the session outcome to decide the next routing edge.

pub struct TutorNode;

#[async_trait]
impl Node<ChatGraphState> for TutorNode {
    async fn execute(&self, state: &mut ChatGraphState) -> Result<()> {
        // Newer payloads include a persisted director-selection system message.
        // For older/patched client state, fall back to deterministic selection.
        let selected = if let Some(selection_msg) = state
            .payload
            .messages
            .iter()
            .rev()
            .find(|m| m.role == "system_director_selection")
        {
            let selection: serde_json::Value = serde_json::from_str(&selection_msg.content)?;
            SelectedAgent {
                id: selection["id"].as_str().unwrap_or("assistant").to_string(),
                name: selection["name"].as_str().unwrap_or("AI Tutor").to_string(),
                role: selection["role"].as_str().unwrap_or("teacher").to_string(),
                persona: selection["persona"]
                    .as_str()
                    .unwrap_or("Helpful tutor")
                    .to_string(),
                reason: selection["reason"].as_str().unwrap_or("").to_string(),
            }
        } else {
            tracing::debug!(
                "Director selection message missing; falling back to heuristic selection"
            );
            resolve_selected_agent(&state.payload, &state.provider_runtime)
        };

        // Extract allowed actions from the matching agent config
        let selected_config_allowed_actions: Vec<String> = state
            .payload
            .config
            .agent_configs
            .iter()
            .find(|c| c.id == selected.id)
            .map(|c| c.allowed_actions.clone())
            .unwrap_or_default();

        // Build prompts
        let stream_messages = build_stream_messages(&state.payload, &selected, &state.user_message);

        let scene_type = state
            .payload
            .store_state
            .current_scene_id
            .as_deref()
            .map(|_| {
                state
                    .payload
                    .store_state
                    .stage
                    .as_ref()
                    .map(|_| "slide")
                    .unwrap_or("slide")
            });

        // Generate via the typed streaming seam translated from OpenMAIC's
        // `StreamChunk` contract. Text still falls back through the parser for
        // models that only emit structured JSON in plain deltas, while native
        // tool/action events can bypass reconstruction entirely.
        let mut parser_state = crate::response_parser::create_stream_parser_state();
        let mut streamed_text_segments: Vec<String> = Vec::new();
        let mut streamed_actions: Vec<crate::response_parser::ParsedAction> = Vec::new();
        let mut streamed_events: Vec<ChatGraphEvent> = Vec::new();
        let live_sender = state.event_sender.clone();
        let selected_id = selected.id.clone();
        let selected_name = selected.name.clone();
        let mut live_whiteboard_state = state.whiteboard_state.clone();
        let generated = match state.cancellation_token.as_ref() {
            Some(token) => {
                state
                    .llm
                    .generate_stream_events_with_history_cancellable(
                        &stream_messages,
                        token,
                        &mut |event| {
                            process_provider_stream_event(
                                event,
                                &mut parser_state,
                                &mut streamed_text_segments,
                                &mut streamed_actions,
                                &mut streamed_events,
                                &live_sender,
                                &selected_id,
                                &selected_name,
                                scene_type,
                                &selected_config_allowed_actions,
                                &mut live_whiteboard_state,
                            );
                        },
                    )
                    .await?
            }
            None => {
                state
                    .llm
                    .generate_stream_events_with_history(&stream_messages, &mut |event| {
                        process_provider_stream_event(
                            event,
                            &mut parser_state,
                            &mut streamed_text_segments,
                            &mut streamed_actions,
                            &mut streamed_events,
                            &live_sender,
                            &selected_id,
                            &selected_name,
                            scene_type,
                            &selected_config_allowed_actions,
                            &mut live_whiteboard_state,
                        );
                    })
                    .await?
            }
        };
        state.provider_runtime = state.llm.runtime_status();
        if uses_compatibility_streaming(&state.provider_runtime) {
            let compatibility_labels: Vec<String> = state
                .provider_runtime
                .iter()
                .filter(|status| status.streaming_path == StreamingPath::Compatibility)
                .map(|status| status.label.clone())
                .collect();
            tracing::warn!(
                labels = %compatibility_labels.join(","),
                "Tutor runtime streaming used compatibility chunking path"
            );
        }

        let final_parsed = crate::response_parser::finalize_stream_parser(&mut parser_state);
        for emission in final_parsed.emissions {
            match emission {
                crate::response_parser::StreamEmission::Text(text) => {
                    if !text.trim().is_empty() {
                        streamed_text_segments.push(text.clone());
                        let event = ChatGraphEvent {
                            kind: ChatGraphEventKind::TextDelta,
                            agent_id: Some(selected.id.clone()),
                            agent_name: Some(selected.name.clone()),
                            action_name: None,
                            action_params: None,
                            content: Some(text),
                            message: None,
                            director_state: None,
                            whiteboard_state: Some(live_whiteboard_state.clone()),
                            interruption_reason: None,
                            resume_allowed: None,
                        };
                        push_streamed_event(&live_sender, &mut streamed_events, event);
                    }
                }
                crate::response_parser::StreamEmission::Action(action) => {
                    let final_validated_actions = crate::response_parser::validate_actions(
                        vec![action],
                        scene_type,
                        &selected_config_allowed_actions,
                    );
                    for action in final_validated_actions {
                        if !push_unique_action(&mut streamed_actions, &action) {
                            continue;
                        }
                        emit_action_lifecycle(
                            &action,
                            "parsed model output",
                            &live_sender,
                            &mut streamed_events,
                            &selected.id,
                            &selected.name,
                            &mut live_whiteboard_state,
                        );
                    }
                }
            }
        }
        state.whiteboard_state = live_whiteboard_state;
        state.events.extend(streamed_events);

        // Build whiteboard action records for ledger tracking
        // Matches OpenMAIC's stateless-generate.ts:372-379
        let mut wb_actions: Vec<WhiteboardActionRecord> = Vec::new();
        for action in &streamed_actions {
            if action.action_name.starts_with("wb_") {
                wb_actions.push(WhiteboardActionRecord {
                    action_name: action.action_name.clone(),
                    agent_id: selected.id.clone(),
                    agent_name: selected.name.clone(),
                    params: action.params.clone(),
                });
            }
        }

        // Build content preview from text only (not JSON brackets)
        let content_preview: String = streamed_text_segments
            .iter()
            .flat_map(|s| s.chars())
            .take(120)
            .collect();

        // Update director state with accurate counts
        state.director_state.turn_count += 1;
        state.director_state.agent_responses.push(AgentTurnSummary {
            agent_id: selected.id.clone(),
            agent_name: selected.name.clone(),
            content_preview,
            action_count: streamed_actions.len() as i32,
            whiteboard_actions: wb_actions.clone(),
        });

        // Append wb actions to the persistent whiteboard ledger
        // Matches OpenMAIC's stateless-generate.ts:405
        state.director_state.whiteboard_ledger.extend(wb_actions);
        state.director_state.whiteboard_state = Some(persisted_whiteboard_state_from_runtime(
            &state.whiteboard_state,
        ));
        state.turns_completed += 1;

        // Evaluate outcome for conditional routing
        let outcome = next_session_outcome(&state.payload, state.max_turns, state.turns_completed);
        state.outcome = outcome;

        tracing::debug!(
            generated_len = generated.len(),
            text_segments = streamed_text_segments.len(),
            actions = streamed_actions.len(),
            "Tutor runtime completed streamed structured generation"
        );

        if outcome == ChatGraphOutcome::CueUser {
            let topic = state
                .payload
                .config
                .discussion_topic
                .as_deref()
                .unwrap_or("this lesson");
            emit_event(state, ChatGraphEvent {
                kind: ChatGraphEventKind::CueUser,
                agent_id: Some(selected.id.clone()),
                agent_name: Some(selected.name.clone()),
                action_name: None,
                action_params: None,
                content: None,
                message: Some(format!(
                    "{} is ready for your response. Ask a follow-up, answer their prompt, or guide the discussion on {}.",
                    selected.name, topic
                )),
                director_state: None,
                whiteboard_state: Some(state.whiteboard_state.clone()),
                interruption_reason: None,
                resume_allowed: None,
            });
        }

        // Remove the director selection sentinel so it doesn't leak into next turn
        state
            .payload
            .messages
            .retain(|m| m.role != "system_director_selection");

        Ok(())
    }
}

// ── Workflow builder ────────────────────────────────────────────────────

/// Build the stateless chat graph:
///   DirectorNode → TutorNode → conditional(Continue → DirectorNode, else → END)
pub fn build_chat_graph() -> Workflow<ChatGraphState> {
    let mut graph = Workflow::new("director");

    graph.add_node("director", Box::new(DirectorNode));
    graph.add_node("tutor", Box::new(TutorNode));

    // Director always flows to Tutor
    graph.add_edge("director", "tutor");

    // Tutor conditionally routes back to Director (Continue) or exits
    graph.add_conditional_edges("tutor", |state: &ChatGraphState| match state.outcome {
        ChatGraphOutcome::Continue => "director".to_string(),
        ChatGraphOutcome::CueUser | ChatGraphOutcome::End => "END".to_string(),
    });

    graph
}

/// Execute the full stateless chat workflow and return the accumulated events.
async fn run_chat_graph_internal(
    payload: StatelessChatRequest,
    llm: Arc<dyn LlmProvider>,
    session_id: String,
    event_sender: Option<UnboundedSender<ChatGraphEvent>>,
    cancellation_token: Option<CancellationToken>,
) -> Result<Vec<ChatGraphEvent>> {
    let user_message = payload
        .messages
        .iter()
        .rev()
        .find(|m| m.role.eq_ignore_ascii_case("user"))
        .map(|m| m.content.clone())
        .unwrap_or_else(|| "Continue the lesson naturally.".to_string());

    let provider_runtime = llm.runtime_status();
    // OpenMAIC reference:
    // - lib/orchestration/ai-sdk-adapter.ts streams via streamLLM on the live path.
    // AI-Tutor parity guard:
    // - when enabled globally OR matched by selector labels, reject runtime calls
    //   unless provider runtime reports native streaming.
    if (runtime_requires_native_streaming_for(&provider_runtime)
        && !native_streaming_is_ready(&provider_runtime))
        || (runtime_requires_native_typed_streaming()
            && !native_typed_streaming_is_ready(&provider_runtime))
    {
        let labels = compatibility_streaming_labels(&provider_runtime);
        anyhow::bail!(
            "runtime requires provider-native streaming, but provider capabilities are insufficient (labels={})",
            if labels.is_empty() {
                "unknown".to_string()
            } else {
                labels.join(",")
            }
        );
    }
    let mut max_turns = max_agent_turns(&payload, &provider_runtime);
    if payload
        .director_state
        .as_ref()
        .is_some_and(|state| state.turn_count > 0)
    {
        // Resume requests should stay bounded to one fresh agent turn.
        // This mirrors OpenMAIC's turn-budget behavior for follow-up calls.
        max_turns = 1;
    }
    let director_state = payload.director_state.clone().unwrap_or(DirectorState {
        turn_count: 0,
        agent_responses: vec![],
        whiteboard_ledger: vec![],
        whiteboard_state: None,
    });
    // OpenMAIC parity intention:
    // whiteboard should follow ordered action truth first. Snapshot is a fast
    // resume aid, but ledger remains the deterministic source when present.
    let mut whiteboard_state = if director_state.whiteboard_ledger.is_empty() {
        director_state
            .whiteboard_state
            .as_ref()
            .map(runtime_whiteboard_state_from_persisted)
            .unwrap_or_else(|| WhiteboardState::new(format!("session-{}", session_id)))
    } else {
        whiteboard_state_from_ledger(
            format!("session-{}", session_id),
            &director_state.whiteboard_ledger,
        )
    };
    if payload.store_state.whiteboard_open {
        whiteboard_state.is_open = true;
    }

    let mut state = ChatGraphState {
        payload,
        director_state,
        events: Vec::new(),
        user_message,
        max_turns,
        turns_completed: 0,
        outcome: ChatGraphOutcome::Continue,
        llm,
        provider_runtime,
        session_id,
        event_sender,
        whiteboard_state,
        cancellation_token,
    };
    let pedagogy_route = resolve_chat_pedagogy_route(&state.payload, state.payload.model.as_deref())?;
    let thinking_message = thinking_message_for_chat(&pedagogy_route);
    let thinking_model = pedagogy_route.model.clone();
    let whiteboard_snapshot = state.whiteboard_state.clone();
    emit_event(
        &mut state,
        ChatGraphEvent {
            kind: ChatGraphEventKind::Thinking,
            agent_id: None,
            agent_name: None,
            action_name: None,
            action_params: None,
            content: None,
            message: Some(format!("{} (model: {})", thinking_message, thinking_model)),
            director_state: None,
            whiteboard_state: Some(whiteboard_snapshot),
            interruption_reason: None,
            resume_allowed: None,
        },
    );

    let graph = build_chat_graph();
    if let Err(error) = graph.execute(&mut state).await {
        let was_cancelled = cancellation_requested(&state, &error);
        if was_cancelled {
            state.director_state.whiteboard_state = Some(persisted_whiteboard_state_from_runtime(
                &state.whiteboard_state,
            ));
            let interrupted_agent_id = state
                .director_state
                .agent_responses
                .last()
                .map(|summary| summary.agent_id.clone());
            let interrupted_agent_name = state
                .director_state
                .agent_responses
                .last()
                .map(|summary| summary.agent_name.clone());
            let interrupted_director_state = state.director_state.clone();
            let interrupted_whiteboard_state = state.whiteboard_state.clone();
            emit_event(
                &mut state,
                ChatGraphEvent {
                    kind: ChatGraphEventKind::Interrupted,
                    agent_id: interrupted_agent_id,
                    agent_name: interrupted_agent_name,
                    action_name: None,
                    action_params: None,
                    content: None,
                    message: Some("Tutor generation interrupted before the turn completed.".to_string()),
                    director_state: Some(interrupted_director_state),
                    whiteboard_state: Some(interrupted_whiteboard_state),
                    interruption_reason: Some(RuntimeInterruptionReason::ProviderCancelled),
                    resume_allowed: Some(true),
                },
            );
            return Ok(state.events);
        }
        return Err(error);
    }

    let last_agent_id = state
        .director_state
        .agent_responses
        .last()
        .map(|s| s.agent_id.clone());
    let last_agent_name = state
        .director_state
        .agent_responses
        .last()
        .map(|s| s.agent_name.clone());
    let done_message = format!(
        "Tutor session complete after {} turn(s)",
        state.turns_completed
    );
    let final_director_state = state.director_state.clone();
    let final_whiteboard_state = state.whiteboard_state.clone();

    // Append the final Done event
    emit_event(
        &mut state,
        ChatGraphEvent {
            kind: ChatGraphEventKind::Done,
            agent_id: last_agent_id,
            agent_name: last_agent_name,
            action_name: None,
            action_params: None,
            content: None,
            message: Some(done_message),
            director_state: Some(final_director_state),
            whiteboard_state: Some(final_whiteboard_state),
            interruption_reason: None,
            resume_allowed: Some(false),
        },
    );

    Ok(state.events)
}

pub async fn run_chat_graph(
    payload: StatelessChatRequest,
    llm: Arc<dyn LlmProvider>,
    session_id: String,
) -> Result<Vec<ChatGraphEvent>> {
    run_chat_graph_internal(payload, llm, session_id, None, None).await
}

pub async fn run_chat_graph_stream(
    payload: StatelessChatRequest,
    llm: Arc<dyn LlmProvider>,
    session_id: String,
    event_sender: UnboundedSender<ChatGraphEvent>,
    cancellation_token: Option<CancellationToken>,
) -> Result<Vec<ChatGraphEvent>> {
    run_chat_graph_internal(
        payload,
        llm,
        session_id,
        Some(event_sender),
        cancellation_token,
    )
    .await
}

fn cancellation_requested(state: &ChatGraphState, error: &anyhow::Error) -> bool {
    state
        .cancellation_token
        .as_ref()
        .is_some_and(|token| token.is_cancelled())
        || error.to_string().contains("stream cancelled")
}

// ── Helper functions (ported from app.rs) ───────────────────────────────

#[derive(Debug, Clone)]
struct CandidateAgent {
    id: String,
    name: String,
    role: String,
    persona: String,
    priority: i32,
    bound_stage_id: Option<String>,
}

fn collect_candidates(payload: &StatelessChatRequest) -> Vec<CandidateAgent> {
    if !payload.config.agent_configs.is_empty() {
        return payload
            .config
            .agent_configs
            .iter()
            .filter(|a| !a.id.trim().is_empty())
            .map(|a| CandidateAgent {
                id: a.id.clone(),
                name: a.name.clone(),
                role: a.role.clone(),
                persona: a.persona.clone(),
                priority: a.priority,
                bound_stage_id: a.bound_stage_id.clone(),
            })
            .collect();
    }

    if !payload.config.agent_ids.is_empty() {
        return payload
            .config
            .agent_ids
            .iter()
            .filter(|id| id.eq_ignore_ascii_case("default-1") || id.to_ascii_lowercase().contains("teacher"))
            .map(|id| CandidateAgent {
                id: id.clone(),
                name: id.clone(),
                role: "teacher".to_string(),
                persona: "Helpful classroom participant".to_string(),
                priority: 10,
                bound_stage_id: None,
            })
            .collect();
    }

    vec![]
}

fn resolve_selected_agent(
    payload: &StatelessChatRequest,
    provider_runtime: &[ProviderRuntimeStatus],
) -> SelectedAgent {
    let candidates = collect_candidates(payload);
    if candidates.is_empty() {
        return SelectedAgent {
            id: "default-1".to_string(),
            name: "AI Tutor".to_string(),
            role: "teacher".to_string(),
            persona: "Supportive classroom tutor".to_string(),
            reason: "No configured agents were available, so the default tutor handled the turn."
                .to_string(),
        };
    }

    let prior_turn_count = payload
        .director_state
        .as_ref()
        .map(|s| s.turn_count)
        .unwrap_or(0);

    if prior_turn_count == 0 {
        if let Some(trigger_id) = payload.config.trigger_agent_id.as_ref() {
            if let Some(agent) = candidates.iter().find(|a| &a.id == trigger_id) {
                return SelectedAgent {
                    id: agent.id.clone(),
                    name: agent.name.clone(),
                    role: agent.role.clone(),
                    persona: agent.persona.clone(),
                    reason: format!(
                        "Director routed the opening turn to {} because it is the configured trigger agent.",
                        agent.name
                    ),
                };
            }
        }
    }

    let last_agent_id = payload
        .director_state
        .as_ref()
        .and_then(|s| s.agent_responses.last())
        .map(|s| s.agent_id.clone());

    let last_agent_role = payload
        .director_state
        .as_ref()
        .and_then(|s| s.agent_responses.last())
        .map(|s| {
            payload
                .config
                .agent_configs
                .iter()
                .find(|a| a.id == s.agent_id)
                .map(|a| a.role.clone())
                .unwrap_or_else(|| "teacher".to_string())
        });

    let current_stage_id = payload
        .store_state
        .current_scene_id
        .as_ref()
        .and_then(|scene_id| {
            payload
                .store_state
                .scenes
                .iter()
                .find(|s| &s.id == scene_id)
                .map(|s| s.stage_id.clone())
        });

    let provider_degraded = is_provider_runtime_degraded(provider_runtime);
    let provider_requires_conservative_turns =
        provider_runtime_requires_conservative_turns(provider_runtime);

    let mut filtered = candidates.clone();
    if filtered.len() > 1 {
        if let Some(last_id) = last_agent_id.as_ref() {
            filtered.retain(|a| &a.id != last_id);
        }
    }

    let discussion_hint = payload
        .config
        .discussion_prompt
        .as_deref()
        .or(payload.config.discussion_topic.as_deref())
        .unwrap_or_default();
    let latest_msg = payload
        .messages
        .iter()
        .rev()
        .find(|m| m.role.eq_ignore_ascii_case("user"))
        .map(|m| m.content.as_str())
        .unwrap_or_default();
    let latest_msg_normalized = latest_msg.to_ascii_lowercase();
    let user_needs_explanation = contains_any_keyword(
        &latest_msg_normalized,
        &[
            "why",
            "how",
            "explain",
            "clarify",
            "confused",
            "don't understand",
            "dont understand",
            "step by step",
            "?",
        ],
    );
    let current_scene_content = payload
        .store_state
        .current_scene_id
        .as_ref()
        .and_then(|scene_id| payload.store_state.scenes.iter().find(|scene| &scene.id == scene_id))
        .map(|scene| &scene.content);

    if matches!(
        current_scene_content,
        Some(ai_tutor_domain::scene::SceneContent::Project { .. })
    ) {
        if let Some(stage_id) = current_stage_id.as_ref() {
            let has_stage_bound_candidates = filtered
                .iter()
                .any(|agent| agent.bound_stage_id.as_ref() == Some(stage_id));
            if has_stage_bound_candidates {
                filtered.retain(|agent| agent.bound_stage_id.as_ref() == Some(stage_id));
            }
        }
    }

    let mut scored: Vec<(i32, Vec<String>, CandidateAgent)> = filtered
        .iter()
        .map(|agent| {
            let mut score = 0_i32;
            let mut reasons = Vec::new();

            if let Some(stage_id) = current_stage_id.as_ref() {
                if agent.bound_stage_id.as_ref() == Some(stage_id) {
                    score += 40;
                    reasons.push("it is bound to the active stage".to_string());
                }
            }

            if let Some(scene_content) = current_scene_content {
                match scene_content {
                    ai_tutor_domain::scene::SceneContent::Quiz { .. } => {
                        if agent.role.eq_ignore_ascii_case("teacher") {
                            score += 16;
                            reasons.push(
                                "quiz scenes benefit from teacher-led reasoning checks"
                                    .to_string(),
                            );
                        }
                    }
                    ai_tutor_domain::scene::SceneContent::Interactive { .. } => {
                        if agent.role.eq_ignore_ascii_case("teacher") {
                            score += 12;
                            reasons.push(
                                "interactive scenes benefit from guided teacher facilitation"
                                    .to_string(),
                            );
                        }
                    }
                    ai_tutor_domain::scene::SceneContent::Project { .. } => {
                        if agent.role.eq_ignore_ascii_case("teacher") {
                            score += 10;
                        }
                        if agent.bound_stage_id.as_ref() == current_stage_id.as_ref() {
                            score += 14;
                            reasons.push(
                                "project scenes benefit from the agent tied to the active stage"
                                    .to_string(),
                            );
                        }
                    }
                    ai_tutor_domain::scene::SceneContent::Slide { .. } => {}
                }
            }

            match last_agent_role.as_deref() {
                Some("teacher") => {
                    score += 12;
                }
                _ => {
                    if agent.role.eq_ignore_ascii_case("teacher") {
                        score += 24;
                    }
                }
            }

            if provider_degraded && agent.role.eq_ignore_ascii_case("teacher") {
                score += 14;
                reasons.push(
                    "runtime health is degraded, so a teacher-led response is safer".to_string(),
                );
            }

            if provider_requires_conservative_turns
                && !provider_degraded
                && agent.role.eq_ignore_ascii_case("teacher")
            {
                score += 10;
                reasons.push(
                    "current provider streaming conditions favor a concise teacher-led turn"
                        .to_string(),
                );
            }

            if user_needs_explanation && agent.role.eq_ignore_ascii_case("teacher") {
                score += 18;
                reasons.push(
                    "the learner message asks for explanation, so teacher clarity is preferred"
                        .to_string(),
                );
            }

            // Keyword relevance
            let haystack = format!(
                "{} {} {}",
                agent.name.to_lowercase(),
                agent.role.to_lowercase(),
                agent.persona.to_lowercase()
            );
            let query = format!("{} {}", discussion_hint, latest_msg).to_lowercase();
            let mut keyword_score = 0;
            for kw in query
                .split(|c: char| !c.is_alphanumeric())
                .filter(|t| t.len() >= 4)
            {
                if haystack.contains(kw) {
                    keyword_score += 6;
                }
            }
            keyword_score = keyword_score.min(18);
            if keyword_score > 0 {
                score += keyword_score;
                reasons.push("its role or persona matches the current topic".to_string());
            }

            let normalized_priority = agent.priority.max(0);
            score += 20 - normalized_priority.min(20);
            reasons.push(format!(
                "its priority {} supports earlier routing",
                agent.priority
            ));

            (score, reasons, agent.clone())
        })
        .collect();

    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.2.priority.cmp(&b.2.priority))
            .then_with(|| a.2.name.cmp(&b.2.name))
    });

    let (_, reasons, winner) = scored.into_iter().next().expect("at least one candidate");
    let winner_name = winner.name.clone();

    SelectedAgent {
        id: winner.id,
        name: winner.name,
        role: winner.role,
        persona: winner.persona,
        reason: format!(
            "Director selected {} because {}.",
            winner_name,
            reasons.join(", ")
        ),
    }
}

fn max_agent_turns(
    payload: &StatelessChatRequest,
    provider_runtime: &[ProviderRuntimeStatus],
) -> usize {
    let candidate_count = collect_candidates(payload).len();
    let session_type = payload
        .config
        .session_type
        .as_deref()
        .unwrap_or("discussion")
        .to_ascii_lowercase();

    if candidate_count <= 1 {
        return 1;
    }
    if degraded_runtime_single_turn_only() && provider_runtime_requires_conservative_turns(provider_runtime) {
        return 1;
    }
    if session_type == "discussion" {
        return 2;
    }
    1
}

fn is_provider_runtime_degraded(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    if provider_runtime.is_empty() {
        return false;
    }

    let unavailable_count = provider_runtime
        .iter()
        .filter(|status| !status.available)
        .count();
    let failure_count = provider_runtime
        .iter()
        .filter(|status| status.consecutive_failures > 0)
        .count();

    unavailable_count > 0 || failure_count > 0
}

fn has_native_typed_streaming(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    !provider_runtime.is_empty()
        && provider_runtime
            .iter()
            .all(|status| status.capabilities.native_typed_streaming)
}

fn provider_runtime_has_high_latency(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    let threshold = runtime_high_latency_threshold_ms();
    provider_runtime.iter().any(|status| {
        status
            .last_latency_ms
            .or(status.average_latency_ms)
            .is_some_and(|latency| latency >= threshold)
    })
}

fn provider_runtime_requires_conservative_turns(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    is_provider_runtime_degraded(provider_runtime)
        || uses_compatibility_streaming(provider_runtime)
        || !has_native_typed_streaming(provider_runtime)
        || provider_runtime_has_high_latency(provider_runtime)
}

fn uses_compatibility_streaming(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    provider_runtime
        .iter()
        .any(|status| status.streaming_path == StreamingPath::Compatibility)
}

fn compatibility_streaming_labels(provider_runtime: &[ProviderRuntimeStatus]) -> Vec<String> {
    provider_runtime
        .iter()
        .filter(|status| status.streaming_path == StreamingPath::Compatibility)
        .map(|status| status.label.clone())
        .collect()
}

fn native_streaming_is_ready(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    if provider_runtime.is_empty() {
        return false;
    }
    provider_runtime
        .iter()
        .all(|status| status.streaming_path == StreamingPath::Native)
}

fn native_typed_streaming_is_ready(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    if provider_runtime.is_empty() {
        return false;
    }
    provider_runtime
        .iter()
        .all(|status| status.capabilities.native_typed_streaming)
}

fn runtime_requires_native_streaming() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn runtime_requires_native_typed_streaming() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_TYPED_STREAMING") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn degraded_runtime_single_turn_only() -> bool {
    match std::env::var("AI_TUTOR_RUNTIME_DEGRADED_SINGLE_TURN_ONLY") {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => true,
    }
}

fn runtime_high_latency_threshold_ms() -> u64 {
    std::env::var("AI_TUTOR_RUNTIME_HIGH_LATENCY_THRESHOLD_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(7_000)
}

fn runtime_native_streaming_selectors() -> Vec<String> {
    std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(|segment| segment.trim().to_ascii_lowercase())
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn runtime_requires_native_streaming_for(provider_runtime: &[ProviderRuntimeStatus]) -> bool {
    if runtime_requires_native_streaming() {
        return true;
    }

    let selectors = runtime_native_streaming_selectors();
    if selectors.is_empty() {
        return false;
    }

    provider_runtime.iter().any(|status| {
        let label = status.label.to_ascii_lowercase();
        selectors
            .iter()
            .any(|selector| label == *selector || label.contains(selector))
    })
}

fn next_session_outcome(
    payload: &StatelessChatRequest,
    max_turns: usize,
    turns_completed: usize,
) -> ChatGraphOutcome {
    if turns_completed >= max_turns {
        let session_type = payload
            .config
            .session_type
            .as_deref()
            .unwrap_or("discussion")
            .to_ascii_lowercase();
        return if session_type == "discussion" && turns_completed >= 1 {
            ChatGraphOutcome::CueUser
        } else {
            ChatGraphOutcome::End
        };
    }

    if collect_candidates(payload).len() <= 1 {
        let session_type = payload
            .config
            .session_type
            .as_deref()
            .unwrap_or("discussion")
            .to_ascii_lowercase();
        return if session_type == "discussion" && turns_completed >= 1 {
            ChatGraphOutcome::CueUser
        } else {
            ChatGraphOutcome::End
        };
    }

    ChatGraphOutcome::Continue
}

fn deterministic_director_override(
    user_message: &str,
    director_state: &DirectorState,
    candidates: &[CandidateAgent],
) -> Option<DirectorOverride> {
    if candidates.is_empty() {
        return Some(DirectorOverride::End(
            "No candidate agents are available.".to_string(),
        ));
    }

    let normalized = user_message.to_ascii_lowercase();
    let has_end_signal =
        contains_any_keyword(
            &normalized,
            &[
                "that's all",
                "thats all",
                "no more questions",
                "goodbye",
                "bye",
                "stop now",
                "we can stop",
                "all good now",
            ],
        ) || (contains_any_keyword(&normalized, &["thanks", "thank you", "got it"])
            && !normalized.contains('?')
            && !contains_any_keyword(
                &normalized,
                &[
                    "but",
                    "also",
                    "can you",
                    "could you",
                    "please explain",
                    "what about",
                ],
            ));

    if has_end_signal && director_state.turn_count > 0 {
        return Some(DirectorOverride::End(
            "Learner signaled completion.".to_string(),
        ));
    }

    let has_interruption_signal = contains_any_keyword(
        &normalized,
        &[
            "don't understand",
            "dont understand",
            "i am confused",
            "im confused",
            "i'm confused",
            "stuck",
            "explain again",
            "re-explain",
            "step by step",
            "slower",
            "clarify",
            "help me",
        ],
    );

    if has_interruption_signal {
        let last_agent_id = director_state
            .agent_responses
            .last()
            .map(|response| response.agent_id.as_str());

        if let Some(teacher) = select_teacher_candidate(candidates, last_agent_id) {
            return Some(DirectorOverride::Select(SelectedAgent {
                id: teacher.id.clone(),
                name: teacher.name.clone(),
                role: teacher.role.clone(),
                persona: teacher.persona.clone(),
                reason: format!(
                    "Director prioritized {} because the learner asked for clarification/interruption handling.",
                    teacher.name
                ),
            }));
        }
    }

    None
}

fn select_teacher_candidate<'a>(
    candidates: &'a [CandidateAgent],
    last_agent_id: Option<&str>,
) -> Option<&'a CandidateAgent> {
    let mut teachers = candidates
        .iter()
        .filter(|agent| agent.role.eq_ignore_ascii_case("teacher"))
        .collect::<Vec<_>>();
    teachers.sort_by(|a, b| a.priority.cmp(&b.priority));

    if let Some(last_id) = last_agent_id {
        if let Some(next_teacher) = teachers.iter().find(|agent| agent.id != last_id) {
            return Some(*next_teacher);
        }
    }

    teachers.first().copied()
}

fn contains_any_keyword(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| text.contains(keyword))
}

fn build_system_prompt(payload: &StatelessChatRequest, selected: &SelectedAgent) -> String {
    crate::agent_prompt::build_structured_prompt(selected, payload)
}

fn build_user_prompt(payload: &StatelessChatRequest, latest_user_message: &str) -> String {
    let stage_context = payload
        .store_state
        .current_scene_id
        .clone()
        .unwrap_or_else(|| "no-current-scene".to_string());
    let current_turn = payload
        .director_state
        .as_ref()
        .map(|s| s.turn_count + 1)
        .unwrap_or(1);

    // Provide past history so the model knows what was said
    let mut history = String::new();
    for msg in payload.messages.iter().rev().take(10).rev() {
        history.push_str(&format!("[{}]: {}\n", msg.role, msg.content));
    }

    format!(
        "Current scene: {}. Whiteboard open: {}. Current director turn: {}.\n\n# Recent Conversation History:\n{}\n\nLatest learner message: {}",
        stage_context, payload.store_state.whiteboard_open, current_turn, history, latest_user_message
    )
}

fn build_stream_messages(
    payload: &StatelessChatRequest,
    selected: &SelectedAgent,
    latest_user_message: &str,
) -> Vec<(String, String)> {
    let mut messages = Vec::new();
    messages.push(("system".to_string(), build_system_prompt(payload, selected)));

    for message in payload.messages.iter().rev().take(12).rev() {
        let normalized_role = match message.role.as_str() {
            "user" => Some("user"),
            "assistant" | "teacher" | "student" | "friend" | "classmate" | "agent" => {
                Some("assistant")
            }
            "system_director_selection" => None,
            _ => None,
        };

        if let Some(role) = normalized_role {
            messages.push((role.to_string(), message.content.clone()));
        }
    }

    messages.push((
        "user".to_string(),
        build_user_prompt(payload, latest_user_message),
    ));
    messages
}

fn push_unique_action(
    target: &mut Vec<crate::response_parser::ParsedAction>,
    incoming: &crate::response_parser::ParsedAction,
) -> bool {
    let already_present = target.iter().any(|existing| {
        existing.action_name == incoming.action_name
            && canonical_runtime_action_params(&existing.action_name, &existing.params)
                == canonical_runtime_action_params(&incoming.action_name, &incoming.params)
    });
    if already_present {
        return false;
    }
    target.push(incoming.clone());
    true
}

fn push_streamed_event(
    live_sender: &Option<UnboundedSender<ChatGraphEvent>>,
    target: &mut Vec<ChatGraphEvent>,
    event: ChatGraphEvent,
) {
    if let Some(sender) = live_sender {
        let _ = sender.send(event.clone());
    }
    target.push(event);
}

#[allow(clippy::too_many_arguments)]
fn process_provider_stream_event(
    event: ProviderStreamEvent,
    parser_state: &mut crate::response_parser::StreamParserState,
    streamed_text_segments: &mut Vec<String>,
    streamed_actions: &mut Vec<crate::response_parser::ParsedAction>,
    streamed_events: &mut Vec<ChatGraphEvent>,
    live_sender: &Option<UnboundedSender<ChatGraphEvent>>,
    selected_id: &str,
    selected_name: &str,
    scene_type: Option<&str>,
    selected_config_allowed_actions: &[String],
    live_whiteboard_state: &mut WhiteboardState,
) {
    match event {
        ProviderStreamEvent::TextDelta(chunk) => {
            let parsed = crate::response_parser::parse_stream_chunk(&chunk, parser_state);

            for emission in parsed.emissions {
                match emission {
                    crate::response_parser::StreamEmission::Text(text) => {
                        if !text.trim().is_empty() {
                            streamed_text_segments.push(text.clone());
                            push_streamed_event(
                                live_sender,
                                streamed_events,
                                ChatGraphEvent {
                                    kind: ChatGraphEventKind::TextDelta,
                                    agent_id: Some(selected_id.to_string()),
                                    agent_name: Some(selected_name.to_string()),
                                    action_name: None,
                                    action_params: None,
                                    content: Some(text),
                                    message: None,
                                    director_state: None,
                                    whiteboard_state: Some(live_whiteboard_state.clone()),
                                    interruption_reason: None,
                                    resume_allowed: None,
                                },
                            );
                        }
                    }
                    crate::response_parser::StreamEmission::Action(action) => {
                        let validated = crate::response_parser::validate_actions(
                            vec![action],
                            scene_type,
                            selected_config_allowed_actions,
                        );
                        for action in validated {
                            if !push_unique_action(streamed_actions, &action) {
                                continue;
                            }
                            emit_action_lifecycle(
                                &action,
                                "parsed model output",
                                live_sender,
                                streamed_events,
                                selected_id,
                                selected_name,
                                live_whiteboard_state,
                            );
                        }
                    }
                }
            }
        }
        ProviderStreamEvent::ToolCall(tool_call) => {
            if let Some(action) =
                validate_provider_tool_call(tool_call, scene_type, selected_config_allowed_actions)
            {
                if push_unique_action(streamed_actions, &action) {
                    emit_action_lifecycle(
                        &action,
                        "provider tool event",
                        live_sender,
                        streamed_events,
                        selected_id,
                        selected_name,
                        live_whiteboard_state,
                    );
                }
            }
        }
        ProviderStreamEvent::Done { .. } => {}
    }
}

fn validate_provider_tool_call(
    tool_call: ProviderToolCall,
    scene_type: Option<&str>,
    selected_config_allowed_actions: &[String],
) -> Option<crate::response_parser::ParsedAction> {
    crate::response_parser::validate_actions(
        vec![crate::response_parser::ParsedAction {
            action_name: tool_call.name,
            params: tool_call.arguments,
        }],
        scene_type,
        selected_config_allowed_actions,
    )
    .into_iter()
    .next()
}

fn emit_action_lifecycle(
    action: &crate::response_parser::ParsedAction,
    progress_origin: &str,
    live_sender: &Option<UnboundedSender<ChatGraphEvent>>,
    streamed_events: &mut Vec<ChatGraphEvent>,
    selected_id: &str,
    selected_name: &str,
    live_whiteboard_state: &mut WhiteboardState,
) {
    let canonical_params = canonical_runtime_action_params(&action.action_name, &action.params);
    let next_whiteboard_state = if action.action_name.starts_with("wb_") {
        let mut snapshot = live_whiteboard_state.clone();
        if let Some(runtime_action) =
            whiteboard_action_from_runtime_parts(&action.action_name, &action.params)
        {
            snapshot.apply_action(&runtime_action);
        }
        Some(snapshot)
    } else {
        None
    };

    push_streamed_event(
        live_sender,
        streamed_events,
        ChatGraphEvent {
            kind: ChatGraphEventKind::ActionStarted,
            agent_id: Some(selected_id.to_string()),
            agent_name: Some(selected_name.to_string()),
            action_name: Some(action.action_name.clone()),
            action_params: Some(canonical_params.clone()),
            content: None,
            message: Some(format!("Starting action {}", action.action_name)),
            director_state: None,
            whiteboard_state: next_whiteboard_state.clone(),
            interruption_reason: None,
            resume_allowed: None,
        },
    );
    push_streamed_event(
        live_sender,
        streamed_events,
        ChatGraphEvent {
            kind: ChatGraphEventKind::ActionProgress,
            agent_id: Some(selected_id.to_string()),
            agent_name: Some(selected_name.to_string()),
            action_name: Some(action.action_name.clone()),
            action_params: Some(canonical_params.clone()),
            content: None,
            message: Some(format!(
                "Streaming action {} from {}",
                action.action_name, progress_origin
            )),
            director_state: None,
            whiteboard_state: next_whiteboard_state.clone(),
            interruption_reason: None,
            resume_allowed: None,
        },
    );
    push_streamed_event(
        live_sender,
        streamed_events,
        ChatGraphEvent {
            kind: ChatGraphEventKind::ActionCompleted,
            agent_id: Some(selected_id.to_string()),
            agent_name: Some(selected_name.to_string()),
            action_name: Some(action.action_name.clone()),
            action_params: Some(canonical_params),
            content: None,
            message: Some(format!("Completed action {}", action.action_name)),
            director_state: None,
            whiteboard_state: next_whiteboard_state.clone(),
            interruption_reason: None,
            resume_allowed: None,
        },
    );

    if let Some(snapshot) = next_whiteboard_state {
        *live_whiteboard_state = snapshot;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_tutor_providers::traits::ProviderCapabilities;
    use ai_tutor_domain::runtime::{
        ChatMessage, ClientStageState, GeneratedChatAgentConfig, PersistedPoint2D,
        PersistedWhiteboardObject, PersistedWhiteboardState, RuntimeMode, RuntimeSessionMode,
        RuntimeSessionSelector, StatelessChatConfig,
    };
    use ai_tutor_domain::{
        action::LessonAction,
        lesson::Lesson,
        scene::{Scene, SceneContent, Stage},
    };
    use ai_tutor_providers::traits::{LlmProvider, ProviderStreamEvent, ProviderToolCall};
    use ai_tutor_runtime::{
        session::{lesson_playback_events, PlaybackEventKind, RuntimeInterruptionReason},
        whiteboard::WhiteboardObject,
    };
    use anyhow::Result;
    use async_trait::async_trait;
    use chrono::Utc;
    use std::sync::Arc;
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    struct FakeStreamingProvider {
        response: String,
    }

    #[async_trait]
    impl LlmProvider for FakeStreamingProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok(self.response.clone())
        }
    }

    struct FakeTypedStreamingProvider {
        full_text: String,
        events: Vec<ProviderStreamEvent>,
    }

    #[async_trait]
    impl LlmProvider for FakeTypedStreamingProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok(self.full_text.clone())
        }

        async fn generate_stream_events_with_history(
            &self,
            _messages: &[(String, String)],
            on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
        ) -> Result<String> {
            for event in self.events.clone() {
                on_event(event);
            }
            Ok(self.full_text.clone())
        }
    }

    struct BlockingCancellableStreamingProvider {
        started: Arc<Notify>,
        cancelled: Arc<Notify>,
    }

    #[async_trait]
    impl LlmProvider for BlockingCancellableStreamingProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            Ok("unused".to_string())
        }

        async fn generate_stream_events_with_history_cancellable(
            &self,
            _messages: &[(String, String)],
            cancellation: &CancellationToken,
            _on_event: &mut (dyn FnMut(ProviderStreamEvent) + Send),
        ) -> Result<String> {
            self.started.notify_waiters();
            cancellation.cancelled().await;
            self.cancelled.notify_waiters();
            Err(anyhow::anyhow!("stream cancelled"))
        }
    }

    fn base_payload() -> StatelessChatRequest {
        StatelessChatRequest {
            session_id: None,
            runtime_session: Some(RuntimeSessionSelector {
                mode: RuntimeSessionMode::StatelessClientState,
                session_id: None,
                create_if_missing: None,
            }),
            messages: vec![ChatMessage {
                id: "m1".to_string(),
                role: "user".to_string(),
                content: "Can we discuss this topic?".to_string(),
                metadata: None,
            }],
            store_state: ClientStageState {
                stage: None,
                scenes: vec![],
                current_scene_id: None,
                mode: RuntimeMode::Live,
                whiteboard_open: false,
            },
            config: StatelessChatConfig {
                session_type: Some("discussion".to_string()),
                discussion_topic: Some("plants".to_string()),
                discussion_prompt: Some("Discuss how plants grow".to_string()),
                trigger_agent_id: None,
                agent_ids: vec![],
                agent_configs: vec![
                    GeneratedChatAgentConfig {
                        id: "teacher-1".to_string(),
                        name: "Teacher".to_string(),
                        role: "teacher".to_string(),
                        persona: "Lead teacher".to_string(),
                        avatar: String::new(),
                        color: String::new(),
                        allowed_actions: vec![],
                        priority: 1,
                        is_generated: None,
                        bound_stage_id: None,
                    },
                    GeneratedChatAgentConfig {
                        id: "student-1".to_string(),
                        name: "Student".to_string(),
                        role: "student".to_string(),
                        persona: "Curious student".to_string(),
                        avatar: String::new(),
                        color: String::new(),
                        allowed_actions: vec![],
                        priority: 2,
                        is_generated: None,
                        bound_stage_id: None,
                    },
                ],
            },
            director_state: None,
            model: None,
            api_key: String::new(),
            base_url: None,
            provider_type: None,
            requires_api_key: None,
            user_profile: None,
        }
    }

    #[test]
    fn degraded_provider_runtime_reduces_discussion_turn_budget() {
        let payload = base_payload();
        let healthy = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: true,
            consecutive_failures: 0,
            cooldown_remaining_ms: 0,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Native,
            capabilities: ProviderCapabilities::native_text_and_typed(),
        }];
        let degraded = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: false,
            consecutive_failures: 2,
            cooldown_remaining_ms: 30_000,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Native,
            capabilities: ProviderCapabilities::native_text_and_typed(),
        }];

        assert_eq!(max_agent_turns(&payload, &healthy), 2);
        assert_eq!(max_agent_turns(&payload, &degraded), 1);
    }

    #[test]
    fn degraded_provider_runtime_biases_teacher_selection() {
        let payload = base_payload();
        let degraded = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: false,
            consecutive_failures: 2,
            cooldown_remaining_ms: 30_000,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Native,
            capabilities: ProviderCapabilities::native_text_and_typed(),
        }];

        let selected = resolve_selected_agent(&payload, &degraded);
        assert_eq!(selected.id, "teacher-1");
    }

    #[test]
    fn quiz_scene_biases_teacher_selection_for_explanation_requests() {
        let mut payload = base_payload();
        payload.store_state.current_scene_id = Some("quiz-scene".to_string());
        payload.store_state.scenes = vec![ai_tutor_domain::scene::Scene {
            id: "quiz-scene".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Check understanding".to_string(),
            order: 1,
            content: ai_tutor_domain::scene::SceneContent::Quiz {
                questions: vec![],
            },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];
        payload.messages.push(ai_tutor_domain::runtime::ChatMessage {
            id: "user-clarify".to_string(),
            role: "user".to_string(),
            content: "Why is B correct? Please explain step by step.".to_string(),
            metadata: None,
        });

        let healthy = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: true,
            consecutive_failures: 0,
            cooldown_remaining_ms: 0,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Native,
            capabilities: ProviderCapabilities::native_text_and_typed(),
        }];
        let selected = resolve_selected_agent(&payload, &healthy);
        assert_eq!(selected.id, "teacher-1");
    }

    #[test]
    fn project_scene_prefers_stage_bound_agent_when_available() {
        let mut payload = base_payload();
        payload.store_state.current_scene_id = Some("project-scene".to_string());
        payload.store_state.scenes = vec![ai_tutor_domain::scene::Scene {
            id: "project-scene".to_string(),
            stage_id: "project-stage".to_string(),
            title: "Project".to_string(),
            order: 1,
            content: ai_tutor_domain::scene::SceneContent::Project {
                project_config: ai_tutor_domain::scene::ProjectConfig {
                    summary: "Build a poster".to_string(),
                    title: Some("Poster".to_string()),
                    driving_question: None,
                    final_deliverable: None,
                    target_skills: None,
                    milestones: None,
                    team_roles: None,
                    assessment_focus: None,
                    starter_prompt: None,
                    success_criteria: None,
                    facilitator_notes: None,
                    agent_roles: None,
                    issue_board: None,
                },
            },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];
        payload.config.agent_configs = vec![
            GeneratedChatAgentConfig {
                id: "teacher-1".to_string(),
                name: "Teacher".to_string(),
                role: "teacher".to_string(),
                persona: "Lead teacher".to_string(),
                avatar: String::new(),
                color: String::new(),
                allowed_actions: vec![],
                priority: 1,
                is_generated: None,
                bound_stage_id: None,
            },
            GeneratedChatAgentConfig {
                id: "assistant-project".to_string(),
                name: "Project Coach".to_string(),
                role: "assistant".to_string(),
                persona: "Project-focused assistant".to_string(),
                avatar: String::new(),
                color: String::new(),
                allowed_actions: vec![],
                priority: 5,
                is_generated: None,
                bound_stage_id: Some("project-stage".to_string()),
            },
        ];

        let healthy = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: true,
            consecutive_failures: 0,
            cooldown_remaining_ms: 0,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Native,
            capabilities: ProviderCapabilities::native_text_and_typed(),
        }];
        let selected = resolve_selected_agent(&payload, &healthy);
        assert_eq!(selected.id, "assistant-project");
    }

    #[test]
    fn native_streaming_policy_detects_compatibility_entries() {
        let runtime = vec![
            ProviderRuntimeStatus {
                label: "openai:gpt-4o-mini".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: 0,
                average_latency_ms: None,
                last_latency_ms: None,
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Native,
                capabilities: ProviderCapabilities::native_text_and_typed(),
            },
            ProviderRuntimeStatus {
                label: "legacy:compat".to_string(),
                available: true,
                consecutive_failures: 0,
                cooldown_remaining_ms: 0,
                total_requests: 0,
                total_successes: 0,
                total_failures: 0,
                last_error: None,
                last_success_unix_ms: None,
                last_failure_unix_ms: None,
                total_latency_ms: 0,
                average_latency_ms: None,
                last_latency_ms: None,
                estimated_input_tokens: 0,
                estimated_output_tokens: 0,
                estimated_total_cost_microusd: 0,
                provider_reported_input_tokens: 0,
                provider_reported_output_tokens: 0,
                provider_reported_total_tokens: 0,
                provider_reported_total_cost_microusd: 0,
                streaming_path: StreamingPath::Compatibility,
                capabilities: ProviderCapabilities::compatibility_only(),
            },
        ];

        assert!(!native_streaming_is_ready(&runtime));
        assert_eq!(
            compatibility_streaming_labels(&runtime),
            vec!["legacy:compat".to_string()]
        );
    }

    #[test]
    fn native_streaming_policy_supports_label_selectors() {
        let previous = std::env::var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS").ok();
        std::env::set_var(
            "AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS",
            "anthropic, google",
        );

        let runtime = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: true,
            consecutive_failures: 0,
            cooldown_remaining_ms: 0,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Compatibility,
            capabilities: ProviderCapabilities::compatibility_only(),
        }];
        assert!(!runtime_requires_native_streaming_for(&runtime));

        let runtime_selected = vec![ProviderRuntimeStatus {
            label: "anthropic:claude-sonnet-4-6".to_string(),
            available: true,
            consecutive_failures: 0,
            cooldown_remaining_ms: 0,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Compatibility,
            capabilities: ProviderCapabilities::compatibility_only(),
        }];
        assert!(runtime_requires_native_streaming_for(&runtime_selected));

        if let Some(value) = previous {
            std::env::set_var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS", value);
        } else {
            std::env::remove_var("AI_TUTOR_RUNTIME_REQUIRE_NATIVE_STREAMING_LABELS");
        }
    }

    #[test]
    fn native_typed_streaming_policy_detects_missing_typed_capability_on_native_path() {
        let runtime = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: true,
            consecutive_failures: 0,
            cooldown_remaining_ms: 0,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: None,
            last_latency_ms: Some(120),
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Native,
            capabilities: ProviderCapabilities {
                native_text_streaming: true,
                native_typed_streaming: false,
                compatibility_streaming: true,
                cooperative_cancellation: true,
            },
        }];

        assert!(native_streaming_is_ready(&runtime));
        assert!(!native_typed_streaming_is_ready(&runtime));
        assert!(provider_runtime_requires_conservative_turns(&runtime));
    }

    #[test]
    fn high_latency_provider_runtime_requires_conservative_turns() {
        let runtime = vec![ProviderRuntimeStatus {
            label: "openai:gpt-4o-mini".to_string(),
            available: true,
            consecutive_failures: 0,
            cooldown_remaining_ms: 0,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            last_error: None,
            last_success_unix_ms: None,
            last_failure_unix_ms: None,
            total_latency_ms: 0,
            average_latency_ms: Some(runtime_high_latency_threshold_ms()),
            last_latency_ms: None,
            estimated_input_tokens: 0,
            estimated_output_tokens: 0,
            estimated_total_cost_microusd: 0,
            provider_reported_input_tokens: 0,
            provider_reported_output_tokens: 0,
            provider_reported_total_tokens: 0,
            provider_reported_total_cost_microusd: 0,
            streaming_path: StreamingPath::Native,
            capabilities: ProviderCapabilities::native_text_and_typed(),
        }];

        assert!(provider_runtime_has_high_latency(&runtime));
        assert!(provider_runtime_requires_conservative_turns(&runtime));
    }

    #[tokio::test]
    async fn streamed_whiteboard_actions_update_live_whiteboard_state() {
        let mut payload = base_payload();
        payload.config.agent_configs.truncate(1);
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        let llm: Arc<dyn LlmProvider> = Arc::new(FakeStreamingProvider {
            response: r#"[{"type":"text","content":"Let's use the board."},{"type":"action","name":"wb_open","params":{}},{"type":"action","name":"wb_draw_text","params":{"elementId":"note-1","content":"1/2","x":120,"y":80}}]"#.to_string(),
        });

        let events = run_chat_graph(payload, llm, "session-test".to_string())
            .await
            .expect("chat graph should run");

        let action_event = events
            .iter()
            .find(|event| event.action_name.as_deref() == Some("wb_draw_text"))
            .expect("whiteboard draw event should be emitted");
        let whiteboard_state = action_event
            .whiteboard_state
            .as_ref()
            .expect("whiteboard snapshot should be attached");

        assert!(whiteboard_state.is_open);
        assert_eq!(whiteboard_state.objects.len(), 1);

        let done_event = events
            .iter()
            .find(|event| matches!(event.kind, ChatGraphEventKind::Done))
            .expect("done event should be emitted");
        assert_eq!(
            done_event
                .whiteboard_state
                .as_ref()
                .map(|state| state.objects.len()),
            Some(1)
        );
        assert_eq!(
            done_event
                .director_state
                .as_ref()
                .and_then(|state| state.whiteboard_state.as_ref())
                .map(|state| state.objects.len()),
            Some(1)
        );
    }

    #[tokio::test]
    async fn typed_tool_stream_events_bypass_json_reconstruction() {
        let mut payload = base_payload();
        payload.config.agent_configs.truncate(1);
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        payload.config.agent_configs[0].allowed_actions =
            vec!["wb_open".to_string(), "wb_draw_text".to_string()];

        let llm: Arc<dyn LlmProvider> = Arc::new(FakeTypedStreamingProvider {
            full_text: "Let's annotate this.".to_string(),
            events: vec![
                ProviderStreamEvent::TextDelta(
                    r#"[{"type":"text","content":"Let's annotate this."}"#.to_string(),
                ),
                ProviderStreamEvent::ToolCall(ProviderToolCall {
                    id: Some("tool-1".to_string()),
                    name: "wb_open".to_string(),
                    arguments: serde_json::json!({}),
                }),
                ProviderStreamEvent::ToolCall(ProviderToolCall {
                    id: Some("tool-2".to_string()),
                    name: "wb_draw_text".to_string(),
                    arguments: serde_json::json!({
                        "elementId": "typed-note",
                        "content": "typed stream",
                        "x": 150,
                        "y": 90
                    }),
                }),
                ProviderStreamEvent::Done {
                    full_text: "Let's annotate this.".to_string(),
                    usage: None,
                },
            ],
        });

        let events = run_chat_graph(payload, llm, "session-typed-stream".to_string())
            .await
            .expect("chat graph should run");

        let progress = events
            .iter()
            .find(|event| {
                matches!(event.kind, ChatGraphEventKind::ActionProgress)
                    && event.action_name.as_deref() == Some("wb_draw_text")
            })
            .expect("typed tool action should emit progress");
        assert_eq!(
            progress.message.as_deref(),
            Some("Streaming action wb_draw_text from provider tool event")
        );
        assert_eq!(
            progress
                .action_params
                .as_ref()
                .and_then(|params| params.get("schema_version"))
                .and_then(|value| value.as_str()),
            Some("runtime_action_v1")
        );
        assert_eq!(
            progress
                .action_params
                .as_ref()
                .and_then(|params| params.get("action_name"))
                .and_then(|value| value.as_str()),
            Some("wb_draw_text")
        );

        let board = progress
            .whiteboard_state
            .as_ref()
            .expect("typed tool event should carry whiteboard snapshot");
        assert!(board.is_open);
        assert_eq!(board.objects.len(), 1);
    }

    #[tokio::test]
    async fn typed_tool_event_is_not_replayed_by_final_parser_flush() {
        let mut payload = base_payload();
        payload.config.agent_configs.truncate(1);
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        payload.config.agent_configs[0].allowed_actions =
            vec!["wb_open".to_string(), "wb_draw_text".to_string()];

        let llm: Arc<dyn LlmProvider> = Arc::new(FakeTypedStreamingProvider {
            full_text: "Let's annotate this.".to_string(),
            events: vec![
                ProviderStreamEvent::TextDelta(
                    r#"[{"type":"text","content":"Let's annotate this."},{"type":"action","name":"wb_open","params":{}},{"type":"action","name":"wb_draw_text","params":{"elementId":"typed-note","content":"typed stream","x":150,"y":90}}"#.to_string(),
                ),
                ProviderStreamEvent::ToolCall(ProviderToolCall {
                    id: Some("tool-1".to_string()),
                    name: "wb_open".to_string(),
                    arguments: serde_json::json!({}),
                }),
                ProviderStreamEvent::ToolCall(ProviderToolCall {
                    id: Some("tool-2".to_string()),
                    name: "wb_draw_text".to_string(),
                    arguments: serde_json::json!({
                        "elementId": "typed-note",
                        "content": "typed stream",
                        "x": 150,
                        "y": 90
                    }),
                }),
                ProviderStreamEvent::Done {
                    full_text: "Let's annotate this.".to_string(),
                    usage: None,
                },
            ],
        });

        let events = run_chat_graph(payload, llm, "session-typed-dedupe".to_string())
            .await
            .expect("chat graph should run");

        let open_started = events
            .iter()
            .filter(|event| {
                matches!(event.kind, ChatGraphEventKind::ActionStarted)
                    && event.action_name.as_deref() == Some("wb_open")
            })
            .count();
        let draw_started = events
            .iter()
            .filter(|event| {
                matches!(event.kind, ChatGraphEventKind::ActionStarted)
                    && event.action_name.as_deref() == Some("wb_draw_text")
            })
            .count();

        assert_eq!(open_started, 1);
        assert_eq!(draw_started, 1);
    }

    #[tokio::test]
    async fn run_chat_graph_stream_propagates_cancellation_to_provider() {
        let mut payload = base_payload();
        payload.config.agent_configs.truncate(1);
        payload.config.agent_ids = vec!["teacher-1".to_string()];

        let started = Arc::new(Notify::new());
        let cancelled = Arc::new(Notify::new());
        let started_wait = started.notified();
        let cancelled_wait = cancelled.notified();
        let llm: Arc<dyn LlmProvider> = Arc::new(BlockingCancellableStreamingProvider {
            started: Arc::clone(&started),
            cancelled: Arc::clone(&cancelled),
        });
        let cancellation = CancellationToken::new();
        let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();

        let run = tokio::spawn(run_chat_graph_stream(
            payload,
            llm,
            "session-cancel".to_string(),
            sender,
            Some(cancellation.clone()),
        ));

        started_wait.await;
        cancellation.cancel();
        cancelled_wait.await;

        let result = run.await.expect("graph task should join");
        let events = result.expect("cancellation should yield interrupted events");
        let interrupted = events
            .iter()
            .find(|event| matches!(event.kind, ChatGraphEventKind::Interrupted))
            .expect("interrupted event should be emitted");
        assert!(matches!(
            interrupted.interruption_reason,
            Some(RuntimeInterruptionReason::ProviderCancelled)
        ));
        assert_eq!(interrupted.resume_allowed, Some(true));
    }

    #[tokio::test]
    async fn seeded_director_state_preserves_whiteboard_snapshot() {
        let mut payload = base_payload();
        payload.config.agent_configs.truncate(1);
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        payload.director_state = Some(DirectorState {
            turn_count: 0,
            agent_responses: vec![],
            whiteboard_ledger: vec![],
            whiteboard_state: Some(PersistedWhiteboardState {
                id: "session-resume".to_string(),
                is_open: true,
                version: 1,
                objects: vec![PersistedWhiteboardObject::Text {
                    id: "existing-note".to_string(),
                    position: PersistedPoint2D { x: 32.0, y: 48.0 },
                    content: "Existing".to_string(),
                    font_size: 20.0,
                    color: "#000000".to_string(),
                }],
            }),
        });
        let llm: Arc<dyn LlmProvider> = Arc::new(FakeStreamingProvider {
            response: r#"[{"type":"text","content":"Continuing from the existing board state."}]"#
                .to_string(),
        });

        let events = run_chat_graph(payload, llm, "session-resume".to_string())
            .await
            .expect("chat graph should resume");

        let done_event = events
            .iter()
            .find(|event| matches!(event.kind, ChatGraphEventKind::Done))
            .expect("done event should be emitted");

        assert_eq!(
            done_event
                .director_state
                .as_ref()
                .and_then(|state| state.whiteboard_state.as_ref())
                .map(|state| state.objects.len()),
            Some(1)
        );
    }

    #[tokio::test]
    async fn ledger_state_overrides_stale_snapshot_when_both_are_present() {
        let mut payload = base_payload();
        payload.config.agent_configs.truncate(1);
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        payload.director_state = Some(DirectorState {
            turn_count: 0,
            agent_responses: vec![],
            whiteboard_ledger: vec![WhiteboardActionRecord {
                action_name: "wb_draw_text".to_string(),
                agent_id: "teacher-1".to_string(),
                agent_name: "Teacher".to_string(),
                params: serde_json::json!({
                    "elementId": "ledger-note",
                    "content": "from-ledger",
                    "x": 100,
                    "y": 80
                }),
            }],
            whiteboard_state: Some(PersistedWhiteboardState {
                id: "stale".to_string(),
                is_open: true,
                version: 1,
                objects: vec![PersistedWhiteboardObject::Text {
                    id: "stale-note".to_string(),
                    position: PersistedPoint2D { x: 12.0, y: 14.0 },
                    content: "stale-snapshot".to_string(),
                    font_size: 20.0,
                    color: "#111111".to_string(),
                }],
            }),
        });

        let llm: Arc<dyn LlmProvider> = Arc::new(FakeStreamingProvider {
            response: r#"[{"type":"text","content":"Continuing from ledger state."}]"#.to_string(),
        });
        let events = run_chat_graph(payload, llm, "session-ledger-priority".to_string())
            .await
            .expect("chat graph should run");

        let done_event = events
            .iter()
            .find(|event| matches!(event.kind, ChatGraphEventKind::Done))
            .expect("done event should be present");
        let board = done_event
            .whiteboard_state
            .as_ref()
            .expect("done event should include whiteboard state");
        let has_ledger_note = board.objects.iter().any(|object| {
            matches!(
                object,
                WhiteboardObject::Text { id, content, .. } if id == "ledger-note" && content == "from-ledger"
            )
        });
        let has_stale_snapshot = board.objects.iter().any(|object| {
            matches!(
                object,
                WhiteboardObject::Text { id, content, .. } if id == "stale-note" && content == "stale-snapshot"
            )
        });

        assert!(has_ledger_note);
        assert!(!has_stale_snapshot);
    }

    #[tokio::test]
    async fn playback_and_live_whiteboard_state_converge_for_same_action_sequence() {
        let mut payload = base_payload();
        payload.config.agent_configs.truncate(1);
        payload.config.agent_ids = vec!["teacher-1".to_string()];
        let llm: Arc<dyn LlmProvider> = Arc::new(FakeStreamingProvider {
            response: r#"[{"type":"action","name":"wb_open","params":{}},{"type":"action","name":"wb_draw_text","params":{"elementId":"note-sync","content":"synced","x":96,"y":72}}]"#.to_string(),
        });

        let live_events = run_chat_graph(payload, llm, "session-sync".to_string())
            .await
            .expect("live graph should run");
        let live_done = live_events
            .iter()
            .find(|event| matches!(event.kind, ChatGraphEventKind::Done))
            .expect("live graph done event should exist");
        let live_board = live_done
            .whiteboard_state
            .as_ref()
            .expect("live done event should include whiteboard snapshot");

        let lesson = Lesson {
            id: "lesson-sync".to_string(),
            title: "Sync Test".to_string(),
            language: "en-US".to_string(),
            description: None,
            stage: Some(Stage {
                id: "stage-sync".to_string(),
                name: "Sync Stage".to_string(),
                description: None,
                created_at: 0,
                updated_at: 0,
                language: Some("en-US".to_string()),
                style: Some("interactive".to_string()),
                whiteboard: vec![],
                agent_ids: vec![],
                generated_agent_configs: vec![],
            }),
            scenes: vec![Scene {
                id: "scene-sync".to_string(),
                stage_id: "stage-sync".to_string(),
                title: "Whiteboard Scene".to_string(),
                order: 1,
                content: SceneContent::Quiz { questions: vec![] },
                actions: vec![
                    LessonAction::WhiteboardOpen {
                        id: "action-open".to_string(),
                        title: None,
                        description: None,
                    },
                    LessonAction::WhiteboardDrawText {
                        id: "action-draw".to_string(),
                        title: None,
                        description: None,
                        element_id: Some("note-sync".to_string()),
                        content: "synced".to_string(),
                        x: 96.0,
                        y: 72.0,
                        width: None,
                        height: None,
                        font_size: Some(24.0),
                        color: Some("#000000".to_string()),
                    },
                ],
                whiteboards: vec![],
                multi_agent: None,
                created_at: Some(Utc::now().timestamp_millis()),
                updated_at: Some(Utc::now().timestamp_millis()),
            }],
            style: Some("interactive".to_string()),
            agent_ids: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let playback_events = lesson_playback_events(&lesson);
        let playback_done = playback_events
            .iter()
            .find(|event| matches!(event.kind, PlaybackEventKind::SessionCompleted))
            .expect("playback should emit completion event");
        let playback_board = playback_done
            .whiteboard_state
            .as_ref()
            .expect("playback completion should include whiteboard snapshot");

        assert_eq!(live_board.is_open, playback_board.is_open);
        assert_eq!(live_board.objects.len(), playback_board.objects.len());
        let has_sync_note_live = live_board.objects.iter().any(|object| {
            matches!(
                object,
                WhiteboardObject::Text { id, content, .. } if id == "note-sync" && content == "synced"
            )
        });
        let has_sync_note_playback = playback_board.objects.iter().any(|object| {
            matches!(
                object,
                WhiteboardObject::Text { id, content, .. } if id == "note-sync" && content == "synced"
            )
        });
        assert!(has_sync_note_live);
        assert!(has_sync_note_playback);
    }

    #[test]
    fn interruption_signal_routes_back_to_teacher() {
        let payload = base_payload();
        let candidates = collect_candidates(&payload);
        let director_state = DirectorState {
            turn_count: 2,
            agent_responses: vec![AgentTurnSummary {
                agent_id: "student-1".to_string(),
                agent_name: "Student".to_string(),
                content_preview: "I think I understand".to_string(),
                action_count: 0,
                whiteboard_actions: vec![],
            }],
            whiteboard_ledger: vec![],
            whiteboard_state: None,
        };

        let decision = deterministic_director_override(
            "I'm confused. Please explain again step by step.",
            &director_state,
            &candidates,
        );

        match decision {
            Some(DirectorOverride::Select(agent)) => {
                assert_eq!(agent.id, "teacher-1");
            }
            _ => panic!("expected teacher selection override"),
        }
    }

    #[test]
    fn next_session_outcome_uses_current_run_turns_not_historical_response_length() {
        let payload = base_payload();
        let outcome_mid_turn = next_session_outcome(&payload, 2, 1);
        assert!(matches!(outcome_mid_turn, ChatGraphOutcome::Continue));

        let outcome_limit = next_session_outcome(&payload, 2, 2);
        assert!(matches!(outcome_limit, ChatGraphOutcome::CueUser));
    }
}
