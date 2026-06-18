import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """    let id = element
        .id
        .unwrap_or_else(|| format!("element-{}", index + 1));"""
replacement = """    let id = format!("{}_{}", element.kind, uuid::Uuid::new_v4().to_string()[..8].to_string());"""

content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
