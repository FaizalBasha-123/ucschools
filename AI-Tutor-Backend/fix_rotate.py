import re

with open('crates/orchestrator/src/generation/helpers.rs', 'r') as f:
    content = f.read()

content = re.sub(r'rotate: element\.rotate,', r'rotate: 0.0,', content)

with open('crates/orchestrator/src/generation/helpers.rs', 'w') as f:
    f.write(content)
