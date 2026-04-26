import os
import re

count = 0
for root, dirs, files in os.walk('apps/web'):
    if 'node_modules' in root or '.next' in root:
        continue
    for file in files:
        if file.endswith('.tsx') or file.endswith('.ts'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            if 'slate-' in content:
                new_content = re.sub(r'slate-', 'neutral-', content)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                count += 1
print(f'Replaced in {count} files')
