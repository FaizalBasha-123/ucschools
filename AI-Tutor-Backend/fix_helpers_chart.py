with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# For map_slide_element
old_chart = '''        "chart" => SlideElement::Chart { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            chart_type: element.chart_type,
            data: element.data,
            theme_colors: element.theme_colors.or_else(|| Some(vec![
                "#5b9bd5".to_string(),
                "#ed7d31".to_string(),
                "#a5a5a5".to_string(),
                "#ffc000".to_string(),
                "#4472c4".to_string(),
            ])),
        },'''

new_chart = '''        "chart" => SlideElement::Chart { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            chart_type: element.chart_type,
            data: element.data,
            options: element.options,
            outline: element.outline,
            fill: element.fill,
            text_color: element.text_color,
            line_color: element.line_color,
            theme_colors: element.theme_colors.or_else(|| Some(vec![
                "#5b9bd5".to_string(),
                "#ed7d31".to_string(),
                "#a5a5a5".to_string(),
                "#ffc000".to_string(),
                "#4472c4".to_string(),
            ])),
        },'''

content = content.replace(old_chart, new_chart)

# For normalize_slide_element
old_norm = '''        SlideElement::Chart {
id,
            left,
            top,
            width,
            height,
            rotate,
            chart_type,
            data,
            theme_colors,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Chart { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                chart_type,
                data,
                theme_colors,
            }
        }),'''

new_norm = '''        SlideElement::Chart {
id,
            left,
            top,
            width,
            height,
            rotate,
            chart_type,
            data,
            options,
            outline,
            fill,
            text_color,
            line_color,
            theme_colors,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Chart { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                chart_type,
                data,
                options,
                outline,
                fill,
                text_color,
                line_color,
                theme_colors,
            }
        }),'''

content = content.replace(old_norm, new_norm)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
