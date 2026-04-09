use crate::whiteboard::{whiteboard_action_from_lesson_action, WhiteboardState};
use ai_tutor_domain::runtime::DirectorState;
use ai_tutor_domain::{action::LessonAction, lesson::Lesson, scene::Scene};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RuntimeMode {
    Idle,
    Playing,
    Paused,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSession {
    pub lesson_id: String,
    pub current_scene_index: usize,
    pub current_action_index: usize,
    pub mode: RuntimeMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackEventKind {
    SessionStarted,
    SceneStarted,
    ActionStarted,
    SessionCompleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionExecutionSurface {
    Audio,
    Discussion,
    SlideOverlay,
    Video,
    Whiteboard,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionExecutionMetadata {
    pub surface: ActionExecutionSurface,
    pub blocks_slide_canvas: bool,
    pub requires_focus_target: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackEvent {
    pub lesson_id: String,
    pub kind: PlaybackEventKind,
    pub scene_id: Option<String>,
    pub scene_title: Option<String>,
    pub scene_index: Option<usize>,
    pub action_id: Option<String>,
    pub action_type: Option<String>,
    pub action_index: Option<usize>,
    pub action_payload: Option<LessonAction>,
    pub execution: Option<ActionExecutionMetadata>,
    pub whiteboard_state: Option<WhiteboardState>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TutorEventKind {
    SessionStarted,
    AgentSelected,
    TextDelta,
    ActionStarted,
    ActionProgress,
    ActionCompleted,
    Interrupted,
    ResumeAvailable,
    ResumeRejected,
    CueUser,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionAckPolicy {
    NoAckRequired,
    AckOptional,
    AckRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeInterruptionReason {
    UserRequested,
    DownstreamDisconnect,
    ProviderCancelled,
    ProviderFailed,
    RuntimePolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TutorTurnStatus {
    Running,
    Interrupted,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TutorStreamEvent {
    pub kind: TutorEventKind,
    pub session_id: String,
    pub runtime_session_id: Option<String>,
    pub runtime_session_mode: Option<String>,
    pub turn_status: Option<TutorTurnStatus>,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub action_name: Option<String>,
    pub action_params: Option<Value>,
    pub execution_id: Option<String>,
    pub ack_policy: Option<ActionAckPolicy>,
    pub execution: Option<ActionExecutionMetadata>,
    pub whiteboard_state: Option<WhiteboardState>,
    pub content: Option<String>,
    pub message: Option<String>,
    pub interruption_reason: Option<RuntimeInterruptionReason>,
    pub resume_allowed: Option<bool>,
    pub director_state: Option<DirectorState>,
}

pub fn lesson_playback_events(lesson: &Lesson) -> Vec<PlaybackEvent> {
    let mut events = vec![PlaybackEvent {
        lesson_id: lesson.id.clone(),
        kind: PlaybackEventKind::SessionStarted,
        scene_id: None,
        scene_title: Some(lesson.title.clone()),
        scene_index: None,
        action_id: None,
        action_type: None,
        action_index: None,
        action_payload: None,
        execution: None,
        whiteboard_state: None,
        summary: format!("Starting playback for lesson {}", lesson.title),
    }];

    let mut whiteboard_state = WhiteboardState::new(format!("lesson-{}", lesson.id));

    for (scene_index, scene) in lesson.scenes.iter().enumerate() {
        events.push(scene_started_event(
            &lesson.id,
            scene,
            scene_index,
            &whiteboard_state,
        ));
        for (action_index, action) in scene.actions.iter().enumerate() {
            if let Some(runtime_action) = whiteboard_action_from_lesson_action(action) {
                whiteboard_state.apply_action(&runtime_action);
            }
            events.push(action_started_event(
                &lesson.id,
                scene,
                scene_index,
                action,
                action_index,
                &whiteboard_state,
            ));
        }
    }

    events.push(PlaybackEvent {
        lesson_id: lesson.id.clone(),
        kind: PlaybackEventKind::SessionCompleted,
        scene_id: None,
        scene_title: Some(lesson.title.clone()),
        scene_index: None,
        action_id: None,
        action_type: None,
        action_index: None,
        action_payload: None,
        execution: None,
        whiteboard_state: Some(whiteboard_state),
        summary: format!("Completed playback for lesson {}", lesson.title),
    });

    events
}

fn scene_started_event(
    lesson_id: &str,
    scene: &Scene,
    scene_index: usize,
    whiteboard_state: &WhiteboardState,
) -> PlaybackEvent {
    PlaybackEvent {
        lesson_id: lesson_id.to_string(),
        kind: PlaybackEventKind::SceneStarted,
        scene_id: Some(scene.id.clone()),
        scene_title: Some(scene.title.clone()),
        scene_index: Some(scene_index),
        action_id: None,
        action_type: None,
        action_index: None,
        action_payload: None,
        execution: None,
        whiteboard_state: Some(whiteboard_state.clone()),
        summary: format!("Starting scene {}: {}", scene_index + 1, scene.title),
    }
}

fn action_started_event(
    lesson_id: &str,
    scene: &Scene,
    scene_index: usize,
    action: &LessonAction,
    action_index: usize,
    whiteboard_state: &WhiteboardState,
) -> PlaybackEvent {
    PlaybackEvent {
        lesson_id: lesson_id.to_string(),
        kind: PlaybackEventKind::ActionStarted,
        scene_id: Some(scene.id.clone()),
        scene_title: Some(scene.title.clone()),
        scene_index: Some(scene_index),
        action_id: Some(action_id(action).to_string()),
        action_type: Some(action_type(action).to_string()),
        action_index: Some(action_index),
        action_payload: Some(action.clone()),
        execution: Some(action_execution_metadata(action)),
        whiteboard_state: Some(whiteboard_state.clone()),
        summary: action_summary(action),
    }
}

pub fn action_execution_metadata(action: &LessonAction) -> ActionExecutionMetadata {
    match action {
        LessonAction::Speech { .. } => ActionExecutionMetadata {
            surface: ActionExecutionSurface::Audio,
            blocks_slide_canvas: false,
            requires_focus_target: false,
        },
        LessonAction::Discussion { .. } => ActionExecutionMetadata {
            surface: ActionExecutionSurface::Discussion,
            blocks_slide_canvas: false,
            requires_focus_target: false,
        },
        LessonAction::Spotlight { .. } | LessonAction::Laser { .. } => ActionExecutionMetadata {
            surface: ActionExecutionSurface::SlideOverlay,
            blocks_slide_canvas: false,
            requires_focus_target: true,
        },
        LessonAction::PlayVideo { .. } => ActionExecutionMetadata {
            surface: ActionExecutionSurface::Video,
            blocks_slide_canvas: false,
            requires_focus_target: true,
        },
        LessonAction::WhiteboardOpen { .. }
        | LessonAction::WhiteboardDrawText { .. }
        | LessonAction::WhiteboardDrawShape { .. }
        | LessonAction::WhiteboardDrawChart { .. }
        | LessonAction::WhiteboardDrawLatex { .. }
        | LessonAction::WhiteboardDrawTable { .. }
        | LessonAction::WhiteboardDrawLine { .. }
        | LessonAction::WhiteboardClear { .. }
        | LessonAction::WhiteboardDelete { .. }
        | LessonAction::WhiteboardClose { .. } => ActionExecutionMetadata {
            surface: ActionExecutionSurface::Whiteboard,
            blocks_slide_canvas: true,
            requires_focus_target: false,
        },
    }
}

pub fn action_execution_metadata_for_name(action_name: &str) -> Option<ActionExecutionMetadata> {
    match action_name {
        "speech" => Some(ActionExecutionMetadata {
            surface: ActionExecutionSurface::Audio,
            blocks_slide_canvas: false,
            requires_focus_target: false,
        }),
        "discussion" => Some(ActionExecutionMetadata {
            surface: ActionExecutionSurface::Discussion,
            blocks_slide_canvas: false,
            requires_focus_target: false,
        }),
        "spotlight" | "laser" => Some(ActionExecutionMetadata {
            surface: ActionExecutionSurface::SlideOverlay,
            blocks_slide_canvas: false,
            requires_focus_target: true,
        }),
        "play_video" => Some(ActionExecutionMetadata {
            surface: ActionExecutionSurface::Video,
            blocks_slide_canvas: false,
            requires_focus_target: true,
        }),
        "wb_open" | "wb_draw_text" | "wb_draw_shape" | "wb_draw_chart" | "wb_draw_latex"
        | "wb_draw_table" | "wb_draw_line" | "wb_clear" | "wb_delete" | "wb_close" => {
            Some(ActionExecutionMetadata {
                surface: ActionExecutionSurface::Whiteboard,
                blocks_slide_canvas: true,
                requires_focus_target: false,
            })
        }
        _ => None,
    }
}

/// Canonical runtime action payload emitted by live tutor orchestration.
///
/// This gives frontend executors a stable `runtime_action_v1` contract even
/// when provider/model outputs vary in key style.
pub fn canonical_runtime_action_params(action_name: &str, params: &Value) -> Value {
    let as_object = params.as_object();
    let read_str = |keys: &[&str]| -> Option<String> {
        keys.iter().find_map(|key| {
            as_object
                .and_then(|obj| obj.get(*key))
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
        })
    };
    let read_num = |keys: &[&str]| -> Option<f64> {
        keys.iter().find_map(|key| {
            let value = as_object.and_then(|obj| obj.get(*key))?;
            if let Some(number) = value.as_f64() {
                return Some(number);
            }
            value.as_str().and_then(|raw| raw.parse::<f64>().ok())
        })
    };

    let mut canonical = serde_json::Map::new();
    canonical.insert(
        "schema_version".to_string(),
        Value::String("runtime_action_v1".to_string()),
    );
    canonical.insert(
        "action_name".to_string(),
        Value::String(action_name.to_string()),
    );

    match action_name {
        "spotlight" | "laser" | "play_video" | "wb_delete" => {
            if let Some(element_id) = read_str(&["elementId", "element_id", "id"]) {
                canonical.insert("elementId".to_string(), Value::String(element_id.clone()));
                canonical.insert("element_id".to_string(), Value::String(element_id));
            }
            if action_name == "laser" {
                if let Some(color) = read_str(&["color", "laser_color"]) {
                    canonical.insert("color".to_string(), Value::String(color));
                }
            }
        }
        "wb_draw_text" => {
            if let Some(element_id) = read_str(&["elementId", "element_id", "id"]) {
                canonical.insert("elementId".to_string(), Value::String(element_id.clone()));
                canonical.insert("element_id".to_string(), Value::String(element_id));
            }
            if let Some(content) = read_str(&["content", "text"]) {
                canonical.insert("content".to_string(), Value::String(content));
            }
            if let Some(x) = read_num(&["x"]) {
                canonical.insert("x".to_string(), Value::from(x));
            }
            if let Some(y) = read_num(&["y"]) {
                canonical.insert("y".to_string(), Value::from(y));
            }
            if let Some(font_size) = read_num(&["fontSize", "font_size"]) {
                canonical.insert("fontSize".to_string(), Value::from(font_size));
                canonical.insert("font_size".to_string(), Value::from(font_size));
            }
            if let Some(color) = read_str(&["color"]) {
                canonical.insert("color".to_string(), Value::String(color));
            }
        }
        "wb_draw_shape" | "wb_draw_chart" | "wb_draw_latex" | "wb_draw_table" | "wb_draw_line" => {
            if let Some(element_id) = read_str(&["elementId", "element_id", "id"]) {
                canonical.insert("elementId".to_string(), Value::String(element_id.clone()));
                canonical.insert("element_id".to_string(), Value::String(element_id));
            }
            for key in [
                "shape",
                "chartType",
                "chart_type",
                "latex",
                "style",
                "lineStyle",
            ] {
                if let Some(value) = read_str(&[key]) {
                    canonical.insert(key.to_string(), Value::String(value));
                }
            }
            for key in [
                "x",
                "y",
                "width",
                "height",
                "startX",
                "start_x",
                "startY",
                "start_y",
                "endX",
                "end_x",
                "endY",
                "end_y",
                "strokeWidth",
                "stroke_width",
            ] {
                if let Some(value) = read_num(&[key]) {
                    canonical.insert(key.to_string(), Value::from(value));
                }
            }
            if let Some(object) = as_object {
                for passthrough in [
                    "labels", "legends", "series", "data", "outline", "theme", "points",
                ] {
                    if let Some(value) = object.get(passthrough) {
                        canonical.insert(passthrough.to_string(), value.clone());
                    }
                }
            }
        }
        _ => {}
    }

    if let Some(object) = as_object {
        for (key, value) in object {
            canonical
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }

    Value::Object(canonical)
}

fn action_id(action: &LessonAction) -> &str {
    match action {
        LessonAction::Speech { id, .. }
        | LessonAction::Spotlight { id, .. }
        | LessonAction::Laser { id, .. }
        | LessonAction::PlayVideo { id, .. }
        | LessonAction::Discussion { id, .. }
        | LessonAction::WhiteboardOpen { id, .. }
        | LessonAction::WhiteboardDrawText { id, .. }
        | LessonAction::WhiteboardDrawShape { id, .. }
        | LessonAction::WhiteboardDrawChart { id, .. }
        | LessonAction::WhiteboardDrawLatex { id, .. }
        | LessonAction::WhiteboardDrawTable { id, .. }
        | LessonAction::WhiteboardDrawLine { id, .. }
        | LessonAction::WhiteboardClear { id, .. }
        | LessonAction::WhiteboardDelete { id, .. }
        | LessonAction::WhiteboardClose { id, .. } => id,
    }
}

fn action_type(action: &LessonAction) -> &'static str {
    match action {
        LessonAction::Speech { .. } => "speech",
        LessonAction::Spotlight { .. } => "spotlight",
        LessonAction::Laser { .. } => "laser",
        LessonAction::PlayVideo { .. } => "play_video",
        LessonAction::Discussion { .. } => "discussion",
        LessonAction::WhiteboardOpen { .. } => "whiteboard_open",
        LessonAction::WhiteboardDrawText { .. } => "whiteboard_draw_text",
        LessonAction::WhiteboardDrawShape { .. } => "whiteboard_draw_shape",
        LessonAction::WhiteboardDrawChart { .. } => "whiteboard_draw_chart",
        LessonAction::WhiteboardDrawLatex { .. } => "whiteboard_draw_latex",
        LessonAction::WhiteboardDrawTable { .. } => "whiteboard_draw_table",
        LessonAction::WhiteboardDrawLine { .. } => "whiteboard_draw_line",
        LessonAction::WhiteboardClear { .. } => "whiteboard_clear",
        LessonAction::WhiteboardDelete { .. } => "whiteboard_delete",
        LessonAction::WhiteboardClose { .. } => "whiteboard_close",
    }
}

fn action_summary(action: &LessonAction) -> String {
    match action {
        LessonAction::Speech { text, .. } => format!("Narration: {}", text),
        LessonAction::Spotlight { element_id, .. } => {
            format!("Spotlight element {}", element_id)
        }
        LessonAction::Laser { element_id, .. } => format!("Laser focus on element {}", element_id),
        LessonAction::PlayVideo { element_id, .. } => {
            format!("Play video for element {}", element_id)
        }
        LessonAction::Discussion { topic, .. } => format!("Discussion: {}", topic),
        LessonAction::WhiteboardOpen { .. } => "Open whiteboard".to_string(),
        LessonAction::WhiteboardDrawText { content, .. } => {
            format!("Draw whiteboard text: {}", content)
        }
        LessonAction::WhiteboardDrawShape { shape, .. } => {
            format!("Draw whiteboard shape: {:?}", shape)
        }
        LessonAction::WhiteboardDrawChart { chart_type, .. } => {
            format!("Draw whiteboard chart: {:?}", chart_type)
        }
        LessonAction::WhiteboardDrawLatex { latex, .. } => {
            format!("Draw whiteboard latex: {}", latex)
        }
        LessonAction::WhiteboardDrawTable { .. } => "Draw whiteboard table".to_string(),
        LessonAction::WhiteboardDrawLine { .. } => "Draw whiteboard line".to_string(),
        LessonAction::WhiteboardClear { .. } => "Clear whiteboard".to_string(),
        LessonAction::WhiteboardDelete { element_id, .. } => {
            format!("Delete whiteboard element {}", element_id)
        }
        LessonAction::WhiteboardClose { .. } => "Close whiteboard".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;

    use ai_tutor_domain::{
        action::LessonAction,
        lesson::Lesson,
        scene::{Scene, SceneContent, Stage},
    };

    use super::{canonical_runtime_action_params, lesson_playback_events, PlaybackEventKind};

    #[test]
    fn builds_playback_events_from_lesson_structure() {
        let lesson = Lesson {
            id: "lesson-1".to_string(),
            title: "Fractions".to_string(),
            language: "en-US".to_string(),
            description: None,
            stage: Some(Stage {
                id: "stage-1".to_string(),
                name: "Fractions".to_string(),
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
                id: "scene-1".to_string(),
                stage_id: "stage-1".to_string(),
                title: "Intro".to_string(),
                order: 1,
                content: SceneContent::Quiz { questions: vec![] },
                actions: vec![LessonAction::Speech {
                    id: "action-1".to_string(),
                    title: None,
                    description: None,
                    text: "Fractions describe parts of a whole.".to_string(),
                    audio_id: None,
                    audio_url: None,
                    voice: None,
                    speed: None,
                }],
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

        let events = lesson_playback_events(&lesson);
        assert_eq!(events.len(), 4);
        assert!(matches!(events[0].kind, PlaybackEventKind::SessionStarted));
        assert!(matches!(events[1].kind, PlaybackEventKind::SceneStarted));
        assert!(matches!(events[2].kind, PlaybackEventKind::ActionStarted));
        assert!(matches!(
            events[3].kind,
            PlaybackEventKind::SessionCompleted
        ));
    }

    #[test]
    fn canonical_runtime_action_params_normalizes_element_and_schema() {
        let raw = json!({
            "element_id": "img-1",
            "laser_color": "#ff0000"
        });

        let canonical = canonical_runtime_action_params("laser", &raw);
        assert_eq!(canonical["schema_version"], "runtime_action_v1");
        assert_eq!(canonical["action_name"], "laser");
        assert_eq!(canonical["elementId"], "img-1");
        assert_eq!(canonical["element_id"], "img-1");
        assert_eq!(canonical["laser_color"], "#ff0000");
    }
}
