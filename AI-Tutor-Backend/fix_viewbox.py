import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """            view_box: element.view_box.or_else(|| Some(vec![200.0, 200.0])),"""
replacement = """            view_box: Some(
                element.view_box
                    .map(|v| if v.len() >= 2 { format!("0 0 {} {}", v[0], v[1]) } else { format!("0 0 {} {}", width, height) })
                    .unwrap_or_else(|| format!("0 0 {} {}", width, height))
            ),"""

content = content.replace(target, replacement)

# Fix Latex viewBox mapping
target_latex_viewbox = """            view_box: element.view_box,"""
replacement_latex_viewbox = """            view_box: element.view_box.map(|v| if v.len() >= 2 { format!("0 0 {} {}", v[0], v[1]) } else { format!("0 0 {} {}", width, height) }),"""

content = content.replace(target_latex_viewbox, replacement_latex_viewbox)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
