use std::{collections::HashMap, env};

#[derive(Debug, Clone, Default)]
pub struct ServerProviderEntry {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub proxy: Option<String>,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ServerProviderConfig {
    pub providers: HashMap<String, ServerProviderEntry>,
}

impl ServerProviderConfig {
    pub fn from_env() -> Self {
        let mut config = Self::default();

        for (prefix, provider_id) in provider_prefixes() {
            let api_key = env::var(format!("{prefix}_API_KEY")).ok();
            let base_url = env::var(format!("{prefix}_BASE_URL")).ok();
            let proxy = env::var(format!("{prefix}_PROXY")).ok();
            let models = env::var(format!("{prefix}_MODELS"))
                .ok()
                .map(|raw| {
                    raw.split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(ToOwned::to_owned)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if api_key.is_some() || base_url.is_some() || proxy.is_some() || !models.is_empty() {
                config.providers.insert(
                    provider_id.to_string(),
                    ServerProviderEntry {
                        api_key,
                        base_url,
                        proxy,
                        models,
                    },
                );
            }
        }

        config
    }

    pub fn get(&self, provider_id: &str) -> Option<&ServerProviderEntry> {
        self.providers.get(provider_id)
    }
}

fn provider_prefixes() -> &'static [(&'static str, &'static str)] {
    &[
        ("OPENAI", "openai"),
        ("ANTHROPIC", "anthropic"),
        ("GOOGLE", "google"),
        ("DEEPSEEK", "deepseek"),
        ("QWEN", "qwen"),
        ("KIMI", "kimi"),
        ("MINIMAX", "minimax"),
        ("GLM", "glm"),
        ("SILICONFLOW", "siliconflow"),
        ("DOUBAO", "doubao"),
        ("GROK", "grok"),
    ]
}
