import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """            view_box: Some(
                element.view_box
                    .map(|v| if v.len() >= 2 { format!("0 0 {} {}", v[0], v[1]) } else { format!("0 0 {} {}", width, height) })
                    .unwrap_or_else(|| format!("0 0 {} {}", width, height))
            ),"""

replacement = """            view_box: Some(
                element.view_box
                    .map(|v| if v.len() >= 2 { vec![v[0], v[1]] } else { vec![width, height] })
                    .unwrap_or_else(|| vec![width, height])
            ),"""

content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
