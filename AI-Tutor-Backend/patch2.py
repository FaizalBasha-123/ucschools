import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Remove the title insertion block
pattern = re.compile(r'    if !normalized\n\s*\.iter\(\)\n\s*\.any\(\|element\| matches!\(element, SlideElement::Text \{[^}]+\}\s*if content\.contains\(&outline\.title\)\)\)\n\s*\{[^}]+\}\s*\);\s*\}\n\n', re.MULTILINE)
content = pattern.sub('', content)

# Also there might be a simpler way: just replace the exact text
target_title_block = """    if !normalized
        .iter()
        .any(|element| matches!(element, SlideElement::Text {
content, .. } if content.contains(&outline.title)))
    {
        normalized.insert(
            0,
            SlideElement::Text { shadow: None, fill: None, outline: None, line_height: None, opacity: None, word_space: None, paragraph_space: None, vertical: None,
                id: "text-title-auto".to_string(),
                left: 60.0,
                top: 48.0,
                width: 880.0,
                height: 60.0,
                rotate: 0.0,
                content: format!("<p style=\\"font-size: 32px; font-weight: bold;\\">{}</p>", outline.title),
                default_font_name: "Microsoft YaHei".to_string(),
                default_color: "#333333".to_string(),
            },
        );
    }"""
content = content.replace(target_title_block, '')

# Also remove attach_media_placeholders definition
target_attach = """pub(crate) fn attach_media_placeholders(
    mut elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    let mut next_index = elements.len();

    for media in outline.media_generations.iter() {
        let exists = elements
            .iter()
            .any(|element| match (element, &media.media_type) {
                (SlideElement::Image {
src, .. }, MediaType::Image)
                | (SlideElement::Video {
src, .. }, MediaType::Video) => src == &media.element_id,
                _ => false,
            });

        if exists {
            continue;
        }

        next_index += 1;
        match media.media_type {
            MediaType::Image => elements.push(SlideElement::Image { shadow: None, outline: None, opacity: None,
                id: media.element_id.clone(),
                left: 620.0,
                top: 120.0,
                width: 300.0,
                height: 220.0,
                rotate: 0.0,
                src: media.element_id.clone(),
                fixed_ratio: false,
            }),
            MediaType::Video => elements.push(SlideElement::Video { shadow: None,
                id: media.element_id.clone(),
                left: 620.0,
                top: 120.0,
                width: 300.0,
                height: 220.0,
                rotate: 0.0,
                src: media.element_id.clone(),
            }),
        }
    }

    if elements.is_empty() && next_index == 0 {
        elements.push(SlideElement::Text { shadow: None, fill: None, outline: None, line_height: None, opacity: None, word_space: None, paragraph_space: None, vertical: None,
            id: "text-fallback-1".to_string(),
            left: 60.0,
            top: 80.0,
            width: 800.0,
            height: 100.0,
            rotate: 0.0,
            content: outline.description.clone(),
            default_font_name: "Microsoft YaHei".to_string(),
            default_color: "#333333".to_string(),
        });
    }

    elements
}"""
content = content.replace(target_attach, '')

# And the fallback line
content = content.replace('    elements = attach_media_placeholders(elements, outline);\n', '')

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)

with open('crates/orchestrator/src/generation/slide.rs', 'r') as f:
    slide_content = f.read()

slide_content = slide_content.replace('            let elements = attach_media_placeholders(elements, outline);\n', '')

with open('crates/orchestrator/src/generation/slide.rs', 'w') as f:
    f.write(slide_content)
