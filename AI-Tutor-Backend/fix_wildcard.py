import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """        _ => SlideElement::Text { shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,
id,
            left,
            top,
            width,
            height,
            rotate,
            content: element.content.unwrap_or_default(),"""

replacement = """        _ => SlideElement::Text { shadow: element.shadow.clone(), fill: element.fill.clone(), outline: element.outline.clone(), line_height: element.line_height, opacity: element.opacity, word_space: element.word_space, paragraph_space: element.paragraph_space, vertical: element.vertical,
id,
            left,
            top,
            width,
            height,
            rotate,
            content: element.content.unwrap_or_default(),"""

if target in content:
    content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
