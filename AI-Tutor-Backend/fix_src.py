import re

with open('crates/media/src/lib.rs', 'r') as f:
    content = f.read()

content = content.replace("media_map.get(src)", "media_map.get(&image.src)")
content = content.replace("decode_data_url(src)", "decode_data_url(&image.src)")
content = content.replace("image.src = url.clone();", "image.src = url.clone();")

with open('crates/media/src/lib.rs', 'w') as f:
    f.write(content)
