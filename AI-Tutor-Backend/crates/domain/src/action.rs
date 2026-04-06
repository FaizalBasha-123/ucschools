use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LessonAction {
    Speech {
        id: String,
        title: Option<String>,
        description: Option<String>,
        text: String,
        audio_id: Option<String>,
        audio_url: Option<String>,
        voice: Option<String>,
        speed: Option<f32>,
    },
    Spotlight {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: String,
        dim_opacity: Option<f32>,
    },
    Laser {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: String,
        color: Option<String>,
    },
    PlayVideo {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: String,
    },
    Discussion {
        id: String,
        title: Option<String>,
        description: Option<String>,
        topic: String,
        prompt: Option<String>,
        agent_id: Option<String>,
    },
    WhiteboardOpen {
        id: String,
        title: Option<String>,
        description: Option<String>,
    },
    WhiteboardDrawText {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: Option<String>,
        content: String,
        x: f32,
        y: f32,
        width: Option<f32>,
        height: Option<f32>,
        font_size: Option<f32>,
        color: Option<String>,
    },
    WhiteboardDrawShape {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: Option<String>,
        shape: WhiteboardShape,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        fill_color: Option<String>,
    },
    WhiteboardDrawChart {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: Option<String>,
        chart_type: WhiteboardChartType,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        data: ChartData,
        theme_colors: Option<Vec<String>>,
    },
    WhiteboardDrawLatex {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: Option<String>,
        latex: String,
        x: f32,
        y: f32,
        width: Option<f32>,
        height: Option<f32>,
        color: Option<String>,
    },
    WhiteboardDrawTable {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: Option<String>,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        data: Vec<Vec<String>>,
        outline: Option<TableOutline>,
        theme: Option<TableTheme>,
    },
    WhiteboardDrawLine {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: Option<String>,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        color: Option<String>,
        width: Option<f32>,
        style: Option<LineStyle>,
        points: Option<[String; 2]>,
    },
    WhiteboardClear {
        id: String,
        title: Option<String>,
        description: Option<String>,
    },
    WhiteboardDelete {
        id: String,
        title: Option<String>,
        description: Option<String>,
        element_id: String,
    },
    WhiteboardClose {
        id: String,
        title: Option<String>,
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
    pub labels: Vec<String>,
    pub legends: Vec<String>,
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
