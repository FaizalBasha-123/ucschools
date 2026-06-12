#!/bin/bash
# Generate a rust file containing all prompts as constants
cat << 'OUTER' > /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts_generated.rs
use std::collections::HashMap;

pub fn get_snippet(id: &str) -> Option<&'static str> {
    match id {
OUTER

for file in /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts/snippets/*.md; do
    id=$(basename "$file" .md)
    echo "        \"$id\" => Some(include_str!(\"prompts/snippets/$id.md\"))," >> /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts_generated.rs
done

cat << 'OUTER' >> /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts_generated.rs
        _ => None,
    }
}

pub fn get_template(id: &str, file: &str) -> Option<&'static str> {
    match (id, file) {
OUTER

for dir in /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts/templates/*; do
    id=$(basename "$dir")
    for file in "$dir"/*.md; do
        filename=$(basename "$file")
        echo "        (\"$id\", \"$filename\") => Some(include_str!(\"prompts/templates/$id/$filename\"))," >> /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts_generated.rs
    done
done

cat << 'OUTER' >> /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts_generated.rs
        _ => None,
    }
}
OUTER
chmod +x /media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts/build_prompts.sh
/media/faizal-basha/Codespace/uc-school/AI-Tutor-Backend/crates/orchestrator/src/prompts/build_prompts.sh
