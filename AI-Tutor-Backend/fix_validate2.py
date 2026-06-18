with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

start_idx = content.find('pub(crate) fn validate_slide_elements(')
end_idx = content.find('pub(crate) fn parse_json_with_repair')

if start_idx != -1 and end_idx != -1:
    new_validate = """pub(crate) fn validate_slide_elements(
    elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    let normalized = elements
        .into_iter()
        .filter(|el| {
            let (w, h) = match el {
                SlideElement::Text { width, height, .. } => (*width, *height),
                SlideElement::Image { width, height, .. } => (*width, *height),
                SlideElement::Video { width, height, .. } => (*width, *height),
                SlideElement::Shape { width, height, .. } => (*width, *height),
                SlideElement::Line { width, height, .. } => (*width, *height),
                SlideElement::Chart { width, height, .. } => (*width, *height),
                SlideElement::Latex { width, height, .. } => (*width, *height),
                SlideElement::Table { width, height, .. } => (*width, *height),
            };
            w > 0.0 && h > 0.0
        })
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        fallback_slide_elements(outline)
    } else {
        normalized
    }
}

"""
    
    content = content[:start_idx] + new_validate + content[end_idx:]

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
