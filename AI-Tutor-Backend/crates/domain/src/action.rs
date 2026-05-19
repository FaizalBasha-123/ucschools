use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LessonAction {
    Speech {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        audio_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        audio_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        voice: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speed: Option<f32>,
    },
    Spotlight {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        element_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dim_opacity: Option<f32>,
    },
    Laser {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        element_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    PlayVideo {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        element_id: String,
    },
    Discussion {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        topic: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_id: Option<String>,
    },
    WhiteboardOpen {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    WhiteboardDrawText {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element_id: Option<String>,
        content: String,
        x: f32,
        y: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        font_size: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    WhiteboardDrawShape {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element_id: Option<String>,
        shape: WhiteboardShape,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill_color: Option<String>,
    },
    WhiteboardDrawChart {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element_id: Option<String>,
        chart_type: WhiteboardChartType,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        data: ChartData,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        theme_colors: Option<Vec<String>>,
    },
    WhiteboardDrawLatex {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element_id: Option<String>,
        latex: String,
        x: f32,
        y: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    WhiteboardDrawTable {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element_id: Option<String>,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        data: Vec<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        outline: Option<TableOutline>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        theme: Option<TableTheme>,
    },
    WhiteboardDrawLine {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element_id: Option<String>,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<LineStyle>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        points: Option<[String; 2]>,
    },
    WhiteboardClear {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    WhiteboardDelete {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        element_id: String,
    },
    WhiteboardClose {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhiteboardShape {
    Rectangle,
    Circle,
    Triangle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhiteboardChartType {
    Bar,
    Column,
    Line,
    Pie,
    Ring,
    Area,
    Radar,
    Scatter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartData {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub legends: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub series: Vec<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableOutline {
    pub width: f32,
    pub style: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableTheme {
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineStyle {
    Solid,
    Dashed,
}
