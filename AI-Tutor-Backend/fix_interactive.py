import re

with open('crates/orchestrator/src/generation/interactive.rs', 'r') as f:
    content = f.read()

target = """    SceneContent::Interactive {
        url: interactive_data.url.unwrap_or_else(|| "https://phet.colorado.edu/sims/html/forces-and-motion-basics/latest/forces-and-motion-basics_en.html".to_string()),
        html: interactive_data.html,
        scientific_model: interactive_data.scientific_model,
    }"""
replacement = """    SceneContent::Interactive {
        url: interactive_data.url.unwrap_or_else(|| "".to_string()),
        html: interactive_data.html,
        scientific_model: interactive_data.scientific_model,
    }"""

content = content.replace(target, replacement)

with open('crates/orchestrator/src/generation/interactive.rs', 'w') as f:
    f.write(content)
