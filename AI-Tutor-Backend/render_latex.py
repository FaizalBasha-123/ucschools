import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = """        "latex" => SlideElement::Latex { shadow: None, fixed_ratio: None, html: None, path: None, stroke_width: None, view_box: None,"""

replacement = """        "latex" => {
            let latex_str = element.latex.unwrap_or_default();
            let html = if !latex_str.is_empty() {
                let opts = katex::Opts::builder().display_mode(true).build().unwrap_or_default();
                katex::render_with_opts(&latex_str, opts).ok()
            } else {
                None
            };
            
            SlideElement::Latex { shadow: None, fixed_ratio: Some(true), html, path: None, stroke_width: None, view_box: None,
                latex: latex_str,"""

# Since we unwrapped `latex` earlier now, we need to remove the inline unwrap below
target_full = """        "latex" => SlideElement::Latex { shadow: None, fixed_ratio: None, html: None, path: None, stroke_width: None, view_box: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            latex: element.latex.unwrap_or_default(),"""

replacement_full = """        "latex" => {
            let latex_str = element.latex.unwrap_or_default();
            let html = if !latex_str.is_empty() {
                let opts = katex::Opts::builder().display_mode(true).build().unwrap_or_default();
                katex::render_with_opts(&latex_str, opts).ok()
            } else {
                None
            };
            SlideElement::Latex { shadow: None, fixed_ratio: Some(true), html, path: None, stroke_width: None, view_box: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            latex: latex_str,"""

if target_full in content:
    content = content.replace(target_full, replacement_full)
    content = content.replace("            align: element.align,\n        },", "            align: element.align,\n        }\n        },")
else:
    print("Failed to find target block")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
