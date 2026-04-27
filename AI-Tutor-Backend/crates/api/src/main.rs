use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{anyhow, Result};
use reqwest::Url;
use tracing::{error, info};

use ai_tutor_api::app::{build_router, LiveLessonAppService};
use ai_tutor_providers::{
    config::ServerProviderConfig,
    factory::{
        DefaultImageProviderFactory, DefaultLlmProviderFactory, DefaultTtsProviderFactory,
        DefaultVideoProviderFactory,
    },
};
use ai_tutor_storage::filesystem::FileStorage;

mod cleanup;
use cleanup::{run_cleanup_loop, CleanupConfig};

async fn run_startup_readiness_checks(
    storage: &FileStorage,
    provider_config: &ServerProviderConfig,
) -> Result<()> {
    fn is_configured_secret(value: Option<String>) -> bool {
        value
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty() && !value.starts_with("replace_with_"))
    }

    // Ensure storage root is writable before we bind the HTTP listener.
    tokio::fs::create_dir_all(storage.root_dir())
        .await
        .map_err(|err| anyhow!("storage root readiness failed: {}", err))?;

    // Optional strict provider guard: fail startup if no provider has a key.
    let strict_provider_readiness = std::env::var("AI_TUTOR_STARTUP_STRICT_PROVIDER_READINESS")
        .ok()
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE"))
        .unwrap_or(false);
    if strict_provider_readiness {
        let has_provider_key = provider_config
            .providers
            .values()
            .any(|entry| entry.api_key.as_deref().is_some_and(|value| !value.trim().is_empty()));
        if !has_provider_key {
            return Err(anyhow!(
                "startup readiness failed: no provider API key configured while strict provider readiness is enabled"
            ));
        }
    }

    // If API auth is required, at least one admin-capable token source must be configured.
    let auth_required = matches!(
        std::env::var("AI_TUTOR_AUTH_REQUIRED")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );
    if auth_required {
        let has_api_secret = std::env::var("AI_TUTOR_API_SECRET")
            .ok()
            .is_some_and(|value| !value.trim().is_empty());
        let has_api_tokens = std::env::var("AI_TUTOR_API_TOKENS")
            .ok()
            .is_some_and(|value| {
                value
                    .split(',')
                    .any(|entry| !entry.trim().is_empty() && entry.contains('='))
            });

        if !has_api_secret && !has_api_tokens {
            return Err(anyhow!(
                "startup readiness failed: AI_TUTOR_AUTH_REQUIRED is enabled but neither AI_TUTOR_API_SECRET nor AI_TUTOR_API_TOKENS is configured"
            ));
        }
    }

    let operator_otp_enabled = matches!(
        std::env::var("AI_TUTOR_OPERATOR_OTP_ENABLED")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );
    if operator_otp_enabled {
        ai_tutor_api::app::init_operator_db()
            .map_err(|e| anyhow!("startup readiness failed: operator db initialization error: {:?}", e))?;

        if !is_configured_secret(std::env::var("AI_TUTOR_OPERATOR_ALLOWED_EMAILS").ok()) {
            return Err(anyhow!(
                "startup readiness failed: operator OTP is enabled but AI_TUTOR_OPERATOR_ALLOWED_EMAILS is empty"
            ));
        }
    }

    let smtp_enabled = matches!(
        std::env::var("AI_TUTOR_SMTP_ENABLED")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );
    if smtp_enabled {
        let use_sendmail = matches!(
            std::env::var("AI_TUTOR_SMTP_USE_SENDMAIL")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        );

        if !is_configured_secret(std::env::var("AI_TUTOR_SMTP_FROM_EMAIL").ok()) {
            return Err(anyhow!(
                "startup readiness failed: AI_TUTOR_SMTP_ENABLED is set but AI_TUTOR_SMTP_FROM_EMAIL is missing"
            ));
        }

        if use_sendmail {
            if !is_configured_secret(std::env::var("AI_TUTOR_SMTP_SENDMAIL_PATH").ok()) {
                return Err(anyhow!(
                    "startup readiness failed: AI_TUTOR_SMTP_USE_SENDMAIL is set but AI_TUTOR_SMTP_SENDMAIL_PATH is missing"
                ));
            }
        } else {
            for env_key in [
                "AI_TUTOR_SMTP_HOST",
                "AI_TUTOR_SMTP_PORT",
                "AI_TUTOR_SMTP_USER",
                "AI_TUTOR_SMTP_PASSWORD",
            ] {
                if !is_configured_secret(std::env::var(env_key).ok()) {
                    return Err(anyhow!(
                        "startup readiness failed: {} is required when AI_TUTOR_SMTP_ENABLED=1",
                        env_key
                    ));
                }
            }
        }
    }

    // Strict ops mode enforces production-grade core dependencies.
    let strict_ops_mode = matches!(
        std::env::var("AI_TUTOR_OPS_GATE_STRICT")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );
    if strict_ops_mode {
        if !is_configured_secret(std::env::var("OPENROUTER_API_KEY").ok()) {
            return Err(anyhow!(
                "startup readiness failed: OPENROUTER_API_KEY must be configured in strict ops mode"
            ));
        }

        if !is_configured_secret(std::env::var("EASEBUZZ_API_KEY").ok()) {
            return Err(anyhow!(
                "startup readiness failed: EASEBUZZ_API_KEY must be configured in strict ops mode"
            ));
        }

        let has_postgres = is_configured_secret(std::env::var("AI_TUTOR_NEON_DATABASE_URL").ok())
            || is_configured_secret(std::env::var("AI_TUTOR_POSTGRES_URL").ok());
        if !has_postgres {
            return Err(anyhow!(
                "startup readiness failed: AI_TUTOR_NEON_DATABASE_URL or AI_TUTOR_POSTGRES_URL must be configured in strict ops mode"
            ));
        }
    }

    // R2 mode requires core credentials to be present.
    let asset_store = std::env::var("AI_TUTOR_ASSET_STORE").unwrap_or_else(|_| "local".to_string());
    if asset_store.eq_ignore_ascii_case("r2") {
        for env_key in [
            "AI_TUTOR_R2_ENDPOINT",
            "AI_TUTOR_R2_BUCKET",
            "AI_TUTOR_R2_ACCESS_KEY_ID",
            "AI_TUTOR_R2_SECRET_ACCESS_KEY",
            "AI_TUTOR_R2_PUBLIC_BASE_URL",
        ] {
            let configured = std::env::var(env_key)
                .ok()
                .is_some_and(|value| !value.trim().is_empty());
            if !configured {
                return Err(anyhow!(
                    "startup readiness failed: {} is required when AI_TUTOR_ASSET_STORE=r2",
                    env_key
                ));
            }
        }

        let allow_insecure = matches!(
            std::env::var("AI_TUTOR_ALLOW_INSECURE_R2")
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "1" | "true" | "yes" | "on"
        );

        let endpoint = std::env::var("AI_TUTOR_R2_ENDPOINT").unwrap_or_default();
        let public_base_url = std::env::var("AI_TUTOR_R2_PUBLIC_BASE_URL").unwrap_or_default();

        for (label, value) in [
            ("AI_TUTOR_R2_ENDPOINT", endpoint.as_str()),
            ("AI_TUTOR_R2_PUBLIC_BASE_URL", public_base_url.as_str()),
        ] {
            let parsed = Url::parse(value)
                .map_err(|err| anyhow!("startup readiness failed: invalid {}: {}", label, err))?;
            if parsed.host_str().is_none() {
                return Err(anyhow!(
                    "startup readiness failed: {} must include a host",
                    label
                ));
            }
            if parsed.query().is_some() || parsed.fragment().is_some() {
                return Err(anyhow!(
                    "startup readiness failed: {} must not include query params or fragments",
                    label
                ));
            }
            if !allow_insecure && parsed.scheme() != "https" {
                return Err(anyhow!(
                    "startup readiness failed: {} must use https unless AI_TUTOR_ALLOW_INSECURE_R2=1",
                    label
                ));
            }
        }

        let key_prefix = std::env::var("AI_TUTOR_R2_KEY_PREFIX").unwrap_or_default();
        if key_prefix.contains("..") {
            return Err(anyhow!(
                "startup readiness failed: AI_TUTOR_R2_KEY_PREFIX must not contain path traversal segments"
            ));
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let host = std::env::var("AI_TUTOR_API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("AI_TUTOR_API_PORT").unwrap_or_else(|_| "8099".to_string());
    let storage_root =
        std::env::var("AI_TUTOR_STORAGE_ROOT").expect("AI_TUTOR_STORAGE_ROOT is required");
    let lesson_db_path = std::env::var("AI_TUTOR_LESSON_DB_PATH").ok();
    let runtime_db_path = std::env::var("AI_TUTOR_RUNTIME_DB_PATH").ok();
    let job_db_path = std::env::var("AI_TUTOR_JOB_DB_PATH").ok();
    let postgres_url = std::env::var("AI_TUTOR_NEON_DATABASE_URL")
        .ok()
        .or_else(|| std::env::var("AI_TUTOR_POSTGRES_URL").ok());
    let base_url =
        std::env::var("AI_TUTOR_BASE_URL").unwrap_or_else(|_| format!("http://{}:{}", host, port));

    let storage = Arc::new(FileStorage::with_databases(
        storage_root,
        lesson_db_path.map(Into::into),
        runtime_db_path.map(Into::into),
        job_db_path.map(Into::into),
        postgres_url,
    ));
    storage
        .ensure_postgres_ready()
        .await
        .expect("initialize postgres migrations");
    let cleanup_root = storage.root_dir().to_path_buf();
    let cleanup_cfg = CleanupConfig::from_env();
    let billing_maintenance_interval_minutes = std::env::var(
        "AI_TUTOR_BILLING_MAINTENANCE_INTERVAL_MINUTES",
    )
    .ok()
    .and_then(|value| value.parse::<u64>().ok())
    .unwrap_or(15)
    .max(1);
    let billing_maintenance_interval =
        Duration::from_secs(billing_maintenance_interval_minutes * 60);
    let provider_config = Arc::new(ServerProviderConfig::from_env());

    run_startup_readiness_checks(storage.as_ref(), provider_config.as_ref())
        .await
        .expect("startup readiness checks");

    tokio::spawn(run_cleanup_loop(cleanup_root, cleanup_cfg));

    let service = Arc::new(LiveLessonAppService::new(
        Arc::clone(&storage),
        Arc::clone(&provider_config),
        Arc::new(DefaultLlmProviderFactory::new((*provider_config).clone())),
        Arc::new(DefaultImageProviderFactory::new((*provider_config).clone())),
        Arc::new(DefaultVideoProviderFactory::new((*provider_config).clone())),
        Arc::new(DefaultTtsProviderFactory::new((*provider_config).clone())),
        base_url,
    ));
    let billing_service = Arc::clone(&service);
    tokio::spawn(async move {
        loop {
            if let Err(err) = billing_service.run_billing_maintenance_cycle().await {
                error!(error = %err, "billing maintenance run failed");
            }
            tokio::time::sleep(billing_maintenance_interval).await;
        }
    });

    let app = build_router(service);

    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .expect("parse api socket address");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind api listener");

    info!("AI-Tutor-Backend API listening on {}", addr);
    axum::serve(listener, app).await.expect("serve api");
}
