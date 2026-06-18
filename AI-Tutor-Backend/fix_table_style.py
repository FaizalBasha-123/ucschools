import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """        "table" => SlideElement::Table { shadow: None,"""

replacement = """        "table" => SlideElement::Table { shadow: element.shadow.clone(),"""

if target in content:
    content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
