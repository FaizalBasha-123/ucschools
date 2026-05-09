import re

path = "/media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/storage/src/filesystem.rs"
with open(path, "r") as f:
    lines = f.readlines()

new_lines = []
for i in range(len(lines)):
    line = lines[i]
    if line.strip() == "}" and i > 0:
        prev = lines[i-1]
        if ".await" in prev and ".map_err(" in prev and ("?;" in prev or "?" in prev):
            # This is an extra brace from an if let block we removed
            continue
    new_lines.append(line)

with open(path, "w") as f:
    f.writelines(new_lines)
