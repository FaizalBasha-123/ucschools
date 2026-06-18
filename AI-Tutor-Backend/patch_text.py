import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target_map = """        "text" => SlideElement::Text { shadow: None, fill: None, outline: None, line_height: element.line_height, opacity: element.opacity, word_space: element.word_space, paragraph_space: element.paragraph_space, vertical: element.vertical,
id,
            left,
            top,
            width,
            height,
            rotate,
            content: element.content.unwrap_or_default(),
            default_font_name: element.default_font_name.unwrap_or_else(|| "Microsoft YaHei".to_string()),
            default_color: element.default_color.unwrap_or_else(|| "#333333".to_string()),
        },"""

replacement_map = """        "text" => SlideElement::Text {
            shadow: element.shadow,
            fill: element.fill,
            outline: element.outline,
            line_height: element.line_height,
            opacity: element.opacity,
            word_space: element.word_space,
            paragraph_space: element.paragraph_space,
            vertical: element.vertical,
id,
            left,
            top,
            width,
            height,
            rotate,
            content: element.content.unwrap_or_default(),
            default_font_name: element.default_font_name.unwrap_or_else(|| "Microsoft YaHei".to_string()),
            default_color: element.default_color.unwrap_or_else(|| "#333333".to_string()),
        },"""

if target_map in content:
    content = content.replace(target_map, replacement_map)

target_norm = """        SlideElement::Text { shadow: None, fill: None, outline: None, line_height, opacity, word_space, paragraph_space, vertical,
id,
            left,
            top,
            width,
            height,
            rotate,
            content,
            default_font_name,
            default_color,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Text { shadow: None, fill: None, outline: None, line_height, opacity, word_space, paragraph_space, vertical,
id,
                left,
                top,
                width,
                height,
                rotate,
                content,
                default_font_name,
                default_color,
            }
        }),"""

replacement_norm = """        SlideElement::Text {
id,
            left,
            top,
            width,
            height,
            rotate,
            content,
            default_font_name,
            default_color,
            shadow,
            fill,
            outline,
            line_height,
            opacity,
            word_space,
            paragraph_space,
            vertical,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Text {
                shadow,
                fill,
                outline,
                line_height,
                opacity,
                word_space,
                paragraph_space,
                vertical,
id,
                left,
                top,
                width,
                height,
                rotate,
                content,
                default_font_name,
                default_color,
            }
        }),"""

if target_norm in content:
    content = content.replace(target_norm, replacement_norm)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
