with open('crates/domain/src/scene.rs', 'r') as f:
    content = f.read()

content = content.replace(
    'Image {\n        src: String,\n        #[serde(rename = "imageSize")]\n        image_size: String,\n    },',
    'Image {\n        image: SlideBackgroundImage,\n    },'
)

with open('crates/domain/src/scene.rs', 'w') as f:
    f.write(content)
