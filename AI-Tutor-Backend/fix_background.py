import re

with open('crates/orchestrator/src/generation/slide.rs', 'r') as f:
    content = f.read()

target = """        let background = outline.suggested_image_ids.first().map(|id| {
            SlideBackground::Image {
                src: id.clone(),
                image_size: Some("cover".to_string()),
            }
        });"""

replacement = """        let background = payload.background.and_then(|bg| {
            serde_json::from_value::<ai_tutor_domain::scene::SlideBackground>(bg).ok()
        });"""

if target in content:
    content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/slide.rs', 'w') as f:
    f.write(content)
