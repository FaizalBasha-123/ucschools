use std::{net::SocketAddr, sync::Arc};

use tracing::info;

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

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let host = std::env::var("AI_TUTOR_API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("AI_TUTOR_API_PORT").unwrap_or_else(|_| "8099".to_string());
    let storage_root =
        std::env::var("AI_TUTOR_STORAGE_ROOT").unwrap_or_else(|_| "./data".to_string());
    let lesson_db_path = std::env::var("AI_TUTOR_LESSON_DB_PATH").ok();
    let runtime_db_path = std::env::var("AI_TUTOR_RUNTIME_DB_PATH").ok();
    let job_db_path = std::env::var("AI_TUTOR_JOB_DB_PATH").ok();
    let base_url =
        std::env::var("AI_TUTOR_BASE_URL").unwrap_or_else(|_| format!("http://{}:{}", host, port));

    let storage = Arc::new(FileStorage::with_databases(
        storage_root,
        lesson_db_path.map(Into::into),
        runtime_db_path.map(Into::into),
        job_db_path.map(Into::into),
    ));
    let cleanup_root = storage.root_dir().to_path_buf();
    let cleanup_cfg = CleanupConfig::from_env();
    let provider_config = Arc::new(ServerProviderConfig::from_env());

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
