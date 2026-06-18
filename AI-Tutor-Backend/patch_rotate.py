import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Instead of changing map_slide_element which just reads the struct, we change normalize_slide_element to emit rotate: 0.0
# The match arms in normalize_slide_element look like:
# SlideElement::Text { id, left, top, width, height, rotate, content, ... } => Some(SlideElement::Text { id, left, top, width, height, rotate, content, ... })
# We can just use a regex to replace `rotate,` with `rotate: 0.0,` inside the Some(...) part of normalize_slide_element.

target = """        SlideElement::Text { shadow: None, fill: None, outline: None, line_height, opacity, word_space, paragraph_space, vertical,
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

replacement = """        SlideElement::Text { shadow: None, fill: None, outline: None, line_height, opacity, word_space, paragraph_space, vertical,
id,
            left,
            top,
            width,
            height,
            rotate: _,
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
                rotate: 0.0,
                content,
                default_font_name,
                default_color,
            }
        }),"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find Text target")

# Now do Image
target_image = """        SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
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

replacement_image = """        SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
id,
            left,
            top,
            width,
            height,
            rotate: _,
            src,
            fixed_ratio,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
id,
                left,
                top,
                width,
                height,
                rotate: 0.0,
                src,
                fixed_ratio,
            }
        }),"""

if target_image in content:
    content = content.replace(target_image, replacement_image)
else:
    print("Could not find Image target")

# Now Shape
target_shape = """        SlideElement::Shape { shadow: None, fixed_ratio: None, opacity: None, outline: None,
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

replacement_shape = """        SlideElement::Shape { shadow: None, fixed_ratio: None, opacity: None, outline: None,
id,
            left,
            top,
            width,
            height,
            rotate: _,
            shape_name,
            fill,
            path,
            view_box,
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Shape { shadow: None, fixed_ratio: None, opacity: None, outline: None,
id,
                left,
                top,
                width,
                height,
                rotate: 0.0,
                shape_name,
                fill,
                path,
                view_box,
            }
        }),"""

if target_shape in content:
    content = content.replace(target_shape, replacement_shape)
else:
    print("Could not find Shape target")


with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
