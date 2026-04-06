use serde::{Deserialize, Serialize};

/// Whiteboard runtime state model.
///
/// Represents the state of a whiteboard canvas during a lesson session,
/// including all drawn objects and pending actions.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhiteboardState {
    pub id: String,
    pub objects: Vec<WhiteboardObject>,
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WhiteboardObject {
    Path {
        id: String,
        points: Vec<Point2D>,
        color: String,
        stroke_width: f32,
    },
    Text {
        id: String,
        position: Point2D,
        content: String,
        font_size: f32,
        color: String,
    },
    Rectangle {
        id: String,
        position: Point2D,
        width: f32,
        height: f32,
        color: String,
        fill: Option<String>,
        stroke_width: f32,
    },
    Circle {
        id: String,
        center: Point2D,
        radius: f32,
        color: String,
        fill: Option<String>,
        stroke_width: f32,
    },
    Highlight {
        id: String,
        position: Point2D,
        width: f32,
        height: f32,
        color: String,
        opacity: f32,
    },
    Arrow {
        id: String,
        start: Point2D,
        end: Point2D,
        color: String,
        stroke_width: f32,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point2D {
    pub x: f32,
    pub y: f32,
}

/// Whiteboard action that can be executed during lesson playback
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum WhiteboardAction {
    Draw {
        object: WhiteboardObject,
    },
    Annotate {
        object: WhiteboardObject,
    },
    Highlight {
        position: Point2D,
        width: f32,
        height: f32,
        color: String,
    },
    Clear,
    Undo,
    Reset,
}

impl WhiteboardState {
    pub fn new(id: String) -> Self {
        Self {
            id,
            objects: Vec::new(),
            version: 0,
        }
    }

    pub fn apply_action(&mut self, action: &WhiteboardAction) {
        match action {
            WhiteboardAction::Draw { object } | WhiteboardAction::Annotate { object } => {
                self.objects.push(object.clone());
                self.version += 1;
            }
            WhiteboardAction::Highlight {
                position,
                width,
                height,
                color,
            } => {
                self.objects.push(WhiteboardObject::Highlight {
                    id: format!("highlight-{}", self.version),
                    position: *position,
                    width: *width,
                    height: *height,
                    color: color.clone(),
                    opacity: 0.3,
                });
                self.version += 1;
            }
            WhiteboardAction::Clear => {
                self.objects.clear();
                self.version += 1;
            }
            WhiteboardAction::Undo => {
                self.objects.pop();
                self.version += 1;
            }
            WhiteboardAction::Reset => {
                self.objects.clear();
                self.version = 0;
            }
        }
    }
}
