use anyhow::{anyhow, Result};

use ai_tutor_domain::provider::{ModelConfig, ModelInfo, ProviderConfig, ProviderType};

use crate::{
    config::ServerProviderConfig,
    registry::{get_model_info, get_provider},
};

#[derive(Debug, Clone)]
pub struct ResolvedModel {
    pub model_string: String,
    pub provider: ProviderConfig,
    pub model_info: Option<ModelInfo>,
    pub model_config: ModelConfig,
}

pub fn parse_model_string(model_string: &str) -> (String, String) {
    if let Some((provider_id, model_id)) = model_string.split_once(':') {
        (provider_id.to_string(), model_id.to_string())
    } else {
        ("openai".to_string(), model_string.to_string())
    }
}

pub fn resolve_model(
    config: &ServerProviderConfig,
    model_string: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
    provider_type: Option<ProviderType>,
    requires_api_key: Option<bool>,
) -> Result<ResolvedModel> {
    let model_string = model_string.unwrap_or("gpt-4o-mini").to_string();
    let (provider_id, model_id) = parse_model_string(&model_string);

    let provider =
        get_provider(&provider_id).ok_or_else(|| anyhow!("unknown provider: {}", provider_id))?;

    let server_entry = config.get(&provider_id);
    let effective_api_key = api_key
        .map(ToOwned::to_owned)
        .or_else(|| server_entry.and_then(|entry| entry.api_key.clone()))
        .unwrap_or_default();
    let effective_base_url = base_url
        .map(ToOwned::to_owned)
        .or_else(|| server_entry.and_then(|entry| entry.base_url.clone()))
        .or_else(|| provider.default_base_url.clone());
    let effective_proxy = server_entry.and_then(|entry| entry.proxy.clone());

    let effective_requires_api_key = requires_api_key.unwrap_or(provider.requires_api_key);
    if effective_requires_api_key && effective_api_key.is_empty() {
        return Err(anyhow!("api key required for provider: {}", provider_id));
    }

    let effective_provider_type = provider_type.unwrap_or_else(|| provider.provider_type.clone());
    let model_info = get_model_info(&provider_id, &model_id);

    Ok(ResolvedModel {
        model_string,
        provider,
        model_info,
        model_config: ModelConfig {
            provider_id,
            model_id,
            api_key: effective_api_key,
            base_url: effective_base_url,
            proxy: effective_proxy,
            provider_type: Some(effective_provider_type),
            requires_api_key: Some(effective_requires_api_key),
        },
    })
}

#[cfg(test)]
mod tests {
    use ai_tutor_domain::provider::ProviderType;

    use crate::config::{ServerProviderConfig, ServerProviderEntry};

    use super::{parse_model_string, resolve_model};

    #[test]
    fn parses_provider_and_model() {
        let (provider, model) = parse_model_string("google:gemini-2.5-flash");
        assert_eq!(provider, "google");
        assert_eq!(model, "gemini-2.5-flash");
    }

    #[test]
    fn defaults_to_openai_without_provider_prefix() {
        let (provider, model) = parse_model_string("gpt-4o-mini");
        assert_eq!(provider, "openai");
        assert_eq!(model, "gpt-4o-mini");
    }

    #[test]
    fn resolves_server_side_api_key_and_base_url() {
        let mut config = ServerProviderConfig::default();
        config.providers.insert(
            "openai".to_string(),
            ServerProviderEntry {
                api_key: Some("server-key".to_string()),
                base_url: Some("https://example.test/v1".to_string()),
                proxy: Some("http://proxy.test".to_string()),
                models: vec![],
            },
        );

        let resolved =
            resolve_model(&config, Some("gpt-4o-mini"), None, None, None, None).unwrap();
        assert_eq!(resolved.model_config.provider_id, "openai");
        assert_eq!(resolved.model_config.model_id, "gpt-4o-mini");
        assert_eq!(resolved.model_config.api_key, "server-key");
        assert_eq!(
            resolved.model_config.base_url.as_deref(),
            Some("https://example.test/v1")
        );
        assert_eq!(
            resolved.model_config.proxy.as_deref(),
            Some("http://proxy.test")
        );
    }

    #[test]
    fn respects_explicit_provider_type_override() {
        let config = ServerProviderConfig::default();
        let resolved = resolve_model(
            &config,
            Some("openai:gpt-4o-mini"),
            Some("key"),
            None,
            Some(ProviderType::OpenAi),
            Some(true),
        )
        .unwrap();

        assert_eq!(
            resolved.model_config.provider_type,
            Some(ProviderType::OpenAi)
        );
    }
}
