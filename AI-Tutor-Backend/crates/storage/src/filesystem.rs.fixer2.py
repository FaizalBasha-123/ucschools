import re

path = "/media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/storage/src/filesystem.rs"
with open(path, "r") as f:
    content = f.read()

# Fix the mismatched closing delimiter
# We need to find 'let postgres_url = self.postgres_url.clone();'
# and then find the next '}' that matches the 'if let' we removed.

# Actually, the most robust way is to find the 'spawn_blocking' block and fix its surroundings.

# Remove the '}' that was after the spawn_blocking block
content = re.sub(r'(\.await\.map_err\(.*?\)\?);\s+}', r'\1;', content)

# Remove other leftover blocks
content = re.sub(r'}\s+if let Some\(db_path\) = self\..*?_db_path\.clone\(\) \{.*?\}\s+', '}', content, flags=re.DOTALL)

with open(path, "w") as f:
    f.write(content)
