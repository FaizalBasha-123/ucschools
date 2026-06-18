import re

with open('crates/domain/src/scene.rs', 'r') as f:
    content = f.read()

target = """    Image {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        #[serde(default)]
        rotate: f32,
        src: String,
        #[serde(default)]
        autoplay: bool,"""

replacement = """    Image {
        id: String,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        #[serde(default)]
        rotate: f32,
        src: String,"""

if target in content:
    content = content.replace(target, replacement)
else:
    print("Could not find Image target")

with open('crates/domain/src/scene.rs', 'w') as f:
    f.write(content)
