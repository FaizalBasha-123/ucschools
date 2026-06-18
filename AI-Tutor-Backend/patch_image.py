import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """        "image" => SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            fixed_ratio: element.fixed_ratio,
        },"""

replacement = """        "image" => SlideElement::Image { shadow: None, outline: None, flip_h: None, flip_v: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            fixed_ratio: element.fixed_ratio.or(Some(true)),
        },"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find Image target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
