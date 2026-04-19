use ai_tutor_domain::runtime::{AgentTurnSummary, StatelessChatRequest, WhiteboardActionRecord};

// ==================== Role Guidelines ====================

fn get_role_guidelines(role: &str) -> &'static str {
    match role {
        "teacher" => {
            "Your role in this classroom: LEAD TEACHER.
You are responsible for:
- Controlling the lesson flow, slides, and pacing
- Explaining concepts clearly with examples and analogies
- Asking questions to check understanding
- Using spotlight/laser to direct attention to slide elements
- Using the whiteboard for diagrams and formulas
You can use all available actions. Never announce your actions — just teach naturally."
        }
        "assistant" => {
            "Your role in this classroom: TEACHING ASSISTANT.
You are responsible for:
- Supporting the lead teacher by filling gaps and answering side questions
- Rephrasing explanations in simpler terms when students are confused
- Providing concrete examples and background context
- Using the whiteboard sparingly to supplement (not duplicate) the teacher's content
You play a supporting role — don't take over the lesson."
        }
        _ => {
            "Your role in this classroom: STUDENT.
You are responsible for:
- Participating actively in discussions
- Asking questions, sharing observations, reacting to the lesson
- Keeping responses SHORT (1-2 sentences max)
- Only using the whiteboard when explicitly invited by the teacher
You are NOT a teacher — your responses should be much shorter than the teacher's."
        }
    }
}

// ==================== Peer Context ====================

fn build_peer_context_section(
    agent_responses: &[AgentTurnSummary],
    current_agent_name: &str,
) -> String {
    if agent_responses.is_empty() {
        return String::new();
    }

    let peers: Vec<&AgentTurnSummary> = agent_responses
        .iter()
        .filter(|r| r.agent_name != current_agent_name)
        .collect();

    if peers.is_empty() {
        return String::new();
    }

    let peer_lines = peers
        .iter()
        .map(|r| format!("- {}: \"{}\"", r.agent_name, r.content_preview))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "
# This Round's Context (CRITICAL — READ BEFORE RESPONDING)
The following agents have already spoken in this discussion round:
{}

You are {}, responding AFTER the agents above. You MUST:
1. NOT repeat greetings or introductions — they have already been made
2. NOT restate what previous speakers already explained
3. Add NEW value from YOUR unique perspective as {}
4. Build on, question, or extend what was said — do not echo it
5. If you agree with a previous point, say so briefly and then ADD something new
",
        peer_lines, current_agent_name, current_agent_name
    )
}

// ==================== Length Guidelines ====================

fn build_length_guidelines(role: &str) -> String {
    let common = "- Length targets count ONLY your speech text (type:\"text\" content). Actions (spotlight, whiteboard, etc.) do NOT count toward length. Use as many actions as needed — they don't make your speech \"too long.\"\n- Speak conversationally and naturally — this is a live classroom, not a textbook. Use oral language, not written prose.";

    match role {
        "teacher" => format!(
            "- Keep your TOTAL speech text around 100 characters (across all text objects combined). Prefer 2-3 short sentences over one long paragraph.
{}
- Prioritize inspiring students to THINK over explaining everything yourself. Ask questions, pose challenges, give hints — don't just lecture.
- When explaining, give the key insight in one crisp sentence, then pause or ask a question. Avoid exhaustive explanations.",
            common
        ),
        "assistant" => format!(
            "- Keep your TOTAL speech text around 80 characters. You are a supporting role — be brief.
{}
- One key point per response. Don't repeat the teacher's full explanation — add a quick angle, example, or summary.",
            common
        ),
        _ => format!(
            "- Keep your TOTAL speech text around 50 characters. 1-2 sentences max.
{}
- You are a STUDENT, not a teacher. Your responses should be much shorter than the teacher's. If your response is as long as the teacher's, you are doing it wrong.
- Speak in quick, natural reactions: a question, a joke, a brief insight, a short observation. Not paragraphs.
- Inspire and provoke thought with punchy comments, not lengthy analysis.",
            common
        ),
    }
}

// ==================== Whiteboard Guidelines ====================

fn build_whiteboard_guidelines(role: &str) -> String {
    let common = "- Before drawing on the whiteboard, check the \"Current State\" section below for existing whiteboard elements.
- Do NOT redraw content that already exists — if a formula, chart, concept, or table is already on the whiteboard, reference it instead of duplicating it.
- When adding new elements, calculate positions carefully: check existing elements' coordinates and sizes in the whiteboard state, and ensure at least 20px gap between elements. Canvas size is 1000x562. All elements MUST stay within the canvas boundaries — ensure x >= 0, y >= 0, x + width <= 1000, and y + height <= 562. Never place elements that extend beyond the edges.
- If another agent has already drawn related content, build upon or extend it rather than starting from scratch.";

    let latex_guidelines = "
### LaTeX Element Sizing (CRITICAL)
LaTeX elements have **auto-calculated width** (width = height × aspectRatio). You control **height**, and the system computes the width to preserve the formula's natural proportions. The height you specify is the ACTUAL rendered height — use it to plan vertical layout.

**Height guide by formula category:**
- Inline equations (e.g., E=mc^2, a+b=c): 50-80
- Equations with fractions: 60-100
- Integrals / limits: 60-100
- Summations with limits: 80-120
- Matrices: 100-180
- Standalone fractions: 50-80
- Nested fractions: 80-120

**Key rules:**
- ALWAYS specify height. The height you set is the actual rendered height.
- When placing elements below each other, add height + 20-40px gap.
- Width is auto-computed — long formulas expand horizontally, short ones stay narrow.
- If a formula's auto-computed width exceeds the whiteboard, reduce height.

**Multi-step derivations:**
Give each step the **same height** (e.g., 70-80px). The system auto-computes width proportionally — all steps render at the same vertical size.

### LaTeX Support
This project uses KaTeX for formula rendering, which supports virtually all standard LaTeX math commands. You may use any standard LaTeX math command freely.

- \\text{} can render English text. For non-Latin labels, use a separate TextElement.";

    if role == "teacher" {
        format!(
            "- Use text elements for notes, steps, and explanations.
- Use chart elements for data visualization (bar charts, line graphs, pie charts, etc.).
- Use latex elements for mathematical formulas and scientific equations.
- Use table elements for structured data, comparisons, and organized information.
- Use shape elements sparingly — only for simple diagrams. Do not add large numbers of meaningless shapes.
- Use line elements to connect related elements, draw arrows showing relationships, or annotate diagrams. Specify arrow markers via the points parameter.
- If the whiteboard is too crowded, call wb_clear to wipe it clean before adding new elements.

### Deleting Elements
- Use wb_delete to remove a specific element by its ID (shown as [id:xxx] in whiteboard state).
- Prefer wb_delete over wb_clear when only 1-2 elements need removal.
- Common use cases: removing an outdated formula before writing the corrected version, clearing a step after explaining it to make room for the next step.

### Animation-Like Effects with Delete + Draw
All wb_draw_* actions accept an optional **elementId** parameter. When you specify elementId, you can later use wb_delete with that same ID to remove the element. This is essential for creating animation effects.
- To use: add elementId (e.g. \"step1\", \"box_a\") when drawing, then wb_delete with that elementId to remove it later.
- Step-by-step reveal: Draw step 1 (elementId:\"step1\") → speak → delete \"step1\" → draw step 2 (elementId:\"step2\") → speak → ...
- State transitions: Draw initial state (elementId:\"state\") → explain → delete \"state\" → draw final state
- Progressive diagrams: Draw base diagram → add elements one by one with speech between each
- Example: draw a shape at position A with elementId \"obj\", explain it, delete \"obj\", draw the same shape at position B — this creates the illusion of movement.
- Combine wb_delete (by element ID) with wb_draw_* actions to update specific parts without clearing everything.

### Layout Constraints (IMPORTANT)
The whiteboard canvas is 1000 × 562 pixels. Follow these rules to prevent element overlap:

**Coordinate system:**
- X range: 0 (left) to 1000 (right), Y range: 0 (top) to 562 (bottom)
- Leave 20px margin from edges (safe area: x 20-980, y 20-542)

**Spacing rules:**
- Maintain at least 20px gap between adjacent elements
- Vertical stacking: next_y = previous_y + previous_height + 30
- Side by side: next_x = previous_x + previous_width + 30

**Layout patterns:**
- Top-down flow: Start from y=30, stack downward with gaps
- Two-column: Left column x=20-480, right column x=520-980
- Center single element: x = (1000 - element_width) / 2

**Before adding a new element:**
- Check existing elements' positions in the whiteboard state
- Ensure your new element's bounding box does not overlap with any existing element
- If space is insufficient, use wb_delete to remove unneeded elements or wb_clear to start fresh
{}
{}",
            latex_guidelines, common
        )
    } else if role == "assistant" {
        format!(
            "- The whiteboard is primarily the teacher's space. As an assistant, use it sparingly to supplement.
- If the teacher has already set up content on the whiteboard (exercises, formulas, tables), do NOT add parallel derivations or extra formulas — explain verbally instead.
- Only draw on the whiteboard to clarify something the teacher missed, or to add a brief supplementary note that won't clutter the board.
- Limit yourself to at most 1-2 small elements per response. Prefer speech over drawing.
{}
{}",
            latex_guidelines, common
        )
    } else {
        format!(
            "- The whiteboard is primarily the teacher's space. Do NOT draw on it proactively.
- Only use whiteboard actions when the teacher or user explicitly invites you to write on the board (e.g., \"come solve this\", \"show your work on the whiteboard\").
- If no one asked you to use the whiteboard, express your ideas through speech only.
- When you ARE invited to use the whiteboard, keep it minimal and tidy — add only what was asked for.
{}",
            common
        )
    }
}

// ==================== Virtual Whiteboard Context ====================

struct VirtualWhiteboardElement {
    agent_name: String,
    summary: String,
    element_id: Option<String>,
}

fn build_virtual_whiteboard_context(ledger: &[WhiteboardActionRecord]) -> String {
    if ledger.is_empty() {
        return String::new();
    }

    let mut elements: Vec<VirtualWhiteboardElement> = Vec::new();

    for record in ledger {
        match record.action_name.as_str() {
            "wb_clear" => elements.clear(),
            "wb_delete" => {
                let delete_id = record
                    .params
                    .get("elementId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if let Some(idx) = elements
                    .iter()
                    .position(|e| e.element_id.as_deref() == Some(delete_id))
                {
                    elements.remove(idx);
                }
            }
            "wb_draw_text" => {
                let content = record
                    .params
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let preview: String = content.chars().take(40).collect();
                let x = record
                    .params
                    .get("x")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "?".into());
                let y = record
                    .params
                    .get("y")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "?".into());
                let w = record
                    .params
                    .get("width")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "400".into());
                let h = record
                    .params
                    .get("height")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "100".into());

                elements.push(VirtualWhiteboardElement {
                    agent_name: record.agent_name.clone(),
                    summary: format!(
                        "text: \"{}...\" at ({},{}), size ~{}x{}",
                        preview, x, y, w, h
                    ),
                    element_id: record
                        .params
                        .get("elementId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
            "wb_draw_latex" => {
                let latex = record
                    .params
                    .get("latex")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let preview: String = latex.chars().take(40).collect();
                let x = record
                    .params
                    .get("x")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "?".into());
                let y = record
                    .params
                    .get("y")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "?".into());
                let w = record
                    .params
                    .get("width")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "400".into());
                let h = record
                    .params
                    .get("height")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "80".into());

                elements.push(VirtualWhiteboardElement {
                    agent_name: record.agent_name.clone(),
                    summary: format!(
                        "latex: \"{}...\" at ({},{}), size ~{}x{}",
                        preview, x, y, w, h
                    ),
                    element_id: record
                        .params
                        .get("elementId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
            // For brevity we generalize the rest
            other if other.starts_with("wb_draw_") => {
                let x = record
                    .params
                    .get("x")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "?".into());
                let y = record
                    .params
                    .get("y")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "?".into());
                elements.push(VirtualWhiteboardElement {
                    agent_name: record.agent_name.clone(),
                    summary: format!("{} at ({},{})", other.replace("wb_draw_", ""), x, y),
                    element_id: record
                        .params
                        .get("elementId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
            _ => {}
        }
    }

    if elements.is_empty() {
        return String::new();
    }

    let element_lines = elements
        .into_iter()
        .enumerate()
        .map(|(i, el)| format!("  {}. [by {}] {}", i + 1, el.agent_name, el.summary))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "
## Whiteboard Changes This Round (IMPORTANT)
Other agents have modified the whiteboard during this discussion round.
Current whiteboard elements:
{}

DO NOT redraw content that already exists. Check positions above before adding new elements.
",
        element_lines
    )
}

// ==================== State Context ====================

fn build_state_context(store_state: &ai_tutor_domain::runtime::ClientStageState) -> String {
    let mode = match store_state.mode {
        ai_tutor_domain::runtime::RuntimeMode::Autonomous => "Autonomous",
        ai_tutor_domain::runtime::RuntimeMode::Playback => "Playback",
        ai_tutor_domain::runtime::RuntimeMode::Live => "Live",
    };

    let wb_status = if store_state.whiteboard_open {
        "OPEN (slide canvas is hidden)"
    } else {
        "closed (slide canvas is visible)"
    };

    let scene_context = store_state
        .current_scene_id
        .as_deref()
        .unwrap_or("No scene currently selected");

    format!(
        "Mode: {}\nWhiteboard: {}\nCurrent scene: {}",
        mode, wb_status, scene_context
    )
}

// ==================== Slide Element Context (Gap 5) ====================

/// Build a listing of current slide canvas elements so the AI knows valid
/// element IDs for spotlight/laser targeting.
/// Ported from OpenMAIC's prompt-builder.ts slide element injection.
fn build_slide_element_context(store_state: &ai_tutor_domain::runtime::ClientStageState) -> String {
    use ai_tutor_domain::scene::{SceneContent, SlideElement};

    // Find the current scene
    let current_scene_id = match store_state.current_scene_id.as_deref() {
        Some(id) => id,
        None => return String::new(),
    };

    let scene = store_state.scenes.iter().find(|s| s.id == current_scene_id);

    let scene = match scene {
        Some(s) => s,
        None => return String::new(),
    };

    // Only applicable for slide scenes
    let canvas = match &scene.content {
        SceneContent::Slide { canvas } => canvas,
        _ => return String::new(),
    };

    if canvas.elements.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();
    lines.push("## Current Slide Elements (use these IDs for spotlight/laser)".to_string());

    for el in &canvas.elements {
        match el {
            SlideElement::Text {
                id,
                left,
                top,
                width,
                height,
                content,
            } => {
                let preview: String = content.chars().take(40).collect();
                lines.push(format!(
                    "  [id:{}] text at ({:.0},{:.0}) {:.0}x{:.0} — \"{}...\"",
                    id, left, top, width, height, preview
                ));
            }
            SlideElement::Image {
                id,
                left,
                top,
                width,
                height,
                src,
            } => {
                let filename = src.rsplit('/').next().unwrap_or(src);
                lines.push(format!(
                    "  [id:{}] image at ({:.0},{:.0}) {:.0}x{:.0} — {}",
                    id, left, top, width, height, filename
                ));
            }
            SlideElement::Shape {
                id,
                left,
                top,
                width,
                height,
                ..
            } => {
                lines.push(format!(
                    "  [id:{}] shape at ({:.0},{:.0}) {:.0}x{:.0}",
                    id, left, top, width, height
                ));
            }
            SlideElement::Line {
                id,
                left,
                top,
                width,
                height,
            } => {
                lines.push(format!(
                    "  [id:{}] line at ({:.0},{:.0}) {:.0}x{:.0}",
                    id, left, top, width, height
                ));
            }
            SlideElement::Chart {
                id,
                left,
                top,
                width,
                height,
                chart_type,
            } => {
                let ct = chart_type.as_deref().unwrap_or("chart");
                lines.push(format!(
                    "  [id:{}] {} at ({:.0},{:.0}) {:.0}x{:.0}",
                    id, ct, left, top, width, height
                ));
            }
            SlideElement::Latex {
                id,
                left,
                top,
                width,
                height,
                latex,
            } => {
                let preview: String = latex.chars().take(30).collect();
                lines.push(format!(
                    "  [id:{}] latex at ({:.0},{:.0}) {:.0}x{:.0} — \"{}...\"",
                    id, left, top, width, height, preview
                ));
            }
            SlideElement::Table {
                id,
                left,
                top,
                width,
                height,
            } => {
                lines.push(format!(
                    "  [id:{}] table at ({:.0},{:.0}) {:.0}x{:.0}",
                    id, left, top, width, height
                ));
            }
            SlideElement::Video {
                id,
                left,
                top,
                width,
                height,
                ..
            } => {
                lines.push(format!(
                    "  [id:{}] video at ({:.0},{:.0}) {:.0}x{:.0}",
                    id, left, top, width, height
                ));
            }
        }
    }

    lines.join("\n")
}

fn build_scene_teaching_context(
    store_state: &ai_tutor_domain::runtime::ClientStageState,
) -> String {
    use ai_tutor_domain::scene::SceneContent;

    let Some(current_scene_id) = store_state.current_scene_id.as_deref() else {
        return String::new();
    };
    let Some(scene) = store_state.scenes.iter().find(|scene| scene.id == current_scene_id) else {
        return String::new();
    };

    match &scene.content {
        SceneContent::Slide { canvas } => {
            let element_summary = canvas
                .elements
                .iter()
                .take(6)
                .map(|element| match element {
                    ai_tutor_domain::scene::SlideElement::Text { content, .. } => {
                        let preview: String = content.chars().take(60).collect();
                        format!("text: {}", preview)
                    }
                    ai_tutor_domain::scene::SlideElement::Image { src, .. } => {
                        format!("image: {}", src.rsplit('/').next().unwrap_or(src))
                    }
                    ai_tutor_domain::scene::SlideElement::Video { src, .. } => {
                        format!("video: {}", src.rsplit('/').next().unwrap_or(src))
                    }
                    ai_tutor_domain::scene::SlideElement::Chart { chart_type, .. } => {
                        format!("chart: {}", chart_type.as_deref().unwrap_or("chart"))
                    }
                    ai_tutor_domain::scene::SlideElement::Latex { latex, .. } => {
                        let preview: String = latex.chars().take(40).collect();
                        format!("latex: {}", preview)
                    }
                    other => format!("{:?}", std::mem::discriminant(other)),
                })
                .collect::<Vec<_>>()
                .join(" | ");
            format!(
                "## Scene Teaching Context\nCurrent scene title: {}\nScene type: slide\nTeaching strategy: explain one visual idea at a time, point to concrete on-slide targets, and use the whiteboard only when a diagram or derivation would add value.\nVisible content summary: {}\n",
                scene.title, element_summary
            )
        }
        SceneContent::Quiz { questions } => {
            let question_summary = questions
                .iter()
                .take(3)
                .map(|question| question.question.clone())
                .collect::<Vec<_>>()
                .join(" | ");
            format!(
                "## Scene Teaching Context\nCurrent scene title: {}\nScene type: quiz\nTeaching strategy: coach students through reasoning, highlight common mistakes, and use discussion sparingly as a final reflection step.\nQuiz focus: {}\n",
                scene.title, question_summary
            )
        }
        SceneContent::Interactive {
            scientific_model, ..
        } => {
            let scientific_summary = scientific_model
                .as_ref()
                .map(|model| {
                    let constraints = model
                        .constraints
                        .iter()
                        .take(3)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" | ");
                    let guidance = model
                        .interaction_guidance
                        .iter()
                        .take(3)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" | ");
                    let experiments = model
                        .experiment_steps
                        .iter()
                        .take(2)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" | ");
                    let observations = model
                        .observation_prompts
                        .iter()
                        .take(2)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" | ");
                    format!(
                        "Constraints: {} Guidance: {} Experiments: {} Observation prompts: {}",
                        constraints, guidance, experiments, observations
                    )
                })
                .unwrap_or_else(|| "Guide the learner from simple interaction to interpretation.".to_string());
            format!(
                "## Scene Teaching Context\nCurrent scene title: {}\nScene type: interactive\nTeaching strategy: direct the learner to manipulate controls, observe outcomes, and explain what changes. Keep the interaction exploratory and tied to the concept.\nScientific guidance: {}\n",
                scene.title, scientific_summary
            )
        }
        SceneContent::Project { project_config } => format!(
            "## Scene Teaching Context\nCurrent scene title: {}\nScene type: project\nTeaching strategy: orient learners around the driving question, deliverable, and next milestone. Help them make concrete planning decisions rather than re-explaining background theory.\nProject summary: {}\nDriving question: {}\nDeliverable: {}\n",
            scene.title,
            project_config.summary,
            project_config
                .driving_question
                .as_deref()
                .unwrap_or("Not specified"),
            project_config
                .final_deliverable
                .as_deref()
                .unwrap_or("Not specified")
        ),
    }
}

fn build_turn_planning_context(
    agent_config: &crate::chat_graph::SelectedAgent,
    payload: &StatelessChatRequest,
) -> String {
    use ai_tutor_domain::scene::SceneContent;

    let latest_user_message = payload
        .messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.to_ascii_lowercase())
        .unwrap_or_default();
    let prior_responses = payload
        .director_state
        .as_ref()
        .map(|state| state.agent_responses.as_slice())
        .unwrap_or(&[]);
    let repeated_ideas = prior_responses
        .iter()
        .rev()
        .take(2)
        .map(|turn| format!("- Avoid repeating: {}", turn.content_preview))
        .collect::<Vec<_>>()
        .join("\n");
    let confusion_detected = [
        "confused",
        "don't understand",
        "dont understand",
        "stuck",
        "clarify",
        "step by step",
        "why",
    ]
    .iter()
    .any(|hint| latest_user_message.contains(hint));

    let Some(current_scene_id) = payload.store_state.current_scene_id.as_deref() else {
        return String::new();
    };
    let Some(scene) = payload
        .store_state
        .scenes
        .iter()
        .find(|scene| scene.id == current_scene_id)
    else {
        return String::new();
    };

    let (goal, action_mix, avoid) = match &scene.content {
        SceneContent::Slide { .. } => (
            "Deliver one crisp visual insight, then check understanding with a short question.",
            "Prefer spotlight or laser before speaking; use the whiteboard only for a missing diagram, derivation, or comparison.",
            "Do not narrate every bullet or read the slide aloud.",
        ),
        SceneContent::Quiz { .. } => (
            "Coach reasoning without instantly giving away the answer.",
            "Keep actions minimal and focus on one reasoning cue or misconception check.",
            "Do not reveal the correct answer before students have a chance to think.",
        ),
        SceneContent::Interactive { .. } => (
            "Guide one concrete manipulation, ask what changed, then help interpret the result.",
            "Use speech to direct exploration step by step; let the interactive itself carry the visual change.",
            "Do not drift into a long lecture disconnected from the controls.",
        ),
        SceneContent::Project { .. } => (
            "Clarify the project goal, name the next work package, and steer students toward one concrete planning decision.",
            "Use speech to frame milestones, team roles, or issue-board style work packages rather than repeating background theory.",
            "Do not make the project sound vague or purely inspirational; end on a decision or next step.",
        ),
    };

    let role_bias = match agent_config.role.as_str() {
        "teacher" => "Lead with direction and synthesis.",
        "assistant" => "Add one supporting clarification or example without taking over.",
        _ => "React briefly and naturally rather than lecturing.",
    };

    let repetition_guard = if repeated_ideas.is_empty() {
        "Recent repetition guard: none".to_string()
    } else {
        format!("Recent repetition guard:\n{}", repeated_ideas)
    };
    let avoid_line = format!("Avoid: {avoid}");

    format!(
        "## Turn Plan\nPrimary goal: {}\nRecommended move: {}\nRole bias: {}\n{}\n{}\n{}\n",
        goal,
        action_mix,
        role_bias,
        if confusion_detected {
            "Learner state: confusion/interruption cues detected. Slow down, restate the key idea simply, and prefer teacher-like clarity over banter."
        } else {
            "Learner state: no explicit confusion cue detected. Keep momentum and invite thinking rather than over-explaining."
        },
        repetition_guard,
        avoid_line
    )
}

// ==================== Main Prompt Builder ====================

pub fn build_structured_prompt(
    agent_config: &crate::chat_graph::SelectedAgent,
    payload: &StatelessChatRequest,
) -> String {
    let discussion_topic = payload.config.discussion_topic.as_deref();
    let discussion_prompt = payload.config.discussion_prompt.as_deref();

    let state_context = build_state_context(&payload.store_state);
    let slide_element_context = build_slide_element_context(&payload.store_state);
    let scene_teaching_context = build_scene_teaching_context(&payload.store_state);
    let turn_planning_context = build_turn_planning_context(agent_config, payload);
    let virtual_wb_context = build_virtual_whiteboard_context(
        payload
            .director_state
            .as_ref()
            .map(|d| d.whiteboard_ledger.as_slice())
            .unwrap_or(&[]),
    );

    let agent_responses = payload
        .director_state
        .as_ref()
        .map(|d| d.agent_responses.as_slice())
        .unwrap_or(&[]);
    let peer_context = build_peer_context_section(agent_responses, &agent_config.name);

    let role_guideline = get_role_guidelines(&agent_config.role);
    let length_guidelines = build_length_guidelines(&agent_config.role);
    let wb_guidelines = build_whiteboard_guidelines(&agent_config.role);

    // Hardcode language to English for now (or integrate later)
    let language_constraint = "\n# Language (CRITICAL)\nYou MUST speak in English. ALL text content in your response MUST be in this language.\n";

    let has_slide_actions = true; // Simplified: we allow all actions to the agent

    let format_example = if has_slide_actions {
        r#"[{"type":"action","name":"spotlight","params":{"elementId":"img_1"}},{"type":"text","content":"Your natural speech to students"}]"#
    } else {
        r#"[{"type":"action","name":"wb_open","params":{}},{"type":"text","content":"Your natural speech to students"}]"#
    };

    let ordering_principles = "- spotlight/laser actions should appear BEFORE the corresponding text object (point first, then speak)\n- whiteboard actions can interleave WITH text objects (draw while speaking)";

    let spotlight_examples = r#"[{"type":"action","name":"spotlight","params":{"elementId":"img_1"}},{"type":"text","content":"Photosynthesis is the process by which plants convert light energy into chemical energy. Take a look at this diagram."},{"type":"text","content":"During this process, plants absorb carbon dioxide and water to produce glucose and oxygen."}]

[{"type":"action","name":"spotlight","params":{"elementId":"eq_1"}},{"type":"action","name":"laser","params":{"elementId":"eq_2"}},{"type":"text","content":"Compare these two equations — notice how the left side is endothermic while the right side is exothermic."}]

"#;

    let mutual_exclusion_note = "- IMPORTANT — Whiteboard / Canvas mutual exclusion: The whiteboard and slide canvas are mutually exclusive. When the whiteboard is OPEN, the slide canvas is hidden — spotlight and laser actions targeting slide elements will have NO visible effect. If you need to use spotlight or laser, call wb_close first to reveal the slide canvas. Conversely, if the whiteboard is CLOSED, wb_draw_* actions still work (they implicitly open the whiteboard), but be aware that doing so hides the slide canvas.\n- Prefer variety: mix spotlights, laser, and whiteboard for engaging teaching. Don't use the same action type repeatedly.";

    let discussion_block = if let Some(topic) = discussion_topic {
        let guiding_prompt = discussion_prompt
            .map(|p| format!("Guiding prompt: {}", p))
            .unwrap_or_default();
        if !agent_responses.is_empty() {
            format!("# Discussion Context\nTopic: \"{}\"\n{}\n\nYou are JOINING an ongoing discussion — do NOT re-introduce the topic or greet the students. The discussion has already started. Contribute your unique perspective, ask a follow-up question, or challenge an assumption made by a previous speaker.", topic, guiding_prompt)
        } else {
            format!("# Discussion Context\nYou are initiating a discussion on the following topic: \"{}\"\n{}\n\nIMPORTANT: As you are starting this discussion, begin by introducing the topic naturally to the students. Engage them and invite their thoughts. Do not wait for user input - you speak first.", topic, guiding_prompt)
        }
    } else {
        String::new()
    };

    format!(
"
# Role
You are {name}.

## Your Personality
{persona}

## Your Classroom Role
{role_guideline}
{peer_context}{language_constraint}
# Output Format
You MUST output a JSON array for ALL responses. Each element is an object with a `type` field:

{format_example}

## Format Rules
1. Output a single JSON array — no explanation, no code fences
2. `type:\"action\"` objects contain `name` and `params`
3. `type:\"text\"` objects contain `content` (speech text)
4. Action and text objects can freely interleave in any order
5. The `]` closing bracket marks the end of your response
6. CRITICAL: ALWAYS start your response with `[` — even if your previous message was interrupted. Never continue a partial response as plain text. Every response must be a complete, independent JSON array.

## Ordering Principles
{ordering_principles}

## Speech Guidelines (CRITICAL)
- Effects fire concurrently with your speech — students see results as you speak
- Text content is what you SAY OUT LOUD to students - natural teaching speech
- Do NOT say \"let me add...\", \"I'll create...\", \"now I'm going to...\"
- Do NOT describe your actions - just speak naturally as a teacher
- Students see action results appear on screen - you don't need to announce them
- Your speech should flow naturally regardless of whether actions succeed or fail
- NEVER use markdown formatting (blockquotes >, headings #, bold **, lists -, code blocks) in text content — it is spoken aloud, not rendered

## Length & Style (CRITICAL)
{length_guidelines}

### Good Examples
{spotlight_examples}[{{\"type\":\"action\",\"name\":\"wb_open\",\"params\":{{}}}},{{\"type\":\"action\",\"name\":\"wb_draw_text\",\"params\":{{\"content\":\"Step 1: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂\",\"x\":100,\"y\":100,\"fontSize\":24}}}},{{\"type\":\"text\",\"content\":\"Look at this chemical equation — notice how the reactants and products correspond.\"}}]

[{{\"type\":\"action\",\"name\":\"wb_open\",\"params\":{{}}}},{{\"type\":\"action\",\"name\":\"wb_draw_latex\",\"params\":{{\"latex\":\"\\\\frac{{-b \\\\pm \\\\sqrt{{b^2-4ac}}}}{{2a}}\",\"x\":100,\"y\":80,\"width\":500}}}},{{\"type\":\"text\",\"content\":\"This is the quadratic formula — it can solve any quadratic equation.\"}},{{\"type\":\"action\",\"name\":\"wb_draw_table\",\"params\":{{\"x\":100,\"y\":250,\"width\":500,\"height\":150,\"data\":[[\"Variable\",\"Meaning\"],[\"a\",\"Coefficient of x²\"],[\"b\",\"Coefficient of x\"],[\"c\",\"Constant term\"]]}}}},{{\"type\":\"text\",\"content\":\"Each variable's meaning is shown in the table.\"}}]

### Bad Examples (DO NOT do this)
[{{\"type\":\"text\",\"content\":\"Let me open the whiteboard\"}},{{\"type\":\"action\",...}}] (Don't announce actions!)
[{{\"type\":\"text\",\"content\":\"I'm going to draw a diagram for you...\"}}] (Don't describe what you're doing!)
[{{\"type\":\"text\",\"content\":\"Action complete, shape has been added\"}}] (Don't report action results!)

## Whiteboard Guidelines
{wb_guidelines}

## Action Usage Guidelines
- Whiteboard actions (wb_open, wb_draw_text, wb_draw_shape, wb_draw_chart, wb_draw_latex, wb_draw_table, wb_draw_line, wb_delete, wb_clear, wb_close): Use when explaining concepts that benefit from diagrams, formulas, data charts, tables, connecting lines, or step-by-step derivations. Use wb_draw_latex for math formulas, wb_draw_chart for data visualization, wb_draw_table for structured data.
- WHITEBOARD CLOSE RULE (CRITICAL): Do NOT call wb_close at the end of your response. Leave the whiteboard OPEN so students can read what you drew. Only call wb_close when you specifically need to return to the slide canvas (e.g., to use spotlight or laser on slide elements). Frequent open/close is distracting.
- wb_delete: Use to remove a specific element by its ID (shown in brackets like [id:xxx] in the whiteboard state). Prefer this over wb_clear when only one or a few elements need to be removed.
{mutual_exclusion_note}

# Current State
{state_context}
{scene_teaching_context}
{turn_planning_context}
{slide_element_context}
{virtual_wb_context}
Remember: Speak naturally as a teacher. Effects fire concurrently with your speech.

{discussion_block}
",
        name = agent_config.name,
        persona = agent_config.persona
    )
}

#[cfg(test)]
mod tests {
    use super::build_structured_prompt;
    use ai_tutor_domain::{
        runtime::{
            ChatMessage, ClientStageState, RuntimeMode, RuntimeSessionMode,
            RuntimeSessionSelector, StatelessChatConfig, StatelessChatRequest,
        },
        scene::{ProjectConfig, Scene, SceneContent},
    };

    fn base_payload(scene: SceneContent) -> StatelessChatRequest {
        StatelessChatRequest {
            session_id: None,
            runtime_session: Some(RuntimeSessionSelector {
                mode: RuntimeSessionMode::StatelessClientState,
                session_id: None,
                create_if_missing: None,
            }),
            messages: vec![ChatMessage {
                id: "user-1".to_string(),
                role: "user".to_string(),
                content: "Can you explain this step by step?".to_string(),
                metadata: None,
            }],
            store_state: ClientStageState {
                stage: None,
                scenes: vec![Scene {
                    id: "scene-1".to_string(),
                    stage_id: "stage-1".to_string(),
                    title: "Current Scene".to_string(),
                    order: 1,
                    content: scene,
                    actions: vec![],
                    whiteboards: vec![],
                    multi_agent: None,
                    created_at: None,
                    updated_at: None,
                }],
                current_scene_id: Some("scene-1".to_string()),
                mode: RuntimeMode::Live,
                whiteboard_open: false,
            },
            config: StatelessChatConfig {
                session_type: Some("discussion".to_string()),
                discussion_topic: Some("fractions".to_string()),
                discussion_prompt: Some("Discuss how equivalent fractions work".to_string()),
                trigger_agent_id: None,
                agent_ids: vec![],
                agent_configs: vec![],
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
    fn prompt_includes_scene_specific_turn_plan_for_interactives() {
        let payload = base_payload(SceneContent::Interactive {
            url: String::new(),
            html: None,
            scientific_model: None,
        });
        let agent = crate::chat_graph::SelectedAgent {
            id: "teacher-1".to_string(),
            name: "Teacher".to_string(),
            role: "teacher".to_string(),
            persona: "Clear and supportive".to_string(),
            reason: String::new(),
        };

        let prompt = build_structured_prompt(&agent, &payload);
        assert!(prompt.contains("## Turn Plan"));
        assert!(prompt.contains("Guide one concrete manipulation"));
        assert!(prompt.contains("confusion/interruption cues detected"));
    }

    #[test]
    fn prompt_includes_project_planning_guidance() {
        let payload = base_payload(SceneContent::Project {
            project_config: ProjectConfig {
                summary: "Create a class poster".to_string(),
                title: Some("Poster Project".to_string()),
                driving_question: Some("How can we teach the idea clearly?".to_string()),
                final_deliverable: Some("A poster".to_string()),
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
        });
        let agent = crate::chat_graph::SelectedAgent {
            id: "assistant-1".to_string(),
            name: "Project Coach".to_string(),
            role: "assistant".to_string(),
            persona: "Organized and practical".to_string(),
            reason: String::new(),
        };

        let prompt = build_structured_prompt(&agent, &payload);
        assert!(prompt.contains("Project summary"));
        assert!(prompt.contains("next work package"));
        assert!(prompt.contains("Role bias: Add one supporting clarification"));
    }
}
