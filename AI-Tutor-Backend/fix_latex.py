with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

old_latex = '''        "latex" => SlideElement::Latex { shadow: None, fixed_ratio: None, html: None, path: None, stroke_width: None, view_box: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            latex: element.latex.unwrap_or_default(),
            color: element.color.unwrap_or_else(|| "#333333".to_string()),
            align: element.align,
        },'''

new_latex = '''        "latex" => {
            let latex_str = element.latex.unwrap_or_default();
            let html = katex::Opts::builder()
                .display_mode(true)
                .throw_on_error(false)
                .output_type(katex::OutputType::Html)
                .build()
                .ok()
                .and_then(|opts| katex::render_with_opts(&latex_str, opts).ok());

            SlideElement::Latex { shadow: None, fixed_ratio: Some(true), html, path: None, stroke_width: None, view_box: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                latex: latex_str,
                color: element.color.unwrap_or_else(|| "#333333".to_string()),
                align: element.align,
            }
        },'''

content = content.replace(old_latex, new_latex)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
