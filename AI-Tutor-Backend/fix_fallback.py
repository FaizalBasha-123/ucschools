import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """pub(crate) fn fallback_slide_elements(outline: &SceneOutline) -> Vec<SlideElement> {
    vec![
        SlideElement::Shape { shadow: None, fixed_ratio: None, opacity: None, outline: None,
id: "fallback-shape-bg".to_string(),
            left: 50.0,
            top: 50.0,
            width: 900.0,
            height: 463.0,
            rotate: 0.0,
            shape_name: Some("rect".to_string()),
            fill: "#f8f9fa".to_string(),
            path: Some("M 0 0 L 200 0 L 200 200 L 0 200 Z".to_string()),
            view_box: Some(vec![200.0, 200.0]),
        },
        SlideElement::Text { shadow: None, fill: None, outline: None, line_height: None, opacity: None, word_space: None, paragraph_space: None, vertical: None,
id: "fallback-text-title".to_string(),
            left: 100.0,
            top: 100.0,
            width: 800.0,
            height: 60.0,
            rotate: 0.0,
            content: format!("<p style=\\"font-size: 32px; font-weight: bold; text-align: center; color: #333333;\\">{}</p>", outline.title),
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#333333".to_string(),
        },
        SlideElement::Text { shadow: None, fill: None, outline: None, line_height: None, opacity: None, word_space: None, paragraph_space: None, vertical: None,
id: "fallback-text-desc".to_string(),
            left: 100.0,
            top: 200.0,
            width: 800.0,
            height: 300.0,
            rotate: 0.0,
            content: format!("<p style=\\"font-size: 20px; color: #666666;\\">{}</p>", outline.description),
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#666666".to_string(),
        },
    ]
}"""

replacement = """pub(crate) fn fallback_slide_elements(outline: &SceneOutline) -> Vec<SlideElement> {
    vec![
        SlideElement::Text { shadow: None, fill: None, outline: None, line_height: None, opacity: None, word_space: None, paragraph_space: None, vertical: None,
id: format!("text_{}", uuid::Uuid::new_v4().to_string()[..8].to_string()),
            left: 50.0,
            top: 50.0,
            width: 900.0,
            height: 100.0,
            rotate: 0.0,
            content: format!("<p style=\\"font-size: 32px; font-weight: bold; text-align: center;\\">{}</p>", outline.title),
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#333333".to_string(),
        },
    ]
}"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Fallback not found")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
