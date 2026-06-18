import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """    let clamp = |value: f32, min: f32, max: f32| value.max(min).min(max);
    let normalize_box =
        |left: f32, top: f32, width: f32, height: f32| -> Option<(f32, f32, f32, f32)> {
            if width <= 0.0 || height <= 0.0 {
                return None;
            }
            Some((
                clamp(left, 40.0, 940.0),
                clamp(top, 40.0, 503.0),
                clamp(width, 40.0, 900.0),
                clamp(height, 24.0, 460.0),
            ))
        };"""

replacement = """    let normalize_box =
        |left: f32, top: f32, width: f32, height: f32| -> Option<(f32, f32, f32, f32)> {
            if width <= 0.0 || height <= 0.0 {
                return None;
            }
            Some((left, top, width, height))
        };"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find target!")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
