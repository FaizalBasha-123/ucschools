use anyhow::Result;

use ai_tutor_domain::{
    generation::LessonGenerationRequest,
    scene::{
        SceneContent, SceneOutline, ScientificModel,
    },
};


use super::*;
use crate::generation::dtos::*;
use crate::generation::helpers::*;

impl LlmGenerationPipeline {
pub(crate)     async fn generate_interactive_content(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        pdf_context: Option<&str>,
    ) -> Result<SceneContent> {
        let scientific_model = self
            .generate_interactive_scientific_model(request, outline, pdf_context)
            .await;
        let widget_type = outline.widget_type.as_deref().unwrap_or("simulation");
        let mut vars = std::collections::HashMap::new();
        vars.insert("title", outline.title.clone());
        vars.insert("description", outline.description.clone());
        vars.insert("keyPoints", outline.key_points.join("\n"));
        vars.insert("languageDirective", outline.language.as_deref().unwrap_or("Teach in English.").to_string());
        
        let outline_json = outline.widget_outline.clone().unwrap_or_else(|| serde_json::json!({}));
        
        let prompt_id = match widget_type {
            "simulation" => {
                vars.insert("conceptName", outline.title.clone());
                vars.insert("conceptOverview", outline.description.clone());
                vars.insert("variables", outline_json.get("keyVariables").and_then(|v| v.as_array()).map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default());
                vars.insert("designIdea", "".to_string());
                "simulation-content"
            },
            "diagram" => {
                vars.insert("diagramType", outline_json.get("diagramType").and_then(|v| v.as_str()).unwrap_or("flowchart").to_string());
                "diagram-content"
            },
            "code" => {
                vars.insert("programmingLanguage", outline_json.get("language").and_then(|v| v.as_str()).unwrap_or("python").to_string());
                vars.insert("starterCode", "".to_string());
                vars.insert("testCases", "".to_string());
                vars.insert("hints", "".to_string());
                "code-content"
            },
            "game" => {
                vars.insert("gameType", outline_json.get("gameType").and_then(|v| v.as_str()).unwrap_or("quiz").to_string());
                vars.insert("scoring", "".to_string()); 
                "game-content"
            },
            "visualization3d" => {
                vars.insert("visualizationType", outline_json.get("visualizationType").and_then(|v| v.as_str()).unwrap_or("custom").to_string());
                vars.insert("objects", outline_json.get("objects").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default());
                vars.insert("interactions", outline_json.get("interactions").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default());
                "visualization3d-content"
            },
            _ => {
                vars.insert("conceptName", outline.title.clone());
                vars.insert("conceptOverview", outline.description.clone());
                vars.insert("variables", "".to_string());
                vars.insert("designIdea", "".to_string());
                "simulation-content"
            }
        };

        let (system, user) = crate::prompt_builder::build_prompt(prompt_id, &vars).unwrap_or_else(|| {
            (
                "You create educational HTML interactives. Return a complete self-contained HTML document.".to_string(),
                format!("Interactive: {}\nRequirement: {}", outline.title, request.requirements.requirement)
            )
        });

        let has_pdf = pdf_context.map_or(false, |c| !c.trim().is_empty());

        let (response, _usage) = self.generate_with_search_tool(&system, &user, has_pdf).await?;
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

}
impl LlmGenerationPipeline {
pub(crate)     async fn repair_interactive_html(
        &self,
        request: &LessonGenerationRequest,
        outline: &SceneOutline,
        scientific_model: Option<&ScientificModel>,
        html: &str,
        repair_notes: &str,
    ) -> Result<String> {
        let system = "You repair educational interactive HTML. Return a complete self-contained HTML document only.";
        let user = format!(
            "Repair this educational interactive so it is classroom-usable.\n\
             Requirement: {}\n\
             Scene title: {}\n\
             Scene description: {}\n\
             Key points: {}\n\
             Scientific constraints:\n{}\n\
             Repair requirements:\n{}\n\
             Existing HTML:\n{}\n\
             Return a complete repaired HTML5 document using only plain HTML/CSS/JavaScript. Keep the interaction safe, responsive, and immediately usable for students.",
            request.requirements.requirement,
            outline.title,
            outline.description,
            outline.key_points.join(" | "),
            interactive_scientific_constraints(&scientific_model.cloned()),
            repair_notes,
            html
        );
        let (response, _usage) = self.generate_with_retry(system, &user).await?;
        let repaired = extract_html_document(&response).unwrap_or(response);
        Ok(post_process_interactive_html(
            &repaired,
            outline,
            scientific_model,
        ))
    }

}
