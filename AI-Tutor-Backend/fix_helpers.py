with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Fix text block
text_start = content.find('_ => SlideElement::Text')
text_end = content.find('},', text_start) + 2
text_str = content[text_start:text_end]

new_text_str = text_str.replace(
    'default_font_name: "Microsoft YaHei".to_string(),',
    '''default_font_name: {
                let f = element.default_font_name.unwrap_or_default();
                if f.trim().is_empty() { "Microsoft YaHei".to_string() } else { f }
            },'''
).replace(
    'default_color: "#333333".to_string(),',
    '''default_color: {
                let c = element.default_color.unwrap_or_default();
                if c.trim().is_empty() { "#333333".to_string() } else { c }
            },'''
)

content = content[:text_start] + new_text_str + content[text_end:]

# Fix shape block
shape_start = content.find('"shape" => SlideElement::Shape')
shape_end = content.find('},', shape_start) + 2
shape_str = content[shape_start:shape_end]

new_shape_str = shape_str.replace(
    'fill: element.fill.unwrap_or_else(|| "#5b9bd5".to_string()),',
    '''fill: {
                let f = element.fill.unwrap_or_default();
                if f.trim().is_empty() { "#5b9bd5".to_string() } else { f }
            },'''
)

content = content[:shape_start] + new_shape_str + content[shape_end:]

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
