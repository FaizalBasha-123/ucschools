import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Replace SlideElement::Text { shadow: None,
content = content.replace('SlideElement::Text { shadow: None,', 'SlideElement::Text { shadow: None, fill: None, outline: None, line_height: None, opacity: None, word_space: None, paragraph_space: None, vertical: None,')

# Replace SlideElement::Image { shadow: None,
content = content.replace('SlideElement::Image { shadow: None,', 'SlideElement::Image { shadow: None, outline: None, opacity: None,')

# Replace SlideElement::Shape { shadow: None,
content = content.replace('SlideElement::Shape { shadow: None,', 'SlideElement::Shape { shadow: None, fixed_ratio: None, opacity: None, outline: None,')

# Replace SlideElement::Latex { shadow: None,
content = content.replace('SlideElement::Latex { shadow: None,', 'SlideElement::Latex { shadow: None, fixed_ratio: None, html: None, path: None, stroke_width: None, view_box: None,')

# Replace SlideElement::Table { shadow: None,
content = content.replace('SlideElement::Table { shadow: None,', 'SlideElement::Table { shadow: None, theme: None,')

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
