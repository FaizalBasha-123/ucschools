import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = "outline: element.outline,"
replacement = """outline: element.outline.or_else(|| Some(serde_json::json!({
                "width": 2,
                "color": "#000000",
                "style": "solid"
            }))),"""

# We only want to replace this in the 'table' match arm
table_start = content.find('"table" => SlideElement::Table')
table_end = content.find('},', table_start)

table_str = content[table_start:table_end]
new_table_str = table_str.replace("outline: element.outline,", replacement)

content = content[:table_start] + new_table_str + content[table_end:]

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
