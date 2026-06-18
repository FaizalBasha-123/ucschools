with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

content = content.replace(
    'if left < 0.0 || top < 0.0 || width <= 0.0 || height <= 0.0 {\n        return None;\n    }',
    'if width <= 0.0 || height <= 0.0 {\n        return None;\n    }'
)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
