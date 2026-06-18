import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """            default_color,
            .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {"""

replacement = """            default_color,
            shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,
            .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find Text norm target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
