import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

# Fix Video missing autoplay
content = re.sub(
    r'"video" => SlideElement::Video \{ shadow: element.shadow.clone\(\),\n(\s*)id,\n(\s*)left,\n(\s*)top,\n(\s*)width,\n(\s*)height,\n(\s*)rotate,\n(\s*)src: element.src.unwrap_or_default\(\),\n(\s*)poster: element.poster,\n(\s*)\},',
    r'"video" => SlideElement::Video { shadow: element.shadow.clone(),\n\g<1>id,\n\g<2>left,\n\g<3>top,\n\g<4>width,\n\g<5>height,\n\g<6>rotate,\n\g<7>src: element.src.unwrap_or_default(),\n\g<8>poster: element.poster,\n\g<8>autoplay: element.autoplay.unwrap_or(false),\n\g<9>},',
    content
)

# Fix video norm
content = re.sub(
    r'SlideElement::Video \{\s*shadow:\s*None,\n(\s*)id,\n(\s*)left,\n(\s*)top,\n(\s*)width,\n(\s*)height,\n(\s*)rotate,\n(\s*)src,\n(\s*)poster,\n(\s*)\}',
    r'SlideElement::Video { shadow: None,\n\g<1>id,\n\g<2>left,\n\g<3>top,\n\g<4>width,\n\g<5>height,\n\g<6>rotate,\n\g<7>src,\n\g<8>poster,\n\g<8>autoplay: false,\n\g<9>}',
    content
)

# Fix table cell_min_height
content = re.sub(
    r'SlideElement::Table \{ shadow:\s*None,\n(\s*)id,\n(\s*)left,\n(\s*)top,\n(\s*)width,\n(\s*)height,\n(\s*)rotate,\n(\s*)col_widths: None,\n(\s*)data: None,\n(\s*)outline: None,\n(\s*)theme: None,\n(\s*)\}',
    r'SlideElement::Table { shadow: None,\n\g<1>id,\n\g<2>left,\n\g<3>top,\n\g<4>width,\n\g<5>height,\n\g<6>rotate,\n\g<7>col_widths: None,\n\g<8>data: None,\n\g<9>outline: None,\n\g<10>theme: None,\n\g<10>cell_min_height: Some(36.0),\n\g<11>}',
    content
)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
