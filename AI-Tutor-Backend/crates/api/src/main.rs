use std::{net::SocketAddr, sync::Arc};

use anyhow::{anyhow, Result};
use reqwest::Url;
use tracing::{error, info};

use ai_tutor_api::app::{build_router, LiveLessonAppService};
use ai_tutor_api::billing_event_queue::BillingEventQueue;
use ai_tutor_api::billing_processor::BillingProcessor;
use ai_tutor_api::billing_scheduler::BillingScheduler;
use ai_tutor_api::payment_gateway::resolve_payment_gateway;
use ai_tutor_api::redis_balance_cache::RedisBalanceCache;
use ai_tutor_routing::{operator_emails, overrides};
use ai_tutor_api::llm_proxy::{llm_proxy_router, LlmProxyState};
use ai_tutor_api::queue::LessonQueue;
use ai_tutor_api::redis_storage::RedisRuntimeSessionRepository;
use ai_tutor_api::telemetry::TelemetryService;
use ai_tutor_media::storage::LocalFileAssetStore;
use ai_tutor_providers::{
    config::ServerProviderConfig,
    factory::{
        DefaultAsrProviderFactory, DefaultImageProviderFactory, DefaultLlmProviderFactory,
        DefaultTtsProviderFactory, DefaultVideoProviderFactory,
    },
};
use ai_tutor_storage::filesystem::FileStorage;
use ai_tutor_storage::repositories::{ApiUsageRepository, RuntimeSessionRepository};

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
        // Redis is initialized lazily when first used.

        if !is_configured_secret(std::env::var("AI_TUTOR_OPERATOR_ALLOWED_EMAILS").ok()) {
            return Err(anyhow!(
                "startup readiness failed: operator OTP is enabled but AI_TUTOR_OPERATOR_ALLOWED_EMAILS is empty"
            ));
        }
    }

    let webhook_enabled = is_configured_secret(std::env::var("AI_TUTOR_WEBHOOK_URL").ok());
    let smtp_enabled = matches!(
        std::env::var("AI_TUTOR_SMTP_ENABLED")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    );
    if smtp_enabled && !webhook_enabled {
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
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();

    overrides::init_overrides("model-overrides.json");

    let host = std::env::var("AI_TUTOR_API_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT")
        .or_else(|_| std::env::var("AI_TUTOR_API_PORT"))
        .unwrap_or_else(|_| "10000".to_string());
    let storage_root = std::env::var("AI_TUTOR_STORAGE_ROOT")
        .unwrap_or_else(|_| "/tmp/ai-tutor".to_string());
    
    let postgres_url = match std::env::var("AI_TUTOR_NEON_DATABASE_URL")
        .or_else(|_| std::env::var("AI_TUTOR_POSTGRES_URL"))
    {
        Ok(url) => url,
        Err(_) => {
            tracing::error!("FATAL STARTUP ERROR: AI_TUTOR_NEON_DATABASE_URL or AI_TUTOR_POSTGRES_URL is missing. Please add it to your Render Environment Variables.");
            std::process::exit(1);
        }
    };
    let base_url =
        std::env::var("AI_TUTOR_BASE_URL").unwrap_or_else(|_| format!("http://{}:{}", host, port));

    let storage = Arc::new(FileStorage::with_databases(
        storage_root,
        Some(postgres_url.clone()),
    ));
    if let Err(e) = storage.ensure_postgres_ready().await {
        tracing::error!(
            "FATAL: Cannot connect to Postgres after retries: {}. Check AI_TUTOR_NEON_DATABASE_URL / AI_TUTOR_POSTGRES_URL. Neon free-tier computes suspend after inactivity.",
            e
        );
        std::process::exit(1);
    }

    // Initialize operator emails from env var + DB
    {
        let env_emails = std::env::var("AI_TUTOR_OPERATOR_ALLOWED_EMAILS").unwrap_or_default();
        operator_emails::init_emails(&env_emails);
        if let Ok(db_emails) = storage.list_operator_emails().await {
            operator_emails::sync_from_db(&db_emails);
        }
    }

    let provider_config = Arc::new(ServerProviderConfig::from_env());

    run_startup_readiness_checks(storage.as_ref(), provider_config.as_ref())
        .await
        .expect("startup readiness checks");

    let asset_store_type = std::env::var("AI_TUTOR_ASSET_STORE").unwrap_or_else(|_| "local".to_string());
    let asset_store: ai_tutor_media::storage::DynAssetStore = if asset_store_type == "r2" {
        let ak = std::env::var("AI_TUTOR_R2_ACCESS_KEY_ID").or_else(|_| std::env::var("R2_ACCESS_KEY_ID")).expect("R2 access key");
        let sk = std::env::var("AI_TUTOR_R2_SECRET_ACCESS_KEY").or_else(|_| std::env::var("R2_SECRET_ACCESS_KEY")).expect("R2 secret key");
        let endpoint = std::env::var("AI_TUTOR_R2_ENDPOINT").or_else(|_| std::env::var("R2_ENDPOINT")).expect("R2 endpoint");
        let bucket = std::env::var("AI_TUTOR_R2_BUCKET").or_else(|_| std::env::var("R2_BUCKET")).expect("R2 bucket");
        let pub_url = std::env::var("AI_TUTOR_R2_PUBLIC_BASE_URL").or_else(|_| std::env::var("R2_PUBLIC_BASE_URL")).unwrap_or_default();
        
        info!(provider = "Cloudflare R2", "Initializing R2-backed asset store");
        Arc::new(
            ai_tutor_media::storage::R2AssetStore::new(
                endpoint,
                bucket,
                ak,
                sk,
                pub_url,
                "", // key_prefix
            )
            .await
            .expect("initialize R2 asset store"),
        )
    } else {
        info!(provider = "Local File", "Initializing local file asset store");
        Arc::new(LocalFileAssetStore::new(
            storage.root_dir(),
            &base_url,
        ))
    };
    let redis_url = std::env::var("AI_TUTOR_AIVEN_REDIS_URL")
        .ok()
        .or_else(|| {
            std::env::var("AI_TUTOR_REDIS_URL")
                .ok()
                .or_else(|| std::env::var("REDIS_URL").ok())
        })
        .expect("AI_TUTOR_AIVEN_REDIS_URL, AI_TUTOR_REDIS_URL, or REDIS_URL is required for production queue and sessions");

    let redis_provider = if std::env::var("AI_TUTOR_AIVEN_REDIS_URL").is_ok() {
        "Aiven Valkey"
    } else {
        "Render KV"
    };
    info!(provider = "PostgreSQL (NeonDB)", "Initializing Postgres-backed lesson queue");
    let pg_pool = sqlx::PgPool::connect(&postgres_url).await.expect("connect to Postgres for queue via sqlx");
    info!("Running Postgres database migrations...");
    sqlx::migrate!("../../migrations").run(&pg_pool).await.expect("failed to run Postgres migrations");
    let queue: Arc<dyn LessonQueue> = {
        Arc::new(ai_tutor_api::queue_postgres::PgLessonQueue::new(pg_pool))
    };

    info!(provider = %redis_provider, "Initializing Redis-backed runtime session storage");
    let runtime_sessions: Arc<dyn RuntimeSessionRepository> = {
        let client = redis::Client::open(redis_url.as_str())?;
        Arc::new(RedisRuntimeSessionRepository::new(client))
    };

    let redis_client = Some(redis::Client::open(redis_url.as_str())?);

    let telemetry = Arc::new(TelemetryService::new(
        Arc::clone(&storage) as Arc<dyn ApiUsageRepository>
    ));

    let service = Arc::new(LiveLessonAppService::new(
        Arc::clone(&storage),
        asset_store,
        Arc::clone(&provider_config),
        Arc::new(DefaultLlmProviderFactory::new((*provider_config).clone())),
        Arc::new(DefaultImageProviderFactory::new((*provider_config).clone())),
        Arc::new(DefaultVideoProviderFactory::new((*provider_config).clone())),
        Arc::new(DefaultTtsProviderFactory::new((*provider_config).clone())),
        Arc::new(DefaultAsrProviderFactory::new((*provider_config).clone())),
        queue,
        runtime_sessions,
        redis_client,
        telemetry,
        base_url,
    ));
    
    let app = build_router(service.clone());

    // ── Start billing infrastructure ──────────────────────────────────────────
    // Lago-inspired: Redis Streams event queue + processor + renewal scheduler.
    {
        let billing_redis_client = redis::Client::open(redis_url.as_str())
            .expect("billing Redis client");

        let billing_queue = Arc::new(
            BillingEventQueue::new(&redis_url)
                .expect("billing event queue")
        );

        // Ensure all consumer groups exist (best-effort — non-fatal).
        billing_queue.ensure_consumer_groups_best_effort().await;

        let balance_cache = Arc::new(RedisBalanceCache::new(
            billing_redis_client,
            Arc::clone(&storage),
        ));

        // BillingProcessor — Lago events-processor equivalent.
        let processor = BillingProcessor::new(
            Arc::clone(&billing_queue),
            Arc::clone(&balance_cache),
            Arc::clone(&storage),
        );
        let _processor_handle = processor.start();
        info!("BillingProcessor started (Redis Streams consumer loop)");

        // BillingScheduler — AlarmClock + RenewalBatchWorker + N RenewalTaskWorkers.
        let internal_secret = std::env::var("AI_TUTOR_INTERNAL_SECRET")
            .unwrap_or_else(|_| "uc-school-internal-fallback-secret-2026".to_string());
        let frontend_url = std::env::var("AI_TUTOR_FRONTEND_URL")
            .or_else(|_| std::env::var("NEXT_PUBLIC_AI_TUTOR_BASE_URL"))
            .unwrap_or_else(|_| "http://localhost:3000".to_string());

        let scheduler = BillingScheduler::new(
            Arc::clone(&billing_queue),
            Arc::clone(&storage),
            internal_secret,
            frontend_url,
        );
        let _scheduler_handles = scheduler.start();
        info!("BillingScheduler started (AlarmClock + RenewalWorkers)");

        // Resolve active payment gateway from env vars.
        let _gateway = resolve_payment_gateway();
        info!("Payment gateway resolved and ready");
    }

    let proxy_state = LlmProxyState {
        provider_factory: Arc::new(DefaultLlmProviderFactory::new((*provider_config).clone())),
        provider_config: Arc::clone(&provider_config),
    };
    let app = app.merge(llm_proxy_router(proxy_state));

    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .expect("parse api socket address");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind api listener");

    info!("AI-Tutor-Backend API listening on {}", addr);
    
    // Perform final production readiness check before accepting traffic
    if std::env::var("AI_TUTOR_STRICT_STARTUP_READINESS").ok().is_some_and(|v| matches!(v.trim(), "1" | "true")) {
        info!("Strict startup readiness check enabled. Verifying infrastructure...");
        let readiness = ai_tutor_api::startup_readiness::ProductionReadinessChecker::check_all().await;
        match readiness {
            Ok(report) if !report.is_ready_for_traffic() => {
                error!("Production readiness check failed: {:?}", report);
                std::process::exit(1);
            }
            Err(err) => {
                error!("Production readiness check error: {}", err);
                std::process::exit(1);
            }
            _ => {
                info!("Infrastructure verified. Readiness status: PASS");
            }
        }
    }

    axum::serve(listener, app).await.expect("serve api");

    Ok(())
}
