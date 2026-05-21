use anyhow::{anyhow, Result};

/// Read an env var, trim it, return None if empty or missing.
pub fn read_optional_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Read a required env var, panic if missing or empty.
pub fn required_env(key: &str) -> String {
    read_optional_env(key).unwrap_or_else(|| panic!("{} is required but not set", key))
}

/// Check whether an env var has a truthy value (1, true, yes, on).
pub fn env_flag(key: &str) -> bool {
    matches!(
        std::env::var(key)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub fn env_f64(key: &str, default: f64) -> f64 {
    read_optional_env(key)
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

/// Read a required env var, return Err if missing or empty.
pub fn required_trimmed_env(key: &str) -> Result<String> {
    read_optional_env(key).ok_or_else(|| anyhow!("{key} is required"))
}
