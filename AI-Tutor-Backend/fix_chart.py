import re

with open('crates/domain/src/scene.rs', 'r') as f:
    content = f.read()

chart_struct_regex = r'(Chart \{\s*id: String,\s*left: f32,\s*top: f32,\s*width: f32,\s*height: f32,\s*#\[serde\(default\)\]\s*rotate: f32,\s*#\[serde\(default, rename = "chartType", skip_serializing_if = "Option::is_none"\)\]\s*chart_type: Option<String>,\s*#\[serde\(default, skip_serializing_if = "Option::is_none"\)\]\s*data: Option<serde_json::Value>,\s*#\[serde\(default, rename = "themeColors", skip_serializing_if = "Option::is_none"\)\]\s*theme_colors: Option<Vec<String>>,\s*#\[serde\(default, skip_serializing_if = "Option::is_none"\)\]\s*shadow: Option<serde_json::Value>,\s*\})'

new_chart_struct = '''Chart {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        #[serde(default)]
        rotate: f32,
        #[serde(default, rename = "chartType", skip_serializing_if = "Option::is_none")]
        chart_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        options: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        outline: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill: Option<String>,
        #[serde(default, rename = "textColor", skip_serializing_if = "Option::is_none")]
        text_color: Option<String>,
        #[serde(default, rename = "lineColor", skip_serializing_if = "Option::is_none")]
        line_color: Option<String>,
        #[serde(default, rename = "themeColors", skip_serializing_if = "Option::is_none")]
        theme_colors: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shadow: Option<serde_json::Value>,
    }'''

content = re.sub(chart_struct_regex, new_chart_struct, content)

with open('crates/domain/src/scene.rs', 'w') as f:
    f.write(content)

with open('crates/orchestrator/src/generation/dtos.rs', 'r') as f:
    content = f.read()

dtos_chart = content.replace(
    'pub(crate) data: Option<serde_json::Value>,',
    'pub(crate) data: Option<serde_json::Value>,\n    pub(crate) options: Option<serde_json::Value>,\n    #[serde(default, alias = "textColor")]\n    pub(crate) text_color: Option<String>,\n    #[serde(default, alias = "lineColor")]\n    pub(crate) line_color: Option<String>,'
)

with open('crates/orchestrator/src/generation/dtos.rs', 'w') as f:
    f.write(dtos_chart)

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

helpers_map_chart = content.replace(
    'data: element.data,',
    'data: element.data,\n            options: element.options,\n            outline: element.outline.clone(),\n            fill: element.fill.clone(),\n            text_color: element.text_color,\n            line_color: element.line_color,'
)

helpers_norm_chart = helpers_map_chart.replace(
    'chart_type,\n            data,\n            theme_colors,\n            .. \n        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {\n            SlideElement::Chart { shadow: None,\nid,\n                left,\n                top,\n                width,\n                height,\n                rotate,\n                chart_type,\n                data,\n                theme_colors,\n            }',
    'chart_type,\n            data,\n            options,\n            outline,\n            fill,\n            text_color,\n            line_color,\n            theme_colors,\n            .. \n        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {\n            SlideElement::Chart { shadow: None,\nid,\n                left,\n                top,\n                width,\n                height,\n                rotate,\n                chart_type,\n                data,\n                options,\n                outline,\n                fill,\n                text_color,\n                line_color,\n                theme_colors,\n            }'
)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(helpers_norm_chart)
