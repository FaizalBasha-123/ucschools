use anyhow::{anyhow, Result};
use ai_tutor_domain::{
    generation::LessonGenerationRequest,
    runtime::StatelessChatRequest,
    scene::{Scene, SceneContent},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PedagogyTier {
    Baseline,
    Scaffold,
    Reasoning,
}

impl PedagogyTier {
    pub fn as_str(self) -> &'static str {
        match self {
            PedagogyTier::Baseline => "baseline",
            PedagogyTier::Scaffold => "scaffold",
            PedagogyTier::Reasoning => "reasoning",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PedagogyRoutingDecision {
    pub tier: PedagogyTier,
    pub model: String,
    pub fallback_model: Option<String>,
    pub stage: &'static str,
    pub reason: String,
    pub confidence: f32,
    pub thinking_budget_tokens: Option<i32>,
}

pub fn resolve_chat_pedagogy_route(
    request: &StatelessChatRequest,
    explicit_model: Option<&str>,
) -> Result<PedagogyRoutingDecision> {
    if let Some(model) = explicit_model.and_then(normalize_model_string) {
        return Ok(PedagogyRoutingDecision {
            tier: PedagogyTier::Baseline,
            model,
            fallback_model: None,
            stage: "manual",
            reason: "Explicit model override supplied by the request.".to_string(),
            confidence: 1.0,
            thinking_budget_tokens: None,
        });
    }

    let signals = extract_chat_signals(request);
    let (tier, confidence) = choose_chat_tier(&signals);
    let model = chat_models_for_tier(tier)?;

    Ok(PedagogyRoutingDecision {
        tier,
        model,
        fallback_model: None,
        stage: tier.as_str(),
        reason: signals.reason,
        confidence,
        thinking_budget_tokens: Some(match tier {
            PedagogyTier::Baseline => 128,
            PedagogyTier::Scaffold => 256,
            PedagogyTier::Reasoning => 384,
        }),
    })
}

pub fn resolve_generation_model_policy(
    request: Option<&LessonGenerationRequest>,
    outlines_override: Option<&str>,
    scene_content_override: Option<&str>,
    scene_actions_override: Option<&str>,
    scene_actions_fallback_override: Option<&str>,
) -> Result<(String, String, String, Option<String>)> {
    if let Some(request) = request {
        let _signals = extract_lesson_signals(request);

        let outlines_model = select_model(
            outlines_override,
            &required_env_model("AI_TUTOR_GENERATION_OUTLINES_MODEL")?,
        )?;
        let scene_content_model = select_model(
            scene_content_override,
            &required_env_model("AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL")?,
        )?;
        let scene_actions_model = select_model(
            scene_actions_override,
            &required_env_model("AI_TUTOR_GENERATION_SCENE_ACTIONS_MODEL")?,
        )?;

        let _ = scene_actions_fallback_override;

        return Ok((outlines_model, scene_content_model, scene_actions_model, None));
    }

    let outlines_model = select_model(
        outlines_override,
        &required_env_model("AI_TUTOR_GENERATION_OUTLINES_MODEL")?,
    )?;
    let scene_content_model = select_model(
        scene_content_override,
        &required_env_model("AI_TUTOR_GENERATION_SCENE_CONTENT_MODEL")?,
    )?;
    let scene_actions_model = select_model(
        scene_actions_override,
        &required_env_model("AI_TUTOR_GENERATION_SCENE_ACTIONS_MODEL")?,
    )?;

    let _ = scene_actions_fallback_override;

    Ok((
        outlines_model,
        scene_content_model,
        scene_actions_model,
        None,
    ))
}

fn select_model(override_model: Option<&str>, default_model: &str) -> Result<String> {
    override_model
        .and_then(normalize_model_string)
        .or_else(|| normalize_model_string(default_model))
        .ok_or_else(|| anyhow!("model string is required"))
}

fn normalize_model_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

struct ChatSignals {
    score: i32,
    reason: String,
    has_confusion: bool,
}

fn choose_chat_tier(signals: &ChatSignals) -> (PedagogyTier, f32) {
    if signals.has_confusion {
        return (PedagogyTier::Reasoning, 0.98);
    }

    if signals.score >= 5 {
        (PedagogyTier::Reasoning, 0.88)
    } else if signals.score >= 2 {
        (PedagogyTier::Scaffold, 0.72)
    } else {
        (PedagogyTier::Baseline, 0.65)
    }
}

fn extract_chat_signals(request: &StatelessChatRequest) -> ChatSignals {
    let mut score = 0;
    let mut reasons = Vec::new();

    let session_type = request
        .config
        .session_type
        .as_deref()
        .unwrap_or("qa")
        .to_ascii_lowercase();
    if session_type == "discussion" {
        score += 1;
        reasons.push("discussion session");
    } else if session_type == "qa" {
        score += 1;
        reasons.push("qa session");
    }

    let current_message = request
        .messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.as_str())
        .unwrap_or_default();
    let current_message_lower = current_message.to_ascii_lowercase();

    let confusion_terms = [
        "confused",
        "stuck",
        "don't understand",
        "dont understand",
        "step by step",
        "explain again",
        "why",
        "how",
        "prove",
        "derive",
        "compare",
        "analyze",
        "trouble",
        "error",
    ];
    let has_confusion = confusion_terms.iter().any(|term| current_message_lower.contains(term));
    if has_confusion {
        score += 4;
        reasons.push("learner confusion");
    }

    let complexity_terms = ["essay", "proof", "project", "essay", "solve", "design", "plan", "debug"];
    if complexity_terms
        .iter()
        .any(|term| current_message_lower.contains(term))
    {
        score += 1;
        reasons.push("complex task");
    }

    if request.store_state.whiteboard_open {
        score += 1;
        reasons.push("whiteboard open");
    }

    if !request.config.agent_configs.is_empty() {
        score += 1;
        reasons.push("multi-agent session");
    }

    if request
        .director_state
        .as_ref()
        .is_some_and(|state| state.turn_count > 0)
    {
        score += 1;
        reasons.push("follow-up turn");
    }

    if let Some(scene) = current_scene(request) {
        match &scene.content {
            SceneContent::Quiz { .. } => {
                score += 2;
                reasons.push("quiz scene");
            }
            SceneContent::Interactive { .. } => {
                score += 1;
                reasons.push("interactive scene");
            }
            SceneContent::Project { .. } => {
                score += 2;
                reasons.push("project scene");
            }
            SceneContent::Slide { .. } => {}
        }
    }

    if request.messages.len() > 8 {
        score += 1;
        reasons.push("long history");
    }

    let reason = if reasons.is_empty() {
        "Baseline tutoring is sufficient for this turn.".to_string()
    } else {
        format!("Routing based on {}.", reasons.join(", "))
    };

    ChatSignals {
        score,
        reason,
        has_confusion,
    }
}

fn current_scene(request: &StatelessChatRequest) -> Option<&Scene> {
    let current_scene_id = request.store_state.current_scene_id.as_deref()?;
    request
        .store_state
        .scenes
        .iter()
        .find(|scene| scene.id == current_scene_id)
}

struct LessonSignals {
    score: i32,
}

fn choose_lesson_tier(signals: &LessonSignals) -> PedagogyTier {
    if signals.score >= 4 {
        PedagogyTier::Reasoning
    } else if signals.score >= 2 {
        PedagogyTier::Scaffold
    } else {
        PedagogyTier::Baseline
    }
}

fn extract_lesson_signals(request: &LessonGenerationRequest) -> LessonSignals {
    let mut score = 0;
    let requirement = request.requirements.requirement.to_ascii_lowercase();

    if requirement.len() > 220 {
        score += 1;
    }
    if ["why", "how", "prove", "derive", "compare", "analyze", "design"]
        .iter()
        .any(|term| requirement.contains(term))
    {
        score += 2;
    }
    if request.pdf_content.is_some() {
        score += 1;
    }
    if request.enable_web_search {
        score += 1;
    }
    if request.enable_image_generation || request.enable_video_generation || request.enable_tts {
        score += 1;
    }

    LessonSignals { score }
}

fn chat_models_for_tier(tier: PedagogyTier) -> Result<String> {
    match tier {
        PedagogyTier::Baseline => required_env_model("AI_TUTOR_CHAT_BASELINE_MODEL"),
        PedagogyTier::Scaffold => required_env_model("AI_TUTOR_CHAT_SCAFFOLD_MODEL"),
        PedagogyTier::Reasoning => required_env_model("AI_TUTOR_CHAT_REASONING_MODEL"),
    }
}

fn required_env_model(key: &str) -> Result<String> {
    let value = std::env::var(key).map_err(|_| anyhow!("{key} is required"))?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{key} is required"));
    }
    Ok(trimmed.to_string())
}

pub fn thinking_message_for_chat(decision: &PedagogyRoutingDecision) -> String {
    format!(
        "Pedagogy router chose {} routing{}{}.",
        decision.tier.as_str(),
        decision
            .thinking_budget_tokens
            .map(|budget| format!(" with ~{} token thinking budget", budget))
            .unwrap_or_default(),
        if decision.reason.is_empty() {
            String::new()
        } else {
            format!(" because {}", decision.reason)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_tutor_domain::runtime::{ChatMessage, ClientStageState, DirectorState, RuntimeMode, RuntimeSessionMode, RuntimeSessionSelector};

    fn base_chat_request(message: &str) -> StatelessChatRequest {
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
                content: message.to_string(),
                metadata: None,
            }],
            store_state: ClientStageState {
                stage: None,
                scenes: vec![],
                current_scene_id: None,
                mode: RuntimeMode::Live,
                whiteboard_open: false,
            },
            config: ai_tutor_domain::runtime::StatelessChatConfig {
                agent_ids: vec!["teacher-1".to_string()],
                session_type: Some("qa".to_string()),
                discussion_topic: None,
                discussion_prompt: None,
                trigger_agent_id: None,
                agent_configs: vec![],
            },
            director_state: Some(DirectorState {
                turn_count: 0,
                agent_responses: vec![],
                whiteboard_ledger: vec![],
                whiteboard_state: None,
            }),
            user_profile: None,
            api_key: String::new(),
            base_url: None,
            model: None,
            provider_type: None,
            requires_api_key: None,
        }
    }

    #[test]
    fn confusion_routes_to_reasoning() {
        let request = base_chat_request("I am confused. Please explain step by step.");
        let decision = resolve_chat_pedagogy_route(
            &request,
            Some("openrouter:openai/gpt-4o-mini"),
        )
        .unwrap();
        assert_eq!(decision.tier, PedagogyTier::Reasoning);
        assert!(decision.reason.contains("learner confusion"));
    }

    #[test]
    fn quiz_scene_routes_to_scaffold_or_reasoning() {
        let mut request = base_chat_request("What is the answer?");
        request.store_state.scenes = vec![Scene {
            id: "scene-1".to_string(),
            stage_id: "stage-1".to_string(),
            title: "Quiz".to_string(),
            order: 1,
            content: SceneContent::Quiz { questions: vec![] },
            actions: vec![],
            whiteboards: vec![],
            multi_agent: None,
            created_at: None,
            updated_at: None,
        }];
        request.store_state.current_scene_id = Some("scene-1".to_string());

        let decision = resolve_chat_pedagogy_route(
            &request,
            Some("openrouter:openai/gpt-4o-mini"),
        )
        .unwrap();
        assert!(matches!(decision.tier, PedagogyTier::Scaffold | PedagogyTier::Reasoning));
    }

    #[test]
    fn explicit_model_override_wins() {
        let request = base_chat_request("Keep it simple.");
        let decision = resolve_chat_pedagogy_route(
            &request,
            Some("openrouter:openai/gpt-4o-mini"),
        )
        .unwrap();
        assert_eq!(decision.stage, "manual");
        assert_eq!(decision.model, "openrouter:openai/gpt-4o-mini");
    }

    #[test]
    fn lesson_routing_prefers_explicit_models() {
        let policy = resolve_generation_model_policy(
            None,
            Some("openrouter:google/gemini-2.5-flash"),
            Some("openrouter:openai/gpt-4o-mini"),
            Some("openrouter:openai/gpt-4o-mini"),
            None,
        )
        .unwrap();
        assert_eq!(policy.0, "openrouter:google/gemini-2.5-flash");
        assert_eq!(policy.1, "openrouter:openai/gpt-4o-mini");
        assert_eq!(policy.2, "openrouter:openai/gpt-4o-mini");
        assert_eq!(policy.3, None);
    }
}
