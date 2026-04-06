use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use tokio::time::{sleep, Duration};

use ai_tutor_domain::{
    action::LessonAction,
    generation::{Language, LessonGenerationRequest},
    scene::{
        MediaGenerationRequest, MediaType, QuizOption, QuizQuestion, QuizQuestionType,
        SceneContent, SceneOutline, SceneType, SlideCanvas, SlideElement, SlideTheme,
    },
};
use ai_tutor_providers::traits::LlmProvider;

use crate::pipeline::LessonGenerationPipeline;

pub struct LlmGenerationPipeline {
    llm: Box<dyn LlmProvider>,
}

impl LlmGenerationPipeline {
    pub fn new(llm: Box<dyn LlmProvider>) -> Self {
        Self { llm }
    }

    async fn generate_with_retry(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        let mut last_error = None;

        for attempt in 0..MAX_LLM_ATTEMPTS {
            match self.llm.generate_text(system_prompt, user_prompt).await {
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
}

const MAX_LLM_ATTEMPTS: usize = 3;
const RETRY_BACKOFF_MS: u64 = 150;

#[derive(Deserialize)]
struct OutlineEnvelope {
    outlines: Vec<OutlineDto>,
}

#[derive(Deserialize)]
struct OutlineDto {
    title: String,
    description: String,
    key_points: Vec<String>,
    scene_type: String,
    #[serde(default)]
    media_generations: Vec<MediaGenerationDto>,
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
    kind: String,
    content: Option<String>,
    src: Option<String>,
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

#[async_trait]
impl LessonGenerationPipeline for LlmGenerationPipeline {
    async fn generate_outlines(&self, request: &LessonGenerationRequest) -> Result<Vec<SceneOutline>> {
        let language = language_code(&request.requirements.language);
        let system = "You are an instructional designer. Return strict JSON only.";
        let user = format!(
            "Create a lesson outline for this requirement.\n\
             Requirement: {}\n\
             Language: {}\n\
             Return JSON object with shape {{\"outlines\":[{{\"title\":\"...\",\"description\":\"...\",\"key_points\":[\"...\"],\"scene_type\":\"slide|quiz|interactive\",\"media_generations\":[{{\"element_id\":\"gen_img_1\",\"media_type\":\"image|video\",\"prompt\":\"...\",\"aspect_ratio\":\"16:9\"}}]}}]}}.\n\
             Use 3 to 5 scenes and include at least one quiz scene.\n\
             Only include `media_generations` on scenes that truly benefit from generated visuals.\n\
             Image generation enabled: {}.\n\
             Video generation enabled: {}.\n\
             If image generation is enabled, you may request 0 or 1 generated image for a slide scene.\n\
             If video generation is disabled, do not request video media.",
            request.requirements.requirement,
            language,
            request.enable_image_generation,
            request.enable_video_generation
        );

        let response = self.generate_with_retry(system, &user).await?;
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

                SceneOutline {
                    id: format!("outline-{}", index + 1),
                    scene_type,
                    title,
                    description,
                    key_points,
                    teaching_objective: None,
                    estimated_duration: None,
                    order: (index + 1) as i32,
                    language: Some(language.to_string()),
                    suggested_image_ids: vec![],
                    media_generations,
                    quiz_config: None,
                    interactive_config: None,
                    project_config: None,
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
            SceneType::Interactive => Ok(SceneContent::Interactive {
                url: String::new(),
                html: Some(format!(
                    "<div><h1>{}</h1><p>{}</p></div>",
                    outline.title, outline.description
                )),
            }),
            SceneType::Pbl => Err(anyhow!("PBL generation is not implemented yet")),
        }
    }

    async fn generate_scene_actions(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        content: &SceneContent,
    ) -> Result<Vec<LessonAction>> {
        let system = "You are a teaching script planner. Return strict JSON only.";
        let user = format!(
            "Create ordered classroom actions for this scene.\n\
             Lesson requirement: {}\n\
             Scene title: {}\n\
             Scene type: {:?}\n\
             Scene summary JSON: {}\n\
             Return JSON object with shape {{\"actions\":[{{\"action_type\":\"speech|spotlight|discussion\",\"text\":\"...\",\"element_id\":\"optional\",\"topic\":\"optional\"}}]}}.\n\
             Include at least one speech action.",
            request.requirements.requirement,
            outline.title,
            outline.scene_type,
            serde_json::to_string(content)?
        );

        let response = self.generate_with_retry(system, &user).await?;
        let payload: ActionsEnvelope = parse_json_with_repair(&response)
            .unwrap_or_else(|_| ActionsEnvelope { actions: vec![] });

        let mut actions = payload
            .actions
            .into_iter()
            .enumerate()
            .filter_map(|(index, action)| map_action(action, index))
            .collect::<Vec<_>>();

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
        let system = "You are a slide designer. Return strict JSON only.";
        let user = format!(
            "Create slide elements for a teaching slide.\n\
             Lesson requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             Media placeholders available for this slide: {}.\n\
             Canvas size: 1000x563.\n\
             Return JSON object with shape {{\"elements\":[{{\"kind\":\"text|image\",\"content\":\"optional\",\"src\":\"optional\",\"left\":0,\"top\":0,\"width\":0,\"height\":0}}]}}.\n\
             Use mostly text elements and keep positions within the canvas.\n\
             If a media placeholder exists, create an image element using its exact `src` placeholder value.\n\
             Language: {}",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
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
            attach_media_placeholders(elements, outline)
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
        let system = "You are a quiz generator. Return strict JSON only.";
        let user = format!(
            "Create quiz questions for this lesson scene.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Key points: {}\n\
             Return JSON object with shape {{\"questions\":[{{\"question\":\"...\",\"options\":[\"...\"],\"answer\":[\"...\"]}}]}}.\n\
             Use 2 or 3 multiple-choice questions.",
            request.requirements.requirement,
            outline.title,
            outline.key_points.join(" | ")
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
}

fn map_scene_type(value: &str) -> SceneType {
    match value.trim().to_ascii_lowercase().as_str() {
        "quiz" => SceneType::Quiz,
        "interactive" => SceneType::Interactive,
        "pbl" | "project" => SceneType::Pbl,
        _ => SceneType::Slide,
    }
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
    match element.kind.trim().to_ascii_lowercase().as_str() {
        "image" => SlideElement::Image {
            id: format!("image-{}", index + 1),
            left: element.left,
            top: element.top,
            width: element.width,
            height: element.height,
            src: element.src.unwrap_or_default(),
        },
        _ => SlideElement::Text {
            id: format!("text-{}", index + 1),
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
        let exists = elements.iter().any(|element| match (element, &media.media_type) {
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

fn repair_media_elements(mut elements: Vec<SlideElement>, outline: &SceneOutline) -> Vec<SlideElement> {
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

fn parse_json_with_repair<T>(response: &str) -> Result<T>
where
    T: DeserializeOwned,
{
    if let Ok(parsed) = serde_json::from_str::<T>(response) {
        return Ok(parsed);
    }

    let sanitized = strip_code_fences(response);
    if let Ok(parsed) = serde_json::from_str::<T>(&sanitized) {
        return Ok(parsed);
    }

    if let Some(json) = extract_balanced_json(&sanitized) {
        if let Ok(parsed) = serde_json::from_str::<T>(&json) {
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

fn strip_code_fences(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
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
                &["Core concept overview".to_string(), "Why this topic matters".to_string()],
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
        "discussion" => Some(LessonAction::Discussion {
            id,
            title: Some("Discussion".to_string()),
            description: None,
            topic: action.topic.or(action.text).unwrap_or_else(|| "Discuss the scene".to_string()),
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
    use std::sync::{atomic::{AtomicUsize, Ordering}, Arc, Mutex};

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
                assert_eq!(canvas.elements.len(), 2);
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
        assert!(
            outlines[0].media_generations[0]
                .prompt
                .contains("Intro to Fractions")
        );
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
                assert!(canvas.elements.iter().any(|element| matches!(element, SlideElement::Text { .. })));
                assert!(canvas.elements.iter().any(|element| match element {
                    SlideElement::Image { src, .. } => src == "gen_img_1",
                    _ => false,
                }));
            }
            _ => panic!("expected slide content"),
        }
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
        let error = pipeline.generate_outlines(&sample_request()).await.unwrap_err();

        assert!(error.to_string().contains("missing api key"));
        assert_eq!(llm.call_count.load(Ordering::SeqCst), 1);
    }
}
