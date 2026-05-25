//! Whiteboard Doubt Explanation Pipeline
//!
//! When a student asks a question mid-lesson, this pipeline:
//! 1. Sends the question + scene context to an LLM with whiteboard tool-call protocol
//! 2. Executes tool calls in order (draw_text, draw_shape, generate_image, etc.)
//! 3. For wb_generate_image: generates image → uploads to asset store → emits DrawImage event
//! 4. Returns WhiteboardActionEvent list to the API handler
//!
//! Nothing is written to the lesson database. All session state lives in Redis with TTL=2h.
//! All assets live in the asset store under `wb/{wb_session_id}/`. Hard-deleted on session stop.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{error, info, warn};

use ai_tutor_domain::billing::{whiteboard_image_credits, QualityMode};
use ai_tutor_media::storage::{AssetKind, AssetStore};
use ai_tutor_providers::traits::{ImageProvider, LlmProvider};
use ai_tutor_runtime::whiteboard::WhiteboardDoubtSession;

// ─── Public event type streamed back to the client ───────────────────────────

/// A single step the whiteboard should execute.
/// The frontend processes these in order: speech plays, then drawing happens, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WhiteboardActionEvent {
    /// AI tutor speaks this text (triggers TTS on the frontend)
    Speak {
        id: String,
        text: String,
    },
    /// Draw text at (x, y) in whiteboard coordinate space (0-960 x 0-540)
    DrawText {
        id: String,
        content: String,
        x: f32,
        y: f32,
        font_size: f32,
        color: String,
    },
    /// Draw a shape (rectangle, circle, triangle)
    DrawShape {
        id: String,
        shape: String,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        fill_color: Option<String>,
        stroke_color: String,
    },
    /// Draw an arrow between two points
    DrawArrow {
        id: String,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        color: String,
        label: Option<String>,
    },
    /// Draw a LaTeX formula
    DrawLatex {
        id: String,
        latex: String,
        x: f32,
        y: f32,
        color: String,
    },
    /// Draw a chart
    DrawChart {
        id: String,
        chart_type: String,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        data: Value,
    },
    /// Place an AI-generated image at (x, y) — URL is the ephemeral asset store URL
    DrawImage {
        id: String,
        url: String,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        alt: Option<String>,
    },
    /// Clear the entire whiteboard
    Clear { id: String },
    /// Session complete — no more actions
    Done {
        credits_used: f64,
        image_count: u32,
    },
}

// ─── Pipeline struct ──────────────────────────────────────────────────────────

pub struct WhiteboardDoubtPipeline {
    llm: Arc<dyn LlmProvider>,
    image_provider: Option<Arc<dyn ImageProvider>>,
    asset_store: Arc<dyn AssetStore>,
}

impl WhiteboardDoubtPipeline {
    pub fn new(
        llm: Arc<dyn LlmProvider>,
        image_provider: Option<Arc<dyn ImageProvider>>,
        asset_store: Arc<dyn AssetStore>,
    ) -> Self {
        Self {
            llm,
            image_provider,
            asset_store,
        }
    }

    /// Explain a doubt question on the whiteboard.
    ///
    /// Returns a sequence of WhiteboardActionEvents the frontend should execute in order.
    pub async fn explain(
        &self,
        session: &mut WhiteboardDoubtSession,
        question: &str,
        prior_exchange: &[(String, String)],
    ) -> Result<Vec<WhiteboardActionEvent>> {
        let quality = QualityMode::from_str(&session.quality_mode)
            .unwrap_or(QualityMode::Standard);

        // Build conversation history
        let system = build_system_prompt(&session.scene_title, &session.question);
        let mut messages: Vec<(String, String)> = vec![
            ("system".to_string(), system),
        ];
        for (user_q, teacher_r) in prior_exchange {
            messages.push(("user".to_string(), user_q.clone()));
            messages.push(("assistant".to_string(), teacher_r.clone()));
        }
        messages.push(("user".to_string(), question.to_string()));

        info!(
            wb_session_id = %session.id,
            scene_title = %session.scene_title,
            question = %question,
            "whiteboard doubt: calling LLM"
        );

        let raw = self.llm.generate_text_with_history(&messages).await?;

        // Parse tool calls
        let tool_calls = parse_tool_calls(&raw);
        if tool_calls.is_empty() {
            warn!(wb_session_id = %session.id, "LLM returned no tool calls — falling back to text explanation");
        }

        // Execute tool calls → produce events
        let mut events: Vec<WhiteboardActionEvent> = Vec::new();
        let mut credits_used = 0.0_f64;
        let mut image_count = 0u32;
        let mut next_id = 0usize;

        let mut action_id = || {
            next_id += 1;
            format!("wb-action-{next_id}")
        };

        for call in &tool_calls {
            let tool = call.get("tool").and_then(Value::as_str).unwrap_or("");
            let params = call.get("params").cloned().unwrap_or(Value::Null);

            match tool {
                "wb_speak" => {
                    let text = str_param(&params, &["text"]).unwrap_or_default();
                    if !text.is_empty() {
                        events.push(WhiteboardActionEvent::Speak { id: action_id(), text });
                    }
                }
                "wb_clear" => {
                    events.push(WhiteboardActionEvent::Clear { id: action_id() });
                }
                "wb_draw_text" => {
                    events.push(WhiteboardActionEvent::DrawText {
                        id: action_id(),
                        content: str_param(&params, &["content"]).unwrap_or_default(),
                        x: f32_param(&params, &["x"]).unwrap_or(60.0),
                        y: f32_param(&params, &["y"]).unwrap_or(80.0),
                        font_size: f32_param(&params, &["font_size", "fontSize"]).unwrap_or(28.0),
                        color: str_param(&params, &["color"]).unwrap_or_else(|| "#111111".to_string()),
                    });
                }
                "wb_draw_shape" => {
                    events.push(WhiteboardActionEvent::DrawShape {
                        id: action_id(),
                        shape: str_param(&params, &["shape"]).unwrap_or_else(|| "rectangle".to_string()),
                        x: f32_param(&params, &["x"]).unwrap_or(60.0),
                        y: f32_param(&params, &["y"]).unwrap_or(100.0),
                        width: f32_param(&params, &["width"]).unwrap_or(200.0),
                        height: f32_param(&params, &["height"]).unwrap_or(120.0),
                        fill_color: str_param(&params, &["fill_color", "fillColor"]),
                        stroke_color: str_param(&params, &["stroke_color", "color"])
                            .unwrap_or_else(|| "#333333".to_string()),
                    });
                }
                "wb_draw_arrow" => {
                    events.push(WhiteboardActionEvent::DrawArrow {
                        id: action_id(),
                        start_x: f32_param(&params, &["start_x", "startX"]).unwrap_or(100.0),
                        start_y: f32_param(&params, &["start_y", "startY"]).unwrap_or(200.0),
                        end_x: f32_param(&params, &["end_x", "endX"]).unwrap_or(300.0),
                        end_y: f32_param(&params, &["end_y", "endY"]).unwrap_or(200.0),
                        color: str_param(&params, &["color"]).unwrap_or_else(|| "#333333".to_string()),
                        label: str_param(&params, &["label"]),
                    });
                }
                "wb_draw_latex" => {
                    events.push(WhiteboardActionEvent::DrawLatex {
                        id: action_id(),
                        latex: str_param(&params, &["latex"]).unwrap_or_default(),
                        x: f32_param(&params, &["x"]).unwrap_or(60.0),
                        y: f32_param(&params, &["y"]).unwrap_or(300.0),
                        color: str_param(&params, &["color"]).unwrap_or_else(|| "#111111".to_string()),
                    });
                }
                "wb_draw_chart" => {
                    events.push(WhiteboardActionEvent::DrawChart {
                        id: action_id(),
                        chart_type: str_param(&params, &["chart_type", "chartType"])
                            .unwrap_or_else(|| "bar".to_string()),
                        x: f32_param(&params, &["x"]).unwrap_or(60.0),
                        y: f32_param(&params, &["y"]).unwrap_or(120.0),
                        width: f32_param(&params, &["width"]).unwrap_or(400.0),
                        height: f32_param(&params, &["height"]).unwrap_or(280.0),
                        data: params.get("data").cloned().unwrap_or(Value::Null),
                    });
                }
                "wb_generate_image" => {
                    if !session.enable_image_generation {
                        warn!(wb_session_id = %session.id, "image generation disabled for this session — skipping");
                        continue;
                    }
                    let description = str_param(&params, &["description"]).unwrap_or_default();
                    if description.is_empty() {
                        warn!(wb_session_id = %session.id, "wb_generate_image called with empty description");
                        continue;
                    }

                    match self.generate_and_upload_image(session, &description, image_count).await {
                        Ok((url, asset_key)) => {
                            session.uploaded_asset_keys.push(asset_key);
                            credits_used += whiteboard_image_credits(quality);
                            session.credits_used += whiteboard_image_credits(quality);
                            image_count += 1;

                            events.push(WhiteboardActionEvent::DrawImage {
                                id: action_id(),
                                url,
                                x: f32_param(&params, &["x"]).unwrap_or(280.0),
                                y: f32_param(&params, &["y"]).unwrap_or(80.0),
                                width: f32_param(&params, &["width"]).unwrap_or(400.0),
                                height: f32_param(&params, &["height"]).unwrap_or(280.0),
                                alt: str_param(&params, &["alt"]).or(Some(description.clone())),
                            });
                        }
                        Err(e) => {
                            error!(
                                wb_session_id = %session.id,
                                error = %e,
                                "wb_generate_image failed — skipping image, continuing with text"
                            );
                        }
                    }
                }
                other => {
                    warn!(wb_session_id = %session.id, tool = %other, "unknown whiteboard tool call — skipped");
                }
            }
        }

        // If LLM gave no events at all, synthesize a fallback speak
        if events.is_empty() {
            events.push(WhiteboardActionEvent::Speak {
                id: action_id(),
                text: extract_plain_text_fallback(&raw),
            });
        }

        events.push(WhiteboardActionEvent::Done { credits_used, image_count });

        info!(
            wb_session_id = %session.id,
            event_count = events.len(),
            image_count,
            credits_used,
            "whiteboard doubt: explanation generated"
        );

        Ok(events)
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    async fn generate_and_upload_image(
        &self,
        session: &WhiteboardDoubtSession,
        description: &str,
        image_index: u32,
    ) -> Result<(String, String)> {
        let provider = self
            .image_provider
            .as_ref()
            .ok_or_else(|| anyhow!("no image provider configured"))?;

        let prompt = build_whiteboard_image_prompt(description);

        info!(
            wb_session_id = %session.id,
            image_index,
            "generating whiteboard image"
        );

        let image_url_or_data = provider
            .generate_image(&prompt, Some("4:3"))
            .await
            .map_err(|e| anyhow!("image generation failed: {e}"))?;

        let bytes = fetch_image_bytes(&image_url_or_data).await?;

        let file_name = format!("img_{}.png", image_index + 1);
        let wb_session_id = &session.id;

        let public_url = self
            .asset_store
            .persist_asset(
                AssetKind::WhiteboardSession,
                wb_session_id,
                &file_name,
                "image/png",
                bytes,
            )
            .await
            .map_err(|e| anyhow!("failed to upload whiteboard image: {e}"))?;

        let asset_key = format!("wb/{}/{}", wb_session_id, file_name);

        info!(
            wb_session_id = %wb_session_id,
            asset_key = %asset_key,
            "whiteboard image uploaded"
        );

        Ok((public_url, asset_key))
    }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

fn build_system_prompt(scene_title: &str, question: &str) -> String {
    // Note: Use concat + format carefully to avoid color hex codes being misinterpreted.
    // The system prompt instructs the LLM to return a JSON array of tool calls.
    let intro = concat!(
        "You are a patient, encouraging teacher explaining a student's specific doubt.\n\n",
        "WHITEBOARD TOOLS AVAILABLE:\n",
        "Return a JSON array of tool calls. Each call is: {\"tool\": \"<tool_name>\", \"params\": {...}}\n\n",
        "Available tools:\n",
        "1. wb_speak(text) — Say something to the student. Always start with this.\n",
        "2. wb_clear() — Clear the whiteboard before starting a new diagram.\n",
        "3. wb_draw_text(content, x, y, font_size, color) — Write text. Coordinate space 960x540.\n",
        "4. wb_draw_shape(shape, x, y, width, height, fill_color, stroke_color)\n",
        "   Shapes: rectangle, circle, triangle\n",
        "5. wb_draw_arrow(start_x, start_y, end_x, end_y, color, label)\n",
        "6. wb_draw_latex(latex, x, y, color) — For math/chemistry formulas.\n",
        "7. wb_draw_chart(chart_type, x, y, width, height, data)\n",
        "   chart_type: bar, line, pie. data: {\"labels\":[...],\"series\":[[...]]}\n",
        "8. wb_generate_image(description, x, y, width, height, alt)\n",
        "   USE ONLY when a physical structure or 3D anatomy cannot be drawn with shapes.\n",
        "   Image will have white background with bold labels.\n\n",
        "STRATEGY:\n",
        "1. wb_speak: acknowledge the question warmly\n",
        "2. wb_clear: clear the board\n",
        "3. Build the explanation visually (2-4 drawing steps)\n",
        "4. wb_generate_image ONLY IF shapes cannot convey the concept\n",
        "5. wb_speak: summarize the key insight\n\n",
        "RULES: Max 3 wb_speak + 4 drawing calls + 1 wb_generate_image. ",
        "Min font_size 20. Leave 30px margin from edges. ",
        "Return ONLY a valid JSON array. No markdown, no text outside JSON.\n"
    );

    format!(
        "{intro}\nCONTEXT:\n- Lesson topic: \"{scene_title}\"\n- Student question: \"{question}\"\n",
        intro = intro,
        scene_title = scene_title,
        question = question,
    )
}

/// Build a whiteboard image prompt that ALWAYS produces:
/// - White background
/// - Bold text labels on each part
/// - Clean, educational, vector-art quality
pub fn build_whiteboard_image_prompt(description: &str) -> String {
    format!(
        "White background. Clean educational diagram. Bold black sans-serif text labels clearly \
         identifying each part. Simple flat vector-art style, no photorealistic textures, no \
         decorative gradients or drop shadows. High contrast, classroom-quality. \
         Subject: {}. All key components must have visible text annotations.",
        description
    )
}

// ─── Tool-call parser ─────────────────────────────────────────────────────────

fn parse_tool_calls(raw: &str) -> Vec<Value> {
    let trimmed = raw.trim();

    // Direct parse
    if let Ok(Value::Array(arr)) = serde_json::from_str(trimmed) {
        return arr;
    }

    // Inside ```json ... ```
    if let Some(start) = trimmed.find("```json") {
        let rest = &trimmed[start + 7..];
        if let Some(end) = rest.find("```") {
            if let Ok(Value::Array(arr)) = serde_json::from_str(rest[..end].trim()) {
                return arr;
            }
        }
    }

    // Inside ``` ... ```
    if let Some(start) = trimmed.find("```") {
        let rest = &trimmed[start + 3..];
        if let Some(end) = rest.find("```") {
            if let Ok(Value::Array(arr)) = serde_json::from_str(rest[..end].trim()) {
                return arr;
            }
        }
    }

    // First [ to last ]
    if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.rfind(']')) {
        if end > start {
            if let Ok(Value::Array(arr)) = serde_json::from_str(&trimmed[start..=end]) {
                return arr;
            }
        }
    }

    warn!("whiteboard doubt: could not parse LLM response as tool call array");
    vec![]
}

// ─── Image fetcher ────────────────────────────────────────────────────────────

async fn fetch_image_bytes(url_or_data: &str) -> Result<Vec<u8>> {
    if url_or_data.starts_with("data:") {
        let base64_start = url_or_data
            .find("base64,")
            .map(|i| i + 7)
            .ok_or_else(|| anyhow!("invalid data URL format"))?;
        let encoded = &url_or_data[base64_start..];
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .map_err(|e| anyhow!("base64 decode failed: {e}"))?;
        return Ok(bytes);
    }

    let response = reqwest::get(url_or_data)
        .await
        .map_err(|e| anyhow!("failed to fetch image from URL {}: {}", url_or_data, e))?;

    if !response.status().is_success() {
        return Err(anyhow!(
            "image URL returned status {}: {}",
            response.status(),
            url_or_data
        ));
    }

    Ok(response.bytes().await?.to_vec())
}

// ─── Plain text fallback ──────────────────────────────────────────────────────

fn extract_plain_text_fallback(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('[') || trimmed.starts_with('{') {
        return "I'm here to help! Let me explain that for you.".to_string();
    }
    trimmed.chars().take(400).collect()
}

// ─── Param helpers ────────────────────────────────────────────────────────────

fn str_param(params: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|k| params.get(*k).and_then(Value::as_str))
        .map(ToString::to_string)
}

fn f32_param(params: &Value, keys: &[&str]) -> Option<f32> {
    keys.iter().find_map(|k| {
        params
            .get(*k)
            .and_then(Value::as_f64)
            .map(|v| v as f32)
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_whiteboard_image_prompt_always_has_white_background_and_labels() {
        let prompt = build_whiteboard_image_prompt("Mitochondria cross-section");
        assert!(prompt.contains("White background"));
        assert!(prompt.contains("text labels"));
        assert!(prompt.contains("Mitochondria cross-section"));
    }

    #[test]
    fn parse_tool_calls_handles_backtick_wrapped_json() {
        let raw = "```json\n[{\"tool\":\"wb_speak\",\"params\":{\"text\":\"Hello\"}},{\"tool\":\"wb_clear\",\"params\":{}}]\n```";
        let parsed = parse_tool_calls(raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].get("tool").and_then(Value::as_str), Some("wb_speak"));
    }

    #[test]
    fn parse_tool_calls_handles_raw_json_array() {
        let raw = r#"[{"tool":"wb_draw_text","params":{"content":"ATP","x":60,"y":80}}]"#;
        let parsed = parse_tool_calls(raw);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].get("tool").and_then(Value::as_str), Some("wb_draw_text"));
    }

    #[test]
    fn build_system_prompt_includes_scene_and_question() {
        let prompt = build_system_prompt("Photosynthesis", "How does light react with chlorophyll?");
        assert!(prompt.contains("Photosynthesis"));
        assert!(prompt.contains("How does light react with chlorophyll?"));
        assert!(prompt.contains("wb_speak"));
        assert!(prompt.contains("wb_generate_image"));
    }
}
