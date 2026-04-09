use std::{collections::HashMap, env};

#[derive(Debug, Clone, Default)]
pub struct ServerProviderEntry {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub proxy: Option<String>,
    pub models: Vec<String>,
    pub transport_override: Option<TransportOverrideConfig>,
    pub pricing_override: Option<PricingOverrideConfig>,
}

#[derive(Debug, Clone, Default)]
pub struct TransportOverrideConfig {
    pub native_text_streaming: Option<bool>,
    pub native_typed_streaming: Option<bool>,
    pub compatibility_streaming: Option<bool>,
    pub cooperative_cancellation: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct PricingOverrideConfig {
    pub input_cost_per_1m_usd: Option<f64>,
    pub output_cost_per_1m_usd: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct ServerProviderConfig {
    pub providers: HashMap<String, ServerProviderEntry>,
    pub llm_provider_priority: Vec<String>,
    pub llm_circuit_breaker_threshold: u32,
    pub llm_circuit_breaker_cooldown_ms: u64,
}

impl ServerProviderConfig {
    pub fn from_env() -> Self {
        let mut config = Self::default();
        config.llm_provider_priority = env::var("AI_TUTOR_LLM_PROVIDER_PRIORITY")
            .ok()
            .map(|raw| {
                raw.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(|provider| provider.to_ascii_lowercase())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        config.llm_circuit_breaker_threshold = env::var("AI_TUTOR_LLM_CIRCUIT_BREAKER_THRESHOLD")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(2);
        config.llm_circuit_breaker_cooldown_ms =
            env::var("AI_TUTOR_LLM_CIRCUIT_BREAKER_COOLDOWN_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(30_000);

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
            let transport_override = parse_transport_override(prefix);
            let pricing_override = parse_pricing_override(prefix);

            if api_key.is_some()
                || base_url.is_some()
                || proxy.is_some()
                || !models.is_empty()
                || transport_override.is_some()
                || pricing_override.is_some()
            {
                config.providers.insert(
                    provider_id.to_string(),
                    ServerProviderEntry {
                        api_key,
                        base_url,
                        proxy,
                        models,
                        transport_override,
                        pricing_override,
                    },
                );
            }
        }

        config
    }

    pub fn get(&self, provider_id: &str) -> Option<&ServerProviderEntry> {
        self.providers.get(provider_id)
    }

    pub fn ordered_llm_provider_ids(&self, primary_provider_id: Option<&str>) -> Vec<String> {
        let mut ordered = Vec::new();

        if let Some(primary) = primary_provider_id {
            ordered.push(primary.to_ascii_lowercase());
        }

        for provider_id in &self.llm_provider_priority {
            if self.providers.contains_key(provider_id) && !ordered.contains(provider_id) {
                ordered.push(provider_id.clone());
            }
        }

        for (_, provider_id) in provider_prefixes() {
            let normalized = provider_id.to_ascii_lowercase();
            if self.providers.contains_key(&normalized) && !ordered.contains(&normalized) {
                ordered.push(normalized);
            }
        }

        ordered
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
        ("GROQ", "groq"),
        ("GROK", "grok"),
        ("XAI", "grok"),
        ("OPENROUTER", "openrouter"),
    ]
}

fn parse_transport_override(prefix: &str) -> Option<TransportOverrideConfig> {
    let config = TransportOverrideConfig {
        native_text_streaming: parse_optional_bool(&format!("{prefix}_NATIVE_TEXT_STREAMING")),
        native_typed_streaming: parse_optional_bool(&format!("{prefix}_NATIVE_TYPED_STREAMING")),
        compatibility_streaming: parse_optional_bool(&format!("{prefix}_COMPATIBILITY_STREAMING")),
        cooperative_cancellation: parse_optional_bool(&format!("{prefix}_COOPERATIVE_CANCELLATION")),
    };

    (config.native_text_streaming.is_some()
        || config.native_typed_streaming.is_some()
        || config.compatibility_streaming.is_some()
        || config.cooperative_cancellation.is_some())
    .then_some(config)
}

fn parse_optional_bool(key: &str) -> Option<bool> {
    env::var(key).ok().and_then(|value| {
        let normalized = value.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        }
    })
}

fn parse_pricing_override(prefix: &str) -> Option<PricingOverrideConfig> {
    let config = PricingOverrideConfig {
        input_cost_per_1m_usd: parse_optional_f64(&format!("{prefix}_INPUT_COST_PER_1M_USD")),
        output_cost_per_1m_usd: parse_optional_f64(&format!("{prefix}_OUTPUT_COST_PER_1M_USD")),
    };

    (config.input_cost_per_1m_usd.is_some() || config.output_cost_per_1m_usd.is_some())
        .then_some(config)
}

fn parse_optional_f64(key: &str) -> Option<f64> {
    env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
}

#[cfg(test)]
mod tests {
    use super::ServerProviderConfig;

    #[test]
    fn from_env_loads_openrouter_and_groq_aliases() {
        let previous_openrouter = std::env::var("OPENROUTER_API_KEY").ok();
        let previous_groq = std::env::var("GROQ_API_KEY").ok();
        let previous_xai = std::env::var("XAI_API_KEY").ok();

        std::env::set_var("OPENROUTER_API_KEY", "openrouter-key");
        std::env::set_var("GROQ_API_KEY", "groq-key");
        std::env::set_var("XAI_API_KEY", "xai-key");

        let config = ServerProviderConfig::from_env();
        assert_eq!(
            config
                .providers
                .get("openrouter")
                .and_then(|entry| entry.api_key.as_deref()),
            Some("openrouter-key")
        );
        assert_eq!(
            config
                .providers
                .get("groq")
                .and_then(|entry| entry.api_key.as_deref()),
            Some("groq-key")
        );
        assert_eq!(
            config
                .providers
                .get("grok")
                .and_then(|entry| entry.api_key.as_deref()),
            Some("xai-key")
        );

        if let Some(value) = previous_openrouter {
            std::env::set_var("OPENROUTER_API_KEY", value);
        } else {
            std::env::remove_var("OPENROUTER_API_KEY");
        }
        if let Some(value) = previous_groq {
            std::env::set_var("GROQ_API_KEY", value);
        } else {
            std::env::remove_var("GROQ_API_KEY");
        }
        if let Some(value) = previous_xai {
            std::env::set_var("XAI_API_KEY", value);
        } else {
            std::env::remove_var("XAI_API_KEY");
        }
    }

    #[test]
    fn from_env_loads_transport_overrides() {
        let previous_native = std::env::var("OPENROUTER_NATIVE_TEXT_STREAMING").ok();
        let previous_typed = std::env::var("OPENROUTER_NATIVE_TYPED_STREAMING").ok();
        let previous_compat = std::env::var("OPENROUTER_COMPATIBILITY_STREAMING").ok();
        let previous_cancel = std::env::var("OPENROUTER_COOPERATIVE_CANCELLATION").ok();

        std::env::set_var("OPENROUTER_NATIVE_TEXT_STREAMING", "true");
        std::env::set_var("OPENROUTER_NATIVE_TYPED_STREAMING", "false");
        std::env::set_var("OPENROUTER_COMPATIBILITY_STREAMING", "true");
        std::env::set_var("OPENROUTER_COOPERATIVE_CANCELLATION", "true");

        let config = ServerProviderConfig::from_env();
        let override_config = config
            .providers
            .get("openrouter")
            .and_then(|entry| entry.transport_override.as_ref())
            .expect("transport override should be parsed");
        assert_eq!(override_config.native_text_streaming, Some(true));
        assert_eq!(override_config.native_typed_streaming, Some(false));
        assert_eq!(override_config.compatibility_streaming, Some(true));
        assert_eq!(override_config.cooperative_cancellation, Some(true));

        if let Some(value) = previous_native {
            std::env::set_var("OPENROUTER_NATIVE_TEXT_STREAMING", value);
        } else {
            std::env::remove_var("OPENROUTER_NATIVE_TEXT_STREAMING");
        }
        if let Some(value) = previous_typed {
            std::env::set_var("OPENROUTER_NATIVE_TYPED_STREAMING", value);
        } else {
            std::env::remove_var("OPENROUTER_NATIVE_TYPED_STREAMING");
        }
        if let Some(value) = previous_compat {
            std::env::set_var("OPENROUTER_COMPATIBILITY_STREAMING", value);
        } else {
            std::env::remove_var("OPENROUTER_COMPATIBILITY_STREAMING");
        }
        if let Some(value) = previous_cancel {
            std::env::set_var("OPENROUTER_COOPERATIVE_CANCELLATION", value);
        } else {
            std::env::remove_var("OPENROUTER_COOPERATIVE_CANCELLATION");
        }
    }

    #[test]
    fn from_env_loads_pricing_overrides() {
        let previous_input = std::env::var("OPENROUTER_INPUT_COST_PER_1M_USD").ok();
        let previous_output = std::env::var("OPENROUTER_OUTPUT_COST_PER_1M_USD").ok();

        std::env::set_var("OPENROUTER_INPUT_COST_PER_1M_USD", "2.5");
        std::env::set_var("OPENROUTER_OUTPUT_COST_PER_1M_USD", "10.0");

        let config = ServerProviderConfig::from_env();
        let pricing = config
            .providers
            .get("openrouter")
            .and_then(|entry| entry.pricing_override.as_ref())
            .expect("pricing override should be parsed");
        assert_eq!(pricing.input_cost_per_1m_usd, Some(2.5));
        assert_eq!(pricing.output_cost_per_1m_usd, Some(10.0));

        if let Some(value) = previous_input {
            std::env::set_var("OPENROUTER_INPUT_COST_PER_1M_USD", value);
        } else {
            std::env::remove_var("OPENROUTER_INPUT_COST_PER_1M_USD");
        }
        if let Some(value) = previous_output {
            std::env::set_var("OPENROUTER_OUTPUT_COST_PER_1M_USD", value);
        } else {
            std::env::remove_var("OPENROUTER_OUTPUT_COST_PER_1M_USD");
        }
    }
}
