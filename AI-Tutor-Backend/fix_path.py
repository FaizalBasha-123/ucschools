import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """            path: element.path.or_else(|| Some("M 0 0 L 200 0 L 200 200 L 0 200 Z".to_string())),"""
replacement = """            path: element.path.or_else(|| Some(format!("M 0 0 L {} 0 L {} {} L 0 {} Z", width, width, height, height))),"""

content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
