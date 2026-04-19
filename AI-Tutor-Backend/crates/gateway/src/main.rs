use anyhow::Result;
use async_trait::async_trait;
use pingora::prelude::*;

struct AiTutorGateway;

#[async_trait]
impl ProxyHttp for AiTutorGateway {
    type CTX = (); 

    fn new_ctx(&self) -> Self::CTX {}

    async fn upstream_peer(
        &self,
        _session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        let upstream = std::env::var("AI_TUTOR_BACKEND_UPSTREAM")
            .unwrap_or_else(|_| "127.0.0.1:8099".to_string());
        let peer = HttpPeer::new(upstream, false, "ai-tutor-backend".to_string());
        Ok(Box::new(peer))
    }
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with_target(false)
        .compact()
        .init();

    let mut server = Server::new(None)?;
    server.bootstrap();

    let mut gateway = http_proxy_service(&server.configuration, AiTutorGateway);
    let listen_addr = std::env::var("AI_TUTOR_GATEWAY_LISTEN").unwrap_or_else(|_| "0.0.0.0:8098".to_string());
    gateway.add_tcp(&listen_addr);

    server.add_service(gateway);
    server.run_forever();
}
