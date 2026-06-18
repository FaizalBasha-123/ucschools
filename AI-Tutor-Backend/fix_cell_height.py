import re

# domain/src/scene.rs
with open('crates/domain/src/scene.rs', 'r') as f:
    content = f.read()

target_table = """        #[serde(default, rename = "colWidths", skip_serializing_if = "Option::is_none")]
        col_widths: Option<Vec<f32>>,"""
replacement_table = """        #[serde(default, rename = "colWidths", skip_serializing_if = "Option::is_none")]
        col_widths: Option<Vec<f32>>,
        #[serde(default, rename = "cellMinHeight", skip_serializing_if = "Option::is_none")]
        cell_min_height: Option<f32>,"""
content = content.replace(target_table, replacement_table)

target_video = """        #[serde(default)]
        rotate: f32,
        src: String,"""
replacement_video = """        #[serde(default)]
        rotate: f32,
        src: String,
        #[serde(default)]
        autoplay: bool,"""
content = content.replace(target_video, replacement_video)

with open('crates/domain/src/scene.rs', 'w') as f:
    f.write(content)

# orchestrator/src/generation/dtos.rs
with open('crates/orchestrator/src/generation/dtos.rs', 'r') as f:
    content = f.read()

target_dto = """    #[serde(default, alias = "colWidths")]
    pub(crate) col_widths: Option<Vec<f32>>,"""
replacement_dto = """    #[serde(default, alias = "colWidths")]
    pub(crate) col_widths: Option<Vec<f32>>,
    #[serde(default, alias = "cellMinHeight")]
    pub(crate) cell_min_height: Option<f32>,
    #[serde(default)]
    pub(crate) autoplay: Option<bool>,"""
content = content.replace(target_dto, replacement_dto)

with open('crates/orchestrator/src/generation/dtos.rs', 'w') as f:
    f.write(content)

# orchestrator/src/generation/helpers.rs
with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target_table_map = """        "table" => SlideElement::Table { shadow: element.shadow.clone(),
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths: element.col_widths,"""
replacement_table_map = """        "table" => SlideElement::Table { shadow: element.shadow.clone(),
id,
            left,
            top,
            width,
            height,
            rotate,
            col_widths: element.col_widths,
            cell_min_height: element.cell_min_height.or(Some(36.0)),"""
content = content.replace(target_table_map, replacement_table_map)

target_table_norm = """        SlideElement::Table {
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
            shadow,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Table { shadow,
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
            }
        }),"""
replacement_table_norm = """        SlideElement::Table {
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
            shadow,
            cell_min_height,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Table { shadow,
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
                cell_min_height,
            }
        }),"""
content = content.replace(target_table_norm, replacement_table_norm)

target_video_map = """        "video" => SlideElement::Video { shadow: element.shadow.clone(),
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            poster: element.poster,
        },"""
replacement_video_map = """        "video" => SlideElement::Video { shadow: element.shadow.clone(),
id,
            left,
            top,
            width,
            height,
            rotate,
            src: element.src.unwrap_or_default(),
            poster: element.poster,
            autoplay: element.autoplay.unwrap_or(false),
        },"""
content = content.replace(target_video_map, replacement_video_map)

target_video_norm = """        SlideElement::Video { shadow,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
                poster,
            }"""
replacement_video_norm = """        SlideElement::Video { shadow,
id,
                left,
                top,
                width,
                height,
                rotate,
                src,
                poster,
                autoplay: false,
            }"""
# Note: we need to match carefully for video norm.
# Actually video norm doesn't have autoplay matching. Let's do it right:
content = re.sub(
    r'SlideElement::Video \{\s*id,\s*left,\s*top,\s*width,\s*height,\s*rotate,\s*src,\s*poster,\s*shadow,\s*\.\.\s*\}\s*=>\s*normalize_box\(left, top, width, height\)\.map\(\|\(left, top, width, height\)\|\s*\{\s*SlideElement::Video \{\s*shadow,\s*id,\s*left,\s*top,\s*width,\s*height,\s*rotate,\s*src,\s*poster,\s*\}\s*\}\),',
    r'SlideElement::Video { id, left, top, width, height, rotate, src, poster, shadow, autoplay, .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| { SlideElement::Video { shadow, id, left, top, width, height, rotate, src, poster, autoplay, } }),',
    content
)


with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
