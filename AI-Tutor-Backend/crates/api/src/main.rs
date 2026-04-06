use std::{net::SocketAddr, sync::Arc};

use tracing::info;

use ai_tutor_api::app::{build_router, LiveLessonAppService};
use ai_tutor_providers::{
    config::ServerProviderConfig,
    factory::{DefaultImageProviderFactory, DefaultLlmProviderFactory, DefaultTtsProviderFactory, DefaultVideoProviderFactory},
};
use ai_tutor_storage::filesystem::FileStorage;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let host = std::env::var("AI_TUTOR_API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("AI_TUTOR_API_PORT").unwrap_or_else(|_| "8099".to_string());
    let storage_root =
        std::env::var("AI_TUTOR_STORAGE_ROOT").unwrap_or_else(|_| "./data".to_string());
    let base_url = std::env::var("AI_TUTOR_BASE_URL")
        .unwrap_or_else(|_| format!("http://{}:{}", host, port));

    let storage = Arc::new(FileStorage::new(storage_root));
    let service = Arc::new(LiveLessonAppService::new(
        Arc::clone(&storage),
        Arc::new(ServerProviderConfig::from_env()),
        Arc::new(DefaultLlmProviderFactory),
        Arc::new(DefaultImageProviderFactory),
        Arc::new(DefaultVideoProviderFactory),
        Arc::new(DefaultTtsProviderFactory),
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
