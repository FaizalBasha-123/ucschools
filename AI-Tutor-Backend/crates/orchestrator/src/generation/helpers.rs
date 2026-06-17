use std::collections::HashMap;
use anyhow::{anyhow, Result};
use serde::de::DeserializeOwned;
use serde_json::Value;

use ai_tutor_domain::{
    action::LessonAction,
    generation::{Language, LessonGenerationRequest},
    scene::{
        GeneratedAgentConfig, InteractiveConfig, MediaGenerationRequest, MediaType,
        ProjectAgentRole, ProjectIssue, ProjectOutlineConfig, QuizConfig, SceneContent, SceneOutline, SceneType, ScientificModel, SlideElement, VisualType,
    },
};
use ai_tutor_providers::traits::ProviderUsage;


use super::*;
use crate::generation::dtos::*;


pub(crate) fn parse_actions_from_generation_response(
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

pub(crate) fn map_scene_type(value: &str) -> SceneType {
    match value.trim().to_ascii_lowercase().as_str() {
        "quiz" => SceneType::Quiz,
        "interactive" => SceneType::Interactive,
        "pbl" | "project" => SceneType::Pbl,
        _ => SceneType::Slide,
    }
}

pub(crate) fn normalize_quiz_config(
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

pub(crate) fn normalize_interactive_config(
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

pub(crate) fn normalize_project_outline_config(
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

#[allow(dead_code)]
pub(crate) fn map_media_generation(media: MediaGenerationDto) -> Option<MediaGenerationRequest> {
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

pub(crate) fn map_slide_element(element: SlideElementDto, index: usize) -> SlideElement {
    let id = element
        .id
        .unwrap_or_else(|| format!("element-{}", index + 1));
    let rotate = element.rotate;
    let left = element.left;
    let top = element.top;
    let width = element.width;
    let height = element.height;

    match element.kind.trim().to_ascii_lowercase().as_str() {
        "image" => SlideElement::Image { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            fixed_ratio: true,
        },
        "video" => SlideElement::Video { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
        },
        "shape" => SlideElement::Shape { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            shape_name: element.shape_name,
            fill: element.fill.unwrap_or_else(|| "#5b9bd5".to_string()),
            path: element.path.or_else(|| Some(format!("M0 0 L{} 0 L{} {} L0 {} Z", width, width, height, height))),
            view_box: element.view_box.or_else(|| Some(vec![0.0, 0.0, width, height])),
        },
        "line" => SlideElement::Line { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            start: element.start.or_else(|| Some(vec![left, top])),
            end: element.end.or_else(|| Some(vec![left + width, top + height])),
            style: element.style.or_else(|| Some("solid".to_string())),
            color: element.color.or_else(|| Some("#333333".to_string())),
            points: if element.points.as_ref().map(|p| p.len() == 2).unwrap_or(false) {
                element.points
            } else {
                Some(vec!["".to_string(), "".to_string()])
            },
            broken: element.broken,
            broken2: element.broken2,
            curve: element.curve,
            cubic: element.cubic,
        },
        "chart" => SlideElement::Chart { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            chart_type: element.chart_type,
            data: element.data,
            theme_colors: element.theme_colors,
        },
        "latex" => SlideElement::Latex { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            latex: element.latex.unwrap_or_default(),
            color: element.color,
            align: element.align,
        },
        "table" => SlideElement::Table { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths: element.col_widths,
            data: element.data,
            outline: element.outline,
        },
        _ => SlideElement::Text { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            content: element.content.unwrap_or_default(),
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#333333".to_string(),
        },
    }
}

/// Maps a raw string from the LLM to a VisualType.
pub(crate) fn map_visual_type(raw: Option<&str>) -> Option<VisualType> {
    match raw?.trim().to_ascii_lowercase().as_str() {
        "chart" => Some(VisualType::Chart),
        "latex" => Some(VisualType::Latex),
        "html"  => Some(VisualType::Html),
        "image" => Some(VisualType::Image),
        "none" | "" => Some(VisualType::None),
        _ => None,
    }
}


/// Builds a context-aware image prompt for AI image generation.
/// Only called when the LLM explicitly chose visual_type = Image.
pub(crate) fn build_smart_image_prompt(title: &str, description: &str, key_points: &[String]) -> String {
    let kp_text = if key_points.is_empty() {
        String::new()
    } else {
        format!(" Key components visible as labeled annotations: {}.", key_points.join(", "))
    };

    // Always use white background + bold text labels. This ensures images are legible
    // on both the lesson canvas and the whiteboard. No fragile keyword matching —
    // the title + description already encode the domain context the model needs.
    format!(
        "White background. Clean educational diagram. Bold black sans-serif text labels \
         clearly identifying each part. Simple flat vector-art style, no photorealistic \
         textures, no decorative gradients. High contrast, classroom-quality, textbook style. \
         Subject: {title}. {description}.{kp}",
        title = title,
        description = description,
        kp = kp_text,
    )
}


pub(crate) fn attach_media_placeholders(
    mut elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    let mut next_index = elements.len();

    for media in outline.media_generations.iter() {
        let exists = elements
            .iter()
            .any(|element| match (element, &media.media_type) {
                (SlideElement::Image {
src, .. }, MediaType::Image)
                | (SlideElement::Video {
src, .. }, MediaType::Video) => src == &media.element_id,
                _ => false,
            });

        if exists {
            continue;
        }

        next_index += 1;
        match media.media_type {
            MediaType::Image => elements.push(SlideElement::Image { shadow: None,
                id: media.element_id.clone(),
                left: 620.0,
                top: 120.0,
                width: 300.0,
                height: 220.0,
                rotate: 0.0,
                src: media.element_id.clone(),
                fixed_ratio: false,
            }),
            MediaType::Video => elements.push(SlideElement::Video { shadow: None,
                id: media.element_id.clone(),
                left: 620.0,
                top: 120.0,
                width: 300.0,
                height: 220.0,
                rotate: 0.0,
                src: media.element_id.clone(),
            }),
        }
    }

    if elements.is_empty() && next_index == 0 {
        elements.push(SlideElement::Text { shadow: None,
            id: "text-fallback-1".to_string(),
            left: 60.0,
            top: 80.0,
            width: 800.0,
            height: 100.0,
            rotate: 0.0,
            content: outline.description.clone(),
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#333333".to_string(),
        });
    }

    elements
}

pub(crate) fn parse_aspect_ratio_str(ratio: Option<&str>) -> Option<f32> {
    let r = ratio?;
    let parts: Vec<&str> = r.split(':').collect();
    if parts.len() == 2 {
        if let (Ok(w), Ok(h)) = (parts[0].trim().parse::<f32>(), parts[1].trim().parse::<f32>()) {
            if h > 0.0 {
                return Some(w / h);
            }
        }
    }
    None
}

pub(crate) fn repair_media_elements(
    mut elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    for element in &mut elements {
        match element {
            SlideElement::Image {
src, width, height, .. } => {
                let mut known_ratio: Option<f32> = None;
                
                if src.trim().is_empty() {
                    if let Some(media) = outline
                        .media_generations
                        .iter()
                        .find(|media| matches!(media.media_type, MediaType::Image))
                    {
                        *src = media.element_id.clone();
                        known_ratio = parse_aspect_ratio_str(media.aspect_ratio.as_deref());
                    }
                } else {
                    if let Some(media) = outline
                        .media_generations
                        .iter()
                        .find(|media| media.element_id == *src)
                    {
                        known_ratio = parse_aspect_ratio_str(media.aspect_ratio.as_deref());
                    }
                }

                // Aspect Ratio Correction and Margin Enforcement
                if let Some(ratio) = known_ratio {
                    let cur_w = *width;
                    let cur_h = *height;
                    if cur_h > 0.0 {
                        let cur_ratio = cur_w / cur_h;
                        if ((cur_ratio - ratio) / ratio).abs() > 0.1 {
                            // Keep width, correct height
                            let mut new_h = cur_w / ratio;
                            let mut new_w = cur_w;
                            if new_h > 462.0 {
                                // canvas 562.5 - margins 50x2
                                new_h = 462.0;
                                new_w = 462.0 * ratio;
                            }
                            *width = new_w.round();
                            *height = new_h.round();
                        }
                    }
                }
            }
            SlideElement::Video {
src, .. } => {
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

#[allow(dead_code)]
pub(crate) fn build_fallback_image_prompt(title: &str, description: &str, key_points: &[String]) -> String {
    let kp_text = if key_points.is_empty() {
        String::new()
    } else {
        format!(" Key components: {}.", key_points.join(", "))
    };

    format!(
        "White background. Clean educational diagram. Bold black sans-serif text labels \
         clearly identifying each part. Simple flat vector-art style, no photorealistic \
         textures. High contrast, classroom-quality. \
         Teaching slide titled '{title}'. {description}.{kp}",
        title = title,
        description = description,
        kp = kp_text,
    )
}


pub(crate) fn build_course_context(all_outlines: &[SceneOutline], outline_index: usize) -> String {
    if all_outlines.is_empty() {
        return String::new();
    }
    let mut lines: Vec<String> = Vec::new();
    lines.push("Course Outline:".to_string());
    for (i, o) in all_outlines.iter().enumerate() {
        let marker = if i == outline_index { " ← current" } else { "" };
        lines.push(format!("  {}. {}{}", i + 1, o.title, marker));
    }
    lines.push(String::new());
    lines.push(
        "IMPORTANT: All pages belong to the SAME class session. Do NOT greet again after the first page. When referencing content from earlier pages, say \"we just covered\" or \"as mentioned on page N\" — NEVER say \"last class\" or \"previous session\" because there is no previous session.".to_string(),
    );
    lines.push(String::new());
    if outline_index == 0 {
        lines.push("Position: This is the FIRST page. Open with a greeting and course introduction.".to_string());
    } else if outline_index == all_outlines.len() - 1 {
        lines.push("Position: This is the LAST page. Conclude the course with a summary and closing.".to_string());
        lines.push("Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.".to_string());
    } else {
        lines.push(format!("Position: Page {} of {} (middle of the course).", outline_index + 1, all_outlines.len()));
        lines.push("Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.".to_string());
    }
    lines.join("\n")
}

pub(crate) fn format_agents_for_prompt(agents: &[GeneratedAgentConfig]) -> String {
    if agents.is_empty() {
        return String::new();
    }
    let mut lines = vec!["Classroom Agents:".to_string()];
    for a in agents {
        let persona_part = if !a.persona.is_empty() {
            format!(" — {}", a.persona)
        } else {
            String::new()
        };
        lines.push(format!("- id: \"{}\", name: \"{}\", role: {}{}", a.id, a.name, a.role, persona_part));
    }
    lines.join("\n")
}

pub(crate) fn build_scene_action_prompt(
    request: &LessonGenerationRequest,
    outline: &SceneOutline,
    content: &SceneContent,
    pdf_context: Option<&str>,
    all_outlines: &[SceneOutline],
    outline_index: usize,
    agents: &[GeneratedAgentConfig],
) -> Result<(String, String)> {
    let content_summary = scene_content_summary(content)?;
    let language = language_code(&request.requirements.language);
    let pdf_info = pdf_context.map(|ctx| format!("Attached PDF Content Context:\n{}\n", ctx)).unwrap_or_default();
    let course_ctx = build_course_context(all_outlines, outline_index);
    let agents_str = format_agents_for_prompt(agents);

    let user_profile = {
        let nick = request.requirements.user_nickname.as_deref().unwrap_or_default();
        let bio = request.requirements.user_bio.as_deref().unwrap_or_default();
        if nick.is_empty() && bio.is_empty() {
            String::new()
        } else {
            format!("User Profile:\nNickname: {}\nBio: {}", nick, bio)
        }
    };

    let teacher_context = agents.iter().find(|a| a.role == "teacher").map(|t| {
        format!("Teacher Persona:\nName: {}\n{}\n\nWrite speech in this teacher's natural voice and style. Adapt tone, enthusiasm, and pacing to match their personality.",
            t.name, t.persona)
    }).unwrap_or_default();

    let (template_id, template_vars): (&str, Vec<(&str, String)>) = match outline.scene_type {
        SceneType::Slide => {
            let key_points = outline.key_points.iter().enumerate()
                .map(|(i, p)| format!("{}. {}", i + 1, p))
                .collect::<Vec<_>>().join("\n");
            ("slide-actions", vec![
                ("title", outline.title.clone()),
                ("description", outline.description.clone()),
                ("pdfContext", pdf_info),
                ("keyPoints", key_points),
                ("elements", slide_focus_targets(content)),
                ("content", content_summary.clone()),
                ("courseContext", course_ctx),
                ("agents", agents_str),
                ("userProfile", user_profile),
                ("languageDirective", format!("Language: {}", language)),
                ("teacherContext", teacher_context),
            ])
        },
        SceneType::Quiz => {
            let questions = match content {
                SceneContent::Quiz { questions } => serde_json::to_string(questions).unwrap_or_default(),
                _ => String::new(),
            };
            let key_points = outline.key_points.join(" | ");
            ("quiz-actions", vec![
                ("title", outline.title.clone()),
                ("description", outline.description.clone()),
                ("questions", questions),
                ("keyPoints", key_points),
                ("courseContext", course_ctx),
                ("agents", agents_str),
                ("languageDirective", format!("Language: {}", language)),
                ("teacherContext", teacher_context.clone()),
            ])
        },
        SceneType::Interactive => {
            let concept_name = outline.title.clone();
            let design_idea = interactive_scene_summary(content);
            let key_points = outline.key_points.join(" | ");
            ("interactive-actions", vec![
                ("title", outline.title.clone()),
                ("description", outline.description.clone()),
                ("conceptName", concept_name),
                ("designIdea", design_idea),
                ("keyPoints", key_points),
                ("courseContext", course_ctx),
                ("agents", agents_str),
                ("languageDirective", format!("Language: {}", language)),
                ("teacherContext", teacher_context.clone()),
            ])
        },
        SceneType::Pbl => {
            let project_topic = outline.title.clone();
            let project_description = outline.description.clone();
            let key_points = outline.key_points.join(" | ");
            ("pbl-actions", vec![
                ("title", outline.title.clone()),
                ("description", outline.description.clone()),
                ("projectTopic", project_topic),
                ("projectDescription", project_description),
                ("keyPoints", key_points),
                ("courseContext", course_ctx),
                ("agents", agents_str),
                ("languageDirective", format!("Language: {}", language)),
                ("teacherContext", teacher_context.clone()),
            ])
        },
    };

    let vars_map: std::collections::HashMap<&str, String> = template_vars.into_iter().collect();
    if let Some((sys, usr)) = crate::prompt_builder::build_prompt(template_id, &vars_map) {
        return Ok((sys, usr));
    }

    // fallback
    Ok((
        "You are an instructional designer. Return strict JSON only.".to_string(),
        format!("Teaching actions for: {}", outline.title),
    ))
}

pub(crate) fn interactive_scientific_constraints(scientific_model: &Option<ScientificModel>) -> String {
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

pub(crate) fn scientific_model_revision_notes(model: &ScientificModel) -> Option<String> {
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

pub(crate) fn merge_scientific_models(current: ScientificModel, revised: ScientificModel) -> ScientificModel {
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

pub(crate) fn project_content_revision_notes(payload: &ProjectContentEnvelope) -> Option<String> {
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

pub(crate) fn merge_project_content(
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

pub(crate) fn extract_html_document(response: &str) -> Option<String> {
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

pub(crate) fn interactive_html_repair_notes(html: &str) -> Option<String> {
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

pub(crate) fn post_process_interactive_html(
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

pub(crate) fn fallback_interactive_html(
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

pub(crate) fn map_project_agent_roles(raw: Vec<ProjectAgentRoleEnvelope>) -> Option<Vec<ProjectAgentRole>> {
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

pub(crate) fn map_project_issue_board(raw: Vec<ProjectIssueEnvelope>) -> Option<Vec<ProjectIssue>> {
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

pub(crate) fn project_outline_summary(outline: &SceneOutline) -> String {
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



pub(crate) fn scene_content_summary(content: &SceneContent) -> Result<String> {
    Ok(serde_json::to_string(content)?)
}

pub(crate) fn slide_focus_targets(content: &SceneContent) -> String {
    match content {
        SceneContent::Slide { canvas } => canvas
            .elements
            .iter()
            .map(|element| match element {
                SlideElement::Text {
id,
                content, .. } => format!("{}:text:{}", id, content),
                SlideElement::Image {
id,
                src, .. } => format!("{}:image:{}", id, src),
                SlideElement::Video {
id,
                src, .. } => format!("{}:video:{}", id, src),
                SlideElement::Shape {
id,
                shape_name, .. } => {
                    format!("{}:shape:{}", id, shape_name.as_deref().unwrap_or("shape"))
                }
                SlideElement::Chart {
id,
                chart_type, .. } => {
                    format!("{}:chart:{}", id, chart_type.as_deref().unwrap_or("chart"))
                }
                SlideElement::Latex {
id,
                latex, .. } => format!("{}:latex:{}", id, latex),
                SlideElement::Line {
id,
                .. } => format!("{}:line", id),
                SlideElement::Table {
id,
                .. } => format!("{}:table", id),
            })
            .collect::<Vec<_>>()
            .join(", "),
        _ => "none".to_string(),
    }
}

pub(crate) fn interactive_scene_summary(content: &SceneContent) -> String {
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



pub(crate) fn parse_structured_actions(
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

pub(crate) fn valid_slide_targets(content: &SceneContent) -> HashMap<String, &'static str> {
    match content {
        SceneContent::Slide { canvas } => canvas
            .elements
            .iter()
            .map(|element| match element {
                SlideElement::Text {
id,
                .. } => (id.clone(), "text"),
                SlideElement::Image {
id,
                .. } => (id.clone(), "image"),
                SlideElement::Video {
id,
                .. } => (id.clone(), "video"),
                SlideElement::Shape {
id,
                .. } => (id.clone(), "shape"),
                SlideElement::Line {
id,
                .. } => (id.clone(), "line"),
                SlideElement::Chart {
id,
                .. } => (id.clone(), "chart"),
                SlideElement::Latex {
id,
                .. } => (id.clone(), "latex"),
                SlideElement::Table {
id,
                .. } => (id.clone(), "table"),
            })
            .collect(),
        _ => HashMap::new(),
    }
}

pub(crate) fn map_structured_action_item(
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

pub(crate) fn enforce_discussion_last(actions: &mut Vec<LessonAction>) {
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

pub(crate) fn validate_slide_elements(
    elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    let mut normalized = elements
        .into_iter()
        .filter_map(normalize_slide_element)
        .collect::<Vec<_>>();

    if !normalized
        .iter()
        .any(|element| matches!(element, SlideElement::Text {
content, .. } if content.contains(&outline.title)))
    {
        normalized.insert(
            0,
            SlideElement::Text { shadow: None,
                id: "text-title-auto".to_string(),
                left: 60.0,
                top: 48.0,
                width: 880.0,
                height: 60.0,
                rotate: 0.0,
                content: format!("<p style=\"font-size: 32px; font-weight: bold;\">{}</p>", outline.title),
                default_font_name: "Microsoft YaHei".to_string(),
                default_color: "#333333".to_string(),
            },
        );
    }

    if normalized.is_empty() {
        fallback_slide_elements(outline)
    } else {
        normalized
    }
}

pub(crate) fn normalize_slide_element(element: SlideElement) -> Option<SlideElement> {
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
            rotate,
            content,
            default_font_name,
            default_color,
            .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Text { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                content: content.trim().to_string(),
                default_font_name,
                default_color,
            }
        }),
        SlideElement::Image {
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            fixed_ratio,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Image { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
                fixed_ratio,
            }
        }),
        SlideElement::Video {
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Video { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
            }
        }),
        SlideElement::Shape {
id,
            left,
            top,
            width,
            height,
            rotate,
            shape_name,
            fill,
            path,
            view_box,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Shape { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                shape_name,
                fill,
                path,
                view_box,
            }
        }),
        SlideElement::Line {
id,
            left,
            top,
            width,
            height,
            rotate,
            start,
            end,
            style,
            color,
            points,
            broken,
            broken2,
            curve,
            cubic,
            .. 
        } => normalize_box(left, top, width.max(2.0), height.max(2.0)).map(
            |(left, top, width, height)| SlideElement::Line { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                start,
                end,
                style,
                color,
                points,
                broken,
                broken2,
                curve,
                cubic,
            },
        ),
        SlideElement::Chart {
id,
            left,
            top,
            width,
            height,
            rotate,
            chart_type,
            data,
            theme_colors,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Chart { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                chart_type,
                data,
                theme_colors,
            }
        }),
        SlideElement::Latex {
id,
            left,
            top,
            width,
            height,
            rotate,
            latex,
            color,
            align,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Latex { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                latex,
                color,
                align,
            }
        }),
        SlideElement::Table {
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths,
            data,
            outline,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Table { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                col_widths,
                data,
                outline,
            }
        }),
    }
}

pub(crate) fn parse_json_with_repair<T>(response: &str) -> Result<T>
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

/// Accumulate LLM usage from a single call into an accumulator.
/// Sums input and output tokens across multiple LLM calls.
pub(crate) fn accumulate_usage(acc: &mut Option<ProviderUsage>, new: Option<ProviderUsage>) {
    match (acc.as_mut(), new) {
        (Some(ref mut a), Some(n)) => {
            a.input_tokens += n.input_tokens;
            a.output_tokens += n.output_tokens;
            a.total_tokens = Some(a.total_tokens.unwrap_or(0) + n.total_tokens.unwrap_or(0));
        }
        (None, Some(n)) => *acc = Some(n),
        _ => {}
    }
}

pub(crate) fn should_retry_llm_error(error: &anyhow::Error) -> bool {
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

pub(crate) fn format_search_results_as_context(result: &TavilySearchResponse) -> String {
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

/// Parse the LLM response to check if the model requested a web search tool call.
/// Returns the search query if a tool call was requested, None otherwise.
pub(crate) fn parse_web_search_tool_call(response: &str) -> Option<String> {
    let trimmed = response.trim();
    // Check for the tool call marker
    let marker_pos = trimmed.find(WEB_SEARCH_TOOL_CALL_MARKER)?;
    let after_marker = &trimmed[marker_pos + WEB_SEARCH_TOOL_CALL_MARKER.len()..];

    // Find the query marker after the tool call marker
    let query_pos = after_marker.find(WEB_SEARCH_QUERY_MARKER)?;
    let after_query = &after_marker[query_pos + WEB_SEARCH_QUERY_MARKER.len()..];

    // Extract query - take everything up to a newline or end of string
    let query = after_query
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|q| !q.is_empty())?;

    Some(query)
}

pub(crate) fn strip_code_fences(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

pub(crate) fn normalize_json_candidate(value: &str) -> String {
    // Handle common malformed payloads from LLMs: smart quotes and
    // trailing commas before `}` / `]`.
    let normalized_quotes = value.replace(['“', '”'], "\"").replace(['’', '‘'], "'");
    remove_trailing_commas(&normalized_quotes)
}

pub(crate) fn remove_trailing_commas(value: &str) -> String {
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

pub(crate) fn repair_unbalanced_json(value: &str) -> String {
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

pub(crate) fn extract_balanced_json(value: &str) -> Option<String> {
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

pub(crate) fn fallback_outlines(request: &LessonGenerationRequest) -> Vec<SceneOutline> {
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
            visual_type: Some(VisualType::None),
            media_generations: vec![],
            quiz_config: None,
            interactive_config: None,
            project_config: None,
            widget_outline: None,
            widget_type: None,
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
            visual_type: Some(VisualType::None),
            media_generations: vec![],
            quiz_config: None,
            interactive_config: None,
            project_config: None,
            widget_outline: None,
            widget_type: None,
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
            visual_type: Some(VisualType::None),
            media_generations: vec![],
            quiz_config: None,
            interactive_config: None,
            project_config: None,
            widget_outline: None,
            widget_type: None,
        },
    ]
}

pub(crate) fn fallback_slide_elements(outline: &SceneOutline) -> Vec<SlideElement> {
    let mut elements = vec![
        SlideElement::Text { shadow: None,
            id: "text-title-1".to_string(),
            left: 60.0,
            top: 50.0,
            width: 880.0,
            height: 60.0,
            rotate: 0.0,
            content: format!("<p style=\"font-size: 32px; font-weight: bold;\">{}</p>", outline.title),
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#333333".to_string(),
        },
        SlideElement::Text { shadow: None,
            id: "text-body-1".to_string(),
            left: 60.0,
            top: 130.0,
            width: 880.0,
            height: 300.0,
            rotate: 0.0,
            content: if outline.key_points.is_empty() {
                format!("<p style=\"font-size: 20px; line-height: 1.5;\">{}</p>", outline.description)
            } else {
                outline
                    .key_points
                    .iter()
                    .map(|point| format!("<p style=\"font-size: 20px; line-height: 1.5;\">• {}</p>", point))
                    .collect::<Vec<_>>()
                    .join("")
            },
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#333333".to_string(),
        },
    ];
    elements = attach_media_placeholders(elements, outline);
    elements
}

pub(crate) fn fallback_quiz_questions(outline: &SceneOutline) -> Vec<QuizQuestionDto> {
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

pub(crate) fn map_action(action: ActionDto, index: usize) -> Option<LessonAction> {
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

pub(crate) fn language_code(language: &Language) -> &'static str {
    match language {
        Language::ZhCn => "zh-CN",
        Language::EnUs => "en-US",
    }
}

pub(crate) fn fallback_project_summary(outline: &SceneOutline) -> String {
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
