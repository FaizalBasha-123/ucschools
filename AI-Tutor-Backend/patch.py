import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# 1. Remove attach_media_placeholders from slide.rs
with open('crates/orchestrator/src/generation/slide.rs', 'r') as f:
    slide_content = f.read()

slide_content = slide_content.replace('            let elements = attach_media_placeholders(elements, outline);\n', '')

with open('crates/orchestrator/src/generation/slide.rs', 'w') as f:
    f.write(slide_content)

# 2. Fix validate_slide_elements in helpers.rs
# Find the start of the if !normalized block
pattern = re.compile(r'    if !normalized\n\s*\.iter\(\)\n\s*\.any\(\|element\| matches!\(element, SlideElement::Text \{[^}]+\}\s*if content\.contains\(&outline\.title\)\)\)\n\s*\{[^}]+\}\s*\);\s*\}\n\n', re.MULTILINE)

content = pattern.sub('', content)

# 3. Fix attach_media_placeholders usage in fallback_slide_elements
content = content.replace('    elements = attach_media_placeholders(elements, outline);\n', '')

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
