with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# In map_slide_element for "line"
content = content.replace(
    '"line" => SlideElement::Line { shadow: None,',
    '"line" => SlideElement::Line { shadow: element.shadow.clone(),'
)
# In map_slide_element for "latex"
content = content.replace(
    'SlideElement::Latex { shadow: None, fixed_ratio: Some(true), html, path: None, stroke_width: None, view_box: None,',
    'SlideElement::Latex { shadow: element.shadow.clone(), fixed_ratio: Some(true), html, path: None, stroke_width: None, view_box: None,'
)

# In normalize_box for Line
content = content.replace(
    'SlideElement::Line {\n            id,\n            left,\n            top,\n            width,\n            height,\n            rotate,\n            start,\n            end,\n            style,\n            color,\n            points,\n            broken,\n            broken2,\n            curve,\n            cubic,\n            .. \n        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {\n            SlideElement::Line { shadow: None,',
    'SlideElement::Line {\n            id,\n            left,\n            top,\n            width,\n            height,\n            rotate,\n            start,\n            end,\n            style,\n            color,\n            points,\n            broken,\n            broken2,\n            curve,\n            cubic,\n            shadow,\n        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {\n            SlideElement::Line { shadow: shadow.clone(),'
)

# In normalize_box for Latex
content = content.replace(
    'SlideElement::Latex {\n            id,\n            left,\n            top,\n            width,\n            height,\n            rotate,\n            latex,\n            color,\n            align,\n            html,\n            fixed_ratio,\n            .. \n        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {\n            SlideElement::Latex { shadow: None,',
    'SlideElement::Latex {\n            id,\n            left,\n            top,\n            width,\n            height,\n            rotate,\n            latex,\n            color,\n            align,\n            html,\n            fixed_ratio,\n            shadow,\n            .. \n        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {\n            SlideElement::Latex { shadow: shadow.clone(),'
)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
