with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Fix shape block path and view_box defaults
shape_start = content.find('"shape" => SlideElement::Shape')
shape_end = content.find('},', shape_start) + 2
shape_str = content[shape_start:shape_end]

new_shape_str = shape_str.replace(
    'path: element.path.or_else(|| Some(format!("M 0 0 L {} 0 L {} {} L 0 {} Z", width, width, height, height))),',
    'path: element.path.or_else(|| Some("M 0 0 L 1 0 L 1 1 L 0 1 Z".to_string())),'
).replace(
    '''view_box: Some(
                element.view_box
                    .map(|v| if v.len() >= 2 { vec![v[0], v[1]] } else { vec![width, height] })
                    .unwrap_or_else(|| vec![width, height])
            ),''',
    '''view_box: Some(
                element.view_box
                    .map(|v| if v.len() >= 2 { vec![v[0], v[1]] } else { vec![1.0, 1.0] })
                    .unwrap_or_else(|| vec![1.0, 1.0])
            ),'''
)

content = content[:shape_start] + new_shape_str + content[shape_end:]

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
