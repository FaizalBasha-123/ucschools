use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

/// Bearer token authentication middleware.
///
/// Checks the `Authorization: Bearer <token>` header against the value of
/// `AI_TUTOR_API_SECRET`. If the env var is not set, authentication is
/// disabled (open access) – useful for local development.
///
/// The `/health` and `/api/health` paths are always exempt.
pub async fn require_auth(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();

    // Health checks are always allowed
    if path == "/health" || path == "/api/health" {
        return next.run(request).await;
    }

    let secret = match std::env::var("AI_TUTOR_API_SECRET") {
        Ok(s) if !s.is_empty() => s,
        // No secret configured → open access (local dev)
        _ => return next.run(request).await,
    };

    let auth_header = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    if let Some(token) = auth_header.strip_prefix("Bearer ") {
        if token == secret {
            return next.run(request).await;
        }
    }

    (
        StatusCode::UNAUTHORIZED,
        [("content-type", "application/json")],
        r#"{"error":"unauthorized"}"#,
    )
        .into_response()
}
