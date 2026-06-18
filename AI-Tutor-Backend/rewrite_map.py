import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

new_map = """pub(crate) fn map_slide_element(element: SlideElementDto, _index: usize) -> SlideElement {
    let kind_str = element.kind.as_str();
    let random_chars: String = uuid::Uuid::new_v4().to_string().chars().take(8).collect();
    let id = format!("{}_{}", kind_str, random_chars);
    let rotate = 0.0; // OpenMAIC forces rotate: 0 for all elements
    let left = element.left;
    let top = element.top;
    let width = element.width;
    let height = element.height;

    match element.kind.trim().to_ascii_lowercase().as_str() {
        "image" => SlideElement::Image { 
            shadow: element.shadow, 
            outline: element.outline, 
            opacity: element.opacity,
            id, left, top, width, height, rotate,
            src: element.src.unwrap_or_default(),
            fixed_ratio: true,
        },
        "video" => SlideElement::Video { 
            shadow: element.shadow,
            id, left, top, width, height, rotate,
            src: element.src.unwrap_or_default(),
        },
        "shape" => SlideElement::Shape { 
            shadow: element.shadow, 
            fixed_ratio: element.fixed_ratio, 
            opacity: element.opacity, 
            outline: element.outline,
            id, left, top, width, height, rotate,
            shape_name: element.shape_name,
            fill: element.fill.unwrap_or_else(|| "#5b9bd5".to_string()),
            path: element.path.or_else(|| Some(format!("M0 0 L{} 0 L{} {} L0 {} Z", width, width, height, height))),
            view_box: element.view_box.or_else(|| Some(vec![0.0, 0.0, width, height])),
        },
        "line" => SlideElement::Line { 
            shadow: element.shadow,
            id, left, top, width, height, rotate,
            start: element.start.or_else(|| Some(vec![left, top])),
            end: element.end.or_else(|| Some(vec![left + width, top + height])),
            style: element.style.or_else(|| Some("solid".to_string())),
            color: element.color.or_else(|| Some("#333333".to_string())),
            points: if element.points.as_ref().map(|p| p.len() == 2).unwrap_or(false) {
                element.points
            } else {
                Some(vec![vec![0.0, 0.0], vec![100.0, 100.0]])
            },
            broken: element.broken,
            broken2: element.broken2,
            curve: element.curve,
            cubic: element.cubic,
        },
        "chart" => SlideElement::Chart { 
            shadow: element.shadow,
            id, left, top, width, height, rotate,
            chart_type: element.chart_type,
            data: element.data,
            theme_colors: element.theme_colors.or_else(|| Some(vec!["#5b9bd5".to_string(), "#ed7d31".to_string(), "#a5a5a5".to_string(), "#ffc000".to_string(), "#4472c4".to_string(), "#70ad47".to_string()])),
            options: element.options,
            outline: element.outline,
            fill: element.fill,
            text_color: element.text_color,
            line_color: element.line_color,
        },
        "latex" => {
            let latex_str = element.latex.unwrap_or_default();
            let html = if let Ok(opts) = katex::Opts::builder()
                .display_mode(true)
                .output_type(katex::OutputType::Html)
                .build() 
            {
                katex::render_with_opts(&latex_str, opts).ok()
            } else {
                None
            };
            
            SlideElement::Latex { 
                shadow: element.shadow, 
                fixed_ratio: Some(true), 
                html, 
                path: element.path, 
                stroke_width: element.stroke_width, 
                view_box: element.view_box,
                id, left, top, width, height, rotate,
                latex: latex_str,
                color: element.color,
                align: element.align,
            }
        },
        "table" => SlideElement::Table { 
            shadow: element.shadow, 
            theme: element.theme,
            id, left, top, width, height, rotate,
            col_widths: element.col_widths.unwrap_or_else(|| vec![100.0]),
            data: element.data,
            outline: element.outline,
        },
        _ => SlideElement::Text {
            shadow: element.shadow, 
            fill: element.fill, 
            outline: element.outline, 
            line_height: element.line_height, 
            opacity: element.opacity, 
            word_space: element.word_space, 
            paragraph_space: element.paragraph_space, 
            vertical: element.vertical,
            id, left, top, width, height, rotate,
            content: element.content.unwrap_or_default(),
            default_font_name: element.default_font_name,
            default_color: element.default_color,
        },
    }
}"""

pattern = re.compile(r"pub\(crate\) fn map_slide_element\(.*?\).*?^}", re.MULTILINE | re.DOTALL)
content = pattern.sub(new_map, content, count=1)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
