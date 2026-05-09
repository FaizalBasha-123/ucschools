import re
import sys

path = "/media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/storage/src/filesystem.rs"
with open(path, "r") as f:
    content = f.read()

# Replace 'let postgres_url = self.postgres_url.clone();' block cleanup
# We want to find the closing '}' of the tokio::task::spawn_blocking or similar
# and remove everything after it until the end of the function.

# This is risky with regex. Let's try a different approach.
# I'll look for:
#         }
#         if let Some(db_path) = self.lesson_db_path.clone() {
# ...
#         }
#     }

content = re.sub(r'}\s+if let Some\(db_path\) = self\..*?_db_path\.clone\(\) \{.*?\}\s+}', '}', content, flags=re.DOTALL)
content = re.sub(r'}\s+if let Some\(db_path\) = self\.job_db_path\.clone\(\) \{.*?\}\s+}', '}', content, flags=re.DOTALL)
content = re.sub(r'}\s+if let Some\(db_path\) = self\.runtime_db_path\.clone\(\) \{.*?\}\s+}', '}', content, flags=re.DOTALL)

# Also handle the 'else { Self::read_json... }' blocks
content = re.sub(r'}\s+else\s+\{.*?\}\s+}', '}', content, flags=re.DOTALL)

# Fix the double function signatures I created accidentally
content = content.replace("async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {\n    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {", "    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {")

with open(path, "w") as f:
    f.write(content)
