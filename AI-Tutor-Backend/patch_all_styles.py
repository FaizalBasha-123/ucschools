import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Fix text mapping
content = re.sub(
    r'"text"\s*=>\s*SlideElement::Text\s*\{\s*shadow:\s*None,\s*fill:\s*None,\s*outline:\s*None,\s*line_height:\s*None,\s*opacity:\s*None,\s*word_space:\s*None,\s*paragraph_space:\s*None,\s*vertical:\s*None,',
    r'"text" => SlideElement::Text { shadow: element.shadow.clone(), fill: element.fill.clone(), outline: element.outline.clone(), line_height: element.line_height, opacity: element.opacity, word_space: element.word_space, paragraph_space: element.paragraph_space, vertical: element.vertical,',
    content
)

# Fix map text norm
content = re.sub(
    r'SlideElement::Text\s*\{\s*shadow:\s*None,\s*fill:\s*None,\s*outline:\s*None,\s*line_height:\s*None,\s*opacity:\s*None,\s*word_space:\s*None,\s*paragraph_space:\s*None,\s*vertical:\s*None,',
    r'SlideElement::Text { shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,',
    content
)

# Fix text match arms norm (to include fields)
content = re.sub(
    r'SlideElement::Text\s*\{\s*id,(\s*)left,(\s*)top,(\s*)width,(\s*)height,(\s*)rotate,(\s*)content,(\s*)default_font_name,(\s*)default_color,\s*\}\s*=>',
    r'SlideElement::Text { id,\g<1>left,\g<2>top,\g<3>width,\g<4>height,\g<5>rotate,\g<6>content,\g<7>default_font_name,\g<8>default_color, shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical, .. } =>',
    content
)

# Fix image mapping
content = re.sub(
    r'"image"\s*=>\s*SlideElement::Image\s*\{\s*shadow:\s*None,\s*outline:\s*None,\s*opacity:\s*None,',
    r'"image" => SlideElement::Image { shadow: element.shadow.clone(), outline: element.outline.clone(), opacity: element.opacity,',
    content
)

# Fix video mapping
content = re.sub(
    r'"video"\s*=>\s*SlideElement::Video\s*\{\s*shadow:\s*None,',
    r'"video" => SlideElement::Video { shadow: element.shadow.clone(),',
    content
)

# Fix shape mapping
content = re.sub(
    r'"shape"\s*=>\s*SlideElement::Shape\s*\{\s*shadow:\s*None,\s*fixed_ratio:\s*None,\s*opacity:\s*None,\s*outline:\s*None,',
    r'"shape" => SlideElement::Shape { shadow: element.shadow.clone(), fixed_ratio: element.fixed_ratio, opacity: element.opacity, outline: element.outline.clone(),',
    content
)


with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
