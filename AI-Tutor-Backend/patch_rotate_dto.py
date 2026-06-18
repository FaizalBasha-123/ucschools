import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """    let height = element.height;

    match element.kind.trim().to_ascii_lowercase().as_str() {"""

replacement = """    let height = element.height;
    let rotate = 0.0;

    match element.kind.trim().to_ascii_lowercase().as_str() {"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
