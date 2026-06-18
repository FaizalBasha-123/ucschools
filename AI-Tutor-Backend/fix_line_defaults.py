import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """            style: element.style.or_else(|| Some("solid".to_string())),
            color: element.color.or_else(|| Some("#333333".to_string())),"""

replacement = """            style: Some({
                let s = element.style.unwrap_or_default();
                if s.trim().is_empty() { "solid".to_string() } else { s }
            }),
            color: Some({
                let c = element.color.unwrap_or_default();
                if c.trim().is_empty() { "#333333".to_string() } else { c }
            }),"""

content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
