with open('crates/media/src/lib.rs', 'r') as f:
    content = f.read()

content = content.replace(
    'if let Some(SlideBackground::Image { image }) = &mut canvas.background {',
    'if let Some(SlideBackground::Image { image }) = &mut canvas.background {'
)
content = content.replace(
    'if image.src.starts_with("image_gen_") {',
    'if image.src.starts_with("image_gen_") {'
)

# Wait, the compiler error says:
# error[E0027]: pattern does not mention fields `src`, `image_size`
# Wait, if SlideBackground::Image has `image`, where is `src` and `image_size` coming from?
# Oh! The `SlideBackground::Image` in `domain/scene.rs` was already fixed, but `media/src/lib.rs` was not matched!
