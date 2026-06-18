import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """    elements.retain(|element| {
        match element {
            SlideElement::Image { src, .. } | SlideElement::Video { src, .. } => !src.trim().is_empty(),
            _ => true,
        }
    });"""

replacement = """    elements.retain(|element| {
        match element {
            SlideElement::Image { src, .. } | SlideElement::Video { src, .. } => !src.trim().is_empty(),
            SlideElement::Latex { latex, .. } => !latex.trim().is_empty(),
            _ => true,
        }
    });"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
