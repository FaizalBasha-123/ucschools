import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Fix Shape in map_slide_element
target_shape_map = """        "shape" => SlideElement::Shape { shadow: None, fixed_ratio: None, opacity: None, outline: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            shape_name: element.shape_name,
            fill: element.fill.unwrap_or_else(|| "#5b9bd5".to_string()),
            path: element.path.or_else(|| Some("M 0 0 L 200 0 L 200 200 L 0 200 Z".to_string())),
            view_box: element.view_box.or_else(|| Some(vec![200.0, 200.0])),
        },"""

replacement_shape_map = """        "shape" => SlideElement::Shape {
            shadow: element.shadow,
            fixed_ratio: element.fixed_ratio,
            opacity: element.opacity,
            outline: element.outline,
id,
            left,
            top,
            width,
            height,
            rotate,
            shape_name: element.shape_name,
            fill: element.fill.unwrap_or_else(|| "#5b9bd5".to_string()),
            path: element.path.or_else(|| Some("M 0 0 L 200 0 L 200 200 L 0 200 Z".to_string())),
            view_box: element.view_box.or_else(|| Some(vec![200.0, 200.0])),
        },"""
if target_shape_map in content:
    content = content.replace(target_shape_map, replacement_shape_map)
else:
    print("Could not find Shape map target")

# Fix Shape in normalize_slide_element
target_shape_norm = """        SlideElement::Shape {
id,
            left,
            top,
            width,
            height,
            rotate,
            shape_name,
            fill,
            path,
            view_box,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Shape { shadow: None, fixed_ratio: None, opacity: None, outline: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                shape_name,
                fill,
                path,
                view_box,
            }
        }),"""

replacement_shape_norm = """        SlideElement::Shape {
id,
            left,
            top,
            width,
            height,
            rotate,
            shape_name,
            fill,
            path,
            view_box,
            shadow,
            fixed_ratio,
            opacity,
            outline,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Shape {
                shadow,
                fixed_ratio,
                opacity,
                outline,
id,
                left,
                top,
                width,
                height,
                rotate,
                shape_name,
                fill,
                path,
                view_box,
            }
        }),"""
if target_shape_norm in content:
    content = content.replace(target_shape_norm, replacement_shape_norm)
else:
    print("Could not find Shape norm target")

# Fix Text in map_slide_element
target_text_map = """        "text" => SlideElement::Text { shadow: None, fill: None, outline: None, line_height: element.line_height, opacity: element.opacity, word_space: element.word_space, paragraph_space: element.paragraph_space, vertical: element.vertical,
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

replacement_text_map = """        "text" => SlideElement::Text {
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

if target_text_map in content:
    content = content.replace(target_text_map, replacement_text_map)
else:
    print("Could not find Text map target")

# Fix Text in normalize_slide_element
target_text_norm = """        SlideElement::Text { shadow: None, fill: None, outline: None, line_height, opacity, word_space, paragraph_space, vertical,
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

replacement_text_norm = """        SlideElement::Text { shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,
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
            SlideElement::Text { shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,
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

if target_text_norm in content:
    content = content.replace(target_text_norm, replacement_text_norm)
else:
    print("Could not find Text norm target")

# Fix Image in map_slide_element
target_image_map = """        "image" => SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
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
            flip_h: None,
            flip_v: None,
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
else:
    print("Could not find Image map target")

# Fix Image in normalize_slide_element
target_image_norm = """        SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            fixed_ratio,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
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

replacement_image_norm = """        SlideElement::Image { shadow, outline, flip_h, flip_v,
id,
            left,
            top,
            width,
            height,
            rotate,
            src,
            fixed_ratio,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Image { shadow, outline, flip_h, flip_v,
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
else:
    print("Could not find Image norm target")


with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
