import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """pub(crate) fn repair_media_elements(
    mut elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    for element in &mut elements {
        match element {
            SlideElement::Image {
src, width, height, .. } => {
                let mut known_ratio: Option<f32> = None;
                
                if src.trim().is_empty() {
                    if let Some(media) = outline
                        .media_generations
                        .iter()
                        .find(|media| matches!(media.media_type, MediaType::Image))
                    {
                        *src = media.element_id.clone();
                        known_ratio = parse_aspect_ratio_str(media.aspect_ratio.as_deref());
                    }
                } else {
                    if let Some(media) = outline
                        .media_generations
                        .iter()
                        .find(|media| media.element_id == *src)
                    {
                        known_ratio = parse_aspect_ratio_str(media.aspect_ratio.as_deref());
                    }
                }"""

replacement = """pub(crate) fn repair_media_elements(
    mut elements: Vec<SlideElement>,
    outline: &SceneOutline,
) -> Vec<SlideElement> {
    elements.retain(|element| {
        match element {
            SlideElement::Image { src, .. } | SlideElement::Video { src, .. } => !src.trim().is_empty(),
            _ => true,
        }
    });

    for element in &mut elements {
        match element {
            SlideElement::Image {
src, width, height, .. } => {
                let mut known_ratio: Option<f32> = None;
                
                if let Some(media) = outline
                    .media_generations
                    .iter()
                    .find(|media| media.element_id == *src)
                {
                    known_ratio = parse_aspect_ratio_str(media.aspect_ratio.as_deref());
                }"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find first target")

target2 = """            }
            SlideElement::Video {
src, .. } => {
                if src.trim().is_empty() {
                    if let Some(media) = outline
                        .media_generations
                        .iter()
                        .find(|media| matches!(media.media_type, MediaType::Video))
                    {
                        *src = media.element_id.clone();
                    }
                }
            }
            _ => {}
        }
    }

    elements
}"""

replacement2 = """            }
            _ => {}
        }
    }

    elements
}"""

if target2 in content:
    content = content.replace(target2, replacement2)
else:
    print("Could not find second target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
