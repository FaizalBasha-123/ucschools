import re

with open('crates/orchestrator/src/generation/dtos.rs', 'r') as f:
    content = f.read()

# Replace specifically in SlideElementDto
target = 'pub(crate) struct SlideElementDto {'
end = 'pub(crate) struct SlideBackgroundDto {'
start_idx = content.find(target)
end_idx = content.find(end)

if start_idx != -1 and end_idx != -1:
    section = content[start_idx:end_idx]
    new_section = section.replace(
        'pub(crate) data: Option<serde_json::Value>,',
        'pub(crate) data: Option<serde_json::Value>,\n    pub(crate) options: Option<serde_json::Value>,\n    #[serde(default, alias = "textColor")]\n    pub(crate) text_color: Option<String>,\n    #[serde(default, alias = "lineColor")]\n    pub(crate) line_color: Option<String>,'
    )
    content = content[:start_idx] + new_section + content[end_idx:]

with open('crates/orchestrator/src/generation/dtos.rs', 'w') as f:
    f.write(content)
