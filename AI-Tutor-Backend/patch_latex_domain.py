import re

with open('crates/domain/src/scene.rs', 'r') as f:
    content = f.read()

target = """    Latex {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        #[serde(default)]
        rotate: f32,
        latex: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        html: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        colors: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shadow: Option<serde_json::Value>,
        #[serde(default, rename = "lineHeight", skip_serializing_if = "Option::is_none")]
        line_height: Option<f32>,
        #[serde(default, rename = "wordSpace", skip_serializing_if = "Option::is_none")]
        word_space: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        opacity: Option<f32>,
    },"""

replacement = """    Latex {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        #[serde(default)]
        rotate: f32,
        latex: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        html: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        colors: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shadow: Option<serde_json::Value>,
        #[serde(default, rename = "lineHeight", skip_serializing_if = "Option::is_none")]
        line_height: Option<f32>,
        #[serde(default, rename = "wordSpace", skip_serializing_if = "Option::is_none")]
        word_space: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        opacity: Option<f32>,
        #[serde(default, rename = "fixedRatio", skip_serializing_if = "Option::is_none")]
        fixed_ratio: Option<bool>,
    },"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find domain target")

with open('crates/domain/src/scene.rs', 'w') as f:
    f.write(content)
