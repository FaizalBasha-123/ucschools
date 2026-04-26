use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::Mutex,
};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Duration};
use tracing::warn;

use ai_tutor_domain::{
    action::LessonAction,
    generation::{Language, LessonGenerationRequest},
    scene::{
        InteractiveConfig, MediaGenerationRequest, MediaType, ProjectAgentRole, ProjectConfig,
        ProjectIssue, ProjectOutlineConfig, QuizConfig, QuizOption, QuizQuestion, QuizQuestionType,
        SceneContent, SceneOutline, SceneType, ScientificModel, SlideCanvas, SlideElement,
        SlideTheme,
    },
};
use ai_tutor_providers::traits::LlmProvider;

use crate::pipeline::LessonGenerationPipeline;

pub struct LlmGenerationPipeline {
    llm: Box<dyn LlmProvider>,
    outlines_llm: Option<Box<dyn LlmProvider>>,
    scene_content_llm: Option<Box<dyn LlmProvider>>,
    scene_actions_llm: Option<Box<dyn LlmProvider>>,
    scene_actions_fallback_llm: Option<Box<dyn LlmProvider>>,
    web_search: Option<WebSearchConfig>,
    research_cache: Mutex<HashMap<u64, Option<String>>>,
}

struct WebSearchConfig {
    api_key: String,
    base_url: String,
    max_results: usize,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct TavilySearchResponse {
    #[serde(default)]
    answer: String,
    #[serde(default)]
    results: Vec<TavilySource>,
}

#[derive(Deserialize)]
struct TavilySource {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default, alias = "content")]
    content: String,
}

#[derive(Deserialize)]
struct SearchQueryRewriteEnvelope {
    query: String,
}

impl LlmGenerationPipeline {
    pub fn new(llm: Box<dyn LlmProvider>) -> Self {
        Self {
            llm,
            outlines_llm: None,
            scene_content_llm: None,
            scene_actions_llm: None,
            scene_actions_fallback_llm: None,
            web_search: None,
            research_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn with_phase_llms(
        mut self,
        outlines_llm: Box<dyn LlmProvider>,
        scene_content_llm: Box<dyn LlmProvider>,
        scene_actions_llm: Box<dyn LlmProvider>,
    ) -> Self {
        self.outlines_llm = Some(outlines_llm);
        self.scene_content_llm = Some(scene_content_llm);
        self.scene_actions_llm = Some(scene_actions_llm);
        self
    }

    pub fn with_scene_actions_fallback_llm(
        mut self,
        scene_actions_fallback_llm: Box<dyn LlmProvider>,
    ) -> Self {
        self.scene_actions_fallback_llm = Some(scene_actions_fallback_llm);
        self
    }

    pub fn with_tavily_web_search(
        mut self,
        api_key: impl Into<String>,
        base_url: impl Into<String>,
        max_results: usize,
    ) -> Self {
        self.web_search = Some(WebSearchConfig {
            api_key: api_key.into(),
            base_url: base_url.into(),
            max_results: max_results.max(1),
            client: reqwest::Client::new(),
        });
        self
    }

    async fn generate_with_retry_using(
        &self,
        llm: &dyn LlmProvider,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<String> {
        let mut last_error = None;

        for attempt in 0..MAX_LLM_ATTEMPTS {
            match llm.generate_text(system_prompt, user_prompt).await {
                Ok(response) => return Ok(response),
                Err(err) => {
                    let should_retry = should_retry_llm_error(&err);
                    last_error = Some(err);

                    if !should_retry || attempt + 1 == MAX_LLM_ATTEMPTS {
                        break;
                    }

                    let backoff_ms = RETRY_BACKOFF_MS * (attempt as u64 + 1);
                    sleep(Duration::from_millis(backoff_ms)).await;
                }
            }
        }

        Err(last_error.unwrap_or_else(|| anyhow!("LLM request failed without an error")))
    }

    async fn generate_with_retry(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.generate_with_retry_using(self.scene_content_llm(), system_prompt, user_prompt)
            .await
    }

    fn outlines_llm(&self) -> &dyn LlmProvider {
        self.outlines_llm
            .as_deref()
            .unwrap_or_else(|| self.scene_content_llm())
    }

    fn scene_content_llm(&self) -> &dyn LlmProvider {
        self.scene_content_llm
            .as_deref()
            .unwrap_or_else(|| self.llm.as_ref())
    }

    fn scene_actions_llm(&self) -> &dyn LlmProvider {
        self.scene_actions_llm
            .as_deref()
            .unwrap_or_else(|| self.scene_content_llm())
    }

    async fn research_context_for_request(
        &self,
        request: &LessonGenerationRequest,
    ) -> Option<String> {
        if !request.enable_web_search {
            return None;
        }

        let cache_key = request_research_cache_key(request);
        if let Some(cached) = self
            .research_cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(&cache_key).cloned())
        {
            return cached;
        }

        let Some(web_search) = &self.web_search else {
            warn!("Web search enabled but Tavily configuration is missing; continuing without research context");
            if let Ok(mut cache) = self.research_cache.lock() {
                cache.insert(cache_key, None);
            }
            return None;
        };

        let context = match self.run_web_search_research(request, web_search).await {
            Ok(value) => value,
            Err(err) => {
                warn!(
                    "Web search research failed; continuing without research context: {}",
                    err
                );
                None
            }
        };

        if let Ok(mut cache) = self.research_cache.lock() {
            cache.insert(cache_key, context.clone());
        }
        context
    }

    async fn run_web_search_research(
        &self,
        request: &LessonGenerationRequest,
        config: &WebSearchConfig,
    ) -> Result<Option<String>> {
        let raw_requirement = normalize_search_requirement(&request.requirements.requirement);
        if raw_requirement.is_empty() {
            return Ok(None);
        }

        let pdf_excerpt =
            normalize_pdf_excerpt(request.pdf_content.as_ref().map(|pdf| pdf.text.as_str()));
        let rewrite_attempted = should_rewrite_search_query(&raw_requirement, &pdf_excerpt);
        let mut query = raw_requirement.clone();

        if rewrite_attempted {
            let rewrite_system =
                "Rewrite lesson requirements into a focused web-search query. Return strict JSON only.";
            let rewrite_user = format!(
                "Requirement:\n{}\n\nPDF excerpt (optional):\n{}\n\nReturn JSON with shape {{\"query\":\"...\"}} and keep it concise.",
                raw_requirement,
                if pdf_excerpt.is_empty() {
                    "None"
                } else {
                    pdf_excerpt.as_str()
                }
            );
            match self
                .generate_with_retry_using(self.outlines_llm(), rewrite_system, &rewrite_user)
                .await
            {
                Ok(response) => {
                    if let Ok(parsed) =
                        parse_json_with_repair::<SearchQueryRewriteEnvelope>(&response)
                    {
                        let rewritten = normalize_search_requirement(&parsed.query);
                        if !rewritten.is_empty() {
                            query = rewritten;
                        }
                    }
                }
                Err(err) => {
                    warn!(
                        "Search query rewrite failed; falling back to raw requirement: {}",
                        err
                    );
                }
            }
        }

        query = query.chars().take(TAVILY_SOFT_MAX_QUERY_LENGTH).collect();
        let response = config
            .client
            .post(&config.base_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&serde_json::json!({
                "query": query,
                "search_depth": "basic",
                "max_results": config.max_results,
                "include_answer": "basic",
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("tavily search failed: status={} body={}", status, body));
        }

        let result: TavilySearchResponse = response.json().await?;
        let context = format_search_results_as_context(&result);
        if context.is_empty() {
            return Ok(None);
        }
        Ok(Some(context))
    }

    #[cfg(test)]
    fn prime_research_cache_for_tests(&self, request: &LessonGenerationRequest, value: &str) {
        let key = request_research_cache_key(request);
        if let Ok(mut cache) = self.research_cache.lock() {
            cache.insert(key, Some(value.to_string()));
        }
    }

    async fn generate_interactive_scientific_model(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        research_context: &Option<String>,
    ) -> Option<ScientificModel> {
        let config = outline.interactive_config.as_ref()?;
        let system =
            "You are a scientific concept modeler for educational interactives. Return strict JSON only.";
        let user = format!(
            "Create a scientific model for an educational interactive.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Concept name: {}\n\
             Concept overview: {}\n\
             Design idea: {}\n\
             Key points: {}\n\
             {}\n\
             Return JSON object with shape {{\"core_formulas\":[\"...\"],\"mechanism\":[\"...\"],\"constraints\":[\"...\"],\"forbidden_errors\":[\"...\"],\"variables\":[\"...\"],\"interaction_guidance\":[\"...\"],\"experiment_steps\":[\"...\"],\"observation_prompts\":[\"...\"]}}.\n\
             Focus on scientifically valid relationships, important constraints, common misconceptions to avoid, interactive guidance the HTML simulator must obey, a short experiment sequence, and observation prompts students should answer.",
            request.requirements.requirement,
            outline.title,
            config.concept_name,
            config.concept_overview,
            config.design_idea,
            outline.key_points.join(" | "),
            research_context_prompt(research_context)
        );

        let response = self.generate_with_retry(system, &user).await.ok()?;
        let parsed: ScientificModelEnvelope = parse_json_with_repair(&response).ok()?;
        if parsed.core_formulas.is_empty()
            && parsed.mechanism.is_empty()
            && parsed.constraints.is_empty()
            && parsed.forbidden_errors.is_empty()
            && parsed.variables.is_empty()
            && parsed.interaction_guidance.is_empty()
            && parsed.experiment_steps.is_empty()
            && parsed.observation_prompts.is_empty()
        {
            return None;
        }
        let mut scientific_model = ScientificModel {
            core_formulas: parsed.core_formulas,
            mechanism: parsed.mechanism,
            constraints: parsed.constraints,
            forbidden_errors: parsed.forbidden_errors,
            variables: parsed.variables,
            interaction_guidance: parsed.interaction_guidance,
            experiment_steps: parsed.experiment_steps,
            observation_prompts: parsed.observation_prompts,
        };

        if let Some(revision_notes) = scientific_model_revision_notes(&scientific_model) {
            if let Some(revised) = self
                .revise_interactive_scientific_model(
                    request,
                    outline,
                    &scientific_model,
                    &revision_notes,
                    research_context,
                )
                .await
            {
                scientific_model = merge_scientific_models(scientific_model, revised);
            }
        }

        Some(scientific_model)
    }

    async fn revise_interactive_scientific_model(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        current: &ScientificModel,
        revision_notes: &str,
        research_context: &Option<String>,
    ) -> Option<ScientificModel> {
        let config = outline.interactive_config.as_ref()?;
        let system =
            "You revise scientific models for educational interactives. Return strict JSON only.";
        let user = format!(
            "Revise this scientific model so it is complete and classroom-usable.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Concept name: {}\n\
             Concept overview: {}\n\
             Design idea: {}\n\
             Key points: {}\n\
             {}\n\
             Current model summary:\n{}\n\
             Revision requirements:\n{}\n\
             Return JSON object with shape {{\"core_formulas\":[\"...\"],\"mechanism\":[\"...\"],\"constraints\":[\"...\"],\"forbidden_errors\":[\"...\"],\"variables\":[\"...\"],\"interaction_guidance\":[\"...\"],\"experiment_steps\":[\"...\"],\"observation_prompts\":[\"...\"]}}.",
            request.requirements.requirement,
            outline.title,
            config.concept_name,
            config.concept_overview,
            config.design_idea,
            outline.key_points.join(" | "),
            research_context_prompt(research_context),
            interactive_scientific_constraints(&Some(current.clone())),
            revision_notes,
        );

        let response = self.generate_with_retry(system, &user).await.ok()?;
        let parsed: ScientificModelEnvelope = parse_json_with_repair(&response).ok()?;
        Some(ScientificModel {
            core_formulas: parsed.core_formulas,
            mechanism: parsed.mechanism,
            constraints: parsed.constraints,
            forbidden_errors: parsed.forbidden_errors,
            variables: parsed.variables,
            interaction_guidance: parsed.interaction_guidance,
            experiment_steps: parsed.experiment_steps,
            observation_prompts: parsed.observation_prompts,
        })
    }
}

const MAX_LLM_ATTEMPTS: usize = 3;
const RETRY_BACKOFF_MS: u64 = 150;
const TAVILY_SOFT_MAX_QUERY_LENGTH: usize = 400;
const SEARCH_QUERY_REWRITE_EXCERPT_LENGTH: usize = 7000;

#[derive(Deserialize)]
struct OutlineEnvelope {
    outlines: Vec<OutlineDto>,
}

#[derive(Deserialize)]
struct OutlineDto {
    title: String,
    description: String,
    #[serde(default, alias = "teachingObjective", alias = "teaching_objective")]
    teaching_objective: Option<String>,
    #[serde(default, alias = "estimatedDuration", alias = "estimated_duration")]
    estimated_duration: Option<i32>,
    #[serde(default, alias = "order")]
    order: Option<i32>,
    #[serde(default, alias = "suggestedImageIds", alias = "suggested_image_ids")]
    suggested_image_ids: Vec<String>,
    key_points: Vec<String>,
    #[serde(alias = "type", alias = "sceneType")]
    scene_type: String,
    #[serde(default)]
    media_generations: Vec<MediaGenerationDto>,
    #[serde(default, alias = "quizConfig", alias = "quiz_config")]
    quiz_config: Option<QuizConfigDto>,
    #[serde(default, alias = "interactiveConfig", alias = "interactive_config")]
    interactive_config: Option<InteractiveConfigDto>,
    #[serde(
        default,
        alias = "pblConfig",
        alias = "projectConfig",
        alias = "project_config"
    )]
    project_config: Option<ProjectOutlineConfigDto>,
}

#[derive(Deserialize)]
struct MediaGenerationDto {
    element_id: String,
    media_type: String,
    prompt: String,
    aspect_ratio: Option<String>,
}

#[derive(Deserialize)]
struct SlideContentEnvelope {
    elements: Vec<SlideElementDto>,
}

#[derive(Deserialize)]
struct SlideElementDto {
    #[serde(alias = "type")]
    kind: String,
    #[serde(default)]
    id: Option<String>,
    content: Option<String>,
    src: Option<String>,
    #[serde(default)]
    latex: Option<String>,
    #[serde(default, alias = "shapeName", alias = "shape_name")]
    shape_name: Option<String>,
    #[serde(default, alias = "chartType", alias = "chart_type")]
    chart_type: Option<String>,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
}

#[derive(Deserialize)]
struct QuizContentEnvelope {
    questions: Vec<QuizQuestionDto>,
}

#[derive(Deserialize)]
struct InteractiveContentEnvelope {
    html: Option<String>,
    url: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct ProjectContentEnvelope {
    summary: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default, alias = "drivingQuestion", alias = "driving_question")]
    driving_question: Option<String>,
    #[serde(default, alias = "finalDeliverable", alias = "final_deliverable")]
    final_deliverable: Option<String>,
    #[serde(default, alias = "targetSkills", alias = "target_skills")]
    target_skills: Option<Vec<String>>,
    #[serde(default)]
    milestones: Option<Vec<String>>,
    #[serde(default, alias = "teamRoles", alias = "team_roles")]
    team_roles: Option<Vec<String>>,
    #[serde(default, alias = "assessmentFocus", alias = "assessment_focus")]
    assessment_focus: Option<Vec<String>>,
    #[serde(default, alias = "starterPrompt", alias = "starter_prompt")]
    starter_prompt: Option<String>,
    #[serde(default, alias = "successCriteria", alias = "success_criteria")]
    success_criteria: Option<Vec<String>>,
    #[serde(default, alias = "facilitatorNotes", alias = "facilitator_notes")]
    facilitator_notes: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct ProjectRolePlanEnvelope {
    #[serde(default, alias = "agentRoles", alias = "agent_roles")]
    agent_roles: Vec<ProjectAgentRoleEnvelope>,
    #[serde(default, alias = "successCriteria", alias = "success_criteria")]
    success_criteria: Vec<String>,
    #[serde(default, alias = "facilitatorNotes", alias = "facilitator_notes")]
    facilitator_notes: Vec<String>,
}

#[derive(Deserialize)]
struct ProjectAgentRoleEnvelope {
    name: String,
    responsibility: String,
    #[serde(default)]
    deliverable: Option<String>,
}

#[derive(Deserialize)]
struct ProjectIssueBoardEnvelope {
    #[serde(default, alias = "issueBoard", alias = "issue_board")]
    issue_board: Vec<ProjectIssueEnvelope>,
}

#[derive(Deserialize)]
struct ProjectIssueEnvelope {
    title: String,
    description: String,
    #[serde(default, alias = "ownerRole", alias = "owner_role")]
    owner_role: Option<String>,
    #[serde(default)]
    checkpoints: Vec<String>,
}

#[derive(Deserialize)]
struct QuizQuestionDto {
    question: String,
    options: Option<Vec<String>>,
    answer: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct ActionsEnvelope {
    actions: Vec<ActionDto>,
}

#[derive(Deserialize)]
struct ActionDto {
    action_type: String,
    text: Option<String>,
    element_id: Option<String>,
    topic: Option<String>,
}

#[derive(Deserialize)]
struct QuizConfigDto {
    #[serde(default, alias = "questionCount", alias = "question_count")]
    question_count: Option<i32>,
    #[serde(default)]
    difficulty: Option<String>,
    #[serde(default, alias = "questionTypes", alias = "question_types")]
    question_types: Vec<String>,
}

#[derive(Deserialize)]
struct InteractiveConfigDto {
    #[serde(default, alias = "conceptName", alias = "concept_name")]
    concept_name: Option<String>,
    #[serde(default, alias = "conceptOverview", alias = "concept_overview")]
    concept_overview: Option<String>,
    #[serde(default, alias = "designIdea", alias = "design_idea")]
    design_idea: Option<String>,
    #[serde(default)]
    subject: Option<String>,
}

#[derive(Deserialize)]
struct ProjectOutlineConfigDto {
    #[serde(default, alias = "projectTopic", alias = "project_topic")]
    project_topic: Option<String>,
    #[serde(default, alias = "projectDescription", alias = "project_description")]
    project_description: Option<String>,
    #[serde(default, alias = "targetSkills", alias = "target_skills")]
    target_skills: Vec<String>,
    #[serde(default, alias = "issueCount", alias = "issue_count")]
    issue_count: Option<i32>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StructuredActionItemDto {
    Text {
        content: String,
    },
    Action {
        name: String,
        #[serde(default)]
        params: Option<Value>,
        #[serde(default, alias = "tool_name")]
        tool_name: Option<String>,
        #[serde(default, alias = "parameters")]
        parameters: Option<Value>,
    },
}

#[derive(Deserialize)]
struct ScientificModelEnvelope {
    #[serde(default)]
    core_formulas: Vec<String>,
    #[serde(default)]
    mechanism: Vec<String>,
    #[serde(default)]
    constraints: Vec<String>,
    #[serde(default, alias = "forbiddenErrors", alias = "forbidden_errors")]
    forbidden_errors: Vec<String>,
    #[serde(default)]
    variables: Vec<String>,
    #[serde(default, alias = "interactionGuidance", alias = "interaction_guidance")]
    interaction_guidance: Vec<String>,
    #[serde(default, alias = "experimentSteps", alias = "experiment_steps")]
    experiment_steps: Vec<String>,
    #[serde(default, alias = "observationPrompts", alias = "observation_prompts")]
    observation_prompts: Vec<String>,
}

#[async_trait]
impl LessonGenerationPipeline for LlmGenerationPipeline {
    async fn generate_outlines(
        &self,
        request: &LessonGenerationRequest,
    ) -> Result<Vec<SceneOutline>> {
        let language = language_code(&request.requirements.language);
        let research_context = self.research_context_for_request(request).await;
        let system = "You are an instructional designer. Return strict JSON only.";
        let user = format!(
    "Create a lesson outline for this requirement.
     Requirement: {}
     Language: {}
     {}
     Infer a coherent 15-30 minute classroom flow unless the requirement implies otherwise.
     Return JSON object with shape {{\"outlines\":[{{\"title\":\"...\",\"description\":\"...\",\"teaching_objective\":\"...\",\"estimated_duration\":120,\"order\":1,\"key_points\":[\"...\"],\"scene_type\":\"slide|quiz|interactive|pbl\",\"suggested_image_ids\":[\"img_1\"],\"quiz_config\":{{\"question_count\":2,\"difficulty\":\"easy|medium|hard\",\"question_types\":[\"single\",\"multiple\"]}},\"interactive_config\":{{\"concept_name\":\"...\",\"concept_overview\":\"...\",\"design_idea\":\"...\",\"subject\":\"...\"}},\"project_config\":{{\"project_topic\":\"...\",\"project_description\":\"...\",\"target_skills\":[\"...\"],\"issue_count\":3,\"language\":\"{}\"}},\"media_generations\":[{{\"element_id\":\"gen_img_1\",\"media_type\":\"image|video\",\"prompt\":\"...\",\"aspect_ratio\":\"16:9\"}}]}}]}}.
     Use 3 to 6 scenes with a logical flow, include at least one quiz scene, and use interactive or pbl scenes only when the concept truly benefits from them.
     Keep key points concrete and scene-specific rather than generic.
     
     VISUAL STYLE DIRECTIVE:
     - Emulate a high-density, modern technical explainer aesthetic.
     - Use structured diagrammatic elements: color-coded blocks, flow arrows, and geometric hierarchies.
     - Prioritize layout-driven storytelling (e.g., 'System Maps', 'Logic Gates', 'Data Pipelines') over decorative art.
     - Only use `media_generations` if the concept is impossible to explain with shapes and text (e.g., a specific real-world object).
     
     Image generation enabled: {}.
     Video generation enabled: {}.
     If image generation is enabled, you may request 0 or 1 generated image for a slide scene.
     If video generation is disabled, do not request video media.",
    request.requirements.requirement,
    language,
    research_context_prompt(&research_context),
    language,
    request.enable_image_generation,
    request.enable_video_generation
);


        let response = self
            .generate_with_retry_using(self.outlines_llm(), system, &user)
            .await?;
        let payload: OutlineEnvelope = parse_json_with_repair(&response)
            .unwrap_or_else(|_| OutlineEnvelope { outlines: vec![] });

        let outlines = payload
            .outlines
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let scene_type = map_scene_type(&item.scene_type);
                let title = item.title;
                let description = item.description;
                let key_points = item.key_points;
                let media_generations = ensure_outline_media_generations(
                    &scene_type,
                    &title,
                    &description,
                    &key_points,
                    item.media_generations
                        .into_iter()
                        .filter_map(map_media_generation)
                        .filter(|media| match media.media_type {
                            MediaType::Image => request.enable_image_generation,
                            MediaType::Video => request.enable_video_generation,
                        })
                        .collect(),
                    request,
                    index,
                );
                let quiz_config = normalize_quiz_config(item.quiz_config, &scene_type);
                let interactive_config = normalize_interactive_config(
                    item.interactive_config,
                    &scene_type,
                    &title,
                    &description,
                );
                let project_config = normalize_project_outline_config(
                    item.project_config,
                    &scene_type,
                    &title,
                    &description,
                    &key_points,
                    language,
                );

                SceneOutline {
                    id: format!("outline-{}", index + 1),
                    scene_type,
                    title,
                    description,
                    key_points,
                    teaching_objective: item.teaching_objective,
                    estimated_duration: item.estimated_duration,
                    order: item.order.unwrap_or((index + 1) as i32),
                    language: Some(language.to_string()),
                    suggested_image_ids: item.suggested_image_ids,
                    media_generations,
                    quiz_config,
                    interactive_config,
                    project_config,
                }
            })
            .collect::<Vec<_>>();

        if outlines.is_empty() {
            return Ok(fallback_outlines(request));
        }

        Ok(outlines)
    }

    async fn generate_scene_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
    ) -> Result<SceneContent> {
        match outline.scene_type {
            SceneType::Slide => self.generate_slide_content(request, outline).await,
            SceneType::Quiz => self.generate_quiz_content(request, outline).await,
            SceneType::Interactive => self.generate_interactive_content(request, outline).await,
            SceneType::Pbl => self.generate_project_content(request, outline).await,
        }
    }

    async fn generate_scene_actions(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        content: &SceneContent,
    ) -> Result<Vec<LessonAction>> {
        let research_context = self.research_context_for_request(request).await;
        let (system, user) =
            build_scene_action_prompt(request, outline, content, &research_context)?;

        let primary_response = self
            .generate_with_retry_using(self.scene_actions_llm(), &system, &user)
            .await?;
        let mut actions =
            parse_actions_from_generation_response(&primary_response, outline, content);

        let needs_escalation = actions.is_empty();
        if needs_escalation {
            if let Some(fallback_llm) = self.scene_actions_fallback_llm.as_deref() {
                let fallback_response = self
                    .generate_with_retry_using(fallback_llm, &system, &user)
                    .await?;
                let fallback_actions =
                    parse_actions_from_generation_response(&fallback_response, outline, content);
                if !fallback_actions.is_empty() {
                    actions = fallback_actions;
                }
            }
        }

        if actions.is_empty() {
            actions.push(LessonAction::Speech {
                id: "action-fallback-speech".to_string(),
                title: Some(outline.title.clone()),
                description: Some("Fallback narration".to_string()),
                text: outline.description.clone(),
                audio_id: None,
                audio_url: None,
                voice: None,
                speed: None,
            });
        }

        enforce_discussion_last(&mut actions);
        Ok(actions)
    }
}

impl LlmGenerationPipeline {
    async fn generate_slide_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
    ) -> Result<SceneContent> {
        let language = language_code(&request.requirements.language);
        let research_context = self.research_context_for_request(request).await;
        let system = "You are a slide designer. Return strict JSON only. Slides are visual aids, not lecture scripts. Keep on-slide text concise, scannable, and layout-aware.";
        let user = format!(
            "Create slide elements for a teaching slide.\n\
             Lesson requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Teaching objective: {}\n\
             Key points: {}\n\
             {}\n\
             Media placeholders available for this slide: {}.\n\
             Canvas size: 1000x563.\n\
             Return JSON object with shape {{\"elements\":[{{\"id\":\"optional\",\"kind\":\"text|image|video|shape|line|chart|latex|table\",\"content\":\"optional\",\"src\":\"optional\",\"latex\":\"optional\",\"shape_name\":\"optional\",\"chart_type\":\"optional\",\"left\":0,\"top\":0,\"width\":0,\"height\":0}}]}}.\n\
             Use a strong visual hierarchy: title near the top, and 2-5 concise content elements.\n\
             CRITICAL: Emulate a modern visual explainer (like ByteMonk). Use very modern, structured diagrammatical shapes, vibrant colors, and layout components to explain concepts visually.\n\
             Prefer `shape`, `line`, `chart`, and `table` elements to build visual intuition. Use `image` or `video` media placeholders ONLY if they are provided and strictly necessary.\n\
             Keep every on-slide text element concise. Prefer phrases or bullet-style summaries instead of spoken paragraphs.\n\
             If a media placeholder exists, create an image or video element using its exact `src` placeholder value.\n\
             Text must stay within the canvas margins, and all dimensions must be positive.\n\
             Language: {}",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline
                .teaching_objective
                .as_deref()
                .unwrap_or("Build understanding of the scene topic"),
            outline.key_points.join(" | "),
            research_context_prompt(&research_context),
            media_generation_summary(outline),
            language
        );

        let response = self.generate_with_retry(system, &user).await?;
        let payload: SlideContentEnvelope = parse_json_with_repair(&response)
            .unwrap_or_else(|_| SlideContentEnvelope { elements: vec![] });

        let elements = payload
            .elements
            .into_iter()
            .enumerate()
            .map(|(index, element)| map_slide_element(element, index))
            .collect::<Vec<_>>();
        let elements = if elements.is_empty() {
            fallback_slide_elements(outline)
        } else {
            let elements = repair_media_elements(elements, outline);
            let elements = attach_media_placeholders(elements, outline);
            validate_slide_elements(elements, outline)
        };

        Ok(SceneContent::Slide {
            canvas: SlideCanvas {
                id: format!("canvas-{}", outline.id),
                viewport_width: 1000,
                viewport_height: 563,
                viewport_ratio: 0.5625,
                theme: SlideTheme {
                    background_color: "#ffffff".to_string(),
                    theme_colors: vec![
                        "#1f2937".to_string(),
                        "#0f766e".to_string(),
                        "#2563eb".to_string(),
                    ],
                    font_color: "#111827".to_string(),
                    font_name: "Geist".to_string(),
                },
                elements,
                background: None,
            },
        })
    }

    async fn generate_quiz_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
    ) -> Result<SceneContent> {
        let research_context = self.research_context_for_request(request).await;
        let system = "You are a quiz generator. Return strict JSON only.";
        let user = format!(
            "Create quiz questions for this lesson scene.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Key points: {}\n\
             {}\n\
             Return JSON object with shape {{\"questions\":[{{\"question\":\"...\",\"options\":[\"...\"],\"answer\":[\"...\"]}}]}}.\n\
             Use 2 or 3 multiple-choice questions.",
            request.requirements.requirement,
            outline.title,
            outline.key_points.join(" | "),
            research_context_prompt(&research_context)
        );

        let response = self.generate_with_retry(system, &user).await?;
        let payload: QuizContentEnvelope = parse_json_with_repair(&response)
            .unwrap_or_else(|_| QuizContentEnvelope { questions: vec![] });
        let questions = if payload.questions.is_empty() {
            fallback_quiz_questions(outline)
        } else {
            payload.questions
        };

        Ok(SceneContent::Quiz {
            questions: questions
                .into_iter()
                .enumerate()
                .map(|(index, question)| QuizQuestion {
                    id: format!("question-{}-{}", outline.id, index + 1),
                    question_type: QuizQuestionType::Single,
                    question: question.question,
                    options: question.options.map(|options| {
                        options
                            .into_iter()
                            .enumerate()
                            .map(|(option_index, label)| QuizOption {
                                value: ((b'A' + option_index as u8) as char).to_string(),
                                label,
                            })
                            .collect()
                    }),
                    answer: question.answer,
                    analysis: None,
                    comment_prompt: None,
                    has_answer: Some(true),
                    points: Some(1),
                })
                .collect(),
        })
    }

    async fn generate_interactive_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
    ) -> Result<SceneContent> {
        let research_context = self.research_context_for_request(request).await;
        let scientific_model = self
            .generate_interactive_scientific_model(request, outline, &research_context)
            .await;
        let system = "You are a professional educational interactive web developer. Return a complete self-contained HTML document.";
        let user = format!(
            "Create interactive scene HTML.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Scientific constraints:\n{}\n\
             Return a complete HTML5 document directly. The page must be self-contained, safe, responsive, and use plain HTML/CSS/JavaScript only.\n\
             The interaction should guide students from simple observation to active exploration. Include concise instructions, visible controls, and immediate feedback.\n\
             Keep the experience classroom-friendly and in {}.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(&research_context),
            interactive_scientific_constraints(&scientific_model),
            language_code(&request.requirements.language)
        );

        let response = self.generate_with_retry(system, &user).await?;
        let payload: InteractiveContentEnvelope =
            parse_json_with_repair(&response).unwrap_or(InteractiveContentEnvelope {
                html: None,
                url: None,
            });

        let mut html = payload
            .html
            .or_else(|| extract_html_document(&response))
            .unwrap_or_else(|| fallback_interactive_html(outline, scientific_model.as_ref()));
        html = post_process_interactive_html(&html, outline, scientific_model.as_ref());

        if let Some(repair_notes) = interactive_html_repair_notes(&html) {
            if let Ok(repaired) = self
                .repair_interactive_html(
                    request,
                    outline,
                    scientific_model.as_ref(),
                    &html,
                    &repair_notes,
                    &research_context,
                )
                .await
            {
                html = repaired;
            }
        }

        Ok(SceneContent::Interactive {
            url: payload.url.unwrap_or_default(),
            html: Some(html),
            scientific_model,
        })
    }

    async fn generate_project_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
    ) -> Result<SceneContent> {
        let research_context = self.research_context_for_request(request).await;
        let system = "You design structured project-based learning plans. Return strict JSON only.";
        let user = format!(
            "Create a structured project plan for a PBL scene.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Project outline config: {}\n\
             Return JSON object with shape {{\"summary\":\"...\",\"title\":\"...\",\"driving_question\":\"...\",\"final_deliverable\":\"...\",\"target_skills\":[\"...\"],\"milestones\":[\"...\"],\"team_roles\":[\"...\"],\"assessment_focus\":[\"...\"],\"starter_prompt\":\"...\"}}.\n\
             Make it classroom-usable: include a clear driving question, a concrete deliverable, 3-5 milestones, useful team roles, and concise assessment criteria.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(&research_context),
            project_outline_summary(outline)
        );

        let response = self.generate_with_retry(system, &user).await?;
        let mut payload: ProjectContentEnvelope =
            parse_json_with_repair(&response).unwrap_or(ProjectContentEnvelope {
                summary: fallback_project_summary(outline),
                title: None,
                driving_question: None,
                final_deliverable: None,
                target_skills: None,
                milestones: None,
                team_roles: None,
                assessment_focus: None,
                starter_prompt: None,
                success_criteria: None,
                facilitator_notes: None,
            });
        if let Some(revision_notes) = project_content_revision_notes(&payload) {
            if let Ok(revised) = self
                .revise_project_content(
                    request,
                    outline,
                    &payload,
                    &revision_notes,
                    &research_context,
                )
                .await
            {
                payload = merge_project_content(payload, revised);
            }
        }
        let project_title = payload
            .title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(outline.title.as_str())
            .to_string();
        let project_summary = if payload.summary.trim().is_empty() {
            fallback_project_summary(outline)
        } else {
            payload.summary.clone()
        };

        let role_plan = self
            .generate_project_role_plan(
                request,
                outline,
                &project_title,
                &project_summary,
                &payload,
                &research_context,
            )
            .await
            .ok();
        let issue_board = self
            .generate_project_issue_board(
                request,
                outline,
                &project_title,
                &project_summary,
                role_plan.as_ref(),
                &research_context,
            )
            .await
            .ok();

        Ok(SceneContent::Project {
            project_config: ProjectConfig {
                summary: project_summary,
                title: Some(project_title),
                driving_question: payload
                    .driving_question
                    .filter(|value| !value.trim().is_empty()),
                final_deliverable: payload
                    .final_deliverable
                    .filter(|value| !value.trim().is_empty()),
                target_skills: payload.target_skills.filter(|value| !value.is_empty()),
                milestones: payload.milestones.filter(|value| !value.is_empty()),
                team_roles: payload.team_roles.filter(|value| !value.is_empty()),
                assessment_focus: payload.assessment_focus.filter(|value| !value.is_empty()),
                starter_prompt: payload
                    .starter_prompt
                    .filter(|value| !value.trim().is_empty()),
                success_criteria: role_plan
                    .as_ref()
                    .and_then(|plan| {
                        (!plan.success_criteria.is_empty()).then(|| plan.success_criteria.clone())
                    })
                    .or_else(|| payload.success_criteria.filter(|value| !value.is_empty())),
                facilitator_notes: role_plan
                    .as_ref()
                    .and_then(|plan| {
                        (!plan.facilitator_notes.is_empty()).then(|| plan.facilitator_notes.clone())
                    })
                    .or_else(|| payload.facilitator_notes.filter(|value| !value.is_empty())),
                agent_roles: role_plan.and_then(|plan| map_project_agent_roles(plan.agent_roles)),
                issue_board: issue_board.and_then(|plan| map_project_issue_board(plan.issue_board)),
            },
        })
    }

    async fn repair_interactive_html(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        scientific_model: Option<&ScientificModel>,
        html: &str,
        repair_notes: &str,
        research_context: &Option<String>,
    ) -> Result<String> {
        let system = "You repair educational interactive HTML. Return a complete self-contained HTML document only.";
        let user = format!(
            "Repair this educational interactive so it is classroom-usable.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Scientific constraints:\n{}\n\
             Repair requirements:\n{}\n\
             Existing HTML:\n{}\n\
             Return a complete repaired HTML5 document using only plain HTML/CSS/JavaScript. Keep the interaction safe, responsive, and immediately usable for students.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(research_context),
            interactive_scientific_constraints(&scientific_model.cloned()),
            repair_notes,
            html
        );
        let response = self.generate_with_retry(system, &user).await?;
        let repaired = extract_html_document(&response).unwrap_or(response);
        Ok(post_process_interactive_html(
            &repaired,
            outline,
            scientific_model,
        ))
    }

    async fn generate_project_role_plan(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        project_title: &str,
        project_summary: &str,
        payload: &ProjectContentEnvelope,
        research_context: &Option<String>,
    ) -> Result<ProjectRolePlanEnvelope> {
        let system = "You are a PBL facilitation designer. Return strict JSON only.";
        let user = format!(
            "Create the collaboration plan for this classroom PBL project.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Project title: {}\n\
             Project summary: {}\n\
             Driving question: {}\n\
             Deliverable: {}\n\
             Milestones: {}\n\
             {}\n\
             Return JSON object with shape {{\"agent_roles\":[{{\"name\":\"...\",\"responsibility\":\"...\",\"deliverable\":\"optional\"}}],\"success_criteria\":[\"...\"],\"facilitator_notes\":[\"...\"]}}.\n\
             Create 2-4 agent roles, 3-5 success criteria, and 2-4 concise facilitator notes. Keep it concrete and classroom-manageable.",
            request.requirements.requirement,
            outline.title,
            project_title,
            project_summary,
            payload.driving_question.as_deref().unwrap_or("Not specified"),
            payload.final_deliverable.as_deref().unwrap_or("Not specified"),
            payload
                .milestones
                .as_ref()
                .map(|items| items.join(" | "))
                .unwrap_or_else(|| "Not specified".to_string()),
            research_context_prompt(research_context),
        );
        let response = self.generate_with_retry(system, &user).await?;
        parse_json_with_repair(&response)
    }

    async fn revise_project_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        payload: &ProjectContentEnvelope,
        revision_notes: &str,
        research_context: &Option<String>,
    ) -> Result<ProjectContentEnvelope> {
        let system = "You revise classroom PBL plans. Return strict JSON only.";
        let user = format!(
            "Revise this classroom PBL plan so it is complete and facilitation-ready.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Current plan JSON: {}\n\
             Revision requirements:\n{}\n\
             Return JSON object with shape {{\"summary\":\"...\",\"title\":\"...\",\"driving_question\":\"...\",\"final_deliverable\":\"...\",\"target_skills\":[\"...\"],\"milestones\":[\"...\"],\"team_roles\":[\"...\"],\"assessment_focus\":[\"...\"],\"starter_prompt\":\"...\",\"success_criteria\":[\"...\"],\"facilitator_notes\":[\"...\"]}}.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(research_context),
            serde_json::to_string(payload).unwrap_or_default(),
            revision_notes,
        );
        let response = self.generate_with_retry(system, &user).await?;
        parse_json_with_repair(&response)
    }

    async fn generate_project_issue_board(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        project_title: &str,
        project_summary: &str,
        role_plan: Option<&ProjectRolePlanEnvelope>,
        research_context: &Option<String>,
    ) -> Result<ProjectIssueBoardEnvelope> {
        let roles_summary = role_plan
            .map(|plan| {
                plan.agent_roles
                    .iter()
                    .map(|role| format!("{} => {}", role.name, role.responsibility))
                    .collect::<Vec<_>>()
                    .join(" | ")
            })
            .unwrap_or_else(|| "No roles available".to_string());
        let issue_count = outline
            .project_config
            .as_ref()
            .and_then(|config| config.issue_count)
            .unwrap_or(3)
            .clamp(2, 5);
        let system =
            "You are a project issue-board planner for classroom PBL. Return strict JSON only.";
        let user = format!(
            "Create a small issue board for this classroom project.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Project title: {}\n\
             Project summary: {}\n\
             Key points: {}\n\
             Available roles: {}\n\
             {}\n\
             Return JSON object with shape {{\"issue_board\":[{{\"title\":\"...\",\"description\":\"...\",\"owner_role\":\"optional\",\"checkpoints\":[\"...\"]}}]}}.\n\
             Create exactly {} issues representing the major work packages students must complete. Each issue should include 2-4 checkpoints.",
            request.requirements.requirement,
            outline.title,
            project_title,
            project_summary,
            outline.key_points.join(" | "),
            roles_summary,
            research_context_prompt(research_context),
            issue_count,
        );
        let response = self.generate_with_retry(system, &user).await?;
        parse_json_with_repair(&response)
    }
}

fn parse_actions_from_generation_response(
    response: &str,
    outline: &SceneOutline,
    content: &SceneContent,
) -> Vec<LessonAction> {
    let mut actions = parse_structured_actions(response, outline, content).unwrap_or_default();
    if actions.is_empty() {
        let legacy_payload: ActionsEnvelope = parse_json_with_repair(response)
            .unwrap_or_else(|_| ActionsEnvelope { actions: vec![] });
        actions = legacy_payload
            .actions
            .into_iter()
            .enumerate()
            .filter_map(|(index, action)| map_action(action, index))
            .collect::<Vec<_>>();
    }
    actions
}

fn map_scene_type(value: &str) -> SceneType {
    match value.trim().to_ascii_lowercase().as_str() {
        "quiz" => SceneType::Quiz,
        "interactive" => SceneType::Interactive,
        "pbl" | "project" => SceneType::Pbl,
        _ => SceneType::Slide,
    }
}

fn normalize_quiz_config(
    config: Option<QuizConfigDto>,
    scene_type: &SceneType,
) -> Option<QuizConfig> {
    if !matches!(scene_type, SceneType::Quiz) {
        return None;
    }
    let config = config.unwrap_or(QuizConfigDto {
        question_count: Some(2),
        difficulty: Some("medium".to_string()),
        question_types: vec!["single".to_string()],
    });
    Some(QuizConfig {
        question_count: config.question_count.unwrap_or(2).max(1),
        difficulty: config
            .difficulty
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "medium".to_string()),
        question_types: if config.question_types.is_empty() {
            vec!["single".to_string()]
        } else {
            config.question_types
        },
    })
}

fn normalize_interactive_config(
    config: Option<InteractiveConfigDto>,
    scene_type: &SceneType,
    title: &str,
    description: &str,
) -> Option<InteractiveConfig> {
    if !matches!(scene_type, SceneType::Interactive) {
        return None;
    }
    let config = config.unwrap_or(InteractiveConfigDto {
        concept_name: Some(title.to_string()),
        concept_overview: Some(description.to_string()),
        design_idea: Some(
            "Interactive exploration with guided manipulation and immediate feedback".to_string(),
        ),
        subject: None,
    });
    Some(InteractiveConfig {
        concept_name: config
            .concept_name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| title.to_string()),
        concept_overview: config
            .concept_overview
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| description.to_string()),
        design_idea: config
            .design_idea
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                "Interactive exploration with guided manipulation and immediate feedback"
                    .to_string()
            }),
        subject: config.subject,
    })
}

fn normalize_project_outline_config(
    config: Option<ProjectOutlineConfigDto>,
    scene_type: &SceneType,
    title: &str,
    description: &str,
    key_points: &[String],
    language: &str,
) -> Option<ProjectOutlineConfig> {
    if !matches!(scene_type, SceneType::Pbl) {
        return None;
    }
    let config = config.unwrap_or(ProjectOutlineConfigDto {
        project_topic: Some(title.to_string()),
        project_description: Some(description.to_string()),
        target_skills: key_points.iter().take(3).cloned().collect(),
        issue_count: Some(3),
        language: Some(language.to_string()),
    });
    Some(ProjectOutlineConfig {
        project_topic: config
            .project_topic
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| title.to_string()),
        project_description: config
            .project_description
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| description.to_string()),
        target_skills: if config.target_skills.is_empty() {
            key_points.iter().take(3).cloned().collect()
        } else {
            config.target_skills
        },
        issue_count: config.issue_count.or(Some(3)),
        language: config
            .language
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| language.to_string()),
    })
}

fn map_media_generation(media: MediaGenerationDto) -> Option<MediaGenerationRequest> {
    let media_type = match media.media_type.trim().to_ascii_lowercase().as_str() {
        "image" => MediaType::Image,
        "video" => MediaType::Video,
        _ => return None,
    };

    if media.element_id.trim().is_empty() || media.prompt.trim().is_empty() {
        return None;
    }

    Some(MediaGenerationRequest {
        element_id: media.element_id,
        media_type,
        prompt: media.prompt,
        aspect_ratio: media.aspect_ratio,
    })
}

fn map_slide_element(element: SlideElementDto, index: usize) -> SlideElement {
    let id = element
        .id
        .unwrap_or_else(|| format!("element-{}", index + 1));
    match element.kind.trim().to_ascii_lowercase().as_str() {
        "image" => SlideElement::Image {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
            src: element.src.unwrap_or_default(),
        },
        "video" => SlideElement::Video {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
            src: element.src.unwrap_or_default(),
        },
        "shape" => SlideElement::Shape {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
            shape_name: element.shape_name,
        },
        "line" => SlideElement::Line {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
        },
        "chart" => SlideElement::Chart {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
            chart_type: element.chart_type,
        },
        "latex" => SlideElement::Latex {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
            latex: element.latex.unwrap_or_default(),
        },
        "table" => SlideElement::Table {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
        },
        _ => SlideElement::Text {
            id,
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
            content: element.content.unwrap_or_default(),
        },
    }
}

fn ensure_outline_media_generations(
    scene_type: &SceneType,
    title: &str,
    description: &str,
    key_points: &[String],
    mut media_generations: Vec<MediaGenerationRequest>,
    request: &LessonGenerationRequest,
    index: usize,
) -> Vec<MediaGenerationRequest> {
    if !request.enable_image_generation || !matches!(scene_type, SceneType::Slide) {
        return media_generations;
    }

    let has_image = media_generations
        .iter()
        .any(|media| matches!(media.media_type, MediaType::Image));
    if has_image {
        return media_generations;
    }

    media_generations.push(MediaGenerationRequest {
        element_id: format!("gen_img_{}", index + 1),
        media_type: MediaType::Image,
        prompt: build_fallback_image_prompt(title, description, key_points),
        aspect_ratio: Some("16:9".to_string()),
    });
    media_generations
}

fn attach_media_placeholders(
    mut elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    let mut next_index = elements.len();

    for media in outline.media_generations.iter() {
        let exists = elements
            .iter()
            .any(|element| match (element, &media.media_type) {
                (SlideElement::Image { src, .. }, MediaType::Image)
                | (SlideElement::Video { src, .. }, MediaType::Video) => src == &media.element_id,
                _ => false,
            });

        if exists {
            continue;
        }

        next_index += 1;
        match media.media_type {
            MediaType::Image => elements.push(SlideElement::Image {
                id: media.element_id.clone(),
                left: 620.0,
                top: 120.0,
                width: 300.0,
                height: 220.0,
                src: media.element_id.clone(),
            }),
            MediaType::Video => elements.push(SlideElement::Video {
                id: media.element_id.clone(),
                left: 620.0,
                top: 120.0,
                width: 300.0,
                height: 220.0,
                src: media.element_id.clone(),
            }),
        }
    }

    if elements.is_empty() && next_index == 0 {
        elements.push(SlideElement::Text {
            id: "text-fallback-1".to_string(),
            left: 60.0,
            top: 80.0,
            width: 800.0,
            height: 100.0,
            content: outline.description.clone(),
        });
    }

    elements
}

fn repair_media_elements(
    mut elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    for element in &mut elements {
        match element {
            SlideElement::Image { src, .. } => {
                if src.trim().is_empty() {
                    if let Some(media) = outline
                        .media_generations
                        .iter()
                        .find(|media| matches!(media.media_type, MediaType::Image))
                    {
                        *src = media.element_id.clone();
                    }
                }
            }
            SlideElement::Video { src, .. } => {
                if src.trim().is_empty() {
                    if let Some(media) = outline
                        .media_generations
                        .iter()
                        .find(|media| matches!(media.media_type, MediaType::Video))
                    {
                        *src = media.element_id.clone();
                    }
                }
            }
            _ => {}
        }
    }

    elements
}

fn build_fallback_image_prompt(title: &str, description: &str, key_points: &[String]) -> String {
    let key_points = if key_points.is_empty() {
        "Focus on the main teaching concept and make it classroom-friendly.".to_string()
    } else {
        format!("Key points: {}.", key_points.join(", "))
    };

    format!(
        "Create a clear educational illustration for a teaching slide titled '{}'. Scene summary: {}. {} Use a clean classroom visual style and avoid decorative clutter.",
        title,
        description,
        key_points
    )
}

fn build_scene_action_prompt(
    request: &LessonGenerationRequest,
    outline: &SceneOutline,
    content: &SceneContent,
    research_context: &Option<String>,
) -> Result<(String, String)> {
    let content_summary = scene_content_summary(content)?;
    let language = language_code(&request.requirements.language);
    let prompt = match outline.scene_type {
        SceneType::Slide => format!(
            "Create ordered classroom actions for this slide scene.\n\
             Lesson requirement: {}\n\
             Slide title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Slide elements: {}\n\
             Scene summary JSON: {}\n\
             Return a JSON array directly. Interleave objects shaped as {{\"type\":\"action\",\"name\":\"spotlight|laser|play_video|discussion\",\"params\":{{...}}}} and {{\"type\":\"text\",\"content\":\"...\"}}.\n\
             spotlight or laser must reference valid element ids from the provided element list.\n\
             spotlight should usually come before the speech that explains the focused element.\n\
             If the slide contains a video element, you may use play_video with that video's element id.\n\
             discussion is optional and must be the final action if used.\n\
             Generate 4-8 items, include at least one spoken text segment, and keep all speech in {}.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(research_context),
            slide_focus_targets(content),
            content_summary,
            language
        ),
        SceneType::Quiz => format!(
            "Create ordered classroom actions for this quiz scene.\n\
             Lesson requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Quiz summary JSON: {}\n\
             Return a JSON array directly using {{\"type\":\"text\",\"content\":\"...\"}} and an optional final discussion action {{\"type\":\"action\",\"name\":\"discussion\",\"params\":{{\"topic\":\"...\",\"prompt\":\"optional\"}}}}.\n\
             Use 3-6 items, keep all speech in {}, and only use discussion when the quiz genuinely invites reflection.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(research_context),
            content_summary,
            language
        ),
        SceneType::Interactive => format!(
            "Create ordered teaching narration for this interactive scene.\n\
             Lesson requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Interactive summary JSON: {}\n\
             Scientific model summary: {}\n\
             Return a JSON array directly using only {{\"type\":\"text\",\"content\":\"...\"}} items.\n\
             Generate 3-6 speech segments that guide exploration, encourage interaction, and connect observations back to the concept.\n\
             Sequence them like a live facilitator: orient the learner, give one concrete manipulation step, ask what changed, then help interpret the result.\n\
             Keep all speech in {}.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(research_context),
            content_summary,
            interactive_scene_summary(content),
            language
        ),
        SceneType::Pbl => format!(
            "Create ordered teaching narration for this project-based learning scene.\n\
             Lesson requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             {}\n\
             Project summary JSON: {}\n\
             Project facilitation summary: {}\n\
             Return a JSON array directly using {{\"type\":\"text\",\"content\":\"...\"}} items and an optional final discussion action.\n\
             Generate 2-5 items that introduce the project goal, deliverable, and first student decision.\n\
             Speak like a project facilitator: clarify the challenge, name one role or work package, and end with the most important first choice students must make.\n\
             Keep all speech in {}.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            research_context_prompt(research_context),
            content_summary,
            project_scene_summary(content),
            language
        ),
    };

    Ok((
        "You are a professional instructional designer. Return strict JSON only.".to_string(),
        prompt,
    ))
}

fn interactive_scientific_constraints(scientific_model: &Option<ScientificModel>) -> String {
    match scientific_model {
        Some(model) => {
            let mut lines = Vec::new();
            if !model.core_formulas.is_empty() {
                lines.push(format!("Core formulas: {}", model.core_formulas.join("; ")));
            }
            if !model.mechanism.is_empty() {
                lines.push(format!("Mechanisms: {}", model.mechanism.join("; ")));
            }
            if !model.constraints.is_empty() {
                lines.push(format!("Must obey: {}", model.constraints.join("; ")));
            }
            if !model.forbidden_errors.is_empty() {
                lines.push(format!(
                    "Forbidden errors: {}",
                    model.forbidden_errors.join("; ")
                ));
            }
            if !model.variables.is_empty() {
                lines.push(format!("Variables: {}", model.variables.join("; ")));
            }
            if !model.interaction_guidance.is_empty() {
                lines.push(format!(
                    "Interaction guidance: {}",
                    model.interaction_guidance.join("; ")
                ));
            }
            if !model.experiment_steps.is_empty() {
                lines.push(format!(
                    "Experiment steps: {}",
                    model.experiment_steps.join("; ")
                ));
            }
            if !model.observation_prompts.is_empty() {
                lines.push(format!(
                    "Observation prompts: {}",
                    model.observation_prompts.join("; ")
                ));
            }
            if lines.is_empty() {
                "No specific scientific constraints available.".to_string()
            } else {
                lines.join("\n")
            }
        }
        None => "No specific scientific constraints available.".to_string(),
    }
}

fn scientific_model_revision_notes(model: &ScientificModel) -> Option<String> {
    let mut issues = Vec::new();
    if model.core_formulas.is_empty() && model.mechanism.is_empty() {
        issues.push("Add at least one scientifically valid formula or mechanism.");
    }
    if model.variables.is_empty() {
        issues.push("Name the main variables learners can manipulate or observe.");
    }
    if model.interaction_guidance.len() < 2 {
        issues.push("Add at least two concrete interaction-guidance steps.");
    }
    if model.experiment_steps.len() < 2 {
        issues.push("Add a short experiment sequence with at least two ordered steps.");
    }
    if model.observation_prompts.is_empty() {
        issues.push("Add learner-facing observation prompts connected to the experiment.");
    }
    (!issues.is_empty()).then(|| issues.join("\n"))
}

fn merge_scientific_models(current: ScientificModel, revised: ScientificModel) -> ScientificModel {
    ScientificModel {
        core_formulas: if revised.core_formulas.is_empty() {
            current.core_formulas
        } else {
            revised.core_formulas
        },
        mechanism: if revised.mechanism.is_empty() {
            current.mechanism
        } else {
            revised.mechanism
        },
        constraints: if revised.constraints.is_empty() {
            current.constraints
        } else {
            revised.constraints
        },
        forbidden_errors: if revised.forbidden_errors.is_empty() {
            current.forbidden_errors
        } else {
            revised.forbidden_errors
        },
        variables: if revised.variables.is_empty() {
            current.variables
        } else {
            revised.variables
        },
        interaction_guidance: if revised.interaction_guidance.is_empty() {
            current.interaction_guidance
        } else {
            revised.interaction_guidance
        },
        experiment_steps: if revised.experiment_steps.is_empty() {
            current.experiment_steps
        } else {
            revised.experiment_steps
        },
        observation_prompts: if revised.observation_prompts.is_empty() {
            current.observation_prompts
        } else {
            revised.observation_prompts
        },
    }
}

fn project_content_revision_notes(payload: &ProjectContentEnvelope) -> Option<String> {
    let mut issues = Vec::new();
    if payload
        .driving_question
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        issues.push("Add a clear driving question students can investigate.");
    }
    if payload
        .final_deliverable
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        issues.push("Add a concrete final deliverable.");
    }
    if payload
        .milestones
        .as_ref()
        .is_none_or(|value| value.len() < 3)
    {
        issues.push("Add 3-5 concrete milestones.");
    }
    if payload
        .team_roles
        .as_ref()
        .is_none_or(|value| value.len() < 2)
    {
        issues.push("Add at least two useful team roles.");
    }
    if payload
        .assessment_focus
        .as_ref()
        .is_none_or(|value| value.len() < 2)
    {
        issues.push("Add concise assessment focus criteria.");
    }
    if payload
        .starter_prompt
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        issues.push("Add a starter prompt that helps learners begin the project.");
    }
    (!issues.is_empty()).then(|| issues.join("\n"))
}

fn merge_project_content(
    current: ProjectContentEnvelope,
    revised: ProjectContentEnvelope,
) -> ProjectContentEnvelope {
    ProjectContentEnvelope {
        summary: if revised.summary.trim().is_empty() {
            current.summary
        } else {
            revised.summary
        },
        title: revised.title.or(current.title),
        driving_question: revised.driving_question.or(current.driving_question),
        final_deliverable: revised.final_deliverable.or(current.final_deliverable),
        target_skills: revised.target_skills.or(current.target_skills),
        milestones: revised.milestones.or(current.milestones),
        team_roles: revised.team_roles.or(current.team_roles),
        assessment_focus: revised.assessment_focus.or(current.assessment_focus),
        starter_prompt: revised.starter_prompt.or(current.starter_prompt),
        success_criteria: revised.success_criteria.or(current.success_criteria),
        facilitator_notes: revised.facilitator_notes.or(current.facilitator_notes),
    }
}

fn extract_html_document(response: &str) -> Option<String> {
    let trimmed = response.trim();
    if trimmed.starts_with("<!DOCTYPE html") || trimmed.starts_with("<html") {
        return Some(trimmed.to_string());
    }

    if let Some(start) = response
        .find("<!DOCTYPE html")
        .or_else(|| response.find("<html"))
    {
        if let Some(end) = response.rfind("</html>") {
            return Some(response[start..end + 7].to_string());
        }
    }

    let fenced = strip_code_fences(response);
    if fenced.contains("<html") {
        return Some(fenced);
    }

    None
}

fn interactive_html_repair_notes(html: &str) -> Option<String> {
    let mut issues = Vec::new();
    let lower = html.to_ascii_lowercase();
    if !lower.contains("<script") {
        issues.push("Add inline JavaScript so learners get immediate feedback.");
    }
    if !lower.contains("<button")
        && !lower.contains("<input")
        && !lower.contains("<select")
        && !lower.contains("<canvas")
        && !lower.contains("<svg")
    {
        issues.push("Add at least one visible interactive control such as a button, input, select, canvas, or svg.");
    }
    if !lower.contains("viewport") {
        issues.push("Add a mobile-friendly viewport meta tag.");
    }
    if !lower.contains("instruction") && !lower.contains("try ") && !lower.contains("explore") {
        issues.push("Add short learner-facing instructions for how to use the interactive.");
    }
    if issues.is_empty() {
        None
    } else {
        Some(issues.join("\n"))
    }
}

fn post_process_interactive_html(
    html: &str,
    outline: &SceneOutline,
    scientific_model: Option<&ScientificModel>,
) -> String {
    let mut processed = html.trim().to_string();
    if !processed.to_ascii_lowercase().contains("<!doctype html") {
        processed = format!("<!DOCTYPE html>{processed}");
    }
    if !processed.to_ascii_lowercase().contains("<title>") {
        processed = processed.replacen(
            "<head>",
            &format!("<head><title>{}</title>", outline.title),
            1,
        );
    }
    if !processed.to_ascii_lowercase().contains("viewport")
        && processed.to_ascii_lowercase().contains("<head>")
    {
        processed = processed.replacen(
            "<head>",
            "<head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
            1,
        );
    }
    if !processed
        .to_ascii_lowercase()
        .contains("class=\"instructions\"")
        && processed.to_ascii_lowercase().contains("<body>")
    {
        let instructions = scientific_model
            .and_then(|model| model.interaction_guidance.first().cloned())
            .unwrap_or_else(|| format!("Explore {} and explain what changes.", outline.title));
        processed = processed.replacen(
            "<body>",
            &format!(
                "<body><p class=\"instructions\" style=\"font-family:system-ui,sans-serif;padding:12px 16px;margin:0;background:#ecfeff;color:#0f172a;\">{}</p>",
                instructions
            ),
            1,
        );
    }
    processed
}

fn fallback_interactive_html(
    outline: &SceneOutline,
    scientific_model: Option<&ScientificModel>,
) -> String {
    let constraints = scientific_model
        .map(|model| {
            model
                .interaction_guidance
                .iter()
                .take(3)
                .map(|line| format!("<li>{}</li>", line))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let key_points = outline
        .key_points
        .iter()
        .map(|point| format!("<li>{}</li>", point))
        .collect::<Vec<_>>()
        .join("");

    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{}</title><style>body{{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f5f7fb;color:#1f2937}}main{{max-width:900px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.08)}}button{{margin-top:16px;padding:12px 18px;border:none;border-radius:999px;background:#0f766e;color:#fff;font-weight:600;cursor:pointer}}.panel{{margin-top:18px;padding:16px;border-radius:12px;background:#ecfeff}}ul{{padding-left:20px}}</style></head><body><main><h1>{}</h1><p>{}</p><div class=\"panel\"><strong>Explore</strong><ul>{}</ul></div><button onclick=\"document.getElementById('result').textContent='Try changing one variable and explain what changed.'\">Run exploration</button><p id=\"result\"></p>{}</main></body></html>",
        outline.title,
        outline.title,
        outline.description,
        key_points,
        if constraints.is_empty() {
            String::new()
        } else {
            format!("<div class=\"panel\"><strong>Scientific checks</strong><ul>{}</ul></div>", constraints)
        }
    )
}

fn map_project_agent_roles(raw: Vec<ProjectAgentRoleEnvelope>) -> Option<Vec<ProjectAgentRole>> {
    let roles = raw
        .into_iter()
        .filter_map(|role| {
            let name = role.name.trim();
            let responsibility = role.responsibility.trim();
            if name.is_empty() || responsibility.is_empty() {
                return None;
            }
            Some(ProjectAgentRole {
                name: name.to_string(),
                responsibility: responsibility.to_string(),
                deliverable: role.deliverable.filter(|value| !value.trim().is_empty()),
            })
        })
        .collect::<Vec<_>>();
    (!roles.is_empty()).then_some(roles)
}

fn map_project_issue_board(raw: Vec<ProjectIssueEnvelope>) -> Option<Vec<ProjectIssue>> {
    let issues = raw
        .into_iter()
        .filter_map(|issue| {
            let title = issue.title.trim();
            let description = issue.description.trim();
            if title.is_empty() || description.is_empty() {
                return None;
            }
            let checkpoints = issue
                .checkpoints
                .into_iter()
                .filter_map(|checkpoint| {
                    let trimmed = checkpoint.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                })
                .collect::<Vec<_>>();
            Some(ProjectIssue {
                title: title.to_string(),
                description: description.to_string(),
                owner_role: issue.owner_role.filter(|value| !value.trim().is_empty()),
                checkpoints,
            })
        })
        .collect::<Vec<_>>();
    (!issues.is_empty()).then_some(issues)
}

fn project_outline_summary(outline: &SceneOutline) -> String {
    outline
        .project_config
        .as_ref()
        .map(|config| {
            format!(
                "topic={}, description={}, target_skills={}, issue_count={}, language={}",
                config.project_topic,
                config.project_description,
                config.target_skills.join(" | "),
                config.issue_count.unwrap_or(3),
                config.language
            )
        })
        .unwrap_or_else(|| "none".to_string())
}

fn media_generation_summary(outline: &SceneOutline) -> String {
    if outline.media_generations.is_empty() {
        return "none".to_string();
    }

    outline
        .media_generations
        .iter()
        .map(|media| {
            format!(
                "{}:{}:{}",
                media.element_id,
                match media.media_type {
                    MediaType::Image => "image",
                    MediaType::Video => "video",
                },
                media.aspect_ratio.as_deref().unwrap_or("unspecified")
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn scene_content_summary(content: &SceneContent) -> Result<String> {
    Ok(serde_json::to_string(content)?)
}

fn slide_focus_targets(content: &SceneContent) -> String {
    match content {
        SceneContent::Slide { canvas } => canvas
            .elements
            .iter()
            .map(|element| match element {
                SlideElement::Text { id, content, .. } => format!("{}:text:{}", id, content),
                SlideElement::Image { id, src, .. } => format!("{}:image:{}", id, src),
                SlideElement::Video { id, src, .. } => format!("{}:video:{}", id, src),
                SlideElement::Shape { id, shape_name, .. } => {
                    format!("{}:shape:{}", id, shape_name.as_deref().unwrap_or("shape"))
                }
                SlideElement::Chart { id, chart_type, .. } => {
                    format!("{}:chart:{}", id, chart_type.as_deref().unwrap_or("chart"))
                }
                SlideElement::Latex { id, latex, .. } => format!("{}:latex:{}", id, latex),
                SlideElement::Line { id, .. } => format!("{}:line", id),
                SlideElement::Table { id, .. } => format!("{}:table", id),
            })
            .collect::<Vec<_>>()
            .join(", "),
        _ => "none".to_string(),
    }
}

fn interactive_scene_summary(content: &SceneContent) -> String {
    match content {
        SceneContent::Interactive {
            scientific_model, ..
        } => scientific_model
            .as_ref()
            .map(|model| {
                [
                    (!model.variables.is_empty())
                        .then(|| format!("variables={}", model.variables.join(" | "))),
                    (!model.constraints.is_empty())
                        .then(|| format!("constraints={}", model.constraints.join(" | "))),
                    (!model.interaction_guidance.is_empty())
                        .then(|| format!("guidance={}", model.interaction_guidance.join(" | "))),
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join("; ")
            })
            .filter(|summary| !summary.is_empty())
            .unwrap_or_else(|| "none".to_string()),
        _ => "none".to_string(),
    }
}

fn project_scene_summary(content: &SceneContent) -> String {
    match content {
        SceneContent::Project { project_config } => {
            let mut parts = vec![format!("summary={}", project_config.summary)];
            if let Some(question) = project_config.driving_question.as_deref() {
                parts.push(format!("driving_question={question}"));
            }
            if let Some(deliverable) = project_config.final_deliverable.as_deref() {
                parts.push(format!("deliverable={deliverable}"));
            }
            if let Some(roles) = project_config.agent_roles.as_ref() {
                parts.push(format!(
                    "agent_roles={}",
                    roles
                        .iter()
                        .map(|role| format!("{}:{}", role.name, role.responsibility))
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
            }
            if let Some(issue_board) = project_config.issue_board.as_ref() {
                parts.push(format!(
                    "issue_board={}",
                    issue_board
                        .iter()
                        .map(|issue| issue.title.clone())
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
            }
            parts.join("; ")
        }
        _ => "none".to_string(),
    }
}

fn parse_structured_actions(
    response: &str,
    outline: &SceneOutline,
    content: &SceneContent,
) -> Result<Vec<LessonAction>> {
    let items: Vec<StructuredActionItemDto> = parse_json_with_repair(response)?;
    let valid_slide_targets = valid_slide_targets(content);
    let mut actions = Vec::new();

    for (index, item) in items.into_iter().enumerate() {
        match item {
            StructuredActionItemDto::Text { content } => {
                if !content.trim().is_empty() {
                    actions.push(LessonAction::Speech {
                        id: format!("action-{}", index + 1),
                        title: Some("Narration".to_string()),
                        description: None,
                        text: content.trim().to_string(),
                        audio_id: None,
                        audio_url: None,
                        voice: None,
                        speed: None,
                    });
                }
            }
            StructuredActionItemDto::Action {
                name,
                params,
                tool_name,
                parameters,
            } => {
                let action_name = if name.trim().is_empty() {
                    tool_name.unwrap_or_default()
                } else {
                    name
                };
                let params = params.or(parameters).unwrap_or(Value::Null);
                if let Some(action) = map_structured_action_item(
                    &action_name,
                    &params,
                    index,
                    &valid_slide_targets,
                    outline,
                ) {
                    actions.push(action);
                }
            }
        }
    }

    Ok(actions)
}

fn valid_slide_targets(content: &SceneContent) -> HashMap<String, &'static str> {
    match content {
        SceneContent::Slide { canvas } => canvas
            .elements
            .iter()
            .map(|element| match element {
                SlideElement::Text { id, .. } => (id.clone(), "text"),
                SlideElement::Image { id, .. } => (id.clone(), "image"),
                SlideElement::Video { id, .. } => (id.clone(), "video"),
                SlideElement::Shape { id, .. } => (id.clone(), "shape"),
                SlideElement::Line { id, .. } => (id.clone(), "line"),
                SlideElement::Chart { id, .. } => (id.clone(), "chart"),
                SlideElement::Latex { id, .. } => (id.clone(), "latex"),
                SlideElement::Table { id, .. } => (id.clone(), "table"),
            })
            .collect(),
        _ => HashMap::new(),
    }
}

fn map_structured_action_item(
    name: &str,
    params: &Value,
    index: usize,
    valid_slide_targets: &HashMap<String, &'static str>,
    outline: &SceneOutline,
) -> Option<LessonAction> {
    let id = format!("action-{}", index + 1);
    let params_obj = params.as_object();
    match name.trim().to_ascii_lowercase().as_str() {
        "spotlight" => {
            let element_id = params_obj
                .and_then(|map| map.get("elementId").or_else(|| map.get("element_id")))
                .and_then(|value| value.as_str())?
                .to_string();
            valid_slide_targets.get(&element_id)?;
            Some(LessonAction::Spotlight {
                id,
                title: Some("Spotlight".to_string()),
                description: None,
                element_id,
                dim_opacity: Some(0.5),
            })
        }
        "laser" => {
            let element_id = params_obj
                .and_then(|map| map.get("elementId").or_else(|| map.get("element_id")))
                .and_then(|value| value.as_str())?
                .to_string();
            valid_slide_targets.get(&element_id)?;
            Some(LessonAction::Laser {
                id,
                title: Some("Laser".to_string()),
                description: None,
                element_id,
                color: None,
            })
        }
        "play_video" => {
            let element_id = params_obj
                .and_then(|map| map.get("elementId").or_else(|| map.get("element_id")))
                .and_then(|value| value.as_str())?
                .to_string();
            if !matches!(valid_slide_targets.get(&element_id), Some(&"video")) {
                return None;
            }
            Some(LessonAction::PlayVideo {
                id,
                title: Some("Play video".to_string()),
                description: None,
                element_id,
            })
        }
        "discussion" => Some(LessonAction::Discussion {
            id,
            title: Some("Discussion".to_string()),
            description: None,
            topic: params_obj
                .and_then(|map| map.get("topic"))
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&outline.title)
                .to_string(),
            prompt: params_obj
                .and_then(|map| map.get("prompt"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string()),
            agent_id: params_obj
                .and_then(|map| map.get("agentId").or_else(|| map.get("agent_id")))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string()),
        }),
        _ => None,
    }
}

fn enforce_discussion_last(actions: &mut Vec<LessonAction>) {
    let Some(first_discussion_index) = actions
        .iter()
        .position(|action| matches!(action, LessonAction::Discussion { .. }))
    else {
        return;
    };

    if first_discussion_index < actions.len() - 1 {
        let discussion = actions.remove(first_discussion_index);
        actions.retain(|action| !matches!(action, LessonAction::Discussion { .. }));
        actions.push(discussion);
    } else {
        let mut seen_first = false;
        actions.retain(|action| {
            if matches!(action, LessonAction::Discussion { .. }) {
                if seen_first {
                    return false;
                }
                seen_first = true;
            }
            true
        });
    }
}

fn validate_slide_elements(
    elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    let mut normalized = elements
        .into_iter()
        .filter_map(normalize_slide_element)
        .collect::<Vec<_>>();

    if !normalized
        .iter()
        .any(|element| matches!(element, SlideElement::Text { content, .. } if content.contains(&outline.title)))
    {
        normalized.insert(
            0,
            SlideElement::Text {
                id: "text-title-auto".to_string(),
                left: 60.0,
                top: 48.0,
                width: 880.0,
                height: 60.0,
                content: outline.title.clone(),
            },
        );
    }

    if normalized.is_empty() {
        fallback_slide_elements(outline)
    } else {
        normalized
    }
}

fn normalize_slide_element(element: SlideElement) -> Option<SlideElement> {
    let clamp = |value: f32, min: f32, max: f32| value.max(min).min(max);
    let normalize_box =
        |left: f32, top: f32, width: f32, height: f32| -> Option<(f32, f32, f32, f32)> {
            if width <= 0.0 || height <= 0.0 {
                return None;
            }
            Some((
                clamp(left, 40.0, 940.0),
                clamp(top, 40.0, 503.0),
                clamp(width, 40.0, 900.0),
                clamp(height, 24.0, 460.0),
            ))
        };

    match element {
        SlideElement::Text {
            id,
            left,
            top,
            width,
            height,
            content,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Text {
                id,
                left,
                top,
                width,
                height,
                content: content.trim().chars().take(400).collect(),
            }
        }),
        SlideElement::Image {
            id,
            left,
            top,
            width,
            height,
            src,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Image {
                id,
                left,
                top,
                width,
                height,
                src,
            }
        }),
        SlideElement::Video {
            id,
            left,
            top,
            width,
            height,
            src,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Video {
                id,
                left,
                top,
                width,
                height,
                src,
            }
        }),
        SlideElement::Shape {
            id,
            left,
            top,
            width,
            height,
            shape_name,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Shape {
                id,
                left,
                top,
                width,
                height,
                shape_name,
            }
        }),
        SlideElement::Line {
            id,
            left,
            top,
            width,
            height,
        } => normalize_box(left, top, width.max(2.0), height.max(2.0)).map(
            |(left, top, width, height)| SlideElement::Line {
                id,
                left,
                top,
                width,
                height,
            },
        ),
        SlideElement::Chart {
            id,
            left,
            top,
            width,
            height,
            chart_type,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Chart {
                id,
                left,
                top,
                width,
                height,
                chart_type,
            }
        }),
        SlideElement::Latex {
            id,
            left,
            top,
            width,
            height,
            latex,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Latex {
                id,
                left,
                top,
                width,
                height,
                latex,
            }
        }),
        SlideElement::Table {
            id,
            left,
            top,
            width,
            height,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Table {
                id,
                left,
                top,
                width,
                height,
            }
        }),
    }
}

fn parse_json_with_repair<T>(response: &str) -> Result<T>
where
    T: DeserializeOwned,
{
    let sanitized = strip_code_fences(response);
    let mut candidates = vec![response.to_string(), sanitized.clone()];
    if let Some(extracted) = extract_balanced_json(&sanitized) {
        candidates.push(extracted);
    }
    candidates.push(repair_unbalanced_json(&sanitized));

    for candidate in candidates {
        let normalized = normalize_json_candidate(&candidate);
        if let Ok(parsed) = serde_json::from_str::<T>(&normalized) {
            return Ok(parsed);
        }
    }

    Err(anyhow!("failed to parse repaired JSON payload"))
}

fn should_retry_llm_error(error: &anyhow::Error) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("timeout")
        || message.contains("timed out")
        || message.contains("429")
        || message.contains("rate limit")
        || message.contains("temporar")
        || message.contains("connection reset")
        || message.contains("connection refused")
        || message.contains("unavailable")
        || message.contains("eof")
        || message.contains("network")
}

fn normalize_search_requirement(requirement: &str) -> String {
    requirement.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_pdf_excerpt(pdf_text: Option<&str>) -> String {
    let Some(text) = pdf_text else {
        return String::new();
    };
    normalize_search_requirement(text)
        .chars()
        .take(SEARCH_QUERY_REWRITE_EXCERPT_LENGTH)
        .collect()
}

fn should_rewrite_search_query(normalized_requirement: &str, normalized_pdf_excerpt: &str) -> bool {
    normalized_requirement.len() > 400 || !normalized_pdf_excerpt.is_empty()
}

fn format_search_results_as_context(result: &TavilySearchResponse) -> String {
    if result.answer.trim().is_empty() && result.results.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();

    if !result.answer.trim().is_empty() {
        lines.push(result.answer.trim().to_string());
        lines.push(String::new());
    }

    if !result.results.is_empty() {
        lines.push("Sources:".to_string());
        for source in &result.results {
            let title = if source.title.trim().is_empty() {
                "Untitled source"
            } else {
                source.title.trim()
            };
            let url = source.url.trim();
            let content: String = source.content.trim().chars().take(200).collect();
            lines.push(format!("- [{}]({}): {}", title, url, content));
        }
    }

    lines.join("\n").trim().to_string()
}

fn research_context_prompt(research_context: &Option<String>) -> String {
    match research_context {
        Some(value) if !value.trim().is_empty() => {
            format!("External research context:\n{}", value.trim())
        }
        _ => "External research context: none".to_string(),
    }
}

fn request_research_cache_key(request: &LessonGenerationRequest) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    request.requirements.requirement.hash(&mut hasher);
    request
        .pdf_content
        .as_ref()
        .map(|pdf| pdf.text.as_str())
        .unwrap_or_default()
        .hash(&mut hasher);
    hasher.finish()
}

fn strip_code_fences(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

fn normalize_json_candidate(value: &str) -> String {
    // Handle common malformed payloads from LLMs: smart quotes and
    // trailing commas before `}` / `]`.
    let normalized_quotes = value.replace(['“', '”'], "\"").replace(['’', '‘'], "'");
    remove_trailing_commas(&normalized_quotes)
}

fn remove_trailing_commas(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut in_string = false;
    let mut escaped = false;
    let chars: Vec<char> = value.chars().collect();
    let mut index = 0usize;

    while index < chars.len() {
        let ch = chars[index];
        if in_string {
            result.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }

        if ch == '"' {
            in_string = true;
            result.push(ch);
            index += 1;
            continue;
        }

        if ch == ',' {
            let mut lookahead = index + 1;
            while lookahead < chars.len() && chars[lookahead].is_whitespace() {
                lookahead += 1;
            }
            if lookahead < chars.len() && (chars[lookahead] == '}' || chars[lookahead] == ']') {
                index += 1;
                continue;
            }
        }

        result.push(ch);
        index += 1;
    }

    result
}

fn repair_unbalanced_json(value: &str) -> String {
    let mut repaired = value.to_string();
    let mut openers: Vec<char> = Vec::new();
    let mut in_string = false;
    let mut escaped = false;

    for ch in value.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' | '[' => openers.push(ch),
            '}' => {
                if matches!(openers.last(), Some('{')) {
                    openers.pop();
                }
            }
            ']' => {
                if matches!(openers.last(), Some('[')) {
                    openers.pop();
                }
            }
            _ => {}
        }
    }

    if in_string {
        repaired.push('"');
    }

    while let Some(open) = openers.pop() {
        repaired.push(match open {
            '{' => '}',
            '[' => ']',
            _ => open,
        });
    }

    repaired
}

fn extract_balanced_json(value: &str) -> Option<String> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in value.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' | '[' => {
                if start.is_none() {
                    start = Some(index);
                }
                depth += 1;
            }
            '}' | ']' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(start_index) = start {
                        return Some(value[start_index..=index].to_string());
                    }
                }
            }
            _ => {}
        }
    }

    None
}

fn fallback_outlines(request: &LessonGenerationRequest) -> Vec<SceneOutline> {
    let language = language_code(&request.requirements.language).to_string();
    let requirement = request.requirements.requirement.trim();
    let summary = requirement
        .split_whitespace()
        .take(14)
        .collect::<Vec<_>>()
        .join(" ");
    let base_title = if summary.is_empty() {
        "Lesson Topic".to_string()
    } else {
        summary
    };

    vec![
        SceneOutline {
            id: "outline-1".to_string(),
            scene_type: SceneType::Slide,
            title: format!("Introduction to {}", base_title),
            description: requirement.to_string(),
            key_points: vec![
                "Core concept overview".to_string(),
                "Why this topic matters".to_string(),
            ],
            teaching_objective: Some("Build foundational understanding".to_string()),
            estimated_duration: Some(120),
            order: 1,
            language: Some(language.clone()),
            suggested_image_ids: vec![],
            media_generations: ensure_outline_media_generations(
                &SceneType::Slide,
                &format!("Introduction to {}", base_title),
                requirement,
                &[
                    "Core concept overview".to_string(),
                    "Why this topic matters".to_string(),
                ],
                vec![],
                request,
                0,
            ),
            quiz_config: None,
            interactive_config: None,
            project_config: None,
        },
        SceneOutline {
            id: "outline-2".to_string(),
            scene_type: SceneType::Slide,
            title: format!("Key Ideas in {}", base_title),
            description: requirement.to_string(),
            key_points: vec![
                "Important terms".to_string(),
                "Worked example".to_string(),
                "Common misunderstanding".to_string(),
            ],
            teaching_objective: Some("Explain the main ideas clearly".to_string()),
            estimated_duration: Some(150),
            order: 2,
            language: Some(language.clone()),
            suggested_image_ids: vec![],
            media_generations: ensure_outline_media_generations(
                &SceneType::Slide,
                &format!("Key Ideas in {}", base_title),
                requirement,
                &[
                    "Important terms".to_string(),
                    "Worked example".to_string(),
                    "Common misunderstanding".to_string(),
                ],
                vec![],
                request,
                1,
            ),
            quiz_config: None,
            interactive_config: None,
            project_config: None,
        },
        SceneOutline {
            id: "outline-3".to_string(),
            scene_type: SceneType::Quiz,
            title: format!("Check Understanding: {}", base_title),
            description: "Quick check for student understanding".to_string(),
            key_points: vec!["Recall".to_string(), "Apply".to_string()],
            teaching_objective: Some("Check understanding".to_string()),
            estimated_duration: Some(90),
            order: 3,
            language: Some(language),
            suggested_image_ids: vec![],
            media_generations: vec![],
            quiz_config: None,
            interactive_config: None,
            project_config: None,
        },
    ]
}

fn fallback_slide_elements(outline: &SceneOutline) -> Vec<SlideElement> {
    let mut elements = vec![
        SlideElement::Text {
            id: "text-title-1".to_string(),
            left: 60.0,
            top: 50.0,
            width: 520.0,
            height: 60.0,
            content: outline.title.clone(),
        },
        SlideElement::Text {
            id: "text-body-1".to_string(),
            left: 60.0,
            top: 130.0,
            width: 520.0,
            height: 180.0,
            content: if outline.key_points.is_empty() {
                outline.description.clone()
            } else {
                outline
                    .key_points
                    .iter()
                    .map(|point| format!("- {}", point))
                    .collect::<Vec<_>>()
                    .join("\n")
            },
        },
    ];
    elements = attach_media_placeholders(elements, outline);
    elements
}

fn fallback_quiz_questions(outline: &SceneOutline) -> Vec<QuizQuestionDto> {
    let prompt = outline
        .key_points
        .first()
        .cloned()
        .unwrap_or_else(|| outline.title.clone());
    vec![
        QuizQuestionDto {
            question: format!("Which statement best matches {}?", prompt),
            options: Some(vec![
                outline.title.clone(),
                "An unrelated idea".to_string(),
                "A common misconception".to_string(),
                "None of the above".to_string(),
            ]),
            answer: Some(vec![outline.title.clone()]),
        },
        QuizQuestionDto {
            question: format!("Why is {} important?", outline.title),
            options: Some(vec![
                "It helps explain the lesson topic".to_string(),
                "It is not related to the lesson".to_string(),
                "It removes the need for examples".to_string(),
                "It replaces all practice".to_string(),
            ]),
            answer: Some(vec!["It helps explain the lesson topic".to_string()]),
        },
    ]
}

fn map_action(action: ActionDto, index: usize) -> Option<LessonAction> {
    let id = format!("action-{}", index + 1);
    match action.action_type.trim().to_ascii_lowercase().as_str() {
        "speech" => Some(LessonAction::Speech {
            id,
            title: Some("Narration".to_string()),
            description: None,
            text: action.text.unwrap_or_default(),
            audio_id: None,
            audio_url: None,
            voice: None,
            speed: None,
        }),
        "spotlight" => action.element_id.map(|element_id| LessonAction::Spotlight {
            id,
            title: Some("Spotlight".to_string()),
            description: None,
            element_id,
            dim_opacity: Some(0.5),
        }),
        "laser" => action.element_id.map(|element_id| LessonAction::Laser {
            id,
            title: Some("Laser".to_string()),
            description: None,
            element_id,
            color: None,
        }),
        "play_video" => action.element_id.map(|element_id| LessonAction::PlayVideo {
            id,
            title: Some("Play video".to_string()),
            description: None,
            element_id,
        }),
        "discussion" => Some(LessonAction::Discussion {
            id,
            title: Some("Discussion".to_string()),
            description: None,
            topic: action
                .topic
                .or(action.text)
                .unwrap_or_else(|| "Discuss the scene".to_string()),
            prompt: None,
            agent_id: None,
        }),
        _ => None,
    }
}

fn language_code(language: &Language) -> &'static str {
    match language {
        Language::ZhCn => "zh-CN",
        Language::EnUs => "en-US",
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };

    use super::*;
    use ai_tutor_domain::generation::{AgentMode, UserRequirements};

    struct MockLlmProvider {
        responses: Mutex<Vec<String>>,
    }

    struct FlakyLlmProvider {
        failures_before_success: AtomicUsize,
        response: String,
        error_message: String,
        call_count: AtomicUsize,
    }

    struct SharedFlakyLlmProvider {
        inner: Arc<FlakyLlmProvider>,
    }

    struct PromptCaptureLlmProvider {
        responses: Mutex<Vec<String>>,
        prompts: Mutex<Vec<(String, String)>>,
    }

    #[async_trait]
    impl LlmProvider for MockLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("no mock response available"));
            }
            Ok(responses.remove(0))
        }
    }

    #[async_trait]
    impl LlmProvider for FlakyLlmProvider {
        async fn generate_text(&self, _system_prompt: &str, _user_prompt: &str) -> Result<String> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            let remaining = self.failures_before_success.load(Ordering::SeqCst);
            if remaining > 0 {
                self.failures_before_success.fetch_sub(1, Ordering::SeqCst);
                return Err(anyhow!(self.error_message.clone()));
            }
            Ok(self.response.clone())
        }
    }

    #[async_trait]
    impl LlmProvider for SharedFlakyLlmProvider {
        async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
            self.inner.generate_text(system_prompt, user_prompt).await
        }
    }

    #[async_trait]
    impl LlmProvider for PromptCaptureLlmProvider {
        async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
            self.prompts
                .lock()
                .unwrap()
                .push((system_prompt.to_string(), user_prompt.to_string()));
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                return Err(anyhow!("no mock response available"));
            }
            Ok(responses.remove(0))
        }
    }

    fn sample_request() -> LessonGenerationRequest {
        LessonGenerationRequest {
            requirements: UserRequirements {
                requirement: "Teach fractions".to_string(),
                language: Language::EnUs,
                user_nickname: None,
                user_bio: None,
                web_search: Some(false),
            },
            pdf_content: None,
            enable_web_search: false,
            enable_image_generation: false,
            enable_video_generation: false,
            enable_tts: false,
            agent_mode: AgentMode::Default,
            account_id: None,
        }
    }

    #[tokio::test]
    async fn llm_pipeline_parses_outline_content_and_actions() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                "```json\n{\"outlines\":[{\"title\":\"Intro to Fractions\",\"description\":\"Basic idea\",\"key_points\":[\"What a fraction is\",\"Parts of a fraction\"],\"scene_type\":\"slide\",\"media_generations\":[{\"element_id\":\"gen_img_1\",\"media_type\":\"image\",\"prompt\":\"A pizza cut into fractions\",\"aspect_ratio\":\"16:9\"}]},{\"title\":\"Fraction Quiz\",\"description\":\"Check learning\",\"key_points\":[\"Identify numerator\"],\"scene_type\":\"quiz\"}]}\n```".to_string(),
                "Here is the JSON:\n{\"elements\":[{\"kind\":\"text\",\"content\":\"Fractions represent parts of a whole.\",\"left\":60.0,\"top\":80.0,\"width\":800.0,\"height\":100.0}]}".to_string(),
                "```json\n{\"actions\":[{\"action_type\":\"speech\",\"text\":\"A fraction shows part of a whole.\"}]}\n```".to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        assert_eq!(outlines.len(), 2);
        assert!(matches!(outlines[0].scene_type, SceneType::Slide));
        assert_eq!(outlines[0].media_generations.len(), 1);

        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();
        match &content {
            SceneContent::Slide { canvas } => {
                assert!(canvas.elements.len() >= 2);
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Text { content, .. } => content.contains("Intro to Fractions"),
                    _ => false,
                }));
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Image { src, .. } => src == "gen_img_1",
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content)
            .await
            .unwrap();
        assert!(!actions.is_empty());
        assert!(matches!(actions[0], LessonAction::Speech { .. }));
    }

    #[tokio::test]
    async fn outline_media_requests_are_filtered_when_generation_is_disabled() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide","media_generations":[{"element_id":"gen_img_1","media_type":"image","prompt":"A fraction wheel","aspect_ratio":"16:9"},{"element_id":"gen_vid_1","media_type":"video","prompt":"A rotating fraction chart","aspect_ratio":"16:9"}]}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert!(outlines[0].media_generations.is_empty());
    }

    #[tokio::test]
    async fn injects_fallback_image_request_for_slide_outlines_when_enabled() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert_eq!(outlines[0].media_generations.len(), 1);
        assert!(matches!(
            outlines[0].media_generations[0].media_type,
            MediaType::Image
        ));
        assert!(outlines[0].media_generations[0]
            .prompt
            .contains("Intro to Fractions"));
    }

    #[tokio::test]
    async fn repairs_empty_image_src_using_generated_media_placeholder() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
                r#"{"elements":[{"kind":"image","src":"","left":60.0,"top":80.0,"width":400.0,"height":240.0}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();

        match content {
            SceneContent::Slide { canvas } => {
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Image { src, .. } => src == "gen_img_1",
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn falls_back_to_default_outlines_when_outline_json_is_invalid() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec!["not valid json at all".to_string()]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request).await.unwrap();

        assert_eq!(outlines.len(), 3);
        assert!(matches!(outlines[0].scene_type, SceneType::Slide));
        assert!(matches!(outlines[2].scene_type, SceneType::Quiz));
        assert!(!outlines[0].media_generations.is_empty());
    }

    #[tokio::test]
    async fn repairs_outline_json_with_trailing_commas() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide",},],}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let outlines = pipeline.generate_outlines(&sample_request()).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert_eq!(outlines[0].title, "Intro to Fractions");
    }

    #[tokio::test]
    async fn outline_generation_preserves_quiz_and_interactive_configs() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Lab","description":"Hands-on modeling","teachingObjective":"Explore part-whole relationships","estimatedDuration":180,"order":1,"key_points":["Manipulate parts","Observe equivalence"],"type":"interactive","interactiveConfig":{"conceptName":"Fractions","conceptOverview":"Manipulate a whole into equal parts","designIdea":"Use sliders and draggable parts to compare equivalent fractions","subject":"Math"}},{"title":"Fraction Check","description":"Assess understanding","key_points":["Numerator","Denominator"],"type":"quiz","quizConfig":{"questionCount":3,"difficulty":"medium","questionTypes":["single","multiple"]}}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let outlines = pipeline.generate_outlines(&sample_request()).await.unwrap();

        assert_eq!(outlines.len(), 2);
        assert!(matches!(outlines[0].scene_type, SceneType::Interactive));
        assert_eq!(
            outlines[0]
                .interactive_config
                .as_ref()
                .map(|config| config.subject.as_deref()),
            Some(Some("Math"))
        );
        assert_eq!(outlines[0].estimated_duration, Some(180));
        assert!(matches!(outlines[1].scene_type, SceneType::Quiz));
        assert_eq!(
            outlines[1]
                .quiz_config
                .as_ref()
                .map(|config| config.question_count),
            Some(3)
        );
    }

    #[tokio::test]
    async fn repairs_outline_json_with_missing_closing_braces() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let outlines = pipeline.generate_outlines(&sample_request()).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert_eq!(outlines[0].title, "Intro to Fractions");
    }

    #[tokio::test]
    async fn falls_back_to_default_slide_elements_when_slide_json_is_invalid() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
                "not valid json".to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();

        match content {
            SceneContent::Slide { canvas } => {
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Text { .. })));
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Image { src, .. } => src == "gen_img_1",
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn slide_generation_supports_richer_elements_and_repairs_layout() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Models","description":"Compare visual models","key_points":["Area model","Number line"],"scene_type":"slide"}]}"#.to_string(),
                r#"{"elements":[{"id":"chart-1","kind":"chart","chart_type":"bar","left":-50.0,"top":20.0,"width":1200.0,"height":320.0},{"id":"latex-1","kind":"latex","latex":"\\frac{1}{2}","left":100.0,"top":360.0,"width":180.0,"height":90.0}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let content = pipeline
            .generate_scene_content(
                &sample_request(),
                &pipeline.generate_outlines(&sample_request()).await.unwrap()[0],
            )
            .await
            .unwrap();

        match content {
            SceneContent::Slide { canvas } => {
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Chart { .. })));
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Latex { .. })));
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Text { content, .. } => content.contains("Fraction Models"),
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }
    }

    #[tokio::test]
    async fn action_generation_parses_interleaved_openmaic_style_arrays() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Models","description":"Compare visual models","key_points":["Area model","Number line"],"scene_type":"slide"}]}"#.to_string(),
                r#"{"elements":[{"id":"title-box","kind":"text","content":"Fraction Models","left":60.0,"top":60.0,"width":400.0,"height":60.0},{"id":"video-demo","kind":"video","src":"gen_vid_1","left":500.0,"top":140.0,"width":320.0,"height":180.0}]}"#.to_string(),
                r#"[{"type":"action","name":"spotlight","params":{"elementId":"title-box"}},{"type":"text","content":"Let's start with the title idea."},{"type":"action","name":"play_video","params":{"elementId":"video-demo"}},{"type":"text","content":"This explanation should be dropped because it comes after the video?"},{"type":"action","name":"discussion","params":{"topic":"Where do you see one half in real life?","prompt":"Give one everyday example."}}]"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();
        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content)
            .await
            .unwrap();

        assert!(matches!(actions[0], LessonAction::Spotlight { .. }));
        assert!(matches!(actions[1], LessonAction::Speech { .. }));
        assert!(actions
            .iter()
            .any(|action| matches!(action, LessonAction::PlayVideo { .. })));
        assert!(matches!(
            actions.last(),
            Some(LessonAction::Discussion { .. })
        ));
    }

    #[tokio::test]
    async fn generation_pipeline_uses_phase_llms_and_escalates_scene_actions() {
        let fallback_llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"actions":[{"action_type":"speech","text":"Fallback action model produced valid JSON."}]}"#.to_string(),
            ]),
        };
        let actions_primary_llm = MockLlmProvider {
            responses: Mutex::new(vec!["this is not valid action json".to_string()]),
        };
        let content_llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"elements":[{"kind":"text","content":"Phase-based scene content.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
            ]),
        };
        let outlines_llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Phase Routed Outline","description":"Outline generated by outlines model","key_points":["Point A"],"scene_type":"slide"}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(MockLlmProvider {
            responses: Mutex::new(vec!["unused".to_string()]),
        }))
        .with_phase_llms(
            Box::new(outlines_llm),
            Box::new(content_llm),
            Box::new(actions_primary_llm),
        )
        .with_scene_actions_fallback_llm(Box::new(fallback_llm));

        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        assert_eq!(outlines[0].title, "Phase Routed Outline");

        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();
        match &content {
            SceneContent::Slide { canvas } => {
                assert!(canvas
                    .elements
                    .iter()
                    .any(|element| matches!(element, SlideElement::Text { content, .. } if content.contains("Phase-based scene content"))));
            }
            _ => panic!("expected slide content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content)
            .await
            .unwrap();
        assert!(actions.iter().any(|action| {
            matches!(
                action,
                LessonAction::Speech { text, .. } if text.contains("Fallback action model produced valid JSON.")
            )
        }));
    }

    #[tokio::test]
    async fn retries_transient_outline_generation_failures() {
        let llm = Arc::new(FlakyLlmProvider {
            failures_before_success: AtomicUsize::new(2),
            response: r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
            error_message: "temporary upstream timeout".to_string(),
            call_count: AtomicUsize::new(0),
        });

        let pipeline = LlmGenerationPipeline::new(Box::new(SharedFlakyLlmProvider {
            inner: Arc::clone(&llm),
        }));
        let mut request = sample_request();
        request.enable_image_generation = true;

        let outlines = pipeline.generate_outlines(&request).await.unwrap();

        assert_eq!(outlines.len(), 1);
        assert_eq!(llm.call_count.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn does_not_retry_non_retryable_outline_failures() {
        let llm = Arc::new(FlakyLlmProvider {
            failures_before_success: AtomicUsize::new(1),
            response: r#"{"outlines":[{"title":"Ignored","description":"Ignored","key_points":["Ignored"],"scene_type":"slide"}]}"#.to_string(),
            error_message: "missing api key".to_string(),
            call_count: AtomicUsize::new(0),
        });

        let pipeline = LlmGenerationPipeline::new(Box::new(SharedFlakyLlmProvider {
            inner: Arc::clone(&llm),
        }));
        let error = pipeline
            .generate_outlines(&sample_request())
            .await
            .unwrap_err();

        assert!(error.to_string().contains("missing api key"));
        assert_eq!(llm.call_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn interactive_scene_generation_is_supported() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Explorer","description":"Hands-on exploration","key_points":["Visualize parts of a whole"],"scene_type":"interactive","interactive_config":{"concept_name":"Fractions","concept_overview":"Explore equivalent fractions visually","design_idea":"Use a slider and fraction bar","subject":"Math"}}]}"#.to_string(),
                r#"{"core_formulas":["a/b = c/d when ad = bc"],"constraints":["Partition the whole into equal parts"],"interaction_guidance":["Move the slider to change the numerator"]}"#.to_string(),
                r#"<!DOCTYPE html><html><body><h2>Fraction Explorer</h2><p>Move the slider to compare fractions.</p></body></html>"#.to_string(),
                r#"<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fraction Explorer</title><script>function updateResult(){document.getElementById('result').textContent='Equivalent fractions keep the same ratio.';}</script></head><body><h2>Fraction Explorer</h2><p class="instructions">Move the slider to change the numerator.</p><input type="range" min="1" max="4" value="1" oninput="updateResult()"><p id="result">Equivalent fractions keep the same ratio.</p></body></html>"#.to_string(),
                r#"{"actions":[{"action_type":"speech","text":"Try changing the fraction slider and describe what you observe."}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert!(matches!(outlines[0].scene_type, SceneType::Interactive));

        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();
        match &content {
            SceneContent::Interactive {
                html,
                scientific_model,
                ..
            } => {
                assert!(html
                    .as_deref()
                    .unwrap_or_default()
                    .contains("Fraction Explorer"));
                assert!(scientific_model.is_some());
            }
            _ => panic!("expected interactive content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content)
            .await
            .unwrap();
        assert!(!actions.is_empty());
    }

    #[tokio::test]
    async fn interactive_scene_generation_revises_sparse_scientific_model() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Density Explorer","description":"Investigate mass and volume","key_points":["Density compares mass and volume"],"scene_type":"interactive","interactive_config":{"concept_name":"Density","concept_overview":"Explore how mass and volume affect density","design_idea":"Use sliders and sample blocks","subject":"Science"}}]}"#.to_string(),
                r#"{"core_formulas":["density = mass / volume"],"interaction_guidance":["Change one slider."]}"#.to_string(),
                r#"{"variables":["mass","volume","density"],"interaction_guidance":["Change the mass slider.","Change the volume slider and compare the result."],"experiment_steps":["Set the same volume for two blocks.","Increase the mass of one block and compare densities."],"observation_prompts":["What changed when mass increased at constant volume?"]}"#.to_string(),
                r#"<!DOCTYPE html><html><body><h2>Density Explorer</h2><button onclick="document.getElementById('result').textContent='Higher mass at the same volume increases density.'">Test</button><p id="result"></p></body></html>"#.to_string(),
                r#"{"actions":[{"action_type":"speech","text":"Try adjusting mass and volume, then explain how density changes."}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();

        match &content {
            SceneContent::Interactive {
                scientific_model: Some(model),
                ..
            } => {
                assert!(model.variables.len() >= 3);
                assert!(model.experiment_steps.len() >= 2);
                assert!(!model.observation_prompts.is_empty());
            }
            _ => panic!("expected interactive content with revised scientific model"),
        }
    }

    #[tokio::test]
    async fn pbl_scene_generation_is_supported() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Fraction Recipe Project","description":"Create a recipe card using fractions","key_points":["Scaling ingredients","Equivalent fractions"],"scene_type":"pbl","project_config":{"project_topic":"Recipe scaling","project_description":"Students redesign a recipe for new serving sizes","target_skills":["fractions","measurement"],"issue_count":3,"language":"en-US"}}]}"#.to_string(),
                r#"{"summary":"Build a mini recipe-conversion poster showing how to scale ingredient fractions for two serving sizes.","title":"Recipe Scaling Challenge","driving_question":"How can we scale a recipe without changing its balance?","final_deliverable":"A poster and worked conversion table","target_skills":["fractions","measurement","communication"],"milestones":["Choose a recipe","Convert ingredient amounts","Explain the math"],"team_roles":["Recipe analyst","Checker"],"assessment_focus":["accuracy","clarity"],"starter_prompt":"Choose a favorite recipe and identify one ingredient fraction to scale."}"#.to_string(),
                r#"{"agent_roles":[{"name":"Recipe analyst","responsibility":"Calculate scaled ingredient amounts","deliverable":"A checked conversion table"},{"name":"Checker","responsibility":"Verify equivalent fractions and units","deliverable":"A validation note"}],"success_criteria":["Scaled fractions are mathematically correct","Poster clearly explains the conversions"],"facilitator_notes":["Have teams compare two scaling strategies","Press students to justify equivalent fractions aloud"]}"#.to_string(),
                r#"{"issue_board":[{"title":"Choose a recipe","description":"Pick a recipe with at least one fractional ingredient.","owner_role":"Recipe analyst","checkpoints":["Select recipe","Highlight fractional ingredients"]},{"title":"Scale ingredient amounts","description":"Create new fraction amounts for a second serving size.","owner_role":"Recipe analyst","checkpoints":["Convert each ingredient","Check equivalent fractions"]},{"title":"Explain the math","description":"Prepare a poster section that explains the scaling process.","owner_role":"Checker","checkpoints":["Write explanation","Review clarity"]}]}"#.to_string(),
                r#"{"actions":[{"action_type":"speech","text":"Let’s plan your project goal and expected deliverable first."},{"action_type":"discussion","topic":"Which real recipe would you like to scale?"}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        assert_eq!(outlines.len(), 1);
        assert!(matches!(outlines[0].scene_type, SceneType::Pbl));

        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();
        match &content {
            SceneContent::Project { project_config } => {
                assert!(project_config.summary.contains("recipe"));
                assert_eq!(
                    project_config.driving_question.as_deref(),
                    Some("How can we scale a recipe without changing its balance?")
                );
                assert!(project_config
                    .milestones
                    .as_ref()
                    .is_some_and(|milestones| milestones.len() >= 3));
                assert!(project_config
                    .agent_roles
                    .as_ref()
                    .is_some_and(|roles| roles.len() >= 2));
                assert!(project_config
                    .issue_board
                    .as_ref()
                    .is_some_and(|issues| issues.len() >= 3));
            }
            _ => panic!("expected project content"),
        }

        let actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content)
            .await
            .unwrap();
        assert!(actions
            .iter()
            .any(|action| matches!(action, LessonAction::Discussion { .. })));
    }

    #[tokio::test]
    async fn pbl_scene_generation_revises_sparse_project_plan() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Water Filter Project","description":"Design a classroom water filter","key_points":["Materials","Testing","Explaining results"],"scene_type":"pbl","project_config":{"project_topic":"Water filter design","project_description":"Students build and test a simple filter","target_skills":["science","collaboration"],"issue_count":3,"language":"en-US"}}]}"#.to_string(),
                r#"{"summary":"Build a simple water filter and explain what it removes."}"#.to_string(),
                r#"{"summary":"Build and test a simple water filter, then explain the evidence from your test results.","title":"Water Filter Challenge","driving_question":"How can we improve water clarity using simple materials?","final_deliverable":"A tested filter prototype and a short evidence-based explanation","target_skills":["science","collaboration","evidence"],"milestones":["Choose materials","Build and test the filter","Explain the evidence"],"team_roles":["Builder","Recorder"],"assessment_focus":["quality of evidence","clarity of explanation"],"starter_prompt":"Choose two filter materials and predict which one will work best."}"#.to_string(),
                r#"{"agent_roles":[{"name":"Builder","responsibility":"Assemble and adjust the prototype","deliverable":"A working filter build log"},{"name":"Recorder","responsibility":"Capture measurements and evidence","deliverable":"A short evidence summary"}],"success_criteria":["The filter process is testable","The team explains the evidence clearly","The final explanation matches the observed results"],"facilitator_notes":["Push students to compare evidence across trials","Ask teams to justify material choices with data"]}"#.to_string(),
                r#"{"issue_board":[{"title":"Choose materials","description":"Pick and justify the filter materials.","owner_role":"Builder","checkpoints":["List materials","Predict performance"]},{"title":"Run filter tests","description":"Test the filter and record the results.","owner_role":"Recorder","checkpoints":["Run at least two trials","Record observations"]},{"title":"Explain the evidence","description":"Prepare the final explanation and recommendations.","owner_role":"Recorder","checkpoints":["Summarize results","Connect claims to evidence"]}]}"#.to_string(),
            ]),
        };

        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let request = sample_request();
        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();

        match &content {
            SceneContent::Project { project_config } => {
                assert!(project_config
                    .driving_question
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()));
                assert!(project_config
                    .final_deliverable
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()));
                assert!(project_config
                    .milestones
                    .as_ref()
                    .is_some_and(|milestones| milestones.len() >= 3));
                assert!(project_config
                    .team_roles
                    .as_ref()
                    .is_some_and(|roles| roles.len() >= 2));
            }
            _ => panic!("expected project content"),
        }
    }

    #[tokio::test]
    async fn web_search_degrades_gracefully_without_tavily_config() {
        let llm = MockLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
            ]),
        };
        let pipeline = LlmGenerationPipeline::new(Box::new(llm));
        let mut request = sample_request();
        request.enable_web_search = true;

        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        assert_eq!(outlines.len(), 1);
    }

    #[tokio::test]
    async fn injects_cached_research_context_into_generation_prompts() {
        let llm = Arc::new(PromptCaptureLlmProvider {
            responses: Mutex::new(vec![
                r#"{"outlines":[{"title":"Intro to Fractions","description":"Basic idea","key_points":["What a fraction is"],"scene_type":"slide"}]}"#.to_string(),
                r#"{"elements":[{"kind":"text","content":"Fractions represent parts of a whole.","left":60.0,"top":80.0,"width":800.0,"height":100.0}]}"#.to_string(),
                r#"{"actions":[{"action_type":"speech","text":"A fraction shows part of a whole."}]}"#.to_string(),
            ]),
            prompts: Mutex::new(Vec::new()),
        });
        let pipeline = LlmGenerationPipeline::new(Box::new(SharedPromptCaptureLlmProvider {
            inner: Arc::clone(&llm),
        }));
        let mut request = sample_request();
        request.enable_web_search = true;
        pipeline.prime_research_cache_for_tests(
            &request,
            "Sources:\n- [Fraction basics](https://example.com): Fractions are parts of a whole.",
        );

        let outlines = pipeline.generate_outlines(&request).await.unwrap();
        let content = pipeline
            .generate_scene_content(&request, &outlines[0])
            .await
            .unwrap();
        let _actions = pipeline
            .generate_scene_actions(&request, &outlines[0], &content)
            .await
            .unwrap();

        let prompts = llm.prompts.lock().unwrap();
        assert!(prompts
            .iter()
            .all(|(_, user)| user.contains("External research context:")));
        assert!(prompts
            .iter()
            .all(|(_, user)| user.contains("Fraction basics")));
    }

    struct SharedPromptCaptureLlmProvider {
        inner: Arc<PromptCaptureLlmProvider>,
    }

    #[async_trait]
    impl LlmProvider for SharedPromptCaptureLlmProvider {
        async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
            self.inner.generate_text(system_prompt, user_prompt).await
        }
    }
}

fn fallback_project_summary(outline: &SceneOutline) -> String {
    let focus = outline
        .key_points
        .first()
        .cloned()
        .unwrap_or_else(|| outline.title.clone());
    format!(
        "Project goal: build a small artifact that demonstrates '{}'. Deliverable: a concise explanation with one worked example.",
        focus
    )
}
