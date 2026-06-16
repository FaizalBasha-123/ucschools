use std::collections::HashMap;
use crate::prompts_generated::{get_snippet, get_template};

pub fn process_snippets(mut template: String) -> String {
    // This is a naive loop to replace {{snippet:name}}. 
    // In a real regex we would use the regex crate, but simple replace works if we iterate a few times.
    let mut changed = true;
    while changed {
        changed = false;
        if let Some(start) = template.find("{{snippet:") {
            if let Some(end) = template[start..].find("}}") {
                let end_idx = start + end;
                let snippet_name = &template[start + 10..end_idx];
                let snippet_content = get_snippet(snippet_name).unwrap_or("");
                template.replace_range(start..end_idx + 2, snippet_content);
                changed = true;
            }
        }
    }
    template
}

pub fn process_conditionals(mut template: String, variables: &HashMap<&str, String>) -> String {
    let mut changed = true;
    while changed {
        changed = false;
        if let Some(start) = template.find("{{#if ") {
            if let Some(end_cond) = template[start..].find("}}") {
                let end_cond_idx = start + end_cond;
                let condition_name = &template[start + 6..end_cond_idx];
                
                if let Some(end_block) = template[end_cond_idx..].find("{{/if}}") {
                    let end_block_idx = end_cond_idx + end_block;
                    
                    let condition_met = variables.get(condition_name)
                        .map(|s| {
                            let s = s.trim();
                            !s.is_empty() && s != "false"
                        })
                        .unwrap_or(false);
                    
                    if condition_met {
                        let content = template[end_cond_idx + 2..end_block_idx].to_string();
                        template.replace_range(start..end_block_idx + 7, &content);
                    } else {
                        template.replace_range(start..end_block_idx + 7, "");
                    }
                    changed = true;
                }
            }
        }
    }
    template
}

pub fn interpolate_variables(mut template: String, variables: &HashMap<&str, String>) -> String {
    for (k, v) in variables {
        let pattern = format!("{{{{{}}}}}", k);
        template = template.replace(&pattern, v);
    }
    template
}

pub fn build_prompt(prompt_id: &str, variables: &HashMap<&str, String>) -> Option<(String, String)> {
    let system_template = get_template(prompt_id, "system.md")?;
    let user_template = get_template(prompt_id, "user.md").unwrap_or("");

    let sys_snip = process_snippets(system_template.to_string());
    let sys_cond = process_conditionals(sys_snip, variables);
    let system_final = interpolate_variables(sys_cond, variables);

    let user_snip = process_snippets(user_template.to_string());
    let user_cond = process_conditionals(user_snip, variables);
    let user_final = interpolate_variables(user_cond, variables);

    Some((system_final, user_final))
}
