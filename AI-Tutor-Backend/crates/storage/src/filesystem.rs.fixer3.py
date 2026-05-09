import re

path = "/media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/storage/src/filesystem.rs"
with open(path, "r") as f:
    lines = f.readlines()

new_lines = []
skip_next_brace = False

for i in range(len(lines)):
    line = lines[i]
    
    if ".await.map_err(" in line and ("?;" in line or "?\n" in line or "? " in line):
        new_lines.append(line)
        # Check if next line is just a closing brace
        if i + 1 < len(lines) and lines[i+1].strip() == "}":
            skip_next_brace = True
        continue
    
    if skip_next_brace and line.strip() == "}":
        skip_next_brace = False
        continue
        
    new_lines.append(line)

with open(path, "w") as f:
    f.writelines(new_lines)
