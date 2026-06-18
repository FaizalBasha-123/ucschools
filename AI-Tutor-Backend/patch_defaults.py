import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Fix Chart mapping
target_chart = """        "chart" => SlideElement::Chart { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            chart_type: element.chart_type,
            data: element.data,
            theme_colors: element.theme_colors,
        },"""

replacement_chart = """        "chart" => SlideElement::Chart { shadow: None,
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
        },"""

if target_chart in content:
    content = content.replace(target_chart, replacement_chart)
else:
    print("Could not find chart target")

# Fix Table mapping
target_table = """        "table" => SlideElement::Table { shadow: None, theme: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths: element.col_widths,
            data: element.data,
            outline: element.outline,
        },"""

replacement_table = """        "table" => SlideElement::Table { shadow: None,
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths: element.col_widths,
            data: element.data,
            outline: element.outline,
            theme: element.theme.or_else(|| Some(serde_json::json!({
                "color": "#5b9bd5",
                "rowHeader": true,
                "rowFooter": false,
                "colHeader": false,
                "colFooter": false,
            }))),
        },"""

if target_table in content:
    content = content.replace(target_table, replacement_table)
else:
    print("Could not find table target")


# Since we updated Table to have theme dynamically mapped, we also need to update the normalize_slide_element mapping for table
target_table_norm = """        SlideElement::Table { shadow: None, theme: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                col_widths,
                data,
                outline,
            }"""

replacement_table_norm = """        SlideElement::Table { shadow: None,
id,
                left,
                top,
                width,
                height,
                rotate,
                col_widths,
                data,
                outline,
                theme,
            }"""

if target_table_norm in content:
    content = content.replace(target_table_norm, replacement_table_norm)

# Update the match condition to extract theme
target_table_match = """        SlideElement::Table {
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths,
            data,
            outline,
            .. 
        } =>"""

replacement_table_match = """        SlideElement::Table {
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths,
            data,
            outline,
            theme,
            .. 
        } =>"""

if target_table_match in content:
    content = content.replace(target_table_match, replacement_table_match)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
