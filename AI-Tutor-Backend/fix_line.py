import re

# 1. Fix domain/scene.rs
with open('crates/domain/src/scene.rs', 'r') as f:
    content = f.read()

content = content.replace(
    'pub(crate) points: Option<Vec<String>>',
    'pub(crate) points: Option<Vec<Vec<f32>>>'
).replace(
    'points: Option<Vec<String>>,',
    'points: Option<Vec<Vec<f32>>>,'
)

with open('crates/domain/src/scene.rs', 'w') as f:
    f.write(content)

# 2. Fix dtos.rs
with open('crates/orchestrator/src/generation/dtos.rs', 'r') as f:
    content = f.read()

content = content.replace(
    'pub(crate) points: Option<Vec<String>>',
    'pub(crate) points: Option<Vec<Vec<f32>>>'
)

with open('crates/orchestrator/src/generation/dtos.rs', 'w') as f:
    f.write(content)

# 3. Fix helpers.rs
with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Replace the points logic
old_points_logic = '''            points: if element.points.as_ref().map(|p| p.len() == 2).unwrap_or(false) {
                element.points
            } else {
                Some(vec!["".to_string(), "".to_string()])
            },'''

# Build new logic using start and end
new_points_logic = '''            points: element.points.or_else(|| {
                let s = element.start.clone().unwrap_or_else(|| vec![left, top]);
                let e = element.end.clone().unwrap_or_else(|| vec![left + width, top + height]);
                Some(vec![s, e])
            }),'''

content = content.replace(old_points_logic, new_points_logic)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
