import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target_image_map = """        "image" => SlideElement::Image { shadow: None, outline: None, opacity: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            fixed_ratio: true,
        },"""

replacement_image_map = """        "image" => SlideElement::Image {
            shadow: element.shadow,
            outline: element.outline,
            opacity: element.opacity,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            fixed_ratio: element.fixed_ratio.unwrap_or(true),
        },"""

if target_image_map in content:
    content = content.replace(target_image_map, replacement_image_map)

target_image_norm = """        SlideElement::Image {
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            fixed_ratio,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Image { shadow: None, outline: None, opacity: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
                fixed_ratio,
            }
        }),"""

replacement_image_norm = """        SlideElement::Image {
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            fixed_ratio,
            shadow,
            outline,
            opacity,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Image { shadow, outline, opacity,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
                fixed_ratio,
            }
        }),"""

if target_image_norm in content:
    content = content.replace(target_image_norm, replacement_image_norm)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
