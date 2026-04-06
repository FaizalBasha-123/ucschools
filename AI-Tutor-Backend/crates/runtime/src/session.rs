use ai_tutor_domain::{action::LessonAction, lesson::Lesson, scene::Scene};
use ai_tutor_domain::runtime::DirectorState;
use serde::{Deserialize, Serialize};

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
pub struct PlaybackEvent {
    pub lesson_id: String,
    pub kind: PlaybackEventKind,
    pub scene_id: Option<String>,
    pub scene_title: Option<String>,
    pub scene_index: Option<usize>,
    pub action_id: Option<String>,
    pub action_type: Option<String>,
    pub action_index: Option<usize>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TutorEventKind {
    SessionStarted,
    AgentSelected,
    TextDelta,
    CueUser,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TutorStreamEvent {
    pub kind: TutorEventKind,
    pub session_id: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub content: Option<String>,
    pub message: Option<String>,
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
        summary: format!("Starting playback for lesson {}", lesson.title),
    }];

    for (scene_index, scene) in lesson.scenes.iter().enumerate() {
        events.push(scene_started_event(&lesson.id, scene, scene_index));
        for (action_index, action) in scene.actions.iter().enumerate() {
            events.push(action_started_event(
                &lesson.id,
                scene,
                scene_index,
                action,
                action_index,
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
        summary: format!("Completed playback for lesson {}", lesson.title),
    });

    events
}

fn scene_started_event(lesson_id: &str, scene: &Scene, scene_index: usize) -> PlaybackEvent {
    PlaybackEvent {
        lesson_id: lesson_id.to_string(),
        kind: PlaybackEventKind::SceneStarted,
        scene_id: Some(scene.id.clone()),
        scene_title: Some(scene.title.clone()),
        scene_index: Some(scene_index),
        action_id: None,
        action_type: None,
        action_index: None,
        summary: format!("Starting scene {}: {}", scene_index + 1, scene.title),
    }
}

fn action_started_event(
    lesson_id: &str,
    scene: &Scene,
    scene_index: usize,
    action: &LessonAction,
    action_index: usize,
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
        summary: action_summary(action),
    }
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

    use ai_tutor_domain::{
        action::LessonAction,
        lesson::Lesson,
        scene::{Scene, SceneContent, Stage},
    };

    use super::{lesson_playback_events, PlaybackEventKind};

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
        assert!(matches!(events[3].kind, PlaybackEventKind::SessionCompleted));
    }
}
