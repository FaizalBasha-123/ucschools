import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

target = "let opts = katex::Opts::builder().display_mode(true).build().unwrap_or_default();"
replacement = "let opts = katex::Opts::builder().display_mode(true).output_type(katex::OutputType::Html).build().unwrap_or_default();"

if target in content:
    content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
