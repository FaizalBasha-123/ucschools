import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Fix text norm
target = """        SlideElement::Text { id,left,top,width,height,rotate,content,default_font_name,default_color, shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical, .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {"""

replacement = """        SlideElement::Text { id,left,top,width,height,rotate,content,default_font_name,default_color, shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical, .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {"""

# Wait, the error is:
# 1276 | |             default_color,
# 1277 | |             .. } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
#      | |________________- this pattern doesn't include `shadow`, which is available in `Text`
# So the match pattern is literally:
target_norm = """        SlideElement::Text {
id,
            left,
            top,
            width,
            height,
            rotate,
            content,
            default_font_name,
            default_color,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Text { shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,
id,"""

replacement_norm = """        SlideElement::Text {
id,
            left,
            top,
            width,
            height,
            rotate,
            content,
            default_font_name,
            default_color,
            shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,
            .. 
        } => normalize_box(left, top, width, height).map(|(left, top, width, height)| {
            SlideElement::Text { shadow, fill, outline, line_height, opacity, word_space, paragraph_space, vertical,
id,"""

if target_norm in content:
    content = content.replace(target_norm, replacement_norm)
else:
    print("Could not find Text norm target")

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
