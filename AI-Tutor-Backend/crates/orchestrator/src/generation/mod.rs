
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::Deserialize;
use tokio::time::{sleep, Duration};
use tracing::warn;

use ai_tutor_domain::{
    action::LessonAction,
    generation::LessonGenerationRequest,
    scene::{
        GeneratedAgentConfig, SceneContent, SceneOutline, SceneType, ScientificModel,
    },
};
use ai_tutor_providers::request_params::GenerationParams;
use ai_tutor_providers::traits::{LlmProvider, ProviderUsage};

use crate::pipeline::LessonGenerationPipeline;

pub struct LlmGenerationPipeline {
    llm: Box<dyn LlmProvider>,
    outlines_llm: Option<Box<dyn LlmProvider>>,
    scene_content_llm: Option<Box<dyn LlmProvider>>,
    scene_actions_llm: Option<Box<dyn LlmProvider>>,
    scene_actions_fallback_llm: Option<Box<dyn LlmProvider>>,
    web_search: Option<WebSearchConfig>,
}

struct WebSearchConfig {
    api_key: String,
    base_url: String,
    max_results: usize,
    client: reqwest::Client,
    on_search: Option<Box<dyn Fn(&str) + Send + Sync>>,
}

#[derive(Deserialize)]
pub(crate) struct TavilySearchResponse {
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

pub mod dtos;
pub mod helpers;
pub mod outlines;
pub mod slide;
pub mod interactive;
pub mod quiz;
pub mod project;
pub mod actions;
pub mod agents;

pub use dtos::*;
pub use helpers::*;

#[cfg(test)]
mod tests;

impl LlmGenerationPipeline {
    pub fn new(llm: Box<dyn LlmProvider>) -> Self {
        Self {
            llm,
            outlines_llm: None,
            scene_content_llm: None,
            scene_actions_llm: None,
            scene_actions_fallback_llm: None,
            web_search: None,
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
            on_search: None,
        });
        self
    }

    pub fn with_tavily_web_search_and_callback(
        mut self,
        api_key: impl Into<String>,
        base_url: impl Into<String>,
        max_results: usize,
        on_search: Box<dyn Fn(&str) + Send + Sync>,
    ) -> Self {
        self.web_search = Some(WebSearchConfig {
            api_key: api_key.into(),
            base_url: base_url.into(),
            max_results: max_results.max(1),
            client: reqwest::Client::new(),
            on_search: Some(on_search),
        });
        self
    }

    /// Call the LLM with a web search tool available. The model decides whether to search.
    /// Appends a tool prompt to the system prompt so the model knows it can request searches.
    /// If the model requests a search, executes it and re-invokes the LLM with results.
    /// Prevents infinite loops by limiting to MAX_SEARCH_TOOL_CALLS rounds.
    async fn generate_with_search_tool_using(
        &self,
        llm: &dyn LlmProvider,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        let Some(_web_search) = &self.web_search else {
            return self.generate_with_retry_using(llm, system_prompt, user_prompt).await;
        };

        let tool_prompt = format!(
            r#"
WEB SEARCH TOOL AVAILABLE:
You have access to a web search tool. Use it ONLY when you genuinely lack reliable information.

SEARCH when ALL of these are true:
- The topic requires facts you cannot confidently provide from training data
- The topic involves recent events, real-time data, or rapidly-changing statistics
- Precise, verifiable figures are needed (e.g. current prices, live regulations, recent research)

DO NOT SEARCH when:
- The topic is standard curriculum content (science, math, history, language, programming fundamentals)
- A PDF context has already been provided — use it instead of searching
- You already have sufficient knowledge to create accurate, educationally-sound content
- The topic is conceptual or definitional (how gravity works, what photosynthesis is, etc.)

To invoke, respond with EXACTLY:
{marker}
{query_marker} <specific search query>

Then continue with your response after receiving results.
If you have sufficient knowledge, respond DIRECTLY without invoking the tool.
You may invoke the tool at most {max_calls} times total.
"#,
            marker = WEB_SEARCH_TOOL_CALL_MARKER,
            query_marker = WEB_SEARCH_QUERY_MARKER,
            max_calls = MAX_SEARCH_TOOL_CALLS
        );

        let augmented_system = format!("{system_prompt}\n{tool_prompt}");
        let mut current_user = user_prompt.to_string();
        let mut accumulated_usage: Option<ProviderUsage> = None;

        for _round in 0..MAX_SEARCH_TOOL_CALLS {
            let (response, usage) = self.generate_with_retry_using(llm, &augmented_system, &current_user).await?;
            accumulate_usage(&mut accumulated_usage, usage);

            if let Some(query) = parse_web_search_tool_call(&response) {
                let results = match self.execute_tavily_search(&query).await {
                    Some(ctx) => format!("Web search results for \"{query}\":\n{ctx}"),
                    None => format!("Web search for \"{query}\" returned no results. Continue with your existing knowledge."),
                };
                current_user = format!("{user_prompt}\n\n{results}");
            } else {
                return Ok((response, accumulated_usage));
            }
        }

        let (final_response, usage) = self.generate_with_retry_using(llm, system_prompt, &current_user).await?;
        accumulate_usage(&mut accumulated_usage, usage);
        Ok((final_response, accumulated_usage))
    }

    /// Convenience wrapper using the default scene content LLM.
    async fn generate_with_search_tool(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        self.generate_with_search_tool_using(self.scene_content_llm(), system_prompt, user_prompt)
            .await
    }

    /// Like `generate_with_search_tool_using` but uses `response_format: json_object` for
    /// structured JSON generation — provides more reliable, correctly-formatted output.
    async fn generate_json_with_search_tool_using(
        &self,
        llm: &dyn LlmProvider,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        let Some(_web_search) = &self.web_search else {
            return self.generate_json_with_retry_using(llm, system_prompt, user_prompt).await;
        };

        let tool_prompt = format!(
            r#"
WEB SEARCH TOOL AVAILABLE:
You have access to a web search tool. Use it ONLY when you genuinely lack reliable information.

SEARCH when ALL of these are true:
- The topic requires facts you cannot confidently provide from training data
- The topic involves recent events, real-time data, or rapidly-changing statistics
- Precise, verifiable figures are needed (e.g. current prices, live regulations, recent research)

DO NOT SEARCH when:
- The topic is standard curriculum content (science, math, history, language, programming fundamentals)
- A PDF context has already been provided — use it instead of searching
- You already have sufficient knowledge to create accurate, educationally-sound content
- The topic is conceptual or definitional (how gravity works, what photosynthesis is, etc.)

To invoke, respond with EXACTLY:
{marker}
{query_marker} <specific search query>

Then continue with your response after receiving results.
If you have sufficient knowledge, respond DIRECTLY without invoking the tool.
You may invoke the tool at most {max_calls} times total.
"#,
            marker = WEB_SEARCH_TOOL_CALL_MARKER,
            query_marker = WEB_SEARCH_QUERY_MARKER,
            max_calls = MAX_SEARCH_TOOL_CALLS
        );

        let augmented_system = format!("{system_prompt}\n{tool_prompt}");
        let mut current_user = user_prompt.to_string();
        let mut accumulated_usage: Option<ProviderUsage> = None;

        for _round in 0..MAX_SEARCH_TOOL_CALLS {
            let (response, usage) = self.generate_json_with_retry_using(llm, &augmented_system, &current_user).await?;
            accumulate_usage(&mut accumulated_usage, usage);

            if let Some(query) = parse_web_search_tool_call(&response) {
                let results = match self.execute_tavily_search(&query).await {
                    Some(ctx) => format!("Web search results for \"{query}\":\n{ctx}"),
                    None => format!("Web search for \"{query}\" returned no results. Continue with your existing knowledge."),
                };
                current_user = format!("{user_prompt}\n\n{results}");
            } else {
                return Ok((response, accumulated_usage));
            }
        }

        let (final_response, usage) = self.generate_json_with_retry_using(llm, system_prompt, &current_user).await?;
        accumulate_usage(&mut accumulated_usage, usage);
        Ok((final_response, accumulated_usage))
    }

    /// Convenience wrapper for JSON generation using the default scene content LLM.
    async fn generate_json_with_search_tool(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        self.generate_json_with_search_tool_using(self.scene_content_llm(), system_prompt, user_prompt)
            .await
    }

    /// Execute a Tavily web search and return the formatted context string.
    /// Called when the LLM requests the web_search tool during generation.
    async fn execute_tavily_search(&self, query: &str) -> Option<String> {
        let config = self.web_search.as_ref()?;
        let normalized: String = query.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            return None;
        }
        let truncated: String = normalized.chars().take(TAVILY_SOFT_MAX_QUERY_LENGTH).collect();

        let response = config
            .client
            .post(&config.base_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&serde_json::json!({
                "query": truncated,
                "search_depth": "basic",
                "max_results": config.max_results,
                "include_answer": "basic",
            }))
            .send()
            .await
            .map_err(|e| {
                warn!("Tavily search request failed: {}", e);
                e
            })
            .ok()?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            warn!("Tavily search failed: status={} body={}", status, body);
            return None;
        }

        let result: TavilySearchResponse = response.json().await
            .map_err(|e| {
                warn!("Failed to parse Tavily response: {}", e);
                e
            })
            .ok()?;

        let context = format_search_results_as_context(&result);
        if context.is_empty() {
            return None;
        }
        if let Some(ref callback) = config.on_search {
            callback(&truncated);
        }
        Some(context)
    }

    async fn generate_with_retry_using(
        &self,
        llm: &dyn LlmProvider,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        let mut last_error = None;

        for attempt in 0..MAX_LLM_ATTEMPTS {
            match llm.generate_text_with_usage(system_prompt, user_prompt).await {
                Ok((response, usage)) => return Ok((response, usage)),
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

    /// Like `generate_with_retry_using` but expects JSON output from the LLM.
    /// (Note: We rely on the natural JSON-friendly prompt instructions and `parse_json_with_repair` 
    /// rather than forcing `response_format: json_object` to preserve creative pedagogical quality).
    async fn generate_json_with_retry_using(
        &self,
        llm: &dyn LlmProvider,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<(String, Option<ProviderUsage>)> {
        let params = GenerationParams::default();
        let mut last_error = None;

        for attempt in 0..MAX_LLM_ATTEMPTS {
            match llm.generate_text_with_params(system_prompt, user_prompt, &params).await {
                Ok((response, usage)) => return Ok((response, usage)),
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

    async fn generate_with_retry(&self, system_prompt: &str, user_prompt: &str) -> Result<(String, Option<ProviderUsage>)> {
        self.generate_with_retry_using(self.scene_content_llm(), system_prompt, user_prompt)
            .await
    }

    async fn generate_json_with_retry(&self, system_prompt: &str, user_prompt: &str) -> Result<(String, Option<ProviderUsage>)> {
        self.generate_json_with_retry_using(self.scene_content_llm(), system_prompt, user_prompt)
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

    async fn generate_interactive_scientific_model(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        pdf_context: Option<&str>,
    ) -> Option<ScientificModel> {
        let config = outline.interactive_config.as_ref()?;
        let pdf_info = pdf_context.map(|ctx| format!("Attached PDF Content Context:\n{}\n", ctx)).unwrap_or_default();
        let system =
            "You are a scientific concept modeler for educational interactives. Return strict JSON only.";
        let user = format!(
            "Create a scientific model for an educational interactive.\n\
             Requirement: {}\n\
             {}\n\
             Scene title: {}\n\
             Concept name: {}\n\
             Concept overview: {}\n\
             Design idea: {}\n\
             Key points: {}\n\
             Return JSON object with shape {{\"core_formulas\":[\"...\"],\"mechanism\":[\"...\"],\"constraints\":[\"...\"],\"forbidden_errors\":[\"...\"],\"variables\":[\"...\"],\"interaction_guidance\":[\"...\"],\"experiment_steps\":[\"...\"],\"observation_prompts\":[\"...\"]}}.\n\
             Focus on scientifically valid relationships, important constraints, common misconceptions to avoid, interactive guidance the HTML simulator must obey, a short experiment sequence, and observation prompts students should answer.",
            request.requirements.requirement,
            pdf_info,
            outline.title,
            config.concept_name,
            config.concept_overview,
            config.design_idea,
            outline.key_points.join(" | ")
        );

        let response = self.generate_json_with_search_tool(&system, &user).await.ok().map(|(r, _)| r).unwrap_or_default();
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
                .revise_interactive_scientific_model(request, outline, &scientific_model, &revision_notes)
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
             Current model summary:\n{}\n\
             Revision requirements:\n{}\n\
             Return JSON object with shape {{\"core_formulas\":[\"...\"],\"mechanism\":[\"...\"],\"constraints\":[\"...\"],\"forbidden_errors\":[\"...\"],\"variables\":[\"...\"],\"interaction_guidance\":[\"...\"],\"experiment_steps\":[\"...\"],\"observation_prompts\":[\"...\"]}}.",
            request.requirements.requirement,
            outline.title,
            config.concept_name,
            config.concept_overview,
            config.design_idea,
            outline.key_points.join(" | "),
            interactive_scientific_constraints(&Some(current.clone())),
            revision_notes,
        );

        let response = self.generate_json_with_retry(system, &user).await.ok().map(|(r, _)| r).unwrap_or_default();
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
/// Maximum web search tool calls per generation to prevent infinite loops.
const MAX_SEARCH_TOOL_CALLS: usize = 2;

/// Marker the LLM uses to request a web search tool call.
const WEB_SEARCH_TOOL_CALL_MARKER: &str = "TOOL_CALL: web_search";
/// Marker preceding the search query in the tool call.
const WEB_SEARCH_QUERY_MARKER: &str = "QUERY:";



#[async_trait]
impl LessonGenerationPipeline for LlmGenerationPipeline {
    async fn generate_outlines(
        &self,
        request: &LessonGenerationRequest,
        pdf_context: Option<&str>,
    ) -> Result<Vec<SceneOutline>> {
        self.do_generate_outlines(request, pdf_context).await
    }

    async fn generate_scene_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        pdf_context: Option<&str>,
        agents: &[GeneratedAgentConfig],
    ) -> Result<SceneContent> {
        match outline.scene_type {
            SceneType::Slide => self.generate_slide_content(request, outline, pdf_context, agents).await,
            SceneType::Quiz => self.generate_quiz_content(request, outline, pdf_context).await,
            SceneType::Interactive => self.generate_interactive_content(request, outline, pdf_context).await,
            SceneType::Pbl => self.generate_project_content(request, outline, pdf_context).await,
        }
    }

    async fn generate_scene_actions(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        content: &SceneContent,
        pdf_context: Option<&str>,
        all_outlines: &[SceneOutline],
        outline_index: usize,
        agents: &[GeneratedAgentConfig],
    ) -> Result<Vec<LessonAction>> {
        self.do_generate_scene_actions(request, outline, content, pdf_context, all_outlines, outline_index, agents).await
    }

    async fn generate_lesson_title(
        &self,
        requirement: &str,
        outlines: &[SceneOutline],
        language: &str,
    ) -> Result<String> {
        self.do_generate_lesson_title(requirement, outlines, language).await
    }

    async fn generate_agents(
        &self,
        topic: &str,
        scene_titles: &[String],
        language: &str,
    ) -> Result<Vec<GeneratedAgentConfig>> {
        self.generate_agents(topic, scene_titles, language).await
    }
}
