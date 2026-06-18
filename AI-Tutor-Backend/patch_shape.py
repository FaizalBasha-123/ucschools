import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """            path: element.path.or_else(|| Some(format!("M0 0 L{} 0 L{} {} L0 {} Z", width, width, height, height))),
            view_box: element.view_box.or_else(|| Some(vec![0.0, 0.0, width, height])),"""

replacement = """            path: element.path.or_else(|| Some("M 0 0 L 200 0 L 200 200 L 0 200 Z".to_string())),
            view_box: element.view_box.or_else(|| Some(vec![200.0, 200.0])),"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find Shape target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
