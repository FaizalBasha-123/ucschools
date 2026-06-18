import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """            content: element.content.unwrap_or_default(),
            default_font_name: element.default_font_name.unwrap_or_else(|| "Microsoft YaHei".to_string()),
            default_color: element.default_color.unwrap_or_else(|| "#333333".to_string()),"""

replacement = """            content: element.content.unwrap_or_default(),
            default_font_name: {
                let f = element.default_font_name.unwrap_or_default();
                if f.trim().is_empty() { "Microsoft YaHei".to_string() } else { f }
            },
            default_color: {
                let c = element.default_color.unwrap_or_default();
                if c.trim().is_empty() { "#333333".to_string() } else { c }
            },"""

content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
