import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """        SlideElement::Latex {
id,
            left,
            top,
            width,
            height,
            rotate,
            latex,
            color,
            align,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Latex { shadow: None, fixed_ratio: None, html: None, path: None, stroke_width: None, view_box: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                latex,
                color,
                align,
            }
        }),"""

replacement = """        SlideElement::Latex {
id,
            left,
            top,
            width,
            height,
            rotate,
            latex,
            color,
            align,
            html,
            fixed_ratio,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Latex { shadow: None, fixed_ratio, html, path: None, stroke_width: None, view_box: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                latex,
                color,
                align,
            }
        }),"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find Latex target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
