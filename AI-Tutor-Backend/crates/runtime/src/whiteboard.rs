use ai_tutor_domain::{
    action::{LessonAction, WhiteboardShape},
    runtime::{
        PersistedPoint2D, PersistedWhiteboardObject, PersistedWhiteboardState,
        WhiteboardActionRecord,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Whiteboard runtime state model.
///
/// Represents the state of a whiteboard canvas during a lesson session,
/// including all drawn objects and pending actions.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhiteboardState {
    pub id: String,
    pub is_open: bool,
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
    Open,
    Close,
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
    Delete {
        object_id: String,
    },
    Undo,
    Reset,
}

impl WhiteboardState {
    pub fn new(id: String) -> Self {
        Self {
            id,
            is_open: false,
            objects: Vec::new(),
            version: 0,
        }
    }

    pub fn apply_action(&mut self, action: &WhiteboardAction) {
        match action {
            WhiteboardAction::Open => {
                self.is_open = true;
                self.version += 1;
            }
            WhiteboardAction::Close => {
                self.is_open = false;
                self.version += 1;
            }
            WhiteboardAction::Draw { object } | WhiteboardAction::Annotate { object } => {
                self.is_open = true;
                self.upsert_object(object.clone());
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
                self.is_open = true;
                self.objects.clear();
                self.version += 1;
            }
            WhiteboardAction::Delete { object_id } => {
                self.objects.retain(|object| object.id() != object_id);
                self.version += 1;
            }
            WhiteboardAction::Undo => {
                self.objects.pop();
                self.version += 1;
            }
            WhiteboardAction::Reset => {
                self.is_open = false;
                self.objects.clear();
                self.version = 0;
            }
        }
    }

    fn upsert_object(&mut self, object: WhiteboardObject) {
        let object_id = object.id().to_string();
        if let Some(existing_index) = self
            .objects
            .iter()
            .position(|existing| existing.id() == object_id)
        {
            self.objects[existing_index] = object;
        } else {
            self.objects.push(object);
        }
    }
}

impl WhiteboardObject {
    pub fn id(&self) -> &str {
        match self {
            WhiteboardObject::Path { id, .. }
            | WhiteboardObject::Text { id, .. }
            | WhiteboardObject::Rectangle { id, .. }
            | WhiteboardObject::Circle { id, .. }
            | WhiteboardObject::Highlight { id, .. }
            | WhiteboardObject::Arrow { id, .. } => id,
        }
    }
}

pub fn whiteboard_action_from_lesson_action(action: &LessonAction) -> Option<WhiteboardAction> {
    match action {
        LessonAction::WhiteboardOpen { .. } => Some(WhiteboardAction::Open),
        LessonAction::WhiteboardClose { .. } => Some(WhiteboardAction::Close),
        LessonAction::WhiteboardClear { .. } => Some(WhiteboardAction::Clear),
        LessonAction::WhiteboardDelete { element_id, .. } => Some(WhiteboardAction::Delete {
            object_id: element_id.clone(),
        }),
        LessonAction::WhiteboardDrawText {
            element_id,
            id,
            content,
            x,
            y,
            font_size,
            color,
            ..
        } => Some(WhiteboardAction::Draw {
            object: WhiteboardObject::Text {
                id: element_id.clone().unwrap_or_else(|| id.clone()),
                position: Point2D { x: *x, y: *y },
                content: content.clone(),
                font_size: font_size.unwrap_or(24.0),
                color: color.clone().unwrap_or_else(|| "#000000".to_string()),
            },
        }),
        LessonAction::WhiteboardDrawShape {
            element_id,
            id,
            shape,
            x,
            y,
            width,
            height,
            fill_color,
            ..
        } => Some(WhiteboardAction::Draw {
            object: match shape {
                WhiteboardShape::Rectangle => WhiteboardObject::Rectangle {
                    id: element_id.clone().unwrap_or_else(|| id.clone()),
                    position: Point2D { x: *x, y: *y },
                    width: *width,
                    height: *height,
                    color: "#333333".to_string(),
                    fill: fill_color.clone(),
                    stroke_width: 2.0,
                },
                WhiteboardShape::Circle => WhiteboardObject::Circle {
                    id: element_id.clone().unwrap_or_else(|| id.clone()),
                    center: Point2D {
                        x: *x + (*width / 2.0),
                        y: *y + (*height / 2.0),
                    },
                    radius: width.min(*height) / 2.0,
                    color: "#333333".to_string(),
                    fill: fill_color.clone(),
                    stroke_width: 2.0,
                },
                WhiteboardShape::Triangle => WhiteboardObject::Path {
                    id: element_id.clone().unwrap_or_else(|| id.clone()),
                    points: vec![
                        Point2D {
                            x: *x + (*width / 2.0),
                            y: *y,
                        },
                        Point2D {
                            x: *x + *width,
                            y: *y + *height,
                        },
                        Point2D {
                            x: *x,
                            y: *y + *height,
                        },
                        Point2D {
                            x: *x + (*width / 2.0),
                            y: *y,
                        },
                    ],
                    color: fill_color.clone().unwrap_or_else(|| "#333333".to_string()),
                    stroke_width: 2.0,
                },
            },
        }),
        LessonAction::WhiteboardDrawLine {
            element_id,
            id,
            start_x,
            start_y,
            end_x,
            end_y,
            color,
            width,
            points,
            ..
        } => Some(WhiteboardAction::Draw {
            object: if points.as_ref().map(|p| p[1].as_str()) == Some("arrow") {
                WhiteboardObject::Arrow {
                    id: element_id.clone().unwrap_or_else(|| id.clone()),
                    start: Point2D {
                        x: *start_x,
                        y: *start_y,
                    },
                    end: Point2D {
                        x: *end_x,
                        y: *end_y,
                    },
                    color: color.clone().unwrap_or_else(|| "#000000".to_string()),
                    stroke_width: width.unwrap_or(2.0),
                }
            } else {
                WhiteboardObject::Path {
                    id: element_id.clone().unwrap_or_else(|| id.clone()),
                    points: vec![
                        Point2D {
                            x: *start_x,
                            y: *start_y,
                        },
                        Point2D {
                            x: *end_x,
                            y: *end_y,
                        },
                    ],
                    color: color.clone().unwrap_or_else(|| "#000000".to_string()),
                    stroke_width: width.unwrap_or(2.0),
                }
            },
        }),
        LessonAction::WhiteboardDrawLatex {
            element_id,
            id,
            latex,
            x,
            y,
            color,
            ..
        } => Some(WhiteboardAction::Annotate {
            object: WhiteboardObject::Text {
                id: element_id.clone().unwrap_or_else(|| id.clone()),
                position: Point2D { x: *x, y: *y },
                content: latex.clone(),
                font_size: 20.0,
                color: color.clone().unwrap_or_else(|| "#000000".to_string()),
            },
        }),
        LessonAction::WhiteboardDrawChart {
            element_id,
            id,
            x,
            y,
            width,
            height,
            theme_colors,
            ..
        } => Some(WhiteboardAction::Draw {
            object: WhiteboardObject::Rectangle {
                id: element_id.clone().unwrap_or_else(|| id.clone()),
                position: Point2D { x: *x, y: *y },
                width: *width,
                height: *height,
                color: theme_colors
                    .as_ref()
                    .and_then(|colors| colors.first().cloned())
                    .unwrap_or_else(|| "#3b82f6".to_string()),
                fill: Some("rgba(0,0,0,0.05)".to_string()),
                stroke_width: 2.0,
            },
        }),
        LessonAction::WhiteboardDrawTable {
            element_id,
            id,
            x,
            y,
            width,
            height,
            outline,
            theme,
            ..
        } => Some(WhiteboardAction::Draw {
            object: WhiteboardObject::Rectangle {
                id: element_id.clone().unwrap_or_else(|| id.clone()),
                position: Point2D { x: *x, y: *y },
                width: *width,
                height: *height,
                color: outline
                    .as_ref()
                    .map(|outline| outline.color.clone())
                    .unwrap_or_else(|| "#cccccc".to_string()),
                fill: theme.as_ref().map(|theme| theme.color.clone()),
                stroke_width: outline.as_ref().map(|outline| outline.width).unwrap_or(1.0),
            },
        }),
        _ => None,
    }
}

pub fn whiteboard_action_from_runtime_record(
    record: &WhiteboardActionRecord,
) -> Option<WhiteboardAction> {
    whiteboard_action_from_runtime_parts(&record.action_name, &record.params)
}

pub fn whiteboard_action_from_runtime_parts(
    action_name: &str,
    params: &Value,
) -> Option<WhiteboardAction> {
    match action_name {
        "wb_open" => Some(WhiteboardAction::Open),
        "wb_close" => Some(WhiteboardAction::Close),
        "wb_clear" => Some(WhiteboardAction::Clear),
        "wb_delete" => Some(WhiteboardAction::Delete {
            object_id: string_param(params, &["elementId", "element_id"])?,
        }),
        "wb_draw_text" => Some(WhiteboardAction::Draw {
            object: WhiteboardObject::Text {
                id: string_param(params, &["elementId", "element_id", "id"])
                    .unwrap_or_else(|| "wb-text".to_string()),
                position: Point2D {
                    x: float_param(params, &["x"]).unwrap_or(0.0),
                    y: float_param(params, &["y"]).unwrap_or(0.0),
                },
                content: string_param(params, &["content"]).unwrap_or_default(),
                font_size: float_param(params, &["fontSize", "font_size"]).unwrap_or(24.0),
                color: string_param(params, &["color"]).unwrap_or_else(|| "#000000".to_string()),
            },
        }),
        "wb_draw_shape" => runtime_shape_action(params),
        "wb_draw_line" => runtime_line_action(params),
        "wb_draw_latex" => Some(WhiteboardAction::Annotate {
            object: WhiteboardObject::Text {
                id: string_param(params, &["elementId", "element_id", "id"])
                    .unwrap_or_else(|| "wb-latex".to_string()),
                position: Point2D {
                    x: float_param(params, &["x"]).unwrap_or(0.0),
                    y: float_param(params, &["y"]).unwrap_or(0.0),
                },
                content: string_param(params, &["latex"]).unwrap_or_default(),
                font_size: 20.0,
                color: string_param(params, &["color"]).unwrap_or_else(|| "#000000".to_string()),
            },
        }),
        "wb_draw_chart" => Some(WhiteboardAction::Draw {
            object: WhiteboardObject::Rectangle {
                id: string_param(params, &["elementId", "element_id", "id"])
                    .unwrap_or_else(|| "wb-chart".to_string()),
                position: Point2D {
                    x: float_param(params, &["x"]).unwrap_or(0.0),
                    y: float_param(params, &["y"]).unwrap_or(0.0),
                },
                width: float_param(params, &["width"]).unwrap_or(240.0),
                height: float_param(params, &["height"]).unwrap_or(160.0),
                color: first_array_string(params, "themeColors")
                    .unwrap_or_else(|| "#3b82f6".to_string()),
                fill: Some("rgba(0,0,0,0.05)".to_string()),
                stroke_width: 2.0,
            },
        }),
        "wb_draw_table" => Some(WhiteboardAction::Draw {
            object: WhiteboardObject::Rectangle {
                id: string_param(params, &["elementId", "element_id", "id"])
                    .unwrap_or_else(|| "wb-table".to_string()),
                position: Point2D {
                    x: float_param(params, &["x"]).unwrap_or(0.0),
                    y: float_param(params, &["y"]).unwrap_or(0.0),
                },
                width: float_param(params, &["width"]).unwrap_or(240.0),
                height: float_param(params, &["height"]).unwrap_or(160.0),
                color: nested_string_param(params, &["outline"], &["color"])
                    .unwrap_or_else(|| "#cccccc".to_string()),
                fill: nested_string_param(params, &["theme"], &["color"]),
                stroke_width: nested_float_param(params, &["outline"], &["width"]).unwrap_or(1.0),
            },
        }),
        _ => None,
    }
}

pub fn whiteboard_state_from_ledger(
    id: String,
    ledger: &[WhiteboardActionRecord],
) -> WhiteboardState {
    let mut state = WhiteboardState::new(id);
    for record in ledger {
        if let Some(action) = whiteboard_action_from_runtime_record(record) {
            state.apply_action(&action);
        }
    }
    state
}

pub fn persisted_whiteboard_state_from_runtime(
    state: &WhiteboardState,
) -> PersistedWhiteboardState {
    PersistedWhiteboardState {
        id: state.id.clone(),
        is_open: state.is_open,
        version: state.version,
        objects: state
            .objects
            .iter()
            .cloned()
            .map(persisted_whiteboard_object_from_runtime)
            .collect(),
    }
}

pub fn runtime_whiteboard_state_from_persisted(
    state: &PersistedWhiteboardState,
) -> WhiteboardState {
    WhiteboardState {
        id: state.id.clone(),
        is_open: state.is_open,
        version: state.version,
        objects: state
            .objects
            .iter()
            .cloned()
            .map(runtime_whiteboard_object_from_persisted)
            .collect(),
    }
}

fn runtime_shape_action(params: &Value) -> Option<WhiteboardAction> {
    let id = string_param(params, &["elementId", "element_id", "id"])
        .unwrap_or_else(|| "wb-shape".to_string());
    let x = float_param(params, &["x"]).unwrap_or(0.0);
    let y = float_param(params, &["y"]).unwrap_or(0.0);
    let width = float_param(params, &["width"]).unwrap_or(120.0);
    let height = float_param(params, &["height"]).unwrap_or(80.0);
    let fill = string_param(params, &["fillColor", "fill_color"]);
    let shape = string_param(params, &["shape"]).unwrap_or_else(|| "rectangle".to_string());

    Some(WhiteboardAction::Draw {
        object: match shape.as_str() {
            "circle" => WhiteboardObject::Circle {
                id,
                center: Point2D {
                    x: x + (width / 2.0),
                    y: y + (height / 2.0),
                },
                radius: width.min(height) / 2.0,
                color: "#333333".to_string(),
                fill,
                stroke_width: 2.0,
            },
            "triangle" => WhiteboardObject::Path {
                id,
                points: vec![
                    Point2D {
                        x: x + (width / 2.0),
                        y,
                    },
                    Point2D {
                        x: x + width,
                        y: y + height,
                    },
                    Point2D { x, y: y + height },
                    Point2D {
                        x: x + (width / 2.0),
                        y,
                    },
                ],
                color: fill.clone().unwrap_or_else(|| "#333333".to_string()),
                stroke_width: 2.0,
            },
            _ => WhiteboardObject::Rectangle {
                id,
                position: Point2D { x, y },
                width,
                height,
                color: "#333333".to_string(),
                fill,
                stroke_width: 2.0,
            },
        },
    })
}

fn runtime_line_action(params: &Value) -> Option<WhiteboardAction> {
    let id = string_param(params, &["elementId", "element_id", "id"])
        .unwrap_or_else(|| "wb-line".to_string());
    let color = string_param(params, &["color"]).unwrap_or_else(|| "#000000".to_string());
    let stroke_width = float_param(params, &["width"]).unwrap_or(2.0);
    let start = Point2D {
        x: float_param(params, &["startX", "start_x"]).unwrap_or(0.0),
        y: float_param(params, &["startY", "start_y"]).unwrap_or(0.0),
    };
    let end = Point2D {
        x: float_param(params, &["endX", "end_x"]).unwrap_or(0.0),
        y: float_param(params, &["endY", "end_y"]).unwrap_or(0.0),
    };

    let is_arrow = params
        .get("points")
        .and_then(Value::as_array)
        .and_then(|points| points.get(1))
        .and_then(Value::as_str)
        == Some("arrow");

    Some(WhiteboardAction::Draw {
        object: if is_arrow {
            WhiteboardObject::Arrow {
                id,
                start,
                end,
                color,
                stroke_width,
            }
        } else {
            WhiteboardObject::Path {
                id,
                points: vec![start, end],
                color,
                stroke_width,
            }
        },
    })
}

fn string_param(params: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| params.get(*key).and_then(Value::as_str))
        .map(ToString::to_string)
}

fn float_param(params: &Value, keys: &[&str]) -> Option<f32> {
    keys.iter().find_map(|key| {
        params
            .get(*key)
            .and_then(Value::as_f64)
            .map(|value| value as f32)
    })
}

fn nested_string_param(params: &Value, parent_keys: &[&str], keys: &[&str]) -> Option<String> {
    parent_keys
        .iter()
        .find_map(|parent| params.get(*parent))
        .and_then(|nested| string_param(nested, keys))
}

fn nested_float_param(params: &Value, parent_keys: &[&str], keys: &[&str]) -> Option<f32> {
    parent_keys
        .iter()
        .find_map(|parent| params.get(*parent))
        .and_then(|nested| float_param(nested, keys))
}

fn first_array_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn persisted_whiteboard_object_from_runtime(object: WhiteboardObject) -> PersistedWhiteboardObject {
    match object {
        WhiteboardObject::Path {
            id,
            points,
            color,
            stroke_width,
        } => PersistedWhiteboardObject::Path {
            id,
            points: points
                .into_iter()
                .map(persisted_point_from_runtime)
                .collect(),
            color,
            stroke_width,
        },
        WhiteboardObject::Text {
            id,
            position,
            content,
            font_size,
            color,
        } => PersistedWhiteboardObject::Text {
            id,
            position: persisted_point_from_runtime(position),
            content,
            font_size,
            color,
        },
        WhiteboardObject::Rectangle {
            id,
            position,
            width,
            height,
            color,
            fill,
            stroke_width,
        } => PersistedWhiteboardObject::Rectangle {
            id,
            position: persisted_point_from_runtime(position),
            width,
            height,
            color,
            fill,
            stroke_width,
        },
        WhiteboardObject::Circle {
            id,
            center,
            radius,
            color,
            fill,
            stroke_width,
        } => PersistedWhiteboardObject::Circle {
            id,
            center: persisted_point_from_runtime(center),
            radius,
            color,
            fill,
            stroke_width,
        },
        WhiteboardObject::Highlight {
            id,
            position,
            width,
            height,
            color,
            opacity,
        } => PersistedWhiteboardObject::Highlight {
            id,
            position: persisted_point_from_runtime(position),
            width,
            height,
            color,
            opacity,
        },
        WhiteboardObject::Arrow {
            id,
            start,
            end,
            color,
            stroke_width,
        } => PersistedWhiteboardObject::Arrow {
            id,
            start: persisted_point_from_runtime(start),
            end: persisted_point_from_runtime(end),
            color,
            stroke_width,
        },
    }
}

fn runtime_whiteboard_object_from_persisted(object: PersistedWhiteboardObject) -> WhiteboardObject {
    match object {
        PersistedWhiteboardObject::Path {
            id,
            points,
            color,
            stroke_width,
        } => WhiteboardObject::Path {
            id,
            points: points
                .into_iter()
                .map(runtime_point_from_persisted)
                .collect(),
            color,
            stroke_width,
        },
        PersistedWhiteboardObject::Text {
            id,
            position,
            content,
            font_size,
            color,
        } => WhiteboardObject::Text {
            id,
            position: runtime_point_from_persisted(position),
            content,
            font_size,
            color,
        },
        PersistedWhiteboardObject::Rectangle {
            id,
            position,
            width,
            height,
            color,
            fill,
            stroke_width,
        } => WhiteboardObject::Rectangle {
            id,
            position: runtime_point_from_persisted(position),
            width,
            height,
            color,
            fill,
            stroke_width,
        },
        PersistedWhiteboardObject::Circle {
            id,
            center,
            radius,
            color,
            fill,
            stroke_width,
        } => WhiteboardObject::Circle {
            id,
            center: runtime_point_from_persisted(center),
            radius,
            color,
            fill,
            stroke_width,
        },
        PersistedWhiteboardObject::Highlight {
            id,
            position,
            width,
            height,
            color,
            opacity,
        } => WhiteboardObject::Highlight {
            id,
            position: runtime_point_from_persisted(position),
            width,
            height,
            color,
            opacity,
        },
        PersistedWhiteboardObject::Arrow {
            id,
            start,
            end,
            color,
            stroke_width,
        } => WhiteboardObject::Arrow {
            id,
            start: runtime_point_from_persisted(start),
            end: runtime_point_from_persisted(end),
            color,
            stroke_width,
        },
    }
}

fn persisted_point_from_runtime(point: Point2D) -> PersistedPoint2D {
    PersistedPoint2D {
        x: point.x,
        y: point.y,
    }
}

fn runtime_point_from_persisted(point: PersistedPoint2D) -> Point2D {
    Point2D {
        x: point.x,
        y: point.y,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draw_with_same_id_replaces_existing_object_instead_of_duplicating() {
        let mut state = WhiteboardState::new("session-1".to_string());
        state.apply_action(&WhiteboardAction::Draw {
            object: WhiteboardObject::Text {
                id: "obj-1".to_string(),
                position: Point2D { x: 10.0, y: 20.0 },
                content: "first".to_string(),
                font_size: 20.0,
                color: "#000".to_string(),
            },
        });
        state.apply_action(&WhiteboardAction::Draw {
            object: WhiteboardObject::Text {
                id: "obj-1".to_string(),
                position: Point2D { x: 12.0, y: 24.0 },
                content: "updated".to_string(),
                font_size: 20.0,
                color: "#111".to_string(),
            },
        });

        assert_eq!(state.objects.len(), 1);
        let WhiteboardObject::Text { content, .. } = &state.objects[0] else {
            panic!("expected text object");
        };
        assert_eq!(content, "updated");
    }
}
