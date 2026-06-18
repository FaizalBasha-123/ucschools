import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target_vid_map = """        "video" => SlideElement::Video { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            poster: element.poster,
        },"""

replacement_vid_map = """        "video" => SlideElement::Video {
            shadow: element.shadow,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            poster: element.poster,
        },"""

if target_vid_map in content:
    content = content.replace(target_vid_map, replacement_vid_map)

target_vid_norm = """        SlideElement::Video {
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            poster,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Video { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
                poster,
            }
        }),"""

replacement_vid_norm = """        SlideElement::Video {
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            poster,
            shadow,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Video { shadow,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
                poster,
            }
        }),"""

if target_vid_norm in content:
    content = content.replace(target_vid_norm, replacement_vid_norm)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
